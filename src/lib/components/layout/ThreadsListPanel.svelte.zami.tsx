import { Spin, SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useResolveClassNames } from "uniwind";
import { t } from "$lib/i18n";
import type { Room } from "matrix-js-sdk";
import {
    getRoomThreads,
    ensureThreadsLoaded,
    onThreadsUpdated,
    getMemberName,
    getMemberAvatar,
} from "$lib/matrix/client";
import {
    buildThreadListItems,
    filterThreadListItems,
    type ThreadListFilter,
} from "$lib/utils/threadList";
import { threadBadgeState } from "$lib/utils/threadUnread";
import { interfaceState } from "$lib/stores/interface.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import { pinnedDate } from "$lib/utils/timeFormat";
import { Circle } from "lucide-svelte";

interface Props {
    room: Room;
    onClose: () => void;
    onOpenThread: (rootId: string) => void;
}

export default function ThreadsListPanel({
    room,
    onClose,
    onOpenThread,
}: Props) {
    const isMobile = useRune(() => interfaceState.isMobile);
    // Zami: `fill="currentColor"` of the participated dot, whose parent is
    // `text-discord-accent`.
    const accent = useResolveClassNames("text-discord-accent").color as
        | string
        | undefined;

    const [threadsTick, setThreadsTick] = useState(0);
    const [loading, setLoading] = useState(true);
    const [retryTick, setRetryTick] = useState(0);
    const [filter, setFilter] = useState<ThreadListFilter>("all");

    // Load server-backed thread timeline sets (feature-detected) on room change.
    // On failure, surface a toast with a Retry (F6) rather than leaving the list
    // silently empty; the list still renders any sync-known threads.
    useEffect(() => {
        void retryTick;
        setLoading(true);
        ensureThreadsLoaded(room)
            .catch((err) => {
                console.error("Failed to load room threads:", err);
                showErrorToast(
                    t("threadsListPanel.couldnTLoadThreadsForThis"),
                    {
                        label: t("common.retry"),
                        run: () => setRetryTick((n) => n + 1),
                    },
                );
            })
            .finally(() => {
                setLoading(false);
                setThreadsTick((n) => n + 1);
            });
    }, [room, retryTick]);

    // Re-read the list on any thread lifecycle change in this room.
    useEffect(() => {
        const unsub = onThreadsUpdated(room, () =>
            setThreadsTick((n) => n + 1),
        );
        return unsub;
    }, [room]);

    const unreadTick = useRune(() => roomsState.unreadTick);
    const allItems = useMemo(() => {
        void threadsTick;
        void unreadTick;
        return buildThreadListItems(getRoomThreads(room));
    }, [threadsTick, unreadTick, room]);
    const items = filterThreadListItems(allItems, filter);
    const showSpinner = loading && allItems.length === 0;

    const filterOptions = [
        { value: "all", label: t("threadsListPanel.allThreads") },
        { value: "mine", label: t("threadsListPanel.myThreads") },
    ];

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
                    {t("threadsListPanel.threads")}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    onPress={onClose}
                    hitSlop={8}
                    className="transition-colors"
                    accessibilityLabel={t("threadsListPanel.closeThreadsPanel")}
                >
                    <SvgIcon
                        className="w-4 h-4 text-discord-textMuted"
                        d="M18.3 5.71 12 12.01l-6.3-6.3-1.42 1.42 6.3 6.3-6.3 6.3 1.42 1.42 6.3-6.3 6.3 6.3 1.42-1.42-6.3-6.3 6.3-6.3z"
                    />
                </Pressable>
            </View>

            <View
                className="flex-row gap-1 px-2 py-2 border-b border-discord-divider flex-shrink-0"
                role="group"
                accessibilityLabel={t("threadsListPanel.filterThreads")}
            >
                {filterOptions.map((opt) => (
                    <Pressable
                        key={opt.value}
                        accessibilityRole="togglebutton"
                        accessibilityState={{ checked: filter === opt.value }}
                        onPress={() => setFilter(opt.value as ThreadListFilter)}
                        className={`flex-1 px-2 py-1 rounded transition-colors ${
                            filter === opt.value
                                ? "bg-discord-messageHover"
                                : "hover:bg-discord-messageHover"
                        }`}
                    >
                        <Text
                            className={`text-xs font-medium text-center ${
                                filter === opt.value
                                    ? "text-discord-textPrimary"
                                    : "text-discord-textMuted"
                            }`}
                        >
                            {opt.label}
                        </Text>
                    </Pressable>
                ))}
            </View>

            <FlatList
                className="flex-1"
                contentContainerClassName={
                    showSpinner || items.length === 0 ? undefined : "p-2"
                }
                data={showSpinner ? [] : items}
                keyExtractor={(item) => item.rootId}
                // `space-y-1`
                ItemSeparatorComponent={RowGap}
                renderItem={({ item }) => {
                    const senderName = item.rootSenderId
                        ? getMemberName(room, item.rootSenderId)
                        : t("threadsListPanel.unknownSender");
                    const avatarUrl = item.rootSenderId
                        ? getMemberAvatar(room, item.rootSenderId)
                        : null;
                    const badge = threadBadgeState({
                        total: item.unreadTotal,
                        highlight: item.unreadHighlight,
                    });
                    return (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                                onOpenThread(item.rootId);
                                onClose();
                            }}
                            className="w-full p-2 rounded-lg hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                        >
                            <View className="flex-row items-center gap-2 mb-1">
                                <Avatar
                                    src={avatarUrl}
                                    name={senderName}
                                    id={item.rootSenderId ?? ""}
                                    size={18}
                                />
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-xs font-semibold text-discord-textPrimary"
                                >
                                    {senderName}
                                </Text>
                                {item.participated ? (
                                    <View
                                        accessible
                                        accessibilityRole="image"
                                        accessibilityLabel={t(
                                            "threadsListPanel.youParticipated",
                                        )}
                                        className="flex-shrink-0 flex-row items-center"
                                    >
                                        <Circle
                                            size={8}
                                            fill={accent}
                                            className="text-discord-accent"
                                        />
                                    </View>
                                ) : null}
                                {badge === "mention" ? (
                                    <View
                                        accessible
                                        accessibilityLabel={t(
                                            "threadsListPanel.unreadMentions",
                                        )}
                                        className="ms-auto flex-shrink-0 bg-discord-danger rounded-full px-1.5 min-w-[1.2rem]"
                                    >
                                        <Text className="text-white text-xs font-bold text-center">
                                            {item.unreadHighlight > 99
                                                ? "99+"
                                                : item.unreadHighlight}
                                        </Text>
                                    </View>
                                ) : badge === "unread" ? (
                                    <View
                                        accessibilityLabel={t(
                                            "threadsListPanel.unreadReplies",
                                        )}
                                        className="ms-auto flex-shrink-0 w-2 h-2 rounded-full bg-discord-accent"
                                    />
                                ) : null}
                                <Text
                                    className={`text-xs text-discord-textMuted ${
                                        badge === "none" ? "ms-auto" : "ms-2"
                                    } flex-shrink-0`}
                                >
                                    {pinnedDate(item.latestTs)}
                                </Text>
                            </View>
                            {item.name ? (
                                <Text
                                    numberOfLines={1}
                                    className="text-sm font-semibold text-discord-textPrimary"
                                >
                                    {item.name}
                                </Text>
                            ) : null}
                            <Text
                                numberOfLines={item.name ? 1 : 2}
                                className="text-xs text-discord-textMuted"
                            >
                                {item.rootPreview}
                            </Text>
                            <View className="flex-row items-center gap-1 mt-1">
                                <Text className="text-xs text-discord-accent">
                                    {t("common.replyCount", {
                                        count: item.replyCount,
                                    })}
                                </Text>
                                <Text className="text-xs text-discord-textMuted">
                                    ·
                                </Text>
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-xs text-discord-textMuted"
                                >
                                    {item.latestPreview}
                                </Text>
                            </View>
                        </Pressable>
                    );
                }}
                ListEmptyComponent={
                    showSpinner ? (
                        <View className="flex-row justify-center mt-8">
                            <Spin className="w-5 h-5 border-2 border-discord-accent border-t-transparent rounded-full" />
                        </View>
                    ) : (
                        <Text className="text-sm text-discord-textMuted text-center mt-8 px-4">
                            {filter === "mine" && allItems.length > 0
                                ? t(
                                      "threadsListPanel.noThreadsYouParticipatedIn",
                                  )
                                : t("threadsListPanel.noThreadsInThisRoomYet")}
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
