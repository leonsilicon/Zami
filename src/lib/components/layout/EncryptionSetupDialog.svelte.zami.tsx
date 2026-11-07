// Guided first-run encryption setup. Opens after a sign-in (and from the
// footer nudge) and walks the user through the ONE thing their account
// needs: create recovery on a new account, or confirm this session on an
// existing one (another device, or the recovery key). Security settings
// keeps the full toolbox; this is the short path for everyone else.
import { Checkbox, openLink, Spin } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
    useEffect,
    useEffectEvent,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { t } from "$lib/i18n";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import {
    accountHasCrossSigning,
    getBackupStatus,
    getCryptoInitError,
    getSecurityStatus,
    setupRecovery,
    unlockWithPassphrase,
    unlockWithRecoveryKey,
    type AccountApprovalPrompt,
    type SecurityStatus,
    type BackupStatus,
} from "$lib/matrix/crypto";
import { auth, isOAuthSession } from "$lib/stores/auth.svelte";
import { securityState } from "$lib/stores/security.svelte";
import { refreshVerificationStatus } from "$lib/stores/verificationStatus.svelte";
import { verifyWithAnotherDevice } from "$lib/stores/verification.svelte";
import { openAppSettingsTab } from "$lib/stores/interface.svelte";
import {
    closeEncryptionSetup,
    forgetSignInPassword,
    onboardingState,
    peekSignInPassword,
} from "$lib/stores/onboarding.svelte";
import {
    planEncryptionSetup,
    type EncryptionSetupPlan,
} from "$lib/utils/encryptionSetupPlan";
import { formatRecoveryKey, isLikelyRecoveryKey } from "$lib/utils/recoveryKey";
import {
    restoreProgressView,
    type RestoreProgress,
} from "$lib/utils/keyBackup";

// How long an automatic open waits for encryption to start before giving
// up quietly (the footer nudge still offers setup later).
const AUTO_WAIT_MS = 30_000;

const inputClass =
    "w-full px-3 py-2.5 bg-discord-backgroundSecondary text-discord-textPrimary placeholder-discord-textMuted rounded border border-discord-divider focus:border-discord-accent focus:outline-none text-sm disabled:opacity-60";

// The `primary` snippet.
function Primary({
    label,
    onPress,
    disabled = false,
}: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            onPress={onPress}
            disabled={disabled}
            className="w-full py-2.5 bg-discord-accent hover:bg-discord-accentHover rounded disabled:opacity-60 disabled:cursor-not-allowed"
        >
            <Text className="text-center text-white font-semibold text-sm">
                {label}
            </Text>
        </Pressable>
    );
}

// The `secondary` snippet.
function Secondary({
    label,
    onPress,
    disabled = false,
}: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            onPress={onPress}
            disabled={disabled}
            className="w-full py-2.5 bg-discord-backgroundSecondary hover:bg-discord-messageHover rounded border border-discord-divider disabled:opacity-60"
        >
            <Text className="text-center text-discord-textPrimary font-semibold text-sm">
                {label}
            </Text>
        </Pressable>
    );
}

type Approval = {
    url: string;
    retry: boolean;
    resolve: (proceed: boolean) => void;
};

