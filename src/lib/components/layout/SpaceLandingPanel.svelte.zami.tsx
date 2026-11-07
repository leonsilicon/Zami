import { Spin } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Hash, Menu } from "lucide-svelte";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
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
    const joinedRooms = useRune(() => {
        void roomsState.roomsTick;
        return roomsState.activeSpaceId
            ? getRoomsInSpace(roomsState.activeSpaceId).filter(
                  (r) => !r.isSpaceRoom(),
              )
            : [];
    });

    // Live membership, not the fetch-time `isJoined` (see isJoinedNow).
    const joinable = useRune(() => {
        void roomsState.roomsTick;
        return roomsState.spaceHierarchy.filter(
            (r) => !r.isSpace && !isJoinedNow(r),
        );
    });
    const childSpaces = useRune(() =>
        roomsState.spaceHierarchy.filter((r) => r.isSpace),
    );
    // Only claim emptiness once the hierarchy has actually answered.
    const stillLoading = useRune(
        () =>
            roomsState.hierarchyLoading &&
            roomsState.spaceHierarchy.length === 0,
    );
    const showSpaceHome = useRune(() => roomsState.showSpaceHome);

    async function handleJoin(child: SpaceChildInfo) {
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
    }

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
                container whose centred states take `flex-1`. */}
            <ScrollView
                className="flex-1"
                contentContainerClassName="flex-grow p-8"
            >
                {showSpaceHome && (
                    <View className="w-full max-w-2xl mx-auto mb-8">
                        <Text className="text-3xl font-bold text-discord-textPrimary">
                            {spaceName}
                        </Text>
                        {!!spaceTopic && (
                            <Text className="mt-2 text-discord-textMuted whitespace-pre-wrap break-words">
                                {spaceTopic}
                            </Text>
                        )}
                        {joinedRooms.length > 0 && (
                            <>
                                <Text className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-discord-textMuted">
                                    {t("spaceLandingPanel.yourRooms")}
                                </Text>
                                <View className="flex flex-col gap-2">
                                    {joinedRooms.map((room) => (
                                        <View key={room.roomId}>
                                            <Pressable
                                                accessibilityRole="button"
                                                onPress={() =>
                                                    setActiveRoom(room.roomId)
                                                }
                                                className="w-full flex-row items-center gap-3 p-3 rounded-lg bg-discord-backgroundSecondary hover:bg-discord-messageHover text-left transition-colors"
                                            >
                                                <Hash
                                                    size={20}
                                                    className="text-discord-textMuted shrink-0"
                                                />
                                                <Text
                                                    numberOfLines={1}
                                                    className="flex-shrink font-semibold text-discord-textPrimary truncate"
                                                >
                                                    {room.name || room.roomId}
                                                </Text>
                                            </Pressable>
                                        </View>
                                    ))}
                                </View>
                            </>
                        )}
                    </View>
                )}
                {stillLoading ? (
                    <View className="flex-1 flex-row items-center justify-center gap-3">
                        <Spin className="w-5 h-5 border-2 border-discord-textMuted border-t-transparent rounded-full" />
                        <Text className="text-discord-textMuted">
                            {t("spaceLandingPanel.loadingRooms")}
                        </Text>
                    </View>
                ) : joinable.length > 0 ? (
                    <View className="w-full max-w-2xl mx-auto">
                        <Text className="text-2xl font-bold text-discord-textPrimary mb-1">
                            {t("spaceLandingPanel.browseRooms")}
                        </Text>
                        <Text className="text-discord-textMuted mb-6">
                            {t("spaceLandingPanel.youHavenTJoinedARoom", {
                                spaceName,
                            })}
                        </Text>
                        <View className="flex flex-col gap-2">
                            {joinable.map((child) => (
                                <View
                                    key={child.roomId}
                                    className="flex-row items-center gap-3 p-3 rounded-lg bg-discord-backgroundSecondary"
                                >
                                    <Hash
                                        size={20}
                                        className="text-discord-textMuted shrink-0"
                                    />
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
                                        accessibilityState={{
                                            disabled: joiningIds.has(
                                                child.roomId,
                                            ),
                                        }}
                                        onPress={() => void handleJoin(child)}
                                        disabled={joiningIds.has(child.roomId)}
                                        className="px-4 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover disabled:opacity-50 transition-colors shrink-0"
                                    >
                                        <Text className="text-white text-sm font-semibold">
                                            {joiningIds.has(child.roomId)
                                                ? t("common.joining")
                                                : t("common.join")}
                                        </Text>
                                    </Pressable>
                                </View>
                            ))}
                        </View>
                    </View>
                ) : joinedRooms.length > 0 ? (
                    <>{/* The home page above already lists everything. */}</>
                ) : childSpaces.length > 0 ? (
                    <View className="flex-1 flex flex-col items-center justify-center">
                        <Text className="text-center text-xl font-bold text-discord-textPrimary mb-2">
                            {t("spaceLandingPanel.nothingJoinedHereYet")}
                        </Text>
                        <Text className="text-center text-discord-textMuted max-w-sm">
                            {t(
                                "spaceLandingPanel.onlyOtherSpacesLiveInsideOpen",
                                {
                                    spaceName,
                                },
                            )}
                        </Text>
                    </View>
                ) : (
                    <View className="flex-1 flex flex-col items-center justify-center">
                        <Text className="text-center text-discord-textMuted max-w-sm">
                            {t("spaceLandingPanel.thereAreNoRoomsInYet", {
                                spaceName,
                            })}
                        </Text>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}
