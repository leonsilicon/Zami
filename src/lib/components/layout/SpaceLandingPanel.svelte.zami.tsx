import { Spin } from "@-/com.leonsilicon.zami.rn";
import { shallowEqual, useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Hash, Menu } from "lucide-svelte";
import type { Room } from "matrix-js-sdk";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import { roomsState, setActiveRoom } from "$lib/stores/rooms.svelte";
import {
    getRoomsInSpace,
    getRoomTopic,
    isJoinedNow,
    joinRoom,
    type SpaceChildInfo,
} from "$lib/matrix/client";
import { showErrorToast } from "$lib/stores/toasts.svelte";

// Zami: the panel is one FlatList (a space can list a thousand rooms, which a
// ScrollView rendered all at once): the joined rooms and the joinable ones are
// its rows, in upstream's order, with the space's header above them and the
// loading and empty states below. Each row is memoized, so a sync or a join
// re-renders only the rows that changed.
type LandingRow =
    | { kind: "joined"; room: Room; last: boolean }
    | { kind: "browse" }
    | { kind: "joinable"; child: SpaceChildInfo; last: boolean };

const rowKey = (row: LandingRow) =>
    row.kind === "joined"
        ? `joined:${row.room.roomId}`
        : row.kind === "joinable"
          ? `joinable:${row.child.roomId}`
          : row.kind;

const JoinedRoomRow = memo(function JoinedRoomRow({
    room,
    last,
}: {
    room: Room;
    last: boolean;
}) {
    // `gap-2` between the list's rows, and the home page's `mb-8` after it.
    return (
        <View className={`w-full max-w-2xl mx-auto ${last ? "mb-8" : "mb-2"}`}>
            <Pressable
                accessibilityRole="button"
                onPress={() => setActiveRoom(room.roomId)}
                className="w-full flex-row items-center gap-3 p-3 rounded-lg bg-discord-backgroundSecondary hover:bg-discord-messageHover text-left transition-colors"
            >
                <Hash size={20} className="text-discord-textMuted shrink-0" />
                <Text
                    numberOfLines={1}
                    className="flex-shrink font-semibold text-discord-textPrimary truncate"
                >
                    {room.name || room.roomId}
                </Text>
            </Pressable>
        </View>
    );
});

const JoinableRow = memo(function JoinableRow({
    child,
    last,
    joining,
    onJoin,
}: {
    child: SpaceChildInfo;
    last: boolean;
    joining: boolean;
    onJoin: (child: SpaceChildInfo) => void;
}) {
    return (
        <View
            className={`w-full max-w-2xl mx-auto flex-row items-center gap-3 p-3 rounded-lg bg-discord-backgroundSecondary ${
                last ? "" : "mb-2"
            }`}
        >
            <Hash size={20} className="text-discord-textMuted shrink-0" />
            <View className="min-w-0 flex-1">
                <Text
                    numberOfLines={1}
                    className="font-semibold text-discord-textPrimary truncate"
                >
                    {child.name || child.roomId}
                </Text>
                {!!child.topic && (
                    <Text
                        numberOfLines={1}
                        className="text-sm text-discord-textMuted truncate"
                    >
                        {child.topic}
                    </Text>
                )}
            </View>
            <Text className="text-xs text-discord-textMuted shrink-0 hidden sm:flex">
                {t("common.memberCount", {
                    count: child.numMembers,
                })}
            </Text>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: joining }}
                onPress={() => onJoin(child)}
                disabled={joining}
                className="px-4 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover disabled:opacity-50 transition-colors shrink-0"
            >
                <Text className="text-white text-sm font-semibold">
                    {joining ? t("common.joining") : t("common.join")}
                </Text>
            </Pressable>
        </View>
    );
});

