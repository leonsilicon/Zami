import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
    cancelAnimation,
    Easing,
    makeMutable,
    SlideInDown,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type EntryExitAnimationFunction,
    type ExitAnimationsValues,
    type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { t } from "$lib/i18n";
import Portal from "$lib/components/ui/Portal.svelte";
import {
    DISMISS_FRACTION,
    DISMISS_VELOCITY,
    ENGAGE_PX,
} from "$lib/actions/sheetDrag";
import { motionOK } from "$lib/utils/motionPreference";

// Switching tabs (emoji → GIF) swaps one picker's dock for another's in the
// same tick; sliding the old one out and the new one in would look like
// the panel closed and reopened. A switch marks itself and both
// transitions run instantly.
let switchedAt = 0;
// Zami: the same mark, for the outgoing dock's outro on the UI thread (see slideOut).
const switchedAtUI = makeMutable(0);
export function markPickerSwitch() {
    switchedAt = performance.now();
    switchedAtUI.value = Date.now();
}
const justSwitched = () => performance.now() - switchedAt < 100;

// Zami: `out:fly={{ y: "100%", easing: cubicIn }}` as SlideOutDown does it, but
// deciding when it starts whether a switch makes it instant. Svelte reads the
// duration as the outro starts; Reanimated takes `exiting` from the last render,
// which a tab switch never gives the outgoing dock.
function slideOut(ms: number): EntryExitAnimationFunction {
    const easing = Easing.in(Easing.cubic);
    return (values: ExitAnimationsValues) => {
        "worklet";
        const instant = Date.now() - switchedAtUI.value < 100;
        return {
            initialValues: { originY: values.currentOriginY },
            animations: {
                originY: withTiming(
                    Math.max(
                        values.currentOriginY + values.windowHeight,
                        values.windowHeight,
                    ),
                    { duration: instant ? 0 : ms, easing },
                ),
            },
        };
    };
}

interface Props {
    /** Close the picker (outside tap or a swipe down). */
    onClose: () => void;
    /** Height of the on-screen keyboard, so the dock sits above it. */
    keyboardOffset: number;
    children?: ReactNode;
}

// sheetDrag's settle animation and its upward damping (`RUBBER_BAND`).
const SETTLE_MS = 200;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const RUBBER_BAND = 0.25;
// Zami: how far down the dock a drag can start: about the picker's tab and search
// rows. See useDockDrag.
const HEADER_PX = 96;

interface DockDragParams {
    onDismiss: () => void;
    /** Whether transitions may animate (reduced motion => false). */
    animate: boolean;
    /** How far the dock is dragged down, in px. */
    offset: SharedValue<number>;
    /** The dock's height, in px. */
    height: SharedValue<number>;
    /** Only a drag that starts this far from the top of the view engages. */
    headerPx?: number;
}

// Zami: the `sheetDrag` action, as a pan gesture that runs on the UI thread, like
// BottomSheet's useSheetDrag (its helpers inlined as worklets, with its constants).
// It engages only for a mostly-vertical downward move, and an engaged drag cancels
// the press of a button under the finger, as sheetDrag's click suppression does.
// Not ported: a drag from the picker's grid when it is scrolled to the top. The grid
// is the picker's own list, whose scroll position the dock can't see; a drag there
// would scroll it and move the dock at once, so on the dock only the header rows
// (`headerPx`) drag it.
function useDockDrag({
    onDismiss,
    animate,
    offset,
    height,
    headerPx,
}: DockDragParams) {
    const start = useSharedValue(0);
    return usePanGesture({
        activeOffsetY: ENGAGE_PX,
        failOffsetY: -ENGAGE_PX,
        failOffsetX: [-ENGAGE_PX, ENGAGE_PX],
        hitSlop:
            headerPx === undefined ? undefined : { top: 0, height: headerPx },
        onActivate: () => {
            "worklet";
            // A new drag during a settle takes over from wherever it is.
            cancelAnimation(offset);
            start.value = offset.value;
        },
        onUpdate: (e) => {
            "worklet";
            const dy = start.value + e.translationY;
            // 1:1 downward, damped upward.
            offset.value = dy >= 0 ? dy : dy * RUBBER_BAND;
        },
        onDeactivate: (e) => {
            "worklet";
            const dockHeight = height.value || 1;
            // px/s here, px/ms in sheetDrag.
            const dismiss =
                !e.canceled &&
                (offset.value > dockHeight * DISMISS_FRACTION ||
                    e.velocityY / 1000 > DISMISS_VELOCITY);
            const to = dismiss ? dockHeight : 0;
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

export default function PickerDock({
    onClose,
    keyboardOffset,
    children,
}: Props) {
    const offset = useSharedValue(0);
    const height = useSharedValue(1);

    // A swipe has already carried the dock off-screen.
    const [swiped, setSwiped] = useState(false);
    const duration = (ms: number) =>
        swiped || justSwitched() || !motionOK() ? 0 : ms;

    // Zami: the outros are configured at render, so the swipe re-renders without
    // them before it closes the dock (as BottomSheet does).
    function dismissBySwipe() {
        setSwiped(true);
    }
    const close = useEffectEvent(() => onClose());
    useEffect(() => {
        if (swiped) close();
    }, [swiped]);

    const animate = motionOK();
    const backdropDrag = useDockDrag({
        onDismiss: dismissBySwipe,
        animate,
        offset,
        height,
    });
    const dockDrag = useDockDrag({
        onDismiss: dismissBySwipe,
        animate,
        offset,
        height,
        headerPx: HEADER_PX,
    });
    const dockStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: offset.value }],
    }));

    const flyIn = duration(240);
    const flyOut = duration(180);

    return (
        // The touch emoji / sticker / GIF picker: docked at the bottom where the
        // keyboard goes, like a bottom sheet but without dimming the conversation.
        // Slides in and out, and a swipe down (on the picker's header, its grid when
        // scrolled to the top, or anywhere above it) drags it away; see sheetDrag.
        // Portalled because the GIF and sticker buttons' wrappers go display:none the
        // moment their picker closes, which would hide the outro.
        <Portal>
            <GestureDetector gesture={backdropDrag}>
                <Animated.View className="absolute inset-0 z-40">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("common.close")}
                        className="absolute inset-0 cursor-default"
                        onPress={onClose}
                    />
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
                exiting={flyOut ? slideOut(flyOut) : undefined}
                pointerEvents="box-none"
                className="absolute start-0 end-0 z-50"
                style={{ bottom: keyboardOffset }}
            >
                <GestureDetector gesture={dockDrag}>
                    <Animated.View
                        onLayout={(e) => {
                            height.value = e.nativeEvent.layout.height || 1;
                        }}
                        style={[styles.dock, dockStyle]}
                    >
                        {children}
                    </Animated.View>
                </GestureDetector>
            </Animated.View>
        </Portal>
    );
}

const styles = StyleSheet.create({
    dock: { width: "100%" },
});
