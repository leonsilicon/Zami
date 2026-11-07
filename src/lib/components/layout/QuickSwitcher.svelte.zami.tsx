import { keepFocus, useKeyScope } from "@-/com.leonsilicon.zami.browser";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useMemo, useRef, useState } from "react";
import {
    FlatList,
    Pressable,
    Text,
    TextInput,
    View,
    type TextInputInstance,
} from "react-native";
import { t } from "$lib/i18n";
// Ctrl+K: jump to any room, DM or space by name, as in Discord. With
// nothing typed it lists the rooms visited this session, then unread ones.
import type { Room } from "matrix-js-sdk";
import {
    getRooms,
    getRoom,
    getRoomDisplayName,
    getRoomAvatar,
    getRoomUnreadInfo,
    findSpaceForRoom,
} from "$lib/matrix/client";
import {
    roomsState,
    navigateToRoom,
    setActiveSpace,
} from "$lib/stores/rooms.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";
import { recentRooms } from "$lib/keybinds/runner";
import { matchScore } from "$lib/keybinds/quickSwitcherMatch";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";

interface Props {
    onClose: () => void;
}

interface Entry {
    room: Room;
    name: string;
    space: boolean;
    /** Where it lives: the space's name, or null for Home. */
    where: string | null;
    unread: boolean;
    mention: boolean;
}

const MAX_RESULTS = 30;

