import { useEffect, useEffectEvent, useState } from "react";
import {
    BackHandler,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
    useWindowDimensions,
    type LayoutRectangle,
    type ViewStyle,
} from "react-native";
import Animated, { Easing, Keyframe } from "react-native-reanimated";
import { t } from "$lib/i18n";
import Portal from "$lib/components/ui/Portal.svelte";
import BottomSheet from "$lib/components/ui/BottomSheet.svelte";
import { motionOK } from "$lib/utils/motionPreference";
import ScreenShareQualityChips from "./ScreenShareQualityChips.svelte";
import { setScreenShareQuality } from "$lib/matrix/client";
import { openModal, clearModalIfOwner } from "$lib/stores/interface.svelte";

interface Props {
    x: number;
    y: number;
    touch?: boolean;
    onClose: () => void;
}

// Svelte's `scale` transition with `start: 0.92, opacity: 0` (cubicOut).
function scaleIn(duration: number) {
    return new Keyframe({
        0: { opacity: 0, transform: [{ scale: 0.92 }] },
        100: {
            opacity: 1,
            transform: [{ scale: 1 }],
            easing: Easing.out(Easing.cubic),
        },
    }).duration(duration);
}

// Zami: not ported: screen sharing on iOS (it needs a Broadcast Upload
// Extension, see screenShareSupportedHere), where no share runs and
// setScreenShareQuality (which retunes the running share's track) finds none;
// the chips still save the quality settings a share would use.
export default function ScreenShareQualityPopover({
    x,
    y,
    touch = false,
    onClose,
}: Props) {
    const close = useEffectEvent(() => onClose());
    useEffect(() => {
        const token = openModal("screen-share-quality", () => close());
        return () => {
            clearModalIfOwner(token);
        };
    }, []);

    // Zami: the focus trap's Escape, as Android's back button (VoiceOver's
    // escape gesture is the popover's onAccessibilityEscape). The sheet has
    // its own.
    useEffect(() => {
        if (touch) return;
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                close();
                return true;
            },
        );
        return () => subscription.remove();
    }, [touch]);

    // Copied verbatim from CallParticipantMenu.svelte:83-121 — clamps into the
    // viewport and flips up when the anchor (a share button near the bottom
    // edge) would push the popover off-screen.
    // Zami: the `positionMenu` action, as a measuring pass (as in
    // CallParticipantMenu's translation): the popover lays out hidden at the
    // top-left, and its size places it. New x/y measure again.
    const viewport = useWindowDimensions();
    const [placed, setPlaced] = useState<ViewStyle | null>(null);
    const [placedFor, setPlacedFor] = useState({ x, y });
    if (placedFor.x !== x || placedFor.y !== y) {
        setPlacedFor({ x, y });
        setPlaced(null);
    }
    function positionMenu(
        p: { x: number; y: number },
        size: LayoutRectangle,
    ): ViewStyle {
        const vw = viewport.width;
        const vh = viewport.height;
        const w = size.width;
        const h = size.height;
        let left = Math.min(p.x, vw - w - 4);
        if (left < 4) left = 4;
        let top = p.y;
        if (top + h > vh - 4) top = p.y - h;
        if (top < 4) top = 4;
        const maxH = vh - top - 4;
        return { left, top, maxHeight: h > maxH ? maxH : undefined };
    }

    const popoverClass =
        "absolute z-50 w-64 rounded-lg bg-discord-backgroundTertiary border border-discord-divider shadow-xl overflow-hidden";
    const duration = motionOK() ? 120 : 0;

    return (
        <Portal>
            {touch ? (
                <BottomSheet onClose={onClose}>
                    <View className="p-4 gap-4">
                        <ScreenShareQualityChips
                            onQualityChange={setScreenShareQuality}
                        />
                    </View>
                </BottomSheet>
            ) : (
                // Zami: `dismissOnOutsidePointer` → a backdrop filling the layer.
                <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("common.close")}
                        className="absolute inset-0"
                        onPress={onClose}
                    />
                    {placed ? (
                        <Animated.View
                            entering={duration ? scaleIn(duration) : undefined}
                            role="dialog"
                            accessibilityViewIsModal
                            accessibilityLabel={t(
                                "screenShareQualityPopover.screenShareQuality",
                            )}
                            onAccessibilityEscape={onClose}
                            className={popoverClass}
                            style={placed}
                        >
                            <ScrollView
                                style={styles.scroll}
                                contentContainerClassName="p-3 gap-3"
                            >
                                <ScreenShareQualityChips
                                    onQualityChange={setScreenShareQuality}
                                />
                            </ScrollView>
                        </Animated.View>
                    ) : (
                        <View
                            pointerEvents="none"
                            className={popoverClass}
                            style={styles.measuring}
                            onLayout={(e) =>
                                setPlaced(
                                    positionMenu(
                                        { x, y },
                                        e.nativeEvent.layout,
                                    ),
                                )
                            }
                        >
                            <View className="p-3 gap-3">
                                <ScreenShareQualityChips
                                    onQualityChange={setScreenShareQuality}
                                />
                            </View>
                        </View>
                    )}
                </View>
            )}
        </Portal>
    );
}

const styles = StyleSheet.create({
    measuring: { left: 0, top: 0, opacity: 0 },
    // Sized by its content, up to the popover's max height.
    scroll: { flexGrow: 0, flexShrink: 1 },
});
