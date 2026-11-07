import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { X } from "lucide-svelte";
import { useEffect } from "react";
import { AccessibilityInfo, Pressable, Text, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import Animated, { Easing, Keyframe } from "react-native-reanimated";
import { t } from "$lib/i18n";
import { toastsState, dismissToast } from "$lib/stores/toasts.svelte";
import { motionOK } from "$lib/utils/motionPreference";

// Svelte's `fly` with `y: 12` (cubicOut), in and out.
function flyIn(duration: number) {
    return new Keyframe({
        0: { opacity: 0, transform: [{ translateY: 12 }] },
        100: {
            opacity: 1,
            transform: [{ translateY: 0 }],
            easing: Easing.out(Easing.cubic),
        },
    }).duration(duration);
}
function flyOut(duration: number) {
    return new Keyframe({
        0: { opacity: 1, transform: [{ translateY: 0 }] },
        100: {
            opacity: 0,
            transform: [{ translateY: 12 }],
            easing: Easing.out(Easing.cubic),
        },
    }).duration(duration);
}

export default function ErrorToasts() {
    const toasts = useRune(() => toastsState.toasts);
    const duration = motionOK() ? 150 : 0;

    // The web's `role="alert"`/`"status"` live regions announce a new toast;
    // React Native's don't announce a view that just appeared, so say it.
    const latest = toasts.at(-1);
    const latestId = latest?.id;
    const latestMessage = latest?.message;
    useEffect(() => {
        if (latestMessage)
            AccessibilityInfo.announceForAccessibility(latestMessage);
    }, [latestId, latestMessage]);

    if (!toasts.length) return null;
    // Zam's stack is `position: fixed` at the bottom of the viewport; here it is
    // rendered at the app root through a Portal, and rides above the on-screen
    // keyboard (as it does in a webview the keyboard resizes) so a failure
    // while typing is seen.
    return (
        <Portal>
            <KeyboardStickyView
                pointerEvents="box-none"
                className="absolute bottom-6 start-0 end-0 z-[100] flex-col items-center gap-2"
            >
                {toasts.map((toast) => (
                    // Definite width on mobile (w-[90%] of the full-width stack, so
                    // 90vw) so the toast never shrink-wraps to a long action button
                    // and starves the message; desktop keeps shrink-to-fit capped at
                    // max-w-md. The action sits on its own row below the message, so
                    // any label length is safe.
                    <Animated.View
                        key={toast.id}
                        entering={duration ? flyIn(duration) : undefined}
                        exiting={duration ? flyOut(duration) : undefined}
                        role={toast.tone === "accent" ? "status" : "alert"}
                        className={`w-[90%] sm:w-auto sm:max-w-md rounded-lg border-s-4 ${
                            toast.tone === "accent"
                                ? "border-discord-accent"
                                : "border-discord-danger"
                        } bg-discord-backgroundTertiary shadow-lg px-4 py-2.5`}
                    >
                        <View className="flex-row items-start gap-3">
                            <Text className="min-w-0 flex-1 text-discord-textPrimary text-sm">
                                {toast.message}
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t("errorToasts.dismiss")}
                                hitSlop={8}
                                className="-me-1 shrink-0 transition-colors"
                                onPress={() => dismissToast(toast.id)}
                            >
                                <X
                                    size={16}
                                    className="text-discord-textMuted"
                                />
                            </Pressable>
                        </View>
                        {toast.action && (
                            <View className="mt-2 flex-row justify-end">
                                <Pressable
                                    accessibilityRole="button"
                                    className="shrink-0 px-2 py-1 rounded bg-discord-messageHover hover:bg-discord-accent transition-colors"
                                    onPress={() => {
                                        const action = toast.action;
                                        dismissToast(toast.id);
                                        action?.run();
                                    }}
                                >
                                    <Text className="text-discord-textPrimary text-xs">
                                        {toast.action.label}
                                    </Text>
                                </Pressable>
                            </View>
                        )}
                    </Animated.View>
                ))}
            </KeyboardStickyView>
        </Portal>
    );
}
