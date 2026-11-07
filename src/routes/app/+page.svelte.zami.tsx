import { Spin } from "@-/com.leonsilicon.zami.rn";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { t } from "$lib/i18n";
import { goto } from "$app/navigation";

export default function Page() {
    // The app is now a single auth-gated route at "/". This stub forwards any
    // stale bookmark, cached PWA start_url, or old deep-link that still targets
    // the old /app path to the merged route. replaceState so Back doesn't bounce
    // here.
    useEffect(() => {
        void goto("/", { replaceState: true });
    }, []);

    return (
        <View className="flex-1 flex-row items-center justify-center bg-discord-backgroundTertiary">
            <View className="flex-row items-center gap-3">
                <Spin className="w-6 h-6 border-2 border-discord-textMuted border-t-transparent rounded-full" />
                <Text className="text-discord-textMuted">
                    {t("appPage.redirecting")}
                </Text>
            </View>
        </View>
    );
}
