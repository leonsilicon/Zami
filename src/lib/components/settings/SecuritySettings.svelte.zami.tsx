import { Check } from "lucide-svelte";
import { Checkbox, openLink } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import KeyExportSettings from "$lib/components/settings/KeyExportSettings.svelte";
import {
    getSecurityStatus,
    setupRecovery,
    resetRecovery,
    publishCrossSigningKeys,
    isRecoverySetupIncomplete,
    getBackupStatus,
    unlockWithRecoveryKey,
    unlockWithPassphrase,
    type SecurityStatus,
    type BackupStatus,
    type UnlockResult,
    type RecoverySetupResult,
    type AccountApprovalPrompt,
} from "$lib/matrix/crypto";
import { securityState } from "$lib/stores/security.svelte";
import { isOAuthSession } from "$lib/stores/auth.svelte";
import {
    verificationStatusState,
    refreshVerificationStatus,
} from "$lib/stores/verificationStatus.svelte";
import { verifyWithAnotherDevice } from "$lib/stores/verification.svelte";
import { formatRecoveryKey, isLikelyRecoveryKey } from "$lib/utils/recoveryKey";
import {
    backupBadge,
    backupDetailLines,
    backupSummaryLabel,
    restoreProgressView,
    restoreResultLabel,
    secretStorageKeyLabel,
    type RestoreProgress,
} from "$lib/utils/keyBackup";
import {
    passphraseIssue,
    MIN_PASSPHRASE_LENGTH,
} from "$lib/utils/recoveryPassphrase";
import {
    securityPanelView,
    type SecurityRead,
} from "$lib/utils/securityStatusView";
import {
    nextResetPhase,
    resetPhaseView,
    type ResetEvent,
    type ResetPhase,
} from "$lib/utils/recoveryReset";

/**
 * Zami: `$state` reads back synchronously, so upstream's guards
 * (`step === "working"`, `resetView.busy`, `publishBusy`) see a write made
 * earlier in the same handler, or by a press that hasn't re-rendered yet. The
 * guarded flows here upload signing keys and destroy the old recovery, so their
 * phases keep that: the value is mirrored in a ref the guards read.
 */
function useSyncedState<T>(
    initial: T,
): [T, (next: T) => void, { readonly current: T }] {
    const [value, setValue] = useState(initial);
    const ref = useRef(initial);
    const set = useCallback((next: T) => {
        ref.current = next;
        setValue(next);
    }, []);
    return [value, set, ref];
}

/**
 * Zami: the approval link is `a[data-in-app]`, which Zam's root layout opens in
 * the in-app browser (Android's Custom Tab, openInAppBrowser) so the user never
 * leaves the app. Here that is expo-web-browser's (SFSafariViewController on
 * iOS), falling back to the system browser.
 */
function openInApp(url: string): void {
    void WebBrowser.openBrowserAsync(url).catch(() => openLink(url));
}

const inputClass =
    "w-full bg-discord-backgroundDark text-discord-textPrimary text-sm rounded px-3 py-1.5 outline-none";
// Zami: a TextInput has no `disabled:` state; a disabled one (`editable={false}`)
// is dimmed with this, as upstream's `disabled:opacity-50`.
const disabledInputClass = "opacity-50";
// Zami: `<label class="flex items-start gap-2 text-xs text-discord-textMuted">`;
// the label text takes the rest of the row so it wraps.
const checkboxLabelClass = "flex-1 text-xs text-discord-textMuted";
// Zami: buttons on their own in a column are `self-start`, as an inline
// `<button>` is as wide as its text rather than the column.
const accentButtonClass =
    "px-3 py-1.5 bg-discord-accent rounded disabled:opacity-50";
const accentButtonTextClass = "text-white text-sm";
const secondaryButtonClass =
    "px-3 py-1.5 bg-discord-messageHover rounded disabled:opacity-50";
const secondaryButtonTextClass = "text-discord-textPrimary text-sm";
const dangerButtonClass =
    "px-3 py-1.5 bg-discord-danger rounded disabled:opacity-50";

