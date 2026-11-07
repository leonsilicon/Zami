import * as Device from "expo-device";
import {
    CameraView,
    useCameraPermissions,
    type BarcodeScanningResult,
} from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { t } from "$lib/i18n";
import { toQrPayloadBytes, isMatrixQrPayload } from "$lib/utils/qrCode";

interface Props {
    onScan: (bytes: Uint8ClampedArray) => void;
    onError?: (message: string) => void;
    /** Which decoded payloads count as a hit. Defaults to Matrix verification codes. */
    accept?: (bytes: ArrayLike<number>) => boolean;
}

// Zami: expo-camera decodes QR codes natively, off the JS thread, in place of jsQR
// running on canvas frames. The interval now only limits how often its results are
// handled here: they arrive for every frame the code is in shot.
const DECODE_INTERVAL_MS = 100;

/**
 * Zami: expo-camera reports the text it decoded (`data`), not jsQR's `binaryData`.
 * Back to bytes: one per character when every character fits in one (a byte segment
 * read as Latin-1), else the text's UTF-8.
 *
 * Zami: not ported: the QR's raw bytes. A Matrix verification code is binary (keys
 * and a random secret), and iOS gives expo-camera no text, or lossy text, for bytes
 * that aren't valid in the encoding it guesses; scanning one needs the raw byte
 * segment from the native side (AVFoundation's CIQRCodeDescriptor).
 */
function bytesOf(data: string): number[] {
    const chars = Array.from(data, (c) => c.codePointAt(0) ?? 0);
    if (chars.every((c) => c <= 0xff)) return chars;
    return Array.from(new TextEncoder().encode(data));
}

export default function QrScanner({
    onScan,
    onError,
    accept = isMatrixQrPayload,
}: Props) {
    const [, requestPermission] = useCameraPermissions();
    const camera = useRef<CameraView | null>(null);
    const [status, setStatus] = useState(() =>
        t("qrScanner.startingTheCamera"),
    );
    // Zami: what the MediaStream and the <video> were: whether the camera runs (its
    // tracks), and whether the preview is shown at all (srcObject).
    const [active, setActive] = useState(false);
    const [preview, setPreview] = useState(false);
    const lastDecode = useRef(0);
    // Terminal latch: the loop is over and an outcome has been reported.
    const done = useRef(false);
    // Separate latch so a payload can never be handed up twice. It is set
    // BEFORE `onScan` runs while `done` stays false, which is what lets a throw
    // from the consumer still travel through `fail()`.
    const delivered = useRef(false);

    /**
     * End the scanning and the camera. The session stops on EVERY path — the
     * camera indicator must always go out — but removing the preview is opt-out.
     *
     * A paused preview holds a frozen last frame; removing it blanks it to
     * black instead. Black is right under error text, and wrong after a
     * successful scan: the consumer's handshake can take seconds, and the frozen
     * frame is all that stands between the user and a black box.
     */
    function stop(clearPreview = true): void {
        if (!clearPreview) void camera.current?.pausePreview().catch(() => {});
        setActive(false);
        if (clearPreview) setPreview(false);
    }

    function fail(message: string): void {
        if (done.current) return;
        done.current = true;
        stop();
        setStatus(message);
        onError?.(message);
    }

    /**
     * Map a camera failure to user-facing copy, logging the raw error the way
     * crypto.ts's `verificationFailureText` does — the platform's own message is
     * developer-facing, but a bug report is useless without it.
     */
    function cameraFailureText(e: unknown): string {
        console.warn("[matrix] could not open the camera for QR scanning", e);
        const name = e instanceof Error ? e.name : "";
        if (name === "NotAllowedError")
            return t("qrScanner.cameraAccessWasDenied");
        if (name === "NotFoundError")
            return t("qrScanner.noCameraWasFoundOnThis");
        if (name === "NotReadableError")
            return t("qrScanner.theCameraIsAlreadyInUse");
        // Zami: upstream's last resort blames a missing https connection, which an
        // app never has; the preview failing is the closest true copy.
        return t("qrScanner.couldNotStartTheCameraPreview");
    }

    function scanFrame(result: BarcodeScanningResult): void {
        if (done.current || delivered.current) return;
        const now = Date.now();
        // `now - 0` clears the interval on the very first result, so throttling
        // costs no latency on a code that is already in shot.
        if (now - lastDecode.current < DECODE_INTERVAL_MS) return;
        lastDecode.current = now;
        const payload = result.data
            ? toQrPayloadBytes(bytesOf(result.data))
            : null;
        if (payload && accept(payload) && !delivered.current) {
            delivered.current = true;
            // Keep the last frame: the consumer's handshake runs from
            // here, and a black square under "checking it…" reads as a
            // crash. `fail()` below still blanks it if that throws.
            stop(false);
            setStatus(t("qrScanner.codeFoundCheckingIt"));
            try {
                onScan(payload);
                done.current = true;
            } catch (e) {
                // We are inside a native event callback: an escaping throw
                // would be an unhandled error with no path back to the UI.
                console.warn("[matrix] QR scan handler threw", e);
                fail(t("qrScanner.couldNotStartVerificationWithThat"));
            }
            return;
        }
        setStatus(t("qrScanner.thatIsnTAVerificationCode"));
    }

    async function start(): Promise<void> {
        // Zami: the iOS simulator has no camera (and expo-camera reports nothing there).
        if (Platform.OS === "ios" && !Device.isDevice) {
            fail(t("qrScanner.thisDeviceHasNoCameraAvailable"));
            return;
        }
        try {
            const permission = await requestPermission();
            if (!permission.granted) {
                fail(t("qrScanner.cameraAccessWasDenied"));
                return;
            }
        } catch (e) {
            fail(cameraFailureText(e));
            return;
        }
        if (done.current) {
            stop();
            return;
        }
        setPreview(true);
        setActive(true);
        // The status moves on to "point the camera" in onCameraReady, once the
        // preview is running (upstream's `video.play()`).
    }

    useEffect(() => {
        // Zami: a fresh mount, as each Svelte instance is (React's StrictMode
        // mounts twice).
        done.current = false;
        delivered.current = false;
        void start();
        return () => {
            done.current = true;
            stop();
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount: it must never open a second camera.
    }, []);

    return (
        <View className="flex flex-col items-center gap-2">
            {/* The preview conveys nothing without sight and the live region below
                already carries every state change, so hide it rather than label it. */}
            <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="h-48 w-48 rounded bg-black overflow-hidden"
            >
                {preview ? (
                    <CameraView
                        ref={camera}
                        style={StyleSheet.absoluteFill}
                        facing="back"
                        active={active}
                        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                        onBarcodeScanned={active ? scanFrame : undefined}
                        onCameraReady={() => {
                            if (!done.current)
                                setStatus(
                                    t("qrScanner.pointTheCameraAtTheirCode"),
                                );
                        }}
                        onMountError={({ message }) => {
                            console.warn(
                                "[matrix] could not start the camera preview",
                                message,
                            );
                            fail(t("qrScanner.couldNotStartTheCameraPreview"));
                        }}
                    />
                ) : null}
            </View>
            <Text
                accessibilityLiveRegion="polite"
                className="text-xs text-discord-textMuted"
            >
                {status}
            </Text>
        </View>
    );
}
