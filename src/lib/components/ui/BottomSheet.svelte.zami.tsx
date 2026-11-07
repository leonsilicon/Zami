import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import {
    BackHandler,
    Pressable,
    StyleSheet,
    View,
    useWindowDimensions,
} from "react-native";
import {
    GestureDetector,
    ScrollView,
    usePanGesture,
    type PanGestureConfig,
} from "react-native-gesture-handler";
import Animated, {
    cancelAnimation,
    Easing,
    FadeIn,
    FadeOut,
    SlideInDown,
    SlideOutDown,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { t } from "$lib/i18n";
import {
    DISMISS_FRACTION,
    DISMISS_VELOCITY,
    ENGAGE_PX,
} from "$lib/actions/sheetDrag";
import { motionOK } from "$lib/utils/motionPreference";

interface Props {
    /** Dismiss the sheet (backdrop tap, Escape, or a swipe down). */
    onClose: () => void;
    children?: ReactNode;
}

// sheetDrag's settle animation and its upward damping (`RUBBER_BAND`).
const SETTLE_MS = 200;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const RUBBER_BAND = 0.25;

export interface SheetDragParams {
    onDismiss: () => void;
    /** Whether transitions may animate (reduced motion => false). */
    animate: boolean;
    /** How far the sheet is dragged down, in px. */
    offset: SharedValue<number>;
    /** The sheet's height, in px. */
    height: SharedValue<number>;
    /**
     * How far the sheet's content is scrolled: a drag engages only when it is
     * at the top, so scrolling a long list is left alone.
     */
    scrollY?: SharedValue<number>;
    /** Where on the view a drag can start (all of it by default). */
    hitSlop?: PanGestureConfig["hitSlop"];
}

// Zami: the `sheetDrag` action, as a pan gesture that runs on the UI thread. Its
// helpers (`dragOffset`, `shouldEngageSheetDrag`, `shouldDismissSheet`) are inlined as
// worklets, with its constants. The pan engages only for a mostly-vertical downward
// move (activeOffsetY / failOffsetX / failOffsetY), and an engaged drag cancels the
// press of a menu button under the finger, as sheetDrag's click suppression does.
// Exported for PickerDock, which drags its dock the same way.
export function useSheetDrag({
    onDismiss,
    animate,
    offset,
    height,
    scrollY,
    hitSlop,
}: SheetDragParams) {
    const engaged = useSharedValue(false);
    const start = useSharedValue(0);
    return usePanGesture({
        activeOffsetY: ENGAGE_PX,
        failOffsetY: -ENGAGE_PX,
        failOffsetX: [-ENGAGE_PX, ENGAGE_PX],
        hitSlop,
        onActivate: () => {
            "worklet";
            engaged.value = !scrollY || scrollY.value <= 0;
            if (!engaged.value) return;
            // A new drag during a settle takes over from wherever it is.
            cancelAnimation(offset);
            start.value = offset.value;
        },
        onUpdate: (e) => {
            "worklet";
            if (!engaged.value) return;
            const dy = start.value + e.translationY;
            // 1:1 downward, damped upward.
            offset.value = dy >= 0 ? dy : dy * RUBBER_BAND;
        },
        onDeactivate: (e) => {
            "worklet";
            if (!engaged.value) return;
            engaged.value = false;
            const sheetHeight = height.value || 1;
            // px/s here, px/ms in sheetDrag.
            const dismiss =
                !e.canceled &&
                (offset.value > sheetHeight * DISMISS_FRACTION ||
                    e.velocityY / 1000 > DISMISS_VELOCITY);
            const to = dismiss ? sheetHeight : 0;
            if (!animate) {
                offset.value = to;
                if (dismiss) scheduleOnRN(onDismiss);
                return;
            }
            offset.value = withTiming(
                to,
                { duration: SETTLE_MS, easing: EASE },
                (finished) => {
                    if (finished && dismiss) scheduleOnRN(onDismiss);
                },
            );
        },
    });
}

export default function BottomSheet({ onClose, children }: Props) {
    const insets = useSafeAreaInsets();
    const windowSize = useWindowDimensions();

    const offset = useSharedValue(0);
    const height = useSharedValue(1);
    const scrollY = useSharedValue(0);

    // A swipe has already carried the sheet off-screen and faded the
    // backdrop, so the outros would only hold the views for nothing.
    const [swiped, setSwiped] = useState(false);
    const duration = (ms: number) => (swiped || !motionOK() ? 0 : ms);

    // The outros are configured at render, so the swipe re-renders without
    // them before it closes the sheet.
    function dismissBySwipe() {
        setSwiped(true);
    }
    const close = useEffectEvent(() => onClose());
    useEffect(() => {
        if (swiped) close();
    }, [swiped]);

    // The focus trap's Escape, as Android's back button.
    useEffect(() => {
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                close();
                return true;
            },
        );
        return () => subscription.remove();
    }, []);

    const animate = motionOK();
    const backdropDrag = useSheetDrag({
        onDismiss: dismissBySwipe,
        animate,
        offset,
        height,
    });
    const sheetDrag = useSheetDrag({
        onDismiss: dismissBySwipe,
        animate,
        offset,
        height,
        scrollY,
    });

    // sheetDrag's onProgress: the backdrop fades as the sheet is dragged away.
    const backdropStyle = useAnimatedStyle(() => ({
        opacity:
            1 - Math.max(0, Math.min(1, offset.value / (height.value || 1))),
    }));
    const sheetStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: offset.value }],
    }));

    const fadeIn = duration(200);
    const fadeOut = duration(200);
    const flyIn = duration(260);
    const flyOut = duration(200);

    return (
        <>
            {/*
              The canonical mobile bottom sheet: a dimmed backdrop (tap to dismiss) and a
              full-bleed panel pinned to the bottom edge, with rounded top corners, a grab
              handle, and a focus trap whose Escape dismisses it. Callers own the Portal.

              The outros keep the sheet and backdrop around until they finish, whichever
              way the host closes it.

              Swiping down anywhere (the backdrop, or the sheet's handle, header, or body
              scrolled to the top) drags the sheet and dismisses past ~30% of its height or
              on a fast flick; see useSheetDrag.
            */}
            <GestureDetector gesture={backdropDrag}>
                <Animated.View
                    entering={fadeIn ? FadeIn.duration(fadeIn) : undefined}
                    exiting={fadeOut ? FadeOut.duration(fadeOut) : undefined}
                    className="absolute inset-0 z-50"
                >
                    <Animated.View
                        style={[StyleSheet.absoluteFill, backdropStyle]}
                    >
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("common.close")}
                            className="absolute inset-0 bg-black/40"
                            onPress={onClose}
                        />
                    </Animated.View>
                </Animated.View>
            </GestureDetector>
            <Animated.View
                entering={
                    flyIn
                        ? SlideInDown.duration(flyIn).easing(
                              Easing.out(Easing.cubic),
                          )
                        : undefined
                }
                exiting={
                    flyOut
                        ? SlideOutDown.duration(flyOut).easing(
                              Easing.in(Easing.cubic),
                          )
                        : undefined
                }
                pointerEvents="box-none"
                className="absolute bottom-0 start-0 end-0 z-50"
            >
                <GestureDetector gesture={sheetDrag}>
                    <Animated.View
                        accessibilityViewIsModal
                        onAccessibilityEscape={onClose}
                        onLayout={(e) => {
                            height.value = e.nativeEvent.layout.height || 1;
                        }}
                        style={[
                            { maxHeight: windowSize.height * 0.7 },
                            sheetStyle,
                        ]}
                        className="bg-discord-backgroundTertiary border-t border-discord-divider rounded-t-2xl shadow-2xl"
                    >
                        {/*
                          `bounces={false}` stands in for `overscroll-contain`: at the
                          top, a downward drag moves the sheet instead of overscrolling
                          its content.
                        */}
                        <ScrollView
                            simultaneousWith={sheetDrag}
                            bounces={false}
                            overScrollMode="never"
                            scrollEventThrottle={16}
                            onScroll={(e) => {
                                scrollY.value = e.nativeEvent.contentOffset.y;
                            }}
                            style={styles.scroll}
                            contentContainerStyle={{
                                paddingTop: 8,
                                paddingBottom: insets.bottom,
                            }}
                        >
                            <View className="relative z-10 w-10 h-1 bg-discord-divider rounded-full mx-auto mb-2" />
                            {children}
                        </ScrollView>
                    </Animated.View>
                </GestureDetector>
            </Animated.View>
        </>
    );
}

const styles = StyleSheet.create({
    // Sized by its content, up to the sheet's max height, and clipped to its
    // rounded top corners (inside the 1px border) as the web's scrolling sheet
    // is. The sheet itself doesn't clip: on iOS that would also clip its shadow.
    scroll: {
        flexGrow: 0,
        flexShrink: 1,
        borderTopLeftRadius: 15,
        borderTopRightRadius: 15,
    },
});
