import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Text, View } from "react-native";
import Avatar from "$lib/components/ui/Avatar.svelte";
import { voiceCallState } from "$lib/stores/voiceCall.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { getMemberAvatar, getMemberName, getRoom } from "$lib/matrix/client";

interface Props {
    /** Whose tile this labels: the avatar is theirs. */
    userId: string;
    /** The text: a name, or "<name>'s screen". */
    label: string;
}

export default function TileLabel({ userId, label }: Props) {
    const roomsTick = useRune(() => roomsState.roomsTick);
    const callRoomId = useRune(() => voiceCallState.roomId);
    void roomsTick;
    const room = callRoomId ? getRoom(callRoomId) : null;
    const avatar = room ? getMemberAvatar(room, userId) : null;
    const name = room ? getMemberName(room, userId) : userId;

    // The avatar is 16px, the line height of text-xs, so it sits on the text's
    // line without making the label taller.
    return (
        <View className="flex-row items-center gap-1.5 min-w-0 max-w-full self-start px-1.5 py-0.5 rounded bg-black/60">
            <Avatar src={avatar} name={name} id={userId} size={16} />
            <Text
                numberOfLines={1}
                className="flex-shrink truncate leading-4 text-white text-xs"
            >
                {label}
            </Text>
        </View>
    );
}
