import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
    AccessibilityInfo,
    Pressable,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
    type ViewStyle,
} from "react-native";
import {
    GestureDetector,
    usePanGesture,
    usePinchGesture,
    useSimultaneousGestures,
    useTapGesture,
    type PanGesture,
} from "react-native-gesture-handler";
import Animated, {
    cancelAnimation,
    Easing,
    FadeIn,
    Keyframe,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import {
    Image,
    Portal,
    SvgIcon,
    Video,
    mediaSource,
    openLink,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import {
    interfaceState,
    openModal,
    clearModalIfOwner,
} from "$lib/stores/interface.svelte";
import {
    isFavouriteGif,
    addFavouriteGif,
    removeFavouriteGif,
} from "$lib/stores/favourites.svelte";
import {
    fetchAttachmentBlob,
    fetchDecryptedAttachmentBlob,
} from "$lib/matrix/client";
import { rememberVolume } from "$lib/actions/rememberVolume";
import { safeMediaBlob } from "$lib/utils/attachmentMime";
import { STREAM_ENCRYPTED_MIN_BYTES } from "$lib/matrix/videoStream";
import type { EncryptedFileInfo } from "$lib/utils/decryptAttachment";
import { revokeLater, saveObjectUrl } from "$lib/utils/saveFile";
import type { FrameRelay } from "$lib/utils/frameRelay";
import { safeDimension } from "$lib/utils/mediaDimensions";
import MediaProgress from "$lib/components/ui/MediaProgress.svelte";
import type { DownloadProgress } from "$lib/utils/downloadProgress";
import { motionOK } from "$lib/utils/motionPreference";
import { DISMISS_VELOCITY, ENGAGE_PX } from "$lib/actions/sheetDrag";

interface Props {
    src: string;
    alt?: string;
    /** What `src` points at. "video" swaps the zoomable <img> for a single
     *  native player; anything else is shown as an image. */
    kind?: "image" | "video";
    /** Still shown behind a video until its data arrives. Ignored for
     *  images, which are their own poster. */
    poster?: string | null;
    /** Name to save as. Falls back to the last path segment of `src`, which
     *  is a bare media id (no extension) on Matrix download URLs. */
    filename?: string;
    onClose: () => void;
    /** When set, a favourite (star) button is shown that toggles this gif
     *  in the favourite gif picker. Pass only for gif-like media. */
    favourite?: {
        url: string;
        previewUrl: string;
        /** Pointer to the message, for an encrypted gif (see favouriteFile.ts). */
        source?: { roomId: string; eventId: string };
    };
    /** Gallery navigation. When supplied, a chevron and the matching arrow
     *  key step to the neighbouring item; omit at the ends of the list. */
    onPrev?: () => void;
    onNext?: () => void;
    /** Gallery position text ("2 of 5") from galleryPositionLabel. Shown
     *  as a chip and announced politely on every step; omit it (or pass
     *  null) for a single item. */
    position?: string | null;
    /** For an ENCRYPTED video: `src` is then the ciphertext URL and this is
     *  its EncryptedFile. The viewer decrypts it itself, playing while it
     *  downloads when the file is big enough to be worth it. */
    encryptedFile?: EncryptedFileInfo & { url: string };
    /** Mimetype and size of the attachment, from the event. */
    mimetype?: string | null;
    sizeHint?: number | null;
    /** Images only: stand-ins painted behind `src` until it loads, best
     *  first (a server thumbnail, then the sender's tiny one). `src` may
     *  be "" while an encrypted original is still decrypting. */
    placeholders?: readonly (string | null | undefined)[];
    /** Images only: the full image's (untrusted) size, so its box is laid
     *  out before it loads and the stand-ins have somewhere to show. */
    dims?: { w: unknown; h: unknown } | null;
    /** Images only: frames of the image drawn as it arrives (an encrypted
     *  original painting in while it decrypts), shown over the stand-ins
     *  until `src` loads. */
    preview?: FrameRelay | null;
}

/** Zami: an object URL. The Blob polyfill makes `URL.createObjectURL` return
 *  a `file://` URI, where a browser's is `blob:`. */
function isObjectUrl(url: string): boolean {
    return url.startsWith("blob:") || url.startsWith("file:");
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;

// Double-tap (mihon/tachiyomi style): the first double-tap zooms in at the
// point, the next resets. A single tap does nothing. The old code toggled on
// every single tap, so a quick double tap zoomed in then straight back out.
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 40;

// Zami: swipe down to close, as iOS's own viewers do: an unzoomed image (or the
// video) follows a downward drag, the backdrop fading with it, and closes past
// this fraction of the screen or on a flick (sheetDrag's flick speed, px/ms).
const DISMISS_FRACTION = 0.15;

// `transition: transform 0.2s ease`
const ZOOM_TIMING = { duration: 200, easing: Easing.ease };

// `in:scale={{ start: 0.97, opacity: 0 }}` (Svelte's scale eases out cubically).
const SCALE_IN = new Keyframe({
    0: { opacity: 0, transform: [{ scale: 0.97 }] },
    100: {
        opacity: 1,
        transform: [{ scale: 1 }],
        easing: Easing.out(Easing.cubic),
    },
}).duration(150);

/** Zami: the CSS `max-width`/`max-height` caps on the media: never past its own
 *  size, never past the viewport less the gutter. */
function fitBox(
    w: number,
    h: number,
    maxW: number,
    maxH: number,
): { width: number; height: number } {
    const width = Math.max(0, Math.min(w, maxW, (maxH * w) / h));
    return { width, height: (width * h) / w };
}

export default function Lightbox({
    src,
    alt = "",
    kind = "image",
    poster = null,
    filename,
    onClose,
    favourite,
    onPrev,
    onNext,
    position = null,
    encryptedFile,
    mimetype = null,
    sizeHint = null,
    placeholders = [],
    dims = null,
    // Zami: not ported: `preview`, the frames of an image painting in as it
    // decrypts, which frameSink draws on a <canvas>. The stand-ins show until
    // `src` loads instead.
}: Props) {
    const isMobile = useRune(() => interfaceState.isMobile);
    const viewport = useWindowDimensions();
    const insets = useSafeAreaInsets();

    const isVideo = kind === "video";
    const mediaNoun = isVideo ? "video" : "image";
    const MediaNoun = isVideo ? t("lightbox.video") : t("lightbox.image");
    // `mediaNoun` above is also compared against file names, so it stays
    // English; this is the word shown to people.
    const mediaNounLabel = isVideo
        ? t("lightbox.videoNoun")
        : t("lightbox.imageNoun");

    // Reactively tracks favourite state (reads favouritesState.gifs $state).
    const favouriteUrl = favourite?.url;
    const favourited = useRune(
        () => (favouriteUrl ? isFavouriteGif(favouriteUrl) : false),
        [favouriteUrl],
    );

    function toggleFavourite() {
        if (!favourite) return;
        if (isFavouriteGif(favourite.url)) {
            void removeFavouriteGif(favourite.url);
        } else {
            void addFavouriteGif({
                url: favourite.url,
                previewUrl: favourite.previewUrl,
                source: favourite.source,
            });
        }
    }

    /** The filename to display, or null when only the generic fallback
     *  ("image" / "video") is known. */
    const shownName = (() => {
        const name = filenameFromSrc();
        return name === mediaNoun ? null : name;
    })();

    function filenameFromSrc(): string {
        if (filename) return filename;
        // Gallery callers pass the filename as alt text; use it when it
        // looks like one (has an extension).
        const a = alt.trim();
        if (/\.[a-z0-9]{2,5}$/i.test(a) && !/[\\/]/.test(a)) return a;
        try {
            const u = new URL(src, location.href);
            const last = u.pathname.split("/").filter(Boolean).pop();
            if (last && /\.[a-z0-9]+$/i.test(last)) return last;
        } catch {
            /* ignore */
        }
        return mediaNoun;
    }

    // Zami: a `blob:` src (an already-decrypted attachment, owned by the
    // caller) is played as is; upstream's video effect copies it into
    // `videoBlobUrl`, which is just this.
    const videoBlobUrl = isVideo && isObjectUrl(src) ? src : null;

    async function download() {
        // An encrypted original still decrypting: nothing to save yet.
        if (!src) return;
        const name = filenameFromSrc();
        // Zami: no shift+click quiet save.
        try {
            // A playing video has already been pulled down in full — save that
            // copy instead of fetching the whole file a second time. Ownership
            // stays with the caller, so this path must NOT revoke it.
            // Zami: an image's object URL is the caller's local copy too.
            if (videoBlobUrl || isObjectUrl(src)) {
                await saveObjectUrl(src, name);
                return;
            }
            let objectUrl: string;
            try {
                // Homeserver media uses authenticated media endpoints — the
                // token must be attached, and fetchAttachmentBlob refuses to
                // send it anywhere but the homeserver (throws on foreign URLs).
                objectUrl = encryptedFile
                    ? await fetchDecryptedAttachmentBlob(
                          encryptedFile,
                          mimetype ?? undefined,
                      )
                    : await fetchAttachmentBlob(src);
            } catch {
                // Non-homeserver media (e.g. an embedded tweet photo): fetch it
                // directly, with no auth attached.
                objectUrl = URL.createObjectURL(
                    await safeMediaBlob(await (await fetch(src)).blob()),
                );
            }
            try {
                await saveObjectUrl(objectUrl, name);
            } finally {
                revokeLater(objectUrl);
            }
        } catch (err) {
            console.error("Failed to download media", err);
            // Last resort (e.g. a CORS-blocked foreign image): open it.
            openLink(src);
        }
    }

    // ── Zoom & pan ──────────────────────────────────────────────────────────
    // Zami: the transform lives in Reanimated shared values, and the gestures
    // are react-native-gesture-handler's, running on the UI thread.
    const scale = useSharedValue(1);
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    // How far the media has been dragged down to close it.
    const dismiss = useSharedValue(0);
    // The viewer's size (window.innerWidth/innerHeight) and the image's
    // untransformed box (imgEl.offsetWidth/offsetHeight).
    const viewW = useSharedValue(viewport.width);
    const viewH = useSharedValue(viewport.height);
    const imgW = useSharedValue(0);
    const imgH = useSharedValue(0);

    // Gallery stepping swaps `src` on the SAME instance, so without this the
    // next image opens at the previous one's zoom, panned to coordinates
    // clamped against the previous one's dimensions.
    useEffect(() => {
        void src;
        for (const v of [scale, tx, ty, dismiss]) cancelAnimation(v);
        scale.value = 1;
        tx.value = 0;
        ty.value = 0;
        dismiss.value = 0;
    }, [src, scale, tx, ty, dismiss]);

    // ── Progressive stand-ins ──────────────────────────────────────────────
    // Until `src` loads, the <img> shows `placeholders` as background layers
    // in a box sized from `dims` (otherwise an unloaded <img> is 0×0). They
    // are dropped once it loads so a transparent image doesn't show them.
    // Zami: the load is recorded with the URL it was for, so stepping to the
    // next image starts unloaded without an effect resetting it.
    const [loaded, setLoaded] = useState<{
        url: string;
        width: number;
        height: number;
    } | null>(null);
    const imgLoaded = !!src && loaded?.url === src;
    const viewGutter = isMobile ? 96 : 32; // 6em / 2em
    const maxW = Math.max(0, viewport.width - viewGutter);
    const maxH = Math.max(0, viewport.height - viewGutter);
    const imgBox = (() => {
        const w = safeDimension(dims?.w);
        const h = safeDimension(dims?.h);
        if (w === null || h === null) return null;
        // What the loaded image would get from the max-width/max-height caps
        // below: never past its own size, never past the viewport.
        return fitBox(w, h, maxW, maxH);
    })();
    // No size to lay out a box with and no original yet: show the best
    // stand-in as the image itself rather than nothing.
    const shownSrc =
        src || (imgBox ? "" : (placeholders.find((p) => !!p) ?? ""));
    const imgPlaceholders =
        imgLoaded || !imgBox
            ? undefined
            : placeholders
                  .map((p) => mediaSource(p))
                  .filter((p) => p !== undefined);
    // Zami: an <img> without a box takes its natural size; an expo-image
    // needs one, so until it loads it gets the whole viewport.
    const naturalBox =
        loaded && loaded.url === shownSrc && loaded.width > 0
            ? fitBox(loaded.width, loaded.height, maxW, maxH)
            : null;
    const shownBox = imgBox ?? naturalBox ?? { width: maxW, height: maxH };
    // The image's own box, for the pan limits and for telling a tap on it from
    // one beside it: none while its size is unknown, as an unloaded <img> is
    // 0×0, so a tap anywhere then closes the viewer.
    const imageW = (imgBox ?? naturalBox)?.width ?? 0;
    const imageH = (imgBox ?? naturalBox)?.height ?? 0;
    useEffect(() => {
        imgW.value = imageW;
        imgH.value = imageH;
    }, [imageW, imageH, imgW, imgH]);

    // Clamp the pan so the image can't be dragged past its visible edges.
    function maxPan(s: number) {
        "worklet";
        return {
            x: Math.max(0, (imgW.value * s - viewW.value) / 2),
            y: Math.max(0, (imgH.value * s - viewH.value) / 2),
        };
    }

    function clampPan() {
        "worklet";
        const max = maxPan(scale.value);
        tx.value = Math.min(max.x, Math.max(-max.x, tx.value));
        ty.value = Math.min(max.y, Math.max(-max.y, ty.value));
    }

    /** Scale by `factor` keeping the point (px,py) in screen space fixed. */
    function zoomAt(factor: number, px: number, py: number, animate = false) {
        "worklet";
        const next = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, scale.value * factor),
        );
        const f = next / scale.value;
        const mx = px - viewW.value / 2;
        const my = py - viewH.value / 2;
        const max = maxPan(next);
        const x = Math.min(max.x, Math.max(-max.x, mx - f * (mx - tx.value)));
        const y = Math.min(max.y, Math.max(-max.y, my - f * (my - ty.value)));
        if (animate) {
            scale.value = withTiming(next, ZOOM_TIMING);
            tx.value = withTiming(x, ZOOM_TIMING);
            ty.value = withTiming(y, ZOOM_TIMING);
        } else {
            scale.value = next;
            tx.value = x;
            ty.value = y;
        }
    }

    /** Whether (x,y) in the viewer lies on the (transformed) image. */
    function onImage(x: number, y: number) {
        "worklet";
        const cx = viewW.value / 2 + tx.value;
        const cy = viewH.value / 2 + ty.value + dismiss.value;
        return (
            Math.abs(x - cx) <= (imgW.value * scale.value) / 2 &&
            Math.abs(y - cy) <= (imgH.value * scale.value) / 2
        );
    }

    // Zami: a drag released far or fast enough closes the viewer; otherwise
    // the media settles back.
    const animateOut = motionOK();
    function settleDismiss(velocityY: number, canceled: boolean) {
        "worklet";
        if (dismiss.value === 0) return;
        const close =
            !canceled &&
            dismiss.value > 0 &&
            (dismiss.value > viewH.value * DISMISS_FRACTION ||
                velocityY / 1000 > DISMISS_VELOCITY);
        if (!close) {
            dismiss.value = animateOut ? withTiming(0, ZOOM_TIMING) : 0;
            return;
        }
        if (!animateOut) {
            scheduleOnRN(requestClose);
            return;
        }
        dismiss.value = withTiming(
            viewH.value,
            { duration: 150, easing: Easing.in(Easing.cubic) },
            (finished) => {
                if (finished) scheduleOnRN(requestClose);
            },
        );
    }

    // Pinch: two fingers zoom about their midpoint.
    const pinchPrev = useSharedValue(1);
    const pinch = usePinchGesture({
        onActivate: () => {
            "worklet";
            cancelAnimation(scale);
            cancelAnimation(tx);
            cancelAnimation(ty);
            pinchPrev.value = 1;
        },
        onUpdate: (e) => {
            "worklet";
            const factor = e.scale / pinchPrev.value;
            pinchPrev.value = e.scale;
            zoomAt(factor, e.focalX, e.focalY);
        },
    });

    // Single pointer: pan only when zoomed in. Zami: unzoomed, a drag pulls
    // the image down to close it.
    const panPointers = useSharedValue(0);
    const panDismiss = useSharedValue(false);
    const pan = usePanGesture({
        onActivate: (e) => {
            "worklet";
            cancelAnimation(tx);
            cancelAnimation(ty);
            cancelAnimation(dismiss);
            panPointers.value = e.numberOfPointers;
            panDismiss.value = scale.value <= MIN_SCALE;
        },
        onUpdate: (e) => {
            "worklet";
            // Lifted one finger of a pinch (or added one): the centroid the
            // deltas are measured from jumps, so resume from the next event.
            if (e.numberOfPointers !== panPointers.value) {
                panPointers.value = e.numberOfPointers;
                return;
            }
            // Two fingers are the pinch's.
            if (e.numberOfPointers >= 2) return;
            if (scale.value > MIN_SCALE) {
                tx.value += e.changeX;
                ty.value += e.changeY;
                clampPan();
            } else if (panDismiss.value) {
                dismiss.value += e.changeY;
            }
        },
        onDeactivate: (e) => {
            "worklet";
            settleDismiss(e.velocityY, e.canceled);
        },
    });

    // Zoom only on a DOUBLE tap: the first zooms in at the tap point, the
    // next resets. A single tap does nothing, so the gesture no longer
    // zooms-in-then-out on a quick double tap.
    const doubleTap = useTapGesture({
        numberOfTaps: 2,
        maxDelay: DOUBLE_TAP_MS,
        maxDistance: DOUBLE_TAP_DIST,
        onActivate: (e) => {
            "worklet";
            if (!onImage(e.x, e.y)) return;
            if (scale.value > MIN_SCALE) {
                scale.value = withTiming(1, ZOOM_TIMING);
                tx.value = withTiming(0, ZOOM_TIMING);
                ty.value = withTiming(0, ZOOM_TIMING);
            } else {
                zoomAt(2, e.x, e.y, true);
            }
        },
    });

    // Zami: the gestures take the whole viewer, so a pinch can start beside a
    // small image; a tap off the image is then the backdrop's click.
    const backdropTap = useTapGesture({
        onActivate: (e) => {
            "worklet";
            if (!onImage(e.x, e.y)) scheduleOnRN(requestClose);
        },
    });
    const imageGestures = useSimultaneousGestures(
        pinch,
        pan,
        doubleTap,
        backdropTap,
    );

    // Zami: the video keeps its native controls; only a mostly vertical,
    // downward drag on it is the swipe to close.
    const videoDismiss: PanGesture = usePanGesture({
        activeOffsetY: ENGAGE_PX,
        failOffsetY: -ENGAGE_PX,
        failOffsetX: [-ENGAGE_PX, ENGAGE_PX],
        onActivate: () => {
            "worklet";
            cancelAnimation(dismiss);
        },
        onUpdate: (e) => {
            "worklet";
            dismiss.value = Math.max(0, e.translationY);
        },
        onDeactivate: (e) => {
            "worklet";
            settleDismiss(e.velocityY, e.canceled);
        },
    });

    const imageStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: tx.value },
            { translateY: ty.value + dismiss.value },
            { scale: scale.value },
        ],
    }));
    const videoStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: dismiss.value }],
    }));
    const backdropStyle = useAnimatedStyle(() => ({
        opacity: 1 - Math.min(1, Math.abs(dismiss.value) / (viewH.value || 1)),
    }));

    // Lightbox is rendered INSIDE the message DOM subtree (MessageItem /
    // LinkPreview); `fixed` positioning does not change DOM ancestry, so a tap
    // on the backdrop or image would otherwise bubble to the message row's
    // onclick (toggling mobile selection on touch). This contains every click
    // within the viewer.
    // Zami: the viewer renders at the app root through Portal, and a press
    // there never reaches the message row, so there's nothing to contain.

    // Zami: the close handler the modal slot and the gestures call: always the
    // latest `onClose`, as the slot is claimed once.
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    });
    function requestClose() {
        onCloseRef.current();
    }

    useEffect(() => {
        // Register in the shared modal slot so Escape/back close it centrally.
        // The store mirrors `interfaceState.lightboxOpen` off this claim, and
        // the token keeps a superseded viewer's teardown from stealing the slot
        // back from the viewer that replaced it.
        const token = openModal("lightbox", () => onCloseRef.current());
        return () => {
            clearModalIfOwner(token);
        };
    }, []);

    // Gallery arrow keys. Kept in its own onMount so the listener's lifecycle is
    // independent of the modal-slot registration above. Escape is NOT handled
    // here — `use:focusTrap={{ onEscape: onClose }}` owns it.
    // Zami: not ported: the arrow keys (React Native reports no key events);
    // the chevrons step through the gallery. VoiceOver's escape gesture closes
    // the viewer (onAccessibilityEscape below), as the focus trap's Escape.

    // Mounted for the viewer's whole lifetime, so each step's new text is
    // announced. Zami: the polite live region, as an announcement whenever
    // the position changes.
    const announced = useRef(position);
    useEffect(() => {
        if (position === announced.current) return;
        announced.current = position;
        if (position)
            AccessibilityInfo.announceForAccessibility(
                `${MediaNoun} ${position}`,
            );
    }, [position, MediaNoun]);

    const animate = motionOK();
    // The chips and buttons keep clear of the notch and the home indicator.
    const top = insets.top + 12;
    const start = insets.left + 12;
    const end = insets.right + 12;

    return (
        <Portal>
            <View
                className="absolute inset-0 z-[9998] overflow-hidden"
                accessibilityViewIsModal
            >
                {/* Backdrop: clicking outside the media closes the viewer. */}
                <Animated.View
                    entering={animate ? FadeIn.duration(150) : undefined}
                    style={StyleSheet.absoluteFill}
                >
                    <Animated.View
                        style={[StyleSheet.absoluteFill, backdropStyle]}
                    >
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("lightbox.closeViewer", {
                                mediaNoun: mediaNounLabel,
                            })}
                            className="absolute inset-0 bg-black/80"
                            onPress={onClose}
                        />
                    </Animated.View>
                </Animated.View>

                {/* Dialog: full-screen flex-centered layer. pointer-events-none lets
                    clicks on the empty area fall through to the backdrop button; the
                    image and the controls re-enable pointer events. */}
                <Animated.View
                    entering={animate ? SCALE_IN : undefined}
                    pointerEvents="box-none"
                    className="absolute inset-0 z-10 flex items-center justify-center"
                    accessibilityLabel={t("lightbox.viewer", {
                        MediaNoun,
                        value: position ? `, ${position}` : "",
                    })}
                    onAccessibilityEscape={onClose}
                >
                    {isVideo ? (
                        // One player, mounted only once its bytes are here.
                        <View
                            pointerEvents="box-none"
                            style={StyleSheet.absoluteFill}
                            className="items-center justify-center"
                        >
                            <GestureDetector gesture={videoDismiss}>
                                <Animated.View style={videoStyle}>
                                    <LightboxVideo
                                        key={src}
                                        src={src}
                                        alt={alt}
                                        poster={poster}
                                        encryptedFile={encryptedFile}
                                        mimetype={mimetype}
                                        sizeHint={sizeHint}
                                        maxWidth={maxW}
                                        maxHeight={maxH}
                                    />
                                </Animated.View>
                            </GestureDetector>
                        </View>
                    ) : (
                        // The image is a genuine pinch/pan/zoom gesture surface.
                        <GestureDetector gesture={imageGestures}>
                            <View
                                style={StyleSheet.absoluteFill}
                                className="items-center justify-center"
                                onLayout={(e) => {
                                    viewW.value = e.nativeEvent.layout.width;
                                    viewH.value = e.nativeEvent.layout.height;
                                }}
                            >
                                <Animated.View style={[shownBox, imageStyle]}>
                                    <Image
                                        source={mediaSource(shownSrc)}
                                        accessibilityLabel={alt || undefined}
                                        placeholder={imgPlaceholders}
                                        placeholderContentFit="fill"
                                        contentFit="contain"
                                        className="w-full h-full rounded-lg"
                                        onLoad={(e) =>
                                            setLoaded({
                                                url: shownSrc,
                                                width: e.source.width,
                                                height: e.source.height,
                                            })
                                        }
                                    />
                                </Animated.View>
                            </View>
                        </GestureDetector>
                    )}

                    {/* Top-left: the gallery position chip, then the file's name. The
                        row leaves room for the action buttons on the right; the chip
                        keeps its size and the name truncates. */}
                    {position || shownName ? (
                        <View
                            pointerEvents="box-none"
                            className="absolute z-10 flex-row items-center gap-2"
                            style={{
                                top,
                                start,
                                maxWidth: viewport.width - start - end - 136,
                            }}
                        >
                            {position ? (
                                // aria-hidden: the announcement above carries
                                // the same text for screen readers.
                                <View
                                    className="shrink-0 px-3 py-1.5 rounded-full bg-black/50"
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                >
                                    <Text className="text-white text-sm tabular-nums">
                                        {position}
                                    </Text>
                                </View>
                            ) : null}
                            {/* The file's name, when known (selectable). */}
                            {shownName ? (
                                <View className="shrink min-w-0 px-3 py-1.5 rounded-full bg-black/50">
                                    <Text
                                        numberOfLines={1}
                                        selectable
                                        className="text-white text-sm"
                                    >
                                        {shownName}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    ) : null}
                    {/* Top-right action buttons */}
                    <View
                        className="absolute z-10 flex-row items-center gap-2"
                        style={{ top, end }}
                    >
                        {favourite ? (
                            <Pressable
                                onPress={toggleFavourite}
                                accessibilityRole="button"
                                accessibilityLabel={
                                    favourited
                                        ? t("common.removeFromFavourites")
                                        : t("common.addToFavourites")
                                }
                                accessibilityState={{ selected: favourited }}
                                className="p-2 rounded-full bg-black/50 active:bg-black/70 transition-colors"
                            >
                                {favourited ? (
                                    <SvgIcon
                                        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                                        className="w-5 h-5 text-discord-warning"
                                    />
                                ) : (
                                    <SvgIcon
                                        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="w-5 h-5 text-white"
                                    />
                                )}
                            </Pressable>
                        ) : null}
                        <Pressable
                            onPress={() => void download()}
                            accessibilityRole="button"
                            accessibilityLabel={t("lightbox.download")}
                            className="p-2 rounded-full bg-black/50 active:bg-black/70 transition-colors"
                        >
                            <SvgIcon
                                d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="w-5 h-5 text-white"
                            />
                        </Pressable>
                    </View>

                    {onPrev ? (
                        <Pressable
                            onPress={onPrev}
                            accessibilityRole="button"
                            accessibilityLabel={t("lightbox.previous2", {
                                mediaNoun: mediaNounLabel,
                            })}
                            className="absolute z-10 p-2 rounded-full bg-black/50 active:bg-black/70 transition-colors"
                            // `top-1/2 -translate-y-1/2` of a 36px button.
                            style={{ start, top: viewport.height / 2 - 18 }}
                        >
                            <SvgIcon
                                d="M15 19l-7-7 7-7"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="w-5 h-5 text-white"
                            />
                        </Pressable>
                    ) : null}
                    {onNext ? (
                        <Pressable
                            onPress={onNext}
                            accessibilityRole="button"
                            accessibilityLabel={t("lightbox.next2", {
                                mediaNoun: mediaNounLabel,
                            })}
                            className="absolute z-10 p-2 rounded-full bg-black/50 active:bg-black/70 transition-colors"
                            style={{ end, top: viewport.height / 2 - 18 }}
                        >
                            <SvgIcon
                                d="M9 5l7 7-7 7"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="w-5 h-5 text-white"
                            />
                        </Pressable>
                    ) : null}
                </Animated.View>
            </View>
        </Portal>
    );
}

