import { Spin } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import type { MatrixEvent } from "matrix-js-sdk";
import {
    getRoom,
    getRoomDisplayName,
    getMemberName,
    getMemberAvatar,
    fetchServerNotifications,
    onTimelineEvent,
    type ServerNotification,
} from "$lib/matrix/client";
import {
    getAllNotifications,
    notificationsState,
    clearAllForRoom,
    type LoudNotification,
} from "$lib/stores/notifications.svelte";
import { navigateToRoom } from "$lib/stores/rooms.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import { compactDateTime } from "$lib/utils/timeFormat";

interface Props {
    onClose: () => void;
    onJumpTo: (roomId: string, eventId: string) => void;
}

interface DisplayItem {
    roomId: string;
    eventId: string;
    ts: number;
    sender: string;
    body: string;
    read: boolean;
}

function fromServer(n: ServerNotification): DisplayItem {
    const e = n.event as MatrixEvent;
    const content = e.getContent() as any;
    return {
        roomId: n.room_id,
        eventId: e.getId() ?? "",
        ts: n.ts,
        sender: e.getSender() ?? "",
        body: typeof content?.body === "string" ? content.body : "",
        read: n.read,
    };
}
function fromLocal(n: LoudNotification): DisplayItem {
    return { ...n, read: false };
}

export default function NotificationsPanel({ onClose, onJumpTo }: Props) {
    const isMobile = useRune(() => interfaceState.isMobile);

    const [serverSupport, setServerSupport] = useState<
        "unknown" | "yes" | "no" | "error"
    >("unknown");
    const [serverNotifications, setServerNotifications] = useState<
        ServerNotification[]
    >([]);
    const [loading, setLoading] = useState(true);
    // Zami: upstream's plain `let`s, which live as long as the component.
    const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const refreshInFlight = useRef(false);
    const refreshQueued = useRef(false);
    const refreshGeneration = useRef(0);

    async function refresh() {
        if (refreshInFlight.current) {
            refreshQueued.current = true;
            return;
        }
        refreshInFlight.current = true;
        const generation = ++refreshGeneration.current;
        setLoading(true);
        const res = await fetchServerNotifications(100);
        if (generation !== refreshGeneration.current) return;
        if (res.status === "unsupported") {
            setServerSupport("no");
        } else if (res.status === "error") {
            console.warn("[notifications] fetch failed", res.error);
            setServerSupport("error");
        } else {
            setServerSupport("yes");
            // Keep anything that actually notifies — both "loud" (has a sound
            // tweak) and "silent" (notify with no sound). Drop dont_notify rows.
            setServerNotifications(
                res.notifications.filter((n) =>
                    (n.actions ?? []).includes("notify"),
                ),
            );
        }
        setLoading(false);
        refreshInFlight.current = false;
        if (refreshQueued.current) {
            refreshQueued.current = false;
            scheduleRefresh();
        }
    }

    function scheduleRefresh() {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
            refreshTimer.current = null;
            void refresh();
        }, 250);
    }

    useEffect(() => {
        void refresh();
        const unsub = onTimelineEvent(scheduleRefresh);
        return () => {
            unsub();
            refreshGeneration.current++;
            if (refreshTimer.current) clearTimeout(refreshTimer.current);
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- `refresh` and `scheduleRefresh` touch only refs and state setters; upstream's effect reads no state.
    }, []);

    const tick = useRune(() => notificationsState.tick);
    const items = useMemo(() => {
        void tick;
        if (serverSupport === "yes") {
            return serverNotifications.map(fromServer);
        }
        return getAllNotifications().map(fromLocal);
    }, [tick, serverSupport, serverNotifications]);

    function jump(roomId: string, eventId: string) {
        navigateToRoom(roomId);
        onJumpTo(roomId, eventId);
        onClose();
    }

    function clearLocal() {
        for (const roomId of Object.keys(notificationsState.byRoom)) {
            clearAllForRoom(roomId);
        }
    }

    const showSpinner = loading && serverSupport === "unknown";

    return (
        <View
            className={`${
                isMobile ? "" : "w-80"
            } h-full flex flex-col bg-discord-backgroundSecondary border-l border-discord-divider`}
        >
            <View className="h-12 flex-row items-center gap-2 px-4 py-3 border-b border-discord-divider flex-shrink-0">
                <Text
                    accessibilityRole="header"
                    className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide flex-1"
                >
                    {t("common.notifications")}
                </Text>
                {(serverSupport === "no" || serverSupport === "error") &&
                items.length > 0 ? (
                    <Pressable accessibilityRole="button" onPress={clearLocal}>
                        <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                            {t("notificationsPanel.clearAll")}
                        </Text>
                    </Pressable>
                ) : null}
            </View>

            <FlatList
                className="flex-1"
                contentContainerClassName={
                    showSpinner || items.length === 0 ? undefined : "pb-2"
                }
                data={showSpinner ? [] : items}
                keyExtractor={(n) => n.eventId}
                ListHeaderComponent={
                    <>
                        {serverSupport === "error" ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => void refresh()}
                                className="w-full px-4 py-2 bg-discord-backgroundTertiary"
                            >
                                <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                    {t(
                                        "notificationsPanel.couldNotRefreshServerNotificationsTap",
                                    )}
                                </Text>
                            </Pressable>
                        ) : null}
                        {/* The rows' `p-2` box, above its first row. */}
                        {showSpinner || items.length === 0 ? null : (
                            <View className="h-2" />
                        )}
                    </>
                }
                // `space-y-1`
                ItemSeparatorComponent={RowGap}
                renderItem={({ item: n }) => {
                    const room = getRoom(n.roomId);
                    const roomName = room ? getRoomDisplayName(room) : n.roomId;
                    const avatarUrl = room
                        ? getMemberAvatar(room, n.sender)
                        : null;
                    const name = room
                        ? getMemberName(room, n.sender)
                        : n.sender;
                    const body = n.body || t("notificationsPanel.message");
                    return (
                        // Upstream prefixes the card's content with an
                        // sr-only "Jump to message:" rather than labelling the
                        // button, so a screen reader hears the purpose AND the
                        // sender, timestamp, room and body preview. Zami: a
                        // Pressable's label replaces its content's, so the
                        // label spells out the same prefix and content.
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={[
                                t("notificationsPanel.jumpToMessage"),
                                name,
                                compactDateTime(n.ts),
                                t("notificationsPanel.in", { roomName }),
                                body,
                            ].join(" ")}
                            onPress={() => jump(n.roomId, n.eventId)}
                            className={`mx-2 p-2 rounded-lg hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors border-s-2 ${
                                n.read
                                    ? "border-discord-warning/30 opacity-60"
                                    : "border-discord-warning/70"
                            }`}
                        >
                            <View className="flex-row items-center gap-2 mb-1">
                                <Avatar
                                    src={avatarUrl}
                                    name={name}
                                    id={n.sender}
                                    size={18}
                                />
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-xs font-semibold text-discord-textPrimary"
                                >
                                    {name}
                                </Text>
                                <Text className="text-xs text-discord-textMuted ms-auto flex-shrink-0">
                                    {compactDateTime(n.ts)}
                                </Text>
                            </View>
                            <Text
                                numberOfLines={1}
                                className="text-xs text-discord-textMuted mb-1"
                            >
                                {t("notificationsPanel.in", { roomName })}
                            </Text>
                            <Text
                                numberOfLines={3}
                                className="text-xs text-discord-textPrimary"
                            >
                                {body}
                            </Text>
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
                            {t("notificationsPanel.noNotifications")}
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
