import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import type { MatrixEvent } from "matrix-js-sdk";
import { Search, X } from "lucide-svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import Portal from "$lib/components/ui/Portal.svelte";
import {
    forwardMessage,
    getRooms,
    getRoomAvatar,
    getRoomDisplayName,
} from "$lib/matrix/client";
import { closeModal } from "$lib/stores/interface.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";

interface Props {
    event: MatrixEvent;
}

// Zami: `max-h-[min(620px,90dvh)]` → the panel's `max-h-[90%]` (of the layer,
// which the keyboard shrinks) around a `max-h-[620px]` column: React Native has
// no `min()`. The room list grows and shrinks from its content (`grow shrink`),
// which is what `flex-1` does on the web inside a panel sized by its content.
export default function ForwardMessageDialog({ event }: Props) {
    const [query, setQuery] = useState("");
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [isSending, setIsSending] = useState(false);

    const rooms = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return getRooms()
            .filter((room) => !room.isSpaceRoom())
            .filter(
                (room) =>
                    !needle ||
                    getRoomDisplayName(room)
                        .toLocaleLowerCase()
                        .includes(needle) ||
                    room.roomId.toLocaleLowerCase().includes(needle),
            )
            .sort((a, b) =>
                getRoomDisplayName(a).localeCompare(getRoomDisplayName(b)),
            );
    }, [query]);

    async function submit() {
        if (!selectedRoomId || isSending) return;
        setIsSending(true);
        try {
            await forwardMessage(selectedRoomId, event);
            closeModal();
        } catch (err) {
            showErrorToast(
                err instanceof Error
                    ? err.message
                    : t("forwardMessageDialog.failedToForwardMessage"),
            );
            setIsSending(false);
        }
    }

    return (
        <Portal>
            <ModalDialog
                onClose={closeModal}
                labelledBy="forward-title"
                layerClass="z-[90] flex items-center justify-center p-3"
                panelClass="relative flex max-h-[90%] w-full max-w-md flex-col overflow-hidden rounded-lg border border-discord-divider bg-discord-backgroundSecondary shadow-2xl"
            >
                <View className="max-h-[620px] shrink flex-col">
                    <View className="flex-row items-center justify-between border-b border-discord-divider px-4 py-3">
                        <Text
                            nativeID="forward-title"
                            role="heading"
                            className="text-base font-semibold text-discord-textPrimary"
                        >
                            {t("forwardMessageDialog.forwardMessage")}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            onPress={closeModal}
                            className="p-1.5 rounded hover:bg-discord-messageHover"
                            accessibilityLabel={t("common.close")}
                        >
                            <X
                                size={20}
                                className="text-discord-textMuted hover:text-discord-textPrimary"
                            />
                        </Pressable>
                    </View>

                    <View className="p-3 pb-2">
                        <View className="relative justify-center">
                            <View
                                pointerEvents="none"
                                className="absolute start-3 z-10"
                            >
                                <Search
                                    size={16}
                                    className="text-discord-textMuted"
                                />
                            </View>
                            <TextInput
                                autoFocus
                                value={query}
                                onChangeText={setQuery}
                                placeholder={t(
                                    "forwardMessageDialog.searchRooms",
                                )}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                accessibilityLabel={t(
                                    "forwardMessageDialog.searchRooms",
                                )}
                                autoCorrect={false}
                                returnKeyType="search"
                                className="w-full rounded bg-discord-backgroundTertiary py-2 ps-9 pe-3 text-sm text-discord-textPrimary focus:ring-1 focus:ring-discord-accent"
                            />
                        </View>
                    </View>

                    <FlatList
                        data={rooms}
                        keyExtractor={(room) => room.roomId}
                        keyboardShouldPersistTaps="handled"
                        className="min-h-0 grow shrink"
                        contentContainerClassName="px-2 pb-2"
                        renderItem={({ item: room }) => (
                            // Zami: not ported: double-click to forward at once
                            // (`ondblclick`); touch has no double click.
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => setSelectedRoomId(room.roomId)}
                                accessibilityState={{
                                    selected: selectedRoomId === room.roomId,
                                }}
                                className={`flex-row w-full items-center gap-3 rounded px-2 py-2 transition-colors ${
                                    selectedRoomId === room.roomId
                                        ? "bg-discord-accent/20"
                                        : "hover:bg-discord-messageHover active:bg-discord-messageHover"
                                }`}
                            >
                                <Avatar
                                    src={getRoomAvatar(room)}
                                    name={getRoomDisplayName(room)}
                                    id={room.roomId}
                                    size={36}
                                />
                                <Text
                                    numberOfLines={1}
                                    className="min-w-0 flex-shrink text-sm font-medium text-discord-textPrimary"
                                >
                                    {getRoomDisplayName(room)}
                                </Text>
                            </Pressable>
                        )}
                        ListEmptyComponent={
                            <Text className="px-3 py-8 text-center text-sm text-discord-textMuted">
                                {t("forwardMessageDialog.noJoinedRoomsFound")}
                            </Text>
                        }
                    />

                    <View className="flex-row justify-end gap-2 border-t border-discord-divider p-3">
                        <Pressable
                            accessibilityRole="button"
                            onPress={closeModal}
                            className="px-3 py-2"
                        >
                            <Text className="text-sm font-semibold text-discord-textMuted hover:text-discord-textPrimary">
                                {t("common.cancel")}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void submit()}
                            disabled={!selectedRoomId || isSending}
                            accessibilityState={{
                                disabled: !selectedRoomId || isSending,
                            }}
                            className={`rounded bg-discord-accent px-4 py-2 transition-colors hover:bg-discord-accentHover ${
                                !selectedRoomId || isSending ? "opacity-50" : ""
                            }`}
                        >
                            <Text className="text-sm font-semibold text-white">
                                {isSending
                                    ? t("forwardMessageDialog.forwarding")
                                    : t("forwardMessageDialog.forward")}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </ModalDialog>
        </Portal>
    );
}
