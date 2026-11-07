import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Phone, PhoneOff } from "lucide-svelte";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import Avatar from "$lib/components/ui/Avatar.svelte";
import {
    getRoom,
    getDMPartnerId,
    getMemberName,
    getMemberAvatar,
} from "$lib/matrix/client";
import { voiceCallState } from "$lib/stores/voiceCall.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";

interface Props {
    roomId: string;
    onAccept: (roomId: string) => void;
    onDecline: (roomId: string) => void;
}

// Zami: `title` (a hover tooltip) has no React Native equivalent, so the buttons
// only carry their accessibility labels.
export default function IncomingCallCard({
    roomId,
    onAccept,
    onDecline,
}: Props) {
    // Live SDK objects mutate in place and `roomId` never changes for a card's
    // lifetime, so every read of room state hangs off roomsTick — it bumps on
    // every sync (client.ts onRoomUpdate), which is when a federated DM's
    // late-arriving m.room.member state lands. Without it the card would show a
    // raw MXID (or your own avatar) for the whole ring. Not voiceTick: that is
    // the roster's tick and never fires for room state — see CallView.svelte:44.
    // Each derived threads the tick itself; gating only `room` would not help,
    // as getRoom() returns the same reference and Svelte halts propagation on an
    // unchanged value.
    const room = useRune(() => {
        void roomsState.roomsTick;
        return getRoom(roomId);
    }, [roomId]);
    const partnerId = useRune(() => {
        void roomsState.roomsTick;
        return room ? getDMPartnerId(room) : "";
    }, [room]);
    const name = useRune(() => {
        void roomsState.roomsTick;
        return room && partnerId
            ? getMemberName(room, partnerId)
            : t("incomingCallCard.unknown");
    }, [room, partnerId]);
    const avatar = useRune(() => {
        void roomsState.roomsTick;
        return room && partnerId ? getMemberAvatar(room, partnerId) : null;
    }, [room, partnerId]);
    // `!== null`, NOT `=== roomId`: joinCall() is single-flight and early-
    // returns while ANY join is in flight (voiceCall.svelte.ts:166), so a
    // per-room predicate would leave this button lit and silently inert while
    // another card's Accept is resolving. Matches ActiveCallBanner.svelte:67,
    // CallView.svelte:193 and MessageArea.svelte:982.
    const busy = useRune(() => voiceCallState.joinPendingRoomId !== null);

    return (
        <View className="flex-row items-center gap-3 w-80 px-4 py-3 rounded-lg shadow-lg bg-discord-background border border-discord-divider">
            <Avatar src={avatar} name={name} id={partnerId} size={40} />
            <View className="flex-1 min-w-0">
                <Text
                    numberOfLines={1}
                    className="text-sm font-semibold text-discord-textPrimary truncate"
                >
                    {name}
                </Text>
                <Text className="text-xs text-discord-textMuted">
                    {t("incomingCallCard.incomingCall")}
                </Text>
            </View>
            <Pressable
                accessibilityRole="button"
                className="p-2 rounded-full bg-discord-danger hover:bg-discord-dangerHover transition-colors"
                accessibilityLabel={t("incomingCallCard.declineCallFrom", {
                    name,
                })}
                onPress={() => onDecline(roomId)}
            >
                <PhoneOff size={16} className="text-white" />
            </Pressable>
            <Pressable
                accessibilityRole="button"
                className="p-2 rounded-full bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-60"
                accessibilityLabel={t("incomingCallCard.acceptCallFrom", {
                    name,
                })}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => onAccept(roomId)}
            >
                <Phone size={16} className="text-white" />
            </Pressable>
        </View>
    );
}
