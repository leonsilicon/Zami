import { Range } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import type { Room } from "matrix-js-sdk";
import { useEffect, useEffectEvent, useState } from "react";
import {
    BackHandler,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
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
import { openModal, clearModalIfOwner } from "$lib/stores/interface.svelte";
import { getAvailableSoundPacks } from "$lib/matrix/soundboard";
import { playSoundboardSound } from "$lib/matrix/client";
import { auth } from "$lib/stores/auth.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import {
    participantAudioFor,
    setUserSoundVolume,
} from "$lib/stores/voiceCall.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import { MAX_SOUND_VOLUME, type Sound } from "$lib/utils/soundboard";

interface Props {
    room: Room;
    x: number;
    y: number;
    touch?: boolean;
    onClose: () => void;
}

export default function SoundboardPopover({
    room,
    x,
    y,
    touch = false,
    onClose,
}: Props) {
    const packs = useRune(() => {
        void roomsState.roomsTick;
        return getAvailableSoundPacks(room);
    }, [room]);
    const myId = useRune(() => auth.userId ?? "");
    const myLevel = useRune(() => {
        void settingsState.participantAudio;
        return participantAudioFor(myId).soundVolume;
    }, [myId]);
    const [failed, setFailed] = useState(false);

    const close = useEffectEvent(() => onClose());
    useEffect(() => {
        const token = openModal("soundboard", () => close());
        return () => {
            clearModalIfOwner(token);
        };
    }, []);

    async function play(sound: Sound) {
        // Zami: the clip goes out over the LiveKit call's data channel, and our
        // own copy plays through Zam's Web Audio graph (livekitCall.ts
        // playSoundboardClip, on react-native-audio-api). A clip not heard
        // before downloads whole, then plays (soundStream.ts: no MediaSource).
        setFailed(!(await playSoundboardSound(sound)));
    }

    // Same placement as ScreenShareQualityPopover: clamp into the viewport and
    // flip up when the anchor sits near the bottom edge.
    // Zami: the `positionMenu` action, as a measuring pass: the panel lays out
    // hidden at the top-left, and its size places it. A new anchor measures
    // again, so a prior clamp doesn't leak.
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

    // The focus trap's Escape, as Android's back button (VoiceOver's escape
    // gesture is the panel's onAccessibilityEscape).
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

    const body = () => (
        <View className="gap-3">
            <View>
                <View className="flex-row items-center justify-between gap-2">
                    <Text className="text-xs text-discord-textMuted uppercase font-semibold tracking-wide">
                        {t("soundboard.yourVolume")}
                    </Text>
                    <Text className="text-xs text-discord-textMuted tabular-nums">
                        {Math.round(myLevel * 100)}%
                    </Text>
                </View>
                <Range
                    min={0}
                    max={MAX_SOUND_VOLUME * 100}
                    step={1}
                    value={Math.round(myLevel * 100)}
                    accessibilityLabel={t("soundboard.yourVolume")}
                    onChange={(value) => setUserSoundVolume(myId, value / 100)}
                    className="w-full mt-1.5"
                />
            </View>
            {failed && (
                <Text className="text-xs text-discord-danger">
                    {t("soundboard.sendFailed")}
                </Text>
            )}
            {packs.map((pack) => (
                <View key={pack.id} className="gap-1.5">
                    <Text
                        accessibilityRole="header"
                        numberOfLines={1}
                        className="text-xs text-discord-textMuted uppercase font-semibold tracking-wide truncate"
                    >
                        {pack.name}
                    </Text>
                    <View className="flex-row flex-wrap gap-1.5">
                        {/* Zami: `title` (the sound's description) is its
                            accessibility hint. */}
                        {pack.sounds.map((sound) => (
                            <Pressable
                                key={sound.name}
                                accessibilityRole="button"
                                accessibilityHint={sound.body}
                                onPress={() => void play(sound)}
                                className="max-w-full px-3 py-1.5 rounded bg-discord-backgroundSecondary hover:bg-discord-accent active:bg-discord-accent transition-colors"
                            >
                                <Text
                                    numberOfLines={1}
                                    className="truncate text-sm text-discord-textPrimary"
                                >
                                    {sound.name}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            ))}
            {packs.length === 0 && (
                <Text className="text-sm text-discord-textMuted">
                    {t("soundboard.empty")}
                </Text>
            )}
        </View>
    );

    const panelClass =
        "absolute z-50 w-80 rounded-lg bg-discord-backgroundTertiary border border-discord-divider shadow-xl";

    return (
        <Portal>
            {touch ? (
                <BottomSheet onClose={onClose}>
                    <View className="p-4">{body()}</View>
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
                            entering={motionOK() ? scaleIn(120) : undefined}
                            role="dialog"
                            accessibilityViewIsModal
                            accessibilityLabel={t("soundboard.title")}
                            onAccessibilityEscape={onClose}
                            className={panelClass}
                            style={placed}
                        >
                            <ScrollView style={styles.scroll}>
                                <View className="p-3">{body()}</View>
                            </ScrollView>
                        </Animated.View>
                    ) : (
                        <View
                            pointerEvents="none"
                            className={panelClass}
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
                            <View className="p-3">{body()}</View>
                        </View>
                    )}
                </View>
            )}
        </Portal>
    );
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

const styles = StyleSheet.create({
    measuring: { left: 0, top: 0, opacity: 0 },
    // Sized by its content, up to the panel's max height.
    scroll: { flexGrow: 0, flexShrink: 1 },
});