// ── Video playback ──────────────────────────────────────────────────────
// Matrix media sits behind the authenticated download endpoint, so a plain
// <video src={http}> 401s on a server that enforces it. The element is
// instead fed by the authedVideoSrc action (videoStream.ts): it fetches
// with the token, decrypts an encrypted file on the fly, and starts playing
// while the rest downloads where the container allows. A `blob:` src (an
// already-decrypted attachment, owned by the caller) is just played.
//
// Zami: the viewer's video, keyed by `src`: stepping through a gallery
// remounts it, which resets the per-video state upstream's effect resets.
function LightboxVideo({
    src,
    alt,
    poster,
    encryptedFile,
    mimetype,
    sizeHint,
    maxWidth,
    maxHeight,
}: {
    src: string;
    alt: string;
    poster: string | null;
    encryptedFile?: EncryptedFileInfo & { url: string };
    mimetype: string | null;
    sizeHint: number | null;
    maxWidth: number;
    maxHeight: number;
}) {
    const videoBlobUrl = isObjectUrl(src) ? src : null;
    const [videoFailed, setVideoFailed] = useState(false);
    const [videoReady, setVideoReady] = useState(false);
    const [videoProgress, setVideoProgress] = useState<DownloadProgress | null>(
        null,
    );
    // A stream that broke retries once as a full, verified download.
    const [videoStreamBroke, setVideoStreamBroke] = useState(false);

    // The URL the action streams, or null when the element has a blob / is
    // not a video / has given up.
    const videoStreamUrl = !videoFailed && !isObjectUrl(src) ? src : null;
    // Encrypted files too small to be worth playing on unverified bytes (see
    // STREAM_ENCRYPTED_MIN_BYTES), or a browser with no MediaSource, take the
    // download-verify-play route.
    const videoForceBlob =
        videoStreamBroke ||
        (!!encryptedFile &&
            (typeof MediaSource === "undefined" ||
                sizeHint === null ||
                sizeHint < STREAM_ENCRYPTED_MIN_BYTES));

    function onVideoBroke() {
        if (!videoStreamUrl) return;
        if (!videoStreamBroke && !videoForceBlob) {
            setVideoStreamBroke(true);
            setVideoReady(false);
            return;
        }
        console.error("Failed to load video");
        setVideoFailed(true);
    }

    // ⚠ Exactly ONE video element is ever live (this viewer is a singleton in
    // the modal slot) and it is only ever created after the user clicked a
    // tile. It carries no `loop`, and above all NO onpause handler that calls
    // play() — that pattern fights the browser's own load-shedding forever and
    // pegged the main thread when it lived in LinkPreview. Do not add one back.

    // Zami: the video's own size, once its metadata is in; the box is 16:9
    // until then.
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(
        null,
    );
    const box = natural
        ? fitBox(natural.w, natural.h, maxWidth, maxHeight)
        : fitBox(maxWidth, (maxWidth * 9) / 16, maxWidth, maxHeight);

    return (
        <View
            className="relative flex items-center justify-center"
            style={{ maxWidth, maxHeight }}
        >
            {(videoBlobUrl || videoStreamUrl) && !videoFailed ? (
                <View className="relative">
                    <AuthedVideo
                        key={`${src}|${videoForceBlob}`}
                        src={videoBlobUrl ?? undefined}
                        authed={{
                            url: videoStreamUrl,
                            mimetype,
                            decrypt: encryptedFile,
                            expectedSize: sizeHint,
                            forceBlob: videoForceBlob,
                            onProgress: setVideoProgress,
                            onError: onVideoBroke,
                        }}
                        poster={poster}
                        className="rounded-lg bg-black"
                        style={box}
                        onLoadedMetadata={(w, h) => setNatural({ w, h })}
                        onCanPlay={() => setVideoReady(true)}
                        onError={onVideoBroke}
                    />
                    {videoStreamUrl && !videoReady ? (
                        <View
                            pointerEvents="none"
                            className="absolute inset-x-0 bottom-3 flex-row justify-center px-4"
                        >
                            <MediaProgress
                                label={t("common.loading")}
                                progress={videoProgress}
                            />
                        </View>
                    ) : null}
                </View>
            ) : (
                <View className="relative flex items-center justify-center rounded-lg bg-black/60 min-w-[12rem] min-h-[8rem]">
                    {poster ? (
                        <Image
                            source={mediaSource(poster)}
                            accessibilityLabel={alt || undefined}
                            contentFit="contain"
                            className="rounded-lg opacity-60"
                            style={{
                                width: box.width,
                                height: Math.min(box.height, maxHeight * 0.7),
                            }}
                        />
                    ) : null}
                    <View className="absolute inset-0 flex items-center justify-center">
                        {videoFailed ? (
                            <Text className="px-4 text-sm text-white text-center">
                                {t("lightbox.couldNotLoadThisVideoUse")}
                            </Text>
                        ) : (
                            <View className="px-4 w-full max-w-sm">
                                <MediaProgress
                                    label={t("common.loading")}
                                    progress={videoProgress}
                                />
                            </View>
                        )}
                    </View>
                </View>
            )}
        </View>
    );
}