// Zami: a badge is a padded, rounded box, which a nested Text can't be: its
// background and padding go on a View, its text classes on the Text inside.
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
        <View className={`px-1.5 py-0.5 rounded ${box}`}>
            <Text className={`text-[10px] font-semibold uppercase ${text}`}>
                {label}
            </Text>
        </View>
    );
}

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead.
export default function SecuritySettings() {
    // The Set-up-recovery wizard is a small linear state machine:
    //   idle → password (collect account password for the UIA-guarded upload)
    //        → working (running setupRecovery) → show (display key + save gate)
    //        → done.
    type Step = "idle" | "password" | "working" | "show" | "done";

    // Read outcomes are tracked separately from the payload so a transient
    // failure can't masquerade as "nothing is set up": on a failed read we keep
    // the last good payload on screen and mark it stale (audit CRYPTO-02).
    const [status, setStatus] = useState<SecurityStatus | null>(null);
    const [statusRead, setStatusRead] = useState<SecurityRead | null>(null);
    const [backupRead, setBackupRead] = useState<SecurityRead | null>(null);
    const [step, setStep, stepRef] = useSyncedState<Step>("idle");
    const [password, setPassword] = useState("");
    const [recoveryKey, setRecoveryKey] = useState("");
    const [saved, setSaved] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState("");

    // Optional passphrase: an ADDITIONAL way to unlock recovery. The random
    // recovery key is always generated and shown; this only adds a second door.
    const [usePassphrase, setUsePassphrase] = useState(false);
    const [passphrase, setPassphrase] = useState("");
    const [keyHasPassphrase, setKeyHasPassphrase] = useState(false);

    // Only nag once the user has actually typed something — an empty field is
    // "not filled in yet", not an error.
    const passphraseError =
        usePassphrase && passphrase.length > 0
            ? passphraseIssue(passphrase)
            : null;
    // An OAuth-delegated server (matrix.org via MAS) has no password to check:
    // it asks for approval on its account page instead, so don't demand one.
    const [oauthSession] = useState(isOAuthSession);
    const setupBlocked =
        (!oauthSession && !password) ||
        (usePassphrase && passphraseIssue(passphrase) !== null);

    // The account-page approval the signing-key upload is waiting on, if any.
    // `resolve` hands the user's answer back to the UIA callback in crypto.ts.
    type Approval = {
        url: string;
        retry: boolean;
        resolve: (proceed: boolean) => void;
    };
    const [approval, setApprovalState] = useState<Approval | null>(null);
    // Zami: the pending approval as of now, for `answerApproval` (and the
    // unmount below), which run outside the render that set it.
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

    // Leaving the page mid-approval must not strand the setup promise: treat
    // it as a cancel so the flow unwinds.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- on unmount; `answerApproval` reads the ref.
    useEffect(() => () => answerApproval(false), []);

    // Reset-recovery sub-flow, offered from the "Recovery is set up" panel for a
    // user who lost their key: confirm → password → destroying, then hands off
    // into step="show" with the freshly-minted key (reusing the show screen
    // above). The phases live in a pure machine because the flow straddles a
    // destructive boundary — see recoveryReset.ts and `repair` below.
    const [resetStep, setResetStep, resetStepRef] =
        useSyncedState<ResetPhase>("idle");
    const resetView = resetPhaseView(resetStep);

    function advanceReset(event: ResetEvent) {
        setResetStep(nextResetPhase(resetStepRef.current, event));
    }

    // Any default 4S key counts, not just a fully-populated store: "Set up
    // recovery" on top of an existing key would delete the account's key
    // backup and replace a recovery key the user may still hold. A partial
    // setup is fixed by unlocking (or, deliberately, by Reset), never by this.
    const recoveryDone =
        (status?.secretStorageReady ?? false) ||
        (status?.defaultKeyId ?? null) !== null;

    // ── Layer 3: enter-recovery-key → verify this session & restore history ──
    //   idle → entry (paste key) → working (restoring, with progress) → done.
    type UnlockStep = "idle" | "entry" | "working" | "done";

    const [backup, setBackup] = useState<BackupStatus | null>(null);
    const [unlockStep, setUnlockStep, unlockStepRef] =
        useSyncedState<UnlockStep>("idle");
    const [unlockKey, setUnlockKey] = useState("");
    const [unlockError, setUnlockError] = useState("");
    const [progress, setProgress] = useState<RestoreProgress | null>(null);
    const [unlockResult, setUnlockResult] = useState<UnlockResult | null>(null);

    // Which credential the user is entering. Defaults to the recovery key;
    // the passphrase option only appears when the account's 4S key actually
    // carries derivation params (status.passphraseRecovery).
    type UnlockMode = "key" | "passphrase";
    const [unlockMode, setUnlockMode] = useState<UnlockMode>("key");
    const [unlockPassphrase, setUnlockPassphrase] = useState("");

    const canUnlockByPassphrase = status?.passphraseRecovery ?? false;
    // The stored mode is only meaningful while the passphrase path exists; if
    // it disappears under us, fall back to key entry rather than stranding the
    // user on an input that can no longer work.
    const effectiveUnlockMode = canUnlockByPassphrase ? unlockMode : "key";
    const unlockReady =
        effectiveUnlockMode === "key"
            ? isLikelyRecoveryKey(unlockKey)
            : unlockPassphrase.length > 0;

    // Plain badge model from the backup status (undefined until first load).
    const backupModel = backup
        ? {
              exists: backup.exists,
              active: backup.active,
              trusted: backup.trusted,
              version: backup.version,
          }
        : null;
    const badge = backupModel ? backupBadge(backupModel) : null;
    const summary = backupModel ? backupSummaryLabel(backupModel) : null;
    const progressView = restoreProgressView(progress);

    // Additive detail the SDK already reports (server key count, this session's
    // upload queue). Empty when there's no backup — the summary line above
    // already says so. The key-mismatch fact is not a line here; it's rendered
    // by the "Backup key on this session" status row further down.
    const detailLines = backup
        ? backupDetailLines({
              exists: backup.exists,
              active: backup.active,
              matchesDecryptionKey: backup.matchesDecryptionKey,
              count: backup.count,
              sessionsRemaining: backup.sessionsRemaining,
          })
        : [];

    // Is what's on screen a reading that actually landed, and may we offer the
    // destructive affordances on top of it? `hasLastGood` is simply "a payload
    // is retained", because `loadStatus` only ever stores one from a successful
    // read — a failed read never overwrites it.
    const panel = securityPanelView({
        read: statusRead,
        backupRead,
        secretStorageReady: status?.secretStorageReady ?? false,
        defaultKeyId: status?.defaultKeyId ?? null,
        thisDeviceVerified: status?.thisDeviceVerified ?? false,
        backupExists: backup?.exists ?? false,
        backupActive: backup?.active ?? false,
        hasLastGood: status !== null,
    });
    // The status rows show either a fresh reading or a retained one flagged as
    // stale. They are NOT rendered from a failed read's all-false placeholder:
    // "Not set up" over working keys is the bug (audit CRYPTO-02).
    const showRows = panel.authoritative || panel.stale;
    const canSetUp = panel.allowDestructive && !recoveryDone;

    // Recovery is set up on the account (a 4S default key exists), so this
    // session can be unlocked with the recovery key.
    const recoverySetUp =
        (status?.secretStorageReady ?? false) ||
        (status?.defaultKeyId ?? null) !== null;
    // Show the "verify this session & restore" call-to-action when recovery
    // exists but this session isn't trusted yet, or a backup exists that this
    // session isn't connected to. Not shown on the session that just set up.
    const needsUnlock =
        panel.authoritative &&
        recoverySetUp &&
        (!(status?.thisDeviceVerified ?? false) ||
            ((backup?.exists ?? false) && !(backup?.active ?? false)));

    const verificationView = useRune(() => verificationStatusState.view);

    // This session is unverified on an account that HAS cross-signing, so a
    // verified sibling can vouch for it. Offered beside the recovery key, and
    // alone when the account never set recovery up (the only way in then).
    const canVerifyWithDevice =
        panel.authoritative && verificationView?.kind === "unverified";

    async function startVerifyWithAnotherDevice() {
        setUnlockError("");
        try {
            await verifyWithAnotherDevice();
        } catch (e) {
            setUnlockError(
                e instanceof Error
                    ? e.message
                    : t("verification.couldNotSendVerificationRequest"),
            );
        }
    }

    // loadStatus runs from the tick-driven effect below and from every flow
    // that finishes, so two runs can overlap — and the later-RESOLVING run is
    // not necessarily the later-STARTING one. Stamp each run and let only the
    // newest one write, or an older reading can clobber a newer one (worst
    // case: re-marking a good read as failed and hiding the panel).
    const loadSeq = useRef(0);

    async function loadStatus() {
        const seq = ++loadSeq.current;
        const [nextStatus, nextBackup] = await Promise.all([
            getSecurityStatus(),
            getBackupStatus(),
        ]);
        if (seq !== loadSeq.current) return;
        setStatusRead(nextStatus.read);
        setBackupRead(nextBackup.read);
        // Only a successful read may replace what's on screen. On "error" the
        // payload's all-false fields are noise, and on "unavailable" they say
        // nothing about the ACCOUNT (only about this session's crypto) — either
        // one overwriting a good reading is how "No backup"/"Not set up" ends up
        // rendered over working keys, with Reset recovery offered underneath.
        if (nextStatus.read === "ok") setStatus(nextStatus);
        if (nextBackup.read === "ok") setBackup(nextBackup);
    }

    // Initial load + refresh whenever crypto state changes (securityTick bumps
    // from CryptoEvent listeners in crypto.ts, e.g. after setup completes).
    const securityTick = useRune(() => securityState.securityTick);
    useEffect(() => {
        void loadStatus();
        void refreshVerificationStatus();
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- the tick is what upstream's effect reads; `loadStatus` touches only refs and state setters.
    }, [securityTick]);

    function beginSetup() {
        setError("");
        setPassword("");
        setStep("password");
    }

    async function runSetup() {
        if (setupBlocked || stepRef.current === "working") return;
        setError("");
        setStep("working");
        try {
            const result = await setupRecovery(
                password,
                usePassphrase ? passphrase : undefined,
                approveOnAccountPage,
            );
            setKeyHasPassphrase(result.hasPassphrase);
            setRecoveryKey(result.recoveryKey);
            setPassword("");
            setPassphrase("");
            setUsePassphrase(false);
            setSaved(false);
            setCopied(false);
            setStep("show");
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : t("securitySettings.couldNotSetUpRecovery"),
            );
            setStep("password");
        }
    }

    async function copyKey() {
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(recoveryKey);
            setCopied(true);
        } catch {
            // Clipboard blocked (permissions / insecure context): the key is
            // still shown for manual copy, so this is non-fatal.
            setCopied(false);
        }
    }

    function finishSetup() {
        // Drop the key from memory once the user confirms they've saved it.
        // `keyHasPassphrase` is deliberately left alone: it's only read on the
        // show screen, which unmounts as this runs.
        setRecoveryKey("");
        setPassphrase("");
        setUsePassphrase(false);
        setSaved(false);
        setStep("done");
        void loadStatus();
    }

    function cancel() {
        // Never leave the plaintext key or passphrase lingering after a cancel.
        setPassword("");
        setPassphrase("");
        setUsePassphrase(false);
        setRecoveryKey("");
        setSaved(false);
        setError("");
        setStep("idle");
    }

    // Keys this session made but never got onto the server (a failed upload
    // during an earlier setup): "Recovery is set up", yet no session can
    // verify another until they're uploaded. Same password/approval as setup.
    const [publishBusy, setPublishBusy, publishBusyRef] = useSyncedState(false);
    const publishBlocked = !oauthSession && !password;

    async function runPublish() {
        if (publishBusyRef.current || publishBlocked) return;
        setError("");
        setPublishBusy(true);
        try {
            await publishCrossSigningKeys(password, approveOnAccountPage);
            setPassword("");
            await loadStatus();
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : t("securitySettings.couldNotUploadKeys"),
            );
        } finally {
            setPublishBusy(false);
        }
    }

    function beginReset() {
        setError("");
        setPassword("");
        advanceReset({ type: "begin" });
    }

    async function runReset() {
        const view = resetPhaseView(resetStepRef.current);
        if (setupBlocked || view.busy || !view.allowsDestroy) return;
        setError("");
        advanceReset({ type: "submit" });
        let result: RecoverySetupResult;
        try {
            result = await resetRecovery(
                password,
                usePassphrase ? passphrase : undefined,
                approveOnAccountPage,
            );
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : t("securitySettings.couldNotResetRecovery"),
            );
            // Which half failed decides where the user lands. A failure past the
            // destructive step must never return to a submit that re-runs it
            // (audit CRYPTO-01) — that is the whole point of `repair`.
            advanceReset({
                type: isRecoverySetupIncomplete(e)
                    ? "failed-after-destroy"
                    : "failed-before-destroy",
            });
            return;
        }
        // Outside the try on purpose: only the CALL can tell us which half
        // failed. A throw in the success handoff would otherwise classify as
        // "failed before destroy" and put the user back on the destructive
        // submit after a destroy that actually succeeded.
        finishResetSuccess(result);
    }

    /**
     * Repair after a reset that destroyed the old recovery and then failed to
     * mint a new one. Runs the SETUP half only — never `resetRecovery` again.
     */
    async function runRepair() {
        const view = resetPhaseView(resetStepRef.current);
        if (setupBlocked || view.busy || !view.allowsRepair) return;
        setError("");
        advanceReset({ type: "submit" });
        let result: RecoverySetupResult;
        try {
            result = await setupRecovery(
                password,
                usePassphrase ? passphrase : undefined,
                approveOnAccountPage,
            );
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : t("securitySettings.couldNotFinishSettingUpRecovery"),
            );
            // Still no recovery on the account, so stay put: `repair` is the only
            // honest place to be, and the machine refuses anything else.
            advanceReset({ type: "failed-after-destroy" });
            return;
        }
        // Same asymmetry as `runReset`: a throw from the handoff is not the
        // setup call failing, and must not be reported as one.
        finishResetSuccess(result);
    }

    function finishResetSuccess(result: RecoverySetupResult) {
        setKeyHasPassphrase(result.hasPassphrase);
        setRecoveryKey(result.recoveryKey);
        setPassword("");
        setPassphrase("");
        setUsePassphrase(false);
        setSaved(false);
        setCopied(false);
        advanceReset({ type: "succeeded" });
        // Hand off to the shared show-key screen with the NEW key.
        setStep("show");
    }

    function cancelReset() {
        // Belt-and-braces: no control calls this while blocking (the repair panel
        // deliberately renders none), and the machine absorbs `cancel` there
        // anyway — but wiping the typed password and the error out from under an
        // incomplete reset would be its own small betrayal.
        if (resetPhaseView(resetStepRef.current).blocking) return;
        setPassword("");
        setPassphrase("");
        setUsePassphrase(false);
        setError("");
        advanceReset({ type: "cancel" });
    }

    function beginUnlock() {
        setUnlockError("");
        setUnlockKey("");
        setUnlockPassphrase("");
        // Always open on the recovery key: it's the path every account has.
        setUnlockMode("key");
        setUnlockResult(null);
        setProgress(null);
        setUnlockStep("entry");
    }

    async function runUnlock() {
        if (!unlockReady || unlockStepRef.current === "working") return;
        setUnlockError("");
        setProgress(null);
        setUnlockStep("working");
        try {
            const onProgress = (p: RestoreProgress) => {
                setProgress(p);
            };
            const result =
                effectiveUnlockMode === "key"
                    ? await unlockWithRecoveryKey(unlockKey, onProgress)
                    : await unlockWithPassphrase(unlockPassphrase, onProgress);
            setUnlockKey("");
            setUnlockPassphrase("");
            setUnlockResult(result);
            setUnlockStep("done");
            void loadStatus();
        } catch (e) {
            setUnlockError(
                e instanceof Error
                    ? e.message
                    : t("securitySettings.couldNotVerifyThisSession"),
            );
            // Stay on the entry step so the user can fix a typo and retry.
            setUnlockStep("entry");
        }
    }

    function cancelUnlock() {
        setUnlockKey("");
        setUnlockPassphrase("");
        setUnlockError("");
        setProgress(null);
        setUnlockStep("idle");
    }

    function finishUnlock() {
        setUnlockResult(null);
        setUnlockStep("idle");
    }

    function approvalPrompt(): ReactNode {
        if (!approval) return null;
        return (
            <View
                className="gap-2 rounded border border-discord-divider p-3"
                role="group"
                accessibilityLabel={t("securitySettings.approveOnAccountPage")}
            >
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
                    {/* A real link, so it opens from the click itself: the system
                        browser in Electron (window-open handler), a new tab on web. */}
                    <Pressable
                        accessibilityRole="link"
                        onPress={() => openInApp(approval.url)}
                        className={accentButtonClass}
                    >
                        <Text className={accentButtonTextClass}>
                            {t("securitySettings.openAccountPage")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => answerApproval(true)}
                        className={secondaryButtonClass}
                    >
                        <Text className={secondaryButtonTextClass}>
                            {t("securitySettings.iVeApprovedIt")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => answerApproval(false)}
                        className={secondaryButtonClass}
                    >
                        <Text className={secondaryButtonTextClass}>
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    // One wording, every place a retained reading is shown: anything rendered from
    // `status`/`backup` after a read stopped landing is a past reading, not a
    // current claim about the account (audit CRYPTO-02).
    function staleMarker(): ReactNode {
        return (
            <Text className="text-xs text-discord-textMuted py-1.5">
                {t("securitySettings.showingTheLastReadingThatLoaded")}
            </Text>
        );
    }

    function statusRow(
        label: string,
        ok: boolean,
        okText: string,
        offText: string,
    ): ReactNode {
        return (
            <View className="flex-row items-center justify-between gap-3 py-1.5">
                <Text className="flex-1 text-sm text-discord-textPrimary">
                    {label}
                </Text>
                <Badge
                    box={
                        ok ? "bg-discord-online/20" : "bg-discord-messageHover"
                    }
                    text={ok ? "text-discord-online" : "text-discord-textMuted"}
                    label={ok ? okText : offText}
                />
            </View>
        );
    }

    // The password field of the setup, publish, repair and reset panels:
    // upstream's identical `<input type="password">`s.
    function passwordInput(disabled: boolean, onSubmit: () => void): ReactNode {
        return (
            <TextInput
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                autoComplete="current-password"
                textContentType="password"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t("securitySettings.accountPassword")}
                placeholderTextColorClassName="accent-discord-textMuted"
                accessibilityLabel={t("securitySettings.accountPassword")}
                editable={!disabled}
                returnKeyType="done"
                onSubmitEditing={() => {
                    if (password) onSubmit();
                }}
                className={`${inputClass} ${disabled ? disabledInputClass : ""}`}
            />
        );
    }

    // The "also let me unlock with a passphrase" checkbox and its field, shared
    // by setup, repair and reset as upstream repeats them.
    function passphraseFields(disabled: boolean): ReactNode {
        return (
            <>
                <Checkbox
                    checked={usePassphrase}
                    onChange={setUsePassphrase}
                    disabled={disabled}
                    label={t("securitySettings.alsoLetMeUnlockWithA")}
                    labelClassName={checkboxLabelClass}
                    className="items-start gap-2"
                />
                {usePassphrase ? (
                    <>
                        <TextInput
                            secureTextEntry
                            value={passphrase}
                            onChangeText={setPassphrase}
                            autoComplete="new-password"
                            textContentType="newPassword"
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholder={t(
                                "securitySettings.recoveryPassphrase",
                            )}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            accessibilityLabel={t(
                                "securitySettings.recoveryPassphrase",
                            )}
                            editable={!disabled}
                            className={`${inputClass} ${
                                disabled ? disabledInputClass : ""
                            }`}
                        />
                        {passphraseError ? (
                            <Text className="text-xs text-discord-danger">
                                {passphraseError}
                            </Text>
                        ) : (
                            <Text className="text-xs text-discord-textMuted">
                                {t("securitySettings.atLeastCharactersWeCanT", {
                                    MIN_PASSPHRASE_LENGTH,
                                })}
                            </Text>
                        )}
                    </>
                ) : null}
            </>
        );
    }

    const verificationTone = verificationView?.tone;

    return (
        <View className="gap-6">
            <View>
                <Text
                    accessibilityRole="header"
                    className="text-sm font-semibold text-discord-textPrimary mb-1"
                >
                    {t("securitySettings.securityEncryption")}
                </Text>
                <Text className="text-xs text-discord-textMuted">
                    {t("securitySettings.setUpRecoverySoYourCross")}
                </Text>
            </View>

            {/* Status rows. Rendered only from a reading that actually landed: a
                failed read shows the notice below instead, because the all-false
                placeholder underneath it is indistinguishable from a fresh account. */}
            <View className="rounded bg-discord-backgroundTertiary px-4 py-2">
                {status && showRows ? (
                    <>
                        {panel.stale ? staleMarker() : null}
                        <View className="flex-row items-center justify-between gap-3 py-1.5">
                            <Text className="flex-1 text-sm text-discord-textPrimary">
                                {t("securitySettings.verification")}
                            </Text>
                            <Badge
                                box={
                                    verificationTone === "verified"
                                        ? "bg-discord-online/20"
                                        : verificationTone === "warning"
                                          ? "bg-discord-warning/20"
                                          : verificationTone === "unverified"
                                            ? "bg-discord-messageHover"
                                            : "bg-discord-messageHover"
                                }
                                text={
                                    verificationTone === "verified"
                                        ? "text-discord-online"
                                        : verificationTone === "warning"
                                          ? "text-discord-warning"
                                          : verificationTone === "unverified"
                                            ? "text-discord-textMuted"
                                            : "text-discord-textMuted"
                                }
                                label={
                                    verificationView?.label ??
                                    t("common.checking")
                                }
                            />
                        </View>
                        {statusRow(
                            "End-to-end encryption",
                            statusRead === "ok",
                            "Active",
                            "Unknown",
                        )}
                        {statusRow(
                            "Cross-signing",
                            status.crossSigningReady,
                            "Ready",
                            "Not set up",
                        )}
                        {statusRow(
                            "Recovery (secure backup)",
                            status.secretStorageReady,
                            "Set up",
                            "Not set up",
                        )}
                        {statusRow(
                            "Keys in secure storage",
                            status.privateKeysInSecretStorage,
                            "Stored",
                            "Not stored",
                        )}
                        {statusRow(
                            "Unlock with passphrase",
                            status.passphraseRecovery,
                            "Available",
                            "Key only",
                        )}
                        {statusRow(
                            "This session",
                            status.thisDeviceVerified,
                            "Verified",
                            "Unverified",
                        )}
                    </>
                ) : panel.state === "loading" ? (
                    <Text className="text-xs text-discord-textMuted py-1.5">
                        {t("securitySettings.loadingEncryptionStatus")}
                    </Text>
                ) : (
                    // Deliberately NOT the rows above: we don't know this account's
                    // posture, and "Not set up" would claim we do.
                    <Text className="text-xs text-discord-textMuted py-1.5">
                        {t(
                            "securitySettings.encryptionStatusUnknownOnThisSession",
                        )}
                    </Text>
                )}
                {status && showRows ? (
                    <Text className="text-[11px] text-discord-textMuted pt-1 pb-1.5">
                        {t("securitySettings.recoveryKeyId")}{" "}
                        <Text selectable className="font-mono">
                            {secretStorageKeyLabel(status.defaultKeyId)}
                        </Text>
                    </Text>
                ) : null}
            </View>

            {panel.notice ? (
                <Text className="text-xs text-discord-textMuted">
                    {panel.notice}
                </Text>
            ) : null}

            {/* Set-up-recovery wizard */}
            {/* `|| step === "show"` is load-bearing: completing setup flips
                secretStorageReady → true (via securityTick), which makes canSetUp false.
                Without this, the freshly-minted key's "save it" screen would unmount the
                instant setup finishes and the user would never see their recovery key. */}
            {/* `&& !resetView.blocking` / `|| resetView.blocking` below: once a reset has
                destroyed the old recovery, the panel that says so must survive whatever
                a tick-driven read reports next. The reading that FOLLOWS a successful
                destroy is "this account has no recovery", which would otherwise swap in
                the Set-up wizard — non-destructive, but its Cancel walks away from an
                account with nothing to recover with, and the explanation is gone. */}
            {(canSetUp || step === "show") && !resetView.blocking ? (
                <View className="rounded bg-discord-backgroundTertiary px-4 py-4 gap-3">
                    {step === "idle" ||
                    step === "password" ||
                    step === "working" ? (
                        <View className="gap-1">
                            <Text className="text-sm font-medium text-discord-textPrimary">
                                {t("securitySettings.setUpRecovery")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t("securitySettings.weLlCreateA")}{" "}
                                <Text className="font-bold">
                                    {t("securitySettings.recoveryKey")}
                                </Text>{" "}
                                {t("securitySettings.aOneTimeCodeThatUnlocks")}
                            </Text>
                        </View>
                    ) : null}

                    {step === "idle" ? (
                        <Pressable
                            accessibilityRole="button"
                            onPress={beginSetup}
                            className={`self-start ${accentButtonClass}`}
                        >
                            <Text className="text-white text-sm font-medium">
                                {t("securitySettings.setUpRecovery")}
                            </Text>
                        </Pressable>
                    ) : step === "password" || step === "working" ? (
                        <View className="gap-2">
                            {oauthSession ? (
                                <Text className="text-xs text-discord-textMuted">
                                    {t(
                                        "securitySettings.approveOnAccountPageHint",
                                    )}
                                </Text>
                            ) : (
                                <>
                                    <Text className="text-xs text-discord-textMuted">
                                        {t(
                                            "securitySettings.confirmYourAccountPasswordToCreate",
                                        )}
                                    </Text>
                                    {passwordInput(step === "working", () => {
                                        void runSetup();
                                    })}
                                </>
                            )}
                            {passphraseFields(step === "working")}
                            <View className="flex-row gap-2">
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        disabled:
                                            step === "working" || setupBlocked,
                                    }}
                                    onPress={() => {
                                        void runSetup();
                                    }}
                                    disabled={
                                        step === "working" || setupBlocked
                                    }
                                    className={accentButtonClass}
                                >
                                    <Text className={accentButtonTextClass}>
                                        {step === "working"
                                            ? t("securitySettings.settingUp")
                                            : t("securitySettings.continue")}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        disabled: step === "working",
                                    }}
                                    onPress={cancel}
                                    disabled={step === "working"}
                                    className={secondaryButtonClass}
                                >
                                    <Text className={secondaryButtonTextClass}>
                                        {t("common.cancel")}
                                    </Text>
                                </Pressable>
                            </View>
                        </View>
                    ) : step === "show" ? (
                        <View className="gap-3">
                            <Text className="text-sm font-medium text-discord-textPrimary">
                                {t("securitySettings.saveYourRecoveryKey")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t("securitySettings.thisIsShown")}{" "}
                                <Text className="font-bold">
                                    {t("securitySettings.onlyOnce")}
                                </Text>
                                {t("securitySettings.storeItNowWithoutItYou")}
                            </Text>
                            <View className="bg-discord-backgroundDark rounded px-3 py-2">
                                {/* Zami: not ported: streamer-hide (streamer mode's blur) */}
                                <Text
                                    selectable
                                    className="font-mono text-sm text-discord-textPrimary"
                                >
                                    {formatRecoveryKey(recoveryKey)}
                                </Text>
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => {
                                    void copyKey();
                                }}
                                className="self-start px-3 py-1.5 bg-discord-messageHover rounded"
                            >
                                <View className="flex-row items-center justify-center gap-1">
                                    {copied ? (
                                        <Check
                                            size={14}
                                            className="text-discord-textPrimary"
                                        />
                                    ) : null}
                                    <Text className="text-discord-textPrimary text-xs">
                                        {copied
                                            ? t("securitySettings.copied")
                                            : t("securitySettings.copyKey")}
                                    </Text>
                                </View>
                            </Pressable>
                            {keyHasPassphrase ? (
                                <Text className="text-xs text-discord-textMuted">
                                    {t(
                                        "securitySettings.youCanAlsoUnlockWithThe",
                                    )}
                                </Text>
                            ) : null}
                            <Checkbox
                                checked={saved}
                                onChange={setSaved}
                                label={t(
                                    "securitySettings.iVeSavedMyRecoveryKey",
                                )}
                                labelClassName={checkboxLabelClass}
                                className="items-start gap-2"
                            />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ disabled: !saved }}
                                onPress={finishSetup}
                                disabled={!saved}
                                className={`self-start ${accentButtonClass}`}
                            >
                                <Text className={accentButtonTextClass}>
                                    {t("securitySettings.done")}
                                </Text>
                            </Pressable>
                        </View>
                    ) : null}

                    {approvalPrompt()}

                    {error ? (
                        <Text className="text-sm text-discord-danger">
                            {error}
                        </Text>
                    ) : null}
                </View>
            ) : step === "done" || recoveryDone || resetView.blocking ? (
                <View className="rounded bg-discord-backgroundTertiary px-4 py-4 gap-3">
                    {/* The repair branch below lives in this same section, so this
                        header cannot be unconditional: "Recovery is set up" directly
                        above "the new recovery wasn't created" (and a status row
                        reading "Recovery (secure backup): Not set up") is three
                        statements on one security surface, and the reassuring one is
                        the false one. */}
                    {!resetView.blocking ? (
                        <View className="gap-1">
                            <Text className="text-sm font-medium text-discord-textPrimary">
                                {t("securitySettings.recoveryIsSetUp")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t("securitySettings.yourCrossSigningKeysAndA")}
                            </Text>
                            {/* This panel renders from the RETAINED payload, so when the
                                latest read didn't land it is a past reading like the rows
                                above — not a current claim that recovery is fine. */}
                            {panel.stale ? staleMarker() : null}
                        </View>
                    ) : (
                        // No stale marker here: this state is asserted from what the
                        // reset itself did on this session, not from a read.
                        <View className="gap-1">
                            <Text className="text-sm font-medium text-discord-textPrimary">
                                {t("securitySettings.recoveryIsNotSetUp")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t(
                                    "securitySettings.thisAccountHasNoRecoveryKey",
                                )}
                            </Text>
                        </View>
                    )}

                    {resetStep === "idle" &&
                    status?.crossSigningUnpublished &&
                    panel.authoritative ? (
                        <View className="gap-2 pt-3 border-t border-discord-divider">
                            <Text className="text-sm font-medium text-discord-warning">
                                {t("securitySettings.keysNotOnServer")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t("securitySettings.keysNotOnServerHint")}
                            </Text>
                            {oauthSession ? (
                                <Text className="text-xs text-discord-textMuted">
                                    {t(
                                        "securitySettings.approveOnAccountPageHint",
                                    )}
                                </Text>
                            ) : (
                                passwordInput(publishBusy, () => {
                                    void runPublish();
                                })
                            )}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{
                                    disabled: publishBusy || publishBlocked,
                                }}
                                onPress={() => {
                                    void runPublish();
                                }}
                                disabled={publishBusy || publishBlocked}
                                className={`self-start ${accentButtonClass}`}
                            >
                                <Text className={accentButtonTextClass}>
                                    {publishBusy
                                        ? t("securitySettings.working")
                                        : t("securitySettings.uploadKeys")}
                                </Text>
                            </Pressable>
                        </View>
                    ) : null}

                    {resetStep === "idle" ? (
                        // Reset destroys the current recovery key and backup. It is
                        // offered ONLY on top of a reading that landed: on a failed
                        // read we might be looking at a retained/blank posture, and
                        // the notice above already says so.
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{
                                disabled: !panel.allowDestructive,
                            }}
                            onPress={beginReset}
                            disabled={!panel.allowDestructive}
                            className="self-start disabled:opacity-50"
                        >
                            <Text
                                className={`text-xs text-discord-textMuted ${
                                    panel.allowDestructive ? "underline" : ""
                                }`}
                            >
                                {t(
                                    "securitySettings.lostYourRecoveryKeyResetRecovery",
                                )}
                            </Text>
                        </Pressable>
                    ) : resetStep === "confirm" ? (
                        <View className="gap-2 pt-3 border-t border-discord-divider">
                            <Text className="text-xs text-discord-warning">
                                {t("securitySettings.resettingCreatesA")}{" "}
                                <Text className="font-bold">
                                    {t("securitySettings.new")}
                                </Text>{" "}
                                {t(
                                    "securitySettings.recoveryKeyAndReplacesYourCurrent",
                                )}
                            </Text>
                            <View className="flex-row gap-2">
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() =>
                                        advanceReset({ type: "confirmed" })
                                    }
                                    className={dangerButtonClass}
                                >
                                    <Text className={accentButtonTextClass}>
                                        {t("securitySettings.continue")}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={cancelReset}
                                    className={secondaryButtonClass}
                                >
                                    <Text className={secondaryButtonTextClass}>
                                        {t("common.cancel")}
                                    </Text>
                                </Pressable>
                            </View>
                        </View>
                    ) : resetView.blocking ? (
                        // The destructive half succeeded and the replacement never
                        // landed, so this account has NO recovery right now. Its own
                        // copy (not the generic error, which reads as "try that again"),
                        // its own submit — `runRepair` runs the SETUP half alone — and
                        // no cancel: re-running the reset from here would wipe a second
                        // time, and leaving quietly strands the account (CRYPTO-01).
                        <View className="gap-2 pt-3 border-t border-discord-divider">
                            <Text className="text-xs text-discord-warning">
                                {t(
                                    "securitySettings.yourOldRecoveryKeyAndBackup",
                                )}
                            </Text>
                            {!oauthSession
                                ? passwordInput(resetView.busy, () => {
                                      void runRepair();
                                  })
                                : null}
                            {passphraseFields(resetView.busy)}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{
                                    disabled: resetView.busy || setupBlocked,
                                }}
                                onPress={() => {
                                    void runRepair();
                                }}
                                disabled={resetView.busy || setupBlocked}
                                className={`self-start ${accentButtonClass}`}
                            >
                                <Text className={accentButtonTextClass}>
                                    {resetView.busy
                                        ? t("securitySettings.working")
                                        : t(
                                              "securitySettings.finishSettingUpRecovery",
                                          )}
                                </Text>
                            </Pressable>
                        </View>
                    ) : resetStep === "password" ||
                      resetStep === "destroying" ? (
                        <View className="gap-2 pt-3 border-t border-discord-divider">
                            {oauthSession ? (
                                <Text className="text-xs text-discord-textMuted">
                                    {t(
                                        "securitySettings.approveOnAccountPageHint",
                                    )}
                                </Text>
                            ) : (
                                <>
                                    <Text className="text-xs text-discord-textMuted">
                                        {t(
                                            "securitySettings.confirmYourAccountPasswordToReset",
                                        )}
                                    </Text>
                                    {passwordInput(resetView.busy, () => {
                                        void runReset();
                                    })}
                                </>
                            )}
                            {passphraseFields(resetView.busy)}
                            <View className="flex-row gap-2">
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        disabled:
                                            resetView.busy || setupBlocked,
                                    }}
                                    onPress={() => {
                                        void runReset();
                                    }}
                                    disabled={resetView.busy || setupBlocked}
                                    className={dangerButtonClass}
                                >
                                    <Text className={accentButtonTextClass}>
                                        {resetView.busy
                                            ? t("securitySettings.resetting")
                                            : t(
                                                  "securitySettings.resetCreateNewKey",
                                              )}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        disabled: resetView.busy,
                                    }}
                                    onPress={cancelReset}
                                    disabled={resetView.busy}
                                    className={secondaryButtonClass}
                                >
                                    <Text className={secondaryButtonTextClass}>
                                        {t("common.cancel")}
                                    </Text>
                                </Pressable>
                            </View>
                        </View>
                    ) : null}

                    {approvalPrompt()}

                    {error ? (
                        <Text className="text-sm text-discord-danger">
                            {error}
                        </Text>
                    ) : null}
                </View>
            ) : null}

            {/* Message-history backup + restore-on-this-session (Layer 3).
                Gated on an authoritative read: `backupBadge`/`backupSummaryLabel` would
                otherwise say "No backup" from a failed read's `exists: false`, which
                means "we don't know" — and that line is what talks users into resetting
                recovery they still have (audit CRYPTO-02). The notice above covers it. */}
            {panel.authoritative && backup ? (
                <View className="rounded bg-discord-backgroundTertiary px-4 py-4 gap-3">
                    <View className="flex-row items-center justify-between gap-3">
                        <Text className="flex-1 text-sm font-medium text-discord-textPrimary">
                            {t("securitySettings.messageHistoryBackup")}
                        </Text>
                        {badge ? (
                            <Badge
                                box={
                                    badge.tone === "active"
                                        ? "bg-discord-online/20"
                                        : badge.tone === "warning"
                                          ? "bg-discord-warning/20"
                                          : "bg-discord-messageHover"
                                }
                                text={
                                    badge.tone === "active"
                                        ? "text-discord-online"
                                        : badge.tone === "warning"
                                          ? "text-discord-warning"
                                          : "text-discord-textMuted"
                                }
                                label={badge.label}
                            />
                        ) : null}
                    </View>
                    {summary ? (
                        <Text className="text-xs text-discord-textMuted">
                            {summary}
                        </Text>
                    ) : null}
                    {detailLines.length > 0 ? (
                        <View className="gap-0.5" role="list">
                            {detailLines.map((line) => (
                                <Text
                                    key={line}
                                    role="listitem"
                                    className="text-xs text-discord-textMuted"
                                >
                                    {line}
                                </Text>
                            ))}
                        </View>
                    ) : null}
                    {/* The `exists` gate is load-bearing: matchesDecryptionKey is false
                        both when no backup exists at all and when this session has
                        simply never unlocked one, so rendering it ungated asserts a
                        mismatch against a backup that may not exist. "Not loaded" is
                        truthful for every off-state the single boolean can represent. */}
                    {backup.exists
                        ? statusRow(
                              "Backup key on this session",
                              backup.matchesDecryptionKey,
                              "Matches",
                              "Not loaded",
                          )
                        : null}

                    {needsUnlock ? (
                        unlockStep === "idle" ? (
                            <View className="flex-row flex-wrap gap-2">
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={beginUnlock}
                                    className={accentButtonClass}
                                >
                                    <Text className="text-white text-sm font-medium">
                                        {t(
                                            "securitySettings.verifyThisSessionRestoreHistory",
                                        )}
                                    </Text>
                                </Pressable>
                                {canVerifyWithDevice ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => {
                                            void startVerifyWithAnotherDevice();
                                        }}
                                        className={secondaryButtonClass}
                                    >
                                        <Text className="text-discord-textPrimary text-sm font-medium">
                                            {t(
                                                "verification.verifyWithAnotherDevice",
                                            )}
                                        </Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        ) : unlockStep === "entry" ? (
                            <View className="gap-2">
                                {canUnlockByPassphrase ? (
                                    <View className="flex-row gap-2">
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                selected: unlockMode === "key",
                                            }}
                                            onPress={() => setUnlockMode("key")}
                                            className={`px-2 py-1 rounded ${
                                                unlockMode === "key"
                                                    ? "bg-discord-accent"
                                                    : "bg-discord-messageHover"
                                            }`}
                                        >
                                            <Text
                                                className={`text-xs ${
                                                    unlockMode === "key"
                                                        ? "text-white"
                                                        : "text-discord-textPrimary"
                                                }`}
                                            >
                                                {t(
                                                    "securitySettings.recoveryKey2",
                                                )}
                                            </Text>
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                selected:
                                                    unlockMode === "passphrase",
                                            }}
                                            onPress={() =>
                                                setUnlockMode("passphrase")
                                            }
                                            className={`px-2 py-1 rounded ${
                                                unlockMode === "passphrase"
                                                    ? "bg-discord-accent"
                                                    : "bg-discord-messageHover"
                                            }`}
                                        >
                                            <Text
                                                className={`text-xs ${
                                                    unlockMode === "passphrase"
                                                        ? "text-white"
                                                        : "text-discord-textPrimary"
                                                }`}
                                            >
                                                {t(
                                                    "securitySettings.passphrase",
                                                )}
                                            </Text>
                                        </Pressable>
                                    </View>
                                ) : null}
                                <Text className="text-xs text-discord-textMuted">
                                    {t("securitySettings.enterYour")}{" "}
                                    <Text className="font-bold">
                                        {effectiveUnlockMode === "key"
                                            ? t("securitySettings.recoveryKey")
                                            : t(
                                                  "securitySettings.recoveryPassphrase2",
                                              )}
                                    </Text>{" "}
                                    {t(
                                        "securitySettings.toVerifyThisSessionAndRestore",
                                    )}
                                </Text>
                                {effectiveUnlockMode === "key" ? (
                                    <TextInput
                                        value={unlockKey}
                                        onChangeText={setUnlockKey}
                                        placeholder={t(
                                            "securitySettings.recoveryKey2",
                                        )}
                                        placeholderTextColorClassName="accent-discord-textMuted"
                                        accessibilityLabel={t(
                                            "securitySettings.recoveryKey2",
                                        )}
                                        autoComplete="off"
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        spellCheck={false}
                                        returnKeyType="done"
                                        onSubmitEditing={() => {
                                            if (unlockReady) void runUnlock();
                                        }}
                                        className="w-full bg-discord-backgroundDark text-discord-textPrimary font-mono text-sm rounded px-3 py-1.5 outline-none"
                                    />
                                ) : (
                                    <TextInput
                                        secureTextEntry
                                        value={unlockPassphrase}
                                        onChangeText={setUnlockPassphrase}
                                        placeholder={t(
                                            "securitySettings.recoveryPassphrase",
                                        )}
                                        placeholderTextColorClassName="accent-discord-textMuted"
                                        accessibilityLabel={t(
                                            "securitySettings.recoveryPassphrase",
                                        )}
                                        autoComplete="current-password"
                                        textContentType="password"
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        returnKeyType="done"
                                        onSubmitEditing={() => {
                                            if (unlockReady) void runUnlock();
                                        }}
                                        className={inputClass}
                                    />
                                )}
                                <View className="flex-row gap-2">
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityState={{
                                            disabled: !unlockReady,
                                        }}
                                        onPress={() => {
                                            void runUnlock();
                                        }}
                                        disabled={!unlockReady}
                                        className={accentButtonClass}
                                    >
                                        <Text className={accentButtonTextClass}>
                                            {t("securitySettings.continue")}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={cancelUnlock}
                                        className={secondaryButtonClass}
                                    >
                                        <Text
                                            className={secondaryButtonTextClass}
                                        >
                                            {t("common.cancel")}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : unlockStep === "working" ? (
                            <View className="gap-2">
                                <Text className="text-sm text-discord-textPrimary">
                                    {progressView.label}
                                </Text>
                                <View className="h-1.5 w-full rounded bg-discord-backgroundDark overflow-hidden">
                                    <View
                                        className="h-full bg-discord-accent transition-all"
                                        style={{
                                            width: `${progressView.percent ?? 15}%`,
                                        }}
                                    />
                                </View>
                            </View>
                        ) : null
                    ) : canVerifyWithDevice ? (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                                void startVerifyWithAnotherDevice();
                            }}
                            className={`self-start ${accentButtonClass}`}
                        >
                            <Text className="text-white text-sm font-medium">
                                {t("verification.verifyWithAnotherDevice")}
                            </Text>
                        </Pressable>
                    ) : null}

                    {unlockStep === "done" && unlockResult ? (
                        <View className="gap-2">
                            <Text className="text-sm font-medium text-discord-online">
                                {unlockResult.sessionVerified
                                    ? t(
                                          "securitySettings.thisSessionIsNowVerified",
                                      )
                                    : t(
                                          "securitySettings.encryptedHistoryRestored",
                                      )}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {restoreResultLabel(unlockResult)}.
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                onPress={finishUnlock}
                                className={`self-start ${secondaryButtonClass}`}
                            >
                                <Text className={secondaryButtonTextClass}>
                                    {t("securitySettings.done")}
                                </Text>
                            </Pressable>
                        </View>
                    ) : null}

                    {unlockError ? (
                        <Text className="text-sm text-discord-danger">
                            {unlockError}
                        </Text>
                    ) : null}
                </View>
            ) : null}

            <KeyExportSettings />
        </View>
    );
}
