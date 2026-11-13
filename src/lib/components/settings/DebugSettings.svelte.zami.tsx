import { Range } from "@-/com.leonsilicon.zami.rn";
import {
    formatSessionStalls,
    formatStartup,
    previousStartup,
    subscribeStartup,
    thisStartup,
} from "@-/com.leonsilicon.zami.startup";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { t } from "$lib/i18n";
import ExtendedProfileDebug from "$lib/components/settings/ExtendedProfileDebug.svelte";
import GpuDebug from "$lib/components/settings/GpuDebug.svelte";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import { auth } from "$lib/stores/auth.svelte";
import {
    isSlidingSyncEnabled,
    setSlidingSyncEnabled,
} from "$lib/matrix/slidingSyncPref";
import {
    getClient,
    getPushRuleSummary,
    isAccountNotificationsDisabled,
    getSlidingSyncProgress,
    getSlidingSyncFallbackReason,
} from "$lib/matrix/client";
import {
    checkGatewayHealth,
    fetchRegisteredPushers,
    PUSH_APP_ID,
    PUSH_GATEWAY_NOTIFY_URL,
    pushDebug,
    type GatewayHealth,
    type RegisteredPusher,
} from "$lib/push";
import { readNativeSession, type NativeSessionState } from "$lib/nativeSession";
import {
    readWebPushState,
    WEBPUSH_APP_ID,
    type WebPushDebug,
} from "$lib/webPush";
import {
    setDfAttenuationDb,
    setIgnoreCodecSupport,
    setH264ProfileFix,
    setMicPauseGate,
    setSoundIntervalMs,
    setShowAllEvents,
    setOrderHints,
    setStickyCallMembership,
    setUpdateNagDisabled,
    settingsState,
} from "$lib/stores/settings.svelte";
import {
    refreshDecodeSupport,
    setVoiceCaptureConstraints,
} from "$lib/matrix/livekitCall";
import {
    DEFAULT_ATTENUATION_DB,
    MAX_ATTENUATION_DB,
    MIN_ATTENUATION_DB,
} from "$lib/utils/micProcessing";
import { getSyncLog } from "$lib/matrix/syncLog";
import { buildLogExport, saveLogExport } from "$lib/logExport";
import {
    canToggleWebViewDebugging,
    getWebViewDebugging,
    setWebViewDebugging,
} from "$lib/debugTools";
import {
    getIndexSyncStatus,
    requestIndexSyncNow,
} from "$lib/matrix/eventIndexSync";
import { showToast } from "$lib/stores/toasts.svelte";

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. Text that a section's container colors on the web
// (it inherits) gets the color on each `Text`.
export default function DebugSettings() {
    const [loading, setLoading] = useState(false);
    const [pushers, setPushers] = useState<RegisteredPusher[] | null>(null);
    const [pushersError, setPushersError] = useState("");
    const [gateway, setGateway] = useState<GatewayHealth | null>(null);
    const [nativeSession, setNativeSession] =
        useState<NativeSessionState | null>(null);
    const [webPush, setWebPush] = useState<WebPushDebug | null>(null);
    const [rules, setRules] = useState(() => getPushRuleSummary());
    const accountNotificationsOff = useRune(() =>
        isAccountNotificationsDisabled(),
    );

    const userId = useRune(() => auth.userId);
    const showAllEvents = useRune(() => settingsState.showAllEvents);
    const orderHints = useRune(() => settingsState.orderHints);
    const stickyCallMembership = useRune(
        () => settingsState.stickyCallMembership,
    );
    const ignoreCodecSupport = useRune(() => settingsState.ignoreCodecSupport);
    const h264ProfileFix = useRune(() => settingsState.h264ProfileFix);
    const micPauseGate = useRune(() => settingsState.micPauseGate);
    const dfAttenuationDb = useRune(() => settingsState.dfAttenuationDb);
    const soundIntervalMs = useRune(() => settingsState.soundIntervalMs);
    const updateNagDisabled = useRune(() => settingsState.updateNagDisabled);

    // Snapshot when the panel opens; Refresh re-reads it.
    const [syncLog, setSyncLog] = useState(() => getSyncLog());
    const [syncLogCopied, setSyncLogCopied] = useState(false);
    async function copySyncLog() {
        const log = getSyncLog();
        setSyncLog(log);
        const text = [
            `state: ${auth.syncState}`,
            `copied: ${new Date().toISOString()}`,
            ...log,
        ].join("\n");
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(text);
            setSyncLogCopied(true);
            setTimeout(() => setSyncLogCopied(false), 2000);
        } catch {
            /* clipboard denied: the log is still on screen to select */
        }
    }

    // Client logs: everything logCapture.ts kept since launch, redacted.
    const [logsBusy, setLogsBusy] = useState(false);
    const [logsCopied, setLogsCopied] = useState(false);
    async function copyLogs() {
        setLogsBusy(true);
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(await buildLogExport());
            setLogsCopied(true);
            setTimeout(() => setLogsCopied(false), 2000);
        } catch (e) {
            console.warn("[debug] copying client logs failed", e);
            showToast(t("debugSettings.clientLogsCopyFailed"), {
                tone: "danger",
            });
        } finally {
            setLogsBusy(false);
        }
    }
    async function saveLogs() {
        setLogsBusy(true);
        try {
            await saveLogExport();
        } catch (e) {
            console.warn("[debug] saving client logs failed", e);
            showToast(t("debugSettings.clientLogsSaveFailed"), {
                tone: "danger",
            });
        } finally {
            setLogsBusy(false);
        }
    }

    // Search index sync with our other sessions: polled while the panel is open.
    const [indexSync, setIndexSync] = useState(() => getIndexSyncStatus());
    useEffect(() => {
        const timer = setInterval(
            () => setIndexSync(getIndexSyncStatus()),
            1_000,
        );
        return () => clearInterval(timer);
    }, []);
    const ago = (at: number | null) => {
        if (!at) return t("debugSettings.indexSyncNever");
        const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
        return sec < 90 ? `${sec}s` : `${Math.round(sec / 60)}m`;
    };
    const indexSyncRows = [
        [
            t("debugSettings.indexSyncSessions"),
            `${indexSync.eligibleSessions} / ${indexSync.verifiedSessions} / ${indexSync.otherSessions}`,
        ],
        [
            t("debugSettings.indexSyncAsked"),
            `${indexSync.asks} (${ago(indexSync.lastAskAt)})`,
        ],
        [
            t("debugSettings.indexSyncRoomsMissing"),
            String(indexSync.roomsMissing),
        ],
        [
            t("debugSettings.indexSyncRequestsReceived"),
            String(indexSync.requestsReceived),
        ],
        [
            t("debugSettings.indexSyncChunks"),
            `${indexSync.chunksSent} / ${indexSync.chunksReceived}`,
        ],
        [
            t("debugSettings.indexSyncMerged"),
            `${indexSync.entriesMerged} (${ago(indexSync.lastMergeAt)})`,
        ],
    ] as [string, string][];

    const webViewDebugAvailable = canToggleWebViewDebugging();
    const [webViewDebug, setWebViewDebug] = useState(false);
    useEffect(() => {
        if (webViewDebugAvailable) {
            getWebViewDebugging().then(
                (on) => setWebViewDebug(on),
                () => {},
            );
        }
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, as upstream's script body.
    }, []);
    async function toggleWebViewDebug(on: boolean) {
        setWebViewDebug(on);
        try {
            setWebViewDebug(await setWebViewDebugging(on));
        } catch (e) {
            console.warn("[debug] toggling WebView debugging failed", e);
            setWebViewDebug(!on);
        }
    }

    // Rebuild the live mic chain with the new tuning (no-op outside a call).
    function applyMicTuning() {
        void setVoiceCaptureConstraints({
            noiseSuppressionMode: settingsState.noiseSuppressionMode,
            echoCancellation: settingsState.echoCancellation,
            micGainMode: settingsState.micGainMode,
        });
    }

    // Flipping the mode needs a fresh client: sliding sync and /sync feed the
    // store differently (each has its own cache), so apply it with a reload.
    // Zami: `location.reload()` reloads the JS bundle (see the sveltekit
    // package's location stand-in).
    function toggleSlidingSync(enabled: boolean) {
        if (!auth.userId) return;
        setSlidingSyncEnabled(auth.userId, enabled);
        window.location.reload();
    }

    const syncRows = useRune(() => {
        const client = getClient();
        const progress = getSlidingSyncProgress();
        const sliding = auth.userId ? isSlidingSyncEnabled(auth.userId) : false;
        return [
            [
                t("debugSettings.syncMode"),
                sliding
                    ? t("debugSettings.slidingSyncMsc4186")
                    : t("debugSettings.classicSyncV2"),
            ],
            [t("debugSettings.syncState"), auth.syncState],
            ...(getSlidingSyncFallbackReason()
                ? ([
                      [
                          t("debugSettings.fallback"),
                          getSlidingSyncFallbackReason()!,
                      ],
                  ] as [string, string][])
                : []),
            [
                t("debugSettings.slidingSyncEndpoint"),
                sliding ? auth.homeserverUrl : "(n/a)",
            ],
            [
                t("debugSettings.joinedRoomsLoaded"),
                String(client?.getRooms().length ?? 0),
            ],
            [
                t("debugSettings.roomListWindow"),
                progress
                    ? t("debugSettings.of", {
                          requested: progress.requested,
                          total: progress.total,
                      })
                    : "(n/a)",
            ],
        ] as [string, string][];
    });

    // `pushDebug` is a plain object (not `$state`), so the rows are read as
    // the panel renders.
    const rows = [
        [
            t("debugSettings.platform"),
            pushDebug.native
                ? t("debugSettings.nativeCapacitor")
                : "Web/Desktop",
        ],
        [
            t("debugSettings.pushEnabledInBuild"),
            pushDebug.pushEnabled
                ? t("debugSettings.yes")
                : t("debugSettings.no"),
        ],
        [t("debugSettings.gatewayUrl"), PUSH_GATEWAY_NOTIFY_URL],
        [t("debugSettings.appId2"), PUSH_APP_ID],
        [t("debugSettings.notificationPermission"), pushDebug.permission],
        [
            t("debugSettings.fcmToken"),
            pushDebug.fcmToken
                ? `${pushDebug.fcmToken.slice(0, 12)}…${pushDebug.fcmToken.slice(-6)}`
                : "(none)",
        ],
        [t("debugSettings.pushProvider"), pushDebug.provider ?? "(none)"],
        ...(pushDebug.provider === "unifiedpush"
            ? ([
                  [
                      t("debugSettings.unifiedPushDistributor"),
                      pushDebug.upDistributor ?? "(none)",
                  ],
                  [
                      t("debugSettings.unifiedPushEndpoint"),
                      pushDebug.upEndpoint
                          ? `${pushDebug.upEndpoint.slice(0, 24)}…${pushDebug.upEndpoint.slice(-6)}`
                          : "(none)",
                  ],
                  [
                      t("debugSettings.unifiedPushGateway"),
                      pushDebug.upGateway ?? "(none)",
                  ],
              ] as [string, string][])
            : []),
        [
            t("debugSettings.pusherRegisteredThisSession"),
            pushDebug.pusherRegistered
                ? t("debugSettings.yes")
                : t("debugSettings.no"),
        ],
    ] as [string, string][];

    const matchingPusher =
        pushers?.find(
            (pusher) =>
                pusher.app_id === PUSH_APP_ID &&
                (pusher.url === PUSH_GATEWAY_NOTIFY_URL ||
                    (!!pushDebug.upGateway &&
                        pusher.url === pushDebug.upGateway)),
        ) ?? null;

    async function diagnose() {
        setLoading(true);
        setPushers(null);
        setPushersError("");
        setGateway(null);
        setNativeSession(null);
        setWebPush(null);
        setRules(getPushRuleSummary());
        const client = getClient();
        await Promise.allSettled([
            readWebPushState().then(
                (result) => setWebPush(result),
                (error) =>
                    setWebPush({
                        supported: true,
                        configured: true,
                        permission: "default",
                        subscribed: false,
                        endpoint: null,
                        error: error?.message ?? String(error),
                    }),
            ),
            readNativeSession().then(
                (result) => setNativeSession(result),
                (error) =>
                    setNativeSession({
                        native: true,
                        homeserverUrl: null,
                        userId: null,
                        deviceId: null,
                        hasToken: false,
                        hideNotificationBody: false,
                        error: error?.message ?? String(error),
                    }),
            ),
            checkGatewayHealth().then(
                (result) => setGateway(result),
                (error) =>
                    setGateway({
                        reachable: false,
                        status: null,
                        detail: error?.message ?? String(error),
                    }),
            ),
            (client
                ? fetchRegisteredPushers(client)
                : Promise.resolve([] as RegisteredPusher[])
            ).then(
                (result) => setPushers(result),
                (error) =>
                    setPushersError(
                        error?.message ??
                            t(
                                "debugSettings.failedToFetchPushersFromHomeserver",
                            ),
                    ),
            ),
        ]);
        setLoading(false);
    }

    return (
        <View className="gap-6">
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                    {t("debugSettings.clientLogs")}
                </Text>
                <View className="flex-row flex-wrap items-center gap-3 py-2 border-b border-discord-divider">
                    <Text className="flex-1 min-w-48 text-xs text-discord-textMuted">
                        {t("debugSettings.clientLogsHint")}
                    </Text>
                    <View className="flex-row gap-2">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: logsBusy }}
                            onPress={() => void copyLogs()}
                            disabled={logsBusy}
                            className={`px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover ${
                                logsBusy ? "opacity-50" : ""
                            }`}
                        >
                            <Text className="text-xs font-semibold text-discord-textPrimary">
                                {logsCopied
                                    ? t("debugSettings.copied")
                                    : t("debugSettings.copyLogs")}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: logsBusy }}
                            onPress={() => void saveLogs()}
                            disabled={logsBusy}
                            className={`px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover ${
                                logsBusy ? "opacity-50" : ""
                            }`}
                        >
                            <Text className="text-xs font-semibold text-discord-textPrimary">
                                {t("debugSettings.saveLogs")}
                            </Text>
                        </Pressable>
                    </View>
                </View>
                {webViewDebugAvailable ? (
                    <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                        <View className="flex-1 min-w-0">
                            <Text className="text-sm text-discord-textPrimary">
                                {t("debugSettings.webViewDebugging")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t("debugSettings.webViewDebuggingHint")}
                            </Text>
                        </View>
                        <ToggleSwitch
                            checked={webViewDebug}
                            onChange={(on) => void toggleWebViewDebug(on)}
                            label={t("debugSettings.webViewDebugging")}
                        />
                    </View>
                ) : null}
            </View>

            {/* Zami: the launch timeline (@-/com.leonsilicon.zami.startup), for a
                slow "Restoring session". A diagnostic, so not translated. */}
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                    Startup
                </Text>
                {(
                    [
                        ["This launch", thisStartup()],
                        ["Previous launch", previousStartup()],
                    ] as const
                ).map(([label, record]) =>
                    record ? (
                        <View
                            key={label}
                            className="py-2 border-b border-discord-divider"
                        >
                            <Text className="text-sm text-discord-textPrimary mb-1">
                                {label}
                            </Text>
                            {formatStartup(record, {
                                sessionStalls: false,
                            }).map((line, i) => (
                                <Text
                                    key={i}
                                    className="text-discord-textMuted font-mono text-xs"
                                >
                                    {line}
                                </Text>
                            ))}
                        </View>
                    ) : null,
                )}
            </View>

            {/* Zami: the longest JS stalls after each launch, with where the app was. */}
            <SessionStalls />

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                    {t("debugSettings.developer")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("debugSettings.showAllEvents")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "debugSettings.displayEveryMatrixTimelineEventIn",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={showAllEvents}
                        onChange={setShowAllEvents}
                        label={t("debugSettings.showAllEvents")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("debugSettings.orderHints")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("debugSettings.orderHintsHint")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={orderHints}
                        onChange={setOrderHints}
                        label={t("debugSettings.orderHints")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("debugSettings.stickyCallMembership")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("debugSettings.stickyCallMembershipHint")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={stickyCallMembership}
                        onChange={setStickyCallMembership}
                        label={t("debugSettings.stickyCallMembership")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("debugSettings.ignoreCodecSupport")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("debugSettings.ignoreCodecSupportHint")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={ignoreCodecSupport}
                        onChange={(v) => {
                            setIgnoreCodecSupport(v);
                            refreshDecodeSupport();
                        }}
                        label={t("debugSettings.ignoreCodecSupport")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("debugSettings.h264ProfileFix")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("debugSettings.h264ProfileFixHint")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={h264ProfileFix}
                        onChange={(v) => {
                            setH264ProfileFix(v);
                            void window.desktop?.gpu?.setH264ProfileFix(v);
                        }}
                        label={t("debugSettings.h264ProfileFix")}
                    />
                </View>
            </View>

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                    {t("debugSettings.voiceProcessing")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("debugSettings.pauseGate")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("debugSettings.pauseGateHint")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={micPauseGate}
                        onChange={(v) => {
                            setMicPauseGate(v);
                            applyMicTuning();
                        }}
                        label={t("debugSettings.pauseGate")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text
                            nativeID="df-attenuation"
                            className="text-sm text-discord-textPrimary"
                        >
                            {t("debugSettings.noiseAttenuationLimit", {
                                value: dfAttenuationDb,
                            })}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("debugSettings.noiseAttenuationLimitHint", {
                                value: DEFAULT_ATTENUATION_DB,
                            })}
                        </Text>
                    </View>
                    <Range
                        min={MIN_ATTENUATION_DB}
                        max={MAX_ATTENUATION_DB}
                        step={1}
                        className="w-40 flex-shrink-0"
                        value={dfAttenuationDb}
                        onChange={(value) => setDfAttenuationDb(value)}
                        onChangeEnd={applyMicTuning}
                        accessibilityLabel={t(
                            "debugSettings.noiseAttenuationLimit",
                            { value: dfAttenuationDb },
                        )}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text
                            nativeID="sound-interval"
                            className="text-sm text-discord-textPrimary"
                        >
                            {t("debugSettings.soundboardInterval", {
                                value: soundIntervalMs,
                            })}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("debugSettings.soundboardIntervalHint")}
                        </Text>
                    </View>
                    <Range
                        min={0}
                        max={5000}
                        step={100}
                        className="w-40 flex-shrink-0"
                        value={soundIntervalMs}
                        onChange={(value) => setSoundIntervalMs(value)}
                        accessibilityLabel={t(
                            "debugSettings.soundboardInterval",
                            { value: soundIntervalMs },
                        )}
                    />
                </View>
            </View>

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                    {t("debugSettings.syncStatus")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("debugSettings.useSlidingSync")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "debugSettings.experimentalLoadsRoomsInAGrowing",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={userId ? isSlidingSyncEnabled(userId) : false}
                        onChange={toggleSlidingSync}
                        label={t("debugSettings.useSlidingSync")}
                    />
                </View>
                {syncRows.map(([label, value]) => (
                    <View
                        key={label}
                        className="flex-row items-start gap-3 py-1 border-b border-discord-divider"
                    >
                        <Text className="text-sm text-discord-textMuted flex-shrink-0 w-44">
                            {label}
                        </Text>
                        <Text className="flex-1 text-discord-textPrimary break-all font-mono text-xs">
                            {value}
                        </Text>
                    </View>
                ))}
                <View className="mt-3 flex-row items-center gap-2">
                    <Text className="flex-1 text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                        {t("debugSettings.syncLog")}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => setSyncLog(getSyncLog())}
                        className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover"
                    >
                        <Text className="text-xs font-semibold text-discord-textPrimary">
                            {t("debugSettings.refresh")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void copySyncLog()}
                        className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover"
                    >
                        <Text className="text-xs font-semibold text-discord-textPrimary">
                            {syncLogCopied
                                ? t("debugSettings.copied")
                                : t("common.copy")}
                        </Text>
                    </Pressable>
                </View>
                {syncLog.length === 0 ? (
                    <Text className="mt-1 text-xs text-discord-textMuted">
                        {t("debugSettings.syncLogEmpty")}
                    </Text>
                ) : (
                    <ScrollView
                        nestedScrollEnabled
                        className="mt-1 max-h-60 rounded bg-discord-backgroundTertiary grow-0"
                        contentContainerClassName="p-2"
                    >
                        <Text
                            selectable
                            className="whitespace-pre-wrap break-all text-xs font-mono text-discord-textPrimary select-text"
                        >
                            {syncLog.join("\n")}
                        </Text>
                    </ScrollView>
                )}
            </View>

            <View>
                <View className="mb-2 flex-row items-center gap-2">
                    <Text className="flex-1 text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                        {t("debugSettings.indexSync")}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !indexSync.attached }}
                        onPress={() => {
                            requestIndexSyncNow();
                            setIndexSync(getIndexSyncStatus());
                        }}
                        disabled={!indexSync.attached}
                        className={`px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover ${
                            !indexSync.attached ? "opacity-50" : ""
                        }`}
                    >
                        <Text className="text-xs font-semibold text-discord-textPrimary">
                            {t("debugSettings.indexSyncNow")}
                        </Text>
                    </Pressable>
                </View>
                <Text className="mb-2 text-xs text-discord-textMuted">
                    {indexSync.attached
                        ? t("debugSettings.indexSyncHint")
                        : t("debugSettings.indexSyncOff")}
                </Text>
                {indexSyncRows.map(([label, value]) => (
                    <View
                        key={label}
                        className="flex-row items-start gap-3 py-1 border-b border-discord-divider"
                    >
                        <Text className="text-sm text-discord-textMuted flex-shrink-0 w-44">
                            {label}
                        </Text>
                        <Text className="flex-1 text-discord-textPrimary break-all font-mono text-xs">
                            {value}
                        </Text>
                    </View>
                ))}
                {indexSync.log.length > 0 ? (
                    <ScrollView
                        nestedScrollEnabled
                        className="mt-2 max-h-48 rounded bg-discord-backgroundTertiary grow-0"
                        contentContainerClassName="p-2"
                    >
                        <Text
                            selectable
                            className="whitespace-pre-wrap break-all text-xs font-mono text-discord-textPrimary select-text"
                        >
                            {indexSync.log.join("\n")}
                        </Text>
                    </ScrollView>
                ) : null}
            </View>

            <GpuDebug />

            <ExtendedProfileDebug />

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                    {t("debugSettings.pushStatus")}
                </Text>
                {rows.map(([label, value]) => (
                    <View
                        key={label}
                        className="flex-row items-start gap-3 py-1 border-b border-discord-divider"
                    >
                        <Text className="text-sm text-discord-textMuted flex-shrink-0 w-44">
                            {label}
                        </Text>
                        <Text className="flex-1 text-discord-textPrimary break-all font-mono text-xs">
                            {value}
                        </Text>
                    </View>
                ))}
                {pushDebug.lastError ? (
                    <Text className="mt-3 text-xs text-discord-danger break-all font-mono">
                        {t("debugSettings.lastError", {
                            lastError: pushDebug.lastError,
                        })}
                    </Text>
                ) : null}
            </View>

            <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: loading }}
                onPress={() => void diagnose()}
                disabled={loading}
                className={`self-start px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover ${
                    loading ? "opacity-50" : ""
                }`}
            >
                <Text className="text-sm font-medium text-white">
                    {loading
                        ? t("common.checking")
                        : t("debugSettings.runDiagnostics")}
                </Text>
            </Pressable>

            {pushers !== null || pushersError ? (
                <View className="gap-2">
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                        {t("debugSettings.homeserverPushers")}
                    </Text>
                    {pushersError ? (
                        <Text className="text-xs text-discord-danger break-all">
                            {pushersError}
                        </Text>
                    ) : pushers?.length === 0 ? (
                        <Text className="text-sm text-discord-textMuted">
                            {t(
                                "debugSettings.theHomeserverHasNoPushersRegistered",
                            )}
                        </Text>
                    ) : (
                        <>
                            <Text
                                className={`text-sm ${
                                    matchingPusher
                                        ? "text-discord-textPositive"
                                        : "text-discord-warning"
                                }`}
                            >
                                {matchingPusher
                                    ? t(
                                          "debugSettings.aPusherMatchesTheConfiguredGateway",
                                      )
                                    : t(
                                          "debugSettings.noPusherMatchesTheConfiguredGateway",
                                      )}
                            </Text>
                            {(pushers ?? []).map((pusher, i) => (
                                <View
                                    key={i}
                                    className="bg-discord-backgroundTertiary rounded p-2"
                                >
                                    <Text className="text-xs font-mono text-discord-textPrimary break-all">
                                        {t("debugSettings.appId", {
                                            app_id: pusher.app_id,
                                        })}
                                    </Text>
                                    <Text className="text-xs font-mono text-discord-textPrimary break-all">
                                        {t("debugSettings.url", {
                                            value:
                                                pusher.url ??
                                                t("debugSettings.none"),
                                        })}
                                    </Text>
                                    <Text className="text-xs font-mono text-discord-textPrimary break-all">
                                        {t("debugSettings.pushkey", {
                                            pushkeyPreview:
                                                pusher.pushkeyPreview,
                                        })}
                                    </Text>
                                </View>
                            ))}
                        </>
                    )}
                </View>
            ) : null}

            {webPush?.supported ? (
                <View className="gap-1">
                    <Text className="text-xs font-mono font-semibold uppercase tracking-wide text-discord-textMuted">
                        {t("debugSettings.webPushPwa")}
                    </Text>
                    <Text className="text-xs font-mono text-discord-textMuted">
                        {t("debugSettings.vapidKey", {
                            value: webPush.configured
                                ? t("debugSettings.set")
                                : t("debugSettings.missing"),
                        })}
                    </Text>
                    <Text className="text-xs font-mono text-discord-textMuted">
                        {t("debugSettings.permission", {
                            permission: webPush.permission,
                        })}
                    </Text>
                    <Text className="text-xs font-mono text-discord-textMuted">
                        {t("debugSettings.subscription", {
                            value: webPush.subscribed
                                ? t("debugSettings.active")
                                : t("debugSettings.none"),
                        })}
                    </Text>
                    <Text className="text-xs font-mono text-discord-textMuted">
                        {t("debugSettings.homeserverPusher", {
                            value: pushers?.some(
                                (pusher) => pusher.app_id === WEBPUSH_APP_ID,
                            )
                                ? "registered"
                                : t("debugSettings.notFound"),
                        })}
                    </Text>
                    {webPush.error ? (
                        <Text className="text-xs font-mono text-discord-danger">
                            {t("debugSettings.error", {
                                error: webPush.error,
                            })}
                        </Text>
                    ) : null}
                </View>
            ) : null}

            {gateway ? (
                <View>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                        {t("debugSettings.gatewaySygnalFirebase")}
                    </Text>
                    <Text
                        className={`text-sm ${
                            gateway.reachable
                                ? "text-discord-textPositive"
                                : "text-discord-danger"
                        }`}
                    >
                        {gateway.reachable
                            ? t("debugSettings.gatewayReachable")
                            : t("debugSettings.gatewayNotReachable")}
                    </Text>
                    <Text className="text-xs text-discord-textMuted break-all font-mono mt-1">
                        {gateway.detail}
                    </Text>
                </View>
            ) : null}

            {nativeSession ? (
                <View className="gap-1">
                    <Text className="text-xs text-discord-textMuted font-semibold uppercase tracking-wide">
                        {t("debugSettings.nativeSessionPushEnrichment")}
                    </Text>
                    {nativeSession.error ? (
                        <Text className="text-xs text-discord-danger">
                            {nativeSession.error}
                        </Text>
                    ) : (
                        <>
                            <Text className="text-xs text-discord-textMuted">
                                {t("debugSettings.homeserver", {
                                    value:
                                        nativeSession.homeserverUrl ??
                                        t("debugSettings.none"),
                                })}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t("debugSettings.user", {
                                    value:
                                        nativeSession.userId ??
                                        t("debugSettings.none"),
                                })}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t("debugSettings.device", {
                                    value:
                                        nativeSession.deviceId ??
                                        t("debugSettings.none"),
                                })}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t("debugSettings.accessToken", {
                                    value: nativeSession.hasToken
                                        ? "present"
                                        : t("debugSettings.none"),
                                })}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t("debugSettings.hideMessageText", {
                                    value: nativeSession.hideNotificationBody
                                        ? "on"
                                        : "off",
                                })}
                            </Text>
                        </>
                    )}
                </View>
            ) : null}

            {rules ? (
                <View>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                        {t("debugSettings.notificationRulesServer")}
                    </Text>
                    <View className="flex-row justify-between gap-3">
                        <Text className="flex-shrink text-xs font-mono text-discord-textPrimary">
                            {t("debugSettings.allNotificationsMasterRule")}
                        </Text>
                        <Text
                            className={`text-xs font-mono ${
                                accountNotificationsOff
                                    ? "text-discord-warning"
                                    : "text-discord-textPrimary"
                            }`}
                        >
                            {accountNotificationsOff === null
                                ? "?"
                                : accountNotificationsOff
                                  ? "off"
                                  : "on"}
                        </Text>
                    </View>
                    {rules.map((rule) => (
                        <View
                            key={rule.ruleId}
                            className="flex-row justify-between gap-3"
                        >
                            <Text className="flex-shrink text-xs font-mono text-discord-textPrimary">
                                {rule.label}
                            </Text>
                            <Text className="text-xs font-mono text-discord-textPrimary">
                                {rule.level}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : null}

            <View>
                <View className="flex-row items-center gap-3 py-2">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("debugSettings.hideUpdatePrompts")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("debugSettings.hideUpdatePromptsHint")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={updateNagDisabled}
                        onChange={setUpdateNagDisabled}
                        label={t("debugSettings.hideUpdatePrompts")}
                    />
                </View>
            </View>
        </View>
    );
}

/**
 * Zami: the longest stalls of the JS thread after this launch and the one before
 * (@-/com.leonsilicon.zami.startup), each with where the app was, updated as new ones are
 * recorded. A diagnostic, so not translated.
 */
function SessionStalls() {
    // The list is replaced whenever a new stall makes it.
    useSyncExternalStore(subscribeStartup, () => thisStartup().sessionStalls);
    const records = [
        ["This launch", thisStartup()],
        ["Previous launch", previousStartup()],
    ] as const;
    return (
        <View>
            <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                Stalls
            </Text>
            {records.map(([label, record]) => {
                const lines = record ? formatSessionStalls(record) : [];
                return (
                    <View
                        key={label}
                        className="py-2 border-b border-discord-divider"
                    >
                        <Text className="text-sm text-discord-textPrimary mb-1">
                            {label}
                        </Text>
                        {lines.length ? (
                            lines.map((line, i) => (
                                <Text
                                    key={i}
                                    className="text-discord-textMuted font-mono text-xs"
                                >
                                    {line}
                                </Text>
                            ))
                        ) : (
                            <Text className="text-discord-textMuted text-xs">
                                {!record
                                    ? "Nothing recorded."
                                    : record.finished
                                      ? "No stall of 50 ms or more after the launch."
                                      : "Watched once the launch is over."}
                            </Text>
                        )}
                    </View>
                );
            })}
        </View>
    );
}
