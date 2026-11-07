import { openLink } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import {
    deleteOwnDevice,
    getOwnDeviceId,
    getOwnDevices,
    getOwnUserId,
    getAccountManagementUrl,
    renameDevice,
} from "$lib/matrix/client";
import { isOAuthSession } from "$lib/stores/auth.svelte";
import {
    describeUserAgent,
    formatLastSeen,
    sortDevices,
    type DeviceInfo,
} from "$lib/utils/deviceSessions";
import {
    isCryptoAvailable,
    getOwnDeviceKeyInfo,
    getDeviceTrust,
    applyVerifiedOnlySending,
    applyDeviceIsolation,
} from "$lib/matrix/crypto";
import { deviceTrustBadge } from "$lib/utils/verification";
import {
    verificationState,
    verifyOwnDevice,
    verifyWithAnotherDevice,
} from "$lib/stores/verification.svelte";
import {
    verificationStatusState,
    refreshVerificationStatus,
} from "$lib/stores/verificationStatus.svelte";
import { securityState } from "$lib/stores/security.svelte";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import {
    settingsState,
    setEncryptNewDms,
    setSendToVerifiedOnly,
    setExcludeInsecureDevices,
} from "$lib/stores/settings.svelte";

// Zami: a badge is a padded, rounded box, which a nested Text can't be: its
// background and padding go on a View, its text classes on the Text inside.
function badgeBox(tone: string | undefined): string {
    return tone === "verified"
        ? "bg-discord-online/20"
        : tone === "warning"
          ? "bg-discord-warning/20"
          : "bg-discord-messageHover";
}

function badgeText(tone: string | undefined): string {
    return tone === "verified"
        ? "text-discord-online"
        : tone === "warning"
          ? "text-discord-warning"
          : "text-discord-textMuted";
}

function Badge({
    box,
    text,
    label,
}: {
    box: string;
    text: string;
    label: string;
}) {
    return (
        <View className={`ms-1.5 px-1.5 py-0.5 rounded ${box}`}>
            <Text className={`text-[10px] font-semibold uppercase ${text}`}>
                {label}
            </Text>
        </View>
    );
}

