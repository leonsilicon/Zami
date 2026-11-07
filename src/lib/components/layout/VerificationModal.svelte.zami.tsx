import { Portal, Spin } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useState } from "react";
import { BackHandler, I18nManager, Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import {
    ShieldCheck,
    ShieldAlert,
    Loader2,
    QrCode,
    Camera,
    ArrowLeft,
} from "lucide-svelte";
import {
    verificationState,
    closeActive,
} from "$lib/stores/verification.svelte";
import {
    verificationPhaseKind,
    verificationPhaseLabel,
    formatSasEmojis,
    sasEmojiRows,
} from "$lib/utils/verification";
import { NO_METHOD_OPTIONS } from "$lib/utils/qrVerification";
import QrCodeImage from "$lib/components/ui/QrCodeImage.svelte";
// Zami: the scanner (upstream fetches it, and its jsQR decoder, only once the
// camera pane opens) is bundled with the app by Metro, so it is imported
// statically: there is no load to wait for (upstream's spinner) or to fail
// ("could not load the scanner").
import QrScanner from "$lib/components/ui/QrScanner.svelte";

// Zami: `use:focusTrap` → the dialog is modal to VoiceOver, and its Escape
// (`onEscape: closeActive`) is Android's back button and VoiceOver's escape
// gesture. `fixed` → a Portal at the app root.
export default function VerificationModal() {
    // The active controller mutates in place, so every read hangs off the tick.
    const view = useRune(
        () => (
            void verificationState.verificationTick,
            verificationState.active?.view() ?? null
        ),
    );
    const activeId = useRune(() => verificationState.active?.id);
    const kind = view ? verificationPhaseKind(view.phase) : "pending";
    const isSelf = view?.isSelfVerification ?? false;
    const statusLabel = view
        ? verificationPhaseLabel(view.phase, { isSelf })
        : "";
    const emojiRows = view?.sasEmoji
        ? sasEmojiRows(formatSasEmojis(view.sasEmoji))
        : [];
    // `NO_METHOD_OPTIONS` is frozen and returned by identity: read it, never
    // write to it.
    const methods = view?.methodOptions ?? NO_METHOD_OPTIONS;
    // A lone "compare emoji" button is not a choice: when neither side can do QR
    // the controller starts SAS by itself, so stay on the spinner and let it —
    // an SAS-only peer must still land on the emoji compare with zero extra taps.
    const showChooser =
        !methods.shouldAutoStartSas &&
        (methods.canShowQr || methods.canScanQr || methods.canSas);
    // Our `.start` is on the wire but no verifier is hooked yet. The phase is
    // still `Ready` so `methodOptions` still offers everything, but a second tap
    // is swallowed by the controller's latch — disable rather than look dead.
    const startPending = view?.startPending ?? false;
    const title = isSelf
        ? t("verificationModal.verifyYourOtherSession")
        : t("verificationModal.verify", {
              value: view?.otherUserId ?? "user",
          });

    // Local UX state: reset whenever the modal retargets to a new flow.
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    // Which QR pane the user opened. Reset with the rest of the local state
    // whenever the modal retargets to a different flow.
    const [pane, setPane] = useState<"choose" | "show" | "scan">("choose");
    // Bumped to force a fresh QrScanner instance — see the scan pane.
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        setConfirmed(false);
        setBusy(false);
        setErrorMsg(null);
        setPane("choose");
        setAttempt(0);
    }, [activeId]);

    // The focus trap's Escape, as Android's back button.
    const open = view !== null;
    useEffect(() => {
        if (!open) return;
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                closeActive();
                return true;
            },
        );
        return () => subscription.remove();
    }, [open]);

    // One alert line for the whole modal. `qrError` is NOT QR-specific — the
    // controller writes SAS-start failures into it too — so it has to be visible
    // from every pane, not just the QR ones.
    const alertMsg = errorMsg ?? view?.qrError ?? null;

    async function match() {
        if (busy) return;
        setBusy(true);
        setErrorMsg(null);
        try {
            await verificationState.active?.confirm();
            setConfirmed(true);
        } catch (e) {
            setErrorMsg(
                e instanceof Error
                    ? e.message
                    : t("verificationModal.couldNotConfirmTheMatch"),
            );
        } finally {
            setBusy(false);
        }
    }

    async function noMatch() {
        if (busy) return;
        setBusy(true);
        setErrorMsg(null);
        try {
            verificationState.active?.mismatch();
            setConfirmed(true);
        } catch (e) {
            setErrorMsg(
                e instanceof Error
                    ? e.message
                    : t("verificationModal.couldNotReportTheMismatch"),
            );
        } finally {
            setBusy(false);
        }
    }

    async function openShowQr() {
        setErrorMsg(null);
        setPane("show");
        await verificationState.active?.showQrCode();
    }

    function openScanQr() {
        setErrorMsg(null);
        setPane("scan");
    }

    async function chooseSas() {
        if (busy) return;
        setBusy(true);
        setErrorMsg(null);
        try {
            await verificationState.active?.startSas();
        } finally {
            setBusy(false);
        }
    }

    async function onScanned(bytes: Uint8ClampedArray) {
        await verificationState.active?.submitScannedQr(bytes);
    }

    function onScanError(message: string) {
        setErrorMsg(message);
    }

    function confirmScanned() {
        verificationState.active?.confirmReciprocate();
    }

    /**
     * Only ever reachable from the reciprocate prompt's "No": with no prompt up,
     * `denyReciprocate()` falls back to cancelling the ENTIRE verification, so it
     * must never double as a generic dismiss.
     */
    function denyScanned() {
        if (!view?.awaitingReciprocateConfirm) return;
        verificationState.active?.denyReciprocate();
    }

    if (!view) return null;
    return (
        <Portal>
            <View
                pointerEvents="box-none"
                className="absolute inset-0 z-50 flex-row items-center justify-center p-4"
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.closeDialog")}
                    className="absolute inset-0 bg-black/50"
                    onPress={closeActive}
                />
                <View
                    role="dialog"
                    accessibilityViewIsModal
                    aria-labelledby="verification-modal-title"
                    onAccessibilityEscape={closeActive}
                    className="relative z-10 shrink w-full max-w-sm rounded-lg bg-discord-backgroundSecondary border border-discord-divider shadow-xl p-5"
                >
                    <Text
                        nativeID="verification-modal-title"
                        role="heading"
                        className="text-base font-semibold text-discord-textPrimary"
                    >
                        {title}
                    </Text>
                    {view.otherDeviceId ? (
                        <Text className="mt-0.5 text-xs text-discord-textMuted font-mono">
                            {view.otherDeviceId}
                        </Text>
                    ) : null}

                    {kind === "success" ? (
                        <View className="mt-5 flex-col items-center gap-2">
                            <ShieldCheck
                                size={40}
                                className="text-discord-online"
                            />
                            <Text className="text-center text-sm font-medium text-discord-textPrimary">
                                {statusLabel}
                            </Text>
                            <Text className="text-center text-xs text-discord-textMuted">
                                {isSelf
                                    ? t(
                                          "verificationModal.thisSessionIsNowTrusted",
                                      )
                                    : t(
                                          "verificationModal.theirIdentityIsNowVerified",
                                      )}
                            </Text>
                        </View>
                    ) : kind === "cancelled" ? (
                        <View className="mt-5 flex-col items-center gap-2">
                            <ShieldAlert
                                size={40}
                                className="text-discord-danger"
                            />
                            <Text className="text-center text-sm font-medium text-discord-textPrimary">
                                {statusLabel}
                            </Text>
                            <Text className="text-center text-xs text-discord-textMuted">
                                {t(
                                    "verificationModal.noTrustWasEstablishedYouCan",
                                )}
                            </Text>
                        </View>
                    ) : view.awaitingReciprocateConfirm ? (
                        /* Outranks every other pane: the other side is blocked on
                           this answer, and answering it wrongly is the whole
                           attack. The copy must name the party who actually
                           scanned — asking about "your other device" when ANOTHER
                           USER scanned invites the worst possible reasoning ("I
                           don't have one, so… yes?"). */
                        <>
                            <View className="mt-5 flex-col items-center gap-3">
                                <QrCode
                                    size={32}
                                    className="text-discord-accent"
                                />
                                {/* The prompt arrives asynchronously and the branch
                                    swap drops focus, so announce it rather than
                                    leaving a screen-reader user showing a code in
                                    silence. Neither button is autofocused: this
                                    answer must be deliberate. */}
                                <Text
                                    className="text-center text-sm text-discord-textPrimary"
                                    accessibilityLiveRegion="polite"
                                >
                                    {isSelf
                                        ? t(
                                              "verificationModal.didYourOtherSessionJustScan",
                                          )
                                        : t(
                                              "verificationModal.didJustScanThisCode",
                                              {
                                                  otherUserId: view.otherUserId,
                                              },
                                          )}
                                </Text>
                                <Text className="text-center text-xs text-discord-textMuted">
                                    {isSelf
                                        ? t(
                                              "verificationModal.onlyConfirmIfYouScannedIt",
                                          )
                                        : t(
                                              "verificationModal.onlyConfirmIfYouWatchedThem",
                                          )}
                                </Text>
                            </View>
                            {/* "No" first in BOTH DOM and visual order. It is the
                                SAFE answer — it cancels a verification you can
                                restart, while a wrong "Yes" completes an
                                attestation with an attacker — so it takes the
                                first tab stop, and matching orders keep focus
                                order and visual order in agreement (WCAG 2.4.3). */}
                            <View className="mt-5 flex-row gap-2">
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={denyScanned}
                                    className="flex-1 px-3 py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-danger/20 transition-colors"
                                >
                                    <Text className="text-center text-discord-danger text-sm font-semibold">
                                        {t("verificationModal.no")}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={confirmScanned}
                                    className="flex-1 px-3 py-2 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors"
                                >
                                    <Text className="text-center text-white text-sm font-semibold">
                                        {t("verificationModal.yesIScannedIt")}
                                    </Text>
                                </Pressable>
                            </View>
                        </>
                    ) : emojiRows.length > 0 && !confirmed ? (
                        <>
                            <Text className="mt-4 text-xs text-discord-textMuted">
                                {t(
                                    "verificationModal.confirmTheSameEmojiAppearIn",
                                    {
                                        value: isSelf
                                            ? t("verificationModal.session")
                                            : t(
                                                  "verificationModal.deviceWithThisUser",
                                              ),
                                    },
                                )}
                            </Text>
                            <View className="mt-4 gap-2">
                                {emojiRows.map((row, rowIndex) => (
                                    <View
                                        key={rowIndex}
                                        className="flex-row justify-center gap-2"
                                    >
                                        {/* Keyed by position: SAS picks each emoji
                                            independently, so one can appear twice. */}
                                        {row.map((emoji, i) => (
                                            <View
                                                key={i}
                                                className="flex w-16 flex-col items-center gap-1 rounded bg-discord-backgroundTertiary px-1 py-2"
                                            >
                                                <Text className="text-2xl leading-none">
                                                    {emoji.symbol}
                                                </Text>
                                                <Text
                                                    numberOfLines={1}
                                                    className="text-[10px] capitalize text-discord-textMuted truncate max-w-full"
                                                >
                                                    {emoji.name}
                                                </Text>
                                            </View>
                                        ))}
                                    </View>
                                ))}
                            </View>
                            <View className="mt-5 flex-row gap-2">
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{ disabled: busy }}
                                    onPress={() => void noMatch()}
                                    disabled={busy}
                                    className="flex-1 px-3 py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-danger/20 transition-colors disabled:opacity-50"
                                >
                                    <Text className="text-center text-discord-danger text-sm font-semibold">
                                        {t("verificationModal.theyDonTMatch")}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{ disabled: busy }}
                                    onPress={() => void match()}
                                    disabled={busy}
                                    className="flex-1 px-3 py-2 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-50"
                                >
                                    <Text className="text-center text-white text-sm font-semibold">
                                        {busy
                                            ? t("verificationModal.confirming")
                                            : t("verificationModal.theyMatch")}
                                    </Text>
                                </Pressable>
                            </View>
                        </>
                    ) : showChooser ? (
                        <>
                            {pane === "show" ? (
                                <View className="mt-4 flex-col items-center gap-3">
                                    {view.qrBytes ? (
                                        <>
                                            <QrCodeImage
                                                bytes={view.qrBytes}
                                                label={
                                                    isSelf
                                                        ? t(
                                                              "verificationModal.verificationCodeForYourOtherSession",
                                                          )
                                                        : t(
                                                              "verificationModal.verificationCodeFor",
                                                              {
                                                                  otherUserId:
                                                                      view.otherUserId,
                                                              },
                                                          )
                                                }
                                            />
                                            <Text className="text-center text-xs text-discord-textMuted">
                                                {isSelf
                                                    ? t(
                                                          "verificationModal.scanThisWithYourOtherSession",
                                                      )
                                                    : t(
                                                          "verificationModal.askThemToScanThisCode",
                                                      )}
                                            </Text>
                                        </>
                                    ) : view.qrError ? (
                                        /* The reason itself renders in the shared
                                           alert below; this only fills the empty
                                           pane. */
                                        <Text className="text-center text-xs text-discord-textMuted">
                                            {t(
                                                "verificationModal.noCodeToShowRightNow",
                                            )}
                                        </Text>
                                    ) : (
                                        <Spin>
                                            <Loader2
                                                size={28}
                                                className="text-discord-accent"
                                            />
                                        </Spin>
                                    )}
                                </View>
                            ) : pane === "scan" ? (
                                /* Inside the branch on purpose: QrScanner latches
                                   after one scan and cannot be reset in place, so
                                   leaving this pane must DESTROY it. Re-entering
                                   mounts a fresh instance (all its state is
                                   instance-scoped, and the camera grant is
                                   remembered by the system, so no second prompt). */
                                <View className="mt-4 flex-col items-center gap-2">
                                    <QrScanner
                                        key={attempt}
                                        onScan={onScanned}
                                        onError={onScanError}
                                    />
                                    {view.qrError ? (
                                        /* Bumping the key DESTROYS and recreates
                                           the scanner. It latches after one
                                           delivery and cannot be reset in place,
                                           so this is the only way to offer the
                                           same method again — the back link would
                                           send the user the long way round. */
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() =>
                                                setAttempt((n) => n + 1)
                                            }
                                            className="px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover transition-colors"
                                        >
                                            <Text className="text-discord-textPrimary text-xs">
                                                {t(
                                                    "verificationModal.scanAgain",
                                                )}
                                            </Text>
                                        </Pressable>
                                    ) : null}
                                </View>
                            ) : (
                                <>
                                    <Text className="mt-4 text-xs text-discord-textMuted">
                                        {startPending
                                            ? t("common.starting")
                                            : t(
                                                  "verificationModal.compareAShortListOfEmoji",
                                              )}
                                    </Text>
                                    <View className="mt-4 flex-col gap-2">
                                        {methods.canSas && (
                                            /* Emoji is the primary path: it always
                                               works, needs no camera, and is what
                                               users expect. QR stays available
                                               below as a secondary option. */
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityState={{
                                                    disabled:
                                                        busy || startPending,
                                                }}
                                                onPress={() => void chooseSas()}
                                                disabled={busy || startPending}
                                                className="flex-row items-center gap-3 px-3 py-2 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-50"
                                            >
                                                <ShieldCheck
                                                    size={18}
                                                    className="text-white shrink-0"
                                                />
                                                <Text className="shrink text-white text-sm font-semibold">
                                                    {t(
                                                        "verificationModal.compareEmoji",
                                                    )}
                                                </Text>
                                            </Pressable>
                                        )}
                                        {methods.canShowQr && (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityState={{
                                                    disabled:
                                                        busy || startPending,
                                                }}
                                                onPress={() =>
                                                    void openShowQr()
                                                }
                                                disabled={busy || startPending}
                                                className="flex-row items-center gap-3 px-3 py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                                            >
                                                <QrCode
                                                    size={18}
                                                    className="text-discord-textMuted shrink-0"
                                                />
                                                <Text className="shrink text-discord-textPrimary text-sm">
                                                    {t(
                                                        "verificationModal.showACodeForTheOther",
                                                    )}
                                                </Text>
                                            </Pressable>
                                        )}
                                        {methods.canScanQr && (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityState={{
                                                    disabled:
                                                        busy || startPending,
                                                }}
                                                onPress={openScanQr}
                                                disabled={busy || startPending}
                                                className="flex-row items-center gap-3 px-3 py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                                            >
                                                <Camera
                                                    size={18}
                                                    className="text-discord-textMuted shrink-0"
                                                />
                                                <Text className="shrink text-discord-textPrimary text-sm">
                                                    {t(
                                                        "verificationModal.scanTheirCodeWithTheCamera",
                                                    )}
                                                </Text>
                                            </Pressable>
                                        )}
                                    </View>
                                </>
                            )}
                            {pane !== "choose" && (
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => setPane("choose")}
                                    className="mt-4 flex-row items-center gap-1.5 self-start transition-colors"
                                >
                                    {/* Zami: `mirror:-scale-x-100` → flipped
                                        when the layout is right-to-left. */}
                                    <ArrowLeft
                                        size={14}
                                        className={`text-discord-textMuted ${
                                            I18nManager.isRTL
                                                ? "-scale-x-100"
                                                : ""
                                        }`}
                                    />
                                    <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                        {t(
                                            "verificationModal.chooseADifferentMethod",
                                        )}
                                    </Text>
                                </Pressable>
                            )}
                        </>
                    ) : (
                        <View className="mt-6 flex-col items-center gap-3">
                            <Spin>
                                <Loader2
                                    size={32}
                                    className="text-discord-accent"
                                />
                            </Spin>
                            <Text className="text-center text-sm text-discord-textSecondary">
                                {confirmed
                                    ? t(
                                          "verificationModal.waitingForTheOtherSideTo",
                                      )
                                    : statusLabel}
                            </Text>
                        </View>
                    )}

                    {alertMsg ? (
                        <Text
                            className="mt-3 text-xs text-discord-danger"
                            role="alert"
                        >
                            {alertMsg}
                        </Text>
                    ) : null}

                    <Pressable
                        accessibilityRole="button"
                        onPress={closeActive}
                        className="mt-5 w-full px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover transition-colors"
                    >
                        <Text className="text-center text-discord-textPrimary text-sm">
                            {kind === "success" || kind === "cancelled"
                                ? t("common.close")
                                : t("common.cancel")}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </Portal>
    );
}
