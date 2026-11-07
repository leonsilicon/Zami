import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import { Loader2 } from "lucide-svelte";
import type { ValidatedAuthMetadata } from "matrix-js-sdk";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import QrCodeImage from "$lib/components/ui/QrCodeImage.svelte";
// Zami: Metro bundles the scanner with the app, so it is imported statically
// rather than fetched when the scan step opens: there is no load to wait for
// (upstream's spinner) or to fail (its "could not open the camera" error).
import QrScanner from "$lib/components/ui/QrScanner.svelte";
import {
    QrLoginError,
    serverAdvertisesQrLogin,
    signInByScanningQr,
    signInWithQr,
    type QrSignInResult,
} from "$lib/matrix/qrLogin";
import { isMatrixQrPayload } from "$lib/utils/qrCode";
import { checkCodeMatches } from "$lib/matrix/qrLoginRendezvous";

// Zami: `w-[min(92vw,24rem)]` → `w-[92vw] max-w-[24rem]`; React Native has no
// `min()`. A <form>'s submit is the input's return key and the submit button.
export default function QrSignInPanel({
    baseUrl,
    metadata,
    slidingSync,
    onSignedIn,
    onClose,
}: {
    baseUrl: string;
    metadata: ValidatedAuthMetadata;
    slidingSync: boolean;
    onSignedIn: (result: QrSignInResult) => void | Promise<void>;
    onClose: () => void;
}) {
    const [step, setStep] = useState<
        | "preparing"
        | "code"
        | "scan"
        | "scanNumber"
        | "number"
        | "approval"
        | "finishing"
    >("preparing");
    // The server supports scanning a code a signed-in device shows.
    const [canScan, setCanScan] = useState(false);
    const [scanError, setScanError] = useState("");
    const [scanAttempt, setScanAttempt] = useState(0);
    // Scanning direction: this device shows the number, the other types it.
    const [shownNumber, setShownNumber] = useState("");
    const [code, setCode] = useState<Uint8ClampedArray | null>(null);
    // Device-code sign-in only: the approval page asks about this code.
    const [userCode, setUserCode] = useState("");
    const [error, setError] = useState("");
    const [typed, setTyped] = useState("");
    const answer = useRef<((ok: boolean) => void) | null>(null);
    const expectedCode = useRef("");
    const abort = useRef(new AbortController());
    // Zami: Svelte reads a prop when it's used; the flows below outlive the
    // render that started them, so they call the latest `onSignedIn`.
    const signedIn = useRef(onSignedIn);
    useEffect(() => {
        signedIn.current = onSignedIn;
    });

    function submitNumber() {
        if (!answer.current) return;
        const ok = checkCodeMatches(expectedCode.current, typed);
        const resolve = answer.current;
        answer.current = null;
        resolve(ok);
    }

    function close() {
        abort.current.abort();
        onClose();
    }

    async function runShowFlow() {
        abort.current = new AbortController();
        const signal = abort.current.signal;
        setStep("preparing");
        setCode(null);
        try {
            const result = await signInWithQr({
                baseUrl,
                metadata,
                slidingSync,
                signal,
                onCode: (c) => {
                    setCode(c.payload);
                    setUserCode(c.userCode ?? "");
                    setStep("code");
                },
                onScanned: () => setStep("number"),
                askCheckCode: (expected) =>
                    new Promise<boolean>((resolve) => {
                        expectedCode.current = expected;
                        answer.current = resolve;
                    }),
                onWaitingForApproval: () => setStep("approval"),
            });
            setStep("finishing");
            await signedIn.current(result);
        } catch (err) {
            if (signal.aborted) return;
            console.warn("[qr-login] sign-in failed", err);
            setError(
                err instanceof QrLoginError ? err.message : t("qrLogin.failed"),
            );
        }
    }

    function switchToScan() {
        abort.current.abort();
        setScanError("");
        setShownNumber("");
        setStep("scan");
    }

    function switchToShow() {
        setScanError("");
        void runShowFlow();
    }

    async function onScan(bytes: Uint8ClampedArray) {
        abort.current = new AbortController();
        const signal = abort.current.signal;
        setScanError("");
        setStep("scanNumber");
        setShownNumber("");
        try {
            const result = await signInByScanningQr({
                baseUrl,
                metadata,
                slidingSync,
                signal,
                bytes,
                onCheckCode: (n) => setShownNumber(n),
                onWaitingForApproval: () => setStep("approval"),
            });
            setStep("finishing");
            await signedIn.current(result);
        } catch (err) {
            if (signal.aborted) return;
            console.warn("[qr-login] scan sign-in failed", err);
            setScanError(
                err instanceof QrLoginError ? err.message : t("qrLogin.failed"),
            );
            setStep("scan");
            setScanAttempt((n) => n + 1);
        }
    }

    useEffect(() => {
        void serverAdvertisesQrLogin(baseUrl).then((ok) => setCanScan(ok));
        void runShowFlow();
        return () => abort.current.abort();
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as onMount.
    }, []);

    return (
        <ModalDialog
            onClose={close}
            labelledBy="qr-signin-title"
            panelClass="relative z-10 w-[92vw] max-w-[24rem] rounded-lg bg-discord-backgroundSecondary border border-discord-divider p-5 shadow-xl"
        >
            <Text
                nativeID="qr-signin-title"
                role="heading"
                className="text-lg font-semibold text-discord-textPrimary"
            >
                {t("qrLogin.signInTitle")}
            </Text>

            {error ? (
                <Text className="mt-4 text-sm text-discord-danger" role="alert">
                    {error}
                </Text>
            ) : step === "preparing" ? (
                <>
                    <View className="mt-5 flex-row justify-center">
                        <Loader2
                            size={28}
                            className="animate-spin text-discord-accent"
                        />
                    </View>
                    <Text className="mt-2 text-center text-xs text-discord-textMuted">
                        {t("qrLogin.preparing")}
                    </Text>
                </>
            ) : step === "code" && code ? (
                <>
                    <Text className="mt-3 text-sm text-discord-textSecondary">
                        {t("qrLogin.signInSteps")}
                    </Text>
                    <View className="mt-4 flex-row justify-center">
                        <View className="w-52 h-52">
                            <QrCodeImage
                                bytes={code}
                                label={t("qrLogin.codeAlt")}
                            />
                        </View>
                    </View>
                    {userCode ? (
                        <>
                            <Text className="mt-3 text-center text-xs text-discord-textMuted">
                                {t("qrLogin.orEnterCode")}
                            </Text>
                            <Text className="mt-2 text-center text-xs text-discord-textMuted">
                                {t("qrLogin.matchCode")}
                            </Text>
                            <Text
                                selectable
                                className="text-center text-2xl font-semibold tracking-widest text-discord-textPrimary"
                            >
                                {userCode}
                            </Text>
                        </>
                    ) : null}
                    {canScan && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={switchToScan}
                            className="mt-3 w-full py-2"
                        >
                            <Text className="text-center text-sm text-discord-accent hover:underline">
                                {t("qrLogin.scanInstead")}
                            </Text>
                        </Pressable>
                    )}
                </>
            ) : step === "scan" ? (
                <>
                    <Text className="mt-3 text-sm text-discord-textSecondary">
                        {t("qrLogin.scanIntro")}
                    </Text>
                    <View className="mt-4 flex-col items-center gap-2">
                        <QrScanner
                            key={scanAttempt}
                            onScan={onScan}
                            accept={isMatrixQrPayload}
                            onError={(message) => setScanError(message)}
                        />
                    </View>
                    {scanError ? (
                        <Text
                            className="mt-3 text-sm text-discord-danger"
                            role="alert"
                        >
                            {scanError}
                        </Text>
                    ) : null}
                    <Pressable
                        accessibilityRole="button"
                        onPress={switchToShow}
                        className="mt-3 w-full py-2"
                    >
                        <Text className="text-center text-sm text-discord-accent hover:underline">
                            {t("qrLogin.showInstead")}
                        </Text>
                    </Pressable>
                </>
            ) : step === "scanNumber" ? (
                shownNumber ? (
                    <>
                        <Text className="mt-3 text-sm text-discord-textSecondary">
                            {t("qrLogin.scanShowNumber")}
                        </Text>
                        <Text
                            className="mt-2 text-center text-4xl font-semibold tracking-widest text-discord-textPrimary"
                            accessibilityLiveRegion="polite"
                        >
                            {shownNumber}
                        </Text>
                    </>
                ) : (
                    <View className="mt-5 flex-row justify-center">
                        <Loader2
                            size={28}
                            className="animate-spin text-discord-accent"
                        />
                    </View>
                )
            ) : step === "number" ? (
                <View className="mt-3 flex-col gap-3">
                    <Text className="text-sm text-discord-textSecondary">
                        {t("qrLogin.enterNumber")}
                    </Text>
                    <Text
                        nativeID="qr-number-label"
                        className="text-xs text-discord-textMuted"
                    >
                        {t("qrLogin.numberLabel")}
                    </Text>
                    <TextInput
                        accessibilityLabelledBy="qr-number-label"
                        accessibilityLabel={t("qrLogin.numberLabel")}
                        value={typed}
                        onChangeText={setTyped}
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
                            disabled: typed.trim().length === 0,
                        }}
                        disabled={typed.trim().length === 0}
                        onPress={submitNumber}
                        className="py-2 bg-discord-accent hover:bg-discord-accentHover rounded disabled:opacity-60"
                    >
                        <Text className="text-center text-white font-semibold text-sm">
                            {t("qrLogin.confirm")}
                        </Text>
                    </Pressable>
                </View>
            ) : step === "approval" ? (
                <>
                    <View className="mt-5 flex-row justify-center">
                        <Loader2
                            size={28}
                            className="animate-spin text-discord-accent"
                        />
                    </View>
                    <Text className="mt-2 text-center text-sm text-discord-textSecondary">
                        {t("qrLogin.waitingApproval")}
                    </Text>
                </>
            ) : (
                <>
                    <View className="mt-5 flex-row justify-center">
                        <Loader2
                            size={28}
                            className="animate-spin text-discord-accent"
                        />
                    </View>
                    <Text className="mt-2 text-center text-sm text-discord-textSecondary">
                        {t("qrLogin.signingIn")}
                    </Text>
                </>
            )}

            <Pressable
                accessibilityRole="button"
                onPress={close}
                className="mt-5 w-full py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover"
            >
                <Text className="text-center text-discord-textPrimary text-sm">
                    {t("qrLogin.cancel")}
                </Text>
            </Pressable>
        </ModalDialog>
    );
}
