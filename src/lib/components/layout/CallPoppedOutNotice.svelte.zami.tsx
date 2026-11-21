import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import { ExternalLink } from "lucide-svelte";
import {
    closeCallPopout,
    focusCallPopout,
} from "$lib/stores/callPopout.svelte";

export default function CallPoppedOutNotice() {
    return (
        // Zami: not ported: `data-zam-region="call"` (plugins' DOM region
        // hook; there's no DOM here).
        <View className="flex-1 flex-col items-center justify-center gap-4 p-6 min-w-0 bg-zam-backgroundTertiary">
            <ExternalLink size={32} className="text-zam-textMuted" />
            <Text className="text-zam-textSecondary text-center">
                {t("callPopout.inOtherWindow")}
            </Text>
            <View className="flex-row flex-wrap items-center justify-center gap-2">
                <Pressable
                    accessibilityRole="button"
                    onPress={closeCallPopout}
                    className="px-4 py-2 rounded bg-zam-accent hover:opacity-90 transition-opacity"
                >
                    <Text className="text-white">
                        {t("callPopout.bringBack")}
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    onPress={focusCallPopout}
                    className="px-4 py-2 rounded bg-zam-backgroundSecondary hover:bg-zam-messageHover transition-colors"
                >
                    <Text className="text-zam-textPrimary">
                        {t("callPopout.focusWindow")}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}