export default function SpaceLandingPanel({
    isMobile,
    onMenuOpen,
}: {
    isMobile: boolean;
    onMenuOpen: () => void;
}) {
    const [joiningIds, setJoiningIds] = useState(new Set<string>());

    // A drilled or left space has no entry in `spaces` (that list is joined
    // spaces only), so the drill name — and finally a neutral phrase — carry
    // the copy rather than leaving it blank.
    const spaceName = useRune(
        () =>
            roomsState.spaces.find((s) => s.roomId === roomsState.activeSpaceId)
                ?.name ||
            roomsState.spaceDrillName ||
            t("spaceLandingPanel.thisSpace"),
    );

    const spaceRoom = useRune(
        () =>
            roomsState.spaces.find(
                (s) => s.roomId === roomsState.activeSpaceId,
            ) ?? null,
    );
    const spaceTopic = useRune(() => {
        void roomsState.roomsTick;
        return spaceRoom ? getRoomTopic(spaceRoom) : null;
    }, [spaceRoom]);
    // Zami: the lists keep their identity while their rooms are the same
    // (shallowEqual), so the list's rows don't re-render on every sync.
    const joinedRooms = useRune(
        () => {
            void roomsState.roomsTick;
            return roomsState.activeSpaceId
                ? getRoomsInSpace(roomsState.activeSpaceId).filter(
                      (r) => !r.isSpaceRoom(),
                  )
                : [];
        },
        [],
        { isEqual: shallowEqual },
    );

    // Live membership, not the fetch-time `isJoined` (see isJoinedNow).
    const joinable = useRune(
        () => {
            void roomsState.roomsTick;
            return roomsState.spaceHierarchy.filter(
                (r) => !r.isSpace && !isJoinedNow(r),
            );
        },
        [],
        { isEqual: shallowEqual },
    );
    const hasChildSpaces = useRune(() =>
        roomsState.spaceHierarchy.some((r) => r.isSpace),
    );
    // Only claim emptiness once the hierarchy has actually answered.
    const stillLoading = useRune(
        () =>
            roomsState.hierarchyLoading &&
            roomsState.spaceHierarchy.length === 0,
    );
    const showSpaceHome = useRune(() => roomsState.showSpaceHome);

    // Zami: the same function every render, for the memoized rows.
    const handleJoin = useCallback(async (child: SpaceChildInfo) => {
        const roomId = child.roomId;
        setJoiningIds((ids) => new Set(ids).add(roomId));
        try {
            await joinRoom(roomId, child.via);
            roomsState.spaceHierarchy = roomsState.spaceHierarchy.map((r) =>
                r.roomId === roomId ? { ...r, isJoined: true } : r,
            );
            setActiveRoom(roomId);
        } catch (err) {
            console.error("Failed to join room:", err);
            // The sidebar's Browse Channels list owns the knock/request flow —
            // point at it rather than growing a second copy here.
            showErrorToast(
                t("spaceLandingPanel.couldnTJoinTryItFrom", {
                    value: child.name || t("spaceLandingPanel.thatRoom"),
                }),
            );
        } finally {
            setJoiningIds((ids) => {
                const next = new Set(ids);
                next.delete(roomId);
                return next;
            });
        }
    }, []);
    const onJoin = useCallback(
        (child: SpaceChildInfo) => void handleJoin(child),
        [handleJoin],
    );

    // Zami: upstream's markup in order, as the list's rows: the home page's
    // joined rooms, then (unless still loading) the joinable rooms under their
    // heading. The states that fill the rest of the panel are the footer.
    const rows = useMemo((): LandingRow[] => {
        const out: LandingRow[] = [];
        if (showSpaceHome)
            joinedRooms.forEach((room, i) =>
                out.push({
                    kind: "joined",
                    room,
                    last: i === joinedRooms.length - 1,
                }),
            );
        if (!stillLoading && joinable.length > 0) {
            out.push({ kind: "browse" });
            joinable.forEach((child, i) =>
                out.push({
                    kind: "joinable",
                    child,
                    last: i === joinable.length - 1,
                }),
            );
        }
        return out;
    }, [showSpaceHome, joinedRooms, stillLoading, joinable]);

    const header = showSpaceHome ? (
        <View
            className={`w-full max-w-2xl mx-auto ${
                joinedRooms.length > 0 ? "" : "mb-8"
            }`}
        >
            <Text className="text-3xl font-bold text-discord-textPrimary">
                {spaceName}
            </Text>
            {!!spaceTopic && (
                <Text className="mt-2 text-discord-textMuted whitespace-pre-wrap break-words">
                    {spaceTopic}
                </Text>
            )}
            {joinedRooms.length > 0 && (
                <Text className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-discord-textMuted">
                    {t("spaceLandingPanel.yourRooms")}
                </Text>
            )}
        </View>
    ) : null;

    let footer: ReactElement | null = null;
    if (stillLoading)
        footer = (
            <View className="flex-1 flex-row items-center justify-center gap-3">
                <Spin className="w-5 h-5 border-2 border-discord-textMuted border-t-transparent rounded-full" />
                <Text className="text-discord-textMuted">
                    {t("spaceLandingPanel.loadingRooms")}
                </Text>
            </View>
        );
    // The joinable rooms are the rows. Or the home page above already lists
    // everything.
    else if (joinable.length > 0 || joinedRooms.length > 0) footer = null;
    else if (hasChildSpaces)
        footer = (
            <View className="flex-1 flex flex-col items-center justify-center">
                <Text className="text-center text-xl font-bold text-discord-textPrimary mb-2">
                    {t("spaceLandingPanel.nothingJoinedHereYet")}
                </Text>
                <Text className="text-center text-discord-textMuted max-w-sm">
                    {t("spaceLandingPanel.onlyOtherSpacesLiveInsideOpen", {
                        spaceName,
                    })}
                </Text>
            </View>
        );
    else
        footer = (
            <View className="flex-1 flex flex-col items-center justify-center">
                <Text className="text-center text-discord-textMuted max-w-sm">
                    {t("spaceLandingPanel.thereAreNoRoomsInYet", {
                        spaceName,
                    })}
                </Text>
            </View>
        );

    const renderRow = ({ item }: { item: LandingRow }) => {
        if (item.kind === "joined")
            return <JoinedRoomRow room={item.room} last={item.last} />;
        if (item.kind === "joinable")
            return (
                <JoinableRow
                    child={item.child}
                    last={item.last}
                    joining={joiningIds.has(item.child.roomId)}
                    onJoin={onJoin}
                />
            );
        return (
            <View className="w-full max-w-2xl mx-auto">
                <Text className="text-2xl font-bold text-discord-textPrimary mb-1">
                    {t("spaceLandingPanel.browseRooms")}
                </Text>
                <Text className="text-discord-textMuted mb-6">
                    {t("spaceLandingPanel.youHavenTJoinedARoom", {
                        spaceName,
                    })}
                </Text>
            </View>
        );
    };

    return (
        <View className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {isMobile && (
                <View className="h-12 flex-row items-center gap-2 px-3 border-b border-discord-backgroundTertiary shrink-0">
                    <Pressable
                        accessibilityRole="button"
                        onPress={onMenuOpen}
                        className="p-1.5 rounded hover:bg-discord-messageHover transition-colors"
                        accessibilityLabel={t("common.openRoomList")}
                    >
                        <Menu size={20} className="text-discord-textMuted" />
                    </Pressable>
                    <Text
                        numberOfLines={1}
                        className="flex-shrink font-semibold text-discord-textPrimary truncate"
                    >
                        {spaceName}
                    </Text>
                </View>
            )}

            {/* Zami: `h-full` centring inside the scroller → a growing content
                container whose footer (the centred states) grows to fill it. */}
            <FlatList
                className="flex-1"
                contentContainerClassName="flex-grow p-8"
                data={rows}
                keyExtractor={rowKey}
                renderItem={renderRow}
                extraData={joiningIds}
                initialNumToRender={15}
                windowSize={7}
                ListHeaderComponent={header ?? undefined}
                ListFooterComponent={footer ?? undefined}
                ListFooterComponentStyle={{ flexGrow: 1 }}
            />
        </View>
    );
}
