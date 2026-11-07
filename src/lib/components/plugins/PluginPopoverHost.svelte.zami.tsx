import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useState } from "react";
import {
    BackHandler,
    Pressable,
    Text,
    useWindowDimensions,
    type LayoutChangeEvent,
} from "react-native";
import Animated, { Easing, Keyframe } from "react-native-reanimated";
import { t } from "$lib/i18n";
import Portal from "$lib/components/ui/Portal.svelte";
import { motionOK } from "$lib/utils/motionPreference";
import { closeModal } from "$lib/stores/interface.svelte";
import { pluginPopover } from "$lib/plugins/pluginPopover.svelte";

interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Zami: a plugin's anchor is the element it was opened from. Measured with
 *  `measureInWindow` when it is a React Native view; null otherwise. */
type Measurable = {
    measureInWindow?: (
        callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
};

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

export default function PluginPopoverHost() {
    const current = useRune(() => pluginPopover.current);
    const windowSize = useWindowDimensions();

    // Position the card near its anchor: prefer directly above the anchor;
    // fall back below when there is no room. Clamp inside the viewport. Mirrors
    // ReactorPopover.svelte's positionCard, driven by the anchor's rect.
    // Zami: the anchor's rect comes from `measureInWindow`, and the card's size
    // from its first layout; it stays hidden until it has both. An anchor that
    // can't be measured centers the card.
    const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
    const [cardSize, setCardSize] = useState<{ w: number; h: number } | null>(
        null,
    );
    const anchor = current?.anchor;
    useEffect(() => {
        setAnchorRect(null);
        setCardSize(null);
        const measurable = anchor as Measurable | undefined;
        if (typeof measurable?.measureInWindow !== "function") return;
        measurable.measureInWindow((x, y, width, height) =>
            setAnchorRect({ left: x, top: y, width, height }),
        );
    }, [anchor]);
    function positionCard() {
        if (!cardSize) return { left: 0, top: 0, opacity: 0 };
        const vw = windowSize.width;
        const vh = windowSize.height;
        const { w, h } = cardSize;
        const r = anchorRect ?? {
            left: vw / 2,
            top: vh / 2 + h / 2 + 8,
            width: 0,
            height: 0,
        };
        let left = r.left + r.width / 2 - w / 2;
        if (left + w > vw - 8) left = vw - w - 8;
        if (left < 8) left = 8;
        let top = r.top - h - 8; // above the anchor
        if (top < 8) top = r.top + r.height + 8; // no room above → below
        if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
        return { left, top };
    }
    function onCardLayout(e: LayoutChangeEvent) {
        const { width, height } = e.nativeEvent.layout;
        if (cardSize?.w !== width || cardSize?.h !== height)
            setCardSize({ w: width, h: height });
    }

    // The focus trap's Escape, as Android's back button.
    const open = !!current;
    useEffect(() => {
        if (!open) return;
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                closeModal();
                return true;
            },
        );
        return () => subscription.remove();
    }, [open]);

    if (!current) return null;
    return (
        <Portal>
            <Pressable
                accessibilityRole="none"
                className="absolute inset-0 z-40"
                onPress={closeModal}
            />
            {/* positionCard BEFORE focusTrap: both defer to rAF, and the card is
                visibility:hidden until positionCard's frame runs. The other order
                tries to focus a hidden element, which silently fails. */}
            <Animated.View
                role="dialog"
                accessibilityViewIsModal
                onAccessibilityEscape={closeModal}
                accessibilityLabel={
                    current.label ?? t("pluginPopoverHost.plugin")
                }
                onLayout={onCardLayout}
                style={positionCard()}
                entering={motionOK() ? scaleIn(120) : undefined}
                className="absolute z-50 bg-discord-backgroundTertiary border border-discord-divider rounded-lg shadow-xl overflow-hidden"
            >
                {/* Zami: not ported: the plugin's content. `pluginMount` hands
                    `current.render` an HTMLElement to build DOM into, and React
                    Native has none; the card shows the plugin's name instead. */}
                <Text className="px-3 py-2 text-sm text-discord-textMuted">
                    {current.label ?? t("pluginPopoverHost.plugin")}
                </Text>
            </Animated.View>
        </Portal>
    );
}
