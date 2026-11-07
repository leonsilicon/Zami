import { Pressable, Text, View } from "react-native";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import { ShieldQuestion } from "lucide-svelte";
import {
    verificationState,
    acceptIncoming,
    declineIncoming,
    isAcceptingRequest,
    acceptRequestError,
} from "$lib/stores/verification.svelte";
import { verificationRequestMessageView } from "$lib/utils/verificationMessage";

interface Props {
    /** Event id of the request — the SDK keys in-room requests by it. */
    eventId: string;
    senderName: string;
    isOwn: boolean;
}

export default function VerificationRequestMessage({
    eventId,
    senderName,
    isOwn,
}: Props) {
    // Controllers mutate in place, so read through the tick. A request that is
    // still live appears in the incoming queue (or as the active flow) under
    // the request event's id.
    const controller = useRune(
        () => (
            void verificationState.verificationTick,
            verificationState.incoming.find((c) => c.id === eventId) ??
                (verificationState.active?.id === eventId
                    ? verificationState.active
                    : null)
        ),
        [eventId],
    );
    const view = verificationRequestMessageView({
        isOwn,
        senderName,
        pending: !!controller,
    });

    // Accept state comes from the store so this card and the stacked one show
    // the same truth, and so it survives the timeline recycling this component
    // while accept() is still in flight.
    const busy = useRune(
        () => (
            void verificationState.verificationTick,
            controller ? isAcceptingRequest(controller) : false
        ),
        [controller],
    );
    const acceptError = useRune(
        () => (
            void verificationState.verificationTick,
            controller ? acceptRequestError(controller) : null
        ),
        [controller],
    );

    async function accept() {
        if (!controller) return;
        await acceptIncoming(controller);
    }

    return (
        <View className="mt-1 flex-row max-w-md items-center gap-3 rounded-lg border border-discord-divider bg-discord-backgroundSecondary px-3 py-2.5">
            <View className="flex-row h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-discord-accent/20">
                <ShieldQuestion size={20} className="text-discord-accent" />
            </View>
            <View className="min-w-0 flex-1">
                <Text
                    numberOfLines={1}
                    className="truncate text-sm font-medium text-discord-textPrimary"
                >
                    {view.heading}
                </Text>
                {acceptError ? (
                    <Text className="text-xs text-discord-danger">
                        {acceptError}
                    </Text>
                ) : (
                    <Text
                        numberOfLines={1}
                        className="truncate text-xs text-discord-textMuted"
                    >
                        {view.subtitle}
                    </Text>
                )}
            </View>
            {view.showActions && controller && (
                <>
                    {/* Never disabled while an accept is in flight: nothing bounds accept()
                        client-side, so declining (which drops the card AND frees the
                        store's one-at-a-time gate) is the only way out of a hung one short
                        of a reload. */}
                    <Pressable
                        accessibilityRole="button"
                        className="rounded px-2.5 py-1 transition-colors bg-discord-messageHover hover:bg-discord-danger/20 disabled:opacity-60"
                        onPress={() => declineIncoming(controller)}
                    >
                        <Text className="text-xs text-discord-textPrimary">
                            {t("common.decline")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: busy }}
                        className="rounded bg-discord-accent px-2.5 py-1 transition-colors hover:bg-discord-accentHover disabled:opacity-60"
                        disabled={busy}
                        onPress={accept}
                    >
                        <Text className="text-xs text-white">
                            {busy ? "…" : t("common.verify")}
                        </Text>
                    </Pressable>
                </>
            )}
        </View>
    );
}
