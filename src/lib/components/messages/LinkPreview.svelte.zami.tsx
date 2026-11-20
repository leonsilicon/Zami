import type { VideoThumbnail } from "expo-video";
import {
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
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
import Animated, { FadeIn } from "react-native-reanimated";
import { Path } from "react-native-svg";
import { WebView } from "react-native-webview";
import {
    DomMount,
    Image,
    Pulse,
    SvgIcon,
    Video,
    mediaSource,
    openLink,
    videoFrameThumbnail,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { zamiHost } from "@-/com.leonsilicon.zami.plugins/host";
import { t } from "$lib/i18n";
import {
    getHomeserverBaseUrl,
    mxcToHttp,
    type UrlPreview,
} from "$lib/matrix/client";
import Lightbox from "$lib/components/ui/Lightbox.svelte";
import {
    isFavouriteGif,
    addFavouriteGif,
    removeFavouriteGif,
} from "$lib/stores/favourites.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";
import { isAuthedMediaUrl, thumbnailUrl } from "$lib/stores/mediaAuth.svelte";
import { rememberVolume } from "$lib/actions/rememberVolume";
import {
    allowsMediaAutoLoad,
    allowsThirdPartyEmbed,
} from "$lib/utils/linkPreviewPolicy";
import { isGifHostMediaUrl } from "$lib/utils/gifEmbed";
import {
    fetchLinkPreview,
    homeserverPreviewUrl,
    isGifSiteUrl,
} from "$lib/utils/linkPreviewFetch";
import { reservedMediaBox, safeDimension } from "$lib/utils/mediaDimensions";
import { learnMediaSize, learnedMediaSize } from "$lib/utils/learnedMediaSize";
import {
    fxStatusApiUrl,
    parseFxStatusResponse,
    type TweetEmbed,
} from "$lib/utils/tweetEmbed";
import TweetCard from "./TweetCard.svelte";
import { isInstagramUrl } from "$lib/utils/instagramUrl";
import { linkPreviewFavourite } from "$lib/utils/linkPreviewFavourite";
import { pluginRegistry } from "$lib/stores/plugins.svelte";
import { resolveEmbed, mountEmbed } from "$lib/plugins/embeds";
import {
    parseYoutubeUrl,
    youtubeWatchUrl,
    youtubeOembedUrl,
    parseOembedTitle,
    type YoutubeOembedMeta,
} from "$lib/utils/youtube";

// What each link resolved to this session. The timeline unmounts rows
// away from the viewport (utils/timelineWindow); a row mounted again
// shows its preview at once from here instead of growing from nothing
// when a fresh request comes back, which shoved the timeline on scroll.
type Resolved = {
    preview: UrlPreview | null;
    tweet: unknown;
    gifHostHeld: boolean;
};
const RESOLVED_MAX = 2000;
const resolvedPreviews = new Map<string, Resolved>();
function rememberPreview(key: string, r: Resolved) {
    resolvedPreviews.delete(key);
    if (resolvedPreviews.size >= RESOLVED_MAX) {
        resolvedPreviews.delete(resolvedPreviews.keys().next().value!);
    }
    resolvedPreviews.set(key, r);
}

// YouTube oEmbed titles per video id, null for a failed lookup so a broken
// link is not asked for again on every mount.
const YOUTUBE_OEMBED_MAX = 1000;
const youtubeOembeds = new Map<string, YoutubeOembedMeta | null>();
function rememberYoutubeOembed(id: string, meta: YoutubeOembedMeta | null) {
    youtubeOembeds.delete(id);
    if (youtubeOembeds.size >= YOUTUBE_OEMBED_MAX) {
        youtubeOembeds.delete(youtubeOembeds.keys().next().value!);
    }
    youtubeOembeds.set(id, meta);
}

interface Props {
    url: string;
}

const PLAY = "M8 5v14l11-7z";
const STAR =
    "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";
const EYE = [
    "M2.036 12.322a1 1 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178a1 1 0 010 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z",
    "M15 12a3 3 0 11-6 0 3 3 0 016 0z",
];

export default function LinkPreview({ url }: Props) {
    // The homeserver we would proxy media through. Read once: the app hard-
    // reloads on account switch, so this cannot go stale under us.
    const [hsBaseUrl] = useState(getHomeserverBaseUrl);
    const isTouchscreen = useRune(() => interfaceState.isTouchscreen);

    // "Load media" is remembered against the URL it was pressed for, NOT as a
    // bare boolean reset from an $effect: an effect that both reads the policy
    // and resets the flag would either loop or race the fetching effect, and a
    // lost race means the third-party request we are trying to prevent fires
    // anyway. Deriving it makes a URL change reset the reveal with no effect
    // at all.
    const [revealedFor, setRevealedFor] = useState<string | null>(null);
    const revealed = revealedFor === url;
    const linkPreviewMedia = useRune(() => settingsState.linkPreviewMedia);
    const policy = revealed ? ("all" as const) : linkPreviewMedia;
    const embedsAllowed = allowsThirdPartyEmbed(policy);

    // A plugin-registered custom embed for THIS url, if any. ADDITIVE: null → the
    // normal preview chain runs unchanged; the inbound message body/link is
    // rendered in MessageItem and never touched here (interop, spec §2). Reads the
    // registry tick so enabling/disabling an embed plugin re-derives live.
    const matchedEmbed = useRune(() => {
        void pluginRegistry.tick;
        return resolveEmbed(pluginRegistry.embeds, url);
    }, [url]);

    function canLoad(mediaUrl: string | null | undefined): boolean {
        return (
            allowsMediaAutoLoad(policy, mediaUrl, hsBaseUrl) ||
            (embedsAllowed && isGifHostMediaUrl(mediaUrl))
        );
    }

    const [preview, setPreview] = useState<UrlPreview | null>(null);
    // A request for this link is in flight: a placeholder the shape the
    // preview most likely takes holds its space meanwhile.
    const [pending, setPending] = useState(true);
    // A GIF-site link the homeserver couldn't preview, held back by the policy.
    const [gifHostHeld, setGifHostHeld] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    // Video previews load the poster first; the <video> is only mounted once
    // the user clicks play (mirrors uploaded m.video behaviour).
    const [videoPlaying, setVideoPlaying] = useState(false);
    const [videoThumbError, setVideoThumbError] = useState(false);

    type DirectEmbed =
        | {
              type: "youtube";
              embedUrl: string;
              watchUrl: string;
              short: boolean;
              start: number;
          }
        | { type: "video"; videoUrl: string };

    const [directEmbed, setDirectEmbed] = useState<DirectEmbed | null>(null);
    // Title and channel of the YouTube video, from oEmbed. Null until known
    // (and for good when the lookup fails): the preview works without it.
    const [youtubeTitle, setYoutubeTitle] = useState<YoutubeOembedMeta | null>(
        null,
    );

    // A YouTube embed shows its thumbnail until played: each player is a
    // whole YouTube page in its own frame (tens of MB before it plays, plus a
    // decoder after), and the timeline never unmounts rows. Once played and
    // then paused and scrolled well away it goes back to the thumbnail
    // (actions/parkYoutubeOffscreen) and resumes from where it was.
    const [youtubePlaying, setYoutubePlaying] = useState(false);
    const youtubeResumeAt = useRef(0);
    function youtubePlayerUrl(embedUrl: string): string {
        const u = new URL(embedUrl);
        u.searchParams.set("autoplay", "1");
        u.searchParams.set("enablejsapi", "1");
        if (/^https?:$/.test(location.protocol))
            u.searchParams.set("origin", location.origin);
        if (youtubeResumeAt.current > 0)
            u.searchParams.set(
                "start",
                String(Math.floor(youtubeResumeAt.current)),
            );
        return u.toString();
    }
    function youtubeThumbnail(embedUrl: string): string {
        const id = new URL(embedUrl).pathname.split("/").pop() ?? "";
        return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
    }

    const [tweetEmbed, setTweetEmbed] = useState<TweetEmbed | null>(null);

    // Reactively track favourite state — isFavouriteGif reads favouritesState.gifs ($state) so this auto-tracks
    const favourited = useRune(() => isFavouriteGif(url), [url]);

    function toggleFavourite() {
        // Zami: no stopPropagation; a nested Pressable takes the touch itself.
        if (isFavouriteGif(url)) {
            void removeFavouriteGif(url);
        } else {
            const entry = linkPreviewFavourite(url, preview, {
                gifSite: isGifSite,
            });
            if (entry) void addFavouriteGif(entry);
        }
    }

    function getYoutubeEmbedUrl(rawUrl: string): string | null {
        const yt = parseYoutubeUrl(rawUrl);
        return yt ? `https://www.youtube.com/embed/${yt.id}` : null;
    }

    // Zami: upstream's effect re-runs when the preview URL transforms change;
    // the registry's tick says when they have.
    const pluginTick = useRune(() => pluginRegistry.tick);

    // Zami: a layout effect, so a row the list mounts again draws a remembered
    // preview in its first frame, as Svelte's effect does before paint.
    useLayoutEffect(() => {
        const currentUrl = url;
        const allowEmbeds = embedsAllowed;
        setPreview(null);
        setPending(true);
        setGifHostHeld(false);
        setImageError(false);
        setDirectEmbed(null);
        setTweetEmbed(null);
        setVideoPlaying(false);
        setVideoParked(false);
        setVideoThumbError(false);
        setYoutubePlaying(false);
        youtubeResumeAt.current = 0;
        setYoutubeTitle(null);

        // A response that lands after the URL or the policy moved on must not
        // write itself back into state — otherwise flipping the setting to a
        // stricter value could be undone by the request it just cancelled.
        let cancelled = false;

        const yt = allowEmbeds ? parseYoutubeUrl(currentUrl) : null;
        if (yt) {
            const watchUrl = youtubeWatchUrl(yt.id);
            // The first play starts at the link's own offset (?t= / ?start=).
            youtubeResumeAt.current = yt.start;
            setDirectEmbed({
                type: "youtube",
                embedUrl: `https://www.youtube.com/embed/${yt.id}`,
                watchUrl,
                short: yt.short,
                start: yt.start,
            });
            setPending(false);

            // Title via oEmbed, behind the same consent as the embed above.
            // Cached per id, failures included.
            if (youtubeOembeds.has(yt.id)) {
                setYoutubeTitle(youtubeOembeds.get(yt.id) ?? null);
            } else {
                const id = yt.id;
                fetch(youtubeOembedUrl(watchUrl), {
                    referrerPolicy: "no-referrer",
                })
                    .then(async (r) =>
                        r.ok ? parseOembedTitle(await r.json()) : null,
                    )
                    .catch(() => null)
                    .then((meta) => {
                        rememberYoutubeOembed(id, meta);
                        if (!cancelled) setYoutubeTitle(meta);
                    });
            }
            return () => {
                cancelled = true;
            };
        }

        // Twitter/X: built from FxTwitter's status API (it sends CORS
        // headers; see utils/tweetEmbed). This is a request straight to a
        // third party, so it needs the same consent as the media itself.
        const twitterApiUrl = allowEmbeds ? fxStatusApiUrl(currentUrl) : null;
        if (twitterApiUrl) {
            const known = resolvedPreviews.get(twitterApiUrl);
            if (known) {
                setTweetEmbed(known.tweet as TweetEmbed | null);
                setPending(false);
                return;
            }
            fetch(twitterApiUrl, {
                headers: { Accept: "application/json" },
                referrerPolicy: "no-referrer",
            })
                .then((r) => r.json())
                .then((data: unknown) => {
                    if (cancelled) return;
                    const embed = parseFxStatusResponse(data);
                    if (!embed) return;
                    setTweetEmbed(embed);
                    rememberPreview(twitterApiUrl, {
                        preview: null,
                        tweet: embed,
                        gifHostHeld: false,
                    });
                })
                .catch((err) => {
                    if (cancelled) return;
                    console.error("Twitter preview fetch failed:", err);
                })
                .finally(() => {
                    if (!cancelled) setPending(false);
                });
            return () => {
                cancelled = true;
            };
        }

        // The homeserver's own preview endpoint, shared with the Discord
        // favourites import (utils/linkPreviewFetch). Only its MEDIA is gated.
        const previewUrl = homeserverPreviewUrl(currentUrl);
        const cacheKey = `${allowEmbeds ? 1 : 0} ${currentUrl} ${previewUrl}`;
        const known = resolvedPreviews.get(cacheKey);
        if (known) {
            setPreview(known.preview);
            setGifHostHeld(known.gifHostHeld);
            setPending(false);
            return;
        }
        fetchLinkPreview(currentUrl, allowEmbeds)
            .then((result) => {
                if (cancelled) return;
                setPreview(result.preview);
                setGifHostHeld(result.gifHostHeld);
                // fetchLinkPreview answers null for a failed request too, which
                // is worth asking again.
                if (result.preview || result.gifHostHeld) {
                    rememberPreview(cacheKey, {
                        preview: result.preview,
                        tweet: null,
                        gifHostHeld: result.gifHostHeld,
                    });
                }
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("URL preview fetch failed:", err);
            })
            .finally(() => {
                if (!cancelled) setPending(false);
            });

        return () => {
            cancelled = true;
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream's effect tracks the URL, the policy and the plugin transforms.
    }, [url, embedsAllowed, pluginTick]);

    // Whether the preview carries page metadata (title/description/site name) as
    // opposed to being a raw image or video with none.
    const hasMeta = !!(
        preview?.title ||
        preview?.description ||
        preview?.siteName
    );

    // Reserved display box (px) for preview images, from og:image:width/height
    // when the site supplies them. Rendered as the <img> width/height so the
    // browser holds the space before load and the image can't shove the timeline
    // on scroll. Null when dimensions are absent → markup keeps its CSS bounds.
    // Direct embed matches uploaded-image bounds (512×384); the card thumbnail
    // uses the narrower card column (max-w-full / max-h-72 ≈ 480×288).
    // Without og dims, the size the image loaded at earlier this session.
    // Zami: media here has no size of its own, so one that loads re-renders to
    // pick up the size it learned (`relearnSize`).
    const [, relearnSize] = useReducer((n: number) => n + 1, 0);
    const learnedImage = learnedMediaSize(preview?.imageUrl);
    const embedImageBox = reservedMediaBox(
        preview?.imageWidth ?? learnedImage?.width,
        preview?.imageHeight ?? learnedImage?.height,
        512,
        384,
    );
    // The homeserver's preview image is the site's full-size og:image, drawn
    // at most 512×384 here, so the server is asked for a thumbnail that size
    // (2× for high-DPI), animated where it can.
    const previewImageSrc = (() => {
        const src = preview?.imageUrl ?? null;
        return src && isAuthedMediaUrl(src)
            ? thumbnailUrl(src, 1024, 768, "scale")
            : src;
    })();

    // GIF-sharing sites (Tenor/Giphy/Klipy) have page metadata but should embed
    // inline. Their previews expose the animation as a *video* URL, which we play
    // back gif-style (muted, looped, no controls) so it behaves like a real GIF.
    // Zami: declared before the frame effect below, which reads it.
    const isGifSite = isGifSiteUrl(url);

    // A video preview with no poster used to mount its <video> unplayed to
    // show the first frame, which holds a decoder and buffered frames in
    // video memory for as long as the row exists. Its first frame is grabbed
    // once instead and shown on the play button; the <video> only mounts on
    // play (or if no frame could be had).
    // A played preview video that is paused and scrolled well away goes back
    // to its play button, freeing its decoder (actions/parkOffscreen), and
    // resumes from where it was.
    const [videoParked, setVideoParked] = useState(false);
    const videoResumeAt = useRef(0);

    const [videoFrame, setVideoFrame] = useState<VideoThumbnail | null>(null);
    const [videoFrameDone, setVideoFrameDone] = useState(false);
    // Size of the grabbed frame, for a video whose preview gave no dimensions
    // (the poster would otherwise be cropped into a guessed 16/9 box).
    const [frameSize, setFrameSize] = useState<{
        width: number;
        height: number;
    } | null>(null);
    const frameSrc = preview?.videoUrl;
    const needsFrame =
        !!frameSrc &&
        !isGifSite &&
        !canLoad(preview?.videoThumbnailUrl) &&
        canLoad(frameSrc);
    useLayoutEffect(() => {
        const src = frameSrc;
        setVideoFrame(null);
        setFrameSize(learnedMediaSize(src) ?? null);
        setVideoFrameDone(!needsFrame);
        if (!needsFrame || !src) return;
        let live = true;
        void videoFrameThumbnail(src, 1024, 768).then((frame) => {
            if (!live) return;
            setVideoFrame(frame);
            setVideoFrameDone(true);
        });
        return () => {
            live = false;
        };
    }, [frameSrc, needsFrame]);

    // In a card, an image the site gives no size for is drawn in a fixed
    // box the shape of the usual og:image (1200×630), so every such card is
    // the same size before and after it loads, and matches the placeholder.
    const cardImageBox = reservedMediaBox(
        preview?.imageWidth,
        preview?.imageHeight,
        480,
        288,
    );
    // Zami: `max-w-full h-auto max-h-72` at the box's width and height, else
    // `w-full max-w-[480px] aspect-[1200/630] bg-black/10`.
    const cardImageClass = cardImageBox ? "" : "w-full bg-black/10";
    const cardImageStyle: ViewStyle = cardImageBox
        ? boxStyle(cardImageBox)
        : { maxWidth: 480, aspectRatio: 1200 / 630 };

    // What the preview most likely is, for the placeholder: media on its own
    // for a link to a media file or a GIF site, otherwise a card.
    const likelyMedia = (() => {
        if (isGifSite) return true;
        try {
            return /\.(png|jpe?g|gif|webp|avif|mp4|webm|mov)$/i.test(
                new URL(url).pathname,
            );
        } catch {
            return false;
        }
    })();

    const isInstagram = isInstagramUrl(url);

    // A direct embed we declined to mount (YouTube/X) — known without fetching
    // anything, so the button can appear immediately.
    const blockedEmbed =
        !embedsAllowed &&
        (getYoutubeEmbedUrl(url) !== null || fxStatusApiUrl(url) !== null);
    // Preview media the policy suppressed. `preview` is homeserver-sourced, so
    // reading it here costs nothing.
    const blockedMedia =
        !!preview &&
        ((!!preview.videoUrl && !canLoad(preview.videoUrl)) ||
            (!!preview.imageUrl && !canLoad(preview.imageUrl)));
    const showReveal =
        !revealed && (blockedEmbed || blockedMedia || gifHostHeld);

    // Zami: the star button, which upstream writes out in both places it shows.
    // Touchscreens have no hover to reveal it on, so it stays visible there.
    function favouriteButton(): ReactNode {
        return (
            <Pressable
                onPress={toggleFavourite}
                accessibilityRole="button"
                accessibilityLabel={
                    favourited
                        ? t("common.removeFromFavourites")
                        : t("common.addToFavourites")
                }
                className={`absolute top-1.5 end-1.5 p-1 rounded-full bg-black/50 transition-opacity active:bg-black/70 ${
                    isTouchscreen
                        ? ""
                        : "opacity-0 group-hover/media:opacity-100"
                }`}
            >
                {favourited ? (
                    <SvgIcon d={STAR} className="w-4 h-4 text-zam-warning" />
                ) : (
                    <SvgIcon
                        d={STAR}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-4 h-4 text-white"
                    />
                )}
            </Pressable>
        );
    }

    // Zami: the play badge over a video's still (`w-14 h-14`, or the card's
    // `w-10 h-10`).
    function playBadge(small = false): ReactNode {
        return (
            <View
                className={`${small ? "w-10 h-10" : "w-14 h-14"} rounded-full bg-black/60 flex items-center justify-center`}
            >
                <SvgIcon
                    d={PLAY}
                    className={
                        small
                            ? "w-5 h-5 text-white ms-0.5"
                            : "w-7 h-7 text-white ms-1"
                    }
                />
            </View>
        );
    }

    function videoMedia(): ReactNode {
        if (!(preview?.videoUrl && canLoad(preview.videoUrl))) return null;
        const posterUrl = canLoad(preview.videoThumbnailUrl)
            ? preview.videoThumbnailUrl
            : (videoFrame ?? undefined);
        // Zami: `aspect-ratio` from the preview's video size (`videoAspect`:
        // else the grabbed frame's), in a `max-w-lg w-full` box no taller
        // than `max-height: 24rem`.
        // (A gif-style one is drawn at its own size, as the <video> is.)
        const videoW = safeDimension(preview.videoWidth ?? frameSize?.width);
        const videoH = safeDimension(preview.videoHeight ?? frameSize?.height);
        const videoSize =
            videoW && videoH ? { width: videoW, height: videoH } : null;
        return (
            <View
                className="relative group/media mt-1"
                style={
                    isGifSite
                        ? fitStyle(
                              videoSize ??
                                  learnedMediaSize(preview.videoUrl) ??
                                  null,
                              512,
                              384,
                          )
                        : fitStyle(videoSize, 512, 384, false)
                }
            >
                {isGifSite ? (
                    // GIF-sharing sites: play the video like a GIF — muted, looped,
                    // autoplaying, and with no controls so it can't be paused/seeked.
                    // `pointer-events-none` + no controls already make it unpausable
                    // by the user, so we do NOT re-play on pause: the only thing that
                    // pauses this element is the browser shedding load, and answering
                    // that with play() is an unterminating main-thread ping-pong.
                    // Zami: not ported: unloadOffscreen, which drops its src once
                    // the row is well out of view (an IntersectionObserver). The
                    // timeline's FlatList unmounts rows far off screen instead,
                    // which releases the player.
                    <Video
                        src={preview.videoUrl}
                        poster={posterUrl}
                        autoplay
                        muted
                        loop
                        className="w-full h-full rounded-lg"
                        onResize={(w, h) => {
                            // Zami: the <video>'s own size, which a remounted
                            // row reads back (learnedMediaSize above).
                            if (videoSize || learnedMediaSize(preview.videoUrl))
                                return;
                            learnMediaSize(preview.videoUrl, w, h);
                            relearnSize();
                        }}
                    />
                ) : videoPlaying ||
                  (!posterUrl && videoFrameDone && !videoParked) ||
                  videoThumbError ? (
                    // No usable thumbnail (or the user clicked play): show the video
                    // itself rather than a placeholder card.
                    // Zami: not ported: pauseOffscreen (settingsState.pauseVideoOnScrollOff)
                    // and parkOffscreen, which need an IntersectionObserver.
                    <Video
                        src={preview.videoUrl}
                        poster={posterUrl}
                        className="w-full h-full rounded-lg bg-black"
                        use={rememberVolume}
                        controls
                        autoplay={videoPlaying}
                        onLoadedMetadata={(player) => {
                            if (videoResumeAt.current > 0) {
                                player.currentTime = videoResumeAt.current;
                                videoResumeAt.current = 0;
                            }
                        }}
                    />
                ) : (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("linkPreview.playVideo")}
                        className="relative w-full h-full rounded-lg overflow-hidden bg-black"
                        onPress={() => setVideoPlaying(true)}
                    >
                        <Image
                            source={posterSource(posterUrl)}
                            accessible={false}
                            className="w-full h-full"
                            contentFit="cover"
                            onLoad={(e) => {
                                const { width, height } = e.source;
                                if (!width || !height) return;
                                if (preview?.videoThumbnailUrl === posterUrl)
                                    return;
                                setFrameSize({ width, height });
                                learnMediaSize(
                                    preview?.videoUrl,
                                    width,
                                    height,
                                );
                            }}
                            onError={() => setVideoThumbError(true)}
                        />
                        <View className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover/media:bg-black/40 transition-colors">
                            {playBadge()}
                        </View>
                    </Pressable>
                )}
                {favouriteButton()}
            </View>
        );
    }

    function body(): ReactNode {
        if (directEmbed?.type === "youtube")
            // Shorts are vertical, so they get a narrow 9:16 column. The title
            // sits under the player or thumbnail and stays put while it plays.
            return (
                <View
                    className={`mt-1 w-full ${
                        directEmbed.short
                            ? "max-w-[min(100%,18rem)]"
                            : "max-w-lg"
                    }`}
                >
                    {youtubePlaying ? (
                        // Zami: the <iframe> is a WebView. Not ported:
                        // parkYoutubeOffscreen (and pausing for
                        // pauseVideoOnScrollOff), which watch the player scroll
                        // out of view; the timeline's FlatList unmounts rows
                        // far off screen, which closes the player.
                        <View
                            accessibilityLabel={
                                youtubeTitle?.title ??
                                t("linkPreview.youtubeVideo")
                            }
                            className={`w-full ${
                                directEmbed.short
                                    ? "max-w-[min(100%,18rem)] aspect-[9/16]"
                                    : "max-w-lg aspect-video"
                            } rounded-lg overflow-hidden bg-black`}
                        >
                            <YoutubeFrame
                                src={youtubePlayerUrl(directEmbed.embedUrl)}
                                title={
                                    youtubeTitle?.title ??
                                    t("linkPreview.youtubeVideo")
                                }
                            />
                        </View>
                    ) : (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("linkPreview.playVideo")}
                            className={`group/media relative w-full ${
                                directEmbed.short
                                    ? "max-w-[min(100%,18rem)] aspect-[9/16]"
                                    : "max-w-lg aspect-video"
                            } rounded-lg overflow-hidden bg-black`}
                            onPress={() => setYoutubePlaying(true)}
                        >
                            <Image
                                source={mediaSource(
                                    youtubeThumbnail(directEmbed.embedUrl),
                                )}
                                accessible={false}
                                className="w-full h-full"
                                contentFit="cover"
                            />
                            <View className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover/media:bg-black/40 transition-colors">
                                {playBadge()}
                            </View>
                        </Pressable>
                    )}
                    {youtubeTitle ? (
                        <View className="mt-1.5 min-w-0">
                            <Text
                                accessibilityRole="link"
                                onPress={() => openLink(url)}
                                numberOfLines={2}
                                className="text-sm font-semibold text-zam-accent leading-snug"
                            >
                                {youtubeTitle.title}
                            </Text>
                            {youtubeTitle.author ? (
                                <Text
                                    numberOfLines={1}
                                    className="text-xs text-zam-textMuted mt-0.5"
                                >
                                    {youtubeTitle.author}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}
                </View>
            );
        if (directEmbed?.type === "video")
            // Zami: a 16:9 box, as the <video> has no size of its own here.
            return (
                <Video
                    src={directEmbed.videoUrl}
                    className="mt-1 w-full max-w-lg aspect-video rounded-lg bg-black"
                    use={rememberVolume}
                    controls
                />
            );
        if (tweetEmbed) return <TweetCard tweet={tweetEmbed} />;
        if (matchedEmbed)
            // Plugin custom embed: renders a nicer card for a matching URL. ADDITIVE
            // and host-sanitized — see src/lib/plugins/embeds.ts. Keyed so a change
            // of matched embed (plugin toggled/reordered) or url forces a re-mount.
            // Zami: the plugin builds DOM into the element (mountEmbed), which
            // DomView shows; Html's message text classes are the embed's.
            return (
                <DomMount
                    key={`${matchedEmbed.entryId}:${url}`}
                    className="mt-1"
                    textClassName="text-sm text-zam-textPrimary"
                    resolveMxc={mxcToHttp}
                    document={document}
                    mount={(el) =>
                        mountEmbed(el, { embed: matchedEmbed.value, url })
                            .destroy
                    }
                />
            );
        if (pending && !preview) {
            // Zami: `skeleton-delay` (space reserved at once, the placeholder
            // invisible for the first 500ms so a preview that resolves
            // quickly never flashes it) is Reanimated's `SKELETON_DELAY`.
            if (likelyMedia)
                return (
                    <Animated.View
                        entering={SKELETON_DELAY}
                        className="mt-1 w-full max-w-lg aspect-video rounded-lg bg-zam-backgroundSecondary"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                    />
                );
            // The card below with one line of title, two of description and
            // the fixed image box.
            // Zami: each line's box is its text's line height.
            return (
                <Animated.View
                    entering={SKELETON_DELAY}
                    className="mt-2"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    <View className="flex-row max-w-lg rounded overflow-hidden border border-zam-divider bg-zam-backgroundSecondary">
                        <View className="w-1 flex-shrink-0 bg-zam-divider" />
                        <View className="flex flex-1 min-w-0 flex-col p-3 gap-3">
                            <Pulse className="flex-1 min-w-0">
                                <View className="h-4 mb-0.5 justify-center">
                                    <View className="w-24 h-2.5 rounded bg-zam-divider" />
                                </View>
                                <View className="h-[19px] justify-center">
                                    <View className="w-3/5 h-3 rounded bg-zam-divider" />
                                </View>
                                <View className="mt-1">
                                    <View className="h-[19.5px] justify-center">
                                        <View className="w-full h-2.5 rounded bg-zam-divider" />
                                    </View>
                                    <View className="h-[19.5px] justify-center">
                                        <View className="w-4/5 h-2.5 rounded bg-zam-divider" />
                                    </View>
                                </View>
                            </Pulse>
                            <View
                                className="w-full rounded mt-1 bg-black/10"
                                style={{
                                    maxWidth: 480,
                                    aspectRatio: 1200 / 630,
                                }}
                            />
                        </View>
                    </View>
                </Animated.View>
            );
        }
        if (!preview) return null;
        if (isGifSite && preview.videoUrl && canLoad(preview.videoUrl))
            // GIF-sharing sites: bare inline gif-style video
            return videoMedia();
        if (preview.videoUrl && hasMeta && canLoad(preview.videoUrl))
            // Rich video card: title/description alongside an embedded player
            // (e.g. an fxtwitter/fixvx preview that carries og:video + og:title).
            return (
                <View className="mt-2">
                    <View className="flex-row max-w-lg rounded overflow-hidden border border-zam-divider bg-zam-backgroundSecondary">
                        {/* Left accent bar */}
                        <View className="w-1 flex-shrink-0 bg-zam-accent" />
                        <View className="flex flex-1 min-w-0 flex-col p-3 gap-2">
                            {preview.siteName ? (
                                <Text
                                    numberOfLines={1}
                                    className="text-xs text-zam-textMuted"
                                >
                                    {preview.siteName}
                                </Text>
                            ) : null}
                            {preview.title ? (
                                <Text
                                    accessibilityRole="link"
                                    onPress={() =>
                                        openLink(preview.canonicalUrl || url)
                                    }
                                    numberOfLines={2}
                                    className="text-sm font-semibold text-zam-accent leading-snug"
                                >
                                    {preview.title}
                                </Text>
                            ) : null}
                            {preview.description ? (
                                <Text
                                    numberOfLines={4}
                                    className="text-xs text-zam-textSecondary leading-relaxed"
                                >
                                    {preview.description}
                                </Text>
                            ) : null}
                            {videoMedia()}
                        </View>
                    </View>
                </View>
            );
        if (preview.videoUrl && canLoad(preview.videoUrl))
            // Direct video embed (no page metadata)
            return videoMedia();
        if (
            preview.imageUrl &&
            !imageError &&
            canLoad(preview.imageUrl) &&
            (!hasMeta || isGifSite)
        ) {
            const imageUrl = preview.imageUrl;
            // Direct image embed — same style as uploaded images
            return (
                <>
                    <View
                        className="relative group/media mt-1"
                        style={
                            embedImageBox
                                ? boxStyle(embedImageBox)
                                : // Zami: an image of no known size has
                                  // none here until it loads: it holds the
                                  // placeholder's 16:9 box meanwhile.
                                  fitStyle(null, 512, 384)
                        }
                    >
                        <Pressable
                            accessibilityRole="imagebutton"
                            onPress={() => setLightboxOpen(true)}
                            className="w-full h-full"
                        >
                            <Image
                                source={mediaSource(previewImageSrc)}
                                accessible={false}
                                className="w-full h-full rounded-lg"
                                contentFit="contain"
                                onError={() => setImageError(true)}
                                onLoad={(e) => {
                                    // Zami: learnImageSize reads the <img>'s
                                    // natural size; expo-image reports it.
                                    learnMediaSize(
                                        imageUrl,
                                        e.source.width,
                                        e.source.height,
                                    );
                                    if (!embedImageBox) relearnSize();
                                }}
                            />
                        </Pressable>
                        {favouriteButton()}
                    </View>
                    {lightboxOpen ? (
                        <Lightbox
                            src={imageUrl}
                            alt=""
                            favourite={{ url, previewUrl: imageUrl }}
                            onClose={() => setLightboxOpen(false)}
                        />
                    ) : null}
                </>
            );
        }
        if (hasMeta) {
            const imageUrl = preview.imageUrl;
            // Regular link preview card
            return (
                <View className="mt-2">
                    <Pressable
                        accessibilityRole="link"
                        onPress={() => openLink(preview.canonicalUrl || url)}
                        className="flex-row max-w-lg rounded overflow-hidden border border-zam-divider bg-zam-backgroundSecondary hover:bg-zam-messageHover transition-colors"
                    >
                        {/* Left accent bar */}
                        <View className="w-1 flex-shrink-0 bg-zam-accent" />

                        <View className="flex flex-1 min-w-0 flex-col p-3 gap-3">
                            {/* Text content */}
                            <View className="flex-1 min-w-0">
                                {preview.siteName ? (
                                    <Text
                                        numberOfLines={1}
                                        className="text-xs text-zam-textMuted mb-0.5"
                                    >
                                        {preview.siteName}
                                    </Text>
                                ) : null}
                                {preview.title ? (
                                    <Text
                                        numberOfLines={2}
                                        className="text-sm font-semibold text-zam-accent leading-snug"
                                    >
                                        {preview.title}
                                    </Text>
                                ) : null}
                                {preview.description ? (
                                    <Text
                                        numberOfLines={3}
                                        className="text-xs text-zam-textSecondary mt-1 leading-relaxed"
                                    >
                                        {preview.description}
                                    </Text>
                                ) : null}
                            </View>

                            {/* Preview image */}
                            {imageUrl && !imageError && canLoad(imageUrl) ? (
                                isInstagram ? (
                                    // w-fit + self-start so the wrapper shrink-wraps
                                    // the reserved-width thumbnail instead of stretching
                                    // to the flex column's full width; otherwise the
                                    // absolute play overlay would centre over empty card
                                    // space beside a narrow (portrait reel) poster.
                                    // Zami: the wrapper takes the image's box, and the
                                    // image fills it.
                                    <View
                                        className={`relative rounded mt-1 overflow-hidden ${cardImageClass} ${
                                            cardImageBox ? "self-start" : ""
                                        }`}
                                        style={cardImageStyle}
                                    >
                                        <Image
                                            source={mediaSource(
                                                previewImageSrc,
                                            )}
                                            accessibilityLabel={
                                                preview.title ?? ""
                                            }
                                            onError={() => setImageError(true)}
                                            onLoad={(e) =>
                                                learnMediaSize(
                                                    imageUrl,
                                                    e.source.width,
                                                    e.source.height,
                                                )
                                            }
                                            className="w-full h-full"
                                            contentFit="contain"
                                        />
                                        <View
                                            pointerEvents="none"
                                            className="absolute inset-0 flex items-center justify-center"
                                        >
                                            {playBadge(true)}
                                        </View>
                                    </View>
                                ) : (
                                    <Pressable
                                        accessibilityRole="imagebutton"
                                        accessibilityLabel={preview.title ?? ""}
                                        onPress={() => setLightboxOpen(true)}
                                        className={`rounded mt-1 overflow-hidden ${cardImageClass} ${
                                            cardImageBox ? "self-start" : ""
                                        }`}
                                        style={cardImageStyle}
                                    >
                                        <Image
                                            source={mediaSource(
                                                previewImageSrc,
                                            )}
                                            accessible={false}
                                            onError={() => setImageError(true)}
                                            onLoad={(e) =>
                                                learnMediaSize(
                                                    imageUrl,
                                                    e.source.width,
                                                    e.source.height,
                                                )
                                            }
                                            className="w-full h-full"
                                            contentFit="contain"
                                        />
                                    </Pressable>
                                )
                            ) : null}
                        </View>
                    </Pressable>
                    {lightboxOpen && imageUrl && canLoad(imageUrl) ? (
                        <Lightbox
                            src={imageUrl}
                            alt=""
                            onClose={() => setLightboxOpen(false)}
                        />
                    ) : null}
                </View>
            );
        }
        return null;
    }

    return (
        <>
            {body()}
            {showReveal ? (
                <Pressable
                    accessibilityRole="button"
                    onPress={() => setRevealedFor(url)}
                    className="mt-1 self-start flex-row items-center gap-1.5 rounded border border-zam-divider bg-zam-backgroundSecondary px-2 py-1 transition-colors hover:border-zam-accent/50"
                >
                    <SvgIcon
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-3.5 h-3.5 text-zam-textSecondary"
                    >
                        {EYE.map((d) => (
                            <Path key={d} d={d} />
                        ))}
                    </SvgIcon>
                    <Text className="text-xs text-zam-textSecondary">
                        {t("linkPreview.loadPreviewMedia")}
                    </Text>
                </Pressable>
            ) : null}
        </>
    );
}

/** Zami: `.skeleton-delay`'s `animation: skeleton-delay-in 150ms ease-out
 *  500ms backwards`, a fade in from transparent. */
const SKELETON_DELAY = FadeIn.duration(150).delay(500);

/** Zami: a box `width`×`height` px, as the `<img>`'s width/height attributes
 *  with `max-w-full h-auto`: no wider than the column, keeping its shape. */
function boxStyle(box: { width: number; height: number }): ViewStyle {
    return {
        width: box.width,
        maxWidth: "100%",
        aspectRatio: box.width / box.height,
    };
}

/**
 * Zami: media drawn at its own size within CSS bounds (`max-w-[min(100%,32rem)]
 * max-h-96`): as wide as the column allows, no wider than `maxW` or than fits
 * `maxH` at its shape, and (with `natural`) never past its own width. With no
 * size known, a 16:9 box.
 */
function fitStyle(
    size: { width: number; height: number } | null,
    maxW: number,
    maxH: number,
    natural = true,
): ViewStyle {
    if (!size) return { width: "100%", maxWidth: maxW, aspectRatio: 16 / 9 };
    const aspect = size.width / size.height;
    return {
        width: "100%",
        maxWidth: Math.min(maxW, maxH * aspect, natural ? size.width : maxW),
        aspectRatio: aspect,
    };
}

/** Zami: an image source for a poster: a URL, or a frame expo-video grabbed. */
function posterSource(poster: string | VideoThumbnail | null | undefined) {
    return typeof poster === "string" ? mediaSource(poster) : poster;
}

/** Zami: escapes text for an HTML attribute value. */
function escapeAttribute(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Zami: the YouTube `<iframe>` (`allow="accelerometer; autoplay;
 * clipboard-write; encrypted-media; gyroscope; picture-in-picture"
 * allowfullscreen`), in a WebView. YouTube's player refuses to play without
 * knowing who embeds it (the Referer), which a WebView loading the embed URL
 * itself doesn't say, so the frame sits in a page at the app's origin, the
 * `origin` youtubePlayerUrl names. Links out of the player open in the browser.
 */
function YoutubeFrame({ src, title }: { src: string; title: string }) {
    // Plugins' `zam.frames` rules for this player, read as it loads: a rule's
    // referrer is the page the frame sits in, and its script goes into every
    // frame of the WebView (the rule's URLs pick the frames it runs in).
    const rules = useMemo(() => zamiHost.frameRules?.(src) ?? {}, [src]);
    const pageUrl = rules.referrer ?? `${location.origin}/`;
    const html = useMemo(
        () =>
            `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe src="${escapeAttribute(src)}" title="${escapeAttribute(title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></body></html>`,
        [src, title],
    );
    return (
        <WebView
            source={{ html, baseUrl: pageUrl }}
            {...(rules.script !== undefined && {
                injectedJavaScript: rules.script,
                injectedJavaScriptForMainFrameOnly: false,
                // react-native-webview only injects into a WebView that
                // listens for messages.
                onMessage: () => {},
            })}
            originWhitelist={["*"]}
            allowsInlineMediaPlayback
            allowsFullscreenVideo
            allowsPictureInPictureMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            scrollEnabled={false}
            bounces={false}
            onShouldStartLoadWithRequest={(request) => {
                if (
                    !request.isTopFrame ||
                    request.url === pageUrl ||
                    request.url.startsWith("about:")
                )
                    return true;
                openLink(request.url);
                return false;
            }}
            onOpenWindow={(e) => openLink(e.nativeEvent.targetUrl)}
            style={styles.frame}
        />
    );
}

const styles = StyleSheet.create({
    frame: { flex: 1, backgroundColor: "black" },
});
