import { useEventListener } from "expo";
import { File as FsFile, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import {
    Fragment,
    useEffect,
    useEffectEvent,
    useState,
    type ReactNode,
} from "react";
import {
    Pressable,
    StyleSheet,
    Text,
    View,
    type ViewStyle,
} from "react-native";
import { Image, SvgIcon, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";
import {
    mxcToHttp,
    fetchAttachmentBlob,
    fetchDecryptedAttachmentBlob,
} from "$lib/matrix/client";
import { revokeLater, withExtension } from "$lib/utils/saveFile";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import {
    videoSource,
    videoPoster,
    formatMediaDuration,
    type EncryptedFileRef,
} from "$lib/utils/roomMedia";
import { safeAspectRatio, safeDimension } from "$lib/utils/mediaDimensions";
import { learnMediaSize, learnedMediaSize } from "$lib/utils/learnedMediaSize";
import { rememberVolume } from "$lib/actions/rememberVolume";
import {
    videoNeedsAuthedStream,
    STREAM_ENCRYPTED_MIN_BYTES,
} from "$lib/matrix/videoStream";
import MediaProgress from "$lib/components/ui/MediaProgress.svelte";
import type { DownloadProgress } from "$lib/utils/downloadProgress";

interface Props {
    /** An m.video event's content. */
    content: Record<string, unknown>;
    /** The original file name (MSC2530), shown on the play card. */
    filename: string;
}

export default function MessageVideo({ content, filename }: Props) {
    // Video: nothing is requested until the user clicks play, and then the
    // <video> element streams the media URL itself rather than us buffering the
    // whole file into a blob first. The service worker (static/sw.js) injects
    // the access token into every element-initiated request under
    // /_matrix/client/v1/media/, which is the same path every <img> in this
    // timeline already depends on, so a bare `src` is authenticated.
    //
    // Buffering first was actively harmful: continuwuity/tuwunel send no
    // Content-Length and ignore Range on a media download (verified: a ranged
    // request gets a plain 200 of the whole file), so a blob fetch has
    // no progress to report AND cannot start playback early — a 20 MB clip sat
    // on a bare spinner until every byte had landed, by which point the click's
    // user-activation window had expired, `autoplay` was refused, and the video
    // mounted paused on a black first frame. That reads as "it does not play".
    // Zami: AVPlayer (ExoPlayer on Android) streams the URL itself, with the
    // account's token in its request headers (see useAuthedVideoSrc below).
    const [videoAttempt, setVideoAttempt] = useState(0);
    const [videoFailed, setVideoFailed] = useState(false);
    const [videoThumbFailed, setVideoThumbFailed] = useState(false);
    // Video source and state
    const videoSrc = videoSource(content);
    const [encryptedVideoUrl, setEncryptedVideoUrl] = useState<string | null>(
        null,
    );
    const [videoDecrypting, setVideoDecrypting] = useState(false);
    const [videoDecryptFailed, setVideoDecryptFailed] = useState(false);
    const [videoDecryptAttempt, setVideoDecryptAttempt] = useState(0);
    const [videoPlayRequested, setVideoPlayRequested] = useState(false);
    // Encrypted video big enough to be worth playing while it downloads: the
    // bytes are decrypted on the fly instead of waiting for the whole file
    // (see videoStream.ts for what that does to integrity checking).
    // Zami: never, as React Native has no MediaSource (see playVideo).
    const [videoStreamEncrypted, setVideoStreamEncrypted] = useState(false);
    // True once the element has enough data to start; until then a streamed
    // video shows download progress over its black box.
    const [videoStreamReady, setVideoStreamReady] = useState(false);
    // A plain (unencrypted) stream that broke retries once as a full download.
    const [videoForceBlob, setVideoForceBlob] = useState(false);
    const [videoProgress, setVideoProgress] = useState<DownloadProgress | null>(
        null,
    );
    const videoSize = (() => {
        const size = (content?.info as Record<string, unknown> | undefined)
            ?.size;
        return typeof size === "number" && Number.isFinite(size) && size > 0
            ? size
            : null;
    })();
    const encryptedStreamUrl =
        videoStreamEncrypted && videoSrc?.kind === "encrypted"
            ? mxcToHttp(videoSrc.file.url)
            : null;

    // Without a controlling service worker (Tor Browser has none; a hard
    // reload starts uncontrolled) that bare `src` 401s, so the plain video is
    // instead streamed with the token through MediaSource (videoStream.ts).
    // Chosen up front when there's no worker, and as a one-shot retry when the
    // bare `src` fails anyway (a worker that hasn't received the token yet).
    const [videoUseStream, setVideoUseStream] = useState(false);
    const videoStreamUrl =
        videoUseStream && videoSrc?.kind === "plain"
            ? mxcToHttp(videoSrc.mxc)
            : null;
    const videoInfo = content?.info as Record<string, unknown> | undefined;
    const videoMimetype =
        typeof videoInfo?.mimetype === "string" ? videoInfo.mimetype : null;
    function onVideoError() {
        if (videoSrc?.kind === "plain" && !videoUseStream) {
            setVideoUseStream(true);
            setVideoAttempt((n) => n + 1);
            return;
        }
        if (videoStreamEncrypted) return fallBackToVerifiedDownload();
        onPlainStreamBroke();
    }

    // The MediaSource route can fail on a file the browser would still play
    // whole (e.g. an audio+video WebM whose blocks are not strictly ordered).
    // Try once more as a plain download before giving up.
    function onPlainStreamBroke() {
        if (videoUseStream && !videoForceBlob) {
            setVideoForceBlob(true);
            setVideoAttempt((n) => n + 1);
            return;
        }
        setVideoFailed(true);
    }

    // A streamed encrypted video that could not be played (hash mismatch at the
    // end, a network error, a codec MediaSource refuses) drops back to the
    // download-verify-play path, which either plays it or says it is corrupt.
    function fallBackToVerifiedDownload() {
        if (!videoStreamEncrypted) return;
        setVideoStreamEncrypted(false);
        setVideoStreamReady(false);
        setVideoPlayRequested(true);
        setVideoDecrypting(true);
    }

    // A played clip that is paused (or over) and scrolled well away is
    // unmounted, which frees its decoder's video memory; playing it again
    // picks up at `resumeAt`. See actions/parkOffscreen.
    // Zami: not ported: parking (parkOffscreen) and pausing (pauseOffscreen,
    // settingsState.pauseVideoOnScrollOff) a clip scrolled out of view, which
    // need an IntersectionObserver. The timeline's FlatList unmounts rows far
    // off screen, which releases their player.
    const [parked, setParked] = useState(false);

    function playVideo() {
        setParked(false);
        setVideoFailed(false);
        if (videoNeedsAuthedStream()) setVideoUseStream(true);
        setVideoAttempt((n) => n + 1);
        if (
            videoSrc?.kind === "encrypted" &&
            !encryptedVideoUrl &&
            videoSize !== null &&
            videoSize >= STREAM_ENCRYPTED_MIN_BYTES &&
            typeof MediaSource !== "undefined"
        ) {
            setVideoStreamEncrypted(true);
            setVideoStreamReady(false);
            setVideoProgress(null);
            return;
        }
        if (videoSrc?.kind === "encrypted") {
            setVideoPlayRequested(true);
            // Show the spinner from this frame on, not an empty <video> until
            // the decrypt effect runs. Only when there is no blob yet: a retry
            // after a playback error reuses the blob and the effect won't re-run.
            if (!encryptedVideoUrl) setVideoDecrypting(true);
        }
    }

    // Decrypt video when play is requested. Keyed on the ciphertext mxc, not
    // the `videoSrc` object: `content` re-derives on every timeline tick, and
    // a fresh object here would revoke the blob URL under a playing <video>.
    const encryptedVideoKey =
        videoSrc?.kind === "encrypted" ? videoSrc.file.url : null;
    useEffect(() => {
        if (encryptedVideoKey === null || !videoPlayRequested) return;
        // Depend on attempt counter for retry
        void videoDecryptAttempt;
        const src = videoSrc;
        if (src?.kind !== "encrypted") return;

        setVideoDecrypting(true);
        setVideoDecryptFailed(false);
        setVideoProgress(null);
        let capturedUrl: string | null = null;
        // A decrypt that resolves after cleanup (unmount, retry, new source)
        // must revoke its own URL instead of publishing it.
        let cancelled = false;
        const abort = new AbortController();

        fetchDecryptedAttachmentBlob(src.file, src.mimetype ?? undefined, {
            expectedSize: videoSize,
            signal: abort.signal,
            onProgress: (p) => {
                if (!cancelled) setVideoProgress(p);
            },
        })
            .then((url) => {
                if (cancelled) {
                    URL.revokeObjectURL(url);
                    return;
                }
                capturedUrl = url;
                setEncryptedVideoUrl(url);
                setVideoDecrypting(false);
            })
            .catch(() => {
                if (cancelled) return;
                setVideoDecrypting(false);
                setVideoDecryptFailed(true);
            });

        return () => {
            cancelled = true;
            abort.abort();
            if (capturedUrl) URL.revokeObjectURL(capturedUrl);
            setEncryptedVideoUrl(null);
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream untracks videoSrc and videoSize.
    }, [encryptedVideoKey, videoPlayRequested, videoDecryptAttempt]);

    /**
     * Save the video as sent. The element's own download control can't do it:
     * the player holds a MediaSource or blob URL, which mobile browsers fail to
     * save, so that control is hidden (`nodownload`) and this stands in.
     */
    async function downloadVideo() {
        // Zami: no shift+click quiet save.
        const src = videoSrc;
        if (!src) return;
        try {
            const blobUrl =
                src.kind === "encrypted"
                    ? (encryptedVideoUrl ??
                      (await fetchDecryptedAttachmentBlob(
                          src.file,
                          src.mimetype ?? undefined,
                      )))
                    : await fetchAttachmentBlob(mxcToHttp(src.mxc)!);
            try {
                await saveObjectUrl(
                    blobUrl,
                    filename || "video",
                    videoMimetype,
                );
            } finally {
                // The playing copy is owned by the decrypt effect.
                if (blobUrl !== encryptedVideoUrl) revokeLater(blobUrl);
            }
        } catch (err) {
            console.error("Failed to download video", err);
            showErrorToast("Failed to download video");
        }
    }

    function retryVideoDecrypt() {
        setVideoDecryptAttempt((n) => n + 1);
    }

    // Poster for the unplayed video body: decrypt encrypted thumbnail on mount,
    // or use plain mxcToHttp for unencrypted. Never the video's own url — see
    // comment in roomMedia.ts videoPoster.
    const posterSrc = videoPoster(content);
    const [encryptedPosterUrl, setEncryptedPosterUrl] = useState<string | null>(
        null,
    );
    const videoThumbnailUrl = !posterSrc
        ? null
        : posterSrc.kind === "plain"
          ? mxcToHttp(posterSrc.mxc)
          : encryptedPosterUrl;

    // Decrypt the encrypted poster on mount (a small thumbnail). Keyed on the
    // thumbnail's mxc for the same reason as the video decrypt above.
    const encryptedPosterKey =
        posterSrc?.kind === "encrypted" ? posterSrc.file.url : null;
    useEffect(() => {
        if (encryptedPosterKey === null) return;
        const src = posterSrc;
        if (src?.kind !== "encrypted") return;

        let capturedUrl: string | null = null;
        let cancelled = false;

        fetchDecryptedAttachmentBlob(src.file, src.mimetype ?? undefined)
            .then((url) => {
                if (cancelled) {
                    URL.revokeObjectURL(url);
                    return;
                }
                capturedUrl = url;
                setEncryptedPosterUrl(url);
            })
            .catch(() => {
                // No poster: the placeholder card below carries the play
                // affordance instead.
                if (!cancelled) setEncryptedPosterUrl(null);
            });

        return () => {
            cancelled = true;
            if (capturedUrl) URL.revokeObjectURL(capturedUrl);
            setEncryptedPosterUrl(null);
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream untracks posterSrc.
    }, [encryptedPosterKey]);
    // oxlint-disable-next-line typescript/no-explicit-any -- upstream's cast.
    const info = content?.info as any;
    const videoDuration = formatMediaDuration(info?.duration);
    // `info.w`/`info.h` come off the wire, so they are whatever the sender put
    // there — never interpolate them into style text raw (a crafted value
    // closes the declaration and adds its own). safeAspectRatio only ever
    // yields `<int> / <int>`.
    const videoAspectRatio = safeAspectRatio(info?.w, info?.h);
    // True only when the sender gave usable dimensions. When false,
    // `videoAspectRatio` is just the 16/9 fallback guess, so we prefer a
    // self-measured ratio (below) once the element reports one. Bridged
    // Discord/Twitter media (OOYE) routinely omits info.w/info.h.
    const videoHasDims =
        safeDimension(info?.w) !== null && safeDimension(info?.h) !== null;
    // Aspect ratio recovered from the played <video>'s own intrinsic size when
    // the sender omitted dims. `safeAspectRatio` keeps this to `<int> / <int>`,
    // and its inputs are the element's videoWidth/videoHeight — trusted browser
    // integers, never event content — so it is safe to put in `style`.
    // Starts from what this video measured earlier this session, so a row the
    // timeline mounts again keeps its shape.
    const videoSizeKey =
        ((content?.url ??
            (content?.file as { url?: unknown } | undefined)?.url) as
            | string
            | undefined) ?? null;
    const [measuredVideoAspect, setMeasuredVideoAspect] = useState<
        string | null
    >(() => {
        const s = learnedMediaSize(videoSizeKey);
        return s ? safeAspectRatio(s.width, s.height) : null;
    });
    // The aspect ratio the played/poster box is actually drawn at: the sender's
    // when they gave one, else the self-measured value once we have it, else the
    // 16/9 fallback.
    const effectiveVideoAspect = videoHasDims
        ? videoAspectRatio
        : (measuredVideoAspect ?? videoAspectRatio);
    // Recover the true aspect of a dimension-less video from its metadata, so a
    // bridged clip settles to its real shape once (gently, inside the bounded
    // box) instead of the browser's unbounded intrinsic-size jump. Ignored when
    // the sender's dims are present — those stay authoritative.
    function onVideoMetadata(videoWidth: number, videoHeight: number) {
        if (videoHasDims) return;
        if (videoWidth > 0 && videoHeight > 0) {
            learnMediaSize(videoSizeKey, videoWidth, videoHeight);
            setMeasuredVideoAspect(safeAspectRatio(videoWidth, videoHeight));
        }
    }
    // Zami: `aspect-ratio: <w> / <h>; max-height: 24rem;` as a style.
    const boxStyle: ViewStyle = {
        aspectRatio: ratioValue(effectiveVideoAspect),
        maxHeight: 384,
    };

    // The played box is drawn identically to the poster: same `aspect-ratio`
    // and `max-height`, plus object-contain and a black backdrop. Without an
    // explicit box the <video> sizes to its intrinsic dimensions, which (a)
    // jumps the box vs the poster on play and (b) lets a wide clip's
    // min-content width push past the column and overflow.
    function player(extraClass: string): ReactNode {
        return (
            <View className={`relative max-w-lg w-full ${extraClass}`}>
                <AuthedVideo
                    src={
                        videoSrc?.kind === "plain"
                            ? videoStreamUrl
                                ? undefined
                                : mxcToHttp(videoSrc.mxc)
                            : encryptedStreamUrl
                              ? undefined
                              : encryptedVideoUrl
                    }
                    authed={{
                        url: videoStreamUrl ?? encryptedStreamUrl,
                        mimetype: videoMimetype,
                        decrypt:
                            encryptedStreamUrl && videoSrc?.kind === "encrypted"
                                ? videoSrc.file
                                : undefined,
                        expectedSize: videoSize,
                        forceBlob: videoForceBlob,
                        onProgress: setVideoProgress,
                        onError: () =>
                            encryptedStreamUrl
                                ? fallBackToVerifiedDownload()
                                : onPlainStreamBroke(),
                    }}
                    className="w-full rounded-lg bg-black"
                    style={boxStyle}
                    onLoadedMetadata={onVideoMetadata}
                    onCanPlay={() => setVideoStreamReady(true)}
                    onError={onVideoError}
                />
                <Pressable
                    onPress={() => void downloadVideo()}
                    accessibilityRole="button"
                    accessibilityLabel={t("messageItem.download")}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 active:bg-black/70 transition-colors"
                >
                    <SvgIcon
                        d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"
                        className="w-4 h-4 text-white"
                    />
                </Pressable>
            </View>
        );
    }

    if (videoDecrypting)
        return (
            <MediaProgress
                label={t("messageItem.decryptingVideo")}
                progress={videoProgress}
            />
        );
    if (videoDecryptFailed)
        return (
            <View className="flex-row items-center gap-3 px-4 py-3 mt-1 max-w-sm w-full bg-discord-backgroundTertiary rounded-lg">
                <SvgIcon
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                    className="w-4 h-4 text-discord-danger"
                />
                <View className="flex-1 min-w-0">
                    <Text className="text-xs text-discord-danger">
                        {t("messageItem.couldnTDecryptVideo")}
                    </Text>
                </View>
                <Pressable
                    accessibilityRole="button"
                    className="px-2 py-1 bg-discord-backgroundSecondary active:bg-discord-messageHover rounded transition-colors"
                    onPress={retryVideoDecrypt}
                >
                    <Text className="text-xs font-medium text-discord-textPrimary">
                        {t("common.retry")}
                    </Text>
                </Pressable>
            </View>
        );
    if (videoSrc === null)
        // Nothing this client can play: a malformed url. Deliberately NOT
        // clickable — a play affordance that can never resolve a source is a
        // dead click, which is exactly how this gets reported as "videos
        // cannot be played at all".
        return (
            <View className="flex-row items-center gap-3 px-4 py-3 mt-1 max-w-sm w-full bg-discord-backgroundTertiary rounded-lg">
                <View className="w-10 h-10 rounded-full bg-discord-backgroundSecondary flex items-center justify-center flex-shrink-0">
                    <SvgIcon
                        d="M8 5v14l11-7z"
                        className="w-5 h-5 text-discord-textMuted"
                    />
                </View>
                <View className="min-w-0 flex-1">
                    <Text
                        numberOfLines={1}
                        className="text-sm font-medium text-discord-textPrimary"
                    >
                        {filename || t("messageItem.video")}
                    </Text>
                    <Text className="text-xs text-discord-textMuted">
                        {t("messageItem.canTBePlayedHere")}
                    </Text>
                </View>
            </View>
        );
    if (parked)
        // Drawn at the player's own size so the rows around it don't move.
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={filename || t("messageItem.video")}
                className="relative max-w-lg w-full mt-1 rounded-lg overflow-hidden bg-black"
                style={boxStyle}
                onPress={playVideo}
            >
                {videoThumbnailUrl && !videoThumbFailed ? (
                    <Image
                        source={mediaSource(videoThumbnailUrl)}
                        accessible={false}
                        className="w-full h-full"
                        contentFit="contain"
                        onError={() => setVideoThumbFailed(true)}
                    />
                ) : null}
                <View className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors">
                    <View className="w-14 h-14 rounded-full bg-black/60 flex items-center justify-center">
                        <SvgIcon
                            d="M8 5v14l11-7z"
                            className="w-7 h-7 text-white ms-1"
                        />
                    </View>
                </View>
            </Pressable>
        );
    if (videoAttempt > 0 && !videoFailed)
        // Keyed so a retry after a failure remounts the element: the src is
        // unchanged, so without this nothing would be patched and the player
        // would never re-attempt the load.
        return (
            <Fragment key={videoAttempt}>
                {encryptedStreamUrl ? (
                    <View className="relative max-w-lg w-full mt-1">
                        {player("")}
                        {!videoStreamReady ? (
                            // Streaming: the box stays black until the first
                            // seconds are in, so say how far the download is.
                            <View
                                pointerEvents="none"
                                className="absolute inset-x-2 bottom-2 flex-row justify-start"
                            >
                                <MediaProgress
                                    label={t("messageItem.decryptingVideo")}
                                    progress={videoProgress}
                                />
                            </View>
                        ) : null}
                    </View>
                ) : (
                    player("mt-1")
                )}
            </Fragment>
        );
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={filename || t("messageItem.video")}
            className="relative max-w-lg w-full mt-1 rounded-lg overflow-hidden bg-black"
            style={
                videoThumbnailUrl && !videoThumbFailed ? boxStyle : undefined
            }
            onPress={playVideo}
        >
            {videoThumbnailUrl && !videoThumbFailed ? (
                <>
                    <Image
                        source={mediaSource(videoThumbnailUrl)}
                        accessible={false}
                        className="w-full h-full"
                        contentFit="cover"
                        onError={() => setVideoThumbFailed(true)}
                    />
                    <View className="absolute inset-0 flex-col items-center justify-center bg-black/30 transition-colors">
                        <View className="w-14 h-14 rounded-full bg-black/60 flex items-center justify-center">
                            <SvgIcon
                                d="M8 5v14l11-7z"
                                className="w-7 h-7 text-white ms-1"
                            />
                        </View>
                        <View className="mt-2 px-2 py-1 rounded-full bg-black/60">
                            <Text
                                numberOfLines={1}
                                className="text-xs text-white font-medium text-center"
                            >
                                {filename}
                            </Text>
                        </View>
                    </View>
                </>
            ) : (
                // No sender-uploaded thumbnail: a deliberate neutral card
                // carrying the play affordance, the filename and the duration
                // when the sender gave one. Nothing is requested from the
                // server until it is clicked — asking /media/thumbnail for the
                // video itself would download the whole file (see
                // videoThumbnailUrl).
                <View className="flex-row items-center gap-3 px-4 py-3 bg-discord-backgroundTertiary transition-colors rounded-lg">
                    <View
                        className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                            videoFailed
                                ? "bg-discord-danger"
                                : "bg-discord-accent"
                        }`}
                    >
                        <SvgIcon
                            d="M8 5v14l11-7z"
                            className="w-5 h-5 text-white ms-0.5"
                        />
                    </View>
                    <View className="min-w-0 flex-1">
                        <Text
                            numberOfLines={1}
                            className="text-sm font-medium text-discord-textPrimary"
                        >
                            {filename || t("messageItem.video")}
                        </Text>
                        {/* A failed load has to SAY so. Silently dropping back
                            to "Click to play" is indistinguishable from the
                            click having done nothing at all. */}
                        <Text
                            className={`text-xs ${
                                videoFailed
                                    ? "text-discord-danger"
                                    : "text-discord-textMuted"
                            }`}
                        >
                            {videoFailed
                                ? t("messageItem.playbackFailedClickToRetry")
                                : videoDuration
                                  ? t("messageItem.clickToPlay", {
                                        videoDuration,
                                    })
                                  : t("messageItem.clickToPlay2")}
                        </Text>
                    </View>
                </View>
            )}
        </Pressable>
    );
}

/** Zami: a CSS `aspect-ratio` value (`<w> / <h>`, from safeAspectRatio) as a number. */
function ratioValue(ratio: string): number {
    const [w, h] = ratio.split("/").map((n) => Number(n.trim()));
    return w > 0 && h > 0 ? w / h : 16 / 9;
}

/** Zami: a URL as the player's source, with the headers mediaSource gives an
 *  authenticated Matrix media URL (what Zam's service worker adds). */
function videoSourceFor(url: string): VideoSource {
    const source = mediaSource(url);
    return source?.headers
        ? { uri: url, headers: source.headers }
        : { uri: url };
}

interface AuthedVideoSrcParams {
    url: string | null;
    mimetype?: string | null;
    onError?: (err: unknown) => void;
    decrypt?: EncryptedFileRef;
    expectedSize?: number | null;
    onProgress?: (p: DownloadProgress) => void;
    forceBlob?: boolean;
}

/**
 * Zami: the `authedVideoSrc` action, as the source it would give the element.
 * React Native has no MediaSource to stream through, and needs none: the
 * player streams the URL itself, with the account's token in its request
 * headers. A file that must be checked before it plays (an encrypted one, or
 * `forceBlob`) is downloaded whole, decrypted and verified, and played from its
 * object URL, as videoStream.ts's blob fallback does.
 */
function useAuthedVideoSrc({
    url,
    mimetype,
    onError,
    decrypt,
    expectedSize,
    onProgress,
    forceBlob,
}: AuthedVideoSrcParams): VideoSource | null {
    const whole = !!url && (!!forceBlob || !!decrypt);
    const [blob, setBlob] = useState<{ key: string; url: string } | null>(null);
    // The latest parameters, without restarting the download when a caller
    // passes a new object or callback for the same URL.
    const download = useEffectEvent(
        (httpUrl: string, signal: AbortSignal, live: () => boolean) => {
            const opts = {
                expectedSize,
                signal,
                onProgress: (p: DownloadProgress) => {
                    if (live()) onProgress?.(p);
                },
            };
            return decrypt
                ? fetchDecryptedAttachmentBlob(
                      decrypt,
                      mimetype ?? undefined,
                      opts,
                  )
                : fetchAttachmentBlob(httpUrl, opts);
        },
    );
    const fail = useEffectEvent((err: unknown) => onError?.(err));
    useEffect(() => {
        if (!url || !whole) return;
        let cancelled = false;
        let objectUrl: string | null = null;
        const abort = new AbortController();
        download(url, abort.signal, () => !cancelled)
            .then((u) => {
                if (cancelled) {
                    URL.revokeObjectURL(u);
                    return;
                }
                objectUrl = u;
                setBlob({ key: url, url: u });
            })
            .catch((err: unknown) => {
                if (!cancelled) fail(err);
            });
        return () => {
            cancelled = true;
            abort.abort();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setBlob(null);
        };
    }, [url, whole]);
    if (!url) return null;
    if (!whole) return videoSourceFor(url);
    return blob?.key === url ? { uri: blob.url } : null;
}

/** Zami: the `<video>` element: its bare `src`, or what `use:authedVideoSrc` feeds it. */
function AuthedVideo({
    src,
    authed,
    className,
    style,
    onLoadedMetadata,
    onCanPlay,
    onError,
}: {
    src: string | null | undefined;
    authed: AuthedVideoSrcParams;
    className: string;
    style: ViewStyle;
    onLoadedMetadata: (videoWidth: number, videoHeight: number) => void;
    onCanPlay: () => void;
    onError: () => void;
}) {
    const streamed = useAuthedVideoSrc(authed);
    const source = streamed ?? (src ? videoSourceFor(src) : null);
    const uri =
        source && typeof source === "object" ? (source.uri ?? null) : null;
    return (
        <View className={`overflow-hidden ${className}`} style={style}>
            {uri && source ? (
                <NativeVideo
                    key={uri}
                    source={source}
                    onLoadedMetadata={onLoadedMetadata}
                    onCanPlay={onCanPlay}
                    onError={onError}
                />
            ) : null}
        </View>
    );
}

/**
 * Zami: one player for one source, `autoplay` with native `controls` and
 * `use:rememberVolume`. Its `oncanplay`, `onerror` and `onloadedmetadata` are
 * the player's readyToPlay and error statuses and its first video track's size.
 */
function NativeVideo({
    source,
    onLoadedMetadata,
    onCanPlay,
    onError,
}: {
    source: VideoSource;
    onLoadedMetadata: (videoWidth: number, videoHeight: number) => void;
    onCanPlay: () => void;
    onError: () => void;
}) {
    const player = useVideoPlayer(source, (p) => p.play());
    useEffect(() => {
        // rememberVolume reads and writes an element's volume and mute, and
        // listens for its volumechange; the player stands in for the element.
        const subscriptions: { remove(): void }[] = [];
        const el = {
            get volume() {
                return player.volume;
            },
            set volume(v: number) {
                player.volume = v;
            },
            get muted() {
                return player.muted;
            },
            set muted(m: boolean) {
                player.muted = m;
            },
            addEventListener(_type: string, listener: () => void) {
                subscriptions.push(
                    player.addListener("volumeChange", listener),
                    player.addListener("mutedChange", listener),
                );
            },
            removeEventListener() {
                for (const s of subscriptions.splice(0)) s.remove();
            },
        } as unknown as HTMLMediaElement;
        return rememberVolume(el).destroy;
    }, [player]);
    useEventListener(player, "statusChange", ({ status }) => {
        if (status === "readyToPlay") onCanPlay();
        else if (status === "error") onError();
    });
    useEventListener(player, "sourceLoad", ({ availableVideoTracks }) => {
        const size = availableVideoTracks[0]?.size;
        if (size) onLoadedMetadata(size.width, size.height);
    });
    useEventListener(player, "videoTrackChange", ({ videoTrack }) => {
        if (videoTrack)
            onLoadedMetadata(videoTrack.size.width, videoTrack.size.height);
    });
    return (
        <VideoView
            player={player}
            nativeControls
            contentFit="contain"
            style={StyleSheet.absoluteFill}
        />
    );
}

/**
 * Zami: saveFile's `saveObjectUrl` clicks an `<a download>`. Here the file
 * behind the object URL (the Blob polyfill's `file://` URI) is copied under its
 * name into the cache and offered through the share sheet (Save Video, Save to
 * Files, AirDrop, …), then removed.
 */
async function saveObjectUrl(
    objectUrl: string,
    name: string,
    mimetype?: string | null,
): Promise<void> {
    const source = new FsFile(objectUrl);
    const type = mimetype || source.type || "";
    // The name comes from the event: keep it to one path segment.
    const safeName = withExtension(name, type)
        .replace(/[\\/:]/g, "_")
        .replace(/^\.+/, "_");
    const saved = new FsFile(Paths.cache, safeName || "video");
    if (saved.exists) saved.delete();
    await source.copy(saved);
    try {
        await Sharing.shareAsync(saved.uri, {
            mimeType: type || undefined,
            dialogTitle: safeName,
        });
    } finally {
        saved.delete();
    }
}
