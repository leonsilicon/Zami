// Who reacted to a message, by reaction: a tab per reaction, and for the
// selected one each reactor with when they reacted (and a remove button on
// your own). A centred dialog on desktop, a bottom sheet on mobile. The
// caller claims the "reactions-viewer" modal slot; Escape/back dismiss
// through it.
import { Image, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { t } from "$lib/i18n";
import type { Room } from "matrix-js-sdk";
import { X } from "lucide-svelte";
import {
    getReactions,
    getReactionDetails,
    getCustomEmojis,
    removeReaction,
    mxcToHttp,
    getMemberName,
    getMemberAvatar,
} from "$lib/matrix/client";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import BottomSheet from "$lib/components/ui/BottomSheet.svelte";
import Portal from "$lib/components/ui/Portal.svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";
import { messagesState } from "$lib/stores/messages.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import { isEmojiOnly } from "$lib/utils/twemoji";
import { reactionDisplayName } from "$lib/utils/reactionLabel";
import { initialReactionKey } from "$lib/utils/reactionDetails";
import { compactDateTime } from "$lib/utils/timeFormat";

interface Props {
    room: Room;
    eventId: string;
    onClose: () => void;
}

export default function ReactionsViewer({ room, eventId, onClose }: Props) {
    const reactionTick = useRune(() => messagesState.reactionTick);
    const roomsTick = useRune(() => roomsState.roomsTick);
    const userId = useRune(() => auth.userId);

    const groups = useMemo(() => {
        void reactionTick;
        return getReactionDetails(room, eventId);
    }, [reactionTick, room, eventId]);

    // Tabs follow the live reactions, so a reaction removed (by anyone) while
    // this is open drops its tab and the selection falls back.
    const [chosenKey, setChosenKey] = useState<string | null>(null);
    const selected =
        groups.find((g) => g.key === chosenKey) ??
        groups.find((g) => g.key === initialReactionKey(groups, userId));

    const shortcodes = useMemo(() => {
        void reactionTick;
        return new Map(
            getReactions(room, eventId).map((g) => [g.key, g.shortcode]),
        );
    }, [reactionTick, room, eventId]);
    const hasCustom = groups.some((g) => g.key.startsWith("mxc://"));
    const customEmojis = useMemo(() => {
        void roomsTick;
        if (!hasCustom) return [];
        return getCustomEmojis(room);
    }, [roomsTick, hasCustom, room]);
    function labelFor(key: string): string {
        return reactionDisplayName(
            key,
            shortcodes.get(key) ?? null,
            customEmojis,
            t("common.emoji"),
        );
    }

    const reactors = useMemo(() => {
        void roomsTick; // names and avatars fill in as members load
        return (selected?.reactors ?? []).map((r) => ({
            ...r,
            name: getMemberName(room, r.userId),
            avatarUrl: getMemberAvatar(room, r.userId),
        }));
    }, [roomsTick, selected, room]);

    const [removing, setRemoving] = useState<Set<string>>(new Set());
    async function remove(reactionEventId: string) {
        setRemoving((prev) => new Set(prev).add(reactionEventId));
        try {
            await removeReaction(room.roomId, reactionEventId);
        } catch (err) {
            console.error("Failed to remove reaction:", err);
            showErrorToast(t("reactionsViewer.couldNotRemove"));
        } finally {
            setRemoving((prev) => {
                const next = new Set(prev);
                next.delete(reactionEventId);
                return next;
            });
        }
    }

    const sheet = useRune(() => interfaceState.isMobile);

    // Zami: iOS draws emoji itself, so an emoji key is plain text (upstream's
    // twemoji `{@html}`), sized as upstream's 1.5rem / 4rem images.
    function keyView(key: string, size: "tab" | "hero") {
        const imgSrc = key.startsWith("mxc://") ? mxcToHttp(key) : null;
        if (imgSrc) {
            return (
                <Image
                    source={mediaSource(imgSrc)}
                    accessibilityLabel=""
                    contentFit="contain"
                    className={size === "hero" ? "w-16 h-16" : "w-6 h-6"}
                />
            );
        }
        if (key.startsWith(":") && key.endsWith(":")) {
            return (
                <Text
                    numberOfLines={size === "hero" ? undefined : 1}
                    className={`font-mono text-zam-textPrimary ${
                        size === "hero"
                            ? "text-2xl font-semibold text-center"
                            : "text-xs max-w-16"
                    }`}
                >
                    {key}
                </Text>
            );
        }
        if (isEmojiOnly(key)) {
            return (
                <Text className={size === "hero" ? "text-6xl" : "text-xl"}>
                    {key}
                </Text>
            );
        }
        // Arbitrary reaction key: escaped text, never raw HTML
        return (
            <Text
                numberOfLines={size === "hero" ? undefined : 1}
                className={`text-zam-textPrimary ${
                    size === "hero"
                        ? "text-2xl font-semibold text-center"
                        : "text-sm max-w-16"
                }`}
            >
                {key}
            </Text>
        );
    }

    function tabs(vertical: boolean) {
        const items = groups.map((group) => {
            const isSel = group.key === selected?.key;
            return (
                <Pressable
                    key={group.key}
                    role="tab"
                    accessibilityState={{ selected: isSel }}
                    accessibilityLabel={labelFor(group.key)}
                    onPress={() => setChosenKey(group.key)}
                    className={`flex-row items-center gap-2 px-2.5 py-1.5 rounded-lg flex-shrink-0 ${
                        vertical ? "w-full" : ""
                    } ${
                        isSel
                            ? "bg-zam-messageHover"
                            : "hover:bg-zam-messageHover"
                    }`}
                >
                    {keyView(group.key, "tab")}
                    <Text
                        className={`text-sm font-semibold tabular-nums ${
                            isSel
                                ? "text-zam-textPrimary"
                                : "text-zam-textSecondary"
                        }`}
                    >
                        {group.count}
                    </Text>
                </Pressable>
            );
        });
        return vertical ? (
            <ScrollView
                role="tablist"
                accessibilityLabel={t("reactionsViewer.title")}
                className="w-44 flex-shrink-0 grow-0 bg-zam-backgroundTertiary border-e border-zam-divider"
                contentContainerClassName="gap-1 p-2"
            >
                {items}
            </ScrollView>
        ) : (
            <ScrollView
                horizontal
                role="tablist"
                accessibilityLabel={t("reactionsViewer.title")}
                className="grow-0 border-b border-zam-divider"
                contentContainerClassName="flex-row gap-1 px-2 pb-2"
            >
                {items}
            </ScrollView>
        );
    }

    function rows() {
        return reactors.map((r, i) => {
            const id = r.eventId;
            return (
                <View
                    key={r.userId}
                    role="listitem"
                    className={`flex-row items-center gap-3 px-2 py-1.5 ${
                        i === reactors.length - 1
                            ? ""
                            : "border-b border-zam-divider"
                    }`}
                >
                    <Avatar
                        src={r.avatarUrl}
                        name={r.name}
                        id={r.userId}
                        size={32}
                    />
                    <View className="min-w-0 flex-1">
                        <Text
                            numberOfLines={1}
                            className="text-sm leading-tight text-zam-textPrimary"
                        >
                            {r.name}
                        </Text>
                        <Text
                            numberOfLines={1}
                            className="text-xs leading-tight text-zam-textMuted"
                        >
                            {r.userId}
                        </Text>
                    </View>
                    <Text
                        numberOfLines={1}
                        className="text-xs text-zam-textMuted"
                    >
                        {r.pending
                            ? t("reactionsViewer.sending")
                            : r.ts
                              ? compactDateTime(r.ts)
                              : null}
                    </Text>
                    {r.userId === userId && id && !r.pending ? (
                        <Pressable
                            accessibilityRole="button"
                            disabled={removing.has(id)}
                            accessibilityLabel={t(
                                "reactionsViewer.removeYours",
                            )}
                            onPress={() => void remove(id)}
                            className={`flex-shrink-0 w-8 h-8 md:w-6 md:h-6 items-center justify-center rounded-md bg-zam-backgroundTertiary hover:bg-zam-danger ${
                                removing.has(id) ? "opacity-50" : ""
                            }`}
                        >
                            <X size={14} className="text-zam-textMuted" />
                        </Pressable>
                    ) : null}
                </View>
            );
        });
    }

    function list() {
        if (!selected) {
            return (
                <Text className="m-auto p-6 text-sm text-zam-textMuted text-center">
                    {t("reactionsViewer.empty")}
                </Text>
            );
        }
        const header = (
            <View className="items-center gap-1 px-4 pt-4 pb-2">
                <View className="h-16 items-center justify-center">
                    {keyView(selected.key, "hero")}
                </View>
                <Text className="text-sm font-medium text-zam-textPrimary text-center">
                    {labelFor(selected.key)}
                </Text>
                <Text className="text-xs text-zam-textMuted">
                    {t("reactionsViewer.count", { count: selected.count })}
                </Text>
            </View>
        );
        // Zami: in the sheet the reactors are a plain list, as in
        // ReactorPopover: the sheet scrolls its content itself (up to 70% of
        // the screen), and a scroll box inside it would scroll and drag the
        // sheet at once.
        if (sheet) {
            return (
                <>
                    {header}
                    <View role="list" className="px-2 pb-2">
                        {rows()}
                    </View>
                </>
            );
        }
        return (
            <>
                {header}
                <ScrollView
                    role="list"
                    className="flex-1 min-h-0"
                    contentContainerClassName="px-2 pb-2"
                >
                    {rows()}
                </ScrollView>
            </>
        );
    }

    return (
        <Portal>
            {sheet ? (
                <BottomSheet onClose={onClose}>
                    {/* Zami: upstream's `h-[min(60vh,28rem)]` box is the
                        sheet's own height (up to 70% of the screen); its
                        `sr-only` heading is the tab list's label. */}
                    <View className="flex-col">
                        {groups.length > 0 && tabs(false)}
                        {list()}
                    </View>
                </BottomSheet>
            ) : (
                // Zami: `h-[min(520px,85dvh)]` → `h-[520px] max-h-[85%]` (of
                // the layer): React Native has no `min()`.
                <ModalDialog
                    onClose={onClose}
                    label={t("reactionsViewer.title")}
                    layerClass="z-[90] flex items-center justify-center p-4"
                    panelClass="relative flex-row w-full max-w-2xl h-[520px] max-h-[85%] overflow-hidden rounded-xl border border-zam-divider bg-zam-backgroundSecondary shadow-2xl"
                >
                    {groups.length > 0 && tabs(true)}
                    <View className="relative flex-1 min-w-0 flex-col">
                        <Pressable
                            accessibilityRole="button"
                            onPress={onClose}
                            accessibilityLabel={t("common.close")}
                            className="absolute top-2 end-2 z-10 w-7 h-7 items-center justify-center rounded-md bg-zam-backgroundTertiary"
                        >
                            <X
                                size={14}
                                className="text-zam-textMuted hover:text-zam-textPrimary"
                            />
                        </Pressable>
                        {list()}
                    </View>
                </ModalDialog>
            )}
        </Portal>
    );
}
