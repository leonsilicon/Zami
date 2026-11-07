import { useEffect, useEffectEvent, useState } from "react";
import {
    BackHandler,
    Pressable,
    Text,
    View,
    useWindowDimensions,
    type LayoutChangeEvent,
} from "react-native";
import Animated, { Easing, Keyframe } from "react-native-reanimated";
import { t } from "$lib/i18n";
import Portal from "$lib/components/ui/Portal.svelte";
import BottomSheet from "$lib/components/ui/BottomSheet.svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import { motionOK } from "$lib/utils/motionPreference";
import type { ModalId } from "$lib/stores/interface.svelte";
import { openModal, clearModalIfOwner } from "$lib/stores/interface.svelte";

interface Reactor {
    userId: string;
    name: string;
    avatarUrl: string | null;
}

interface Props {
    reactors: Reactor[];
    overflow: number;
    label?: string;
    touch?: boolean;
    x?: number;
    y?: number;
    onClose?: () => void;
    /**
     * Desktop-only: render a transparent full-screen backdrop behind the
     * floating card so a click OUTSIDE it dismisses. Needed when the card is
     * opened on click (e.g. the read-receipt reader list) rather than hover —
     * the hover callers (reactions) leave this false and are unaffected.
     */
    desktopDismiss?: boolean;
    /** Claim the modal slot so Escape/back dismiss centrally. */
    modalId?: ModalId;
    /** Accessible label for the desktop dialog. */
    dialogLabel?: string;
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

export default function ReactorPopover({
    reactors,
    overflow,
    label = "",
    touch = false,
    x = 0,
    y = 0,
    onClose,
    desktopDismiss = false,
    modalId = undefined,
    dialogLabel = undefined,
}: Props) {
    const close = useEffectEvent(() => onClose?.());
    useEffect(() => {
        if (!modalId) return;
        const token = openModal(modalId, () => close());
        return () => {
            clearModalIfOwner(token);
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- onMount.
    }, []);

    // Clamp a fixed, centered card to the viewport and place it ABOVE the
    // anchor (the reaction pill). Mirrors CallParticipantMenu.positionMenu but
    // anchors the card's bottom edge to `y` and centers on `x`.
    // Zami: the card is hidden until its first layout gives its size, then
    // placed from that and the window's size.
    const windowSize = useWindowDimensions();
    const [cardSize, setCardSize] = useState<{ w: number; h: number } | null>(
        null,
    );
    function positionCard(pos: { x: number; y: number }) {
        if (!cardSize) return { left: 0, top: 0, opacity: 0 };
        const vw = windowSize.width;
        const vh = windowSize.height;
        const { w, h } = cardSize;
        let left = pos.x - w / 2;
        if (left + w > vw - 4) left = vw - w - 4;
        if (left < 4) left = 4;
        let top = pos.y - h - 8; // above the pill
        if (top < 4) top = pos.y + 24; // no room above → below
        if (top + h > vh - 4) top = Math.max(4, vh - h - 4);
        return { left, top };
    }
    function onCardLayout(e: LayoutChangeEvent) {
        const { width, height } = e.nativeEvent.layout;
        if (cardSize?.w !== width || cardSize?.h !== height)
            setCardSize({ w: width, h: height });
    }

    // The focus trap's Escape, as Android's back button (the desktopDismiss
    // card only; the others are dismissed centrally or by the sheet).
    useEffect(() => {
        if (touch || !desktopDismiss) return;
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                close();
                return true;
            },
        );
        return () => subscription.remove();
    }, [touch, desktopDismiss]);

    const rows = () => (
        <View role="list">
            {reactors.map((r) => (
                <View
                    key={r.userId}
                    className="flex-row items-center gap-2 px-3 py-1"
                    role="listitem"
                >
                    <Avatar
                        src={r.avatarUrl}
                        name={r.name}
                        id={r.userId}
                        size={20}
                    />
                    <Text
                        numberOfLines={1}
                        className="flex-shrink text-sm text-discord-textPrimary truncate"
                    >
                        {r.name}
                    </Text>
                </View>
            ))}
            {overflow > 0 && (
                <Text className="px-3 py-1 text-xs text-discord-textMuted">
                    {t("reactorPopover.more", { overflow })}
                </Text>
            )}
        </View>
    );

    const duration = motionOK() ? 120 : 0;

    if (touch) {
        return (
            <Portal>
                <BottomSheet onClose={() => onClose?.()}>
                    {label ? (
                        <Text className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-discord-textMuted border-b border-discord-divider">
                            {t("reactorPopover.reactedWith", { label })}
                        </Text>
                    ) : dialogLabel && !label ? (
                        <Text className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-discord-textMuted border-b border-discord-divider">
                            {dialogLabel}
                        </Text>
                    ) : null}
                    {/* Zami: the sheet scrolls its content itself (up to 70% of
                        the screen) rather than this list at 50vh: a scroll box
                        inside it would scroll and drag the sheet at once. */}
                    <View className="py-1">{rows()}</View>
                </BottomSheet>
            </Portal>
        );
    }
    return (
        <Portal>
            {desktopDismiss ? (
                <>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("common.close")}
                        className="absolute inset-0 z-40"
                        onPress={() => onClose?.()}
                    />
                    <Animated.View
                        onLayout={onCardLayout}
                        style={positionCard({ x, y })}
                        entering={duration ? scaleIn(duration) : undefined}
                        className="absolute z-50 bg-discord-backgroundTertiary border border-discord-divider rounded-lg shadow-xl py-1 min-w-40 max-w-64"
                        role="dialog"
                        accessibilityViewIsModal
                        onAccessibilityEscape={() => onClose?.()}
                        accessibilityLabel={
                            dialogLabel || t("reactorPopover.userList")
                        }
                    >
                        {rows()}
                    </Animated.View>
                </>
            ) : (
                <Animated.View
                    onLayout={onCardLayout}
                    style={positionCard({ x, y })}
                    entering={duration ? scaleIn(duration) : undefined}
                    pointerEvents="none"
                    className="absolute z-50 bg-discord-backgroundTertiary border border-discord-divider rounded-lg shadow-xl py-1 min-w-40 max-w-64"
                >
                    {rows()}
                </Animated.View>
            )}
        </Portal>
    );
}
