import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
    Easing,
    makeMutable,
    SlideInDown,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type EntryExitAnimationFunction,
    type ExitAnimationsValues,
} from "react-native-reanimated";
import { t } from "$lib/i18n";
import Portal from "$lib/components/ui/Portal.svelte";
import { useSheetDrag } from "$lib/components/ui/BottomSheet.svelte";
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

// Zami: how far down the dock a drag can start: about the picker's tab and search
// rows. Not ported: a drag from the picker's grid when it is scrolled to the top. The
// grid is the picker's own list, whose scroll position the dock can't see; a drag there
// would scroll it and move the dock at once, so on the dock only the header rows drag
// it (BottomSheet's useSheetDrag, the `sheetDrag` action as a pan gesture).
const HEADER_PX = 96;

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
    const backdropDrag = useSheetDrag({
        onDismiss: dismissBySwipe,
        animate,
        offset,
        height,
    });
    const dockDrag = useSheetDrag({
        onDismiss: dismissBySwipe,
        animate,
        offset,
        height,
        hitSlop: { top: 0, height: HEADER_PX },
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