interface AuthedVideoSrcParams {
    url: string | null;
    mimetype?: string | null;
    onError?: (err: unknown) => void;
    decrypt?: EncryptedFileInfo & { url: string };
    expectedSize?: number | null;
    onProgress?: (p: DownloadProgress) => void;
    forceBlob?: boolean;
}

/**
 * Zami: the `authedVideoSrc` action, as the `src` it would give the element.
 * React Native has no MediaSource to stream through, and needs none: the
 * player streams the URL itself, with the account's token in its request
 * headers (the shared Video adds them). A file that must be checked before it
 * plays (an encrypted one, or `forceBlob`) is downloaded whole, decrypted and
 * verified, and played from its object URL, as videoStream.ts's blob fallback
 * does.
 */
function useAuthedVideoSrc({
    url,
    mimetype,
    onError,
    decrypt,
    expectedSize,
    onProgress,
    forceBlob,
}: AuthedVideoSrcParams): string | null {
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
    if (!whole) return url;
    return blob?.key === url ? blob.url : null;
}

/**
 * Zami: the `<video>` element, `autoplay` with `controls` and `use:rememberVolume`:
 * its bare `src`, or what `use:authedVideoSrc` feeds it, with its `poster` over it
 * until the first frame. Its `onloadedmetadata` reads the video's size, which the
 * player reports as `onResize`.
 */
function AuthedVideo({
    src,
    authed,
    poster,
    className,
    style,
    onLoadedMetadata,
    onCanPlay,
    onError,
}: {
    src: string | null | undefined;
    authed: AuthedVideoSrcParams;
    poster: string | null;
    className: string;
    style: ViewStyle;
    onLoadedMetadata: (videoWidth: number, videoHeight: number) => void;
    onCanPlay: () => void;
    onError: () => void;
}) {
    const streamed = useAuthedVideoSrc(authed);
    return (
        <Video
            src={streamed ?? src}
            poster={poster}
            controls
            autoplay
            use={rememberVolume}
            className={className}
            style={style}
            onResize={onLoadedMetadata}
            onCanPlay={onCanPlay}
            onError={onError}
        />
    );
}
