import { Checkbox, openLink, Spin } from "@-/com.leonsilicon.zami.rn";
import { useDeepRune, useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as WebBrowser from "expo-web-browser";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from "react";
import {
    AccessibilityInfo,
    Pressable,
    Text,
    TextInput,
    View,
    type TextInputInstance,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "$lib/i18n";
import { page } from "$app/state";
import { replaceState } from "$app/navigation";
import {
    login,
    register,
    getLoginOptions,
    loginWithOAuthCode,
    loginWithSsoToken,
    probeRegistration,
    checkUsernameAvailable,
} from "$lib/matrix/client";
import {
    RegistrationCancelledError,
    flowNeedsToken,
    usernameIssue,
    type RegistrationPrompt,
    type RegistrationSupport,
} from "$lib/matrix/registration";
import { rememberSignInPassword } from "$lib/stores/onboarding.svelte";
import {
    beginSsoLogin,
    hasSsoParams,
    readSsoCallback,
    withoutSsoParams,
} from "$lib/matrix/sso";
import {
    OAuthRegistrationRefusedError,
    beginOAuthLogin,
    hasOAuthParams,
    readOAuthCallback,
    withoutOAuthParams,
    type OAuthCallback,
} from "$lib/matrix/oauth";
import {
    listenForLoginCallbacks,
    loginLeavesPage,
} from "$lib/matrix/loginRedirect";
import type { ValidatedAuthMetadata } from "matrix-js-sdk";
import QrSignInPanel from "$lib/components/layout/QrSignInPanel.svelte";
import { isQrLoginAvailable, type QrSignInResult } from "$lib/matrix/qrLogin";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import { pickSignInMethod, type LoginOptions } from "$lib/utils/loginFlows";
import { auth, loadLastHomeserver } from "$lib/stores/auth.svelte";
import { accountsState } from "$lib/stores/accounts.svelte";
import {
    getDefaultHomeserver,
    INSTALLED_APP_DEFAULT_HOMESERVER as PUBLIC_HOMESERVER,
} from "$lib/config";
import { parseLoginUsername } from "$lib/utils/loginIdentity";
import { requestWebPushPermission } from "$lib/webPush";
import AccountAvatar from "$lib/components/layout/AccountAvatar.svelte";
// Zami: upstream's `Capacitor` import served startSso's "leaves the page"
// test, which is loginLeavesPage() here (see startSso).
import { CAN_INSTALL_UPDATE } from "$lib/update";
import { DOWNLOAD_URL, GITHUB_URL, WEBSITE_URL } from "$lib/links";

interface Props {
    isAddAccountMode: boolean;
    onAuthenticated: (result: {
        userId: string;
        accessToken: string;
        deviceId: string;
        homeserverUrl: string;
        refreshToken?: string;
        oauth?: { clientId: string; issuer: string };
        accessTokenExpiresAt?: number;
    }) => void | Promise<void>;
    onContinueAs: (userId: string) => void;
    onBackToActive: () => void;
}

/**
 * Zami: `$state` that code can read back at once. Svelte reads its state
 * synchronously after setting it (applyFullUserId fills in the homeserver
 * that handleLogin then reads) and after an await, where React's state is the
 * render's. `live.current` is always the value last set.
 */
function useLiveState<T>(
    initial: T | (() => T),
): readonly [T, (next: T) => void, { readonly current: T }] {
    const [value, setValue] = useState<T>(initial);
    const live = useRef(value);
    const set = useCallback((next: T) => {
        live.current = next;
        setValue(() => next);
    }, []);
    return [value, set, live] as const;
}

/**
 * Zami: a registration step's page (a policy, the captcha or fallback page)
 * opens in the in-app browser (SFSafariViewController on iOS), which the user
 * closes to come back to the step; the system browser if that can't open.
 */
function openInApp(url: string): void {
    void WebBrowser.openBrowserAsync(url).catch(() => openLink(url));
}

// Zami: not ported: the document <title> ("Sign in · Zam"); an app has none.
// `space-y-*` → `gap-*`; on the web `space-y-4` overrides the submit buttons'
// `mt-2`, so it is dropped. `aria-invalid` / `aria-describedby` have no React
// Native equivalent: the error (an alert) and the hints are read in order.
export default function LoginView({
    isAddAccountMode,
    onAuthenticated,
    onContinueAs,
    onBackToActive,
}: Props) {
    const [defaultHomeserver] = useState(getDefaultHomeserver);
    const [homeserverUrl, setHomeserverUrl, homeserverUrlLive] = useLiveState(
        () => loadLastHomeserver() ?? defaultHomeserver,
    );
    // Signed-in accounts offered by the "continue as" list (only when no
    // account is active, e.g. after a session expiry).
    const dormantAccounts = useDeepRune(() =>
        accountsState.registry.activeUserId === null
            ? accountsState.registry.accounts
            : [],
    );
    // Zami: read here for the "back to" link below.
    const activeUserId = useRune(() => accountsState.registry.activeUserId);
    const [username, setUsername, usernameLive] = useLiveState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [registrationToken, setRegistrationToken] = useState("");
    const [isLoading, setIsLoading, isLoadingLive] = useLiveState(false);
    const [error, setError] = useState("");
    const [statusMsg, setStatusMsg] = useState("");
    const [mode, setModeState] = useState<"login" | "register">("login");
    // On by default: servers without sliding sync fall back to regular sync
    // on first start (see buildSlidingSync in client.ts).
    // Zami: off by default instead, because sliding sync breaks signing in to
    // Beeper. It can still be turned on here or in Debug settings.
    const [useSlidingSync, setUseSlidingSync] = useState(false);
    // Non-blocking note while an SSO flow runs in another window (desktop /
    // Android), where this form stays usable in case the user abandons it.
    // Zami: and over the Expo app, in its auth session.
    const [ssoHint, setSsoHint] = useState("");

    function hostOf(value: string): string {
        return value
            .trim()
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, "")
            .toLowerCase();
    }
    // A server that is closed to sign-ups offers matrix.org instead.
    function usePublicServer() {
        if (isLoadingLive.current) return;
        setHomeserverUrl(PUBLIC_HOMESERVER);
        setError("");
        void refreshLoginOptions();
    }
    // Sliding sync and other knobs most people never need to touch.
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Sign-in methods the typed homeserver offers (GET /login). null = not
    // known (yet, or the lookup failed): the password form is shown then.
    const [loginOptions, setLoginOptions] = useState<LoginOptions | null>(null);
    const [optionsBaseUrl, setOptionsBaseUrl, optionsBaseUrlLive] =
        useLiveState("");
    // The homeserver's native OAuth metadata, when it publishes any. Sign-in
    // goes through it when present; the password and SSO paths are the
    // fallback for servers without it (or that refused to register this app).
    const [oauthMeta, setOauthMeta] = useState<ValidatedAuthMetadata | null>(
        null,
    );
    const [oauthRefused, setOauthRefused] = useState(false);
    // QR sign-in: offered when the provider grants by device code.
    const [showQr, setShowQr] = useState(false);
    const [optionsFor, setOptionsFor, optionsForLive] = useLiveState("");
    const [optionsLoading, setOptionsLoading] = useState(false);
    const optionsRequest = useRef(0);
    const redeemingSso = useRef(false);

    const signInMethod = pickSignInMethod(oauthRefused ? null : oauthMeta);
    const useOAuth = signInMethod === "oauth";
    const qrAvailable = !oauthRefused && isQrLoginAvailable(oauthMeta);

    async function finishQrSignIn(result: QrSignInResult) {
        // Same as the other sign-ins: show progress while the session starts,
        // and report a failed start here (the QR panel's own handler swallows
        // errors once it is closed, which left a login form that looked hung).
        setIsLoading(true);
        setStatusMsg(t("loginView.loggingIn"));
        setShowQr(false);
        if (result.method === "rendezvous" && !result.secretsImported)
            showErrorToast(t("qrLogin.notVerified"));
        try {
            await onAuthenticated(result.session);
        } catch (err) {
            console.warn("[qr-login] could not start the session", err);
            setError(
                err instanceof Error ? err.message : t("loginView.oauthFailed"),
            );
            setIsLoading(false);
            setStatusMsg("");
        }
    }
    const showPasswordForm =
        !useOAuth &&
        (mode === "register" || !loginOptions || loginOptions.password);
    const sso = useOAuth ? null : (loginOptions?.sso ?? null);
    // The shown sign-in options belong to the address in the field. Until a
    // changed address has been looked up, Log In and SSO stay disabled so
    // neither can act on the previous server's answer.
    const optionsCurrent =
        !optionsLoading && homeserverUrl.trim() === optionsFor;
    // The server's name as typed (matrix.org), not the API host its
    // well-known delegates to (matrix-client.matrix.org): it is the part
    // after the colon in user ids, and the name people know.
    const serverHost = hostOf(optionsFor || homeserverUrl);
    // Where an OAuth server's sign-in page lives, named on its button.
    const providerHost = oauthMeta ? hostOf(oauthMeta.issuer) : "";

    // ── Registration (legacy /register; OAuth servers sign up on their page) ──
    // What the server allows, probed once per server while in register mode.
    const [regSupport, setRegSupport] = useState<RegistrationSupport | null>(
        null,
    );
    const regSupportFor = useRef("");
    useEffect(() => {
        if (mode !== "register" || useOAuth || !optionsCurrent) return;
        const base = optionsBaseUrl;
        if (!base || base === regSupportFor.current) return;
        regSupportFor.current = base;
        setRegSupport(null);
        void probeRegistration(base).then((support) => {
            if (optionsBaseUrlLive.current === base) setRegSupport(support);
        });
    }, [mode, useOAuth, optionsCurrent, optionsBaseUrl, optionsBaseUrlLive]);
    const registrationClosed =
        mode === "register" && !useOAuth && regSupport?.kind === "closed";
    // The token field only when the server's flow needs one (or we can't tell).
    const showTokenField =
        regSupport?.kind === "open"
            ? flowNeedsToken(regSupport.flow) || regSupport.needsToken
            : true;
    const tokenRequired = regSupport?.kind === "open" && regSupport.needsToken;

    // Username availability, checked as the user types (register mode).
    const [nameCheck, setNameCheck] = useState<{
        name: string;
        available: boolean | null;
        issue?: string;
    } | null>(null);
    const localUsernameIssue =
        mode === "register" ? usernameIssue(username.trim()) : null;
    useEffect(() => {
        const name = username.trim();
        const base = optionsBaseUrl;
        if (
            mode !== "register" ||
            useOAuth ||
            !optionsCurrent ||
            !base ||
            !name ||
            name.startsWith("@") ||
            usernameIssue(name)
        ) {
            setNameCheck(null);
            return;
        }
        const timer = setTimeout(() => {
            void checkUsernameAvailable(base, name).then((r) => {
                if (
                    usernameLive.current.trim() === name &&
                    optionsBaseUrlLive.current === base
                )
                    setNameCheck({ name, ...r });
            });
        }, 500);
        return () => clearTimeout(timer);
    }, [
        username,
        optionsBaseUrl,
        mode,
        useOAuth,
        optionsCurrent,
        usernameLive,
        optionsBaseUrlLive,
    ]);
    const nameTaken =
        nameCheck?.name === username.trim() && nameCheck.available === false;
    const passwordsMismatch =
        mode === "register" &&
        confirmPassword.length > 0 &&
        confirmPassword !== password;
    const canSubmitPasswordForm =
        !!username &&
        !!password &&
        (mode === "login" ||
            (confirmPassword === password &&
                !localUsernameIssue &&
                !nameTaken &&
                !registrationClosed &&
                (!tokenRequired || !!registrationToken.trim())));

    // A registration step waiting on the user (token, terms, captcha,
    // email). `resolve` hands the answer back to runRegistration.
    const [stage, setStage, stageLive] = useLiveState<{
        prompt: RegistrationPrompt;
        resolve: (answer: string | null) => void;
    } | null>(null);
    const [stageToken, setStageToken] = useState("");
    const [stageAccepted, setStageAccepted] = useState(false);
    const [stageEmail, setStageEmail] = useState("");
    const [stageEmailSent, setStageEmailSent] = useState(false);
    const [stageBusy, setStageBusy] = useState(false);
    const [stageError, setStageError] = useState("");

    function promptStage(prompt: RegistrationPrompt): Promise<string | null> {
        return new Promise((resolve) => {
            setStageToken("");
            setStageAccepted(false);
            setStageEmailSent(prompt.kind === "email" && prompt.sent);
            setStageBusy(false);
            setStageError("");
            setStage({ prompt, resolve });
        });
    }
    function answerStage(answer: string | null) {
        const pending = stageLive.current;
        setStage(null);
        pending?.resolve(answer);
    }
    async function sendStageEmail() {
        const prompt = stage?.prompt;
        if (prompt?.kind !== "email" || !stageEmail.trim() || stageBusy) return;
        setStageBusy(true);
        setStageError("");
        try {
            await prompt.requestToken(stageEmail.trim());
            setStageEmailSent(true);
        } catch (err) {
            setStageError(
                err instanceof Error
                    ? err.message
                    : t("loginView.registrationFailed"),
            );
        } finally {
            setStageBusy(false);
        }
    }
    // Leaving the form mid-step must not strand the registration promise.
    // Zami: answerStage reads only refs and setters, so the first render's does.
    useEffect(() => () => answerStage(null), []);

    async function refreshLoginOptions(): Promise<void> {
        const typed = homeserverUrlLive.current.trim();
        if (!typed || typed === optionsForLive.current) return;
        const request = ++optionsRequest.current;
        setOptionsFor(typed);
        setOptionsLoading(true);
        try {
            const { baseUrl, options, oauth } = await getLoginOptions(typed);
            if (request !== optionsRequest.current) return;
            setLoginOptions(options);
            setOauthMeta(oauth);
            setOauthRefused(false);
            setOptionsBaseUrl(baseUrl);
        } catch {
            if (request !== optionsRequest.current) return;
            // Unknown: fall back to the password form. optionsFor keeps the
            // failed address so it is only retried once the field changes.
            setLoginOptions(null);
            setOauthMeta(null);
            setOptionsBaseUrl("");
        } finally {
            if (request === optionsRequest.current) setOptionsLoading(false);
        }
    }

    // Re-read the sign-in methods as the homeserver field settles.
    useEffect(() => {
        const typed = homeserverUrl.trim();
        if (typed === optionsFor) return;
        const timer = setTimeout(() => void refreshLoginOptions(), 600);
        return () => clearTimeout(timer);
        // Zami: refreshLoginOptions reads only refs and setters, so any render's does.
    }, [homeserverUrl, optionsFor]);

    function setMode(next: "login" | "register") {
        setModeState(next);
        setError("");
        setConfirmPassword("");
    }

    async function startOAuth() {
        if (
            !oauthMeta ||
            !optionsBaseUrl ||
            !optionsCurrent ||
            isLoadingLive.current
        )
            return;
        setError("");
        void requestWebPushPermission().catch(() => {});
        setIsLoading(true);
        setStatusMsg(t("loginView.redirectingToSso"));
        try {
            await beginOAuthLogin({
                baseUrl: optionsBaseUrl,
                metadata: oauthMeta,
                register: mode === "register",
                slidingSync: useSlidingSync,
            });
        } catch (err) {
            setIsLoading(false);
            setStatusMsg("");
            if (err instanceof OAuthRegistrationRefusedError) {
                // Fall back to whatever the server still offers.
                setOauthRefused(true);
                setError(
                    loginOptions?.password || loginOptions?.sso
                        ? t("loginView.oauthRegistrationRefusedFallback")
                        : t("loginView.oauthRegistrationRefused"),
                );
            } else {
                console.warn("[oauth] could not start sign-in", err);
                setError(t("loginView.oauthFailed"));
            }
            return;
        }
        if (!loginLeavesPage()) {
            // The provider opened in another window; keep the form usable in
            // case the user abandons it.
            setIsLoading(false);
            setStatusMsg("");
            setSsoHint(t("loginView.finishSsoInBrowser"));
        }
    }

    function startSso(idpId?: string) {
        if (!sso || !optionsBaseUrl || !optionsCurrent) return;
        setError("");
        void requestWebPushPermission().catch(() => {});
        // Zami: upstream tests `!window.desktop?.sso && !Capacitor.isNativePlatform()`,
        // which is loginLeavesPage(); its Zami copy also knows that the Expo
        // app's auth session opens over the page instead.
        const leavesPage = loginLeavesPage();
        try {
            beginSsoLogin({
                baseUrl: optionsBaseUrl,
                loginType: sso.loginType,
                idpId,
                register: mode === "register",
                slidingSync: useSlidingSync,
                addMode: isAddAccountMode,
            });
        } catch (err) {
            setError(
                err instanceof Error ? err.message : t("loginView.ssoFailed"),
            );
            return;
        }
        if (leavesPage) {
            setIsLoading(true);
            setStatusMsg(t("loginView.redirectingToSso"));
        } else {
            setSsoHint(t("loginView.finishSsoInBrowser"));
        }
    }

    // Drop the sign-in result (loginToken / sso_state, or the OAuth code /
    // state) from the address bar (web) so a reload or a bookmark never
    // replays it.
    function stripSsoParamsFromUrl() {
        const here = new URL(window.location.href);
        if (!hasSsoParams(here) && !hasOAuthParams(here)) return;
        const clean = withoutOAuthParams(withoutSsoParams(here));
        try {
            replaceState(clean, page.state);
        } catch {
            history.replaceState(history.state, "", clean);
        }
    }

    async function handleSsoCallback(rawUrl: string) {
        const result = readSsoCallback(rawUrl);
        stripSsoParamsFromUrl();
        if (!result) return;
        setSsoHint("");
        if (result.kind === "invalid") {
            setError(t("loginView.ssoCouldNotBeVerified"));
            return;
        }
        if (redeemingSso.current) return;
        redeemingSso.current = true;
        setError("");
        setIsLoading(true);
        setStatusMsg(t("loginView.loggingIn"));
        setHomeserverUrl(result.pending.baseUrl);
        try {
            const session = await loginWithSsoToken(
                result.pending.baseUrl,
                result.loginToken,
                result.pending.slidingSync,
            );
            await onAuthenticated(session);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : t("loginView.ssoFailed"),
            );
            setIsLoading(false);
            setStatusMsg("");
        } finally {
            redeemingSso.current = false;
        }
    }

    async function handleOAuthResult(result: OAuthCallback) {
        setSsoHint("");
        if (result.kind === "invalid") {
            setError(t("loginView.oauthCouldNotBeVerified"));
            return;
        }
        // Back on the server the attempt started on, so a retry needs no retyping.
        setHomeserverUrl(result.pending.baseUrl);
        if (result.kind === "denied") {
            setError(
                result.error === "access_denied"
                    ? t("loginView.oauthCancelled")
                    : t("loginView.oauthDenied", {
                          reason: result.description || result.error,
                      }),
            );
            return;
        }
        if (redeemingSso.current) return;
        redeemingSso.current = true;
        setError("");
        setIsLoading(true);
        setStatusMsg(t("loginView.loggingIn"));
        try {
            let session;
            try {
                session = await loginWithOAuthCode(result.pending, result.code);
            } catch (err) {
                console.warn("[oauth] sign-in failed", err);
                setError(t("loginView.oauthFailed"));
                setIsLoading(false);
                setStatusMsg("");
                return;
            }
            try {
                await onAuthenticated(session);
            } catch (err) {
                setError(
                    err instanceof Error
                        ? err.message
                        : t("loginView.oauthFailed"),
                );
                setIsLoading(false);
                setStatusMsg("");
            }
        } finally {
            redeemingSso.current = false;
        }
    }

    function handleLoginCallback(rawUrl: string) {
        const oauthResult = readOAuthCallback(rawUrl);
        if (oauthResult) {
            stripSsoParamsFromUrl();
            void handleOAuthResult(oauthResult);
            return;
        }
        void handleSsoCallback(rawUrl);
    }

    // Zami: the listener below outlives the render that registered it, so it
    // calls the latest handler (which sees the latest props).
    const loginCallback = useRef(handleLoginCallback);
    useEffect(() => {
        loginCallback.current = handleLoginCallback;
    });
    useEffect(() => {
        // Surface a session-expiry / restore-failure message handed over via the
        // auth store (expiry now flips state in place — no route hop — so the
        // store is only a one-shot display carrier here).
        if (auth.error) {
            setError(auth.error);
            auth.error = null;
        }
        void refreshLoginOptions();
        return listenForLoginCallbacks(
            (rawUrl) => loginCallback.current(rawUrl),
            (url) => hasSsoParams(url) || hasOAuthParams(url),
        );
        // Zami: onMount. refreshLoginOptions reads only refs and setters.
    }, []);

    // Let the user type a full "@user:homeserver" MXID — split it into the bare
    // username and auto-fill the homeserver (mirrors the pre-merge login form).
    function applyFullUserId(): string {
        const parsed = parseLoginUsername(usernameLive.current);
        setUsername(parsed.username);
        if (parsed.homeserver) setHomeserverUrl(parsed.homeserver);
        return parsed.username;
    }

    async function handleLogin() {
        setError("");
        setStatusMsg("");
        setIsLoading(true);
        try {
            const loginUsername = applyFullUserId();
            // Fire-and-forget: the notification/web-push permission prompt must
            // never block sign-in (awaiting it hangs login until the user
            // answers the prompt — or forever if they don't).
            void requestWebPushPermission().catch(() => {});
            let url = homeserverUrlLive.current.trim();
            if (!url.startsWith("http")) url = "https://" + url;
            url = url.replace(/\/$/, "");
            setStatusMsg(t("loginView.loggingIn"));
            const result = await login(
                url,
                loginUsername,
                password,
                useSlidingSync,
            );
            rememberSignInPassword(result.userId, password);
            await onAuthenticated(result);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : t("loginView.loginFailedCheckYourCredentials"),
            );
            setIsLoading(false);
            setStatusMsg("");
        }
    }

    async function handleRegister() {
        setError("");
        setStatusMsg("");
        setIsLoading(true);
        try {
            const registrationUsername = applyFullUserId();
            void requestWebPushPermission().catch(() => {});
            let url = homeserverUrlLive.current.trim();
            if (!url.startsWith("http")) url = "https://" + url;
            url = url.replace(/\/$/, "");
            setStatusMsg(t("loginView.creatingAccount"));
            const result = await register(url, registrationUsername, password, {
                registrationToken: registrationToken || undefined,
                slidingSync: useSlidingSync,
                prompt: promptStage,
            });
            setStatusMsg(t("loginView.loggingIn"));
            rememberSignInPassword(result.userId, password);
            await onAuthenticated(result);
        } catch (err) {
            setStage(null);
            setError(
                err instanceof RegistrationCancelledError
                    ? ""
                    : err instanceof Error
                      ? err.message
                      : t("loginView.registrationFailed"),
            );
            setIsLoading(false);
            setStatusMsg("");
        }
    }

    // Zami: the <form>'s onsubmit, which its submit buttons call.
    function submitForm() {
        if (!optionsCurrent) return;
        if (useOAuth) {
            void startOAuth();
            return;
        }
        void (mode === "login" ? handleLogin() : handleRegister());
    }
    // Zami: a <form>'s implicit submission: the return key in a field
    // submits it when its submit button is enabled, and otherwise moves on to
    // the next field, as a phone keyboard's return does.
    const canSubmitForm = useOAuth
        ? !isLoading && optionsCurrent
        : showPasswordForm &&
          !registrationClosed &&
          !isLoading &&
          optionsCurrent &&
          canSubmitPasswordForm;
    const usernameInput = useRef<TextInputInstance>(null);
    const passwordInput = useRef<TextInputInstance>(null);
    const confirmInput = useRef<TextInputInstance>(null);
    const tokenInput = useRef<TextInputInstance>(null);
    function submitOrFocus(next?: RefObject<TextInputInstance | null>) {
        if (canSubmitForm) submitForm();
        else next?.current?.focus();
    }

    // Zami: the live regions (role="alert", role="status" and the `sr-only`
    // lookup note) → an announcement whenever their text appears.
    const shownStatus = statusMsg && isLoading ? statusMsg : "";
    useEffect(() => {
        if (error) AccessibilityInfo.announceForAccessibility(error);
    }, [error]);
    useEffect(() => {
        if (shownStatus)
            AccessibilityInfo.announceForAccessibility(shownStatus);
    }, [shownStatus]);
    useEffect(() => {
        if (optionsLoading)
            AccessibilityInfo.announceForAccessibility(
                t("loginView.checkingServer"),
            );
    }, [optionsLoading]);

    const insets = useSafeAreaInsets();
    const prompt = stage?.prompt ?? null;
    // The username hint's `{@const name = username.trim()}`.
    const name = username.trim();

    return (
        <>
            {/* Zami: `min-height: 100dvh` → a scroll view filling the screen
                inside the safe area, which keeps the focused field above
                the keyboard. */}
            <KeyboardAwareScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{
                    flexGrow: 1,
                    paddingTop: insets.top,
                    paddingBottom: insets.bottom,
                }}
                keyboardShouldPersistTaps="handled"
                bottomOffset={16}
            >
                <View className="flex-1 flex-row items-center justify-center bg-discord-backgroundTertiary p-4">
                    <View className="w-full max-w-md">
                        {/* Card */}
                        <View className="bg-discord-background rounded-lg shadow-2xl p-8">
                            {/* Header */}
                            <View className="items-center mb-8">
                                <View className="items-center justify-center w-16 h-16 rounded-2xl bg-discord-accent mb-4">
                                    <Text className="text-3xl font-bold text-white">
                                        #
                                    </Text>
                                </View>
                                {mode === "login" ? (
                                    <>
                                        <Text
                                            accessibilityRole="header"
                                            className="text-2xl font-bold text-discord-textPrimary text-center"
                                        >
                                            {isAddAccountMode
                                                ? t("loginView.addAnAccount")
                                                : t("loginView.welcomeBack")}
                                        </Text>
                                        <Text className="text-discord-textSecondary mt-1 text-center">
                                            {isAddAccountMode
                                                ? t(
                                                      "loginView.signInWithAnotherMatrixAccount",
                                                  )
                                                : t(
                                                      "loginView.signInToYourMatrixAccount",
                                                  )}
                                        </Text>
                                    </>
                                ) : (
                                    <>
                                        <Text
                                            accessibilityRole="header"
                                            className="text-2xl font-bold text-discord-textPrimary text-center"
                                        >
                                            {t("loginView.createAnAccount")}
                                        </Text>
                                        <Text className="text-discord-textSecondary mt-1 text-center">
                                            {t(
                                                "loginView.registerOnAMatrixHomeserver",
                                            )}
                                        </Text>
                                    </>
                                )}
                            </View>

                            {/* Error banner */}
                            {error ? (
                                <View
                                    nativeID="login-error"
                                    accessibilityRole="alert"
                                    className="mb-4 p-3 bg-discord-danger/10 border border-discord-danger/30 rounded-lg"
                                >
                                    <Text className="text-discord-danger text-sm">
                                        {error}
                                    </Text>
                                </View>
                            ) : null}

                            {/* Status message */}
                            {statusMsg && isLoading ? (
                                <View
                                    accessibilityLiveRegion="polite"
                                    className="mb-4 p-3 bg-discord-accent/10 border border-discord-accent/30 rounded-lg flex-row items-center gap-3"
                                >
                                    <Spin className="w-4 h-4 border-2 border-discord-accent border-t-transparent rounded-full flex-shrink-0" />
                                    <Text className="flex-1 text-discord-accent text-sm">
                                        {statusMsg}
                                    </Text>
                                </View>
                            ) : null}

                            {/* A registration step the server asked for. Replaces the form
                                until answered: the form's values are mid-submission. */}
                            {prompt ? (
                                <View
                                    className="gap-3 p-4 rounded-lg bg-discord-backgroundSecondary border border-discord-divider"
                                    role="group"
                                    aria-labelledby="reg-stage-title"
                                >
                                    {prompt.kind === "token" ? (
                                        <>
                                            <Text
                                                nativeID="reg-stage-title"
                                                className="text-sm font-semibold text-discord-textPrimary"
                                            >
                                                {t("registration.tokenTitle")}
                                            </Text>
                                            <Text
                                                className={`text-xs ${
                                                    prompt.retry
                                                        ? "text-discord-danger"
                                                        : "text-discord-textMuted"
                                                }`}
                                            >
                                                {prompt.retry
                                                    ? t(
                                                          "registration.invalidToken",
                                                      )
                                                    : t(
                                                          "registration.tokenBody",
                                                          {
                                                              server: serverHost,
                                                          },
                                                      )}
                                            </Text>
                                            <TextInput
                                                value={stageToken}
                                                onChangeText={setStageToken}
                                                autoComplete="off"
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                                spellCheck={false}
                                                placeholder={t(
                                                    "loginView.registrationToken",
                                                )}
                                                accessibilityLabel={t(
                                                    "loginView.registrationToken",
                                                )}
                                                placeholderTextColorClassName="accent-discord-textMuted"
                                                onSubmitEditing={() => {
                                                    if (stageToken.trim())
                                                        answerStage(
                                                            stageToken.trim(),
                                                        );
                                                }}
                                                className="w-full px-3 py-2.5 bg-discord-background text-discord-textPrimary placeholder-discord-textMuted rounded border border-discord-divider focus:border-discord-accent focus:outline-none text-sm"
                                            />
                                            <View className="flex-row gap-2">
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        answerStage(
                                                            stageToken.trim(),
                                                        )
                                                    }
                                                    disabled={
                                                        !stageToken.trim()
                                                    }
                                                    className="flex-1 items-center py-2 bg-discord-accent hover:bg-discord-accentHover rounded disabled:opacity-60"
                                                >
                                                    <Text className="text-white font-semibold text-sm">
                                                        {t(
                                                            "loginView.continue",
                                                        )}
                                                    </Text>
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        answerStage(null)
                                                    }
                                                    className="px-4 py-2 bg-discord-messageHover rounded"
                                                >
                                                    <Text className="text-discord-textPrimary text-sm">
                                                        {t("common.cancel")}
                                                    </Text>
                                                </Pressable>
                                            </View>
                                        </>
                                    ) : prompt.kind === "terms" ? (
                                        <>
                                            <Text
                                                nativeID="reg-stage-title"
                                                className="text-sm font-semibold text-discord-textPrimary"
                                            >
                                                {t("registration.termsTitle")}
                                            </Text>
                                            <Text className="text-xs text-discord-textMuted">
                                                {t("registration.termsBody", {
                                                    server: serverHost,
                                                })}
                                            </Text>
                                            <View className="gap-1">
                                                {prompt.policies.map(
                                                    (policy) => (
                                                        <Text
                                                            key={policy.id}
                                                            accessibilityRole="link"
                                                            onPress={() =>
                                                                openInApp(
                                                                    policy.url,
                                                                )
                                                            }
                                                            className="text-sm text-discord-accent hover:underline"
                                                        >
                                                            {policy.name}
                                                        </Text>
                                                    ),
                                                )}
                                            </View>
                                            <Checkbox
                                                checked={stageAccepted}
                                                onChange={setStageAccepted}
                                                label={t(
                                                    "registration.termsAccept",
                                                )}
                                                labelClassName="flex-1 text-sm text-discord-textSecondary"
                                                className="items-start gap-2"
                                            />
                                            <View className="flex-row gap-2">
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        answerStage("accepted")
                                                    }
                                                    disabled={!stageAccepted}
                                                    className="flex-1 items-center py-2 bg-discord-accent hover:bg-discord-accentHover rounded disabled:opacity-60"
                                                >
                                                    <Text className="text-white font-semibold text-sm">
                                                        {t(
                                                            "loginView.continue",
                                                        )}
                                                    </Text>
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        answerStage(null)
                                                    }
                                                    className="px-4 py-2 bg-discord-messageHover rounded"
                                                >
                                                    <Text className="text-discord-textPrimary text-sm">
                                                        {t("common.cancel")}
                                                    </Text>
                                                </Pressable>
                                            </View>
                                        </>
                                    ) : prompt.kind === "email" ? (
                                        <>
                                            <Text
                                                nativeID="reg-stage-title"
                                                className="text-sm font-semibold text-discord-textPrimary"
                                            >
                                                {t("registration.emailTitle")}
                                            </Text>
                                            {!stageEmailSent ? (
                                                <>
                                                    <Text className="text-xs text-discord-textMuted">
                                                        {t(
                                                            "registration.emailBody",
                                                            {
                                                                server: serverHost,
                                                            },
                                                        )}
                                                    </Text>
                                                    <TextInput
                                                        value={stageEmail}
                                                        onChangeText={
                                                            setStageEmail
                                                        }
                                                        keyboardType="email-address"
                                                        autoComplete="email"
                                                        textContentType="emailAddress"
                                                        autoCapitalize="none"
                                                        autoCorrect={false}
                                                        placeholder={t(
                                                            "registration.emailPlaceholder",
                                                        )}
                                                        accessibilityLabel={t(
                                                            "registration.emailPlaceholder",
                                                        )}
                                                        placeholderTextColorClassName="accent-discord-textMuted"
                                                        editable={!stageBusy}
                                                        onSubmitEditing={() =>
                                                            void sendStageEmail()
                                                        }
                                                        className="w-full px-3 py-2.5 bg-discord-background text-discord-textPrimary placeholder-discord-textMuted rounded border border-discord-divider focus:border-discord-accent focus:outline-none text-sm disabled:opacity-60"
                                                    />
                                                    <View className="flex-row gap-2">
                                                        <Pressable
                                                            accessibilityRole="button"
                                                            onPress={() =>
                                                                void sendStageEmail()
                                                            }
                                                            disabled={
                                                                !stageEmail.trim() ||
                                                                stageBusy
                                                            }
                                                            className="flex-1 items-center py-2 bg-discord-accent hover:bg-discord-accentHover rounded disabled:opacity-60"
                                                        >
                                                            <Text className="text-white font-semibold text-sm">
                                                                {stageBusy
                                                                    ? t(
                                                                          "loginView.pleaseWait",
                                                                      )
                                                                    : t(
                                                                          "registration.sendEmail",
                                                                      )}
                                                            </Text>
                                                        </Pressable>
                                                        <Pressable
                                                            accessibilityRole="button"
                                                            onPress={() =>
                                                                answerStage(
                                                                    null,
                                                                )
                                                            }
                                                            className="px-4 py-2 bg-discord-messageHover rounded"
                                                        >
                                                            <Text className="text-discord-textPrimary text-sm">
                                                                {t(
                                                                    "common.cancel",
                                                                )}
                                                            </Text>
                                                        </Pressable>
                                                    </View>
                                                </>
                                            ) : (
                                                <>
                                                    <Text
                                                        className={`text-xs ${
                                                            prompt.sent
                                                                ? "text-discord-warning"
                                                                : "text-discord-textMuted"
                                                        }`}
                                                    >
                                                        {prompt.sent
                                                            ? t(
                                                                  "registration.emailNotConfirmed",
                                                              )
                                                            : t(
                                                                  "registration.emailSent",
                                                                  {
                                                                      email: stageEmail.trim(),
                                                                  },
                                                              )}
                                                    </Text>
                                                    <View className="flex-row gap-2">
                                                        <Pressable
                                                            accessibilityRole="button"
                                                            onPress={() =>
                                                                answerStage(
                                                                    "confirmed",
                                                                )
                                                            }
                                                            className="flex-1 items-center py-2 bg-discord-accent hover:bg-discord-accentHover rounded"
                                                        >
                                                            <Text className="text-white font-semibold text-sm">
                                                                {t(
                                                                    "registration.emailConfirmed",
                                                                )}
                                                            </Text>
                                                        </Pressable>
                                                        <Pressable
                                                            accessibilityRole="button"
                                                            onPress={() =>
                                                                answerStage(
                                                                    null,
                                                                )
                                                            }
                                                            className="px-4 py-2 bg-discord-messageHover rounded"
                                                        >
                                                            <Text className="text-discord-textPrimary text-sm">
                                                                {t(
                                                                    "common.cancel",
                                                                )}
                                                            </Text>
                                                        </Pressable>
                                                    </View>
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <Text
                                                nativeID="reg-stage-title"
                                                className="text-sm font-semibold text-discord-textPrimary"
                                            >
                                                {prompt.stage ===
                                                "m.login.recaptcha"
                                                    ? t(
                                                          "registration.captchaTitle",
                                                      )
                                                    : t(
                                                          "registration.fallbackTitle",
                                                      )}
                                            </Text>
                                            <Text className="text-xs text-discord-textMuted">
                                                {prompt.stage ===
                                                "m.login.recaptcha"
                                                    ? t(
                                                          "registration.captchaBody",
                                                          {
                                                              server: serverHost,
                                                          },
                                                      )
                                                    : t(
                                                          "registration.fallbackBody",
                                                          {
                                                              server: serverHost,
                                                          },
                                                      )}
                                            </Text>
                                            <View className="flex-row flex-wrap gap-2">
                                                {/* Zami: upstream's real link opens from the
                                                    click itself (the system browser in Electron,
                                                    a tab on web); here the in-app browser, and
                                                    the user comes back to say it's done. */}
                                                <Pressable
                                                    accessibilityRole="link"
                                                    onPress={() =>
                                                        openInApp(prompt.url)
                                                    }
                                                    className="px-4 py-2 bg-discord-accent hover:bg-discord-accentHover rounded"
                                                >
                                                    <Text className="text-white font-semibold text-sm">
                                                        {t(
                                                            "registration.openStepPage",
                                                        )}
                                                    </Text>
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        answerStage("done")
                                                    }
                                                    className="px-4 py-2 bg-discord-messageHover rounded"
                                                >
                                                    <Text className="text-discord-textPrimary text-sm">
                                                        {t(
                                                            "registration.stepDone",
                                                        )}
                                                    </Text>
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        answerStage(null)
                                                    }
                                                    className="px-4 py-2"
                                                >
                                                    <Text className="text-discord-textMuted hover:text-discord-textPrimary text-sm">
                                                        {t("common.cancel")}
                                                    </Text>
                                                </Pressable>
                                            </View>
                                        </>
                                    )}
                                    {stageError ? (
                                        <Text
                                            accessibilityRole="alert"
                                            className="text-sm text-discord-danger"
                                        >
                                            {stageError}
                                        </Text>
                                    ) : null}
                                </View>
                            ) : null}

                            {/* Form */}
                            <View className={stage ? "hidden" : "gap-4"}>
                                {/* Homeserver */}
                                <View>
                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                        {t("loginView.homeserver")}
                                    </Text>
                                    {/* The lookup spinner sits inside the field so it never
                                        shifts the form below. */}
                                    <View className="relative">
                                        {/* Zami: no autocapitalization or autocorrection,
                                            which a phone keyboard would apply to a
                                            server's name; a URL keyboard. */}
                                        <TextInput
                                            nativeID="server"
                                            accessibilityLabel={t(
                                                "loginView.homeserver",
                                            )}
                                            value={homeserverUrl}
                                            onChangeText={setHomeserverUrl}
                                            onBlur={() =>
                                                void refreshLoginOptions()
                                            }
                                            onSubmitEditing={() =>
                                                submitOrFocus(usernameInput)
                                            }
                                            placeholder={defaultHomeserver}
                                            placeholderTextColorClassName="accent-discord-textMuted"
                                            editable={!isLoading}
                                            keyboardType="url"
                                            textContentType="URL"
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            spellCheck={false}
                                            className="w-full ps-3 pe-9 py-2.5 bg-discord-backgroundSecondary text-discord-textPrimary placeholder-discord-textMuted rounded border border-discord-divider focus:border-discord-accent focus:outline-none transition-colors disabled:opacity-60 text-sm"
                                        />
                                        {optionsLoading ? (
                                            // Centred by the flex wrapper, not a translate:
                                            // animate-spin owns `transform` and would
                                            // override it.
                                            <View
                                                pointerEvents="none"
                                                className="absolute inset-y-0 end-3 justify-center pointer-events-none"
                                            >
                                                <Spin className="w-4 h-4 border-2 border-discord-textMuted/40 border-t-discord-textMuted rounded-full" />
                                            </View>
                                        ) : null}
                                    </View>
                                    <Text className="mt-1.5 text-xs text-discord-textMuted">
                                        {mode === "register"
                                            ? t(
                                                  "loginView.homeserverHintRegister",
                                              )
                                            : t("loginView.homeserverHint")}
                                    </Text>
                                </View>

                                {registrationClosed ? (
                                    <View
                                        accessibilityLiveRegion="polite"
                                        className="p-3 rounded-lg bg-discord-warning/10 border border-discord-warning/30 gap-2"
                                    >
                                        <Text className="text-sm text-discord-textPrimary">
                                            {t("registration.closedOnServer", {
                                                server: serverHost,
                                            })}
                                        </Text>
                                        {serverHost !==
                                        hostOf(PUBLIC_HOMESERVER) ? (
                                            <Pressable
                                                accessibilityRole="button"
                                                onPress={usePublicServer}
                                                className="self-start"
                                            >
                                                <Text className="text-sm text-discord-accent hover:underline font-medium">
                                                    {t(
                                                        "registration.useOtherServer",
                                                        {
                                                            server: hostOf(
                                                                PUBLIC_HOMESERVER,
                                                            ),
                                                        },
                                                    )}
                                                </Text>
                                            </Pressable>
                                        ) : null}
                                    </View>
                                ) : null}

                                {showPasswordForm && !registrationClosed ? (
                                    <>
                                        {/* Username */}
                                        <View>
                                            <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                                {t("loginView.username")}
                                            </Text>
                                            <TextInput
                                                ref={usernameInput}
                                                nativeID="username"
                                                accessibilityLabel={t(
                                                    "loginView.username",
                                                )}
                                                value={username}
                                                onChangeText={setUsername}
                                                onBlur={applyFullUserId}
                                                onSubmitEditing={() =>
                                                    submitOrFocus(passwordInput)
                                                }
                                                placeholder={
                                                    mode === "login"
                                                        ? `@you:${new URL(defaultHomeserver).hostname}`
                                                        : "yourusername"
                                                }
                                                placeholderTextColorClassName="accent-discord-textMuted"
                                                editable={!isLoading}
                                                autoComplete="username"
                                                textContentType="username"
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                                spellCheck={false}
                                                className="w-full px-3 py-2.5 bg-discord-backgroundSecondary text-discord-textPrimary placeholder-discord-textMuted rounded border border-discord-divider focus:border-discord-accent focus:outline-none transition-colors disabled:opacity-60 text-sm"
                                            />
                                            {mode === "register" ? (
                                                <Text
                                                    nativeID="username-hint"
                                                    className={`mt-1.5 text-xs ${
                                                        localUsernameIssue ||
                                                        nameTaken
                                                            ? "text-discord-danger"
                                                            : nameCheck?.name ===
                                                                    name &&
                                                                nameCheck.available
                                                              ? "text-discord-online"
                                                              : "text-discord-textMuted"
                                                    }`}
                                                >
                                                    {!name
                                                        ? t(
                                                              "registration.usernameHint",
                                                          )
                                                        : localUsernameIssue
                                                          ? localUsernameIssue
                                                          : nameTaken
                                                            ? (nameCheck?.issue ??
                                                              t(
                                                                  "registration.userInUse",
                                                              ))
                                                            : nameCheck?.name ===
                                                                    name &&
                                                                nameCheck.available
                                                              ? t(
                                                                    "registration.usernameAvailable",
                                                                    {
                                                                        userId: `@${name}:${serverHost}`,
                                                                    },
                                                                )
                                                              : t(
                                                                    "registration.yourAddressWillBe",
                                                                    {
                                                                        userId: `@${name}:${serverHost}`,
                                                                    },
                                                                )}
                                                </Text>
                                            ) : null}
                                        </View>

                                        {/* Password */}
                                        <View>
                                            <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                                {t("loginView.password")}
                                            </Text>
                                            <TextInput
                                                ref={passwordInput}
                                                nativeID="password"
                                                accessibilityLabel={t(
                                                    "loginView.password",
                                                )}
                                                secureTextEntry
                                                value={password}
                                                onChangeText={setPassword}
                                                onSubmitEditing={() =>
                                                    submitOrFocus(
                                                        mode === "register"
                                                            ? confirmInput
                                                            : undefined,
                                                    )
                                                }
                                                placeholder="••••••••••"
                                                placeholderTextColorClassName="accent-discord-textMuted"
                                                editable={!isLoading}
                                                autoComplete={
                                                    mode === "register"
                                                        ? "new-password"
                                                        : "current-password"
                                                }
                                                textContentType={
                                                    mode === "register"
                                                        ? "newPassword"
                                                        : "password"
                                                }
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                                className="w-full px-3 py-2.5 bg-discord-backgroundSecondary text-discord-textPrimary placeholder-discord-textMuted rounded border border-discord-divider focus:border-discord-accent focus:outline-none transition-colors disabled:opacity-60 text-sm"
                                            />
                                        </View>

                                        {mode === "register" ? (
                                            <View>
                                                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                                    {t(
                                                        "registration.confirmPassword",
                                                    )}
                                                </Text>
                                                <TextInput
                                                    ref={confirmInput}
                                                    nativeID="confirm-password"
                                                    accessibilityLabel={t(
                                                        "registration.confirmPassword",
                                                    )}
                                                    secureTextEntry
                                                    value={confirmPassword}
                                                    onChangeText={
                                                        setConfirmPassword
                                                    }
                                                    onSubmitEditing={() =>
                                                        submitOrFocus(
                                                            showTokenField
                                                                ? tokenInput
                                                                : undefined,
                                                        )
                                                    }
                                                    placeholder="••••••••••"
                                                    placeholderTextColorClassName="accent-discord-textMuted"
                                                    editable={!isLoading}
                                                    autoComplete="new-password"
                                                    textContentType="newPassword"
                                                    autoCapitalize="none"
                                                    autoCorrect={false}
                                                    className="w-full px-3 py-2.5 bg-discord-backgroundSecondary text-discord-textPrimary placeholder-discord-textMuted rounded border border-discord-divider focus:border-discord-accent focus:outline-none transition-colors disabled:opacity-60 text-sm"
                                                />
                                                {passwordsMismatch ? (
                                                    <Text
                                                        nativeID="confirm-hint"
                                                        className="mt-1.5 text-xs text-discord-danger"
                                                    >
                                                        {t(
                                                            "registration.passwordsDontMatch",
                                                        )}
                                                    </Text>
                                                ) : null}
                                            </View>
                                        ) : null}

                                        {/* Registration token (register mode, when the server's
                                            sign-up takes one or we couldn't tell) */}
                                        {mode === "register" &&
                                        showTokenField ? (
                                            <View>
                                                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                                    {t(
                                                        "loginView.registrationToken",
                                                    )}
                                                    {!tokenRequired ? (
                                                        <Text className="normal-case font-normal text-discord-textMuted">
                                                            {" "}
                                                            {t(
                                                                "loginView.ifRequired",
                                                            )}
                                                        </Text>
                                                    ) : null}
                                                </Text>
                                                {tokenRequired ? (
                                                    <Text className="mb-1.5 text-xs text-discord-textMuted">
                                                        {t(
                                                            "registration.tokenBody",
                                                            {
                                                                server: serverHost,
                                                            },
                                                        )}
                                                    </Text>
                                                ) : null}
                                                <TextInput
                                                    ref={tokenInput}
                                                    nativeID="token"
                                                    accessibilityLabel={t(
                                                        "loginView.registrationToken",
                                                    )}
                                                    value={registrationToken}
                                                    onChangeText={
                                                        setRegistrationToken
                                                    }
                                                    onSubmitEditing={() =>
                                                        submitOrFocus()
                                                    }
                                                    placeholder={
                                                        tokenRequired
                                                            ? ""
                                                            : t(
                                                                  "loginView.leaveBlankIfNotRequired",
                                                              )
                                                    }
                                                    placeholderTextColorClassName="accent-discord-textMuted"
                                                    autoComplete="off"
                                                    autoCapitalize="none"
                                                    autoCorrect={false}
                                                    spellCheck={false}
                                                    editable={!isLoading}
                                                    className="w-full px-3 py-2.5 bg-discord-backgroundSecondary text-discord-textPrimary placeholder-discord-textMuted rounded border border-discord-divider focus:border-discord-accent focus:outline-none transition-colors disabled:opacity-60 text-sm"
                                                />
                                            </View>
                                        ) : null}
                                    </>
                                ) : null}

                                {useOAuth ? (
                                    <>
                                        {/* The provider's own page signs in and signs up; say so
                                            before sending anyone there, so leaving Zam is expected. */}
                                        <View className="p-3 rounded-lg bg-discord-backgroundSecondary border border-discord-divider">
                                            <Text className="text-sm text-discord-textSecondary">
                                                {mode === "register"
                                                    ? t(
                                                          "loginView.oauthRegisterExplainer",
                                                          {
                                                              server: serverHost,
                                                          },
                                                      )
                                                    : t(
                                                          "loginView.oauthLoginExplainer",
                                                          {
                                                              server: serverHost,
                                                          },
                                                      )}
                                            </Text>
                                        </View>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                busy: isLoading,
                                            }}
                                            onPress={submitForm}
                                            disabled={
                                                isLoading || !optionsCurrent
                                            }
                                            className="w-full items-center py-2.5 bg-discord-accent hover:bg-discord-accentHover rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {isLoading ? (
                                                <View className="flex-row items-center justify-center gap-2">
                                                    <Spin className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full" />
                                                    <Text className="text-white font-semibold text-sm">
                                                        {statusMsg ||
                                                            t(
                                                                "loginView.pleaseWait",
                                                            )}
                                                    </Text>
                                                </View>
                                            ) : (
                                                <Text className="text-white font-semibold text-sm text-center">
                                                    {mode === "login"
                                                        ? providerHost
                                                            ? t(
                                                                  "loginView.continueTo",
                                                                  {
                                                                      host: providerHost,
                                                                  },
                                                              )
                                                            : t(
                                                                  "loginView.continue",
                                                              )
                                                        : t(
                                                              "loginView.createAccountOn",
                                                              {
                                                                  server: serverHost,
                                                              },
                                                          )}
                                                </Text>
                                            )}
                                        </Pressable>
                                        {ssoHint ? (
                                            <Text
                                                accessibilityLiveRegion="polite"
                                                className="text-sm text-center text-discord-textSecondary"
                                            >
                                                {ssoHint}
                                            </Text>
                                        ) : null}
                                        {qrAvailable && mode === "login" ? (
                                            <Pressable
                                                accessibilityRole="button"
                                                disabled={
                                                    isLoading || !optionsCurrent
                                                }
                                                onPress={() => setShowQr(true)}
                                                className="w-full items-center py-2.5 bg-discord-backgroundTertiary hover:bg-discord-messageHover rounded transition-colors disabled:opacity-60"
                                            >
                                                <Text className="text-discord-textPrimary text-sm">
                                                    {t("qrLogin.signInButton")}
                                                </Text>
                                            </Pressable>
                                        ) : null}
                                    </>
                                ) : null}

                                {showPasswordForm && !registrationClosed ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityState={{ busy: isLoading }}
                                        onPress={submitForm}
                                        disabled={
                                            isLoading ||
                                            !optionsCurrent ||
                                            !canSubmitPasswordForm
                                        }
                                        className="w-full items-center py-2.5 bg-discord-accent hover:bg-discord-accentHover rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {isLoading ? (
                                            <View className="flex-row items-center justify-center gap-2">
                                                <Spin className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full" />
                                                <Text className="text-white font-semibold text-sm">
                                                    {statusMsg ||
                                                        t(
                                                            "loginView.pleaseWait",
                                                        )}
                                                </Text>
                                            </View>
                                        ) : (
                                            <Text className="text-white font-semibold text-sm text-center">
                                                {mode === "login"
                                                    ? t("loginView.logIn")
                                                    : t(
                                                          "loginView.createAccount",
                                                      )}
                                            </Text>
                                        )}
                                    </Pressable>
                                ) : null}
                            </View>

                            {/* SSO (OIDC / OAuth / SAML / CAS via the homeserver) */}
                            {sso && !stage ? (
                                <>
                                    {showPasswordForm ? (
                                        <View
                                            className="flex-row items-center gap-3 my-4"
                                            accessibilityElementsHidden
                                            importantForAccessibility="no-hide-descendants"
                                        >
                                            <View className="flex-1 h-px bg-discord-divider" />
                                            <Text className="text-xs uppercase tracking-wide text-discord-textMuted">
                                                {t("loginView.or")}
                                            </Text>
                                            <View className="flex-1 h-px bg-discord-divider" />
                                        </View>
                                    ) : (
                                        <View className="mt-4" />
                                    )}
                                    <View className="gap-2">
                                        {sso.providers.length > 0 ? (
                                            sso.providers.map((provider) => (
                                                <Pressable
                                                    key={provider.id}
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        startSso(provider.id)
                                                    }
                                                    disabled={
                                                        isLoading ||
                                                        !optionsCurrent
                                                    }
                                                    className="w-full items-center py-2.5 bg-discord-backgroundSecondary hover:bg-discord-messageHover rounded border border-discord-divider transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                                >
                                                    <Text className="text-discord-textPrimary font-semibold text-sm">
                                                        {t(
                                                            "loginView.continueWith",
                                                            {
                                                                name: provider.name,
                                                            },
                                                        )}
                                                    </Text>
                                                </Pressable>
                                            ))
                                        ) : (
                                            <Pressable
                                                accessibilityRole="button"
                                                onPress={() => startSso()}
                                                disabled={
                                                    isLoading || !optionsCurrent
                                                }
                                                className={`w-full items-center py-2.5 ${
                                                    showPasswordForm &&
                                                    !sso.preferred
                                                        ? "bg-discord-backgroundSecondary hover:bg-discord-messageHover border border-discord-divider"
                                                        : "bg-discord-accent hover:bg-discord-accentHover"
                                                } rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed`}
                                            >
                                                <Text
                                                    className={`${
                                                        showPasswordForm &&
                                                        !sso.preferred
                                                            ? "text-discord-textPrimary"
                                                            : "text-white"
                                                    } font-semibold text-sm`}
                                                >
                                                    {t(
                                                        "loginView.continueWithSso",
                                                    )}
                                                </Text>
                                            </Pressable>
                                        )}
                                    </View>
                                    {ssoHint ? (
                                        <Text
                                            accessibilityLiveRegion="polite"
                                            className="mt-3 text-sm text-center text-discord-textSecondary"
                                        >
                                            {ssoHint}
                                        </Text>
                                    ) : null}
                                </>
                            ) : null}

                            {/* Toggle mode */}
                            <View className="mt-5 flex-row flex-wrap items-center justify-center gap-1">
                                {mode === "login" ? (
                                    <>
                                        <Text className="text-sm text-discord-textMuted">
                                            {t("loginView.donTHaveAnAccount")}
                                        </Text>
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() => setMode("register")}
                                            disabled={!!stage}
                                        >
                                            <Text className="text-sm text-discord-accent hover:underline font-medium">
                                                {t("loginView.register")}
                                            </Text>
                                        </Pressable>
                                    </>
                                ) : (
                                    <>
                                        <Text className="text-sm text-discord-textMuted">
                                            {t(
                                                "loginView.alreadyHaveAnAccount",
                                            )}
                                        </Text>
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() => setMode("login")}
                                            disabled={!!stage}
                                        >
                                            <Text className="text-sm text-discord-accent hover:underline font-medium">
                                                {t("loginView.signIn2")}
                                            </Text>
                                        </Pressable>
                                    </>
                                )}
                            </View>

                            {/* Advanced: sliding sync. On by default and almost never worth
                                changing, so it stays out of a first-time user's way. */}
                            <View className="mt-4">
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        expanded: showAdvanced,
                                    }}
                                    onPress={() =>
                                        setShowAdvanced(!showAdvanced)
                                    }
                                    className="self-start"
                                >
                                    <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                        {showAdvanced ? "▾" : "▸"}{" "}
                                        {t("loginView.advancedOptions")}
                                    </Text>
                                </Pressable>
                                {showAdvanced ? (
                                    <Checkbox
                                        checked={useSlidingSync}
                                        onChange={setUseSlidingSync}
                                        disabled={isLoading}
                                        accessibilityLabel={t(
                                            "loginView.useSlidingSync",
                                        )}
                                        className="mt-2 items-start gap-3"
                                        label={
                                            <View className="flex-1">
                                                <Text className="text-sm text-discord-textSecondary">
                                                    {t(
                                                        "loginView.useSlidingSync",
                                                    )}
                                                </Text>
                                                <Text className="text-xs text-discord-textMuted">
                                                    {t(
                                                        "loginView.fasterStartupOnServersThatSupport",
                                                    )}
                                                </Text>
                                            </View>
                                        }
                                    />
                                ) : null}
                            </View>

                            {isAddAccountMode && activeUserId ? (
                                <View className="mt-3 items-center">
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={onBackToActive}
                                    >
                                        <Text className="text-sm text-discord-accent hover:underline font-medium">
                                            {t("loginView.backTo", {
                                                activeUserId,
                                            })}
                                        </Text>
                                    </Pressable>
                                </View>
                            ) : null}

                            {dormantAccounts.length > 0 ? (
                                <View className="mt-5 pt-4 border-t border-discord-divider">
                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                                        {t("loginView.orContinueAs")}
                                    </Text>
                                    <View className="gap-1">
                                        {dormantAccounts.map((account) => (
                                            <Pressable
                                                key={account.userId}
                                                accessibilityRole="button"
                                                onPress={() =>
                                                    onContinueAs(account.userId)
                                                }
                                                disabled={isLoading}
                                                className="w-full flex-row items-center gap-2.5 p-2 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                                            >
                                                <AccountAvatar
                                                    account={account}
                                                    size={28}
                                                />
                                                <View className="flex-1 min-w-0">
                                                    <Text
                                                        numberOfLines={1}
                                                        className="text-sm text-discord-textPrimary"
                                                    >
                                                        {account.displayName ??
                                                            account.userId}
                                                    </Text>
                                                    <Text
                                                        numberOfLines={1}
                                                        className="text-xs text-discord-textMuted"
                                                    >
                                                        {account.userId}
                                                    </Text>
                                                </View>
                                            </Pressable>
                                        ))}
                                    </View>
                                </View>
                            ) : null}

                            <Text className="text-center text-xs text-discord-textMuted mt-4 leading-relaxed">
                                {t(
                                    "loginView.yourCredentialsAreSentDirectlyTo",
                                )}
                            </Text>

                            {!CAN_INSTALL_UPDATE ? (
                                <View className="flex-row flex-wrap justify-center gap-x-3 gap-y-1 mt-3">
                                    <Text
                                        accessibilityRole="link"
                                        onPress={() => openLink(WEBSITE_URL)}
                                        className="text-xs text-discord-accent hover:underline"
                                    >
                                        {t("links.website")}
                                    </Text>
                                    <Text
                                        accessibilityRole="link"
                                        onPress={() => openLink(DOWNLOAD_URL)}
                                        className="text-xs text-discord-accent hover:underline"
                                    >
                                        {t("links.downloadApps")}
                                    </Text>
                                    <Text
                                        accessibilityRole="link"
                                        onPress={() => openLink(GITHUB_URL)}
                                        className="text-xs text-discord-accent hover:underline"
                                    >
                                        {t("links.github")}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    </View>
                </View>
            </KeyboardAwareScrollView>

            {showQr && oauthMeta && optionsBaseUrl ? (
                <QrSignInPanel
                    baseUrl={optionsBaseUrl}
                    metadata={oauthMeta}
                    slidingSync={useSlidingSync}
                    onSignedIn={finishQrSignIn}
                    onClose={() => setShowQr(false)}
                />
            ) : null}
        </>
    );
}
