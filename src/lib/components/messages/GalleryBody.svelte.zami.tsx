import { useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Pressable, Text, View } from "react-native";
import { Image, Portal, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";
import {
    Download,
    File as FileIcon,
    Film,
    Image as ImageIcon,
    Music,
    Play,
} from "lucide-svelte";
import {
    mxcToHttp,
    fetchAttachmentBlob,
    fetchDecryptedAttachmentBlob,
} from "$lib/matrix/client";
import { saveObjectUrl, revokeLater } from "$lib/utils/saveFile";
import { GALLERY_MSGTYPE_UNSTABLE } from "$lib/utils/gallery";
import {
    mediaItemKey,
    mediaItemsFromEvent,
    mediaThumbnailMxc,
    mediaTileSource,
    formatMediaDuration,
    formatMediaSize,
    type RoomMediaItem,
} from "$lib/utils/roomMedia";
import { galleryNav, galleryPositionLabel } from "$lib/utils/mediaGallery";
import {
    justifyGallery,
    layoutAspect,
    thumbnailBox,
} from "$lib/utils/galleryLayout";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import Lightbox from "$lib/components/ui/Lightbox.svelte";
import MediaProgress from "$lib/components/ui/MediaProgress.svelte";
import type { DownloadProgress } from "$lib/utils/downloadProgress";

interface Props {
    /** The gallery's valid items, from galleryItems(content). */
    items: Record<string, unknown>[];
    eventId: string;
    sender: string;
    ts: number;
}

interface Entry {
    /** Stable per item within this event: the event id plus its position. */
    key: string;
    media: RoomMediaItem;
    /** The item's `info` block, for its intrinsic dimensions. */
    info: Record<string, unknown>;
}

/**
 * Zami: a `$state` map the async decrypts read back after an await: React
 * state for rendering, mirrored in a ref that always holds the latest value.
 */
function useLatestState<T>(initial: T) {
    const [value, setValue] = useState(initial);
    const ref = useRef(value);
    function set(next: T) {
        ref.current = next;
        setValue(next);
    }
    return [value, ref, set] as const;
}

export default function GalleryBody({ items, eventId, sender, ts }: Props) {
    // `items` is already galleryItems() output, so passing it back as the
    // gallery's itemtypes keeps every itemIndex aligned with it.
    const entries = useMemo(
        (): Entry[] =>
            mediaItemsFromEvent({
                eventId,
                sender,
                ts,
                type: "m.room.message",
                content: {
                    msgtype: GALLERY_MSGTYPE_UNSTABLE,
                    itemtypes: items,
                },
            }).map((media) => {
                const raw = items[media.itemIndex ?? -1];
                const info =
                    typeof raw?.info === "object" && raw.info !== null
                        ? (raw.info as Record<string, unknown>)
                        : {};
                return { key: mediaItemKey(media), media, info };
            }),
        [items, eventId, sender, ts],
    );

    // Images and videos form the grid and the lightbox sequence; audio and
    // files are listed below it as rows.
    const visual = useMemo(
        () =>
            entries.filter(
                (e) => e.media.kind === "image" || e.media.kind === "video",
            ),
        [entries],
    );
    const others = entries.filter(
        (e) => e.media.kind === "audio" || e.media.kind === "file",
    );

    // Measured width of the visual section; 0 until the first measurement,
    // when the first paint lays out at 400px instead.
    const [containerWidth, setContainerWidth] = useState(0);
    // Aspect ratios learned from loaded tiles that carried no w/h in info. A
    // video's tile is its thumbnail, which has the video's shape.
    const [loadedAspects, setLoadedAspects] = useState<Record<string, number>>(
        {},
    );

    // Aspect for each visual entry: declared info.w/h, else the loaded
    // tile's natural size, else 1 (a video is never assumed 16/9).
    const aspects = visual.map((e) => {
        const w = Number(e.info.w);
        const h = Number(e.info.h);
        if (w > 0 && h > 0) return layoutAspect(w, h);
        return loadedAspects[e.key] ?? 1;
    });
    const rows = justifyGallery(
        aspects,
        containerWidth > 0 ? containerWidth : 400,
        {
            gap: 4,
        },
    );

    // Zami: an expo-image load event's source size stands in for the
    // <img>'s naturalWidth/naturalHeight.
    function learnAspect(key: string, width: number, height: number): void {
        if (!width || !height) return;
        const a = layoutAspect(width, height);
        setLoadedAspects((prev) =>
            prev[key] === a ? prev : { ...prev, [key]: a },
        );
    }

    function devicePixelRatioOrOne(): number {
        return PixelRatio.get() || 1;
    }

    // Decrypted encrypted thumbnails, keyed by entry key.
    const [decryptedThumbs, decryptedThumbsRef, setDecryptedThumbs] =
        useLatestState<Record<string, string>>({});
    const [thumbFailed, setThumbFailed] = useState<Record<string, boolean>>({});
    // Decrypted full media for the lightbox, keyed by entry key.
    const [decryptedFull, decryptedFullRef, setDecryptedFull] = useLatestState<
        Record<string, string>
    >({});
    const [viewerDecrypting, setViewerDecrypting] = useState(false);
    const [viewerProgress, setViewerProgress] =
        useState<DownloadProgress | null>(null);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);

    // Bumped on teardown (a plain let, never reactive) so a decrypt still in
    // flight revokes its own URL instead of writing into dead state.
    const blobGen = useRef(0);
    const [thumbPending] = useState(() => new Set<string>());
    function releaseDecryptedBlobs(): void {
        blobGen.current++;
        thumbPending.clear();
        for (const url of Object.values(decryptedThumbsRef.current))
            URL.revokeObjectURL(url);
        for (const url of Object.values(decryptedFullRef.current))
            URL.revokeObjectURL(url);
        setDecryptedThumbs({});
        setDecryptedFull({});
        setViewerDecrypting(false);
    }
    useEffect(
        () => () => releaseDecryptedBlobs(),
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- on unmount only, as upstream.
        [],
    );

    // Decrypt each encrypted tile once: an image's own file, a video's
    // thumbnail_file (never the video itself; see mediaTileSource).
    useEffect(() => {
        const wanted = visual.flatMap((e) => {
            // An encrypted image's own thumbnail_file when it has one: a
            // gallery of 40 photos must not download 40 full-size files just
            // to draw the grid.
            const source =
                e.media.kind === "image" && e.media.encryptedThumbnailFile
                    ? {
                          kind: "encrypted" as const,
                          file: e.media.encryptedThumbnailFile,
                          mimetype: e.media.thumbnailMimetype ?? null,
                      }
                    : mediaTileSource(e.media);
            return source?.kind === "encrypted" ? [{ key: e.key, source }] : [];
        });
        const gen = blobGen.current;
        for (const { key, source } of wanted) {
            if (source.kind !== "encrypted") continue;
            if (decryptedThumbsRef.current[key] || thumbPending.has(key))
                continue;
            thumbPending.add(key);
            fetchDecryptedAttachmentBlob(
                source.file,
                source.mimetype ?? undefined,
            )
                .then((url) => {
                    if (gen !== blobGen.current) {
                        URL.revokeObjectURL(url);
                        return;
                    }
                    setDecryptedThumbs({
                        ...decryptedThumbsRef.current,
                        [key]: url,
                    });
                })
                .catch(() => {
                    if (gen === blobGen.current)
                        setThumbFailed((f) => ({ ...f, [key]: true }));
                })
                .finally(() => {
                    if (gen === blobGen.current) thumbPending.delete(key);
                });
        }
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream tracks the visual entries only.
    }, [visual]);

    const viewerEntry =
        viewerIndex === null ? null : (visual[viewerIndex] ?? null);
    const viewerKey = viewerEntry?.key ?? null;
    const nav =
        viewerIndex === null ? null : galleryNav(visual.length, viewerIndex);

    // Decrypt the viewed item when it is an encrypted image. An encrypted
    // video is decrypted by the Lightbox itself. Keyed on the key alone so a
    // re-render with equal content does not cancel and restart the decrypt.
    useEffect(() => {
        const key = viewerKey;
        if (key === null) return;
        const entry = viewerEntry;
        if (!entry) return;
        const media = entry.media;
        if (!media.encrypted || !media.encryptedFile) return;
        if (media.kind === "video") return;
        if (decryptedFullRef.current[key]) return;
        const gen = blobGen.current;
        let cancelled = false;
        setViewerDecrypting(true);
        setViewerProgress(null);
        fetchDecryptedAttachmentBlob(
            media.encryptedFile,
            media.mimetype ?? undefined,
            {
                expectedSize: media.size,
                onProgress: (p) => {
                    if (!cancelled) setViewerProgress(p);
                },
            },
        )
            .then((decrypted) => {
                if (gen !== blobGen.current) {
                    URL.revokeObjectURL(decrypted);
                    return;
                }
                setDecryptedFull({
                    ...decryptedFullRef.current,
                    [key]: decrypted,
                });
                if (!cancelled) setViewerDecrypting(false);
            })
            .catch(() => {
                if (cancelled || gen !== blobGen.current) return;
                setViewerDecrypting(false);
                setViewerIndex(null);
                showErrorToast(t("roomMediaPanel.couldNotLoadThisMedia"));
            });
        return () => {
            cancelled = true;
            setViewerDecrypting(false);
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream untracks the entry and decryptedFull.
    }, [viewerKey]);

    const viewerSrc = ((): string | null => {
        const entry = viewerEntry;
        if (!entry) return null;
        const media = entry.media;
        if (media.encrypted && media.kind !== "video")
            return decryptedFull[entry.key] ?? null;
        return mxcToHttp(media.url);
    })();

    const viewerPoster = ((): string | null => {
        const entry = viewerEntry;
        if (!entry || entry.media.kind !== "video") return null;
        if (entry.media.encrypted) return decryptedThumbs[entry.key] ?? null;
        // "scale" so the poster matches the video's own aspect ratio.
        return mxcToHttp(mediaThumbnailMxc(entry.media), 800, 600, "scale");
    })();

    function step(delta: number): void {
        if (viewerIndex === null) return;
        const next = viewerIndex + delta;
        if (next < 0 || next >= visual.length) return;
        setViewerIndex(next);
    }

    // Zami: not ported: tileOriginal() and `use:fullImage`, the desktop
    // right-click "Copy image" / "Save image as" on a tile.

    async function download(media: RoomMediaItem): Promise<void> {
        try {
            const blobUrl =
                media.encrypted && media.encryptedFile
                    ? await fetchDecryptedAttachmentBlob(
                          media.encryptedFile,
                          media.mimetype ?? undefined,
                      )
                    : await fetchAttachmentBlob(mxcToHttp(media.url)!);
            try {
                await saveObjectUrl(blobUrl, media.name);
            } finally {
                revokeLater(blobUrl);
            }
        } catch (e) {
            console.error("Failed to download attachment", e);
            showErrorToast(t("roomMediaPanel.failedToDownloadAttachment"));
        }
    }

    return (
        <>
            <View
                role="group"
                accessibilityLabel={t("messageItem.galleryLabel", {
                    n: items.length,
                })}
                className="mt-1 max-w-full gap-1"
            >
                {entries.length === 0 ? (
                    <Text className="text-sm text-discord-textMuted">
                        {t("messageItem.galleryEmpty")}
                    </Text>
                ) : null}

                {visual.length > 0 ? (
                    <View
                        className="w-full max-w-[480px]"
                        onLayout={(e) =>
                            setContainerWidth(e.nativeEvent.layout.width)
                        }
                    >
                        {rows.map((row, r) => (
                            <View
                                key={row.tiles[0]?.index}
                                className={`flex-row gap-1 ${r > 0 ? "mt-1" : ""}`}
                            >
                                {row.tiles.map((tile) => {
                                    const entry = visual[tile.index];
                                    const media = entry.media;
                                    const box = thumbnailBox(
                                        tile.width,
                                        tile.height,
                                        devicePixelRatioOrOne(),
                                    );
                                    const thumb = thumbFailed[entry.key]
                                        ? null
                                        : media.encrypted
                                          ? (decryptedThumbs[entry.key] ?? null)
                                          : mxcToHttp(
                                                mediaThumbnailMxc(media),
                                                box,
                                                box,
                                                "scale",
                                            );
                                    const duration = formatMediaDuration(
                                        media.durationMs,
                                    );
                                    return (
                                        <Pressable
                                            key={entry.key}
                                            accessibilityRole="button"
                                            onPress={() =>
                                                setViewerIndex(tile.index)
                                            }
                                            accessibilityLabel={t(
                                                "messageItem.galleryOpenItem",
                                                {
                                                    name: media.name,
                                                },
                                            )}
                                            className="relative shrink-0 overflow-hidden rounded-lg bg-discord-background hover:opacity-80 active:opacity-80 transition-opacity"
                                            style={{
                                                width: tile.width,
                                                height: tile.height,
                                            }}
                                        >
                                            {thumb ? (
                                                <Image
                                                    source={mediaSource(thumb)}
                                                    accessible={false}
                                                    className="w-full h-full bg-discord-backgroundTertiary"
                                                    contentFit="contain"
                                                    onLoad={(e) =>
                                                        learnAspect(
                                                            entry.key,
                                                            e.source.width,
                                                            e.source.height,
                                                        )
                                                    }
                                                    onError={() =>
                                                        setThumbFailed((f) => ({
                                                            ...f,
                                                            [entry.key]: true,
                                                        }))
                                                    }
                                                />
                                            ) : (
                                                <View className="absolute inset-0 flex items-center justify-center bg-discord-backgroundTertiary">
                                                    {media.kind === "video" ? (
                                                        <Film className="w-6 h-6 text-discord-textMuted" />
                                                    ) : (
                                                        <ImageIcon className="w-6 h-6 text-discord-textMuted" />
                                                    )}
                                                </View>
                                            )}
                                            {media.kind === "video" ? (
                                                <>
                                                    <View className="absolute inset-0 flex items-center justify-center">
                                                        <View className="w-9 h-9 rounded-full bg-black/60 flex items-center justify-center">
                                                            <Play
                                                                className="w-4 h-4 text-white ms-0.5"
                                                                fill="currentColor"
                                                            />
                                                        </View>
                                                    </View>
                                                    {duration ? (
                                                        <View className="absolute bottom-1 end-1 px-1 rounded bg-black/60">
                                                            <Text className="text-white text-[0.625rem]">
                                                                {duration}
                                                            </Text>
                                                        </View>
                                                    ) : null}
                                                </>
                                            ) : null}
                                        </Pressable>
                                    );
                                })}
                            </View>
                        ))}
                    </View>
                ) : null}

                {others.length > 0 ? (
                    <View role="list" className="gap-1">
                        {others.map((entry) => {
                            const media = entry.media;
                            const sizeLabel = formatMediaSize(media.size);
                            return (
                                <View
                                    key={entry.key}
                                    role="listitem"
                                    className="flex-row items-center gap-2 p-2 rounded-lg bg-discord-backgroundSecondary max-w-sm min-w-0"
                                >
                                    {media.kind === "audio" ? (
                                        <Music className="w-5 h-5 shrink-0 text-discord-textMuted" />
                                    ) : (
                                        <FileIcon className="w-5 h-5 shrink-0 text-discord-textMuted" />
                                    )}
                                    <View className="min-w-0 flex-1">
                                        <Text
                                            numberOfLines={1}
                                            className="text-sm text-discord-textPrimary"
                                        >
                                            {media.name}
                                        </Text>
                                        {sizeLabel ? (
                                            <Text className="text-xs text-discord-textMuted">
                                                {sizeLabel}
                                            </Text>
                                        ) : null}
                                    </View>
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void download(media)}
                                        accessibilityLabel={t(
                                            "messageItem.galleryDownload",
                                            {
                                                name: media.name,
                                            },
                                        )}
                                        className="shrink-0 p-1.5 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                                    >
                                        <Download className="w-4 h-4 text-discord-textMuted" />
                                    </Pressable>
                                </View>
                            );
                        })}
                    </View>
                ) : null}
            </View>

            {viewerEntry ? (
                viewerDecrypting ? (
                    <Portal>
                        <View
                            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
                            role="dialog"
                            accessibilityViewIsModal
                            accessibilityLabel={t(
                                "roomMediaPanel.decryptingMedia",
                            )}
                        >
                            <View className="max-w-sm w-full shadow-lg">
                                <MediaProgress
                                    label={t("roomMediaPanel.decryptingMedia2")}
                                    progress={viewerProgress}
                                />
                            </View>
                        </View>
                    </Portal>
                ) : viewerSrc ? (
                    <Lightbox
                        src={viewerSrc}
                        alt={viewerEntry.media.name}
                        kind={
                            viewerEntry.media.kind === "video"
                                ? "video"
                                : "image"
                        }
                        poster={viewerPoster}
                        filename={viewerEntry.media.name}
                        encryptedFile={
                            viewerEntry.media.encrypted &&
                            viewerEntry.media.kind === "video"
                                ? viewerEntry.media.encryptedFile
                                : undefined
                        }
                        mimetype={viewerEntry.media.mimetype}
                        sizeHint={viewerEntry.media.size}
                        onClose={() => setViewerIndex(null)}
                        onPrev={
                            nav && nav.prevIndex !== null
                                ? () => step(-1)
                                : undefined
                        }
                        onNext={
                            nav && nav.nextIndex !== null
                                ? () => step(1)
                                : undefined
                        }
                        position={galleryPositionLabel(
                            visual.length,
                            viewerIndex ?? -1,
                        )}
                    />
                ) : null
            ) : null}
        </>
    );
}
