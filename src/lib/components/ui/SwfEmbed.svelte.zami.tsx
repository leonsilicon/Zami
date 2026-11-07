import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { t } from "$lib/i18n";
import FlashEmbed from "./FlashEmbed.svelte";

interface Props {
    getSrc: () => Promise<string>;
}

export default function SwfEmbed({ getSrc }: Props) {
    const [src, setSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function activate() {
        if (src || loading) return;
        setLoading(true);
        try {
            setSrc(await getSrc());
        } catch (e) {
            console.error("Failed to load SWF:", e);
        } finally {
            setLoading(false);
        }
    }

    if (src) return <FlashEmbed src={src} />;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("swfEmbed.adobeFlash")}
            accessibilityState={{ disabled: loading, busy: loading }}
            onPress={activate}
            className="flex items-center gap-3 mt-1 w-full max-w-sm aspect-video rounded-lg bg-black/80 hover:bg-black/60 transition-colors justify-center flex-col"
            disabled={loading}
        >
            {loading ? (
                <>
                    <View className="w-8 h-8 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
                    <Text className="text-white/60 text-xs">
                        {t("common.loading")}
                    </Text>
                </>
            ) : (
                <>
                    {/* text-white/80 */}
                    <Svg
                        width={48}
                        height={48}
                        fill="rgba(255, 255, 255, 0.8)"
                        viewBox="0 0 24 24"
                    >
                        <Path d="M8 5v14l11-7z" />
                    </Svg>
                    <Text className="text-white/60 text-xs font-medium">
                        {t("swfEmbed.adobeFlash")}
                    </Text>
                </>
            )}
        </Pressable>
    );
}
