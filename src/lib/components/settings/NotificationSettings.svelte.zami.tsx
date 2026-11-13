import { notificationPermission, Select } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useRef, useState } from "react";
import {
    AppState,
    Pressable,
    Text,
    TextInput,
    View,
    type AppStateStatus,
} from "react-native";
import { t } from "$lib/i18n";
import OptionSelector from "$lib/components/ui/OptionSelector.svelte";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import {
    DEFAULT_PUSH_RULES,
    setAccountNotificationsDisabled,
    getClient,
    isAccountNotificationsDisabled,
    getDefaultPushRuleLevel,
    publishActiveSession,
    setDefaultPushRuleLevel,
    getKeywordRules,
    addKeywordRule,
    setKeywordRuleBehavior,
    setKeywordRuleEnabled,
    deleteKeywordRule,
    type PushRuleLevel,
    type KeywordBehavior,
} from "$lib/matrix/client";
import {
    GRACE_OPTIONS,
    MAX_CUSTOM_GRACE_MINUTES,
    MIN_CUSTOM_GRACE_MS,
    graceMsToMinutesInput,
    isPresetGraceMs,
    normalizeGraceMs,
    parseCustomGraceMinutes,
} from "$lib/utils/activeSession";
import { validateKeyword } from "$lib/utils/keywordRules";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import {
    setActiveSessionGraceMs,
    setDesktopAlertMode,
    setDeviceNotifications,
    settingsState,
} from "$lib/stores/settings.svelte";
import {
    canFlashTaskbar,
    type DesktopAlertMode,
} from "$lib/utils/desktopAlert";
// Zami: requestWebPushPermission is the Notification API's prompt here; see
// requestPermission.
import { initWebPush, teardownWebPush } from "$lib/webPush";
import {
    checkNativeNotificationPermission,
    initPush,
    pushDebug,
    requestNativeNotificationPermission,
    switchPushProvider,
    unregisterPush,
} from "$lib/push";
import {
    getPushProviderPref,
    getUnifiedPushStatus,
    unifiedPushSupported,
    type PushProviderPref,
    type UnifiedPushStatus,
} from "$lib/unifiedPush";
import { Capacitor } from "@capacitor/core";

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. Text classes sit on each Text. `data-setting-anchor`
// (settings search scrolls to it) is not ported.
export default function NotificationSettings() {
    // Android posts every notification from the native push service, so the
    // in-app pop-up setting does nothing there, and its OS permission comes
    // from the native plugin (the WebView has no Notification API).
    const nativeApp = Capacitor.isNativePlatform();

    // Every notification for this account switched off server-side (often
    // from another client): nothing below can notify while it is.
    const accountNotificationsOff = useRune(
        () => isAccountNotificationsDisabled() === true,
    );
    const deviceNotifications = useRune(
        () => settingsState.deviceNotifications,
    );
    // Zami: a ref, since nothing renders it and a second toggle before the
    // first settles must see it pending.
    const accountNotificationsPending = useRef(false);
    async function setAccountNotifications(enabled: boolean) {
        if (accountNotificationsPending.current) return;
        accountNotificationsPending.current = true;
        try {
            await setAccountNotificationsDisabled(!enabled);
        } catch {
            showErrorToast(
                t("notificationSettings.couldNotUpdateNotifications"),
            );
        } finally {
            accountNotificationsPending.current = false;
        }
    }

    // This device only: stop its popups and sound, and drop its pusher so the
    // server stops pushing here. Other devices are untouched.
    async function setDeviceNotificationsEnabled(enabled: boolean) {
        setDeviceNotifications(enabled);
        const client = getClient();
        if (!client) return;
        try {
            if (enabled) {
                await initPush(client);
                await initWebPush(client);
            } else {
                await unregisterPush(client);
                await teardownWebPush(client);
            }
        } catch {
            showErrorToast(
                t("notificationSettings.couldNotUpdateNotifications"),
            );
        }
    }
    const taskbarFlash = canFlashTaskbar();

    // Zami: `Notification.permission` is asynchronous here.
    function currentPermission() {
        return notificationPermission();
    }

    // Native starts as "granted" so the row doesn't flash in before the
    // async check says otherwise. (Zami: so does the expo-notifications check.)
    const [permission, setPermission] = useState<
        NotificationPermission | "unsupported"
    >("granted");
    const [permissionLoading, setPermissionLoading] = useState(false);

    useEffect(() => {
        if (nativeApp)
            void checkNativeNotificationPermission().then((p) =>
                setPermission(p),
            );
        else void currentPermission().then((p) => setPermission(p));
        // Zami: and again on every return to the app, since iOS changes the
        // permission in its Settings app. Push registration (initPush) skipped
        // it while it was missing, so it runs once it's granted.
        if (nativeApp) return;
        const subscription = AppState.addEventListener("change", (state) => {
            if (state !== "active") return;
            void currentPermission().then((p) => {
                setPermission(p);
                const client = getClient();
                if (p === "granted" && client)
                    void initPush(client).catch(() => {});
            });
        });
        return () => subscription.remove();
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as the script runs.
    }, []);

    // ── Push service (Android): FCM or a UnifiedPush distributor ──────────
    const pushServiceSupported = unifiedPushSupported();
    const [upStatus, setUpStatus] = useState<UnifiedPushStatus | null>(null);
    const [pushPref, setPushPref] = useState<PushProviderPref>(() =>
        getPushProviderPref(),
    );
    const [pushSwitching, setPushSwitching] = useState(false);
    // pushDebug is a plain object; mirror the bit this panel shows.
    const [activeProvider, setActiveProvider] = useState(pushDebug.provider);
    const [activeDistributor, setActiveDistributor] = useState(
        pushDebug.upDistributor,
    );

    async function refreshPushService() {
        setUpStatus(await getUnifiedPushStatus());
        setActiveProvider(pushDebug.provider);
        setActiveDistributor(pushDebug.upDistributor);
    }

    // Re-read on return to the app: the usual way to get a distributor is to
    // leave, install ntfy, and come back.
    // Zami: `visibilitychange` is AppState's change to "active".
    useEffect(() => {
        if (!pushServiceSupported) return;
        void refreshPushService();
        const onVisible = (state: AppStateStatus) => {
            if (state === "active") void refreshPushService();
        };
        const subscription = AppState.addEventListener("change", onVisible);
        return () => subscription.remove();
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as onMount.
    }, []);

    // A chosen distributor that has since been uninstalled has no option;
    // push.ts then behaves as "auto", so show that.
    const pushSelectValue =
        pushPref.startsWith("up:") &&
        !upStatus?.distributors.some((d) => `up:${d.packageName}` === pushPref)
            ? "auto"
            : pushPref;

    function distributorLabel(pkg: string | null): string {
        if (!pkg) return "";
        return (
            upStatus?.distributors.find((d) => d.packageName === pkg)?.label ??
            pkg
        );
    }

    async function pickPushService(raw: string) {
        const pref = raw as PushProviderPref;
        setPushPref(pref);
        setPushSwitching(true);
        try {
            await switchPushProvider(getClient(), pref);
        } catch (e) {
            showErrorToast(
                toastMessage(
                    e,
                    t("notificationSettings.pushServiceSwitchFailed"),
                ),
            );
        } finally {
            setPushSwitching(false);
            await refreshPushService();
        }
    }

    const [soundEnabled, setSoundEnabledState] = useState(
        () => localStorage.getItem("notifSoundEnabled") !== "false",
    );
    const [defaultRulesTick, setDefaultRulesTick] = useState(0);

    async function requestPermission() {
        setPermissionLoading(true);
        if (nativeApp) {
            setPermission(
                await requestNativeNotificationPermission(getClient()),
            );
            setPermissionLoading(false);
            return;
        }
        // Zami: the system's prompt (the Notification API) in place of
        // requestWebPushPermission, which needs a service worker.
        let next: NotificationPermission | "unsupported" =
            await Notification.requestPermission();
        setPermission(next);
        if (next === "granted") {
            const client = getClient();
            // Zami: and this device's APNs pusher, which initPush skipped
            // without the permission. initWebPush does nothing without a
            // service worker.
            if (client) await initPush(client).catch(() => {});
            if (client) await initWebPush(client).catch(() => {});
        }
        next = await currentPermission();
        setPermission(next);
        setPermissionLoading(false);
    }

    function setSoundEnabled(enabled: boolean) {
        setSoundEnabledState(enabled);
        localStorage.setItem("notifSoundEnabled", String(enabled));
    }

    const alertModeOptions: ReadonlyArray<{
        value: DesktopAlertMode;
        label: string;
        title: string;
    }> = [
        {
            value: "loud",
            label: t("notificationSettings.loudOnly"),
            title: t("notificationSettings.onlyNotificationsThatMakeASound"),
        },
        {
            value: "all",
            label: t("notificationSettings.silentAndLoud"),
            title: t("notificationSettings.everyNotificationLoudOrSilent"),
        },
        {
            value: "none",
            label: t("notificationSettings.none"),
            title: t("notificationSettings.neverAlertOnThisDevice"),
        },
    ];

    const [graceSaveError, setGraceSaveError] = useState(false);
    const [graceSavePending, setGraceSavePending] = useState(false);

    /** Shared by the picker and the retry button: re-picking the option that
     *  is already selected fires no `change`, so a failed save needs its own
     *  way back. That matters most for "Off" (0) — the heartbeat writer stops
     *  republishing once the grace is 0, so nothing else would ever retry it. */
    async function publishGrace(grace: number) {
        setGraceSaveError(false);
        setGraceSavePending(true);
        try {
            // The account-data write is what carries the choice to the user's
            // other devices, the service worker and the Android service — it
            // runs for every value, "Off" (0) included. If it fails, a focused
            // peer will republish the old grace and quietly undo the change,
            // so surface the failure instead of swallowing it.
            //
            // `false` means the write was skipped (no client / no device id),
            // which leaves the OLD grace in the blob just as surely as a thrown
            // error does — so treat the two identically rather than reporting a
            // save that never happened.
            if (!(await publishActiveSession(grace))) setGraceSaveError(true);
        } catch {
            setGraceSaveError(true);
        } finally {
            setGraceSavePending(false);
        }
    }

    async function pickActiveSessionGrace(raw: string) {
        const grace = normalizeGraceMs(Number(raw));
        setActiveSessionGraceMs(grace);
        await publishGrace(grace);
    }

    const CUSTOM_OPTION = "custom";

    const activeSessionGraceMs = useRune(
        () => settingsState.activeSessionGraceMs,
    );
    const desktopAlertMode = useRune(() => settingsState.desktopAlertMode);

    /* Seeded once, when the panel mounts: a stored grace that matches no
     * preset — typed here or on another device — must come back as "Custom"
     * with its value filled in, not blank and not snapped to a preset. */
    const [graceIsCustom, setGraceIsCustom] = useState(
        () => !isPresetGraceMs(settingsState.activeSessionGraceMs),
    );
    const [customMinutes, setCustomMinutes] = useState(() =>
        isPresetGraceMs(settingsState.activeSessionGraceMs)
            ? ""
            : graceMsToMinutesInput(settingsState.activeSessionGraceMs),
    );
    const [customError, setCustomError] = useState("");

    function onGraceSelect(raw: string) {
        setCustomError("");
        if (raw !== CUSTOM_OPTION) {
            setGraceIsCustom(false);
            void pickActiveSessionGrace(raw);
            return;
        }
        setGraceIsCustom(true);
        // Nothing is saved by picking "Custom" — the value only lands when the
        // user commits one, so a half-typed number can't reach the other
        // devices. Prefill from the current setting where that's meaningful.
        if (customMinutes.trim().length === 0)
            setCustomMinutes(
                graceMsToMinutesInput(
                    Math.max(
                        settingsState.activeSessionGraceMs,
                        MIN_CUSTOM_GRACE_MS,
                    ),
                ),
            );
    }

    /* Validation lives in activeSession.ts so the ceiling here is the same
     * number every reader clamps to. Out-of-range input is REJECTED with a
     * message rather than quietly curbed: storing a value the readers would
     * shorten is exactly how this control ends up lying about its behaviour. */
    async function saveCustomGrace() {
        const parsed = parseCustomGraceMinutes(customMinutes);
        if (!parsed.ok) {
            setCustomError(parsed.error);
            return;
        }
        setCustomError("");
        setCustomMinutes(graceMsToMinutesInput(parsed.ms));
        setActiveSessionGraceMs(parsed.ms);
        await publishGrace(parsed.ms);
    }

    // Zami: a <select> is as wide as its longest option; Select's label fills
    // its box instead, so a box beside a label needs a width (`w-40`).
    const selectClass =
        "flex-shrink-0 w-40 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none border border-transparent focus:border-discord-accent/50";

    const ruleLevels = useRune(() => {
        void defaultRulesTick;
        return Object.fromEntries(
            DEFAULT_PUSH_RULES.map((rule) => [
                rule.ruleId,
                getDefaultPushRuleLevel(rule.ruleId),
            ]),
        ) as Record<string, PushRuleLevel>;
    }, [defaultRulesTick]);

    /* `?? fallback` only fires for a MISSING message. An Error whose message is
     * "" (or whitespace) is common enough — a rethrow that lost its cause, an
     * SDK error built from an empty body — and toasting it renders an empty
     * red box that tells the user nothing. Treat blank as absent. */
    function toastMessage(error: unknown, fallback: string): string {
        const message = (error as Error)?.message;
        return typeof message === "string" && message.trim().length > 0
            ? message
            : fallback;
    }

    async function setRuleLevel(
        rule: (typeof DEFAULT_PUSH_RULES)[number],
        level: PushRuleLevel,
    ) {
        try {
            await setDefaultPushRuleLevel(rule.ruleId, rule.kind, level);
        } catch (e) {
            // The server kept the old rule: say so, and let the row snap back to
            // the canonical value rather than showing the change as applied.
            showErrorToast(
                toastMessage(
                    e,
                    t("notificationSettings.couldNotSaveNotificationSetting"),
                ),
            );
        } finally {
            setDefaultRulesTick((tick) => tick + 1);
        }
    }

    const keywordRules = useRune(() => getKeywordRules());
    const [newKeyword, setNewKeyword] = useState("");
    const [keywordError, setKeywordError] = useState("");
    const [addPending, setAddPending] = useState(false);
    const [rowPending, setRowPending] = useState<string | null>(null);

    const behaviorOptions: ReadonlyArray<{
        value: KeywordBehavior;
        label: string;
        title: string;
    }> = [
        {
            value: "highlight_sound",
            label: t("notificationSettings.highlightSound"),
            title: t("notificationSettings.notifyWithAHighlightAndSound"),
        },
        {
            value: "highlight",
            label: t("notificationSettings.highlight"),
            title: t("notificationSettings.notifyWithAHighlight"),
        },
        {
            value: "notify",
            label: t("notificationSettings.notify"),
            title: t("notificationSettings.notifyWithoutAHighlight"),
        },
    ];

    async function addKeyword() {
        const result = validateKeyword(
            newKeyword,
            keywordRules.map((r) => r.pattern),
        );
        if (!result.ok) {
            setKeywordError(result.error);
            return;
        }
        setAddPending(true);
        setKeywordError("");
        try {
            await addKeywordRule(result.pattern, "highlight_sound");
            setNewKeyword("");
        } catch (e) {
            setKeywordError(
                (e as Error)?.message ??
                    t("notificationSettings.failedToAddKeyword"),
            );
        } finally {
            setAddPending(false);
        }
    }

    async function changeBehavior(ruleId: string, behavior: KeywordBehavior) {
        setRowPending(ruleId);
        setKeywordError("");
        try {
            await setKeywordRuleBehavior(ruleId, behavior);
        } catch (e) {
            setKeywordError(
                (e as Error)?.message ??
                    t("notificationSettings.failedToUpdateKeyword"),
            );
        } finally {
            setRowPending(null);
        }
    }

    async function toggleEnabled(ruleId: string, enabled: boolean) {
        setRowPending(ruleId);
        setKeywordError("");
        try {
            await setKeywordRuleEnabled(ruleId, enabled);
        } catch (e) {
            setKeywordError(
                (e as Error)?.message ??
                    t("notificationSettings.failedToUpdateKeyword"),
            );
        } finally {
            setRowPending(null);
        }
    }

    async function removeKeyword(ruleId: string) {
        setRowPending(ruleId);
        setKeywordError("");
        try {
            await deleteKeywordRule(ruleId);
        } catch (e) {
            setKeywordError(
                (e as Error)?.message ??
                    t("notificationSettings.failedToDeleteKeyword"),
            );
        } finally {
            setRowPending(null);
        }
    }

    return (
        <View className="gap-6">
            <View>
                <View
                    className={`flex-row items-center gap-3 py-2 border-b border-discord-divider ${
                        accountNotificationsOff
                            ? "rounded-md p-3 bg-discord-warning/20"
                            : ""
                    }`}
                >
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("notificationSettings.accountNotifications")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {accountNotificationsOff
                                ? t(
                                      "notificationSettings.accountNotificationsOffDetail",
                                  )
                                : t(
                                      "notificationSettings.accountNotificationsDetail",
                                  )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={!accountNotificationsOff}
                        onChange={(enabled) =>
                            void setAccountNotifications(enabled)
                        }
                        label={t("notificationSettings.accountNotifications")}
                    />
                </View>
            </View>

            <View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("notificationSettings.thisDeviceNotifications")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "notificationSettings.thisDeviceNotificationsDetail",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={deviceNotifications}
                        onChange={(enabled) =>
                            void setDeviceNotificationsEnabled(enabled)
                        }
                        label={t(
                            "notificationSettings.thisDeviceNotifications",
                        )}
                    />
                </View>
            </View>

            <Text
                accessibilityRole="header"
                className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2"
            >
                {t("notificationSettings.thisDevice")}
            </Text>

            {permission !== "granted" ? (
                <View>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                        {t("notificationSettings.systemPermission")}
                    </Text>
                    <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                        <View className="flex-1 min-w-0">
                            <Text className="text-sm text-discord-textPrimary">
                                {t("notificationSettings.pushNotifications")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {permission === "denied"
                                    ? t(
                                          "notificationSettings.permissionIsBlockedInSystemSettings",
                                      )
                                    : permission === "unsupported"
                                      ? t(
                                            "notificationSettings.notificationsAreNotSupportedHere",
                                        )
                                      : t(
                                            "notificationSettings.allowThisAppToSendNotifications",
                                        )}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void requestPermission()}
                            disabled={
                                permissionLoading ||
                                permission === "denied" ||
                                permission === "unsupported"
                            }
                            className="px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-discord-accent flex-row items-center gap-2 flex-shrink-0"
                        >
                            <Text className="text-sm font-semibold text-white">
                                {permissionLoading
                                    ? t("notificationSettings.requesting")
                                    : permission === "denied"
                                      ? t("notificationSettings.blocked")
                                      : permission === "unsupported"
                                        ? t("notificationSettings.unavailable")
                                        : t("notificationSettings.enable")}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            ) : null}

            {pushServiceSupported && upStatus ? (
                <View>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                        {t("notificationSettings.pushService")}
                    </Text>
                    <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                        <View className="flex-1 min-w-0">
                            <Text className="text-sm text-discord-textPrimary">
                                {t("notificationSettings.pushServiceLabel")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t(
                                    "notificationSettings.pushServiceDescription",
                                )}
                            </Text>
                        </View>
                        <Select
                            className={selectClass}
                            value={pushSelectValue}
                            disabled={pushSwitching}
                            onChange={(value) => void pickPushService(value)}
                            accessibilityLabel={t(
                                "notificationSettings.pushService",
                            )}
                            options={[
                                {
                                    value: "auto",
                                    label: t(
                                        "notificationSettings.pushServiceAutomatic",
                                    ),
                                },
                                {
                                    value: "fcm",
                                    label: upStatus.fcmAvailable
                                        ? t(
                                              "notificationSettings.pushServiceFcm",
                                          )
                                        : t(
                                              "notificationSettings.pushServiceFcmUnavailable",
                                          ),
                                },
                                ...upStatus.distributors.map((d) => ({
                                    value: `up:${d.packageName}`,
                                    label: t(
                                        "notificationSettings.pushServiceUnifiedPush",
                                        { label: d.label },
                                    ),
                                })),
                            ]}
                        />
                    </View>
                    <Text
                        className="text-xs text-discord-textMuted mt-2"
                        accessibilityLiveRegion="polite"
                    >
                        {activeProvider === "unifiedpush"
                            ? t(
                                  "notificationSettings.pushServiceActiveUnifiedPush",
                                  {
                                      label: distributorLabel(
                                          activeDistributor,
                                      ),
                                  },
                              )
                            : activeProvider === "fcm"
                              ? t("notificationSettings.pushServiceActiveFcm")
                              : activeProvider === "none"
                                ? t(
                                      "notificationSettings.pushServiceActiveNone",
                                  )
                                : null}
                    </Text>
                    {upStatus.distributors.length === 0 ? (
                        <Text className="text-xs text-discord-textMuted mt-1">
                            {t("notificationSettings.pushServiceNoDistributor")}
                        </Text>
                    ) : null}
                </View>
            ) : null}

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                    {t("notificationSettings.sound")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("notificationSettings.notificationSound")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "notificationSettings.playASoundForLoudNotifications",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={soundEnabled}
                        onChange={setSoundEnabled}
                        label={t("notificationSettings.notificationSound")}
                    />
                </View>
            </View>

            {!nativeApp ? (
                <View>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                        {taskbarFlash
                            ? t("notificationSettings.desktopAlerts")
                            : t("notificationSettings.popUps")}
                    </Text>
                    <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                        <View className="flex-1 min-w-0">
                            <Text className="text-sm text-discord-textPrimary">
                                {taskbarFlash
                                    ? t(
                                          "notificationSettings.popUpAndTaskbarFlash",
                                      )
                                    : t(
                                          "notificationSettings.popUpNotifications",
                                      )}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {taskbarFlash
                                    ? t(
                                          "notificationSettings.whichNotificationsShowASystemPop",
                                      )
                                    : t(
                                          "notificationSettings.whichNotificationsShowASystemPopUp",
                                      )}
                            </Text>
                        </View>
                        <OptionSelector
                            value={desktopAlertMode}
                            options={alertModeOptions}
                            onChange={setDesktopAlertMode}
                            ariaLabel={
                                taskbarFlash
                                    ? t("notificationSettings.desktopAlerts")
                                    : t("notificationSettings.popUps")
                            }
                        />
                    </View>
                </View>
            ) : null}

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                    {t("notificationSettings.multipleDevices")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("notificationSettings.quietOnMyOtherDevices")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "notificationSettings.whileYouReActivelyUsingOne",
                            )}
                        </Text>
                    </View>
                    <Select
                        className={selectClass}
                        value={
                            graceIsCustom
                                ? CUSTOM_OPTION
                                : String(activeSessionGraceMs)
                        }
                        onChange={onGraceSelect}
                        accessibilityLabel={t(
                            "notificationSettings.quietOnMyOtherDevices",
                        )}
                        options={[
                            ...GRACE_OPTIONS.map((opt) => ({
                                value: String(opt.value),
                                label: opt.label,
                            })),
                            {
                                value: CUSTOM_OPTION,
                                label: t("notificationSettings.custom"),
                            },
                        ]}
                    />
                </View>
                {graceIsCustom ? (
                    <>
                        <View className="flex-row items-center justify-end gap-2 mt-2">
                            {/* Zami: `min`/`max`/`step` and `aria-invalid` have no
                                TextInput equivalent; parseCustomGraceMinutes
                                checks the range. */}
                            <TextInput
                                keyboardType="decimal-pad"
                                returnKeyType="done"
                                className="w-24 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none border border-transparent focus:border-discord-accent/50"
                                value={customMinutes}
                                onChangeText={setCustomMinutes}
                                onSubmitEditing={() => void saveCustomGrace()}
                                accessibilityLabel={t(
                                    "notificationSettings.customQuietDurationInMinutes",
                                )}
                            />
                            <Text className="text-xs text-discord-textMuted">
                                {t("notificationSettings.minutesMax", {
                                    MAX_CUSTOM_GRACE_MINUTES,
                                })}
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => void saveCustomGrace()}
                                disabled={graceSavePending}
                                className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors disabled:opacity-50 flex-shrink-0"
                            >
                                <Text className="text-xs font-semibold text-discord-textPrimary">
                                    {graceSavePending
                                        ? t("common.saving")
                                        : t("common.save")}
                                </Text>
                            </Pressable>
                        </View>
                        {customError ? (
                            <Text
                                className="text-xs text-discord-danger mt-1 text-right"
                                accessibilityLiveRegion="polite"
                            >
                                {customError}
                            </Text>
                        ) : null}
                    </>
                ) : null}
                {graceSaveError ? (
                    <View className="flex-row items-start gap-2 mt-2">
                        <Text
                            className="flex-1 min-w-0 text-sm text-discord-danger"
                            accessibilityLiveRegion="polite"
                        >
                            {t("notificationSettings.couldnTSaveToYourAccount")}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                                void publishGrace(
                                    settingsState.activeSessionGraceMs,
                                )
                            }
                            disabled={graceSavePending}
                            accessibilityLabel={t(
                                "notificationSettings.retrySavingTheOtherDeviceQuiet",
                            )}
                            className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors disabled:opacity-50 flex-shrink-0"
                        >
                            <Text className="text-xs font-semibold text-discord-textPrimary">
                                {graceSavePending
                                    ? t("notificationSettings.retrying")
                                    : t("common.retry")}
                            </Text>
                        </Pressable>
                    </View>
                ) : null}
            </View>

            <Text
                accessibilityRole="header"
                className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2"
            >
                {t("notificationSettings.rules")}
            </Text>

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1">
                    {t("notificationSettings.notificationRules")}
                </Text>
                <Text className="text-xs text-discord-textMuted mb-3">
                    {t("notificationSettings.loudNotifyWithSoundSilentNotify")}
                </Text>
                <View className="gap-1">
                    {DEFAULT_PUSH_RULES.map((rule) => (
                        <View
                            key={rule.ruleId}
                            className="flex-row items-center gap-3 py-2 border-b border-discord-divider"
                        >
                            <View className="flex-1 min-w-0">
                                <Text className="text-sm text-discord-textPrimary">
                                    {rule.label}
                                </Text>
                                <Text className="text-xs text-discord-textMuted">
                                    {rule.description}
                                </Text>
                            </View>
                            <OptionSelector
                                value={ruleLevels[rule.ruleId]}
                                options={[
                                    { value: "loud", label: "Loud" },
                                    { value: "silent", label: "Silent" },
                                    { value: "off", label: "Off" },
                                ]}
                                onChange={(level) =>
                                    void setRuleLevel(rule, level)
                                }
                                ariaLabel={rule.label}
                            />
                        </View>
                    ))}
                </View>
            </View>

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1">
                    {t("notificationSettings.keywordHighlights")}
                </Text>
                <Text className="text-xs text-discord-textMuted mb-3">
                    {t("notificationSettings.getNotifiedWhenAMessageContains")}{" "}
                    <Text className="text-xs text-discord-textMuted font-mono">
                        *
                    </Text>{" "}
                    {t("notificationSettings.and")}{" "}
                    <Text className="text-xs text-discord-textMuted font-mono">
                        ?
                    </Text>{" "}
                    {t("notificationSettings.areWildcards")}
                </Text>
                {/* Zami: the <form>'s submit is the keyboard's return key
                    (onSubmitEditing) or the Add button. */}
                <View className="flex-row items-center gap-2 mb-2">
                    <TextInput
                        value={newKeyword}
                        onChangeText={setNewKeyword}
                        onSubmitEditing={() => void addKeyword()}
                        returnKeyType="done"
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder={t("notificationSettings.addAKeyword")}
                        placeholderTextColorClassName="accent-discord-textMuted"
                        accessibilityLabel={t(
                            "notificationSettings.newKeyword",
                        )}
                        className="flex-1 min-w-0 px-3 py-1.5 rounded text-sm bg-discord-backgroundTertiary text-discord-textPrimary placeholder:text-discord-textMuted focus:outline-none focus:ring-1 focus:ring-discord-accent"
                    />
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void addKeyword()}
                        disabled={addPending}
                        className="px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-50"
                    >
                        <Text className="text-sm font-semibold text-white">
                            {t("common.add")}
                        </Text>
                    </Pressable>
                </View>
                {keywordError ? (
                    <Text className="text-sm text-discord-danger mb-2">
                        {keywordError}
                    </Text>
                ) : null}
                {keywordRules.length === 0 ? (
                    <Text className="text-sm text-discord-textMuted italic">
                        {t("notificationSettings.noKeywordRulesYet")}
                    </Text>
                ) : (
                    <View className="gap-1">
                        {keywordRules.map((rule) => (
                            // Zami: a phone is too narrow for the pattern, the
                            // three behaviors, the switch and Delete in one row,
                            // so below `sm` the pattern takes its own line.
                            <View
                                key={rule.ruleId}
                                className="flex-row flex-wrap items-center gap-3 py-2 border-b border-discord-divider"
                            >
                                <Text
                                    numberOfLines={1}
                                    className="w-full sm:w-auto sm:flex-1 min-w-0 text-sm text-discord-textPrimary font-mono"
                                >
                                    {rule.pattern}
                                </Text>
                                <OptionSelector
                                    value={rule.behavior}
                                    options={behaviorOptions}
                                    onChange={(b) =>
                                        void changeBehavior(rule.ruleId, b)
                                    }
                                    ariaLabel={t(
                                        "notificationSettings.behaviorFor",
                                        { pattern: rule.pattern },
                                    )}
                                />
                                <ToggleSwitch
                                    checked={rule.enabled}
                                    onChange={(v) =>
                                        void toggleEnabled(rule.ruleId, v)
                                    }
                                    label={t("notificationSettings.enable2", {
                                        pattern: rule.pattern,
                                    })}
                                />
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() =>
                                        void removeKeyword(rule.ruleId)
                                    }
                                    disabled={rowPending === rule.ruleId}
                                    className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                                >
                                    <Text className="text-xs font-semibold text-discord-textPrimary">
                                        {t("common.delete")}
                                    </Text>
                                </Pressable>
                            </View>
                        ))}
                    </View>
                )}
            </View>
        </View>
    );
}
