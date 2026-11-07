import { Spin } from "@-/com.leonsilicon.zami.rn";
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
            <View className="flex-row items-center gap-3">
                <Spin className="w-6 h-6 border-2 border-discord-textMuted border-t-transparent rounded-full" />
                <Text className="text-discord-textMuted">
                    {message ?? t("splash.restoringSession")}
                </Text>
            </View>
        </View>
    );
}
