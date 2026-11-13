import {
    Checkbox,
    Image,
    mediaSource,
    openLink,
    pickedFile,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import OptionSelector from "$lib/components/ui/OptionSelector.svelte";
import ProfileFieldsEditor from "$lib/components/settings/ProfileFieldsEditor.svelte";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import LinkDeviceDialog from "$lib/components/settings/LinkDeviceDialog.svelte";
import {
    changeAccountPassword,
    deactivateOwnAccount,
    fetchOwnProfile,
    getOwnAvatarMxc,
    getOwnDisplayName,
    getAccountManagementUrl,
    getOwnDevices,
    getOwnThreePids,
    getServerCapabilities,
    mxcToHttp,
    setOwnAvatarMxc,
    setOwnDisplayName,
    uploadContent,
    type ThreePid,
} from "$lib/matrix/client";
import {
    isQrLoginAvailable,
    serverAdvertisesQrLogin,
} from "$lib/matrix/qrLogin";
import { getBackupStatus } from "$lib/matrix/crypto";
import { getClient } from "$lib/matrix/runtime";
import { auth, isOAuthSession } from "$lib/stores/auth.svelte";
import {
    changeOwnPresence,
    changeDoNotDisturb,
} from "$lib/stores/presence.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import {
    deactivationConfirmed,
    validatePasswordChange,
} from "$lib/utils/accountSecurity";
import { OWN_PRESENCE_OPTIONS, type PresenceState } from "$lib/utils/presence";
import {
    serverSupports,
    type Capabilities,
} from "$lib/utils/serverCapabilities";
import { syncStateLabel } from "$lib/utils/syncStatus";
import { shownHomeserver, shownUserId } from "$lib/utils/streamerAlias";

interface Props {
    onLogout: () => void;
}

// Zami: <input type="file" accept="image/*"> → expo-image-picker. Resolves to the
// picked image as a File, or null when cancelled.
async function pickAvatar(): Promise<File | null> {
    const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return null;
    return pickedFile(asset);
}

