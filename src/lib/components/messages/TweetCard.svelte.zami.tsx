// An X/Twitter post as a card, from FxTwitter's status API
// (utils/tweetEmbed). Renders itself again, `nested`, for a quoted post.
import { Fragment, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import {
    Image,
    SvgIcon,
    Video,
    mediaSource,
    openLink,
} from "@-/com.leonsilicon.zami.rn";
// Zami: the quoted post renders this function itself, not an import of
// "./TweetCard.svelte" as upstream writes it.
import { t, intlLocale } from "$lib/i18n";
import Lightbox from "$lib/components/ui/Lightbox.svelte";
import { rememberVolume } from "$lib/actions/rememberVolume";
import { reservedMediaBox } from "$lib/utils/mediaDimensions";
import { galleryNav, galleryPositionLabel } from "$lib/utils/mediaGallery";
import { compactDateTime, messageTimestamp } from "$lib/utils/timeFormat";
import {
    compactCount,
    isQuoteTombstone,
    tweetPhotoThumb,
    type TweetEmbed,
    type TweetSegment,
} from "$lib/utils/tweetEmbed";

interface Props {
    tweet: TweetEmbed;
    /** A quoted post inside another card: no accent bar or footer. */
    nested?: boolean;
}

const PLAY = "M8 5v14l11-7z";
const STAT_PATHS = {
    reply: "M8 10h8M8 14h5m-9 6l2.5-3H18a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v14z",
    repost: "M7 7h11l-3-3m3 3l-3 3M17 17H6l3 3m-3-3l3-3",
    like: "M12 20s-7-4.35-7-10a4 4 0 017-2.65A4 4 0 0119 10c0 5.65-7 10-7 10z",
};

export default function TweetCard({ tweet, nested = false }: Props) {
    // Long posts (note tweets run to thousands of characters) are clamped
    // with a toggle; the toggle shows only when the clamp actually cuts.
    // Zami: `line-clamp-6`/`line-clamp-[12]` as `numberOfLines`; whether it
    // cuts is measured on an unclamped, invisible copy of the text
    // (`measureClamp`'s scrollHeight > clientHeight).
    const [expanded, setExpanded] = useState(false);
    const [clamped, setClamped] = useState(false);
    const clampLines = nested ? 6 : 12;

    // Videos, by URL, that the user has played. The rest show their
    // thumbnail: a mounted <video>, even unplayed, holds a decoder.
    // Zami: not ported: parkOffscreen (and pauseOffscreen for
    // pauseVideoOnScrollOff), which need an IntersectionObserver; the
    // timeline's FlatList unmounts rows far off screen, which releases the
    // player.
    const [playing, setPlaying] = useState<Set<string>>(() => new Set());
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    // A GIF opened full size. It is a looping mp4 here, so the viewer plays it
    // as a video; one at a time, with no gallery to step through.
    const [gifViewer, setGifViewer] = useState<
        TweetEmbed["media"][number] | null
    >(null);

    // A link ending in a language (fxtwitter.com/.../status/<id>/en) asks
    // FxTwitter for a translation; it is shown in place of the original,
    // which stays one click away.
    const [showOriginal, setShowOriginal] = useState(false);
    const translated =
        tweet.translation && !showOriginal ? tweet.translation : null;
    const sourceLanguage = (() => {
        const tr = tweet.translation;
        if (!tr) return "";
        try {
            const name = new Intl.DisplayNames(intlLocale(), {
                type: "language",
            }).of(tr.sourceLang);
            if (name && name !== tr.sourceLang) return name;
        } catch {
            // Old engines or an odd code: fall back below.
        }
        return tr.sourceLangName ?? tr.sourceLang;
    })();

    const photos = tweet.media.filter((m) => m.kind === "photo");

    /** A photo as the viewer wants it: the original, the grid's thumb as its
     *  stand-in, and its size so the box is laid out before either loads. */
    function viewerItem(p: (typeof photos)[number]) {
        return {
            src: p.url,
            placeholders: [tweetPhotoThumb(p.url)],
            dims: p.width && p.height ? { w: p.width, h: p.height } : null,
        };
    }

    const pollEnded =
        tweet.poll?.endsAt != null && tweet.poll.endsAt <= Date.now();
    const pollLeader = tweet.poll
        ? Math.max(...tweet.poll.choices.map((c) => c.percentage))
        : 0;

    const stats = [
        {
            icon: "reply" as const,
            n: tweet.replies,
            label: (n: number) => t("common.replyCount", { count: n }),
        },
        {
            icon: "repost" as const,
            n: tweet.reposts,
            label: (n: number) => t("linkPreview.repostCount", { count: n }),
        },
        {
            icon: "like" as const,
            n: tweet.likes,
            label: (n: number) => t("linkPreview.likeCount", { count: n }),
        },
    ].filter((s): s is typeof s & { n: number } => s.n !== null);

    // Zami: the snippet's runs of text and links, as nested `Text`s in the
    // enclosing `Text`.
    function segments(list: TweetSegment[]): ReactNode {
        return list.map((seg, i) =>
            seg.kind === "link" ? (
                <Text
                    key={i}
                    accessibilityRole="link"
                    onPress={() => openLink(seg.href)}
                    className="text-zam-accent"
                >
                    {seg.text}
                </Text>
            ) : (
                <Fragment key={i}>{seg.text}</Fragment>
            ),
        );
    }

    // Zami: the grid's `repeat(min(n, 2), minmax(0, 1fr))` columns, as rows
    // of equal cells.
    const columns = Math.min(tweet.media.length, 2);
    const mediaRows: (typeof tweet.media)[] = [];
    for (let i = 0; i < tweet.media.length; i += columns)
        mediaRows.push(tweet.media.slice(i, i + columns));

    function mediaItem(item: (typeof tweet.media)[number]): ReactNode {
        // width/height reserve the box before load (from the
        // FxTwitter media dims); w-full/h-auto keep it
        // responsive within the grid cell.
        const box = reservedMediaBox(item.width, item.height, 512, 512);
        // Zami: a cell's shape: the box's, or 16:9 (h-auto has nothing to go
        // on before load), no taller than `max-h-72`.
        const cellStyle = {
            aspectRatio: box ? box.width / box.height : 16 / 9,
            maxHeight: 288,
        };
        if (item.kind === "gif")
            // Played like a GIF: muted, looped, no controls.
            // Zami: not ported: gifTileVideo, which gives it a src only while
            // it is near the viewport (an IntersectionObserver), so a post's
            // many GIFs don't each hold a hardware decoder; the FlatList
            // unmounts far-off rows, which releases the player.
            return (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={item.alt || t("linkPreview.playVideo")}
                    className="w-full min-w-0 p-0 border-0 bg-transparent"
                    onPress={() => setGifViewer(item)}
                >
                    <View
                        className="w-full min-w-0 rounded overflow-hidden bg-black/10"
                        style={cellStyle}
                        // Zami: the press is the wrapper's; the player takes no touches.
                        pointerEvents="none"
                    >
                        <Video
                            src={item.url}
                            poster={item.thumbnail}
                            className="w-full h-full"
                            autoplay
                            muted
                            loop
                        />
                    </View>
                </Pressable>
            );
        if (item.kind === "video" && !playing.has(item.url))
            return (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("linkPreview.playVideo")}
                    className="group/media relative w-full min-w-0 rounded overflow-hidden bg-black"
                    style={cellStyle}
                    onPress={() => {
                        setPlaying((s) => new Set(s).add(item.url));
                    }}
                >
                    {item.thumbnail ? (
                        <Image
                            source={mediaSource(item.thumbnail)}
                            accessible={false}
                            className="w-full h-full"
                            contentFit="contain"
                        />
                    ) : null}
                    <View className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover/media:bg-black/40 transition-colors">
                        <View className="w-14 h-14 rounded-full bg-black/60 flex items-center justify-center">
                            <SvgIcon
                                d={PLAY}
                                className="w-7 h-7 text-white ms-1"
                            />
                        </View>
                    </View>
                </Pressable>
            );
        if (item.kind === "video")
            return (
                <Video
                    src={item.url}
                    poster={item.thumbnail}
                    className="w-full min-w-0 rounded bg-black"
                    style={cellStyle}
                    use={rememberVolume}
                    controls
                    autoplay
                />
            );
        return (
            <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel={item.alt}
                onPress={() => {
                    setLightboxIndex(photos.indexOf(item));
                }}
                className="w-full min-w-0 rounded overflow-hidden bg-black/10"
                style={cellStyle}
            >
                <Image
                    source={mediaSource(tweetPhotoThumb(item.url))}
                    accessible={false}
                    className="w-full h-full"
                    contentFit="contain"
                />
            </Pressable>
        );
    }

    const textClass = "text-sm text-zam-textPrimary leading-relaxed";

    const body = (
        <>
            {/* Author */}
            <Pressable
                accessibilityRole="link"
                onPress={() => openLink(tweet.authorUrl)}
                className="group/author flex-row items-center gap-2 min-w-0"
            >
                {tweet.avatarUrl ? (
                    <Image
                        source={mediaSource(tweet.avatarUrl)}
                        accessible={false}
                        className={`${nested ? "w-5 h-5" : "w-6 h-6"} rounded-full flex-shrink-0 bg-black/10`}
                    />
                ) : null}
                <Text
                    numberOfLines={1}
                    className="flex-shrink min-w-0 text-sm leading-snug"
                >
                    <Text className="text-sm font-semibold text-zam-textPrimary">
                        {tweet.authorName}
                    </Text>{" "}
                    <Text className="text-sm text-zam-textMuted">
                        @{tweet.authorHandle}
                    </Text>
                </Text>
            </Pressable>

            {tweet.replyingTo ? (
                <Text className="text-xs text-zam-textMuted -mt-1">
                    ↩ {t("linkPreview.replyingTo")}{" "}
                    <Text
                        accessibilityRole="link"
                        onPress={() => openLink(tweet.replyingTo!.url)}
                        className="text-xs text-zam-accent"
                    >
                        @{tweet.replyingTo.handle}
                    </Text>
                </Text>
            ) : null}

            {tweet.text ? (
                <View>
                    {tweet.translation ? (
                        <Text className="text-xs text-zam-textMuted mb-0.5">
                            {t("linkPreview.translatedFrom", {
                                language: sourceLanguage,
                            })}
                            {" · "}
                            <Text
                                accessibilityRole="button"
                                className="text-xs text-zam-accent"
                                onPress={() => setShowOriginal((x) => !x)}
                            >
                                {showOriginal
                                    ? t("linkPreview.showTranslation")
                                    : t("linkPreview.showOriginal")}
                            </Text>
                        </Text>
                    ) : null}
                    <View>
                        <Text
                            numberOfLines={expanded ? undefined : clampLines}
                            className={textClass}
                        >
                            {segments(translated?.segments ?? tweet.segments)}
                        </Text>
                        {/* Zami: the measuring copy (measureClamp). */}
                        <Text
                            aria-hidden
                            importantForAccessibility="no-hide-descendants"
                            pointerEvents="none"
                            className={`${textClass} absolute top-0 start-0 end-0 opacity-0`}
                            onTextLayout={(e) =>
                                setClamped(
                                    e.nativeEvent.lines.length > clampLines,
                                )
                            }
                        >
                            {translated?.text ?? tweet.text}
                        </Text>
                    </View>
                    {clamped || expanded ? (
                        <Pressable
                            accessibilityRole="button"
                            className="mt-0.5 self-start"
                            onPress={() => setExpanded((x) => !x)}
                        >
                            <Text className="text-xs text-zam-accent">
                                {expanded
                                    ? t("linkPreview.showLess")
                                    : t("linkPreview.showMore")}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}

            {tweet.poll ? (
                <View className="flex flex-col gap-1 max-w-sm">
                    {tweet.poll.choices.map((choice, i) => (
                        <View
                            key={i}
                            className="relative overflow-hidden rounded bg-zam-backgroundTertiary px-2 py-1"
                        >
                            <View
                                className={`absolute inset-y-0 start-0 ${
                                    choice.percentage === pollLeader &&
                                    pollEnded
                                        ? "bg-zam-accent/40"
                                        : "bg-zam-accent/20"
                                }`}
                                style={{ width: `${choice.percentage}%` }}
                            />
                            <View className="relative flex-row justify-between gap-3">
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink min-w-0 text-sm text-zam-textPrimary"
                                >
                                    {choice.label}
                                </Text>
                                <Text
                                    className={`flex-shrink-0 tabular-nums text-sm text-zam-textPrimary ${
                                        choice.percentage === pollLeader
                                            ? "font-semibold"
                                            : ""
                                    }`}
                                >
                                    {choice.percentage}%
                                </Text>
                            </View>
                        </View>
                    ))}
                    <Text className="text-xs text-zam-textMuted">
                        {t("linkPreview.pollVotes", {
                            count: tweet.poll.totalVotes,
                            votes: tweet.poll.totalVotes.toLocaleString(
                                intlLocale(),
                            ),
                        })}
                        {pollEnded
                            ? ` · ${t("linkPreview.pollFinal")}`
                            : tweet.poll.endsAt
                              ? ` · ${t("linkPreview.pollEnds", {
                                    date: compactDateTime(tweet.poll.endsAt),
                                })}`
                              : null}
                    </Text>
                </View>
            ) : null}

            {tweet.media.length > 0 ? (
                <View className="gap-1 rounded overflow-hidden">
                    {mediaRows.map((row, ri) => (
                        <View key={ri} className="flex-row gap-1">
                            {row.map((item, ci) => (
                                <View key={ci} className="flex-1 min-w-0">
                                    {mediaItem(item)}
                                </View>
                            ))}
                            {row.length < columns ? (
                                <View className="flex-1" />
                            ) : null}
                        </View>
                    ))}
                </View>
            ) : null}

            {tweet.quote && isQuoteTombstone(tweet.quote) ? (
                <View className="rounded border border-zam-divider px-3 py-2">
                    <Text className="text-xs italic text-zam-textMuted">
                        {tweet.quote.tombstone ||
                            t("linkPreview.quoteUnavailable")}
                    </Text>
                </View>
            ) : tweet.quote ? (
                <TweetCard tweet={tweet.quote} nested />
            ) : null}

            {tweet.communityNote ? (
                <View className="rounded border border-zam-divider bg-zam-backgroundTertiary px-3 py-2">
                    <Text className="text-xs font-semibold text-zam-textPrimary mb-0.5">
                        {t("linkPreview.communityNote")}
                    </Text>
                    <Text className="text-xs text-zam-textSecondary leading-relaxed">
                        {segments(tweet.communityNote)}
                    </Text>
                </View>
            ) : null}

            {/* Footer: counts, date, link to the post */}
            <Pressable
                accessibilityRole="link"
                onPress={() => openLink(tweet.url)}
                className="flex-row flex-wrap items-center gap-x-3 gap-y-0.5"
            >
                {stats.map((stat) => (
                    <View
                        key={stat.icon}
                        accessible
                        accessibilityLabel={stat.label(stat.n)}
                        className="flex-row items-center gap-1"
                    >
                        <SvgIcon
                            d={STAT_PATHS[stat.icon]}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-3.5 h-3.5 text-zam-textMuted"
                        />
                        <Text className="text-xs tabular-nums text-zam-textMuted">
                            {compactCount(stat.n, intlLocale())}
                        </Text>
                    </View>
                ))}
                {!nested ? (
                    <View className="ms-auto flex-row items-center gap-1">
                        {tweet.createdAt ? (
                            <>
                                <Text className="text-xs text-zam-textMuted">
                                    {messageTimestamp(tweet.createdAt)}
                                </Text>
                                <Text
                                    aria-hidden
                                    className="text-xs text-zam-textMuted"
                                >
                                    ·
                                </Text>
                            </>
                        ) : null}
                        <Text className="text-xs text-zam-textMuted">
                            {t("linkPreview.xTwitter")}
                        </Text>
                    </View>
                ) : tweet.createdAt ? (
                    <Text className="ms-auto text-xs text-zam-textMuted">
                        {messageTimestamp(tweet.createdAt)}
                    </Text>
                ) : null}
            </Pressable>
        </>
    );

    const lightbox = (() => {
        if (lightboxIndex === null) return null;
        const photo = photos[lightboxIndex];
        const nav = galleryNav(photos.length, lightboxIndex);
        const prev = nav.prevIndex;
        const next = nav.nextIndex;
        if (!photo) return null;
        // The grid's medium thumb (already loaded) stands in, in a box
        // sized from the media dims, until the original arrives; the
        // neighbours carry the same so a step or swipe lands on a sized,
        // painted image instead of an empty 0x0 one.
        return (
            <Lightbox
                src={photo.url}
                alt={photo.alt ?? ""}
                placeholders={viewerItem(photo).placeholders}
                dims={viewerItem(photo).dims}
                onClose={() => setLightboxIndex(null)}
                onPrev={
                    prev !== null ? () => setLightboxIndex(prev) : undefined
                }
                onNext={
                    next !== null ? () => setLightboxIndex(next) : undefined
                }
                neighbours={{
                    prev: prev !== null ? viewerItem(photos[prev]) : null,
                    next: next !== null ? viewerItem(photos[next]) : null,
                }}
                position={galleryPositionLabel(photos.length, lightboxIndex)}
            />
        );
    })();

    return (
        <>
            {nested ? (
                <View className="flex flex-col gap-2 rounded border border-zam-divider p-2.5 min-w-0">
                    {body}
                </View>
            ) : (
                <View className="mt-2 flex-row max-w-lg rounded overflow-hidden border border-zam-divider bg-zam-backgroundSecondary">
                    {/* Left accent bar */}
                    <View className="w-1 flex-shrink-0 bg-zam-accent" />
                    <View className="flex flex-1 min-w-0 flex-col p-3 gap-2">
                        {body}
                    </View>
                </View>
            )}
            {gifViewer ? (
                <Lightbox
                    src={gifViewer.url}
                    kind="video"
                    loop
                    poster={gifViewer.thumbnail}
                    alt={gifViewer.alt ?? ""}
                    onClose={() => setGifViewer(null)}
                />
            ) : null}
            {lightbox}
        </>
    );
}
