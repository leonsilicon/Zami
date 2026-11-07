import { Spin } from "@-/com.leonsilicon.zami.rn";
import { Text, View } from "react-native";
import { t } from "$lib/i18n";
import type { DownloadProgress } from "$lib/utils/downloadProgress";

interface Props {
    /** What is being fetched, e.g. "Decrypting image...". */
    label: string;
    /** Latest byte counts, or null before the first report. */
    progress?: DownloadProgress | null;
}

export default function MediaProgress({ label, progress = null }: Props) {
    const fraction =
        progress && progress.total
            ? Math.min(1, progress.loaded / progress.total)
            : null;

    function size(bytes: number): string {
        return bytes < 1024 * 1024
            ? t("messageItem.kb", {
                  toFixed: Math.max(1, Math.round(bytes / 1024)).toString(),
              })
            : t("messageItem.mb", {
                  toFixed: (bytes / (1024 * 1024)).toFixed(1),
              });
    }

    const detail = (() => {
        if (!progress || progress.loaded <= 0) return null;
        return progress.total
            ? t("mediaProgress.ofTotal", {
                  loaded: size(progress.loaded),
                  total: size(progress.total),
              })
            : size(progress.loaded);
    })();

    return (
        <View className="flex-row items-center gap-2 p-3 bg-discord-backgroundSecondary rounded-lg mt-1 max-w-sm w-full">
            <Spin className="w-4 h-4 border-2 border-discord-accent border-t-transparent rounded-full flex-shrink-0" />
            <View className="min-w-0 flex-1">
                <View className="flex-row items-baseline justify-between gap-2">
                    <Text
                        numberOfLines={1}
                        className="shrink text-xs text-discord-textMuted truncate"
                    >
                        {label}
                    </Text>
                    {detail ? (
                        <Text className="text-[11px] text-discord-textMuted tabular-nums flex-shrink-0">
                            {detail}
                        </Text>
                    ) : null}
                </View>
                {fraction !== null && (
                    <View
                        className="mt-1.5 h-1 rounded-full bg-discord-backgroundTertiary overflow-hidden"
                        role="progressbar"
                        accessibilityLabel={label}
                        accessibilityValue={{
                            min: 0,
                            max: 100,
                            now: Math.round(fraction * 100),
                        }}
                    >
                        <View
                            className="h-full bg-discord-accent transition-[width] duration-150"
                            style={{ width: `${Math.round(fraction * 100)}%` }}
                        />
                    </View>
                )}
            </View>
        </View>
    );
}
