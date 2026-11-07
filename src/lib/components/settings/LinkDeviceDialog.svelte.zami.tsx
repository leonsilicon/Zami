import { openLink, Spin } from "@-/com.leonsilicon.zami.rn";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import { CheckCircle2, Loader2 } from "lucide-svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import { getClient } from "$lib/matrix/runtime";
import {
    QrLoginError,
    isQrLoginPayload,
    linkDevice,
    linkDeviceByShowingQr,
    linkDeviceByUserCode,
    type NewDeviceInfo,
} from "$lib/matrix/qrLogin";
import { checkCodeMatches } from "$lib/matrix/qrLoginRendezvous";
import QrCodeImage from "$lib/components/ui/QrCodeImage.svelte";
// Zami: Metro bundles the scanner with the app, so it is imported statically
// rather than fetched on mount: there is no load to wait for (upstream's
// spinner) or to fail (its "could not open the camera" error).
import QrScanner from "$lib/components/ui/QrScanner.svelte";

/**
 * Zami: the approval link is `a[data-in-app]`, which Zam's root layout opens in
 * the in-app browser (Android's Custom Tab, openInAppBrowser) so the user never
 * leaves the app. Here that is expo-web-browser's (SFSafariViewController on
 * iOS), falling back to the system browser.
 */
function openInApp(url: string): void {
    void WebBrowser.openBrowserAsync(url).catch(() => openLink(url));
}

