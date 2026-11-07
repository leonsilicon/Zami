import { SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import type { Room } from "matrix-js-sdk";
import Avatar from "$lib/components/ui/Avatar.svelte";
import {
    getRoomAvatar,
    getRoomDisplayName,
    getRoomTopic,
    acceptInvite,
    rejectInvite,
    cancelKnock,
    getInviteSender,
} from "$lib/matrix/client";
import { roomsState, setActiveRoom } from "$lib/stores/rooms.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";

interface Props {
    isMobile?: boolean;
    onMenuOpen?: () => void;
}

// Zami: the two `{#each}` blocks below are one FlatList: each list's
// heading, then its rooms, as rows.
type Row =
    | { kind: "heading"; key: string; label: string; spaced: boolean }
    | { kind: "invite" | "knock"; key: string; room: Room };

export default function InboxPanel({ isMobile = false, onMenuOpen }: Props) {
    const [busyIds, setBusyIds] = useState(new Set<string>());
    const invitedRooms = useRune(() => roomsState.invitedRooms);
    const knockedRooms = useRune(() => roomsState.knockedRooms);

    function addBusy(roomId: string) {
        setBusyIds((ids) => new Set([...ids, roomId]));
    }
    function removeBusy(roomId: string) {
        setBusyIds((ids) => new Set([...ids].filter((id) => id !== roomId)));
    }

    async function accept(roomId: string) {
        addBusy(roomId);
        try {
            await acceptInvite(roomId);
            setActiveRoom(roomId);
        } catch (e) {
            console.error("Failed to accept invite", e);
            showErrorToast(t("inboxPanel.failedToAcceptInvite"));
        } finally {
            removeBusy(roomId);
        }
    }

    async function reject(roomId: string) {
        addBusy(roomId);
        try {
            await rejectInvite(roomId);
        } catch (e) {
            console.error("Failed to reject invite", e);
            showErrorToast(t("inboxPanel.failedToRejectInvite"));
        } finally {
            removeBusy(roomId);
        }
    }

    async function cancelRequest(roomId: string) {
        addBusy(roomId);
        try {
            await cancelKnock(roomId);
        } catch (e) {
            console.error("Failed to cancel join request", e);
            showErrorToast(t("inboxPanel.failedToCancelJoinRequest"));
        } finally {
            removeBusy(roomId);
        }
    }

    const rows: Row[] = [];
    if (invitedRooms.length > 0) {
        rows.push({
            kind: "heading",
            key: "heading:invites",
            label: t("inboxPanel.pendingInvites", {
                length: invitedRooms.length,
            }),
            spaced: false,
        });
    }
    for (const room of invitedRooms)
        rows.push({ kind: "invite", key: room.roomId, room });
    if (knockedRooms.length > 0) {
        rows.push({
            kind: "heading",
            key: "heading:knocks",
            label: t("inboxPanel.pendingJoinRequests", {
                length: knockedRooms.length,
            }),
            spaced: invitedRooms.length > 0,
        });
        for (const room of knockedRooms)
            rows.push({ kind: "knock", key: room.roomId, room });
    }

    return (
        <View className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <View className="h-12 px-4 flex-row items-center gap-3 border-b border-discord-divider shadow-sm flex-shrink-0">
                {isMobile ? (
                    // Zami: the button's `title` is its only name, so it's
                    // the accessibility label.
                    <Pressable
                        accessibilityRole="button"
                        onPress={onMenuOpen}
                        className="p-1.5 -ms-1 rounded hover:bg-discord-messageHover transition-colors flex-shrink-0"
                        accessibilityLabel={t("common.openRoomList")}
                    >
                        <SvgIcon
                            className="w-5 h-5 text-discord-textMuted"
                            d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"
                        />
                    </Pressable>
                ) : null}
                <Text
                    accessibilityRole="header"
                    className="font-semibold text-discord-textPrimary"
                >
                    {t("inboxPanel.inbox")}
                </Text>
            </View>

            <FlatList
                className="flex-1"
                contentContainerClassName="flex-grow p-4"
                data={rows}
                extraData={busyIds}
                keyExtractor={(row) => row.key}
                // `gap-3`
                ItemSeparatorComponent={RowGap}
                renderItem={({ item: row }) => {
                    // `max-w-lg mx-auto`, on each row.
                    const column = "w-full max-w-lg self-center";
                    if (row.kind === "heading") {
                        return (
                            <Text
                                accessibilityRole="header"
                                className={`${column} text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1 ${
                                    row.spaced ? "mt-3" : ""
                                }`}
                            >
                                {row.label}
                            </Text>
                        );
                    }
                    const { room } = row;
                    const busy = busyIds.has(room.roomId);
                    if (row.kind === "invite") {
                        const sender = getInviteSender(room);
                        const topic = getRoomTopic(room);
                        return (
                            <View
                                className={`${column} flex-row items-center gap-4 p-4 rounded-lg bg-discord-backgroundSecondary border border-discord-divider`}
                            >
                                <Avatar
                                    src={getRoomAvatar(room)}
                                    name={getRoomDisplayName(room)}
                                    size={48}
                                />
                                <View className="flex-1 min-w-0">
                                    <Text
                                        numberOfLines={1}
                                        className="font-semibold text-discord-textPrimary"
                                    >
                                        {getRoomDisplayName(room)}
                                    </Text>
                                    {sender ? (
                                        <Text className="text-xs text-discord-textMuted">
                                            {t("inboxPanel.invitedBy", {
                                                sender,
                                            })}
                                        </Text>
                                    ) : null}
                                    {topic ? (
                                        <Text
                                            numberOfLines={2}
                                            className="text-sm text-discord-textMuted mt-0.5"
                                        >
                                            {topic}
                                        </Text>
                                    ) : null}
                                </View>
                                <View className="flex-row gap-2 flex-shrink-0">
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void reject(room.roomId)}
                                        disabled={busy}
                                        accessibilityState={{ disabled: busy }}
                                        className={`px-3 py-1.5 rounded border border-discord-divider hover:bg-discord-danger hover:border-discord-danger transition-colors ${
                                            busy ? "opacity-50" : ""
                                        }`}
                                    >
                                        <Text className="text-sm font-semibold text-discord-textMuted">
                                            {t("inboxPanel.ignore")}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void accept(room.roomId)}
                                        disabled={busy}
                                        accessibilityState={{ disabled: busy }}
                                        className={`px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors flex-row items-center gap-1.5 ${
                                            busy ? "opacity-50" : ""
                                        }`}
                                    >
                                        {busy ? (
                                            <View className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        ) : null}
                                        <Text className="text-sm font-semibold text-white">
                                            {t("inboxPanel.accept")}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        );
                    }
                    return (
                        <View
                            className={`${column} flex-row items-center gap-4 p-4 rounded-lg bg-discord-backgroundSecondary border border-discord-divider`}
                        >
                            <Avatar
                                src={getRoomAvatar(room)}
                                name={getRoomDisplayName(room)}
                                size={48}
                            />
                            <View className="flex-1 min-w-0">
                                <Text
                                    numberOfLines={1}
                                    className="font-semibold text-discord-textPrimary"
                                >
                                    {getRoomDisplayName(room)}
                                </Text>
                                <Text className="text-xs text-discord-textMuted">
                                    {t("inboxPanel.youAskedToJoinWaitingFor")}
                                </Text>
                            </View>
                            <View className="flex-row gap-2 flex-shrink-0">
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() =>
                                        void cancelRequest(room.roomId)
                                    }
                                    disabled={busy}
                                    accessibilityState={{ disabled: busy }}
                                    className={`px-3 py-1.5 rounded border border-discord-divider hover:bg-discord-danger hover:border-discord-danger transition-colors flex-row items-center gap-1.5 ${
                                        busy ? "opacity-50" : ""
                                    }`}
                                >
                                    {busy ? (
                                        <View className="w-3.5 h-3.5 border-2 border-discord-textMuted border-t-transparent rounded-full animate-spin" />
                                    ) : null}
                                    <Text className="text-sm font-semibold text-discord-textMuted">
                                        {t("inboxPanel.cancelRequest")}
                                    </Text>
                                </Pressable>
                            </View>
                        </View>
                    );
                }}
                ListEmptyComponent={
                    <View className="flex-1 flex-col items-center justify-center py-16">
                        <View className="w-16 h-16 rounded-full bg-discord-backgroundSecondary flex-row items-center justify-center mb-4">
                            <SvgIcon
                                className="w-8 h-8 text-discord-textMuted"
                                d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"
                            />
                        </View>
                        <Text className="text-discord-textPrimary font-semibold mb-1 text-center">
                            {t("inboxPanel.noPendingInvites")}
                        </Text>
                        <Text className="text-discord-textMuted text-sm text-center">
                            {t("inboxPanel.roomInvitesWillAppearHere")}
                        </Text>
                    </View>
                }
            />
        </View>
    );
}

function RowGap() {
    return <View className="h-3" />;
}
