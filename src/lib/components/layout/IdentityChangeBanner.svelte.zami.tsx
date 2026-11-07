import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "$lib/i18n";
// MSC4153: alert when a cross-signing identity changes. Own-account
// changes need re-verification (Settings → Sessions); another user's
// change blocks encrypted sends to them until accepted here.
import { identityAlertState } from "$lib/stores/identityAlerts.svelte";
import {
    acceptIdentityChange,
    withdrawVerificationRequirement,
} from "$lib/matrix/crypto";

export default function IdentityChangeBanner() {
    const insets = useSafeAreaInsets();

    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const visible = useRune(
        () => identityAlertState.alerts.filter((a) => !dismissed.has(a.userId)),
        [dismissed],
    );

    function dismiss(userId: string) {
        setDismissed(new Set([...dismissed, userId]));
    }

    if (!(visible.length > 0)) return null;
    // Zami: `fixed` → a Portal at the app root. The app draws under the status
    // bar, so `top-16` is measured from below it; the side padding is
    // `max-w-[calc(100vw-2rem)]`.
    return (
        <Portal>
            <View
                pointerEvents="box-none"
                className="absolute inset-x-0 z-50 items-center px-4"
                style={{ top: 64 + insets.top }}
            >
                <View className="max-w-full flex-col gap-2">
                    {visible.map((alert) => (
                        <View
                            key={alert.userId}
                            accessibilityRole="alert"
                            className="flex-row items-center gap-3 rounded-lg border border-discord-danger/50 bg-discord-backgroundSecondary px-4 py-2.5 shadow-lg"
                        >
                            <Text className="flex-shrink min-w-0 text-sm text-discord-textPrimary">
                                {alert.own
                                    ? t("identityChange.own")
                                    : t("identityChange.other", {
                                          user: alert.userId,
                                      })}
                            </Text>
                            {!alert.own && (
                                <>
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() =>
                                            void acceptIdentityChange(
                                                alert.userId,
                                            )
                                        }
                                        className="flex-shrink-0 rounded bg-discord-accent px-3 py-1 hover:opacity-90"
                                    >
                                        <Text className="text-sm font-medium text-white">
                                            {t("identityChange.accept")}
                                        </Text>
                                    </Pressable>
                                    {alert.wasVerified && (
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() =>
                                                void withdrawVerificationRequirement(
                                                    alert.userId,
                                                )
                                            }
                                            className="flex-shrink-0 rounded bg-discord-backgroundTertiary px-3 py-1"
                                        >
                                            <Text className="text-sm text-discord-textPrimary">
                                                {t("identityChange.withdraw")}
                                            </Text>
                                        </Pressable>
                                    )}
                                </>
                            )}
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => dismiss(alert.userId)}
                                accessibilityLabel={t("identityChange.dismiss")}
                                className="flex-shrink-0"
                            >
                                <Text className="text-discord-textMuted">
                                    ✕
                                </Text>
                            </Pressable>
                        </View>
                    ))}
                </View>
            </View>
        </Portal>
    );
}
