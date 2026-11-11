import * as Device from "expo-device";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
    FRAME_PICTURE_SIZE,
    scanQrFrame,
    type QrFrame,
} from "@-/com.leonsilicon.zami.camera";
import { t } from "$lib/i18n";
import { toQrPayloadBytes, isMatrixQrPayload } from "$lib/utils/qrCode";

interface Props {
    onScan: (bytes: Uint8ClampedArray) => void;
    onError?: (message: string) => void;
    /** Which decoded payloads count as a hit. Defaults to Matrix verification codes. */
    accept?: (bytes: ArrayLike<number>) => boolean;
}

// jsQR is synchronous and routinely overruns a frame budget on a mid-range
// phone, so decoding on every rAF pins the main thread at a 100% duty cycle
// — and that is the SAME thread rust-crypto and the SDK's to-device
// processing run on, so the modal's own Cancel button and the incoming
// reciprocate prompt stall exactly while the user is waiting on them.
// Decoding ~10x/second is imperceptible for scan latency and leaves the
// thread free in between. (zxing-js ships the same idea as
// `timeBetweenScansMillis`.)
//
// Zami: expo-camera's own scanner can't stand in for jsQR: it reports text, and a
// Matrix code is binary (keys and a random secret), for which iOS gives no text or
// lossy text. So each frame is a still the camera takes, whose codes a native
// module reads off this thread as raw codewords that become the payload's exact
// bytes (@-/com.leonsilicon.zami.camera's scanQrFrame; jpeg-js and jsQR on this
// thread only in a build without that module). Taking a still takes longer than
// this interval, so it's the wait after each frame rather than the time between
// frames' starts: at least as long as whatever ran on this thread for the frame.
const DECODE_INTERVAL_MS = 100;

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
    const frame = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastDecode = useRef(0);
    // Zami: the preview is running (upstream's `video.play()` resolved): frames
    // can be taken.
    const scanning = useRef(false);
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
        if (frame.current !== null) clearTimeout(frame.current);
        frame.current = null;
        scanning.current = false;
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

    async function scanFrame(): Promise<void> {
        frame.current = null;
        if (done.current) return;
        const cam = camera.current;
        const now = Date.now();
        // `now - 0` clears the interval on the very first frame, so throttling
        // costs no latency on a code that is already in shot.
        let busy = 0;
        if (
            cam &&
            scanning.current &&
            now - lastDecode.current >= DECODE_INTERVAL_MS
        ) {
            // Zami: in place of drawing the video on a canvas and jsQR: a still
            // from the camera, its codes' payloads (jsQR's `binaryData`) read
            // natively. jsQR finds one code; of several, take one `accept` likes.
            let scanned: QrFrame | null = null;
            try {
                scanned = await scanQrFrame(cam);
            } catch (e) {
                // The camera wasn't ready for a picture; try the next frame.
                console.warn("[matrix] could not capture a camera frame", e);
            }
            if (done.current) return;
            if (scanned) {
                const decodeStart = Date.now();
                const found = scanned.payloads.length > 0;
                const payloads = scanned.payloads.map((code) =>
                    toQrPayloadBytes(code),
                );
                const payload =
                    payloads.find((bytes) => bytes && accept(bytes)) ??
                    payloads[0] ??
                    null;
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
                        // We are inside a timer callback: an escaping throw would
                        // be an unhandled error with no path back to the UI.
                        console.warn("[matrix] QR scan handler threw", e);
                        fail(t("qrScanner.couldNotStartVerificationWithThat"));
                    }
                    return;
                }
                if (found) setStatus(t("qrScanner.thatIsnTAVerificationCode"));
                busy = scanned.busyMs + Date.now() - decodeStart;
            }
            lastDecode.current = Date.now();
        }
        // Zami: a timer in place of requestAnimationFrame (see DECODE_INTERVAL_MS).
        frame.current = setTimeout(
            () => void latestScanFrame.current(),
            Math.max(DECODE_INTERVAL_MS, busy),
        );
    }
    // Zami: the timer runs the latest render's scanFrame, which sees the current
    // props (`accept`, `onScan`), as upstream's reads them.
    const latestScanFrame = useRef(scanFrame);
    latestScanFrame.current = scanFrame;

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
        // The status moves on to "point the camera", and the frames start, in
        // onCameraReady, once the preview is running (upstream's `video.play()`).
    }

    // Zami: upstream's code after `video.play()`.
    function onCameraReady(): void {
        if (done.current || scanning.current) return;
        scanning.current = true;
        setStatus(t("qrScanner.pointTheCameraAtTheirCode"));
        frame.current = setTimeout(() => void latestScanFrame.current(), 0);
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
                        pictureSize={FRAME_PICTURE_SIZE}
                        animateShutter={false}
                        onCameraReady={onCameraReady}
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