// Zami: `w-[min(92vw,26rem)]` → `w-[92vw] max-w-[26rem]`; React Native has no
// `min()`. A <form>'s submit is the input's return key and the submit button.
export default function LinkDeviceDialog({
    onClose,
    mode = "scan",
}: {
    onClose: () => void;
    mode?: "scan" | "code" | "show";
}) {
    const [step, setStep] = useState<
        "scan" | "show" | "number" | "approve" | "choose" | "done"
    >("scan");
    const [candidates, setCandidates] = useState<NewDeviceInfo[]>([]);
    const pickDevice = useRef<((id: string | null) => void) | null>(null);
    const [shownCode, setShownCode] = useState<Uint8ClampedArray | null>(null);
    const [typedNumber, setTypedNumber] = useState("");
    const answerNumber = useRef<((ok: boolean) => void) | null>(null);
    const expectedNumber = useRef("");
    const [typedCode, setTypedCode] = useState("");
    const [verifying, setVerifying] = useState(true);
    const [approvalUrl, setApprovalUrl] = useState("");
    // MSC4108 only: the number the new device asks for.
    const [checkCode, setCheckCode] = useState("");
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const abort = useRef(new AbortController());

    const approvalHost = (() => {
        try {
            return new URL(approvalUrl).host;
        } catch {
            return "";
        }
    })();

    useEffect(() => {
        if (mode === "code") return () => abort.current.abort();
        if (mode === "show") {
            void startShowing();
            return () => abort.current.abort();
        }
        return () => abort.current.abort();
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as onMount.
    }, []);

    async function onScan(bytes: Uint8ClampedArray) {
        const client = getClient();
        if (!client) return;
        setError("");
        abort.current = new AbortController();
        setStep("approve");
        try {
            await linkDevice({
                client,
                bytes,
                signal: abort.current.signal,
                onCheckCode: (code) => setCheckCode(code),
                onApprovalUrl: (url) => setApprovalUrl(url),
                onDone: (started) => {
                    setVerifying(started);
                    setStep("done");
                },
            });
        } catch (err) {
            if (abort.current.signal.aborted) return;
            console.warn("[qr-login] link failed", err);
            setError(
                err instanceof QrLoginError ? err.message : t("qrLogin.failed"),
            );
            setApprovalUrl("");
            setCheckCode("");
            setStep("scan");
            setAttempt((n) => n + 1);
        }
    }

    async function startShowing() {
        const client = getClient();
        if (!client) return;
        setError("");
        setTypedNumber("");
        setShownCode(null);
        abort.current = new AbortController();
        setStep("show");
        try {
            await linkDeviceByShowingQr({
                client,
                signal: abort.current.signal,
                onCode: (bytes) => setShownCode(bytes),
                onScanned: () => setStep("number"),
                askCheckCode: (expected) =>
                    new Promise<boolean>((resolve) => {
                        expectedNumber.current = expected;
                        answerNumber.current = resolve;
                    }),
                onApprovalUrl: (url) => {
                    setApprovalUrl(url);
                    setStep("approve");
                },
            });
            setVerifying(true);
            setStep("done");
        } catch (err) {
            if (abort.current.signal.aborted) return;
            console.warn("[qr-login] show-code link failed", err);
            setError(
                err instanceof QrLoginError ? err.message : t("qrLogin.failed"),
            );
            setApprovalUrl("");
            // A fresh code is one tap away.
            setStep("show");
            setShownCode(null);
        }
    }

    function submitNumber() {
        if (!answerNumber.current) return;
        const ok = checkCodeMatches(expectedNumber.current, typedNumber);
        const resolve = answerNumber.current;
        answerNumber.current = null;
        resolve(ok);
    }

    async function onSubmitCode() {
        const client = getClient();
        if (!client) return;
        setError("");
        abort.current = new AbortController();
        setStep("approve");
        try {
            setVerifying(
                await linkDeviceByUserCode({
                    client,
                    code: typedCode,
                    signal: abort.current.signal,
                    onApprovalUrl: (url) => setApprovalUrl(url),
                    chooseDevice: (devices) =>
                        new Promise<string | null>((resolve) => {
                            setCandidates(devices);
                            pickDevice.current = resolve;
                            setStep("choose");
                        }),
                }),
            );
            setStep("done");
        } catch (err) {
            if (abort.current.signal.aborted) return;
            console.warn("[qr-login] code link failed", err);
            setError(
                err instanceof QrLoginError ? err.message : t("qrLogin.failed"),
            );
            setApprovalUrl("");
            setStep("scan");
        }
    }

    function close() {
        abort.current.abort();
        onClose();
    }

    return (
        <ModalDialog
            onClose={close}
            labelledBy="qr-link-title"
            panelClass="relative z-10 w-[92vw] max-w-[26rem] rounded-lg bg-discord-backgroundSecondary border border-discord-divider p-5 shadow-xl"
        >
            <Text
                nativeID="qr-link-title"
                role="heading"
                className="text-lg font-semibold text-discord-textPrimary"
            >
                {mode === "code"
                    ? t("qrLogin.codeTitle")
                    : mode === "show"
                      ? t("qrLogin.showTitle")
                      : t("qrLogin.linkTitle")}
            </Text>

            {step === "show" ? (
                <>
                    <Text className="mt-3 text-sm text-discord-textSecondary">
                        {t("qrLogin.showIntro")}
                    </Text>
                    <Text className="mt-2 text-xs text-discord-textMuted">
                        {t("qrLogin.linkWarning")}
                    </Text>
                    <View className="mt-4 flex-row justify-center">
                        {shownCode ? (
                            <View className="w-52 h-52">
                                <QrCodeImage
                                    bytes={shownCode}
                                    label={t("qrLogin.showCodeAlt")}
                                />
                            </View>
                        ) : error ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => void startShowing()}
                                className="px-3 py-2 bg-discord-accent hover:bg-discord-accentHover rounded"
                            >
                                <Text className="text-white font-semibold text-sm">
                                    {t("qrLogin.showRetry")}
                                </Text>
                            </Pressable>
                        ) : (
                            <Spin>
                                <Loader2
                                    size={28}
                                    className="text-discord-accent"
                                />
                            </Spin>
                        )}
                    </View>
                </>
            ) : step === "number" ? (
                <View className="mt-3 flex-col gap-3">
                    <Text className="text-sm text-discord-textSecondary">
                        {t("qrLogin.showEnterNumber")}
                    </Text>
                    <Text
                        nativeID="show-number-label"
                        className="text-xs text-discord-textMuted"
                    >
                        {t("qrLogin.numberLabel")}
                    </Text>
                    <TextInput
                        accessibilityLabelledBy="show-number-label"
                        accessibilityLabel={t("qrLogin.numberLabel")}
                        value={typedNumber}
                        onChangeText={setTypedNumber}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        autoComplete="off"
                        autoCorrect={false}
                        maxLength={2}
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={submitNumber}
                        className="w-24 px-3 py-2 text-lg tracking-widest text-center bg-discord-backgroundTertiary text-discord-textPrimary rounded border border-discord-divider focus:border-discord-accent focus:outline-none"
                    />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{
                            disabled: typedNumber.trim().length === 0,
                        }}
                        disabled={typedNumber.trim().length === 0}
                        onPress={submitNumber}
                        className="py-2 bg-discord-accent hover:bg-discord-accentHover rounded disabled:opacity-60"
                    >
                        <Text className="text-center text-white font-semibold text-sm">
                            {t("qrLogin.confirm")}
                        </Text>
                    </Pressable>
                </View>
            ) : null}

            {step === "choose" ? (
                <>
                    <Text className="mt-3 text-sm text-discord-textSecondary">
                        {t("qrLogin.chooseIntro")}
                    </Text>
                    <View className="mt-3 gap-2">
                        {candidates.map((device) => (
                            <Pressable
                                key={device.deviceId}
                                accessibilityRole="button"
                                onPress={() => {
                                    pickDevice.current?.(device.deviceId);
                                    pickDevice.current = null;
                                    setStep("approve");
                                }}
                                className="w-full px-3 py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover"
                            >
                                <Text className="font-medium text-sm text-discord-textPrimary">
                                    {device.displayName || device.deviceId}
                                </Text>
                                <Text className="text-xs text-discord-textMuted">
                                    {device.deviceId}
                                    {device.lastSeenIp
                                        ? ` · ${device.lastSeenIp}`
                                        : ""}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                </>
            ) : step === "show" ||
              step === "number" /* shown above */ ? null : step === "scan" &&
              mode === "code" ? (
                <View className="mt-3 flex-col gap-3">
                    <Text className="text-sm text-discord-textSecondary">
                        {t("qrLogin.codeIntro")}
                    </Text>
                    <Text className="text-xs text-discord-textMuted">
                        {t("qrLogin.linkWarning")}
                    </Text>
                    <Text
                        nativeID="link-user-code-label"
                        className="text-xs text-discord-textMuted"
                    >
                        {t("qrLogin.codeLabel")}
                    </Text>
                    <TextInput
                        accessibilityLabelledBy="link-user-code-label"
                        accessibilityLabel={t("qrLogin.codeLabel")}
                        value={typedCode}
                        onChangeText={setTypedCode}
                        autoFocus
                        autoComplete="off"
                        autoCapitalize="characters"
                        autoCorrect={false}
                        spellCheck={false}
                        returnKeyType="go"
                        onSubmitEditing={() => {
                            if (typedCode.trim()) void onSubmitCode();
                        }}
                        className="w-full bg-discord-backgroundTertiary text-discord-textPrimary text-center text-xl tracking-widest uppercase rounded px-3 py-2 outline-none border border-transparent focus:border-discord-accent/50"
                    />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !typedCode.trim() }}
                        disabled={!typedCode.trim()}
                        onPress={() => void onSubmitCode()}
                        className="w-full py-2 bg-discord-accent hover:bg-discord-accentHover rounded disabled:opacity-50"
                    >
                        <Text className="text-center text-white font-semibold text-sm">
                            {t("qrLogin.codeContinue")}
                        </Text>
                    </Pressable>
                </View>
            ) : step === "scan" ? (
                <>
                    <Text className="mt-3 text-sm text-discord-textSecondary">
                        {t("qrLogin.linkIntro")}
                    </Text>
                    <Text className="mt-2 text-xs text-discord-textMuted">
                        {t("qrLogin.linkWarning")}
                    </Text>
                    <View className="mt-4 flex-col items-center gap-2">
                        <QrScanner
                            key={attempt}
                            onScan={onScan}
                            accept={isQrLoginPayload}
                            onError={(message) => setError(message)}
                        />
                    </View>
                </>
            ) : step === "approve" ? (
                <>
                    {checkCode ? (
                        <>
                            <Text className="mt-3 text-sm text-discord-textSecondary">
                                {t("qrLogin.linkShowNumber")}
                            </Text>
                            <Text
                                className="mt-2 text-center text-4xl font-semibold tracking-widest text-discord-textPrimary"
                                accessibilityLiveRegion="polite"
                            >
                                {checkCode}
                            </Text>
                        </>
                    ) : null}
                    <Text className="mt-3 text-sm text-discord-textSecondary">
                        {t("qrLogin.linkApprove", { host: approvalHost })}
                    </Text>
                    {approvalUrl ? (
                        <>
                            <Pressable
                                accessibilityRole="link"
                                onPress={() => openInApp(approvalUrl)}
                                className="mt-3 w-full py-2 bg-discord-accent hover:bg-discord-accentHover rounded"
                            >
                                <Text className="text-center text-white font-semibold text-sm">
                                    {t("qrLogin.linkApproveButton", {
                                        host: approvalHost,
                                    })}
                                </Text>
                            </Pressable>
                            <View className="mt-4 flex-row items-center justify-center gap-2">
                                <Spin>
                                    <Loader2
                                        size={16}
                                        className="text-discord-accent"
                                    />
                                </Spin>
                                <Text className="text-xs text-discord-textMuted">
                                    {t("qrLogin.linkWaiting")}
                                </Text>
                            </View>
                        </>
                    ) : (
                        <View className="mt-4 flex-row justify-center">
                            <Spin>
                                <Loader2
                                    size={24}
                                    className="text-discord-accent"
                                />
                            </Spin>
                        </View>
                    )}
                </>
            ) : (
                <View className="mt-5 flex-col items-center gap-2">
                    <CheckCircle2 size={40} className="text-discord-accent" />
                    <Text className="text-center text-sm text-discord-textPrimary">
                        {checkCode
                            ? t("qrLogin.linkDoneVerified")
                            : verifying
                              ? t("qrLogin.linkDone")
                              : t("qrLogin.linkDoneUnverified")}
                    </Text>
                </View>
            )}

            {error ? (
                <Text className="mt-3 text-sm text-discord-danger" role="alert">
                    {error}
                </Text>
            ) : null}

            <Pressable
                accessibilityRole="button"
                onPress={close}
                className="mt-5 w-full py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover"
            >
                <Text className="text-center text-discord-textPrimary text-sm">
                    {step === "done"
                        ? t("qrLogin.linkClose")
                        : t("qrLogin.cancel")}
                </Text>
            </Pressable>
        </ModalDialog>
    );
}
