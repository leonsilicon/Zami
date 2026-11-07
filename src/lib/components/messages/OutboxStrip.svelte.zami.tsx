import { Spin } from "@-/com.leonsilicon.zami.rn";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import { Clock, Loader2, AlertCircle } from "lucide-svelte";
import {
    getOutboxItems,
    outboxTick,
    retryOutboxItem,
    removeOutboxItem,
} from "$lib/stores/outbox.svelte";

interface Props {
    roomId: string;
}

export default function OutboxStrip({ roomId }: Props) {
    // Zami: the tick is the store's one reactive read; the items follow it.
    const tick = useRune(() => outboxTick());
    const items = useMemo(
        () => (void tick, getOutboxItems(roomId)),
        [tick, roomId],
    );

    if (items.length === 0) return null;
    // Zami: the row's `text-xs text-discord-textMuted` is on each text and icon
    // in it, which don't inherit it. `text-discord-text` isn't one of Zam's
    // colors, so on the web the Retry label inherits the row's muted text.
    return (
        <View className="flex-col gap-1 mb-2">
            {items.map((item) => (
                <View
                    key={item.id}
                    className="flex-row items-center gap-2 px-2 py-1.5 rounded bg-discord-backgroundSecondary"
                >
                    {/* Status icon/label */}
                    {item.status === "queued" ? (
                        <>
                            <Clock className="w-3.5 h-3.5 flex-shrink-0 text-discord-textMuted" />
                            <Text className="flex-shrink-0 text-xs text-discord-textMuted">
                                {t("outboxStrip.queued")}
                            </Text>
                        </>
                    ) : item.status === "sending" ? (
                        <>
                            <Spin>
                                <Loader2 className="w-3.5 h-3.5 flex-shrink-0 text-discord-textMuted" />
                            </Spin>
                            <Text className="flex-shrink-0 text-xs text-discord-textMuted">
                                {t("outboxStrip.sending")}
                            </Text>
                        </>
                    ) : item.status === "failed" ? (
                        <>
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-400" />
                            <Text className="flex-shrink-0 text-xs text-red-400">
                                {item.error || t("outboxStrip.failed")}
                            </Text>
                        </>
                    ) : null}

                    {/* Body preview */}
                    <Text
                        numberOfLines={1}
                        className="truncate flex-1 opacity-75 text-xs text-discord-textMuted"
                    >
                        {String(item.content.body ?? "")}
                    </Text>

                    {/* Actions for queued and failed items */}
                    {(item.status === "queued" || item.status === "failed") && (
                        <>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => retryOutboxItem(roomId, item.id)}
                                className="px-2 py-0.5 rounded bg-discord-backgroundTertiary hover:bg-discord-backgroundModifierHover transition-colors flex-shrink-0"
                            >
                                <Text className="text-discord-text text-xs font-medium text-discord-textMuted">
                                    {t("common.retry")}
                                </Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() =>
                                    removeOutboxItem(roomId, item.id)
                                }
                                className="px-2 py-0.5 rounded bg-discord-backgroundTertiary hover:bg-discord-backgroundModifierHover transition-colors flex-shrink-0"
                            >
                                <Text className="text-discord-textMuted text-xs font-medium">
                                    {t("common.cancel")}
                                </Text>
                            </Pressable>
                        </>
                    )}
                </View>
            ))}
        </View>
    );
}
