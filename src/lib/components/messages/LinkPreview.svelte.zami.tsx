import { useEventListener } from "expo";
import {
    createVideoPlayer,
    useVideoPlayer,
    VideoView,
    type VideoPlayer,
    type VideoSource,
    type VideoThumbnail,
} from "expo-video";
import {
    useEffect,
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
import { Path } from "react-native-svg";
import { WebView } from "react-native-webview";
import { useResolveClassNames } from "uniwind";
import {
    Image,
    Pulse,
    SvgIcon,
    mediaSource,
    openLink,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import {
    getUrlPreview,
    getHomeserverBaseUrl,
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
import {
    fetchGifEmbed,
    isGifHostLink,
    isGifHostMediaUrl,
} from "$lib/utils/gifEmbed";
import { reservedMediaBox, safeDimension } from "$lib/utils/mediaDimensions";
import { learnMediaSize, learnedMediaSize } from "$lib/utils/learnedMediaSize";
import { galleryNav, galleryPositionLabel } from "$lib/utils/mediaGallery";
import { isInstagramUrl } from "$lib/utils/instagramUrl";
import { linkPreviewFavourite } from "$lib/utils/linkPreviewFavourite";
import { pluginRegistry } from "$lib/stores/plugins.svelte";
import { resolveEmbed } from "$lib/plugins/embeds";
import { applyPreviewUrlTransforms } from "$lib/plugins/outgoingTransforms";

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
        | { type: "youtube"; embedUrl: string }
        | { type: "video"; videoUrl: string };

    const [directEmbed, setDirectEmbed] = useState<DirectEmbed | null>(null);

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

    interface TweetMedia {
        url: string;
        width?: number;
        height?: number;
        thumbnail?: string;
    }

    // Tweet videos, by URL, that the user has played. The rest show their
    // thumbnail: a mounted <video>, even unplayed, holds a decoder. A played
    // one that is paused and scrolled well away is unmounted again and
    // resumes from `tweetResumeAt` (actions/parkOffscreen).
    const [tweetPlaying, setTweetPlaying] = useState<Set<string>>(
        () => new Set(),
    );
    const [tweetResumeAt] = useState(() => new Map<string, number>());
    interface TweetEmbed {
        authorName: string;
        authorHandle: string;
        text: string;
        photos: TweetMedia[];
        videos: TweetMedia[];
    }

    const [tweetEmbed, setTweetEmbed] = useState<TweetEmbed | null>(null);
    const [lightboxTweetIndex, setLightboxTweetIndex] = useState<number | null>(
        null,
    );

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
        try {
            const u = new URL(rawUrl);
            const h = u.hostname.replace(/^www\./, "");
            if (h === "youtube.com" || h === "m.youtube.com") {
                const id = u.searchParams.get("v");
                if (id) return `https://www.youtube.com/embed/${id}`;
            }
            if (h === "youtu.be") {
                const id = u.pathname.slice(1).split("?")[0];
                if (id) return `https://www.youtube.com/embed/${id}`;
            }
        } catch {
            /* */
        }
        return null;
    }

    function getTwitterApiUrl(rawUrl: string): string | null {
        try {
            const u = new URL(rawUrl);
            const h = u.hostname.replace(/^www\./, "");
            if (h !== "x.com" && h !== "twitter.com") return null;
            // Path: /{user}/status/{id}
            const m = u.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
            if (!m) return null;
            return `https://api.fxtwitter.com/${m[1]}/status/${m[2]}`;
        } catch {
            /* */
        }
        return null;
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
        setLightboxTweetIndex(null);
        setVideoPlaying(false);
        setVideoParked(false);
        setVideoThumbError(false);
        setYoutubePlaying(false);
        youtubeResumeAt.current = 0;
        setTweetPlaying((s) => (s.size === 0 ? s : new Set()));
        tweetResumeAt.clear();

        // A response that lands after the URL or the policy moved on must not
        // write itself back into state — otherwise flipping the setting to a
        // stricter value could be undone by the request it just cancelled.
        let cancelled = false;

        const ytUrl = allowEmbeds ? getYoutubeEmbedUrl(currentUrl) : null;
        if (ytUrl) {
            setDirectEmbed({ type: "youtube", embedUrl: ytUrl });
            setPending(false);
            return;
        }

        // Twitter/X: use fxtwitter JSON API (has CORS headers). This is a
        // request straight to a third party, so it needs the same consent as
        // the media itself.
        const twitterApiUrl = allowEmbeds ? getTwitterApiUrl(currentUrl) : null;
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
                /* oxlint-disable typescript/no-explicit-any -- upstream's casts. */
                .then((data: any) => {
                    if (cancelled) return;
                    const tweet = data?.tweet;
                    if (!tweet) return;
                    const embed: TweetEmbed = {
                        authorName: tweet.author?.name ?? "",
                        authorHandle: tweet.author?.screen_name ?? "",
                        text: tweet.text ?? "",
                        // fxtwitter media objects carry width/height — keep them
                        // so the grid can reserve layout space before the image
                        // loads (otherwise it pops in and shoves the timeline).
                        photos: (tweet.media?.photos ?? []).map((p: any) => ({
                            url: p.url as string,
                            width: p.width as number | undefined,
                            height: p.height as number | undefined,
                        })),
                        videos: (tweet.media?.videos ?? []).map((v: any) => ({
                            url: v.url as string,
                            width: v.width as number | undefined,
                            height: v.height as number | undefined,
                            thumbnail: v.thumbnail_url as string | undefined,
                        })),
                    };
                    /* oxlint-enable typescript/no-explicit-any */
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

        // The homeserver's own preview endpoint — no third party is contacted,
        // so this runs under every policy. Only its MEDIA is gated, below.
        // Plugins may point the request elsewhere (a mirror the homeserver can
        // reach); the link shown and opened stays the original.
        const previewUrl = applyPreviewUrlTransforms(
            currentUrl,
            pluginRegistry.previewUrlTransforms.map((e) => e.value),
        );
        const cacheKey = `${allowEmbeds ? 1 : 0} ${currentUrl} ${previewUrl}`;
        const known = resolvedPreviews.get(cacheKey);
        if (known) {
            setPreview(known.preview);
            setGifHostHeld(known.gifHostHeld);
            setPending(false);
            return;
        }
        getUrlPreview(previewUrl)
            .then(async (data) => {
                if (cancelled) return;
                // Zami: what upstream writes to `preview` and `gifHostHeld`
                // and reads back below.
                let nextPreview: UrlPreview | null = null;
                let held = false;
                // GIF sites turn away most homeservers' previewers, so go to
                // the site when the homeserver came back without media. A
                // server that can preview these keeps serving its own copy.
                if (
                    isGifHostLink(currentUrl) &&
                    !data?.imageUrl &&
                    !data?.videoUrl
                ) {
                    if (allowEmbeds) {
                        const embed = await fetchGifEmbed(currentUrl).catch(
                            () => null,
                        );
                        if (cancelled) return;
                        if (embed) {
                            setPreview(embed);
                            rememberPreview(cacheKey, {
                                preview: embed,
                                tweet: null,
                                gifHostHeld: false,
                            });
                            return;
                        }
                    } else {
                        held = true;
                        setGifHostHeld(true);
                    }
                }
                if (data && (data.title || data.imageUrl || data.videoUrl)) {
                    nextPreview = data;
                    setPreview(data);
                }
                // getUrlPreview answers null for a failed request too, which
                // is worth asking again.
                if (nextPreview || held) {
                    rememberPreview(cacheKey, {
                        preview: nextPreview,
                        tweet: null,
                        gifHostHeld: held,
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
    const isGifSite = (() => {
        try {
            // Match on the registrable domain's second-level label so that
            // e.g. `media.tenor.com` counts but `tenor.com.evil.example` does not.
            const labels = new URL(url).hostname.split(".");
            const sld = labels[labels.length - 2];
            return sld === "tenor" || sld === "giphy" || sld === "klipy";
        } catch {
            return false;
        }
    })();

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
    const frameSrc = preview?.videoUrl;
    const needsFrame =
        !!frameSrc &&
        !isGifSite &&
        !canLoad(preview?.videoThumbnailUrl) &&
        canLoad(frameSrc);
    useLayoutEffect(() => {
        const src = frameSrc;
        setVideoFrame(null);
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
        (getYoutubeEmbedUrl(url) !== null || getTwitterApiUrl(url) !== null);
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
                    <SvgIcon
                        d={STAR}
                        className="w-4 h-4 text-discord-warning"
                    />
                ) : (
                    <OutlineIcon
                        paths={[STAR]}
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
        // Zami: `aspect-ratio` from the preview's video size, in a
        // `max-w-lg w-full` box no taller than `max-height: 24rem`.
        // (A gif-style one is drawn at its own size, as the <video> is.)
        const videoW = safeDimension(preview.videoWidth);
        const videoH = safeDimension(preview.videoHeight);
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
                        onSize={(w, h) => {
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
                        rememberVolume
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
        if (directEmbed?.type === "youtube" && youtubePlaying)
            // Zami: the <iframe> is a WebView. Not ported: parkYoutubeOffscreen
            // (and pausing for pauseVideoOnScrollOff), which watch the player
            // scroll out of view; the timeline's FlatList unmounts rows far
            // off screen, which closes the player.
            return (
                <View
                    accessibilityLabel={t("linkPreview.youtubeVideo")}
                    className="mt-1 w-full max-w-lg aspect-video rounded-lg overflow-hidden bg-black"
                >
                    <YoutubeFrame
                        src={youtubePlayerUrl(directEmbed.embedUrl)}
                        title={t("linkPreview.youtubeVideo")}
                    />
                </View>
            );
        if (directEmbed?.type === "youtube")
            return (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("linkPreview.playVideo")}
                    className="group/media mt-1 relative w-full max-w-lg aspect-video rounded-lg overflow-hidden bg-black"
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
            );
        if (directEmbed?.type === "video")
            // Zami: a 16:9 box, as the <video> has no size of its own here.
            return (
                <Video
                    src={directEmbed.videoUrl}
                    className="mt-1 w-full max-w-lg aspect-video rounded-lg bg-black"
                    rememberVolume
                    controls
                />
            );
        if (tweetEmbed) {
            // Twitter/X card built from fxtwitter API
            const allMedia =
                tweetEmbed.videos.length > 0 || tweetEmbed.photos.length > 0
                    ? [
                          ...tweetEmbed.videos.map((v) => ({
                              type: "video" as const,
                              photoIndex: -1,
                              ...v,
                          })),
                          ...tweetEmbed.photos.map((p, pi) => ({
                              type: "photo" as const,
                              photoIndex: pi,
                              ...p,
                          })),
                      ]
                    : [];
            // Zami: the grid's `repeat(min(n, 2), minmax(0, 1fr))` columns,
            // as rows of equal cells.
            const columns = Math.min(allMedia.length, 2);
            const rows: (typeof allMedia)[] = [];
            for (let i = 0; i < allMedia.length; i += columns)
                rows.push(allMedia.slice(i, i + columns));
            const lightbox = (() => {
                if (lightboxTweetIndex === null) return null;
                const photo = tweetEmbed.photos[lightboxTweetIndex];
                const nav = galleryNav(
                    tweetEmbed.photos.length,
                    lightboxTweetIndex,
                );
                const prev = nav.prevIndex;
                const next = nav.nextIndex;
                if (!photo) return null;
                return (
                    <Lightbox
                        src={photo.url}
                        alt=""
                        onClose={() => setLightboxTweetIndex(null)}
                        onPrev={
                            prev !== null
                                ? () => setLightboxTweetIndex(prev)
                                : undefined
                        }
                        onNext={
                            next !== null
                                ? () => setLightboxTweetIndex(next)
                                : undefined
                        }
                        position={galleryPositionLabel(
                            tweetEmbed.photos.length,
                            lightboxTweetIndex,
                        )}
                    />
                );
            })();
            return (
                <View className="mt-2">
                    <Pressable
                        accessibilityRole="link"
                        onPress={() => openLink(url)}
                        className="flex-row max-w-lg rounded overflow-hidden border border-discord-divider bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors"
                    >
                        {/* Left accent bar */}
                        <View className="w-1 flex-shrink-0 bg-discord-accent" />

                        <View className="flex flex-1 min-w-0 flex-col p-3 gap-2">
                            {/* Author */}
                            <View className="flex flex-col min-w-0">
                                <Text className="text-xs text-discord-textMuted mb-0.5">
                                    {t("linkPreview.xTwitter")}
                                </Text>
                                <Text className="text-sm font-semibold text-discord-accent leading-snug">
                                    {tweetEmbed.authorName}{" "}
                                    <Text className="text-sm font-normal text-discord-textMuted">
                                        @{tweetEmbed.authorHandle}
                                    </Text>
                                </Text>
                                {tweetEmbed.text ? (
                                    <Text
                                        numberOfLines={4}
                                        className="text-xs text-discord-textSecondary mt-1 leading-relaxed"
                                    >
                                        {tweetEmbed.text}
                                    </Text>
                                ) : null}
                            </View>

                            {/* Media grid */}
                            {allMedia.length > 0 ? (
                                <View className="gap-1 rounded overflow-hidden">
                                    {rows.map((row, ri) => (
                                        <View
                                            key={ri}
                                            className="flex-row gap-1"
                                        >
                                            {row.map((item, ci) => {
                                                // width/height reserve the box before load (from the
                                                // fxtwitter media dims); w-full/h-auto keep it
                                                // responsive within the grid cell.
                                                const box = reservedMediaBox(
                                                    item.width,
                                                    item.height,
                                                    512,
                                                    512,
                                                );
                                                // Zami: a cell's shape: the box's, or 16:9
                                                // (h-auto has nothing to go on before load).
                                                const cellStyle: ViewStyle = {
                                                    aspectRatio: box
                                                        ? box.width / box.height
                                                        : 16 / 9,
                                                    maxHeight: 288,
                                                };
                                                return (
                                                    <View
                                                        key={ci}
                                                        className="flex-1 min-w-0"
                                                    >
                                                        {item.type ===
                                                            "video" &&
                                                        !tweetPlaying.has(
                                                            item.url,
                                                        ) ? (
                                                            <Pressable
                                                                accessibilityRole="button"
                                                                accessibilityLabel={t(
                                                                    "linkPreview.playVideo",
                                                                )}
                                                                className="group/media relative w-full min-w-0 rounded overflow-hidden bg-black"
                                                                style={
                                                                    cellStyle
                                                                }
                                                                onPress={() => {
                                                                    // Zami: a nested Pressable doesn't follow
                                                                    // the enclosing link.
                                                                    setTweetPlaying(
                                                                        (s) =>
                                                                            new Set(
                                                                                s,
                                                                            ).add(
                                                                                item.url,
                                                                            ),
                                                                    );
                                                                }}
                                                            >
                                                                {item.thumbnail ? (
                                                                    <Image
                                                                        source={mediaSource(
                                                                            item.thumbnail,
                                                                        )}
                                                                        accessible={
                                                                            false
                                                                        }
                                                                        className="w-full h-full"
                                                                        contentFit="contain"
                                                                    />
                                                                ) : null}
                                                                <View className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover/media:bg-black/40 transition-colors">
                                                                    {playBadge()}
                                                                </View>
                                                            </Pressable>
                                                        ) : item.type ===
                                                          "video" ? (
                                                            // Zami: not ported: pauseOffscreen and
                                                            // parkOffscreen (IntersectionObserver).
                                                            // The native controls pause and play it.
                                                            <Video
                                                                src={item.url}
                                                                className="w-full min-w-0 rounded bg-black"
                                                                style={
                                                                    cellStyle
                                                                }
                                                                rememberVolume
                                                                controls
                                                                autoplay
                                                                onLoadedMetadata={(
                                                                    player,
                                                                ) => {
                                                                    const at =
                                                                        tweetResumeAt.get(
                                                                            item.url,
                                                                        );
                                                                    if (at) {
                                                                        player.currentTime =
                                                                            at;
                                                                        tweetResumeAt.delete(
                                                                            item.url,
                                                                        );
                                                                    }
                                                                }}
                                                            />
                                                        ) : (
                                                            <Pressable
                                                                accessibilityRole="imagebutton"
                                                                onPress={() =>
                                                                    setLightboxTweetIndex(
                                                                        item.photoIndex,
                                                                    )
                                                                }
                                                                className="w-full min-w-0 rounded overflow-hidden bg-black/10"
                                                                style={
                                                                    cellStyle
                                                                }
                                                            >
                                                                <Image
                                                                    source={mediaSource(
                                                                        item.url,
                                                                    )}
                                                                    accessible={
                                                                        false
                                                                    }
                                                                    className="w-full h-full"
                                                                    contentFit="contain"
                                                                />
                                                            </Pressable>
                                                        )}
                                                    </View>
                                                );
                                            })}
                                            {row.length < columns ? (
                                                <View className="flex-1" />
                                            ) : null}
                                        </View>
                                    ))}
                                </View>
                            ) : null}
                        </View>
                    </Pressable>
                    {lightbox}
                </View>
            );
        }
        if (matchedEmbed)
            // Plugin custom embed: renders a nicer card for a matching URL. ADDITIVE
            // and host-sanitized — see src/lib/plugins/embeds.ts. Keyed so a change
            // of matched embed (plugin toggled/reordered) or url forces a re-mount.
            // Zami: not ported: the embed itself. mountEmbed hands the plugin's
            // render an HTMLElement to build DOM into, and React Native has none.
            return (
                <View key={`${matchedEmbed.entryId}:${url}`} className="mt-1" />
            );
        if (pending && !preview) {
            if (likelyMedia)
                return (
                    <View
                        className="mt-1 w-full max-w-lg aspect-video rounded-lg bg-discord-backgroundSecondary"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                    />
                );
            // The card below with one line of title, two of description and
            // the fixed image box.
            // Zami: each line's box is its text's line height.
            return (
                <View
                    className="mt-2"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    <View className="flex-row max-w-lg rounded overflow-hidden border border-discord-divider bg-discord-backgroundSecondary">
                        <View className="w-1 flex-shrink-0 bg-discord-divider" />
                        <View className="flex flex-1 min-w-0 flex-col p-3 gap-3">
                            <Pulse className="flex-1 min-w-0">
                                <View className="h-4 mb-0.5 justify-center">
                                    <View className="w-24 h-2.5 rounded bg-discord-divider" />
                                </View>
                                <View className="h-[19px] justify-center">
                                    <View className="w-3/5 h-3 rounded bg-discord-divider" />
                                </View>
                                <View className="mt-1">
                                    <View className="h-[19.5px] justify-center">
                                        <View className="w-full h-2.5 rounded bg-discord-divider" />
                                    </View>
                                    <View className="h-[19.5px] justify-center">
                                        <View className="w-4/5 h-2.5 rounded bg-discord-divider" />
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
                </View>
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
                    <View className="flex-row max-w-lg rounded overflow-hidden border border-discord-divider bg-discord-backgroundSecondary">
                        {/* Left accent bar */}
                        <View className="w-1 flex-shrink-0 bg-discord-accent" />
                        <View className="flex flex-1 min-w-0 flex-col p-3 gap-2">
                            {preview.siteName ? (
                                <Text
                                    numberOfLines={1}
                                    className="text-xs text-discord-textMuted"
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
                                    className="text-sm font-semibold text-discord-accent leading-snug"
                                >
                                    {preview.title}
                                </Text>
                            ) : null}
                            {preview.description ? (
                                <Text
                                    numberOfLines={4}
                                    className="text-xs text-discord-textSecondary leading-relaxed"
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
                        className="flex-row max-w-lg rounded overflow-hidden border border-discord-divider bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors"
                    >
                        {/* Left accent bar */}
                        <View className="w-1 flex-shrink-0 bg-discord-accent" />

                        <View className="flex flex-1 min-w-0 flex-col p-3 gap-3">
                            {/* Text content */}
                            <View className="flex-1 min-w-0">
                                {preview.siteName ? (
                                    <Text
                                        numberOfLines={1}
                                        className="text-xs text-discord-textMuted mb-0.5"
                                    >
                                        {preview.siteName}
                                    </Text>
                                ) : null}
                                {preview.title ? (
                                    <Text
                                        numberOfLines={2}
                                        className="text-sm font-semibold text-discord-accent leading-snug"
                                    >
                                        {preview.title}
                                    </Text>
                                ) : null}
                                {preview.description ? (
                                    <Text
                                        numberOfLines={3}
                                        className="text-xs text-discord-textSecondary mt-1 leading-relaxed"
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
                    className="mt-1 self-start flex-row items-center gap-1.5 rounded border border-discord-divider bg-discord-backgroundSecondary px-2 py-1 transition-colors hover:border-discord-accent/50"
                >
                    <OutlineIcon
                        paths={EYE}
                        className="w-3.5 h-3.5 text-discord-textSecondary"
                    />
                    <Text className="text-xs text-discord-textSecondary">
                        {t("linkPreview.loadPreviewMedia")}
                    </Text>
                </Pressable>
            ) : null}
        </>
    );
}

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

/** Zami: Zam's stroked inline icons (`<svg fill="none" stroke="currentColor"
 *  stroke-width="2">` with round caps), through the shared SvgIcon, stroked in
 *  the text color of `className` (the button's, which the icon inherits). */
function OutlineIcon({
    paths,
    className,
}: {
    paths: readonly string[];
    className: string;
}) {
    const { color } = useResolveClassNames(className);
    return (
        <SvgIcon className={className}>
            {paths.map((d) => (
                <Path
                    key={d}
                    d={d}
                    fill="none"
                    stroke={color ?? "white"}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            ))}
        </SvgIcon>
    );
}

/** Zami: a URL as the player's source, with the headers mediaSource gives an
 *  authenticated Matrix media URL (what Zam's service worker adds). */
function videoSourceFor(url: string): VideoSource {
    const source = mediaSource(url);
    return source?.headers
        ? { uri: url, headers: source.headers }
        : { uri: url };
}

// Zami: mediaAuth's videoFrameUrl draws a video's first frame through a
// <video> and a <canvas>. expo-video grabs it natively instead: a player made
// for the source is asked, once it has loaded, for the frame at 0 s fitted in
// the box, and released. Kept like videoFrameUrl's cache (the latest 50, by box
// and URL), so a row mounted again shows it at once.
const FRAMES_MAX = 50;
const FRAME_TIMEOUT_MS = 15_000;
const frames = new Map<string, Promise<VideoThumbnail | null>>();

function videoFrameThumbnail(
    src: string,
    maxW: number,
    maxH: number,
): Promise<VideoThumbnail | null> {
    const key = `${maxW}x${maxH} ${src}`;
    const known = frames.get(key);
    if (known) {
        frames.delete(key);
        frames.set(key, known);
        return known;
    }
    const player = createVideoPlayer(videoSourceFor(src));
    player.muted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = Promise.race([
        new Promise<void>((resolve, reject) => {
            if (player.status === "readyToPlay") return resolve();
            const sub = player.addListener("statusChange", ({ status }) => {
                if (status === "readyToPlay") {
                    sub.remove();
                    resolve();
                } else if (status === "error") {
                    sub.remove();
                    reject(new Error("video failed to load"));
                }
            });
        })
            .then(() =>
                player.generateThumbnailsAsync(0, {
                    maxWidth: maxW,
                    maxHeight: maxH,
                }),
            )
            .then((thumbs) => thumbs[0] ?? null),
        new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), FRAME_TIMEOUT_MS);
        }),
    ])
        .catch(() => null)
        .then((thumb) => {
            clearTimeout(timer);
            player.release();
            // Only a frame is remembered; a failure is tried again next time.
            if (!thumb) frames.delete(key);
            return thumb;
        });
    if (frames.size >= FRAMES_MAX) frames.delete(frames.keys().next().value!);
    frames.set(key, frame);
    return frame;
}

interface VideoProps {
    src: string;
    /** Shown over the player until its first frame. */
    poster?: string | VideoThumbnail | null;
    controls?: boolean;
    autoplay?: boolean;
    muted?: boolean;
    loop?: boolean;
    /** `use:rememberVolume`. */
    rememberVolume?: boolean;
    /** The element's classes, on the box the player fills. */
    className?: string;
    style?: ViewStyle;
    /** `onloadedmetadata`, with the player to seek. */
    onLoadedMetadata?: (player: VideoPlayer) => void;
    /** The video's own size, once its track is known. */
    onSize?: (width: number, height: number) => void;
}

/**
 * Zami: a `<video>`: one expo-video player for `src`, filling the box that
 * `className` and `style` lay out (object-contain), with `poster` over it until
 * its first frame. Without `controls` it takes no touches, as upstream's
 * gif-style `pointer-events-none` one.
 */
function Video({
    src,
    poster,
    controls = false,
    autoplay = false,
    muted = false,
    loop = false,
    rememberVolume: remember = false,
    className = "",
    style,
    onLoadedMetadata,
    onSize,
}: VideoProps) {
    const source = useMemo(() => videoSourceFor(src), [src]);
    const player = useVideoPlayer(source, (p) => {
        p.muted = muted;
        p.loop = loop;
        if (autoplay) p.play();
    });
    useEffect(() => {
        if (!remember) return;
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
    }, [player, remember]);
    useEventListener(player, "sourceLoad", ({ availableVideoTracks }) => {
        onLoadedMetadata?.(player);
        const size = availableVideoTracks[0]?.size;
        if (size) onSize?.(size.width, size.height);
    });
    const [firstFrame, setFirstFrame] = useState(false);
    return (
        <View
            className={`overflow-hidden ${className}`}
            style={style}
            pointerEvents={controls ? "auto" : "none"}
            // A tap on the controls is the player's: it doesn't press an
            // enclosing link (upstream's preventDefault on the click).
            onStartShouldSetResponder={() => controls}
        >
            <VideoView
                player={player}
                nativeControls={controls}
                contentFit="contain"
                onFirstFrameRender={() => setFirstFrame(true)}
                style={StyleSheet.absoluteFill}
            />
            {poster && !firstFrame ? (
                <Image
                    source={posterSource(poster)}
                    accessible={false}
                    pointerEvents="none"
                    contentFit="contain"
                    style={StyleSheet.absoluteFill}
                />
            ) : null}
        </View>
    );
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
    const pageUrl = `${location.origin}/`;
    const html = useMemo(
        () =>
            `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe src="${escapeAttribute(src)}" title="${escapeAttribute(title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></body></html>`,
        [src, title],
    );
    return (
        <WebView
            source={{ html, baseUrl: pageUrl }}
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