export default function QuickSwitcher({ onClose }: Props) {
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState(0);
    const inputEl = useRef<TextInputInstance>(null);
    const listEl = useRef<FlatList<Entry>>(null);
    const activeRoomId = useRune(() => roomsState.activeRoomId);
    const isTouchscreen = useRune(() => interfaceState.isTouchscreen);

    // Built once per open: the dialog is short-lived.
    const [entries] = useState((): Entry[] => {
        void roomsState.unreadTick;
        return getRooms().map((room) => {
            const space = room.isSpaceRoom();
            const spaceId = space ? null : findSpaceForRoom(room.roomId);
            const spaceRoom = spaceId ? getRoom(spaceId) : null;
            const info = space
                ? { unread: false, highlight: 0 }
                : getRoomUnreadInfo(room);
            return {
                room,
                name: getRoomDisplayName(room),
                space,
                where: spaceRoom ? getRoomDisplayName(spaceRoom) : null,
                unread: info.unread,
                mention: info.highlight > 0,
            };
        });
    });

    const results = useMemo((): Entry[] => {
        const q = query.trim();
        if (!q) {
            const byId = new Map(entries.map((e) => [e.room.roomId, e]));
            const recent = recentRooms()
                .filter((id) => id !== activeRoomId)
                .map((id) => byId.get(id))
                .filter((e): e is Entry => !!e);
            const seen = new Set(recent.map((e) => e.room.roomId));
            const unread = entries
                .filter((e) => e.unread && !seen.has(e.room.roomId))
                .sort((a, b) => Number(b.mention) - Number(a.mention));
            return [...recent, ...unread].slice(0, MAX_RESULTS);
        }
        return entries
            .map((e) => ({ e, score: matchScore(e.name, q) }))
            .filter((x): x is { e: Entry; score: number } => x.score !== null)
            .sort(
                (a, b) =>
                    b.score - a.score ||
                    Number(b.e.unread) - Number(a.e.unread) ||
                    a.e.name.localeCompare(b.e.name),
            )
            .slice(0, MAX_RESULTS)
            .map((x) => x.e);
    }, [query, entries, activeRoomId]);

    // Zami: `selected = 0` whenever the query changes is done where it
    // changes (onChangeText below). Focusing the input on mount is its
    // `autoFocus`.

    function choose(e: Entry | undefined) {
        if (!e) return;
        onClose();
        if (e.space) setActiveSpace(e.room.roomId);
        else navigateToRoom(e.room.roomId);
    }

    function move(step: number) {
        if (results.length === 0) return;
        const next = (selected + step + results.length) % results.length;
        setSelected(next);
        // Zami: `scrollIntoView({ block: "nearest" })`.
        listEl.current?.scrollToIndex({
            index: next,
            viewPosition: step > 0 ? 1 : 0,
            animated: false,
        });
    }

    // Zami: hardware keys are observed, not intercepted: Enter is the
    // TextInput's return key (onSubmitEditing picks), and Tab still moves
    // focus to the next field, so focus is put back (keepFocus).
    function onKeydown(e: KeyboardEvent) {
        if (e.key === "Tab") keepFocus(inputEl);
        if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
            e.preventDefault();
            move(1);
        } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
            e.preventDefault();
            move(-1);
        } else if (e.key === "Enter") {
            e.preventDefault();
        }
    }

    // Zami: ModalDialog's `onKeydown`: the dialog's keys, with focus in its
    // input or nowhere.
    useKeyScope({ onKeydown }, [inputEl]);

    return (
        <ModalDialog
            onClose={onClose}
            labelledBy="quick-switcher-title"
            layerClass="z-50 flex items-start justify-center pt-[15vh] px-4"
            panelClass="relative w-full max-w-xl bg-discord-backgroundSecondary rounded-lg shadow-xl overflow-hidden"
        >
            <View className="p-4 flex flex-col gap-3">
                <Text
                    nativeID="quick-switcher-title"
                    accessibilityRole="header"
                    className="text-sm font-semibold text-discord-textPrimary"
                >
                    {t("quickSwitcher.title")}
                </Text>
                <TextInput
                    ref={inputEl}
                    value={query}
                    onChangeText={(value) => {
                        setQuery(value);
                        setSelected(0);
                    }}
                    onSubmitEditing={() => choose(results[selected])}
                    submitBehavior="submit"
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityRole="combobox"
                    accessibilityState={{ expanded: true }}
                    accessibilityLabel={t("quickSwitcher.placeholder")}
                    placeholder={t("quickSwitcher.placeholder")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    className="w-full px-3 py-2.5 rounded bg-discord-backgroundTertiary text-discord-textPrimary text-base border-2 border-transparent focus:border-discord-accent"
                />
                {!query.trim() && results.length > 0 ? (
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                        {t("quickSwitcher.recentAndUnread")}
                    </Text>
                ) : null}
                <FlatList
                    ref={listEl}
                    nativeID="quick-switcher-list"
                    accessibilityRole="list"
                    className="max-h-80 flex-grow-0 -mx-1"
                    keyboardShouldPersistTaps="handled"
                    data={results}
                    extraData={selected}
                    keyExtractor={(e) => e.room.roomId}
                    onScrollToIndexFailed={() => {}}
                    renderItem={({ item: e, index: i }) => (
                        <Pressable
                            nativeID={`quick-switcher-${i}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected: i === selected }}
                            className={`flex-row items-center gap-3 px-2 py-1.5 mx-1 rounded ${
                                i === selected ? "bg-discord-messageHover" : ""
                            }`}
                            onPress={() => choose(e)}
                            onHoverIn={() => setSelected(i)}
                        >
                            <Avatar
                                src={getRoomAvatar(e.room)}
                                name={e.name}
                                id={e.room.roomId}
                                size={24}
                                rounded={e.space ? "lg" : "full"}
                            />
                            <Text
                                numberOfLines={1}
                                className={`flex-1 min-w-0 text-sm ${
                                    e.unread
                                        ? "text-discord-textPrimary font-semibold"
                                        : "text-discord-textSecondary"
                                }`}
                            >
                                {e.name}
                            </Text>
                            {e.mention ? (
                                <View
                                    className="w-2 h-2 rounded-full bg-discord-danger flex-shrink-0"
                                    accessibilityLabel={t(
                                        "quickSwitcher.mentioned",
                                    )}
                                />
                            ) : null}
                            <Text
                                numberOfLines={1}
                                className="flex-shrink text-xs text-discord-textMuted max-w-[40%]"
                            >
                                {e.space
                                    ? t("quickSwitcher.space")
                                    : (e.where ?? t("quickSwitcher.home"))}
                            </Text>
                        </Pressable>
                    )}
                    ListEmptyComponent={
                        <Text className="px-2 py-3 text-sm text-discord-textMuted">
                            {t("quickSwitcher.noResults")}
                        </Text>
                    }
                />
                {/* Zami: the hint names keyboard keys, so a touchscreen
                    doesn't show it. */}
                {isTouchscreen ? null : (
                    <Text className="text-xs text-discord-textMuted">
                        {t("quickSwitcher.hint")}
                    </Text>
                )}
            </View>
        </ModalDialog>
    );
}