const passwordInputClass =
    "flex-1 bg-discord-backgroundDark text-discord-textPrimary text-sm rounded px-3 py-1.5 outline-none";

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead.
export default function SessionSettings() {
    const [devices, setDevices] = useState<DeviceInfo[]>([]);
    // Zami: what `devices` was last set to, for `loadTrust`, which upstream runs
    // right after `load()` (and from an effect) and which must see the new list.
    const devicesRef = useRef<DeviceInfo[]>([]);
    const [loaded, setLoaded] = useState(false);
    const attemptedInitialLoad = useRef(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [fetchedAt, setFetchedAt] = useState(0);
    const [currentId, setCurrentId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [renameSaving, setRenameSaving] = useState(false);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [passwordId, setPasswordId] = useState<string | null>(null);
    const [password, setPassword] = useState("");
    const [signOutBusy, setSignOutBusy] = useState(false);
    // Native OAuth sessions: signing another session out is the provider's
    // job (a homeserver DELETE /devices has no way to authorise it).
    const [oauthSession] = useState(isOAuthSession);
    const [sessionsUrl, setSessionsUrl] = useState<string | null>(null);
    useEffect(() => {
        if (oauthSession)
            void getAccountManagementUrl("org.matrix.sessions_list").then((u) =>
                setSessionsUrl(u),
            );
    }, [oauthSession]);

    // Read-only E2EE status for this device (Layer 0). Useful for live
    // cross-client verification; carries no actions yet.
    const [cryptoActive, setCryptoActive] = useState(false);
    const [deviceEd25519, setDeviceEd25519] = useState<string | null>(null);

    // Per-device trust (Layer 1): deviceId → reduced verification status, for
    // the badge + Verify button. Reloaded when a verification completes.
    const [trust, setTrust] = useState<
        Record<string, { isVerified: boolean; signedByOwner?: boolean } | null>
    >({});
    const [verifyError, setVerifyError] = useState("");

    const verificationView = useRune(() => verificationStatusState.view);
    const encryptNewDms = useRune(() => settingsState.encryptNewDms);
    const excludeInsecureDevices = useRune(
        () => settingsState.excludeInsecureDevices,
    );
    const sendToVerifiedOnly = useRune(() => settingsState.sendToVerifiedOnly);

    const current =
        devices.find((device) => device.deviceId === currentId) ?? null;
    const others = devices.filter((device) => device.deviceId !== currentId);

    async function load() {
        setLoading(true);
        setError("");
        try {
            const ownId = getOwnDeviceId();
            setCurrentId(ownId);
            const next = sortDevices(await getOwnDevices(), ownId);
            devicesRef.current = next;
            setDevices(next);
            setFetchedAt(Date.now());
            setLoaded(true);
        } catch (loadError) {
            setError(
                (loadError as Error)?.message ??
                    t("sessionSettings.failedToLoadSessions"),
            );
        } finally {
            setLoading(false);
        }
    }

    function startRename(device: DeviceInfo) {
        setRenamingId(device.deviceId);
        setRenameValue(device.displayName ?? "");
    }

    async function saveRename() {
        if (!renamingId || renameSaving) return;
        setRenameSaving(true);
        setError("");
        try {
            await renameDevice(renamingId, renameValue.trim());
            setRenamingId(null);
            await load();
        } catch (renameError) {
            setError(
                (renameError as Error)?.message ??
                    t("sessionSettings.failedToRenameSession"),
            );
        } finally {
            setRenameSaving(false);
        }
    }

    function requestSignOut(deviceId: string) {
        setError("");
        if (confirmId !== deviceId) {
            setConfirmId(deviceId);
            setPasswordId(null);
            return;
        }
        void performSignOut(deviceId);
    }

    async function performSignOut(deviceId: string, authPassword?: string) {
        setSignOutBusy(true);
        setError("");
        try {
            const result = await deleteOwnDevice(deviceId, authPassword);
            if (result === "password-required") {
                setPasswordId(deviceId);
                setPassword("");
            } else {
                setConfirmId(null);
                setPasswordId(null);
                setPassword("");
                await load();
            }
        } catch (signOutError) {
            setError(
                (signOutError as Error)?.message ??
                    t("sessionSettings.failedToSignOutSession"),
            );
        } finally {
            setSignOutBusy(false);
        }
    }

    function cancelSignOut() {
        setConfirmId(null);
        setPasswordId(null);
        setPassword("");
        setError("");
    }

    async function loadCryptoStatus() {
        setCryptoActive(isCryptoAvailable());
        const keys = await getOwnDeviceKeyInfo();
        setDeviceEd25519(keys?.ed25519 ?? null);
    }

    function toggleVerifiedOnly(value: boolean) {
        setSendToVerifiedOnly(value);
        applyVerifiedOnlySending(value);
    }

    function toggleExcludeInsecure(value: boolean) {
        setExcludeInsecureDevices(value);
        applyDeviceIsolation(value);
    }

    async function loadTrust() {
        if (!isCryptoAvailable()) return;
        const userId = getOwnUserId();
        if (!userId) return;
        const entries = await Promise.all(
            devicesRef.current.map(
                async (device) =>
                    [
                        device.deviceId,
                        await getDeviceTrust(userId, device.deviceId),
                    ] as const,
            ),
        );
        setTrust(Object.fromEntries(entries));
    }

    async function startVerify(deviceId: string) {
        setVerifyError("");
        try {
            await verifyOwnDevice(deviceId);
        } catch (e) {
            setVerifyError(
                e instanceof Error
                    ? e.message
                    : t("sessionSettings.couldNotStartVerification"),
            );
        }
    }

    async function startVerifyWithAnotherDevice() {
        setVerifyError("");
        try {
            await verifyWithAnotherDevice();
        } catch (e) {
            setVerifyError(
                e instanceof Error
                    ? e.message
                    : t("verification.couldNotSendVerificationRequest"),
            );
        }
    }

    useEffect(() => {
        if (!attemptedInitialLoad.current) {
            attemptedInitialLoad.current = true;
            void load().then(loadTrust);
            void loadCryptoStatus();
        }
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as upstream's guarded effect.
    }, []);

    // Refresh trust badges when a verification completes (tick bumps on Done).
    const tick = useRune(() => verificationState.verificationTick);
    const securityTick = useRune(() => securityState.securityTick);
    const lastSeenTick = useRef(0);
    const lastSeenSecurityTick = useRef(0);
    useEffect(() => {
        if (
            (tick !== lastSeenTick.current ||
                securityTick !== lastSeenSecurityTick.current) &&
            loaded
        ) {
            lastSeenTick.current = tick;
            lastSeenSecurityTick.current = securityTick;
            void loadTrust();
            void refreshVerificationStatus();
        }
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- the ticks and `loaded` are what upstream's effect reads; `loadTrust` reads the devices ref.
    }, [tick, securityTick, loaded]);

    function deviceRow(device: DeviceInfo, isCurrent: boolean): ReactNode {
        const details = [
            describeUserAgent(device.lastSeenUserAgent),
            `Last seen ${formatLastSeen(device.lastSeenTs, fetchedAt)}`,
            device.lastSeenIp,
        ]
            .filter(Boolean)
            .join(" · ");
        const badge = cryptoActive
            ? isCurrent
                ? verificationView
                : deviceTrustBadge(trust[device.deviceId] ?? null, {
                      ownDevice: true,
                  })
            : null;
        return (
            <View
                key={device.deviceId}
                className="rounded bg-discord-backgroundTertiary px-4 py-3 gap-3"
            >
                <View className="flex-row items-start justify-between gap-3">
                    <View className="min-w-0 flex-1">
                        {renamingId === device.deviceId ? (
                            <View className="flex-row gap-2">
                                <TextInput
                                    value={renameValue}
                                    onChangeText={setRenameValue}
                                    maxLength={100}
                                    placeholder={t(
                                        "sessionSettings.sessionName",
                                    )}
                                    placeholderTextColorClassName="accent-discord-textMuted"
                                    accessibilityLabel={t(
                                        "sessionSettings.sessionName",
                                    )}
                                    returnKeyType="done"
                                    onSubmitEditing={() => {
                                        void saveRename();
                                    }}
                                    className="flex-1 bg-discord-backgroundDark text-discord-textPrimary text-sm rounded px-2 py-1 outline-none"
                                />
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        disabled: renameSaving,
                                    }}
                                    onPress={() => {
                                        void saveRename();
                                    }}
                                    disabled={renameSaving}
                                    className="px-2.5 py-1 bg-discord-accent rounded justify-center"
                                >
                                    <Text className="text-white text-xs">
                                        {renameSaving
                                            ? t("common.saving")
                                            : t("common.save")}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => setRenamingId(null)}
                                    className="px-2.5 py-1 bg-discord-messageHover rounded justify-center"
                                >
                                    <Text className="text-discord-textPrimary text-xs">
                                        {t("common.cancel")}
                                    </Text>
                                </Pressable>
                            </View>
                        ) : (
                            // Zami: the name and its badges are a row (the
                            // badges are boxes, not runs of text); the name
                            // truncates instead of the whole line.
                            <View className="flex-row items-center">
                                <Text
                                    numberOfLines={1}
                                    className="shrink text-sm font-medium text-discord-textPrimary"
                                >
                                    {device.displayName || device.deviceId}
                                </Text>
                                {isCurrent ? (
                                    <Badge
                                        box="bg-discord-accent/20"
                                        text="text-discord-accent"
                                        label={t("sessionSettings.current")}
                                    />
                                ) : null}
                                {isCurrent && cryptoActive ? (
                                    <Badge
                                        box={badgeBox(badge?.tone)}
                                        text={badgeText(badge?.tone)}
                                        label={
                                            badge?.label ?? t("common.checking")
                                        }
                                    />
                                ) : !isCurrent && badge ? (
                                    <Badge
                                        box={badgeBox(badge.tone)}
                                        text={badgeText(badge.tone)}
                                        label={badge.label}
                                    />
                                ) : null}
                            </View>
                        )}
                        <Text
                            selectable
                            className="text-xs text-discord-textMuted font-mono mt-0.5"
                        >
                            {device.deviceId}
                        </Text>
                        <Text className="text-xs text-discord-textMuted mt-1">
                            {details}
                        </Text>
                    </View>
                    <View className="flex-row gap-2 flex-shrink-0">
                        {/* This session is unverified: ask the others to verify it.
                            It can't tell which siblings are trusted, so it broadcasts
                            and lets any verified one answer. Needs a sibling. */}
                        {isCurrent &&
                        cryptoActive &&
                        verificationView?.kind === "unverified" &&
                        others.length > 0 ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => {
                                    void startVerifyWithAnotherDevice();
                                }}
                                className="px-2.5 py-1 bg-discord-accent/20 rounded"
                            >
                                <Text className="text-discord-accent text-xs">
                                    {t("verification.verifyWithAnotherDevice")}
                                </Text>
                            </Pressable>
                        ) : null}
                        {!isCurrent && badge && badge.tone !== "verified" ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => {
                                    void startVerify(device.deviceId);
                                }}
                                className="px-2.5 py-1 bg-discord-accent/20 rounded"
                            >
                                <Text className="text-discord-accent text-xs">
                                    {t("common.verify")}
                                </Text>
                            </Pressable>
                        ) : null}
                        {renamingId !== device.deviceId ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => startRename(device)}
                                className="px-2.5 py-1 bg-discord-messageHover rounded"
                            >
                                <Text className="text-discord-textPrimary text-xs">
                                    {t("sessionSettings.rename")}
                                </Text>
                            </Pressable>
                        ) : null}
                        {!isCurrent && oauthSession ? (
                            sessionsUrl ? (
                                <Pressable
                                    accessibilityRole="link"
                                    onPress={() => openLink(sessionsUrl)}
                                    className="px-2.5 py-1 bg-discord-messageHover rounded"
                                >
                                    <Text className="text-discord-textPrimary text-xs">
                                        {t("sessionSettings.manageAtProvider")}
                                    </Text>
                                </Pressable>
                            ) : null
                        ) : !isCurrent && passwordId !== device.deviceId ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ disabled: signOutBusy }}
                                onPress={() => requestSignOut(device.deviceId)}
                                disabled={signOutBusy}
                                className={`px-2.5 py-1 rounded ${
                                    confirmId === device.deviceId
                                        ? "bg-discord-danger"
                                        : "bg-discord-messageHover"
                                }`}
                            >
                                <Text
                                    className={`text-xs ${
                                        confirmId === device.deviceId
                                            ? "text-white"
                                            : "text-discord-danger"
                                    }`}
                                >
                                    {confirmId === device.deviceId
                                        ? t("sessionSettings.signOut")
                                        : t("sessionSettings.signOut2")}
                                </Text>
                            </Pressable>
                        ) : null}
                    </View>
                </View>
                {passwordId === device.deviceId ? (
                    <View className="pt-3 border-t border-discord-divider gap-2">
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "sessionSettings.confirmYourAccountPasswordToSign",
                            )}
                        </Text>
                        <View className="flex-row gap-2">
                            <TextInput
                                secureTextEntry
                                value={password}
                                onChangeText={setPassword}
                                autoComplete="current-password"
                                textContentType="password"
                                autoCapitalize="none"
                                autoCorrect={false}
                                placeholder={t(
                                    "sessionSettings.accountPassword",
                                )}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                accessibilityLabel={t(
                                    "sessionSettings.accountPassword",
                                )}
                                returnKeyType="done"
                                onSubmitEditing={() => {
                                    if (password)
                                        void performSignOut(
                                            device.deviceId,
                                            password,
                                        );
                                }}
                                className={passwordInputClass}
                            />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{
                                    disabled: signOutBusy || !password,
                                }}
                                onPress={() => {
                                    void performSignOut(
                                        device.deviceId,
                                        password,
                                    );
                                }}
                                disabled={signOutBusy || !password}
                                className="px-3 py-1.5 bg-discord-danger rounded justify-center disabled:opacity-50"
                            >
                                <Text className="text-white text-xs">
                                    {signOutBusy
                                        ? t("sessionSettings.signingOut")
                                        : t("sessionSettings.signOut2")}
                                </Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                onPress={cancelSignOut}
                                className="px-3 py-1.5 bg-discord-messageHover rounded justify-center"
                            >
                                <Text className="text-discord-textPrimary text-xs">
                                    {t("common.cancel")}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                ) : null}
            </View>
        );
    }

    return (
        <View className="gap-6">
            <View className="rounded bg-discord-backgroundTertiary px-4 py-3 gap-1.5">
                <View className="flex-row items-center gap-2">
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                        {t("sessionSettings.encryption")}
                    </Text>
                    <View
                        className={`px-1.5 py-0.5 rounded ${
                            cryptoActive
                                ? "bg-discord-accent/20"
                                : "bg-discord-messageHover"
                        }`}
                    >
                        <Text
                            className={`text-[10px] font-semibold uppercase ${
                                cryptoActive
                                    ? "text-discord-accent"
                                    : "text-discord-textMuted"
                            }`}
                        >
                            {cryptoActive
                                ? t("sessionSettings.active")
                                : t("sessionSettings.unavailable")}
                        </Text>
                    </View>
                </View>
                {deviceEd25519 ? (
                    <Text selectable className="text-xs text-discord-textMuted">
                        {t("sessionSettings.thisDeviceSKey")}{" "}
                        <Text className="text-xs font-mono text-discord-textPrimary">
                            {deviceEd25519}
                        </Text>
                    </Text>
                ) : cryptoActive ? (
                    <Text className="text-xs text-discord-textMuted">
                        {t("sessionSettings.loadingDeviceKey")}
                    </Text>
                ) : (
                    <Text className="text-xs text-discord-textMuted">
                        {t("sessionSettings.endToEndEncryptionCouldNot")}
                    </Text>
                )}
                {cryptoActive ? (
                    <>
                        <View className="flex-row items-center gap-3 pt-2 mt-1 border-t border-discord-divider">
                            <View className="flex-1 min-w-0">
                                <Text className="text-sm text-discord-textPrimary">
                                    {t(
                                        "sessionSettings.encryptNewDirectMessages",
                                    )}
                                </Text>
                                <Text className="text-xs text-discord-textMuted">
                                    {t(
                                        "sessionSettings.newDmsYouStartAreEncrypted",
                                    )}
                                </Text>
                            </View>
                            <ToggleSwitch
                                checked={encryptNewDms}
                                onChange={setEncryptNewDms}
                                label={t(
                                    "sessionSettings.encryptNewDirectMessages",
                                )}
                            />
                        </View>
                        <View className="flex-row items-center gap-3 pt-2 mt-1 border-t border-discord-divider">
                            <View className="flex-1 min-w-0">
                                <Text className="text-sm text-discord-textPrimary">
                                    {t(
                                        "sessionSettings.excludeInsecureDevices",
                                    )}
                                </Text>
                                <Text className="text-xs text-discord-textMuted">
                                    {t(
                                        "sessionSettings.excludeInsecureDevicesHelp",
                                    )}
                                </Text>
                            </View>
                            <ToggleSwitch
                                checked={excludeInsecureDevices}
                                onChange={toggleExcludeInsecure}
                                label={t(
                                    "sessionSettings.excludeInsecureDevices",
                                )}
                            />
                        </View>
                        <View className="flex-row items-center gap-3 pt-2 mt-1 border-t border-discord-divider">
                            <View className="flex-1 min-w-0">
                                <Text className="text-sm text-discord-textPrimary">
                                    {t(
                                        "sessionSettings.onlySendToVerifiedDevices",
                                    )}
                                </Text>
                                <Text className="text-xs text-discord-textMuted">
                                    {t(
                                        "sessionSettings.refuseToEncryptMessagesForSessions",
                                    )}
                                </Text>
                            </View>
                            <ToggleSwitch
                                checked={sendToVerifiedOnly}
                                onChange={toggleVerifiedOnly}
                                label={t(
                                    "sessionSettings.onlySendToVerifiedDevices",
                                )}
                            />
                        </View>
                    </>
                ) : null}
            </View>
            <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-xs text-discord-textMuted">
                    {t("sessionSettings.devicesCurrentlySignedInToThis")}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: loading }}
                    onPress={() => {
                        void load();
                    }}
                    disabled={loading}
                    className="px-3 py-1.5 rounded bg-discord-backgroundTertiary disabled:opacity-50"
                >
                    <Text className="text-xs text-discord-textPrimary">
                        {loading
                            ? t("sessionSettings.refreshing")
                            : t("sessionSettings.refresh")}
                    </Text>
                </Pressable>
            </View>
            {error ? (
                <Text className="text-sm text-discord-danger">{error}</Text>
            ) : null}
            {verifyError ? (
                <Text className="text-sm text-discord-danger">
                    {verifyError}
                </Text>
            ) : null}
            {current ? (
                deviceRow(current, true)
            ) : loading ? (
                <Text className="text-sm text-discord-textMuted">
                    {t("sessionSettings.loadingSessions")}
                </Text>
            ) : null}
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("sessionSettings.otherSessions", {
                        value: loaded ? `(${others.length})` : "",
                    })}
                </Text>
                {loaded && others.length === 0 ? (
                    <Text className="text-sm text-discord-textMuted">
                        {t("sessionSettings.noOtherSessionsYouReOnly")}
                    </Text>
                ) : (
                    <View className="gap-2">
                        {others.map((device) => deviceRow(device, false))}
                    </View>
                )}
            </View>
        </View>
    );
}
