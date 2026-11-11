import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Image, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { shallowEqual, useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { relationsRevision } from "@-/com.leonsilicon.zami.event-revision";
import { t } from "$lib/i18n";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import {
    getReactions,
    sendReaction,
    removeReaction,
    mxcToHttp,
    getMemberName,
    getMemberAvatar,
} from "$lib/matrix/client";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import { matrixErrorMessage } from "$lib/utils/knock";
import { isEmojiOnly } from "$lib/utils/twemoji";
import { roomsState } from "$lib/stores/rooms.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { orderReactors } from "$lib/utils/reactionReactors";
import ReactorPopover from "./ReactorPopover.svelte";

interface Props {
    eventId: string;
    room: Room;
    // Zami: the reacted-to event, whose reactions this follows itself, in
    // place of `reactionTick`, which every reaction in the room moved for
    // every row.
    event: MatrixEvent;
}

// Zami: what a reaction is, for relationsRevision.
const REACTION_TYPES = ["m.reaction"];
// Zami: what the reactor list reads while it is closed.
const REACTORS_CLOSED: { roomsTick: number; ownUserId: string | null } = {
    roomsTick: 0,
    ownUserId: null,
};

export default function Reactions({ eventId, room, event }: Props) {
    // Optimistic removals: event IDs of reactions the user has removed, pending server confirmation
    const [pendingRemovals, setPendingRemovals] = useState(
        () => new Set<string>(),
    );

    // Re-read reactions whenever reactionTick changes
    // Zami: a revision that moves when this event's reactions change (one is
    // added, removed or redacted, or one of ours finishes sending).
    const reactionTick = useRune(
        () =>
            relationsRevision(
                room.relations,
                event,
                "m.annotation",
                REACTION_TYPES,
            ),
        [room, event],
    );
    const reactions = useMemo(() => {
        void reactionTick; // dependency
        return getReactions(room, eventId);
    }, [reactionTick, room, eventId]);

    // Clean up pendingRemovals once the specific reaction event ID is gone from server state
    useEffect(() => {
        const serverEventIds = new Set(
            reactions.flatMap((g) => (g.myEventId ? [g.myEventId] : [])),
        );
        for (const id of pendingRemovals) {
            if (!serverEventIds.has(id)) {
                setPendingRemovals(
                    (prev) => new Set([...prev].filter((i) => i !== id)),
                );
            }
        }
    }, [reactions, pendingRemovals]);

    // Decrement count by 1 for pending removals; hide group only if count reaches 0
    const visibleReactions = useMemo(
        () =>
            reactions
                .map((g) => {
                    if (g.myEventId && pendingRemovals.has(g.myEventId)) {
                        return {
                            ...g,
                            count: g.count - 1,
                            isMine: false,
                            myEventId: null,
                        };
                    }
                    return g;
                })
                .filter((g) => g.count > 0),
        [reactions, pendingRemovals],
    );

    async function toggleReaction(
        key: string,
        isMine: boolean,
        myEventId: string | null,
    ) {
        if (isMine) {
            if (!myEventId) return; // local echo still pending — ignore click
            setPendingRemovals((prev) => new Set([...prev, myEventId]));
            try {
                await removeReaction(room.roomId, myEventId);
            } catch (err) {
                // Restore on failure
                setPendingRemovals(
                    (prev) =>
                        new Set([...prev].filter((id) => id !== myEventId)),
                );
                console.error("Failed to remove reaction:", err);
            }
        } else {
            try {
                await sendReaction(room.roomId, eventId, key);
            } catch (err) {
                console.error("Failed to send reaction:", err);
                showErrorToast(
                    matrixErrorMessage(err, t("reactions.couldNotAddReaction")),
                );
            }
        }
    }

    // Zami: no `emojiHtml`: iOS draws emoji itself, so an emoji key renders
    // as text rather than as twemoji's <img>.

    // Which reaction's reactor list is open, and how (hover vs touch sheet).
    const [openKey, setOpenKey] = useState<string | null>(null);
    const [openTouch, setOpenTouch] = useState(false);
    // Zami: the hover card's anchor, which only openHover sets (not ported).
    const anchorX = 0;
    const anchorY = 0;

    // Zami: only an open reactor list reads these, so a row subscribes to
    // them only while its list is open (as one store).
    const reactorState = useRune(
        () =>
            openKey
                ? { roomsTick: roomsState.roomsTick, ownUserId: auth.userId }
                : REACTORS_CLOSED,
        [openKey],
        { isEqual: shallowEqual },
    );
    const roomsTick = reactorState.roomsTick;
    const ownUserId = reactorState.ownUserId;

    function reactorsFor(reactorIds: string[]) {
        void roomsTick; // re-resolve names/avatars as members load
        const { shown, overflow } = orderReactors(reactorIds, ownUserId);
        return {
            reactors: shown.map((userId) => ({
                userId,
                name: getMemberName(room, userId),
                avatarUrl: getMemberAvatar(room, userId),
            })),
            overflow,
        };
    }

    function activeReactors() {
        if (!openKey) return null;
        const g = visibleReactions.find((r) => r.key === openKey);
        if (!g) return null;
        const info = reactorsFor(g.reactorIds);
        if (info.reactors.length === 0 && info.overflow === 0) return null;
        return { key: g.key, ...info };
    }
    const active = activeReactors();

    // Zami: not ported: openHover/closeHover, the reactor card shown while a
    // mouse hovers a pill (`onpointerenter`/`onpointerleave` with
    // `pointerType === "mouse"`, anchored to the pill's bounding rect). Touch
    // opens the sheet with a long press, as upstream does.
    function openSheet(key: string) {
        setOpenTouch(true);
        setOpenKey(key);
    }
    function closePopover() {
        setOpenKey(null);
        setOpenTouch(false);
    }

    if (visibleReactions.length === 0) return null;
    return (
        <View className="flex-row flex-wrap gap-1 mt-1">
            {visibleReactions.map((group) => {
                const imgSrc = group.key.startsWith("mxc://")
                    ? mxcToHttp(group.key)
                    : null;
                // Zami: the pill's text size, weight and color, on each text
                // inside (they don't inherit).
                const textClass = `text-xs font-medium ${
                    group.isMine ? "text-white" : "text-discord-textSecondary"
                }`;
                return (
                    <Pressable
                        key={group.key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: group.isMine }}
                        onPress={() =>
                            void toggleReaction(
                                group.key,
                                group.isMine,
                                group.myEventId,
                            )
                        }
                        // Zami: the `longPress` action (500 ms, a 50 ms vibrate).
                        delayLongPress={500}
                        onLongPress={() => {
                            void Haptics.impactAsync(
                                Haptics.ImpactFeedbackStyle.Medium,
                            );
                            openSheet(group.key);
                        }}
                        className={`flex-row items-center gap-1 px-2 py-0.5 rounded-full border transition-colors ${
                            group.isMine
                                ? "bg-discord-accent border-discord-accent"
                                : "bg-discord-backgroundTertiary border-discord-divider hover:border-discord-accent"
                        }`}
                    >
                        {imgSrc ? (
                            <Image
                                source={mediaSource(imgSrc)}
                                accessibilityLabel={group.key}
                                contentFit="contain"
                                className="w-4 h-4"
                            />
                        ) : group.key.startsWith(":") &&
                          group.key.endsWith(":") ? (
                            <Text className={`font-mono ${textClass}`}>
                                {group.key}
                            </Text>
                        ) : isEmojiOnly(group.key) ? (
                            <Text className={textClass}>{group.key}</Text>
                        ) : (
                            // Arbitrary reaction key: render as escaped text, never raw HTML
                            <Text className={textClass}>{group.key}</Text>
                        )}
                        <Text className={textClass}>{group.count}</Text>
                    </Pressable>
                );
            })}
            {active && (
                <ReactorPopover
                    key={String(openTouch)}
                    reactors={active.reactors}
                    overflow={active.overflow}
                    label={active.key}
                    touch={openTouch}
                    x={anchorX}
                    y={anchorY}
                    onClose={closePopover}
                    modalId={openTouch ? "reactors" : undefined}
                />
            )}
        </View>
    );
}
