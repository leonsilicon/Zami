import { Spin } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import type { Room, MatrixEvent } from "matrix-js-sdk";
import {
    getPinnedEventIds,
    unpinMessage,
    findEventById,
    fetchEventById,
    getMemberName,
    getMemberAvatar,
    getMyPowerLevel,
    getRoomPowerLevels,
} from "$lib/matrix/client";
import { roomsState } from "$lib/stores/rooms.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import { pinnedDate } from "$lib/utils/timeFormat";
import { createStaleGuard } from "$lib/utils/staleGuard";

interface Props {
    room: Room;
    onClose: () => void;
    onJumpTo: (eventId: string) => void;
}

export default function PinnedMessagesPanel({
    room,
    onClose,
    onJumpTo,
}: Props) {
    const isMobile = useRune(() => interfaceState.isMobile);
    const roomsTick = useRune(() => roomsState.roomsTick);

    // getPinnedEventIds returns the state event's own `content.pinned` array
    // when pins exist — its identity is already stable across syncs, so the
    // derived never changed for those rooms — but a FRESH [] when the room has
    // none. Only pinless rooms were affected: there the derived changed
    // identity on every sync and re-ran the fetch effect below for nothing.
    // (Nothing was visible — that "refetch" is Promise.allSettled([]), which
    // resolves in a microtask, before paint. It was pure wasted work.) Hold the
    // last value while the ids are equal; this is the repo's established "keep
    // the tick dependency, make the write conditional" pattern.
    // Zami: the last value is held in state, updated during render (React's
    // "information from previous renders" pattern) rather than in `let`s.
    const ids = useMemo(() => {
        void roomsTick;
        return getPinnedEventIds(room);
    }, [roomsTick, room]);
    const key = `${room.roomId}\u0000${ids.join(",")}`;
    const [lastPinned, setLastPinned] = useState({ key, ids });
    if (key !== lastPinned.key) setLastPinned({ key, ids });
    const pinnedIds = key === lastPinned.key ? lastPinned.ids : ids;
    const [fetchedEvents, setFetchedEvents] = useState<MatrixEvent[]>([]);
    const [loading, setLoading] = useState(false);
    // Per-event guard so a double-click on Unpin can't fire two redundant
    // writes (the second would just 403 / no-op). F10.
    const [pendingUnpin, setPendingUnpin] = useState(new Set<string>());
    // A pin lookup can outlive the room it was asked for — the panel is not
    // keyed by room — and a sync can re-trigger the fetch mid-flight. Only the
    // newest run may write, and it is the only one that clears the spinner.
    const [pinFetches] = useState(createStaleGuard);

    useEffect(() => {
        const ids = pinnedIds;
        const roomId = room.roomId;
        setLoading(true);
        setFetchedEvents([]);
        void (async () => {
            const outcome = await pinFetches.run(async () => {
                // allSettled, not all: one unreachable pin must not blank the
                // pins that did resolve.
                const settled = await Promise.allSettled(
                    ids.map(async (id) => {
                        return (
                            findEventById(room, id) ??
                            (await fetchEventById(roomId, id))
                        );
                    }),
                );
                return settled
                    .filter(
                        (r): r is PromiseFulfilledResult<MatrixEvent | null> =>
                            r.status === "fulfilled",
                    )
                    .map((r) => r.value)
                    .filter((e): e is MatrixEvent => !!e)
                    .sort((a, b) => b.getTs() - a.getTs());
            });
            // Superseded — a newer run owns `loading` and `fetchedEvents`.
            if (outcome.status === "stale") return;
            // Master had no failure path at all here, so a rejection pinned the
            // spinner on forever. Blanking is the right data call — rendering
            // the previous room's pins under this room's members is the bug
            // this guard exists to stop — but the empty list then renders "No
            // pinned messages", which is false for a room that has some. Log so
            // the wrong statement is at least diagnosable.
            if (outcome.status === "error") {
                console.error("Pinned messages fetch failed", outcome.error);
            }
            setFetchedEvents(outcome.status === "ok" ? outcome.value : []);
            setLoading(false);
        })();
        return () => pinFetches.cancel();
    }, [pinnedIds, room, pinFetches]);

    const pinnedEvents = fetchedEvents;

    const canPin = useMemo(() => {
        void roomsTick;
        const myPl = getMyPowerLevel(room);
        const pl = getRoomPowerLevels(room);
        const pinPl = pl.events?.["m.room.pinned_events"] ?? pl.state_default;
        return myPl >= pinPl;
    }, [roomsTick, room]);

    function excerpt(event: MatrixEvent): string {
        const content = event.getContent();
        return content.body ?? content.msgtype ?? "(message)";
    }

    async function unpin(event: MatrixEvent) {
        const id = event.getId()!;
        if (pendingUnpin.has(id)) return;
        setPendingUnpin((p) => new Set(p).add(id));
        try {
            await unpinMessage(room, id);
        } catch (e) {
            console.error("Failed to unpin message", e);
            showErrorToast("Failed to unpin message");
        } finally {
            setPendingUnpin((p) => new Set([...p].filter((x) => x !== id)));
        }
    }

    return (
        <View
            className={`${
                isMobile ? "" : "w-72"
            } h-full flex flex-col bg-discord-backgroundSecondary border-l border-discord-divider`}
        >
            <View className="h-12 flex-row items-center gap-2 px-4 py-3 border-b border-discord-divider flex-shrink-0">
                <Text
                    accessibilityRole="header"
                    className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide flex-1"
                >
                    {t("pinnedMessagesPanel.pinnedMessages")}
                </Text>
            </View>

            <FlatList
                className="flex-1"
                contentContainerClassName={
                    loading || pinnedEvents.length === 0 ? undefined : "p-2"
                }
                data={loading ? [] : pinnedEvents}
                extraData={pendingUnpin}
                keyExtractor={(event) => event.getId()!}
                // `space-y-1`
                ItemSeparatorComponent={RowGap}
                renderItem={({ item: event }) => {
                    const sender = event.getSender() ?? "";
                    const avatarUrl = getMemberAvatar(room, sender);
                    const name = getMemberName(room, sender);
                    return (
                        <View className="p-2 rounded-lg hover:bg-discord-messageHover transition-colors">
                            <View className="flex-row items-center gap-2 mb-1">
                                <Avatar
                                    src={avatarUrl}
                                    name={name}
                                    id={sender}
                                    size={18}
                                />
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-xs font-semibold text-discord-textPrimary"
                                >
                                    {name}
                                </Text>
                                <Text className="text-xs text-discord-textMuted ms-auto flex-shrink-0">
                                    {pinnedDate(event.getTs())}
                                </Text>
                            </View>
                            <Text
                                numberOfLines={3}
                                className="text-xs text-discord-textMuted"
                            >
                                {excerpt(event)}
                            </Text>
                            {/* Zami: upstream reveals the actions on hover
                                (`opacity-0 group-hover:opacity-100`), which
                                React Native doesn't track; they always show. */}
                            <View className="flex-row gap-1 mt-1.5">
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => {
                                        onJumpTo(event.getId()!);
                                        onClose();
                                    }}
                                    hitSlop={6}
                                >
                                    <Text className="text-xs text-discord-accent">
                                        {t("pinnedMessagesPanel.jump")}
                                    </Text>
                                </Pressable>
                                {canPin ? (
                                    <>
                                        <Text className="text-discord-textMuted text-xs">
                                            ·
                                        </Text>
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() => void unpin(event)}
                                            disabled={pendingUnpin.has(
                                                event.getId()!,
                                            )}
                                            accessibilityState={{
                                                disabled: pendingUnpin.has(
                                                    event.getId()!,
                                                ),
                                            }}
                                            hitSlop={6}
                                            className={
                                                pendingUnpin.has(event.getId()!)
                                                    ? "opacity-50"
                                                    : ""
                                            }
                                        >
                                            <Text className="text-xs text-discord-textMuted hover:text-discord-danger transition-colors">
                                                {t("pinnedMessagesPanel.unpin")}
                                            </Text>
                                        </Pressable>
                                    </>
                                ) : null}
                            </View>
                        </View>
                    );
                }}
                ListEmptyComponent={
                    loading ? (
                        <View className="flex-row justify-center mt-8">
                            <Spin className="w-5 h-5 border-2 border-discord-accent border-t-transparent rounded-full" />
                        </View>
                    ) : (
                        <Text className="text-sm text-discord-textMuted text-center mt-8 px-4">
                            {t("pinnedMessagesPanel.noPinnedMessages")}
                        </Text>
                    )
                }
            />
        </View>
    );
}

function RowGap() {
    return <View className="h-1" />;
}
