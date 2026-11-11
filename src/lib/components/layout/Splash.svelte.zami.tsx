import { Spin } from "@-/com.leonsilicon.zami.rn";
import {
    currentStartupStep,
    subscribeStartup,
} from "@-/com.leonsilicon.zami.startup";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { t } from "$lib/i18n";

// Shown while a stored session is being silently restored, on the same
// tertiary background as the login card so the restore reads as one
// continuous surface — no login-card flash before the shell appears.
export default function Splash({
    message = null,
}: {
    message?: string | null;
}) {
    return (
        <View className="flex-1 flex-row items-center justify-center bg-discord-backgroundTertiary p-4">
            {/* Zami: a column, so the launch step can go under the message. */}
            <View className="items-center">
                <View className="flex-row items-center gap-3">
                    <Spin className="w-6 h-6 border-2 border-discord-textMuted border-t-transparent rounded-full" />
                    <Text className="text-discord-textMuted">
                        {message ?? t("splash.restoringSession")}
                    </Text>
                </View>
                <StartupStep />
            </View>
        </View>
    );
}

/**
 * Zami: once a launch has taken more than a second, the step it is on and how long
 * it has taken (@-/com.leonsilicon.zami.startup). If the JS thread is blocked, the
 * count stops, so the step shown is the one blocking it.
 */
function StartupStep() {
    const step = useSyncExternalStore(
        subscribeStartup,
        () => currentStartupStep().step,
    );
    const [elapsed, setElapsed] = useState(() => currentStartupStep().elapsed);
    useEffect(() => {
        const timer = setInterval(
            () => setElapsed(currentStartupStep().elapsed),
            250,
        );
        return () => clearInterval(timer);
    }, []);
    if (elapsed < 1000) return null;
    return (
        <Text className="mt-3 text-xs text-discord-textMuted">
            {`${step} · ${(elapsed / 1000).toFixed(1)} s`}
        </Text>
    );
}
