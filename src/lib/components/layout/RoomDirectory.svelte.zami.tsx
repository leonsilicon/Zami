import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { X } from "lucide-svelte";
import { useEffect, useEffectEvent, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import Avatar from "$lib/components/ui/Avatar.svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import {
    getPublicRooms,
    joinRoom,
    knockRoom,
    getRoom,
    mxcToHttp,
} from "$lib/matrix/client";
import {
    mergeRoomPages,
    normalizeServerInput,
    type DirectoryRoom,
} from "$lib/utils/roomDirectory";
import {
    roomsState,
    setActiveRoom,
    setActiveSpace,
} from "$lib/stores/rooms.svelte";
import { closeModal } from "$lib/stores/interface.svelte";

export default function RoomDirectory() {
    const [searchInput, setSearchInput] = useState("");
    const [serverInput, setServerInput] = useState("");
    const [rooms, setRooms] = useState<DirectoryRoom[]>([]);
    const [nextBatch, setNextBatch] = useState<string | null>(null);
    const [totalEstimate, setTotalEstimate] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState("");
    const [joiningId, setJoiningId] = useState<string | null>(null);
    const [joinError, setJoinError] = useState<{
        roomId: string;
        message: string;
    } | null>(null);
    const [searched, setSearched] = useState(false);
    const roomsTick = useRune(() => roomsState.roomsTick);

    function errorMessage(e: unknown): string {
        const err = e as { data?: { error?: string }; message?: string };
        return (
            err?.data?.error ??
            err?.message ??
            t("roomDirectory.somethingWentWrong")
        );
    }

    async function search() {
        setLoading(true);
        setError("");
        setJoinError(null);
        try {
            const page = await getPublicRooms({
                server: normalizeServerInput(serverInput),
                search: searchInput.trim() || undefined,
            });
            setRooms(page.rooms);
            setNextBatch(page.nextBatch);
            setTotalEstimate(page.totalEstimate);
            setSearched(true);
        } catch (e) {
            setRooms([]);
            setNextBatch(null);
            setTotalEstimate(null);
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }

    async function loadMore() {
        if (!nextBatch || loadingMore) return;
        setLoadingMore(true);
        setError("");
        try {
            const page = await getPublicRooms({
                server: normalizeServerInput(serverInput),
                search: searchInput.trim() || undefined,
                since: nextBatch,
            });
            setRooms((rooms) => mergeRoomPages(rooms, page.rooms));
            setNextBatch(page.nextBatch);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setLoadingMore(false);
        }
    }

    function isJoined(roomId: string): boolean {
        void roomsTick;
        return getRoom(roomId)?.getMyMembership() === "join";
    }

    function isKnocked(roomId: string): boolean {
        void roomsTick;
        return getRoom(roomId)?.getMyMembership() === "knock";
    }

    function openJoined(entry: DirectoryRoom) {
        closeModal();
        if (entry.isSpace) setActiveSpace(entry.roomId);
        else setActiveRoom(entry.roomId);
    }

    async function join(entry: DirectoryRoom) {
        setJoiningId(entry.roomId);
        setJoinError(null);
        try {
            const via = normalizeServerInput(serverInput);
            await joinRoom(entry.roomId, via ? [via] : undefined);
            openJoined(entry);
        } catch (e) {
            setJoinError({ roomId: entry.roomId, message: errorMessage(e) });
        } finally {
            setJoiningId(null);
        }
    }

    async function knock(entry: DirectoryRoom) {
        setJoiningId(entry.roomId);
        setJoinError(null);
        try {
            const via = normalizeServerInput(serverInput);
            await knockRoom(entry.roomId, undefined, via ? [via] : undefined);
        } catch (e) {
            setJoinError({ roomId: entry.roomId, message: errorMessage(e) });
        } finally {
            setJoiningId(null);
        }
    }

    // Initial page on open
    const initialSearch = useEffectEvent(() => void search());
    useEffect(() => initialSearch(), []);

    const showRooms = !loading && !(rooms.length === 0 && searched && !error);

    return (
        <ModalDialog
            onClose={closeModal}
            labelledBy="room-directory-title"
            panelClass="relative bg-discord-background rounded-lg shadow-xl w-full max-w-2xl mx-4 p-6 flex flex-col gap-4 max-h-[85vh]"
        >
            <View className="flex-row items-start justify-between">
                <View className="flex-shrink">
                    <Text
                        nativeID="room-directory-title"
                        accessibilityRole="header"
                        className="text-lg font-bold text-discord-textPrimary"
                    >
                        {t("roomDirectory.exploreRooms")}
                    </Text>
                    <Text className="text-sm text-discord-textMuted">
                        {t("roomDirectory.publicRooms", {
                            value: serverInput.trim()
                                ? `on ${normalizeServerInput(serverInput)}`
                                : t("roomDirectory.onYourHomeserver"),
                        })}
                        {totalEstimate !== null
                            ? ` ${t("roomDirectory.rooms", { totalEstimate })}`
                            : null}
                    </Text>
                </View>
                {/* Zami: the button's `title` is its only name, so it's the
                    accessibility label. */}
                <Pressable
                    accessibilityRole="button"
                    onPress={closeModal}
                    className="transition-colors p-1"
                    accessibilityLabel={t("common.close")}
                >
                    <X size={20} className="text-discord-textMuted" />
                </Pressable>
            </View>

            {/* Enter anywhere in the search row runs the search. Zami: Enter
                in either input (onSubmitEditing). */}
            <View className="flex-row gap-2">
                <TextInput
                    autoFocus
                    value={searchInput}
                    onChangeText={setSearchInput}
                    onSubmitEditing={() => void search()}
                    returnKeyType="search"
                    placeholder={t("roomDirectory.searchRooms")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityLabel={t("roomDirectory.searchRooms")}
                    className="flex-1 px-3 py-2 bg-discord-backgroundSecondary text-discord-textPrimary rounded border border-discord-divider focus:border-discord-accent text-sm"
                />
                <TextInput
                    value={serverInput}
                    onChangeText={setServerInput}
                    onSubmitEditing={() => void search()}
                    returnKeyType="search"
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={t("roomDirectory.serverOptional")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityLabel={t("roomDirectory.serverOptional")}
                    className="w-44 px-3 py-2 bg-discord-backgroundSecondary text-discord-textPrimary rounded border border-discord-divider focus:border-discord-accent text-sm"
                />
                <Pressable
                    accessibilityRole="button"
                    onPress={() => void search()}
                    disabled={loading}
                    accessibilityState={{ disabled: loading }}
                    className={`px-4 py-2 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors justify-center ${
                        loading ? "opacity-50" : ""
                    }`}
                >
                    <Text className="text-sm font-semibold text-white">
                        {t("roomDirectory.search")}
                    </Text>
                </Pressable>
            </View>

            {error ? (
                <Text className="text-sm text-discord-danger">{error}</Text>
            ) : null}

            {/* Zami: `flex-1` in a panel only `max-h` bounds → `flex-shrink`:
                a React Native list with `flex: 1` there collapses to its
                `min-h`, where the web's grows with its rows. */}
            <FlatList
                className="flex-grow-0 flex-shrink min-h-32"
                keyboardShouldPersistTaps="handled"
                data={showRooms ? rooms : []}
                extraData={[roomsTick, joiningId, joinError]}
                keyExtractor={(entry) => entry.roomId}
                // `gap-1`
                ItemSeparatorComponent={RowGap}
                renderItem={({ item: entry }) => (
                    <View className="flex-row items-center gap-3 px-3 py-2 rounded hover:bg-discord-messageHover transition-colors">
                        <Avatar
                            src={mxcToHttp(entry.avatarMxc, 64)}
                            name={entry.name}
                            id={entry.roomId}
                            size={40}
                            rounded="xl"
                        />
                        <View className="flex-1 min-w-0">
                            <View className="flex-row items-center gap-2">
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-sm font-semibold text-discord-textPrimary"
                                >
                                    {entry.name}
                                </Text>
                                {entry.isSpace ? (
                                    <View className="px-1.5 py-0.5 rounded bg-discord-backgroundSecondary flex-shrink-0">
                                        <Text className="text-[10px] font-semibold uppercase tracking-wide text-discord-textMuted">
                                            {t("roomDirectory.space")}
                                        </Text>
                                    </View>
                                ) : null}
                            </View>
                            <Text
                                numberOfLines={1}
                                className="text-xs text-discord-textMuted"
                            >
                                {entry.alias ? `${entry.alias} · ` : ""}
                                {t("common.memberCount", {
                                    count: entry.memberCount,
                                })}
                                {entry.topic ? ` · ${entry.topic}` : ""}
                            </Text>
                            {joinError?.roomId === entry.roomId ? (
                                <Text
                                    numberOfLines={1}
                                    className="text-xs text-discord-danger"
                                >
                                    {joinError.message}
                                </Text>
                            ) : null}
                        </View>
                        {isJoined(entry.roomId) ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => openJoined(entry)}
                                className="px-3 py-1.5 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors flex-shrink-0"
                            >
                                <Text className="text-sm font-medium text-discord-textPrimary">
                                    {t("roomDirectory.open")}
                                </Text>
                            </Pressable>
                        ) : entry.joinRule === "knock" &&
                          isKnocked(entry.roomId) ? (
                            <Pressable
                                accessibilityRole="button"
                                disabled
                                accessibilityState={{ disabled: true }}
                                className="px-3 py-1.5 rounded bg-discord-backgroundSecondary opacity-60 flex-shrink-0"
                            >
                                <Text className="text-sm font-medium text-discord-textMuted">
                                    {t("roomDirectory.requested")}
                                </Text>
                            </Pressable>
                        ) : entry.joinRule === "knock" ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => void knock(entry)}
                                disabled={joiningId !== null}
                                accessibilityState={{
                                    disabled: joiningId !== null,
                                }}
                                className={`px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors flex-shrink-0 ${
                                    joiningId !== null ? "opacity-50" : ""
                                }`}
                            >
                                <Text className="text-sm font-semibold text-white">
                                    {t("roomDirectory.requestToJoin")}
                                </Text>
                            </Pressable>
                        ) : (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => void join(entry)}
                                disabled={joiningId !== null}
                                accessibilityState={{
                                    disabled: joiningId !== null,
                                }}
                                className={`px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors flex-row items-center gap-2 flex-shrink-0 ${
                                    joiningId !== null ? "opacity-50" : ""
                                }`}
                            >
                                {joiningId === entry.roomId ? (
                                    <View className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : null}
                                <Text className="text-sm font-semibold text-white">
                                    {t("common.join")}
                                </Text>
                            </Pressable>
                        )}
                    </View>
                )}
                ListFooterComponent={
                    showRooms && nextBatch ? (
                        // `mt-1`, plus the column's `gap-1`.
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void loadMore()}
                            disabled={loadingMore}
                            accessibilityState={{ disabled: loadingMore }}
                            className={`mt-2 py-2 rounded hover:bg-discord-messageHover transition-colors flex-row items-center justify-center gap-2 ${
                                loadingMore ? "opacity-50" : ""
                            }`}
                        >
                            {loadingMore ? (
                                <View className="w-4 h-4 border-2 border-discord-accent border-t-transparent rounded-full animate-spin" />
                            ) : null}
                            <Text className="text-sm font-medium text-discord-textSecondary">
                                {t("common.loadMore")}
                            </Text>
                        </Pressable>
                    ) : undefined
                }
                ListEmptyComponent={
                    loading ? (
                        <View className="flex-row items-center justify-center py-10">
                            <View className="w-6 h-6 border-2 border-discord-accent border-t-transparent rounded-full animate-spin" />
                        </View>
                    ) : !showRooms ? (
                        <Text className="text-sm text-discord-textMuted text-center py-10">
                            {t("roomDirectory.noRoomsFound")}
                        </Text>
                    ) : undefined
                }
            />
        </ModalDialog>
    );
}

function RowGap() {
    return <View className="h-1" />;
}
