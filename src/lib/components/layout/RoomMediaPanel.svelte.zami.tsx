import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import {
    Image,
    Portal,
    Spin,
    SvgIcon,
    mediaSource,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import type { Room } from "matrix-js-sdk";
import {
    fetchRoomMediaPage,
    getIndexedMedia,
    isEventIndexActive,
    fetchAttachmentBlob,
    fetchDecryptedAttachmentBlob,
    mxcToHttp,
    type RoomMediaPage,
} from "$lib/matrix/client";
import { saveObjectUrl, revokeLater } from "$lib/utils/saveFile";
import {
    mergeMediaPages,
    splitMediaItems,
    formatMediaSize,
    formatMediaDuration,
    mediaThumbnailMxc,
    mediaTileSource,
    mediaViewerItem,
    type RoomMediaItem,
} from "$lib/utils/roomMedia";
import { galleryPositionLabel } from "$lib/utils/mediaGallery";
import { interfaceState } from "$lib/stores/interface.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import Lightbox from "$lib/components/ui/Lightbox.svelte";
import MediaProgress from "$lib/components/ui/MediaProgress.svelte";
import type { DownloadProgress } from "$lib/utils/downloadProgress";

interface Props {
    room: Room;
    onClose: () => void;
}

// Zami: the grid's `grid-cols-3 gap-1 p-2`, in px.
const COLUMNS = 3;
const GAP = 4;
const PAD = 8;

/**
 * Zami: a `$state` the panel's async loads read back after an await (`items`,
 * `nextToken`, …): React state for rendering, mirrored in a ref that always
 * holds the latest value, which a load in flight reads and writes.
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

export default function RoomMediaPanel({ room, onClose }: Props) {
    const isMobile = useRune(() => interfaceState.isMobile);

    const [items, itemsRef, setItems] = useLatestState<RoomMediaItem[]>([]);
    const [, nextTokenRef, setNextToken] = useLatestState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Kept apart from `error`: a failed "Load more" must NOT replace an already
    // populated grid with the full-panel error branch (and its "Try again",
    // which re-fetches from scratch). Shown as an inline strip instead.
    const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
    const [exhausted, , setExhausted] = useLatestState(false);
    const [tab, tabRef, setTab] = useLatestState<"media" | "files">("media");
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    // Event ids whose tile thumbnail 404'd or otherwise failed to decode. Most
    // videos carry no info.thumbnail_url and most servers cannot thumbnail a
    // video, so this is the ORDINARY path for them, not an error case: the tile
    // swaps to a placeholder instead of showing a broken-image glyph.
    const [thumbFailed, setThumbFailed] = useState<Record<string, boolean>>({});
    // Decrypted encrypted thumbnails, keyed by eventId.
    const [decryptedThumbs, decryptedThumbsRef, setDecryptedThumbs] =
        useLatestState<Record<string, string>>({});
    // Decrypted full media for the lightbox viewer, keyed by eventId.
    const [decryptedFull, decryptedFullRef, setDecryptedFull] = useLatestState<
        Record<string, string>
    >({});
    const [viewerDecrypting, setViewerDecrypting] = useState(false);
    const [viewerProgress, setViewerProgress] =
        useState<DownloadProgress | null>(null);

    const split = splitMediaItems(items);
    const visible = tab === "media" ? split.visual : split.files;
    const hasMore = !exhausted;

    // "…in this room yet." would assert something the Load-more button directly
    // beneath it contradicts, so only claim it once history is exhausted.
    const emptyMessage = hasMore
        ? tab === "media"
            ? t("roomMediaPanel.noMediaFoundInTheLast")
            : t("roomMediaPanel.noFilesFoundInTheLast")
        : tab === "media"
          ? t("roomMediaPanel.noImagesOrVideosInThis")
          : t("roomMediaPanel.noFilesInThisRoomYet");

    // Everything in the Media tab is viewable: the Lightbox renders an image or
    // a native player depending on `kind`, so prev/next steps across a mixed
    // image/video set in the order the grid shows them.
    const gallery = split.visual;

    // Each load keeps paging until the open tab gained about a screenful (a
    // 3-wide grid, 8 rows) or history runs out. Stopping at the first page
    // with anything in it showed one or two tiles per click: in an encrypted
    // room a page is 100 messages of any kind, and media is a few of them.
    // Capped so a media-less room cannot spin forever on one load.
    const FILL_TARGET = 24;
    const MAX_PAGES_PER_LOAD = 10;

    // Identifies the pull that currently owns the panel's state. A plain `let`,
    // deliberately NOT $state: pull() both reads and increments it, and pull()
    // is called from the room-change $effect, so a reactive read there would
    // register a dependency that pull's own `++` immediately invalidates.
    const pullGen = useRef(0);
    // Zami: the current `room` prop, which a pull compares after each await.
    const roomRef = useRef(room);
    roomRef.current = room;

    async function pull(reset: boolean): Promise<void> {
        const gen = ++pullGen.current;
        setLoadMoreError(null);
        if (reset) {
            setItems([]);
            setNextToken(null);
            setExhausted(false);
            setError(null);
            // A viewer left open over the old room's images would otherwise
            // re-mount on whatever lands at that index next.
            setViewerIndex(null);
            setThumbFailed({});
            releaseDecryptedBlobs();
            setLoading(true);
        } else {
            setLoadingMore(true);
        }
        const room = roomRef.current;
        const roomId = room.roomId;
        try {
            // Encrypted room with the on-device index: show what it holds at
            // once, then page the server only from where its crawler stopped.
            if (
                reset &&
                isEventIndexActive() &&
                room.hasEncryptionStateEvent()
            ) {
                const indexed = await getIndexedMedia(roomId);
                if (
                    gen !== pullGen.current ||
                    roomRef.current.roomId !== roomId
                )
                    return;
                setItems(mergeMediaPages(itemsRef.current, indexed.items));
                if (indexed.complete) {
                    setExhausted(true);
                    return;
                }
                if (indexed.resumeFrom !== null) {
                    setNextToken(indexed.resumeFrom);
                    if (tabCount() >= FILL_TARGET) return;
                    reset = false;
                }
            }
            const startCount = tabCount();
            for (let page = 0; page < MAX_PAGES_PER_LOAD; page++) {
                const res: RoomMediaPage = await fetchRoomMediaPage(
                    roomId,
                    reset && page === 0 ? null : nextTokenRef.current,
                );
                // Superseded while awaiting — the panel lives in a shared
                // sidebar slot, so a room switch REPLACES the prop instead of
                // remounting us, and an A→B→A switch leaves roomId equal. Only
                // the generation counter reliably says "someone else owns the
                // state now"; bail without touching any of it.
                if (
                    gen !== pullGen.current ||
                    roomRef.current.roomId !== roomId
                )
                    return;
                setItems(mergeMediaPages(itemsRef.current, res.items));
                setNextToken(res.nextToken);
                if (res.nextToken === null) {
                    setExhausted(true);
                    break;
                }
                // Count what landed in the tab being looked at: duplicates and
                // the other tab's items don't fill the screen.
                if (tabCount() - startCount >= FILL_TARGET) break;
            }
        } catch (e) {
            // SDK errors read like `MatrixError: [403] …` — log the real one,
            // show the user something they can act on.
            console.error("Failed to load room media", e);
            if (gen === pullGen.current) {
                if (reset) setError(t("roomMediaPanel.couldNotLoadMedia"));
                else
                    setLoadMoreError(t("roomMediaPanel.couldNotLoadMoreMedia"));
            }
        } finally {
            // Never clear a flag a newer pull set: the guard above `return`s
            // through this block, and without the check a late response from
            // the previous room would drop the current room's spinner.
            if (gen === pullGen.current) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }

    function tabCount(): number {
        const s = splitMediaItems(itemsRef.current);
        return (tabRef.current === "media" ? s.visual : s.files).length;
    }

    // Load more on its own when the end of the list scrolls into view.
    // Zami: the list's onEndReached (below) stands in for the
    // IntersectionObserver on the Load-more row.
    function onEndReached(): void {
        if (!loading && !error && hasMore && !loadingMore) void pull(false);
    }

    // Reload from scratch whenever the panel is pointed at a different room.
    // `room.roomId` is read OUTSIDE untrack so the prop is the effect's one and
    // only dependency; pull() is untracked because it writes items/nextToken/
    // loading/exhausted synchronously and calls into the SDK boundary, and a
    // dependency picked up in there would make those writes re-enter the effect
    // (effect_update_depth_exceeded).
    useEffect(() => {
        void pull(true);
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream untracks pull(); the room id is the one dependency.
    }, [room.roomId]);

    function openViewer(item: RoomMediaItem): void {
        const index = gallery.findIndex((i) => i.eventId === item.eventId);
        if (index === -1) return;
        setViewerIndex(index);
    }

    function step(delta: number): void {
        if (viewerIndex === null) return;
        const next = viewerIndex + delta;
        if (next < 0 || next >= gallery.length) return;
        setViewerIndex(next);
    }

    async function download(item: RoomMediaItem, quiet = false): Promise<void> {
        try {
            const blobUrl =
                item.encrypted && item.encryptedFile
                    ? await fetchDecryptedAttachmentBlob(
                          item.encryptedFile,
                          item.mimetype ?? undefined,
                      )
                    : await fetchAttachmentBlob(mxcToHttp(item.url)!);
            try {
                await saveObjectUrl(blobUrl, item.name, { quiet });
            } finally {
                revokeLater(blobUrl);
            }
        } catch (e) {
            console.error("Failed to download attachment", e);
            showErrorToast(t("roomMediaPanel.failedToDownloadAttachment"));
        }
    }

    // Decrypted blob URLs live until the panel switches room or unmounts, and
    // are released together here. Bumping `blobGen` (a plain let, never
    // reactive) orphans any decrypt still in flight: it revokes its own URL
    // instead of writing into the new room's maps.
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
    // thumbnail_file (never the video itself; see mediaTileSource). Re-runs on
    // every "Load more", so it skips anything already decrypted or in flight.
    useEffect(() => {
        const wanted = split.visual
            .map((m) => ({ id: m.eventId, source: mediaTileSource(m) }))
            .filter((x) => x.source?.kind === "encrypted");
        const gen = blobGen.current;
        for (const { id, source } of wanted) {
            if (source?.kind !== "encrypted") continue;
            if (decryptedThumbsRef.current[id] || thumbPending.has(id))
                continue;
            thumbPending.add(id);
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
                        [id]: url,
                    });
                })
                .catch(() => {
                    if (gen === blobGen.current)
                        setThumbFailed((f) => ({ ...f, [id]: true }));
                })
                .finally(() => {
                    if (gen === blobGen.current) thumbPending.delete(id);
                });
        }
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream tracks the visual items only.
    }, [items]);

    // Decrypt full media when the viewer opens on an encrypted item. The
    // result is kept in decryptedFull (released with the panel) even if the
    // user has stepped on, but only the current item's decrypt may clear the
    // spinner.
    const viewerItem = viewerIndex === null ? undefined : gallery[viewerIndex];
    useEffect(() => {
        if (viewerIndex === null) return;
        const item = viewerItem;
        if (!item || !item.encrypted || !item.encryptedFile) return;
        // An encrypted video is decrypted by the viewer itself, which can
        // start playing while it is still downloading.
        if (item.kind === "video") return;
        const id = item.eventId;
        if (decryptedFullRef.current[id]) return; // Already decrypted
        const gen = blobGen.current;
        let cancelled = false;
        setViewerDecrypting(true);
        setViewerProgress(null);
        fetchDecryptedAttachmentBlob(
            item.encryptedFile,
            item.mimetype ?? undefined,
            {
                expectedSize: item.size,
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
                    [id]: decrypted,
                });
                if (!cancelled) setViewerDecrypting(false);
            })
            .catch(() => {
                if (!cancelled) setViewerDecrypting(false);
            });
        return () => {
            cancelled = true;
            setViewerDecrypting(false);
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream untracks decryptedFull.
    }, [viewerIndex, viewerItem]);

    // Zami: the grid cell's width, from the list's (`grid-cols-3 gap-1 p-2`).
    const [listWidth, setListWidth] = useState(0);
    const cell =
        listWidth > 0
            ? (listWidth - 2 * PAD - (COLUMNS - 1) * GAP) / COLUMNS
            : 0;

    function mediaTile(media: RoomMediaItem) {
        const thumbMxc = mediaThumbnailMxc(media);
        const thumb = thumbFailed[media.eventId]
            ? null
            : media.encrypted
              ? (decryptedThumbs[media.eventId] ?? null)
              : mxcToHttp(thumbMxc, 160, 160);
        const duration = formatMediaDuration(media.durationMs);
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                    media.kind === "video"
                        ? t("roomMediaPanel.play", { name: media.name })
                        : media.name
                }
                onPress={() => openViewer(media)}
                className="relative aspect-square rounded overflow-hidden bg-discord-background active:opacity-80 transition-opacity"
                style={{ width: cell }}
            >
                {thumb ? (
                    // Decrypted or unencrypted thumbnail
                    <Image
                        source={mediaSource(thumb)}
                        accessible={false}
                        className="w-full h-full"
                        contentFit="cover"
                        onError={() =>
                            setThumbFailed((f) => ({
                                ...f,
                                [media.eventId]: true,
                            }))
                        }
                    />
                ) : media.kind === "video" ? (
                    // Nothing to show: a flat tile that lets the play
                    // badge below carry the meaning on its own.
                    <View className="w-full h-full bg-discord-backgroundTertiary" />
                ) : null}
                {media.kind === "video" ? (
                    <>
                        {/* Play affordance: a still tile that reads as
                            playable, with no media element behind it. */}
                        <View className="absolute inset-0 flex items-center justify-center">
                            <View className="w-9 h-9 rounded-full bg-black/60 flex items-center justify-center">
                                <SvgIcon
                                    d="M8 5v14l11-7z"
                                    className="w-4 h-4 text-white ms-0.5"
                                />
                            </View>
                        </View>
                        <View className="absolute bottom-1 end-1 px-1 rounded bg-black/60">
                            <Text className="text-white text-[0.625rem]">
                                {duration || t("roomMediaPanel.video")}
                            </Text>
                        </View>
                    </>
                ) : null}
            </Pressable>
        );
    }

    function fileRow(file: RoomMediaItem) {
        return (
            <Pressable
                accessibilityRole="button"
                // Zami: no shift+click quiet save.
                onPress={() => void download(file)}
                className="w-full p-2 rounded-lg hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
            >
                <Text
                    numberOfLines={1}
                    className="text-xs font-semibold text-discord-textPrimary"
                >
                    {file.name}
                </Text>
                <Text className="text-xs text-discord-textMuted">
                    {formatMediaSize(file.size) ||
                        (file.kind === "audio"
                            ? t("roomMediaPanel.audio")
                            : t("roomMediaPanel.file"))}
                </Text>
            </Pressable>
        );
    }

    const listed = !loading && !error && visible.length > 0;

    function viewer() {
        if (viewerIndex === null || !gallery[viewerIndex]) return null;
        const item = gallery[viewerIndex];
        const view = mediaViewerItem(item, {
            // An encrypted item resolves only once decrypted: its mxc holds
            // ciphertext, which the viewer would download and fail to show.
            full: (mxc) =>
                item.encrypted && item.kind !== "video"
                    ? (decryptedFull[item.eventId] ?? null)
                    : mxcToHttp(mxc),
            // "scale" rather than the default crop: a poster must match the video's
            // own aspect ratio or the player letterboxes a distorted still.
            poster: (mxc) =>
                item.encrypted && decryptedThumbs[item.eventId]
                    ? decryptedThumbs[item.eventId]
                    : mxcToHttp(mxc, 800, 600, "scale"),
        });
        if (viewerDecrypting)
            return (
                <Portal>
                    <View
                        className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
                        role="dialog"
                        accessibilityViewIsModal
                        accessibilityLabel={t("roomMediaPanel.decryptingMedia")}
                    >
                        <View className="max-w-sm w-full shadow-lg">
                            <MediaProgress
                                label={t("roomMediaPanel.decryptingMedia2")}
                                progress={viewerProgress}
                            />
                        </View>
                    </View>
                </Portal>
            );
        if (view)
            return (
                <Lightbox
                    src={view.src}
                    alt={view.filename}
                    kind={view.kind}
                    poster={
                        item.encrypted
                            ? // An encrypted video has no thumbnail_url, so mediaViewerItem
                              // never asks for one: use the decrypted thumbnail_file tile.
                              view.kind === "video"
                                ? (decryptedThumbs[item.eventId] ?? null)
                                : null
                            : view.poster
                    }
                    filename={view.filename}
                    encryptedFile={
                        item.encrypted && item.kind === "video"
                            ? item.encryptedFile
                            : undefined
                    }
                    mimetype={item.mimetype}
                    sizeHint={item.size}
                    onClose={() => setViewerIndex(null)}
                    onPrev={viewerIndex > 0 ? () => step(-1) : undefined}
                    onNext={
                        viewerIndex < gallery.length - 1
                            ? () => step(1)
                            : undefined
                    }
                    position={galleryPositionLabel(
                        gallery.length,
                        viewerIndex,
                        hasMore,
                    )}
                />
            );
        // mediaViewerItem resolved to nothing (bad mxc / signed-out media
        // endpoint): without this branch the tile click set viewerIndex but
        // nothing rendered, so the click looked dead. Show a dismissable
        // notice instead of silently no-op'ing.
        return (
            <Portal>
                <View
                    className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
                    role="dialog"
                    accessibilityViewIsModal
                    accessibilityLabel={t(
                        "roomMediaPanel.mediaCouldNotBeLoaded",
                    )}
                >
                    <View className="bg-discord-backgroundSecondary rounded-lg p-6 max-w-sm shadow-lg">
                        <Text className="text-sm text-discord-textPrimary text-center mb-4">
                            {t("roomMediaPanel.couldNotLoadThisMedia")}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => setViewerIndex(null)}
                            className="self-center px-4 py-1.5 rounded bg-discord-accent active:opacity-90 transition-opacity"
                        >
                            <Text className="text-sm text-white">
                                {t("common.close")}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </Portal>
        );
    }

    return (
        <>
            <View
                className={`${
                    isMobile ? "" : "w-72"
                } h-full flex flex-col bg-discord-backgroundSecondary border-l border-discord-divider`}
            >
                <View className="h-12 flex-row items-center gap-2 px-4 py-3 border-b border-discord-divider flex-shrink-0">
                    <Text
                        accessibilityRole="header"
                        className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide flex-1"
                    >
                        {t("roomMediaPanel.media")}
                    </Text>
                    <Pressable
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel={t("roomMediaPanel.closeMediaPanel")}
                        hitSlop={8}
                        className="transition-colors"
                    >
                        <SvgIcon
                            d="M18.3 5.71 12 12.01l-6.3-6.3-1.42 1.42 6.3 6.3-6.3 6.3 1.42 1.42 6.3-6.3 6.3 6.3 1.42-1.42-6.3-6.3 6.3-6.3z"
                            className="w-4 h-4 text-discord-textMuted"
                        />
                    </Pressable>
                </View>

                <View
                    className="flex-row items-center gap-1 px-2 py-2 border-b border-discord-divider flex-shrink-0"
                    accessibilityRole="tablist"
                >
                    <Pressable
                        nativeID="room-media-tab-media"
                        accessibilityRole="tab"
                        accessibilityState={{ selected: tab === "media" }}
                        onPress={() => setTab("media")}
                        className={`flex-1 py-1 rounded transition-colors ${
                            tab === "media" ? "bg-discord-messageHover" : ""
                        }`}
                    >
                        <Text
                            className={`text-xs text-center ${
                                tab === "media"
                                    ? "text-discord-textPrimary"
                                    : "text-discord-textMuted"
                            }`}
                        >
                            {t("roomMediaPanel.media2", {
                                length: split.visual.length,
                                value: hasMore ? "+" : "",
                            })}
                        </Text>
                    </Pressable>
                    <Pressable
                        nativeID="room-media-tab-files"
                        accessibilityRole="tab"
                        accessibilityState={{ selected: tab === "files" }}
                        onPress={() => setTab("files")}
                        className={`flex-1 py-1 rounded transition-colors ${
                            tab === "files" ? "bg-discord-messageHover" : ""
                        }`}
                    >
                        <Text
                            className={`text-xs text-center ${
                                tab === "files"
                                    ? "text-discord-textPrimary"
                                    : "text-discord-textMuted"
                            }`}
                        >
                            {t("roomMediaPanel.files", {
                                length: split.files.length,
                                value: hasMore ? "+" : "",
                            })}
                        </Text>
                    </Pressable>
                </View>

                {/* Zami: the tabpanel is the list: the grid's rows (three tiles
                    each) or the files, with the loading, error and empty states
                    in its place when there's nothing to list. Keyed by tab, as a
                    FlatList can't change its column count in place. */}
                <FlatList
                    key={tab}
                    nativeID="room-media-tabpanel"
                    className="flex-1"
                    onLayout={(e) => setListWidth(e.nativeEvent.layout.width)}
                    data={listed ? visible : []}
                    keyExtractor={(media) => media.eventId}
                    numColumns={tab === "media" ? COLUMNS : 1}
                    // `p-2` around the grid (and the files), `gap-1` (and
                    // `space-y-1`) between them.
                    columnWrapperStyle={
                        tab === "media"
                            ? { gap: GAP, paddingHorizontal: PAD }
                            : undefined
                    }
                    ItemSeparatorComponent={RowGap}
                    ListHeaderComponent={listed ? GridPad : undefined}
                    extraData={[thumbFailed, decryptedThumbs, cell]}
                    renderItem={({ item }) =>
                        tab === "media" ? (
                            mediaTile(item)
                        ) : (
                            <View className="px-2">{fileRow(item)}</View>
                        )
                    }
                    onEndReached={onEndReached}
                    onEndReachedThreshold={0}
                    ListEmptyComponent={
                        loading ? (
                            <View className="flex-row justify-center mt-8">
                                <Spin className="w-5 h-5 border-2 border-discord-accent border-t-transparent rounded-full" />
                            </View>
                        ) : error ? (
                            <>
                                <Text className="text-sm text-discord-danger text-center mt-8 px-4">
                                    {error}
                                </Text>
                                <View className="px-2 pt-2">
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void pull(true)}
                                        className="w-full py-1.5"
                                    >
                                        <Text className="text-xs text-discord-accent text-center">
                                            {t("roomMediaPanel.tryAgain")}
                                        </Text>
                                    </Pressable>
                                </View>
                            </>
                        ) : (
                            <Text className="text-sm text-discord-textMuted text-center mt-8 px-4">
                                {emptyMessage}
                            </Text>
                        )
                    }
                    ListFooterComponent={
                        <>
                            {listed ? <GridPad /> : null}
                            {loadMoreError ? (
                                // Inline, not the full-panel error branch: whatever already
                                // loaded stays on screen and "Load more" can simply be retried.
                                <Text className="text-xs text-discord-danger text-center px-2 pb-1">
                                    {loadMoreError}
                                </Text>
                            ) : null}

                            {!loading && !error && hasMore ? (
                                <View className="px-2 pb-2">
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void pull(false)}
                                        disabled={loadingMore}
                                        accessibilityState={{
                                            disabled: loadingMore,
                                        }}
                                        className={`w-full py-1.5 ${
                                            loadingMore ? "opacity-50" : ""
                                        }`}
                                    >
                                        <Text className="text-xs text-discord-accent text-center">
                                            {loadingMore
                                                ? t("common.loading")
                                                : t("common.loadMore")}
                                        </Text>
                                    </Pressable>
                                </View>
                            ) : null}
                        </>
                    }
                />
            </View>

            {viewer()}
        </>
    );
}

function RowGap() {
    return <View className="h-1" />;
}

function GridPad() {
    return <View className="h-2" />;
}
