import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { format } from "date-fns";
import type { MatrixEvent } from "matrix-js-sdk";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import { messagesState } from "$lib/stores/messages.svelte";

interface Props {
    event: MatrixEvent;
}

export default function DebugEventItem({ event }: Props) {
    // Zami: <details>' own open state.
    const [open, setOpen] = useState(false);

    // The event mutates in place on decryption and timelineTick is bumped then,
    // so re-read through it or the row keeps showing the m.room.encrypted
    // envelope. (Zami: subscribing re-renders on each bump, and the values
    // below are read fresh on every render.)
    useRune(() => messagesState.timelineTick);
    const type = event.getType();
    const sender = event.getSender() ?? "-";
    const stateKey = event.getStateKey();
    const eventId = event.getId() ?? "-";
    const redacted = event.isRedacted();
    // Raw SDK DecryptionFailureCode. The timeline's UTD copy collapses most
    // codes into one generic line, so this is the only place the real reason
    // is visible.
    const failureReason = event.decryptionFailureReason;
    const time = event.getTs()
        ? format(new Date(event.getTs()), "HH:mm:ss")
        : "-";
    const contentJson = JSON.stringify(event.getContent(), null, 2);

    return (
        <View className="mx-4 my-0.5 rounded bg-discord-backgroundTertiary/40 border border-discord-divider">
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => setOpen((o) => !o)}
                className="px-2 py-1 cursor-pointer select-none flex flex-row flex-wrap items-center gap-2"
            >
                <Text className="font-mono text-xs text-discord-warning/80">
                    {time}
                </Text>
                <Text className="font-mono text-xs text-discord-accent">
                    {type}
                </Text>
                {stateKey !== undefined && stateKey !== null ? (
                    // Zami: the hover title (t("debugEventItem.stateKey")) has no equivalent.
                    <Text className="font-mono text-xs text-discord-warning">
                        ⊞ {stateKey || t("debugEventItem.empty")}
                    </Text>
                ) : null}
                <Text className="font-mono text-xs text-discord-textSecondary break-all">
                    {sender}
                </Text>
                {redacted ? (
                    <Text className="font-mono text-xs text-discord-danger">
                        {t("debugEventItem.redacted")}
                    </Text>
                ) : null}
                {failureReason ? (
                    <Text className="font-mono text-xs text-discord-danger">
                        {failureReason}
                    </Text>
                ) : null}
            </Pressable>
            {open ? (
                <View className="px-2 pb-2 pt-1 border-t border-discord-divider gap-1">
                    <Text className="font-mono text-xs text-discord-textMuted break-all">
                        {t("debugEventItem.id", { eventId })}
                    </Text>
                    <Text
                        selectable
                        className="font-mono text-xs whitespace-pre-wrap break-all text-discord-textPrimary"
                    >
                        {contentJson}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}
