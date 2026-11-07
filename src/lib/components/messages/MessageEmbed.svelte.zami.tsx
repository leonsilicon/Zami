import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import Avatar from "$lib/components/ui/Avatar.svelte";
import {
    fetchSingleEvent,
    findEventById,
    getMemberAvatar,
    getMemberName,
    getRoom,
    getRoomDisplayName,
    getRoomIdForAlias,
} from "$lib/matrix/client";
import { messagesState } from "$lib/stores/messages.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { eventPreviewText } from "$lib/utils/eventPreviewText";
import type { EventPermalink } from "$lib/utils/matrixLinks";
import { messageTimestamp } from "$lib/utils/timeFormat";

interface Props {
    link: EventPermalink;
    /** The room the linking message is in; its name is not repeated. */
    currentRoomId: string;
    onOpen: () => void;
}

export default function MessageEmbed({ link, currentRoomId, onOpen }: Props) {
    // The linked message, from the loaded timeline when we have it, else
    // fetched on its own. A room we are not in (and that is not world-readable)
    // refuses the fetch: then nothing renders and the link stays a plain link.
    const [roomId, setRoomId] = useState<string | null>(null);
    const [target, setTarget] = useState<MatrixEvent | null>(null);
    // Zami: keyed on what the link points at, not the object: a parent that
    // re-extracts the permalinks hands over a new one for the same message.
    const linkRoom = link.kind === "room" ? link.roomId : link.alias;
    const { kind: linkKind, eventId: linkEventId } = link;
    useEffect(() => {
        const l = { kind: linkKind, target: linkRoom, eventId: linkEventId };
        setRoomId(null);
        setTarget(null);
        let cancelled = false;
        (async () => {
            const id =
                l.kind === "room"
                    ? l.target
                    : (await getRoomIdForAlias(l.target)).roomId;
            if (cancelled) return;
            setRoomId(id);
            const local = getRoom(id);
            const ev =
                (local && findEventById(local, l.eventId)) ??
                (await fetchSingleEvent(id, l.eventId));
            if (!cancelled) setTarget(ev);
        })().catch((err) => {
            if (!cancelled) console.warn("Could not load linked message:", err);
        });
        return () => {
            cancelled = true;
        };
    }, [linkKind, linkRoom, linkEventId]);

    const room = useRune((): Room | null => {
        void roomsState.roomsTick;
        return roomId ? getRoom(roomId) : null;
    }, [roomId]);
    const sender = target?.getSender() ?? "";
    // Zami: computed during render, which `useRune` above repeats on every
    // roomsTick, as upstream's $derived.by re-ran on it.
    const senderName = room ? getMemberName(room, sender) : sender;
    const senderAvatar = room ? getMemberAvatar(room, sender) : null;
    const roomLabel = (() => {
        if (!roomId || roomId === currentRoomId) return null;
        if (room) return getRoomDisplayName(room);
        return link.kind === "alias" ? link.alias : null;
    })();
    // Reads timelineTick: an encrypted message decrypts in place on the same
    // MatrixEvent, and the decryption bumps the tick (as for reply quotes).
    const text = useRune(() => {
        void messagesState.timelineTick;
        if (!target) return null;
        if (target.isRedacted()) return t("messageEmbed.deleted");
        return eventPreviewText(target);
    }, [target]);

    if (!(target && text)) return null;
    // Zami: `title={fullTimestamp(…)}` on the timestamp is a hover tooltip,
    // which React Native has no equivalent for.
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityHint={t("messageEmbed.jumpToMessage")}
            className="mt-2 flex-row w-full max-w-lg rounded overflow-hidden border border-discord-divider bg-discord-backgroundSecondary hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
            onPress={() => {
                onOpen();
            }}
        >
            <View className="w-1 flex-shrink-0 bg-discord-accent" />
            <View className="flex-1 min-w-0 flex-col p-2.5 gap-1">
                <View className="flex-row items-center gap-1.5 min-w-0">
                    <Avatar
                        src={senderAvatar}
                        name={senderName}
                        id={sender}
                        size={18}
                    />
                    <Text
                        numberOfLines={1}
                        className="shrink text-xs font-semibold text-discord-textPrimary"
                    >
                        {senderName}
                    </Text>
                    {roomLabel ? (
                        <Text
                            numberOfLines={1}
                            className="shrink text-xs text-discord-textMuted"
                        >
                            {t("messageEmbed.inRoom", { room: roomLabel })}
                        </Text>
                    ) : null}
                    <Text className="text-xs text-discord-textMuted flex-shrink-0 ms-auto">
                        {messageTimestamp(target.getTs())}
                    </Text>
                </View>
                <Text
                    numberOfLines={4}
                    className={`text-sm text-discord-textSecondary leading-snug ${
                        target.isRedacted() ? "italic" : ""
                    }`}
                >
                    {text}
                </Text>
            </View>
        </Pressable>
    );
}