// Zami: the panel's `max-h-[90dvh] overflow-y-auto p-6 space-y-4` is a ScrollView
// inside it (the panel itself can't scroll), padded and spaced with `gap-4`.
// `dvh` → `vh`, the window's height. Enter in a field is its return key.
export default function EncryptionSetupDialog() {
    // ── Reading the account ───────────────────────────────────────────────
    const [status, setStatus] = useState<SecurityStatus | null>(null);
    const [backup, setBackup] = useState<BackupStatus | null>(null);
    const [onServer, setOnServer] = useState<boolean | null | undefined>(
        undefined,
    );
    const readSeq = useRef(0);
    const [openedAt] = useState(() => Date.now());

    async function read() {
        const seq = ++readSeq.current;
        const [s, b, cs] = await Promise.all([
            getSecurityStatus(),
            getBackupStatus(),
            accountHasCrossSigning(),
        ]);
        if (seq !== readSeq.current) return;
        setStatus(s);
        setBackup(b);
        setOnServer(cs);
    }

    const plan: EncryptionSetupPlan = planEncryptionSetup({
        read: status?.read ?? null,
        backupRead: backup?.read ?? null,
        recoveryExists:
            (status?.secretStorageReady ?? false) ||
            (status?.defaultKeyId ?? null) !== null,
        thisDeviceVerified: status?.thisDeviceVerified ?? false,
        backupExists: backup?.exists ?? false,
        backupActive: backup?.active ?? false,
        crossSigningOnServer: onServer,
        crossSigningUnpublished: status?.crossSigningUnpublished ?? false,
    });

    // Re-read whenever crypto state moves (setup, verification, unlock).
    const securityTick = useRune(() => securityState.securityTick);
    const reread = useEffectEvent(() => void read());
    useEffect(() => {
        reread();
    }, [securityTick]);

    // Right after sign-in encryption may still be starting: an automatic
    // open keeps polling quietly instead of announcing "unavailable".
    const cryptoStarting =
        plan.kind === "unavailable" &&
        !getCryptoInitError() &&
        // Zami: read at render, as upstream's $derived reads it with each re-read.
        Date.now() - openedAt < AUTO_WAIT_MS;
    useEffect(() => {
        if (!cryptoStarting) return;
        const timer = setTimeout(() => reread(), 2000);
        return () => clearTimeout(timer);
    }, [cryptoStarting]);

    // The flow the user is in, once they've started something. Until then
    // the screen follows `plan`.
    type Flow =
        | "idle"
        | "setup-password"
        | "setup-working"
        | "show-key"
        | "unlock"
        | "unlock-working"
        | "finished";
    const [flow, setFlow] = useState<Flow>("idle");
    const [error, setError] = useState("");

    // An automatic open stays invisible until there is something to say, and
    // closes itself when the account needs nothing.
    const automatic = useRune(() => onboardingState.automatic);
    const visible =
        !automatic ||
        flow !== "idle" ||
        !(plan.kind === "checking" || cryptoStarting);
    const closeNow = useEffectEvent(() => close());
    useEffect(() => {
        if (!automatic || flow !== "idle") return;
        // Nothing to do, or nothing trustworthy to say yet: the footer
        // nudge still leads here once there is.
        if (
            plan.kind === "done" ||
            plan.kind === "advanced" ||
            plan.kind === "error" ||
            (plan.kind === "unavailable" && !cryptoStarting)
        ) {
            closeNow();
        }
    }, [automatic, flow, plan.kind, cryptoStarting]);

    function close() {
        // Never leave a key or password lingering in a closed dialog.
        answerApproval(false);
        setRecoveryKey("");
        setPassword("");
        setUnlockKey("");
        setUnlockPassphrase("");
        if (flow === "finished" || plan.kind === "done") forgetSignInPassword();
        closeEncryptionSetup();
    }

    // ── Setup (new account) ───────────────────────────────────────────────
    const [oauthSession] = useState(() => isOAuthSession());
    const [password, setPassword] = useState("");
    const usedRememberedPassword = useRef(false);
    const [recoveryKey, setRecoveryKey] = useState("");
    const [saved, setSaved] = useState(false);
    const [copied, setCopied] = useState(false);

    // OAuth-delegated servers (matrix.org) approve on their account page.
    // Zami: also kept in a ref, so a resolve always answers the prompt that is
    // up now, whichever render's closure calls it.
    const [approval, setApprovalState] = useState<Approval | null>(null);
    const approvalRef = useRef<Approval | null>(null);
    function setApproval(next: Approval | null) {
        approvalRef.current = next;
        setApprovalState(next);
    }
    const approveOnAccountPage: AccountApprovalPrompt = (url, retry) =>
        new Promise((resolve) => {
            setApproval({ url, retry, resolve });
        });
    function answerApproval(proceed: boolean) {
        const pending = approvalRef.current;
        setApproval(null);
        pending?.resolve(proceed);
    }
    useEffect(
        () => () => {
            const pending = approvalRef.current;
            approvalRef.current = null;
            pending?.resolve(false);
        },
        [],
    );

    async function startSetup() {
        setError("");
        if (oauthSession) return runSetup("");
        const remembered = peekSignInPassword(auth.userId);
        if (remembered) {
            usedRememberedPassword.current = true;
            return runSetup(remembered);
        }
        setFlow("setup-password");
    }

    async function runSetup(pw: string) {
        setFlow("setup-working");
        setError("");
        try {
            const result = await setupRecovery(
                pw,
                undefined,
                approveOnAccountPage,
            );
            setRecoveryKey(result.recoveryKey);
            setPassword("");
            setSaved(false);
            setCopied(false);
            forgetSignInPassword();
            setFlow("show-key");
        } catch (e) {
            const message =
                e instanceof Error
                    ? e.message
                    : t("securitySettings.couldNotSetUpRecovery");
            // A remembered password that no longer works (changed elsewhere)
            // just means asking for it, not an error.
            if (usedRememberedPassword.current) {
                usedRememberedPassword.current = false;
                forgetSignInPassword();
                setFlow("setup-password");
                setError(
                    message === t("crypto.incorrectPassword") ? "" : message,
                );
                return;
            }
            setError(message);
            setFlow(oauthSession ? "idle" : "setup-password");
        }
    }

    async function copyKey() {
        try {
            await Clipboard.setStringAsync(formatRecoveryKey(recoveryKey));
            setCopied(true);
        } catch {
            setCopied(false);
        }
    }

    async function downloadKey() {
        const text = `${t("encryptionSetup.keyFileHeader", {
            userId: auth.userId ?? "",
        })}\n\n${formatRecoveryKey(recoveryKey)}\n`;
        // Zami: the web saves a blob URL as a download; here the file is
        // written to the cache and offered through the share sheet (Save to
        // Files, AirDrop, …), then removed so the key never lingers on disk.
        // The sheet doesn't say whether the file was actually saved, so unlike
        // upstream's download this doesn't tick "I've saved my recovery key":
        // the user does, once they have.
        const file = new File(Paths.cache, "zam-recovery-key.txt");
        try {
            file.create({ overwrite: true });
            await file.write(text);
            await Sharing.shareAsync(file.uri, {
                mimeType: "text/plain",
                UTI: "public.plain-text",
                dialogTitle: t("encryptionSetup.downloadKey"),
            });
        } catch {
            // The key is still on screen to copy by hand.
        } finally {
            try {
                if (file.exists) file.delete();
            } catch {
                // Nothing left to clean up.
            }
        }
    }

    function finishSetup() {
        setRecoveryKey("");
        setFlow("finished");
        void refreshVerificationStatus();
    }

    // ── Confirm (existing account) ────────────────────────────────────────
    const [unlockMode, setUnlockMode] = useState<"key" | "passphrase">("key");
    const [unlockKey, setUnlockKey] = useState("");
    const [unlockPassphrase, setUnlockPassphrase] = useState("");
    const [progress, setProgress] = useState<RestoreProgress | null>(null);
    const progressView = restoreProgressView(progress);
    const canUsePassphrase = status?.passphraseRecovery ?? false;
    const effectiveMode = canUsePassphrase ? unlockMode : "key";
    const unlockReady =
        effectiveMode === "key"
            ? isLikelyRecoveryKey(unlockKey)
            : unlockPassphrase.length > 0;

    function startUnlock() {
        setError("");
        setUnlockKey("");
        setUnlockPassphrase("");
        setUnlockMode("key");
        setFlow("unlock");
    }

    async function runUnlock() {
        if (!unlockReady || flow === "unlock-working") return;
        setError("");
        setProgress(null);
        setFlow("unlock-working");
        try {
            const onProgress = (p: RestoreProgress) => setProgress(p);
            if (effectiveMode === "key")
                await unlockWithRecoveryKey(unlockKey, onProgress);
            else await unlockWithPassphrase(unlockPassphrase, onProgress);
            setUnlockKey("");
            setUnlockPassphrase("");
            await read();
            void refreshVerificationStatus();
            setFlow("finished");
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : t("securitySettings.couldNotVerifyThisSession"),
            );
            setFlow("unlock");
        }
    }

    // Zami: upstream's `useAnotherDevice`; a `use…` name is a React hook's.
    async function startAnotherDevice() {
        setError("");
        try {
            await verifyWithAnotherDevice();
            // The verification modal takes over; come back once it ends.
            onboardingState.resumeAfterVerification = true;
            closeEncryptionSetup();
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : t("verification.couldNotSendVerificationRequest"),
            );
        }
    }

    function openSecuritySettings() {
        close();
        openAppSettingsTab("security");
    }

    // Leaving mid-setup is fine before the key exists; after, the user must
    // see it saved first (closing would lose it for good).
    const closable =
        flow !== "setup-working" &&
        flow !== "unlock-working" &&
        flow !== "show-key";

    function approvalPrompt(): ReactNode {
        if (!approval) return null;
        return (
            <View className="gap-2 rounded border border-discord-divider p-3">
                <Text className="text-sm font-medium text-discord-textPrimary">
                    {t("securitySettings.approveOnAccountPage")}
                </Text>
                <Text
                    className={`text-xs ${
                        approval.retry
                            ? "text-discord-warning"
                            : "text-discord-textMuted"
                    }`}
                >
                    {approval.retry
                        ? t("securitySettings.approveOnAccountPageRetry")
                        : t("securitySettings.approveOnAccountPageBody")}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                    <Pressable
                        accessibilityRole="link"
                        onPress={() => openLink(approval.url)}
                        className="px-3 py-1.5 bg-discord-accent rounded"
                    >
                        <Text className="text-white text-sm">
                            {t("securitySettings.openAccountPage")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => answerApproval(true)}
                        className="px-3 py-1.5 bg-discord-messageHover rounded"
                    >
                        <Text className="text-discord-textPrimary text-sm">
                            {t("securitySettings.iVeApprovedIt")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => answerApproval(false)}
                        className="px-3 py-1.5 bg-discord-messageHover rounded"
                    >
                        <Text className="text-discord-textPrimary text-sm">
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    function body(): ReactNode {
        if (flow === "show-key")
            return (
                <>
                    <Text className="text-sm text-discord-textSecondary">
                        {t("encryptionSetup.saveKeyBody")}
                    </Text>
                    <View className="bg-discord-backgroundTertiary rounded px-3 py-2.5">
                        <Text
                            selectable
                            className="font-mono text-sm text-discord-textPrimary break-all select-all"
                        >
                            {formatRecoveryKey(recoveryKey)}
                        </Text>
                    </View>
                    <View className="flex-row gap-2">
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void copyKey()}
                            className="flex-1 py-2 bg-discord-backgroundSecondary hover:bg-discord-messageHover rounded border border-discord-divider"
                        >
                            <Text className="text-center text-discord-textPrimary text-sm">
                                {copied
                                    ? t("securitySettings.copied")
                                    : t("securitySettings.copyKey")}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void downloadKey()}
                            className="flex-1 py-2 bg-discord-backgroundSecondary hover:bg-discord-messageHover rounded border border-discord-divider"
                        >
                            <Text className="text-center text-discord-textPrimary text-sm">
                                {t("encryptionSetup.downloadKey")}
                            </Text>
                        </Pressable>
                    </View>
                    <Checkbox
                        checked={saved}
                        onChange={setSaved}
                        label={t("securitySettings.iVeSavedMyRecoveryKey")}
                        labelClassName="flex-1 text-sm text-discord-textSecondary"
                        className="items-start gap-2 cursor-pointer"
                        inputClassName="mt-0.5 w-4 h-4 rounded-sm"
                    />
                    <Primary
                        label={t("securitySettings.done")}
                        onPress={finishSetup}
                        disabled={!saved}
                    />
                </>
            );
        if (flow === "finished" || plan.kind === "done")
            return (
                <>
                    <Text className="text-sm text-discord-textSecondary">
                        {t("encryptionSetup.doneBody")}
                    </Text>
                    <Primary label={t("common.close")} onPress={close} />
                </>
            );
        if (flow === "unlock" || flow === "unlock-working")
            return (
                <>
                    {canUsePassphrase && (
                        <View className="flex-row gap-2">
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{
                                    selected: effectiveMode === "key",
                                    disabled: flow === "unlock-working",
                                }}
                                onPress={() => setUnlockMode("key")}
                                disabled={flow === "unlock-working"}
                                className={`px-2 py-1 rounded ${
                                    effectiveMode === "key"
                                        ? "bg-discord-accent"
                                        : "bg-discord-messageHover"
                                }`}
                            >
                                <Text
                                    className={`text-xs ${
                                        effectiveMode === "key"
                                            ? "text-white"
                                            : "text-discord-textPrimary"
                                    }`}
                                >
                                    {t("securitySettings.recoveryKey2")}
                                </Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{
                                    selected: effectiveMode === "passphrase",
                                    disabled: flow === "unlock-working",
                                }}
                                onPress={() => setUnlockMode("passphrase")}
                                disabled={flow === "unlock-working"}
                                className={`px-2 py-1 rounded ${
                                    effectiveMode === "passphrase"
                                        ? "bg-discord-accent"
                                        : "bg-discord-messageHover"
                                }`}
                            >
                                <Text
                                    className={`text-xs ${
                                        effectiveMode === "passphrase"
                                            ? "text-white"
                                            : "text-discord-textPrimary"
                                    }`}
                                >
                                    {t("securitySettings.passphrase")}
                                </Text>
                            </Pressable>
                        </View>
                    )}
                    <Text className="text-sm text-discord-textSecondary">
                        {effectiveMode === "key"
                            ? t("encryptionSetup.enterKeyBody")
                            : t("encryptionSetup.enterPassphraseBody")}
                    </Text>
                    {effectiveMode === "key" ? (
                        <TextInput
                            accessibilityLabel={t(
                                "securitySettings.recoveryKey2",
                            )}
                            value={unlockKey}
                            onChangeText={setUnlockKey}
                            placeholder="EsTx xxxx xxxx …"
                            placeholderTextColorClassName="accent-discord-textMuted"
                            autoComplete="off"
                            autoCapitalize="none"
                            autoCorrect={false}
                            spellCheck={false}
                            editable={flow !== "unlock-working"}
                            returnKeyType="go"
                            onSubmitEditing={() => {
                                if (unlockReady) void runUnlock();
                            }}
                            className={`${inputClass} font-mono ${
                                flow === "unlock-working" ? "opacity-60" : ""
                            }`}
                        />
                    ) : (
                        <TextInput
                            accessibilityLabel={t(
                                "securitySettings.recoveryPassphrase",
                            )}
                            secureTextEntry
                            value={unlockPassphrase}
                            onChangeText={setUnlockPassphrase}
                            placeholder={t(
                                "securitySettings.recoveryPassphrase",
                            )}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            autoComplete="current-password"
                            textContentType="password"
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={flow !== "unlock-working"}
                            returnKeyType="go"
                            onSubmitEditing={() => {
                                if (unlockReady) void runUnlock();
                            }}
                            className={`${inputClass} ${
                                flow === "unlock-working" ? "opacity-60" : ""
                            }`}
                        />
                    )}
                    {flow === "unlock-working" ? (
                        <View className="gap-1.5">
                            <Text
                                accessibilityLiveRegion="polite"
                                className="text-xs text-discord-textMuted"
                            >
                                {progressView.label}
                            </Text>
                            <View className="h-1.5 w-full rounded bg-discord-backgroundTertiary overflow-hidden">
                                <View
                                    className="h-full bg-discord-accent transition-all"
                                    style={{
                                        width: `${progressView.percent ?? 15}%`,
                                    }}
                                />
                            </View>
                        </View>
                    ) : (
                        <>
                            <Primary
                                label={t("loginView.continue")}
                                onPress={() => void runUnlock()}
                                disabled={!unlockReady}
                            />
                            <Secondary
                                label={t("encryptionSetup.back")}
                                onPress={() => {
                                    setError("");
                                    setFlow("idle");
                                }}
                            />
                        </>
                    )}
                </>
            );
        if (plan.kind === "checking" || cryptoStarting)
            return (
                <View
                    accessibilityLiveRegion="polite"
                    className="flex-row items-center gap-2"
                >
                    <Spin
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        className="w-4 h-4 border-2 border-discord-accent border-t-transparent rounded-full"
                    />
                    <Text className="shrink text-sm text-discord-textMuted">
                        {t("encryptionSetup.checking")}
                    </Text>
                </View>
            );
        if (plan.kind === "unavailable" || plan.kind === "error")
            return (
                <>
                    <Text className="text-sm text-discord-textSecondary">
                        {plan.kind === "unavailable"
                            ? (getCryptoInitError() ??
                              t("verificationStatus.encryptionUnavailable"))
                            : t("securityStatusView.couldnTReadThisAccountS")}
                    </Text>
                    <Primary
                        label={t("encryptionSetup.tryAgain")}
                        onPress={() => void read()}
                    />
                    <Secondary
                        label={t("encryptionSetup.later")}
                        onPress={close}
                    />
                </>
            );
        if (plan.kind === "advanced")
            return (
                <>
                    <Text className="text-sm text-discord-textSecondary">
                        {t("securitySettings.keysNotOnServerHint")}
                    </Text>
                    <Primary
                        label={t("encryptionSetup.openSecuritySettings")}
                        onPress={openSecuritySettings}
                    />
                </>
            );
        if (plan.kind === "confirm") {
            const RecoveryKeyButton = plan.withDevice ? Secondary : Primary;
            return (
                <>
                    <Text className="text-sm text-discord-textSecondary">
                        {t("encryptionSetup.confirmBody")}
                    </Text>
                    <View className="gap-2">
                        {plan.withDevice && (
                            <Primary
                                label={t("encryptionSetup.useAnotherDevice")}
                                onPress={() => void startAnotherDevice()}
                            />
                        )}
                        {plan.withRecoveryKey && (
                            <RecoveryKeyButton
                                label={t("encryptionSetup.useRecoveryKey")}
                                onPress={startUnlock}
                            />
                        )}
                    </View>
                    <Text className="text-xs text-discord-textMuted">
                        {plan.withDevice
                            ? t("encryptionSetup.anotherDeviceHint")
                            : t("encryptionSetup.recoveryKeyHint")}
                    </Text>
                    <View className="flex-row items-center justify-between gap-3 pt-1">
                        <Pressable
                            accessibilityRole="button"
                            onPress={openSecuritySettings}
                            className="shrink"
                        >
                            <Text className="text-xs text-discord-textMuted underline hover:text-discord-textPrimary">
                                {t("encryptionSetup.cantConfirm")}
                            </Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" onPress={close}>
                            <Text className="text-sm text-discord-textMuted hover:text-discord-textPrimary">
                                {t("encryptionSetup.later")}
                            </Text>
                        </Pressable>
                    </View>
                </>
            );
        }
        if (plan.kind === "connect-backup")
            return (
                <>
                    <Text className="text-sm text-discord-textSecondary">
                        {t("encryptionSetup.connectBackupBody")}
                    </Text>
                    <Primary
                        label={t("encryptionSetup.useRecoveryKey")}
                        onPress={startUnlock}
                    />
                    <Secondary
                        label={t("encryptionSetup.later")}
                        onPress={close}
                    />
                </>
            );
        // setup
        return (
            <>
                <Text className="text-sm text-discord-textSecondary">
                    {t("encryptionSetup.setupBody")}
                </Text>
                {(flow === "setup-password" ||
                    (flow === "setup-working" &&
                        !oauthSession &&
                        password)) && (
                    <View className="gap-1.5">
                        <Text
                            nativeID="setup-password-label"
                            className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
                        >
                            {t("securitySettings.accountPassword")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("encryptionSetup.passwordBody")}
                        </Text>
                        <TextInput
                            accessibilityLabelledBy="setup-password-label"
                            accessibilityLabel={t(
                                "securitySettings.accountPassword",
                            )}
                            secureTextEntry
                            value={password}
                            onChangeText={setPassword}
                            autoComplete="current-password"
                            textContentType="password"
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={flow !== "setup-working"}
                            returnKeyType="go"
                            onSubmitEditing={() => {
                                if (password) void runSetup(password);
                            }}
                            className={`${inputClass} ${
                                flow === "setup-working" ? "opacity-60" : ""
                            }`}
                        />
                    </View>
                )}
                {approvalPrompt()}
                {!approval && (
                    <Primary
                        label={
                            flow === "setup-working"
                                ? t("securitySettings.settingUp")
                                : t("encryptionSetup.setUp")
                        }
                        onPress={() =>
                            void (flow === "setup-password"
                                ? runSetup(password)
                                : startSetup())
                        }
                        disabled={
                            flow === "setup-working" ||
                            (flow === "setup-password" && !password)
                        }
                    />
                )}
                {flow !== "setup-working" && (
                    <Secondary
                        label={t("encryptionSetup.later")}
                        onPress={close}
                    />
                )}
            </>
        );
    }

    if (!visible) return null;
    return (
        <ModalDialog
            onClose={() => closable && close()}
            labelledBy="encryption-setup-title"
            panelClass="relative w-full max-w-md mx-4 max-h-[90vh] overflow-hidden bg-discord-background rounded-lg shadow-2xl"
        >
            <ScrollView
                keyboardShouldPersistTaps="handled"
                style={styles.content}
                contentContainerClassName="p-6 gap-4"
            >
                <View className="flex-row items-start gap-3">
                    <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        className="flex-shrink-0 w-10 h-10 rounded-full bg-discord-accent/15 flex-row items-center justify-center"
                    >
                        <Text className="text-discord-accent text-xl">
                            {flow === "finished" || plan.kind === "done"
                                ? "✓"
                                : "🔒"}
                        </Text>
                    </View>
                    <View className="min-w-0 shrink">
                        <Text
                            nativeID="encryption-setup-title"
                            role="heading"
                            className="text-lg font-bold text-discord-textPrimary"
                        >
                            {flow === "show-key"
                                ? t("encryptionSetup.saveKeyTitle")
                                : flow === "finished" || plan.kind === "done"
                                  ? t("encryptionSetup.doneTitle")
                                  : flow === "unlock" ||
                                      flow === "unlock-working"
                                    ? t("encryptionSetup.enterKeyTitle")
                                    : plan.kind === "confirm"
                                      ? t("encryptionSetup.confirmTitle")
                                      : plan.kind === "connect-backup"
                                        ? t(
                                              "encryptionSetup.connectBackupTitle",
                                          )
                                        : t("encryptionSetup.setupTitle")}
                        </Text>
                    </View>
                </View>

                {body()}

                {error ? (
                    <Text className="text-sm text-discord-danger" role="alert">
                        {error}
                    </Text>
                ) : null}
            </ScrollView>
        </ModalDialog>
    );
}

const styles = StyleSheet.create({
    // Only as tall as its content, so the dialog sizes to it.
    content: { flexGrow: 0 },
});
