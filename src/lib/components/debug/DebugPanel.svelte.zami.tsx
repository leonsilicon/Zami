import { X, Check, Circle } from "lucide-svelte";
import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useDeepRune, useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as Clipboard from "expo-clipboard";
import type { Room, MatrixEvent } from "matrix-js-sdk";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "$lib/i18n";
import {
    EventType,
    getClient,
    getRawUrlPreview,
    getRoomUnreadInfo,
} from "$lib/matrix/client";
import { getMessages } from "$lib/stores/messages.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";

interface Props {
    room: Room;
}

// Zami: the scroll area's `font-mono text-xs`, which every Text here takes itself
// (React Native text inherits nothing from a View), with the panel's text color.
const MONO = "font-mono text-xs text-[#e0e0e0]";

export default function DebugPanel({ room }: Props) {
    const insets = useSafeAreaInsets();
    const debugOpen = useRune(() => interfaceState.debugOpen);

    const [refreshTick, setRefreshTick] = useState(0);

    function refresh() {
        setRefreshTick((tick) => tick + 1);
    }

    // Visibility is toggled by the toggleDebug keybind (Ctrl+Alt+Shift+D by
    // default; $lib/keybinds).
    useEffect(() => {
        if (debugOpen) setRefreshTick((tick) => tick + 1);
    }, [debugOpen]);

    // Zami: each `$derived.by` that reads `refreshTick` is a `useRune` with
    // refreshTick in its deps, so it recomputes on a refresh and on any rune it reads.
    const syncState = useRune(
        () => getClient()?.getSyncState() ?? "N/A",
        [refreshTick],
    );

    const allTimelineEvents = useRune(
        () => room.getLiveTimeline().getEvents(),
        [room, refreshTick],
    );

    const pendingEvents = useRune(() => {
        try {
            return room.getPendingEvents();
        } catch {
            return [];
        }
    }, [room, refreshTick]);

    // Zami: deep, as the template's {#each} also tracks the array's contents.
    const filteredMessages = useDeepRune(
        () => getMessages(room.roomId),
        [room, refreshTick],
    );

    function statusLabel(status: string | null | undefined): string {
        if (!status) return "confirmed";
        return String(status);
    }

    function eventSummary(e: MatrixEvent) {
        const type = e.getType();
        const sender = e.getSender() ?? "?";
        const id = e.getId() ?? "?";
        const ts = e.getTs();
        const isRedacted = e.isRedacted();
        const status = statusLabel((e as any).status);
        const content = e.getContent();
        const relType = content?.["m.relates_to"]?.rel_type ?? null;
        return { type, sender, id, ts, isRedacted, status, content, relType };
    }

    function formatTs(ts: number): string {
        if (!ts) return "-";
        return new Date(ts).toLocaleTimeString();
    }

    function msgPreview(content: Record<string, unknown>): string {
        const body = content?.body as string | undefined;
        if (!body) return JSON.stringify(content).slice(0, 80);
        return body.slice(0, 60) + (body.length > 60 ? "…" : "");
    }

    const NOTIFICATION_EVENT_TYPES = [
        "m.room.message",
        "m.room.encrypted",
        "m.sticker",
    ];

    const pushRulesDebug = useRune(() => {
        const mx = getClient();
        if (!mx) return null;
        const rules = mx
            .getAccountData(EventType.PushRules)
            ?.getContent<{ global: Record<string, any[]> }>();
        return rules?.global ?? null;
    }, [refreshTick]);

    const receiptsDebug = useRune(() => {
        const events = room.getLiveTimeline().getEvents();
        // Collect all events that have at least one receipt
        return events
            .map((e) => ({ event: e, receipts: room.getReceiptsForEvent(e) }))
            .filter(({ receipts }) => receipts.length > 0);
    }, [room, refreshTick]);

    const unreadDebug = useRune(() => {
        const mx = getClient();
        const userId = mx?.getUserId() ?? null;
        const unreadInfo = getRoomUnreadInfo(room);
        const readUpToId = userId ? room.getEventReadUpTo(userId) : null;
        const events = room.getLiveTimeline().getEvents();
        const lastEvent = events[events.length - 1];
        const readIdx = readUpToId
            ? events.findLastIndex((e) => e.getId() === readUpToId)
            : -2;
        const notifEventsAfterRead =
            readIdx >= 0
                ? events
                      .slice(readIdx + 1)
                      .filter(
                          (e) =>
                              NOTIFICATION_EVENT_TYPES.includes(e.getType()) &&
                              !e.isRedacted() &&
                              e.getRelation()?.rel_type !== "m.replace",
                      )
                : [];
        return {
            unreadInfo,
            readUpToId,
            readIdx,
            lastEvent,
            userId,
            totalEvents: events.length,
            notifEventsAfterRead,
        };
    }, [room, refreshTick]);

    const [previewUrl, setPreviewUrl] = useState("");
    const [previewResult, setPreviewResult] = useState<Record<
        string,
        unknown
    > | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    async function fetchPreview() {
        if (!previewUrl.trim()) return;
        setPreviewLoading(true);
        setPreviewResult(null);
        setPreviewResult(await getRawUrlPreview(previewUrl.trim()));
        setPreviewLoading(false);
    }

    const [copyDone, setCopyDone] = useState(false);
    function copyReport() {
        const lines: string[] = [];
        lines.push(`=== DEBUG REPORT ===`);
        lines.push(`Room: ${room.roomId}`);
        lines.push(`Sync state: ${syncState}`);
        lines.push(`\n--- TIMELINE (${allTimelineEvents.length} events) ---`);
        for (const e of allTimelineEvents) {
            const s = eventSummary(e);
            lines.push(
                `[${formatTs(s.ts)}] ${s.type} | ${s.sender} | status=${s.status} | redacted=${s.isRedacted} | relType=${s.relType ?? "-"} | id=${s.id}`,
            );
            lines.push(`  body: ${msgPreview(s.content)}`);
        }
        lines.push(`\n--- PENDING EVENTS (${pendingEvents.length}) ---`);
        for (const e of pendingEvents) {
            const s = eventSummary(e);
            lines.push(
                `[${formatTs(s.ts)}] ${s.type} | ${s.sender} | status=${s.status} | id=${s.id}`,
            );
            lines.push(`  body: ${msgPreview(s.content)}`);
        }
        lines.push(`\n--- STORE MESSAGES (${filteredMessages.length}) ---`);
        for (const e of filteredMessages) {
            const s = eventSummary(e);
            lines.push(
                `[${formatTs(s.ts)}] ${s.type} | ${s.sender} | status=${s.status} | id=${s.id}`,
            );
            lines.push(`  body: ${msgPreview(s.content)}`);
        }
        void Clipboard.setStringAsync(lines.join("\n"));
        setCopyDone(true);
        setTimeout(() => setCopyDone(false), 2000);
    }

    if (!debugOpen) return null;
    return (
        // Zami: `fixed inset-0` is the root's portal layer.
        <Portal>
            {/* Zami: pointer-events-none/-auto become `pointerEvents="box-none"`: in React
                Native "none" also takes touches from the children. */}
            <View
                pointerEvents="box-none"
                className="absolute inset-0 z-[9999] flex flex-row items-stretch"
            >
                {/* Click-away overlay */}
                <Pressable
                    accessibilityRole="none"
                    onPress={() => (interfaceState.debugOpen = false)}
                    className="absolute inset-0 bg-black/40"
                />

                {/* Panel. (Zami: 90% of the full-screen layer is upstream's 90vw; on a
                    phone the panel spans the safe area.) */}
                <View
                    style={{
                        paddingTop: insets.top,
                        paddingBottom: insets.bottom,
                    }}
                    className="relative ms-auto w-[600px] max-w-[90%] bg-[#1a1a2e] flex flex-col shadow-2xl overflow-hidden"
                >
                    {/* Header */}
                    <View className="flex flex-row items-center justify-between px-3 py-2 bg-[#0d0d1a] border-b border-[#333] flex-shrink-0">
                        <Text className="font-mono text-xs font-bold text-yellow-400">
                            {t("debugPanel.debugPanel")}
                        </Text>
                        <View className="flex flex-row items-center gap-2">
                            <Text className="font-mono text-xs text-gray-400">
                                {t("debugPanel.sync")}{" "}
                                <Text className="text-green-400">
                                    {syncState}
                                </Text>
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                onPress={refresh}
                                className="text-xs px-2 py-0.5 rounded bg-[#2a2a4a] hover:bg-[#3a3a5a] font-mono"
                            >
                                <Text className={MONO}>
                                    {t("debugPanel.refresh")}
                                </Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                onPress={copyReport}
                                className="text-xs px-2 py-0.5 rounded bg-[#2a4a2a] hover:bg-[#3a5a3a] font-mono"
                            >
                                <View className="flex-row items-center justify-center gap-1">
                                    {copyDone ? (
                                        <Check
                                            size={12}
                                            className="text-discord-textPrimary"
                                        />
                                    ) : null}
                                    <Text className={MONO}>
                                        {copyDone
                                            ? t("debugPanel.copied")
                                            : t("debugPanel.copy")}
                                    </Text>
                                </View>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() =>
                                    (interfaceState.debugOpen = false)
                                }
                                className="text-xs px-2 py-0.5 rounded bg-[#4a2a2a] hover:bg-[#5a3a3a] font-mono"
                            >
                                <X size={14} className={MONO} />
                            </Pressable>
                        </View>
                    </View>

                    {/* Zami: each section's sticky header is a direct child of the
                        ScrollView, followed by the section's body, so that
                        stickyHeaderIndices can pin it. */}
                    <KeyboardAwareScrollView
                        // flex-1 overflow-y-auto font-mono text-xs
                        style={{ flex: 1 }}
                        stickyHeaderIndices={[0, 2, 4, 6, 8, 10, 12]}
                        keyboardShouldPersistTaps="handled"
                        bottomOffset={8}
                    >
                        {/* Unread state */}
                        <View className="sticky top-0 px-3 py-1 bg-[#1a1a0d] border-b border-[#333]">
                            <Text className="font-mono text-xs text-yellow-300 font-bold">
                                {t("debugPanel.unreadState")}
                            </Text>
                        </View>
                        <View className="px-3 py-2 flex flex-col gap-1">
                            <Text className={MONO}>
                                <Text className="text-gray-500">
                                    {t("debugPanel.unread")}{" "}
                                </Text>
                                <Text
                                    className={
                                        unreadDebug.unreadInfo.unread
                                            ? "text-red-400"
                                            : "text-green-400"
                                    }
                                >
                                    {String(unreadDebug.unreadInfo.unread)}
                                </Text>{" "}
                                <Text className="text-gray-500 ms-3">
                                    {t("debugPanel.highlight")}{" "}
                                </Text>
                                <Text
                                    className={
                                        unreadDebug.unreadInfo.highlight
                                            ? "text-red-400"
                                            : "text-green-400"
                                    }
                                >
                                    {unreadDebug.unreadInfo.highlight}
                                </Text>
                            </Text>
                            <Text className={MONO}>
                                <Text className="text-gray-500">
                                    {t("debugPanel.userid")}{" "}
                                </Text>
                                <Text className="text-purple-300">
                                    {unreadDebug.userId ?? "none"}
                                </Text>
                            </Text>
                            <Text className={MONO}>
                                <Text className="text-gray-500">
                                    {t("debugPanel.readuptoid")}{" "}
                                </Text>
                                <Text className="text-blue-300 break-all">
                                    {unreadDebug.readUpToId ?? "none"}
                                </Text>
                            </Text>
                            <Text className={MONO}>
                                <Text className="text-gray-500">
                                    {t("debugPanel.readidxInTimeline")}{" "}
                                </Text>
                                <Text
                                    className={
                                        unreadDebug.readIdx === -1
                                            ? "text-red-400"
                                            : unreadDebug.readIdx >= 0
                                              ? "text-green-400"
                                              : ""
                                    }
                                >
                                    {unreadDebug.readIdx === -2
                                        ? t("debugPanel.noReceipt")
                                        : unreadDebug.readIdx === -1
                                          ? t("debugPanel.n1NotInWindow")
                                          : unreadDebug.readIdx}
                                </Text>{" "}
                                <Text className="text-gray-500">
                                    {t("debugPanel.events", {
                                        totalEvents: unreadDebug.totalEvents,
                                    })}
                                </Text>
                            </Text>
                            <Text className={MONO}>
                                <Text className="text-gray-500">
                                    {t("debugPanel.lastEventSender")}{" "}
                                </Text>
                                <Text className="text-purple-300">
                                    {unreadDebug.lastEvent?.getSender() ??
                                        "none"}
                                </Text>{" "}
                                <Text className="text-gray-500 ms-2">
                                    {t("debugPanel.me")}{" "}
                                </Text>
                                <Text className="text-purple-300">
                                    {unreadDebug.userId}
                                </Text>
                                <Text className="text-gray-500">)</Text>
                            </Text>
                            <Text className={MONO}>
                                <Text className="text-gray-500">
                                    {t(
                                        "debugPanel.notificationEventsAfterReadMarker",
                                    )}{" "}
                                </Text>
                                <Text
                                    className={
                                        unreadDebug.notifEventsAfterRead
                                            .length > 0
                                            ? "text-red-400"
                                            : "text-green-400"
                                    }
                                >
                                    {unreadDebug.notifEventsAfterRead.length}
                                </Text>
                            </Text>
                            {unreadDebug.notifEventsAfterRead.map((e, i) => (
                                <View key={e.getId() ?? i}>
                                    <Text className="font-mono ps-4 text-[11px] text-orange-300">
                                        {t("debugPanel.from", {
                                            formatTs: formatTs(e.getTs()),
                                            getType: e.getType(),
                                            value: e.getSender()?.split(":")[0],
                                            msgPreview: msgPreview(
                                                e.getContent(),
                                            ),
                                        })}
                                    </Text>
                                    <Text className="font-mono ps-4 text-[10px] text-gray-600 break-all">
                                        {e.getId()}
                                    </Text>
                                </View>
                            ))}
                        </View>

                        {/* Push rules */}
                        <View className="sticky top-0 px-3 py-1 bg-[#0d1a0d] border-b border-[#333]">
                            <Text className="font-mono text-xs text-green-300 font-bold">
                                {t("debugPanel.pushRules")}
                            </Text>
                        </View>
                        <View>
                            {pushRulesDebug ? (
                                Object.entries(pushRulesDebug).map(
                                    ([kind, rules]) =>
                                        rules.length > 0 ? (
                                            <View key={kind}>
                                                <Text className="font-mono px-3 pt-2 pb-1 text-[11px] text-gray-500 uppercase tracking-wide">
                                                    {kind}
                                                </Text>
                                                {rules.map((rule, i) => (
                                                    <View
                                                        key={rule.rule_id ?? i}
                                                        className="px-3 py-1 border-b border-[#1a1a1a]"
                                                    >
                                                        <View className="flex flex-row items-center gap-2 flex-wrap">
                                                            <Circle
                                                                size={10}
                                                                fill={
                                                                    rule.enabled
                                                                        ? "currentColor"
                                                                        : "none"
                                                                }
                                                                className={
                                                                    rule.enabled
                                                                        ? "text-green-400"
                                                                        : "text-red-400"
                                                                }
                                                            />
                                                            <Text className="font-mono text-[11px] text-yellow-200 font-medium">
                                                                {rule.rule_id}
                                                            </Text>
                                                            {rule.default ? (
                                                                <Text className="font-mono text-[11px] text-gray-600">
                                                                    {t(
                                                                        "debugPanel.default",
                                                                    )}
                                                                </Text>
                                                            ) : null}
                                                        </View>
                                                        <Text className="font-mono text-[11px] ps-4 text-gray-400">
                                                            {t(
                                                                "debugPanel.actions",
                                                                {
                                                                    stringify:
                                                                        JSON.stringify(
                                                                            rule.actions,
                                                                        ),
                                                                },
                                                            )}
                                                        </Text>
                                                        {rule.conditions ? (
                                                            <Text className="font-mono text-[11px] ps-4 text-gray-600">
                                                                {t(
                                                                    "debugPanel.conditions",
                                                                    {
                                                                        stringify:
                                                                            JSON.stringify(
                                                                                rule.conditions,
                                                                            ),
                                                                    },
                                                                )}
                                                            </Text>
                                                        ) : null}
                                                    </View>
                                                ))}
                                            </View>
                                        ) : null,
                                )
                            ) : (
                                <Text className="font-mono text-xs px-3 py-2 text-gray-600 italic">
                                    {t("debugPanel.noPushRulesFound")}
                                </Text>
                            )}
                        </View>

                        {/* Read receipts */}
                        <View className="sticky top-0 px-3 py-1 bg-[#0d1a1a] border-b border-[#333]">
                            <Text className="font-mono text-xs text-cyan-300 font-bold">
                                {t(
                                    "debugPanel.readReceiptsEventsWithReceipts",
                                    {
                                        length: receiptsDebug.length,
                                    },
                                )}
                            </Text>
                        </View>
                        <View>
                            {receiptsDebug.map(({ event, receipts }, i) => (
                                <View
                                    key={event.getId() ?? i}
                                    className="px-3 py-1 border-b border-[#1a1a1a]"
                                >
                                    <Text
                                        numberOfLines={1}
                                        className="font-mono text-gray-400 text-[11px] truncate"
                                    >
                                        <Text className="text-yellow-300">
                                            {formatTs(event.getTs())}
                                        </Text>{" "}
                                        <Text className="text-blue-300 ms-2">
                                            {event.getType()}
                                        </Text>{" "}
                                        <Text className="text-gray-600 ms-2 break-all">
                                            {event.getId()}
                                        </Text>
                                    </Text>
                                    {receipts.map((r) => (
                                        <View
                                            key={`${r.userId}|${r.type}`}
                                            className="ps-4 flex flex-row gap-2"
                                        >
                                            <Text className="font-mono text-[11px] text-purple-300">
                                                {r.userId}
                                            </Text>
                                            <Text className="font-mono text-[11px] text-gray-500">
                                                {r.type}
                                            </Text>
                                            {r.data?.ts ? (
                                                <Text className="font-mono text-[11px] text-gray-600">
                                                    {formatTs(r.data.ts)}
                                                </Text>
                                            ) : null}
                                        </View>
                                    ))}
                                </View>
                            ))}
                            {receiptsDebug.length === 0 ? (
                                <Text className="font-mono text-xs px-3 py-2 text-gray-600 italic">
                                    {t("debugPanel.noReceipts")}
                                </Text>
                            ) : null}
                        </View>

                        {/* URL Preview Inspector */}
                        <View className="sticky top-0 px-3 py-1 bg-[#1a0d1a] border-b border-[#333]">
                            <Text className="font-mono text-xs text-pink-400 font-bold">
                                {t("debugPanel.urlPreviewInspector")}
                            </Text>
                        </View>
                        <View>
                            <View className="px-3 py-2 flex flex-row gap-2">
                                <TextInput
                                    value={previewUrl}
                                    onChangeText={setPreviewUrl}
                                    onSubmitEditing={() => void fetchPreview()}
                                    placeholder={t("debugPanel.https")}
                                    placeholderTextColor="#6b7280"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType="url"
                                    returnKeyType="go"
                                    className="font-mono flex-1 bg-[#0d0d1a] border border-[#333] rounded px-2 py-1 text-[#e0e0e0] outline-none focus:border-pink-400 text-xs"
                                />
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        disabled: previewLoading,
                                    }}
                                    onPress={() => void fetchPreview()}
                                    disabled={previewLoading}
                                    className={`px-2 py-1 rounded bg-[#2a1a2a] hover:bg-[#3a2a3a] disabled:opacity-50 text-xs ${
                                        previewLoading ? "opacity-50" : ""
                                    }`}
                                >
                                    <Text className={MONO}>
                                        {previewLoading ? "…" : "fetch"}
                                    </Text>
                                </Pressable>
                            </View>
                            {previewResult !== null ? (
                                <Text
                                    selectable
                                    className="font-mono px-3 pb-3 text-[11px] text-green-300 whitespace-pre-wrap break-all"
                                >
                                    {JSON.stringify(previewResult, null, 2)}
                                </Text>
                            ) : null}
                        </View>

                        {/* Store messages */}
                        <View className="sticky top-0 px-3 py-1 bg-[#0d1a0d] border-b border-[#333]">
                            <Text className="font-mono text-xs text-green-400 font-bold">
                                {t("debugPanel.storeMessagesWhatTheUiRenders", {
                                    length: filteredMessages.length,
                                })}
                            </Text>
                        </View>
                        <View>
                            {filteredMessages.map((e, i) => {
                                const s = eventSummary(e);
                                return (
                                    <View
                                        key={`${s.id}|${i}`}
                                        className="px-3 py-1 border-b border-[#222] hover:bg-[#1f1f3a]"
                                    >
                                        <View className="flex flex-row gap-2 items-baseline">
                                            <Text className="font-mono text-xs text-gray-500">
                                                {i}
                                            </Text>
                                            <Text className="font-mono text-xs text-yellow-300">
                                                {formatTs(s.ts)}
                                            </Text>
                                            <Text className="font-mono text-xs text-blue-300">
                                                {s.type}
                                            </Text>
                                            <Text className="font-mono text-xs text-purple-300">
                                                {s.sender.split(":")[0]}
                                            </Text>
                                            <Text
                                                className={`font-mono text-[#e0e0e0] px-1 rounded text-[10px] ${
                                                    s.status === "confirmed"
                                                        ? "bg-green-900"
                                                        : "bg-yellow-900"
                                                }`}
                                            >
                                                {s.status}
                                            </Text>
                                            {s.isRedacted ? (
                                                <Text className="font-mono text-xs text-red-400">
                                                    {t("debugPanel.redacted")}
                                                </Text>
                                            ) : null}
                                            {s.relType ? (
                                                <Text className="font-mono text-xs text-orange-400">
                                                    {t("debugPanel.rel", {
                                                        relType: s.relType,
                                                    })}
                                                </Text>
                                            ) : null}
                                        </View>
                                        <Text
                                            numberOfLines={1}
                                            className="font-mono text-xs text-gray-400 ps-4 truncate"
                                        >
                                            {msgPreview(s.content)}
                                        </Text>
                                        <Text
                                            numberOfLines={1}
                                            className="font-mono text-gray-600 ps-4 text-[10px] truncate"
                                        >
                                            {s.id}
                                        </Text>
                                    </View>
                                );
                            })}
                            {filteredMessages.length === 0 ? (
                                <Text className="font-mono text-xs px-3 py-2 text-gray-600 italic">
                                    {t("debugPanel.empty")}
                                </Text>
                            ) : null}
                        </View>

                        {/* Pending events */}
                        <View className="sticky top-0 px-3 py-1 bg-[#1a0d0d] border-b border-[#333]">
                            <Text className="font-mono text-xs text-red-400 font-bold">
                                {t("debugPanel.pendingEvents", {
                                    length: pendingEvents.length,
                                })}
                            </Text>
                        </View>
                        <View>
                            {pendingEvents.map((e, i) => {
                                const s = eventSummary(e);
                                return (
                                    <View
                                        key={`${s.id}|${i}`}
                                        className="px-3 py-1 border-b border-[#222] hover:bg-[#1f1f3a]"
                                    >
                                        <View className="flex flex-row gap-2 items-baseline flex-wrap">
                                            <Text className="font-mono text-xs text-gray-500">
                                                {i}
                                            </Text>
                                            <Text className="font-mono text-xs text-yellow-300">
                                                {formatTs(s.ts)}
                                            </Text>
                                            <Text className="font-mono text-xs text-blue-300">
                                                {s.type}
                                            </Text>
                                            <Text className="font-mono text-xs text-purple-300">
                                                {s.sender.split(":")[0]}
                                            </Text>
                                            <Text className="font-mono text-[#e0e0e0] px-1 rounded text-[10px] bg-yellow-900">
                                                {s.status}
                                            </Text>
                                            {s.relType ? (
                                                <Text className="font-mono text-xs text-orange-400">
                                                    {t("debugPanel.rel", {
                                                        relType: s.relType,
                                                    })}
                                                </Text>
                                            ) : null}
                                        </View>
                                        <Text
                                            numberOfLines={1}
                                            className="font-mono text-xs text-gray-400 ps-4 truncate"
                                        >
                                            {msgPreview(s.content)}
                                        </Text>
                                        <Text
                                            numberOfLines={1}
                                            className="font-mono text-gray-600 ps-4 text-[10px] truncate"
                                        >
                                            {s.id}
                                        </Text>
                                    </View>
                                );
                            })}
                            {pendingEvents.length === 0 ? (
                                <Text className="font-mono text-xs px-3 py-2 text-gray-600 italic">
                                    {t("debugPanel.empty")}
                                </Text>
                            ) : null}
                        </View>

                        {/* Full raw timeline */}
                        <View className="sticky top-0 px-3 py-1 bg-[#0d0d1a] border-b border-[#333]">
                            <Text className="font-mono text-xs text-blue-400 font-bold">
                                {t("debugPanel.rawTimelineEvents", {
                                    length: allTimelineEvents.length,
                                })}
                            </Text>
                        </View>
                        <View>
                            {allTimelineEvents.map((e, i) => {
                                const s = eventSummary(e);
                                return (
                                    <View
                                        key={`${s.id}|${i}`}
                                        className="px-3 py-1 border-b border-[#1a1a1a] hover:bg-[#1f1f3a]"
                                    >
                                        <View className="flex flex-row gap-2 items-baseline flex-wrap">
                                            <Text className="font-mono text-xs text-gray-500">
                                                {i}
                                            </Text>
                                            <Text className="font-mono text-xs text-yellow-300">
                                                {formatTs(s.ts)}
                                            </Text>
                                            <Text
                                                className={`font-mono text-xs ${
                                                    s.type === "m.room.message"
                                                        ? "text-blue-300"
                                                        : "text-gray-500"
                                                }`}
                                            >
                                                {s.type}
                                            </Text>
                                            <Text className="font-mono text-xs text-purple-300">
                                                {s.sender.split(":")[0]}
                                            </Text>
                                            {s.status !== "confirmed" ? (
                                                <Text className="font-mono text-[#e0e0e0] px-1 rounded text-[10px] bg-yellow-900">
                                                    {s.status}
                                                </Text>
                                            ) : null}
                                            {s.isRedacted ? (
                                                <Text className="font-mono text-xs text-red-400">
                                                    {t("debugPanel.redacted")}
                                                </Text>
                                            ) : null}
                                            {s.relType ? (
                                                <Text className="font-mono text-xs text-orange-400">
                                                    {t("debugPanel.rel", {
                                                        relType: s.relType,
                                                    })}
                                                </Text>
                                            ) : null}
                                        </View>
                                        {s.type === "m.room.message" ||
                                        s.type === "m.sticker" ? (
                                            <Text
                                                numberOfLines={1}
                                                className="font-mono text-xs text-gray-400 ps-4 truncate"
                                            >
                                                {msgPreview(s.content)}
                                            </Text>
                                        ) : null}
                                        <Text
                                            numberOfLines={1}
                                            className="font-mono text-gray-600 ps-4 text-[10px] truncate"
                                        >
                                            {s.id}
                                        </Text>
                                    </View>
                                );
                            })}
                        </View>
                    </KeyboardAwareScrollView>
                </View>
            </View>
        </Portal>
    );
}