const inputClass =
    "w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none";

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. Text classes sit on each Text. `<a target="_blank">`
// links are buttons that open the page with `openLink`.
export default function AccountSettings({ onLogout }: Props) {
    const userId = useRune(() => auth.userId);
    const homeserverUrl = useRune(() => auth.homeserverUrl);
    const syncState = useRune(() => auth.syncState);
    const ownPresence = useRune(() => settingsState.ownPresence);
    const doNotDisturb = useRune(() => settingsState.doNotDisturb);
    const streamerMode = useRune(() => settingsState.streamerMode);

    const [displayName, setDisplayName] = useState(
        () => getOwnDisplayName() ?? "",
    );
    const [avatarMxc, setAvatarMxc] = useState<string | null>(() =>
        getOwnAvatarMxc(),
    );
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [savingName, setSavingName] = useState(false);
    const [profileError, setProfileError] = useState("");
    const [profileSaved, setProfileSaved] = useState(false);
    const [presenceError, setPresenceError] = useState("");
    const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
    // Native OAuth sessions: the provider, not the homeserver, owns the
    // password, sessions and deactivation, so those link to its account page.
    const [oauthSession] = useState(() => isOAuthSession());
    const [accountUrl, setAccountUrl] = useState<string | null>(null);
    const [deactivateUrl, setDeactivateUrl] = useState<string | null>(null);
    const [threePids, setThreePids] = useState<ThreePid[]>([]);
    const [securityLoaded, setSecurityLoaded] = useState(false);

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [logoutOthers, setLogoutOthers] = useState(true);
    const [passwordBusy, setPasswordBusy] = useState(false);
    const [passwordError, setPasswordError] = useState("");
    const [passwordChanged, setPasswordChanged] = useState(false);

    // Sign in a new device by scanning its QR code. Needs a native OAuth
    // session whose provider grants by device code.
    const [canLinkDevice, setCanLinkDevice] = useState(false);
    const [linkMode, setLinkMode] = useState<"scan" | "code" | "show" | null>(
        null,
    );
    // Showing a code for the new device to scan needs the full QR protocol.
    const [canShowQr, setCanShowQr] = useState(false);
    useEffect(() => {
        if (oauthSession) {
            const client = getClient();
            void client
                ?.getAuthMetadata()
                .then(async (meta) => {
                    const available = isQrLoginAvailable(meta);
                    setCanLinkDevice(available);
                    if (available)
                        setCanShowQr(
                            await serverAdvertisesQrLogin(client.baseUrl),
                        );
                })
                .catch(() => {});
        }
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, as upstream's script body.
    }, []);

    // Signing out the only session loses this device's encryption keys; ask
    // first. A failed device lookup falls through to a plain logout.
    const [lastDeviceWarning, setLastDeviceWarning] = useState(false);
    const [lastDeviceBackedUp, setLastDeviceBackedUp] = useState(false);
    const [checkingDevices, setCheckingDevices] = useState(false);

    async function requestLogout(): Promise<void> {
        setCheckingDevices(true);
        try {
            const devices = await getOwnDevices();
            if (devices.length > 1) {
                onLogout();
                return;
            }
            const backup = await getBackupStatus();
            setLastDeviceBackedUp(
                backup.read === "ok" && backup.exists && backup.trusted,
            );
            setLastDeviceWarning(true);
        } catch {
            onLogout();
        } finally {
            setCheckingDevices(false);
        }
    }

    const [deactivateOpen, setDeactivateOpen] = useState(false);
    const [deactivateTyped, setDeactivateTyped] = useState("");
    const [deactivatePassword, setDeactivatePassword] = useState("");
    const [deactivateErase, setDeactivateErase] = useState(false);
    const [deactivateBusy, setDeactivateBusy] = useState(false);
    const [deactivateError, setDeactivateError] = useState("");

    const avatarUrl = mxcToHttp(avatarMxc);
    const nameChanged = displayName.trim() !== (getOwnDisplayName() ?? "");
    const syncStatus = syncStateLabel(syncState);
    const selectedPresence = OWN_PRESENCE_OPTIONS.find(
        (option) => option.value === ownPresence,
    );
    const canChangePassword = serverSupports("changePassword", capabilities);
    const canManageThreePids = serverSupports("change3pid", capabilities);
    const passwordProblem = validatePasswordChange({
        current: currentPassword,
        next: newPassword,
        confirm: confirmPassword,
    });
    const deactivateArmed =
        deactivationConfirmed(deactivateTyped, userId) &&
        deactivatePassword.length > 0;

    async function load() {
        if (oauthSession) {
            void getAccountManagementUrl().then((u) => setAccountUrl(u));
            void getAccountManagementUrl("org.matrix.account_deactivate").then(
                (u) => setDeactivateUrl(u),
            );
        }
        try {
            const profile = await fetchOwnProfile();
            setDisplayName(profile.displayName ?? "");
            setAvatarMxc(profile.avatarMxc);
        } catch {
            // The local SDK profile remains usable while offline.
        }
        try {
            setCapabilities((await getServerCapabilities()) as Capabilities);
            setThreePids(await getOwnThreePids().catch(() => []));
        } catch {
            setCapabilities(null);
            setThreePids([]);
        } finally {
            setSecurityLoaded(true);
        }
    }

    function flashSaved() {
        setProfileSaved(true);
        setTimeout(() => setProfileSaved(false), 2000);
    }

    // Zami: the input's change event → the picked image (null when cancelled).
    async function selectAvatar(file: File | null) {
        if (!file) return;
        setAvatarUploading(true);
        setProfileError("");
        try {
            const mxc = await uploadContent(file);
            await setOwnAvatarMxc(mxc);
            setAvatarMxc(mxc);
            flashSaved();
        } catch (error) {
            setProfileError(
                (error as Error)?.message ??
                    t("accountSettings.avatarUploadFailed"),
            );
        } finally {
            setAvatarUploading(false);
        }
    }

    async function removeAvatar() {
        setAvatarUploading(true);
        setProfileError("");
        try {
            await setOwnAvatarMxc("");
            setAvatarMxc(null);
            flashSaved();
        } catch (error) {
            setProfileError(
                (error as Error)?.message ??
                    t("accountSettings.failedToRemoveAvatar"),
            );
        } finally {
            setAvatarUploading(false);
        }
    }

    async function saveName() {
        setSavingName(true);
        setProfileError("");
        try {
            await setOwnDisplayName(displayName.trim());
            flashSaved();
        } catch (error) {
            setProfileError(
                (error as Error)?.message ??
                    t("accountSettings.failedToSaveName"),
            );
        } finally {
            setSavingName(false);
        }
    }

    async function setPresence(value: PresenceState) {
        setPresenceError("");
        try {
            await changeOwnPresence(value);
        } catch (error) {
            setPresenceError(
                (error as Error)?.message ??
                    t("accountSettings.couldNotSetPresence"),
            );
        }
    }

    async function toggleDoNotDisturb() {
        setPresenceError("");
        try {
            await changeDoNotDisturb(!settingsState.doNotDisturb);
        } catch (error) {
            setPresenceError(
                (error as Error)?.message ??
                    t("accountSettings.couldNotSetPresence"),
            );
        }
    }

    async function changePassword() {
        if (passwordProblem || passwordBusy) return;
        setPasswordBusy(true);
        setPasswordError("");
        setPasswordChanged(false);
        try {
            await changeAccountPassword(
                currentPassword,
                newPassword,
                logoutOthers,
            );
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setPasswordChanged(true);
        } catch (error) {
            setPasswordError(
                (error as Error)?.message ??
                    t("accountSettings.failedToChangePassword"),
            );
        } finally {
            setPasswordBusy(false);
        }
    }

    function cancelDeactivation() {
        setDeactivateOpen(false);
        setDeactivateTyped("");
        setDeactivatePassword("");
        setDeactivateErase(false);
        setDeactivateError("");
    }

    async function deactivate() {
        if (!deactivateArmed || deactivateBusy) return;
        setDeactivateBusy(true);
        setDeactivateError("");
        try {
            await deactivateOwnAccount(deactivatePassword, deactivateErase);
            onLogout();
        } catch (error) {
            setDeactivateError(
                (error as Error)?.message ??
                    t("accountSettings.failedToDeactivateAccount"),
            );
            setDeactivateBusy(false);
        }
    }

    useEffect(() => {
        void load();
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as upstream's effect.
    }, []);

    return (
        <>
            <View className="gap-6">
                {canLinkDevice ? (
                    <View className="gap-3">
                        <Text
                            accessibilityRole="header"
                            className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
                        >
                            {t("qrLogin.loginSectionTitle")}
                        </Text>
                        <Text className="text-sm text-discord-textMuted">
                            {t("qrLogin.loginSectionIntro")}
                        </Text>
                        <View className="flex-row flex-wrap gap-2">
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => setLinkMode("scan")}
                                className="px-3 py-2 rounded bg-discord-accent hover:bg-discord-accentHover"
                            >
                                <Text className="text-sm text-white font-medium">
                                    {t("qrLogin.linkButton")}
                                </Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => setLinkMode("code")}
                                className="px-3 py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover"
                            >
                                <Text className="text-sm text-discord-textPrimary font-medium">
                                    {t("qrLogin.codeButton")}
                                </Text>
                            </Pressable>
                            {canShowQr ? (
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => setLinkMode("show")}
                                    className="px-3 py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover"
                                >
                                    <Text className="text-sm text-discord-textPrimary font-medium">
                                        {t("qrLogin.showButton")}
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>
                    </View>
                ) : null}
                <View>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                        {t("accountSettings.profile")}
                    </Text>
                    <View className="flex-row items-center gap-4">
                        {avatarUrl ? (
                            <Image
                                source={mediaSource(avatarUrl)}
                                accessibilityLabel={t(
                                    "accountSettings.yourAvatar",
                                )}
                                contentFit="cover"
                                className="w-20 h-20 rounded-full flex-shrink-0"
                            />
                        ) : (
                            <View className="w-20 h-20 rounded-full bg-discord-accent/80 flex-row items-center justify-center flex-shrink-0">
                                <Text className="text-white text-2xl font-semibold">
                                    {(displayName || userId || "?")
                                        .replace(/^@/, "")
                                        .charAt(0)
                                        .toUpperCase()}
                                </Text>
                            </View>
                        )}
                        <View className="flex-row gap-2">
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{
                                    disabled: avatarUploading,
                                }}
                                onPress={() => {
                                    void pickAvatar().then(
                                        selectAvatar,
                                        (error: unknown) =>
                                            setProfileError(
                                                (error as Error)?.message ??
                                                    t(
                                                        "accountSettings.avatarUploadFailed",
                                                    ),
                                            ),
                                    );
                                }}
                                disabled={avatarUploading}
                                className={`px-3 py-1.5 bg-discord-accent rounded ${
                                    avatarUploading ? "opacity-50" : ""
                                }`}
                            >
                                <Text className="text-white text-sm">
                                    {avatarUploading
                                        ? t("common.uploading")
                                        : t("accountSettings.changeAvatar")}
                                </Text>
                            </Pressable>
                            {avatarMxc ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        disabled: avatarUploading,
                                    }}
                                    onPress={() => void removeAvatar()}
                                    disabled={avatarUploading}
                                    className="px-3 py-1.5 bg-discord-backgroundTertiary rounded"
                                >
                                    <Text className="text-discord-textPrimary text-sm">
                                        {t("common.remove")}
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>
                    </View>
                    <View className="mt-4 flex-row gap-2">
                        <TextInput
                            value={displayName}
                            onChangeText={setDisplayName}
                            maxLength={255}
                            placeholder={t("accountSettings.yourDisplayName")}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            accessibilityLabel={t(
                                "accountSettings.yourDisplayName",
                            )}
                            className="flex-1 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none"
                        />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{
                                disabled: savingName || !nameChanged,
                            }}
                            onPress={() => void saveName()}
                            disabled={savingName || !nameChanged}
                            className={`justify-center px-4 py-2 bg-discord-accent rounded ${
                                savingName || !nameChanged ? "opacity-50" : ""
                            }`}
                        >
                            <Text className="text-white text-sm">
                                {savingName
                                    ? t("common.saving")
                                    : t("common.save")}
                            </Text>
                        </Pressable>
                    </View>
                    {profileError ? (
                        <Text className="mt-2 text-xs text-discord-danger">
                            {profileError}
                        </Text>
                    ) : profileSaved ? (
                        <Text className="mt-2 text-xs text-discord-textPositive">
                            {t("accountSettings.saved")}
                        </Text>
                    ) : null}
                </View>

                <ProfileFieldsEditor
                    capabilities={capabilities}
                    displayName={displayName}
                />

                <View className="gap-2">
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                        {t("accountSettings.account")}
                    </Text>
                    <View className="flex-row justify-between gap-3 py-2 border-b border-discord-divider">
                        <Text className="text-sm text-discord-textMuted">
                            {t("accountSettings.userId")}
                        </Text>
                        {/* Zami: not ported: streamer-hide (streamer mode's blur) */}
                        <Text className="flex-shrink text-right text-discord-textPrimary font-mono text-xs">
                            {userId ? shownUserId(userId, streamerMode) : ""}
                        </Text>
                    </View>
                    <View className="flex-row justify-between gap-3 py-2 border-b border-discord-divider">
                        <Text className="text-sm text-discord-textMuted">
                            {t("accountSettings.homeserver")}
                        </Text>
                        {/* Zami: not ported: streamer-hide (streamer mode's blur) */}
                        <Text className="flex-shrink text-right text-discord-textPrimary text-xs">
                            {homeserverUrl
                                ? shownHomeserver(homeserverUrl, streamerMode)
                                : ""}
                        </Text>
                    </View>
                    <View className="flex-row justify-between gap-3 py-2 border-b border-discord-divider">
                        <Text className="text-sm text-discord-textMuted">
                            {t("accountSettings.connection")}
                        </Text>
                        <Text className="flex-shrink text-right text-discord-textPrimary text-xs">
                            {syncStatus.label}
                        </Text>
                    </View>
                </View>

                <View>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                        {t("accountSettings.presence")}
                    </Text>
                    <View className="flex-row items-center gap-3">
                        <OptionSelector
                            value={ownPresence}
                            options={OWN_PRESENCE_OPTIONS}
                            onChange={(value) => void setPresence(value)}
                            ariaLabel={t("accountSettings.presence")}
                        />
                        <Text className="flex-1 text-xs text-discord-textMuted">
                            {selectedPresence?.description}
                        </Text>
                    </View>
                    <Checkbox
                        checked={doNotDisturb}
                        onChange={() => void toggleDoNotDisturb()}
                        label={
                            <View className="flex-1">
                                <Text className="text-sm text-discord-textPrimary">
                                    {t("presence.doNotDisturb")}
                                </Text>
                                <Text className="text-xs text-discord-textMuted">
                                    {t("presence.doNotDisturbDescription")}
                                </Text>
                            </View>
                        }
                        accessibilityLabel={t("presence.doNotDisturb")}
                        className="mt-3 items-start gap-3 cursor-pointer"
                        inputClassName="mt-1 w-3.5 h-3.5 rounded-sm"
                    />
                    {presenceError ? (
                        <Text className="mt-2 text-xs text-discord-danger">
                            {presenceError}
                        </Text>
                    ) : null}
                </View>

                <View>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                        {t("accountSettings.password")}
                    </Text>
                    {oauthSession ? (
                        <>
                            <Text className="text-sm text-discord-textMuted mb-3">
                                {t("accountSettings.managedByProvider")}
                            </Text>
                            {accountUrl ? (
                                <Pressable
                                    accessibilityRole="link"
                                    onPress={() => openLink(accountUrl)}
                                    className="self-start px-4 py-2 bg-discord-accent hover:bg-discord-accentHover rounded"
                                >
                                    <Text className="text-white text-sm">
                                        {t("accountSettings.manageAccount")}
                                    </Text>
                                </Pressable>
                            ) : null}
                        </>
                    ) : canChangePassword ? (
                        <View className="gap-3 max-w-sm">
                            <TextInput
                                secureTextEntry
                                value={currentPassword}
                                onChangeText={setCurrentPassword}
                                autoComplete="current-password"
                                textContentType="password"
                                autoCapitalize="none"
                                autoCorrect={false}
                                placeholder={t(
                                    "accountSettings.currentPassword",
                                )}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                accessibilityLabel={t(
                                    "accountSettings.currentPassword",
                                )}
                                className={inputClass}
                            />
                            <TextInput
                                secureTextEntry
                                value={newPassword}
                                onChangeText={setNewPassword}
                                autoComplete="new-password"
                                textContentType="newPassword"
                                autoCapitalize="none"
                                autoCorrect={false}
                                placeholder={t("accountSettings.newPassword")}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                accessibilityLabel={t(
                                    "accountSettings.newPassword",
                                )}
                                className={inputClass}
                            />
                            <TextInput
                                secureTextEntry
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                autoComplete="new-password"
                                textContentType="newPassword"
                                autoCapitalize="none"
                                autoCorrect={false}
                                placeholder={t(
                                    "accountSettings.confirmNewPassword",
                                )}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                accessibilityLabel={t(
                                    "accountSettings.confirmNewPassword",
                                )}
                                className={inputClass}
                            />
                            <View className="flex-row items-center justify-between gap-3">
                                <Text className="flex-shrink text-sm text-discord-textPrimary">
                                    {t(
                                        "accountSettings.signOutAllOtherSessions",
                                    )}
                                </Text>
                                <ToggleSwitch
                                    checked={logoutOthers}
                                    onChange={(value) => setLogoutOthers(value)}
                                    label={t(
                                        "accountSettings.signOutAllOtherSessions",
                                    )}
                                />
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{
                                    disabled:
                                        passwordBusy ||
                                        passwordProblem !== null,
                                }}
                                onPress={() => void changePassword()}
                                disabled={
                                    passwordBusy || passwordProblem !== null
                                }
                                className={`self-start px-4 py-2 bg-discord-accent rounded ${
                                    passwordBusy || passwordProblem !== null
                                        ? "opacity-50"
                                        : ""
                                }`}
                            >
                                <Text className="text-white text-sm">
                                    {passwordBusy
                                        ? t("accountSettings.changing")
                                        : t("accountSettings.changePassword")}
                                </Text>
                            </Pressable>
                            {passwordError ? (
                                <Text className="text-xs text-discord-danger">
                                    {passwordError}
                                </Text>
                            ) : passwordChanged ? (
                                <Text className="text-xs text-discord-textPositive">
                                    {t("accountSettings.passwordChanged")}
                                </Text>
                            ) : passwordProblem &&
                              (currentPassword ||
                                  newPassword ||
                                  confirmPassword) ? (
                                <Text className="text-xs text-discord-textMuted">
                                    {passwordProblem}
                                </Text>
                            ) : null}
                        </View>
                    ) : (
                        <Text className="text-sm text-discord-textMuted">
                            {t(
                                "accountSettings.thisServerDoesNotAllowChanging",
                            )}
                        </Text>
                    )}
                </View>

                <View>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                        {t("accountSettings.emailPhoneNumbers")}
                    </Text>
                    {!securityLoaded ? (
                        <Text className="text-sm text-discord-textMuted">
                            {t("common.loading")}
                        </Text>
                    ) : threePids.length === 0 ? (
                        <Text className="text-sm text-discord-textMuted">
                            {t(
                                "accountSettings.noEmailAddressesOrPhoneNumbers",
                            )}
                        </Text>
                    ) : (
                        threePids.map((identifier) => (
                            <View
                                key={identifier.medium + identifier.address}
                                className="flex-row justify-between gap-3 py-2 border-b border-discord-divider"
                            >
                                <Text className="text-sm text-discord-textMuted">
                                    {identifier.medium === "email"
                                        ? t("accountSettings.email")
                                        : t("accountSettings.phone")}
                                </Text>
                                {/* Zami: not ported: streamer-hide (streamer mode's blur) */}
                                <Text className="flex-shrink text-right text-discord-textPrimary font-mono text-xs">
                                    {identifier.address}
                                </Text>
                            </View>
                        ))
                    )}
                    {securityLoaded && !canManageThreePids ? (
                        <Text className="mt-2 text-xs text-discord-textMuted">
                            {t(
                                "accountSettings.thisServerDoesNotAllowManaging",
                            )}
                        </Text>
                    ) : null}
                </View>

                {lastDeviceWarning ? (
                    <View
                        className="p-3 rounded border border-discord-danger bg-discord-backgroundSecondary gap-3"
                        accessibilityRole="alert"
                    >
                        <Text className="text-sm font-semibold text-discord-textPrimary">
                            {t("accountSettings.lastDeviceTitle")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {lastDeviceBackedUp
                                ? t("accountSettings.lastDeviceBackedUp")
                                : t("accountSettings.lastDeviceNoBackup")}
                        </Text>
                        <View className="flex-row gap-2">
                            <Pressable
                                accessibilityRole="button"
                                onPress={onLogout}
                                className="px-4 py-2 bg-discord-danger rounded"
                            >
                                <Text className="text-white font-medium text-sm">
                                    {t("accountSettings.logOutAnyway")}
                                </Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => setLastDeviceWarning(false)}
                                className="px-4 py-2 rounded bg-discord-backgroundTertiary"
                            >
                                <Text className="font-medium text-sm text-discord-textPrimary">
                                    {t("common.cancel")}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                ) : (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: checkingDevices }}
                        onPress={() => void requestLogout()}
                        disabled={checkingDevices}
                        className={`self-start px-4 py-2 bg-discord-danger rounded ${
                            checkingDevices ? "opacity-50" : ""
                        }`}
                    >
                        <Text className="text-white font-medium text-sm">
                            {t("accountSettings.logOut")}
                        </Text>
                    </Pressable>
                )}

                {!oauthSession || deactivateUrl || accountUrl ? (
                    <View className="pt-4 border-t border-discord-divider gap-3">
                        <Text className="text-xs font-semibold text-discord-danger uppercase tracking-wide">
                            {t("accountSettings.dangerZone")}
                        </Text>
                        {oauthSession ? (
                            (deactivateUrl ?? accountUrl) ? (
                                <Pressable
                                    accessibilityRole="link"
                                    onPress={() =>
                                        openLink((deactivateUrl ?? accountUrl)!)
                                    }
                                    className="self-start px-4 py-2 border border-discord-danger rounded"
                                >
                                    <Text className="text-discord-danger text-sm">
                                        {t("accountSettings.deactivateAccount")}
                                    </Text>
                                </Pressable>
                            ) : null
                        ) : !deactivateOpen ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => setDeactivateOpen(true)}
                                className="self-start px-4 py-2 border border-discord-danger rounded"
                            >
                                <Text className="text-discord-danger text-sm">
                                    {t("accountSettings.deactivateAccount")}
                                </Text>
                            </Pressable>
                        ) : (
                            <View className="gap-3 max-w-sm">
                                <Text className="text-sm text-discord-textPrimary">
                                    {t(
                                        "accountSettings.deactivationIsPermanentAndCannotBe",
                                    )}
                                </Text>
                                <TextInput
                                    value={deactivateTyped}
                                    onChangeText={setDeactivateTyped}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    placeholder={userId ?? ""}
                                    placeholderTextColorClassName="accent-discord-textMuted"
                                    accessibilityLabel={userId ?? ""}
                                    className="w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2"
                                />
                                <TextInput
                                    secureTextEntry
                                    value={deactivatePassword}
                                    onChangeText={setDeactivatePassword}
                                    autoComplete="current-password"
                                    textContentType="password"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    placeholder={t(
                                        "accountSettings.currentPassword",
                                    )}
                                    placeholderTextColorClassName="accent-discord-textMuted"
                                    accessibilityLabel={t(
                                        "accountSettings.currentPassword",
                                    )}
                                    className="w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2"
                                />
                                <View className="flex-row items-center justify-between gap-3">
                                    <Text className="flex-shrink text-sm text-discord-textPrimary">
                                        {t(
                                            "accountSettings.eraseMessagesWherePossible",
                                        )}
                                    </Text>
                                    <ToggleSwitch
                                        checked={deactivateErase}
                                        onChange={(value) =>
                                            setDeactivateErase(value)
                                        }
                                        label={t(
                                            "accountSettings.eraseMessagesWherePossible",
                                        )}
                                    />
                                </View>
                                <View className="flex-row gap-2">
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityState={{
                                            disabled:
                                                !deactivateArmed ||
                                                deactivateBusy,
                                        }}
                                        onPress={() => void deactivate()}
                                        disabled={
                                            !deactivateArmed || deactivateBusy
                                        }
                                        className={`px-4 py-2 bg-discord-danger rounded ${
                                            !deactivateArmed || deactivateBusy
                                                ? "opacity-50"
                                                : ""
                                        }`}
                                    >
                                        <Text className="text-white text-sm">
                                            {deactivateBusy
                                                ? t(
                                                      "accountSettings.deactivating",
                                                  )
                                                : t(
                                                      "accountSettings.deactivateAccount2",
                                                  )}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityState={{
                                            disabled: deactivateBusy,
                                        }}
                                        onPress={cancelDeactivation}
                                        disabled={deactivateBusy}
                                        className="px-4 py-2 bg-discord-backgroundTertiary rounded"
                                    >
                                        <Text className="text-discord-textPrimary text-sm">
                                            {t("common.cancel")}
                                        </Text>
                                    </Pressable>
                                </View>
                                {deactivateError ? (
                                    <Text className="text-xs text-discord-danger">
                                        {deactivateError}
                                    </Text>
                                ) : null}
                            </View>
                        )}
                    </View>
                ) : null}
            </View>

            {linkMode ? (
                <LinkDeviceDialog
                    mode={linkMode}
                    onClose={() => setLinkMode(null)}
                />
            ) : null}
        </>
    );
}
