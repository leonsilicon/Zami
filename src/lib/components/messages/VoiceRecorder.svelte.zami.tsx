import { Spin, SvgIcon } from "@-/com.leonsilicon.zami.rn";
import {
    AudioQuality,
    IOSOutputFormat,
    requestRecordingPermissionsAsync,
    setAudioModeAsync,
    useAudioPlayer,
    useAudioPlayerStatus,
    useAudioRecorder,
    type AudioRecorder,
    type RecordingOptions,
} from "expo-audio";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { Rect } from "react-native-svg";
import { t } from "$lib/i18n";
import { sendVoiceMessage } from "$lib/matrix/client";
import type { MediaRelation } from "$lib/matrix/client";
import { computeWaveform } from "$lib/utils/voiceMessage";
import { formatCallDuration } from "$lib/utils/callDuration";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import { holdPageAlive } from "$lib/stores/pageKeepAlive";
import {
    newCaptureLifecycle,
    beginCapture,
    disposeCaptures,
    isCaptureCurrent,
    adoptCapture,
    type CaptureLifecycle,
} from "$lib/utils/captureLifecycle";

interface Props {
    roomId: string;
    /** Thread to post into and/or message being replied to, read at send. */
    getRelation?: () => MediaRelation | undefined;
    /** Called once the voice message is sent (before onClose). */
    onSent?: (relation: MediaRelation | undefined) => void;
    onClose: () => void;
}

const MAX_MS = 5 * 60 * 1000; // safety cap
const WAVE_BARS = 48;
const DECODE_TIMEOUT_MS = 3000;

// Zami: upstream asks MediaRecorder for Opus (WebM, then Ogg) and takes MP4 where
// that's all there is (Safari). iOS can't record Opus, and expo-audio's Android
// encoders don't include it, so both record AAC in MP4: Safari's `audio/mp4`,
// which `sendVoiceMessage` sends as `voice-message.mp4`. Mono, at a voice bitrate.
const VOICE_MIME_TYPE = "audio/mp4";
const VOICE_RECORDING: RecordingOptions = {
    extension: ".m4a",
    sampleRate: 48000,
    numberOfChannels: 1,
    bitRate: 64000,
    // The live meter, and from it the waveform.
    isMeteringEnabled: true,
    android: { outputFormat: "mpeg4", audioEncoder: "aac" },
    ios: {
        outputFormat: IOSOutputFormat.MPEG4AAC,
        audioQuality: AudioQuality.HIGH,
    },
    web: { mimeType: "audio/webm", bitsPerSecond: 64000 },
};

// Zami: the `voice-rec-pulse` keyframes, as a Reanimated CSS animation.
const VOICE_REC_PULSE = {
    animationName: { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.3 } },
    animationDuration: "1.2s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
} as const;

type Phase = "recording" | "preview" | "sending";

// Upstream's per-instance `let`s, which nothing renders.
interface RecorderVars {
    /** The open microphone: expo-audio's recorder once it's prepared. */
    stream: AudioRecorder | null;
    /** The same recorder once it records (upstream's MediaRecorder). */
    recorder: AudioRecorder | null;
    /** MediaRecorder's `state !== "inactive"`. */
    recording: boolean;
    recordedBlob: Blob | null;
    mimeType: string;
    // The container type the recorder reports itself, used when no mimeType was picked.
    recordedType: string;
    /** Zami: the live meter's readings, which the waveform is computed from. */
    levels: number[];
    raf: number;
    startTs: number;
    elapsedTimer: ReturnType<typeof setInterval> | null;
    autoStop: ReturnType<typeof setTimeout> | null;
    // The recording mic is one capture channel; `cleanup()` closes it for good.
    capture: CaptureLifecycle;
}

/**
 * Zami: what `stopTracks(stream)` does for the microphone: stop recording, and
 * leave the record-capable audio session for the plain playback one. A
 * recorder React already released has nothing left to stop.
 */
function releaseMicrophone(recorder: AudioRecorder): void {
    try {
        if (recorder.isRecording) recorder.stop().catch(() => {});
    } catch {
        /* already released */
    }
    setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
    }).catch(() => {});
}

export default function VoiceRecorder({
    roomId,
    getRelation,
    onSent,
    onClose,
}: Props) {
    const [phase, setPhaseState] = useState<Phase>("recording");
    const [level, setLevel] = useState(0); // 0..1 live meter
    const [elapsedMs, setElapsedMs] = useState(0);
    const [waveform, setWaveform] = useState<number[]>([]);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewDurationMs, setPreviewDurationMs] = useState(0);
    // `send` reads the phase before a re-render can show it.
    const phaseRef = useRef<Phase>("recording");
    const [vars] = useState<RecorderVars>(() => ({
        stream: null,
        recorder: null,
        recording: false,
        recordedBlob: null,
        mimeType: "",
        recordedType: "",
        levels: [],
        raf: 0,
        startTs: 0,
        elapsedTimer: null,
        autoStop: null,
        capture: newCaptureLifecycle(),
    }));

    function setPhase(next: Phase) {
        phaseRef.current = next;
        setPhaseState(next);
    }

    // The recorder's onerror; `cleanup()` unwires it by clearing `recorder`.
    function onRecorderError(error: string | null) {
        if (!vars.recorder) return;
        console.error("[voice] recorder failed", error);
        showErrorToast(
            `${t("voiceRecorder.recordingFailed")} (${error ?? "unknown"})`,
        );
        cleanup();
        onClose();
    }
    const audioRecorder = useAudioRecorder(VOICE_RECORDING, (status) => {
        if (status.hasError) onRecorderError(status.error);
    });
    // Zami: plays the preview (upstream's <audio controls>).
    const previewPlayer = useAudioPlayer(previewUrl);
    const previewStatus = useAudioPlayerStatus(previewPlayer);

    async function start() {
        const capture = vars.capture;
        const ticket = beginCapture(capture);
        // Zami: no MediaRecorder to pick a type for; see VOICE_RECORDING.
        vars.mimeType = VOICE_MIME_TYPE;
        let granted: AudioRecorder;
        try {
            // Zami: the permission prompt, then preparing the recorder, stand
            // in for getUserMedia.
            const permission = await requestRecordingPermissionsAsync();
            if (!permission.granted)
                throw new Error("Microphone permission denied");
            await setAudioModeAsync({
                allowsRecording: true,
                playsInSilentMode: true,
            });
            await audioRecorder.prepareToRecordAsync();
            granted = audioRecorder;
        } catch (err) {
            // A denial that arrives after teardown has no UI left to tell.
            if (!isCaptureCurrent(capture, ticket)) return;
            console.error("[voice] couldn't open the microphone", err);
            // Zami: micErrorMessage only recognises getUserMedia's
            // DOMExceptions, which expo-audio never throws (and Hermes has no
            // DOMException to test for), so this is its fallback.
            showErrorToast(t("voiceRecorder.microphoneAccessWasDenied"));
            onClose();
            return;
        }
        // The prompt can be answered long after the recorder closed; the
        // cleanup that already ran had no stream to stop, so a late grant
        // would leave the mic live with nothing able to release it.
        const adopted = adoptCapture(
            capture,
            ticket,
            granted,
            releaseMicrophone,
        );
        if (!adopted) return;
        vars.stream = adopted;
        try {
            // Zami: expo-audio's recorder has one format (VOICE_RECORDING), so
            // there's no fallback to construct, and it records to a file rather
            // than handing over chunks: stop() resolves into onStopped, and
            // onRecorderError is its onerror.
            vars.recorder = adopted;
            vars.recordedType = VOICE_MIME_TYPE;
            vars.levels = [];
            adopted.record();
            vars.recording = true;
            vars.startTs = performance.now();
            vars.elapsedTimer = setInterval(() => {
                setElapsedMs(performance.now() - vars.startTs);
            }, 200);
            vars.autoStop = setTimeout(() => stop(), MAX_MS);
            setPhase("recording");
            // Live meter. Best-effort: a failure here must not stop recording.
            // Zami: no AnalyserNode; expo-audio meters the recording in dBFS,
            // the average power on iOS (upstream's RMS) and the peak on Android.
            const meter = (decibels: number | undefined) => {
                const amplitude =
                    decibels === undefined ? 0 : 10 ** (decibels / 20);
                return Math.min(
                    1,
                    amplitude * (Platform.OS === "android" ? 1 : 4),
                );
            };
            const tick = () => {
                try {
                    const next = meter(adopted.getStatus().metering);
                    vars.levels.push(next);
                    setLevel(next);
                    vars.raf = requestAnimationFrame(tick);
                } catch {
                    setLevel(0);
                }
            };
            vars.raf = requestAnimationFrame(tick);
        } catch (err) {
            console.error("[voice] recorder failed", err);
            // A start failure after the teardown already ran has no UI left.
            if (!isCaptureCurrent(capture, ticket)) {
                cleanup();
                return;
            }
            const name = err instanceof Error ? err.name : "unknown";
            showErrorToast(`${t("voiceRecorder.recordingFailed")} (${name})`);
            cleanup();
            onClose();
        }
    }

    function stop() {
        // `phase` starts as "recording", so Stop is on screen while the mic
        // prompt is still open and `recorder` is null. Without this branch the
        // click was a no-op that left the ticket current, and answering Allow
        // afterwards started a recording the user had already stopped.
        const recorder = vars.recorder;
        if (!recorder) {
            discard();
            return;
        }
        if (vars.recording) {
            vars.recording = false;
            recorder.stop().then(
                () => {
                    // `cleanup()` unwires the recorder (upstream's
                    // `recorder.onstop = null`).
                    if (vars.recorder === recorder) void onStopped();
                },
                (err: unknown) =>
                    onRecorderError(err instanceof Error ? err.message : null),
            );
        }
    }

    function teardownCapture() {
        cancelAnimationFrame(vars.raf);
        if (vars.elapsedTimer) clearInterval(vars.elapsedTimer);
        if (vars.autoStop) clearTimeout(vars.autoStop);
        vars.elapsedTimer = null;
        vars.autoStop = null;
        if (vars.stream) releaseMicrophone(vars.stream);
        vars.stream = null;
    }

    async function onStopped() {
        if (vars.capture.disposed) return;
        setPreviewDurationMs(performance.now() - vars.startTs);
        teardownCapture();
        // Zami: the recording is a file, not chunks. Reading it fails only if
        // it's missing, which is a recording of nothing.
        const uri = audioRecorder.uri;
        const recorded = uri
            ? await fetch(uri)
                  .then((response) => response.blob())
                  .catch(() => null)
            : null;
        // Closing the composer while the file was read already deleted it.
        if (vars.capture.disposed) return;
        const recordedBlob = new Blob(recorded ? [recorded] : [], {
            type:
                vars.mimeType ||
                vars.recordedType ||
                recorded?.type ||
                "audio/webm",
        });
        vars.recordedBlob = recordedBlob;
        setPreviewUrl(uri);
        // Decode for the waveform (best-effort; empty waveform is acceptable).
        let decodeCtx: AudioContext | null = null;
        let decodeTimer: ReturnType<typeof setTimeout> | null = null;
        try {
            decodeCtx = new AudioContext();
            // A hanging decode must not block the preview; fall back to no waveform.
            const audioBuf = await Promise.race([
                decodeCtx.decodeAudioData(await recordedBlob.arrayBuffer()),
                new Promise<never>((_, reject) => {
                    decodeTimer = setTimeout(
                        () => reject(new Error("decode timed out")),
                        DECODE_TIMEOUT_MS,
                    );
                }),
            ]);
            setWaveform(computeWaveform(audioBuf.getChannelData(0), WAVE_BARS));
        } catch {
            // Zami: the live meter's readings, where upstream has no waveform.
            setWaveform(
                vars.levels.length > 0
                    ? computeWaveform(Float32Array.from(vars.levels), WAVE_BARS)
                    : [],
            );
        } finally {
            if (decodeTimer) clearTimeout(decodeTimer);
            // A failed decode used to leak its context, and browsers cap how
            // many a document may hold — one exhausted cap breaks the mic
            // meter and every call sound.
            void decodeCtx?.close().catch(() => {});
        }
        // Closing the composer mid-decode already revoked the preview URL.
        if (vars.capture.disposed) return;
        setPhase("preview");
    }

    async function send() {
        const recordedBlob = vars.recordedBlob;
        if (!recordedBlob || phaseRef.current === "sending") return;
        if (recordedBlob.size === 0) {
            showErrorToast(t("voiceRecorder.nothingWasRecorded"));
            discard();
            return;
        }
        setPhase("sending");
        const relation = getRelation?.();
        try {
            await sendVoiceMessage(
                roomId,
                recordedBlob,
                previewDurationMs,
                waveform,
                relation,
            );
            onSent?.(relation);
            cleanup();
            onClose();
        } catch (err) {
            showErrorToast(
                err instanceof Error
                    ? err.message
                    : t("voiceRecorder.failedToSendVoiceMessage"),
            );
            setPhase("preview");
        }
    }

    function discard() {
        cleanup();
        onClose();
    }

    function cleanup() {
        disposeCaptures(vars.capture);
        // Stop + unwire the recorder before releasing the stream, so a discard
        // or unmount mid-recording doesn't fire a late onstop that rebuilds a
        // blob + object URL nothing would revoke.
        if (vars.recorder) {
            const recorder = vars.recorder;
            vars.recorder = null;
            if (vars.recording) {
                vars.recording = false;
                try {
                    recorder.stop().catch(() => {});
                } catch {
                    /* already inactive */
                }
            }
        }
        teardownCapture();
        // Zami: deleting the recording is revoking its object URL. The Blob
        // read from it holds its own copy.
        try {
            const uri = audioRecorder.uri;
            if (uri) {
                const file = new File(uri);
                if (file.exists) file.delete();
            }
        } catch {
            /* nothing was recorded, or the recorder is already released */
        }
        setPreviewUrl(null);
        vars.recordedBlob = null;
        vars.levels = [];
    }

    // Zami: the preview's play/pause; a finished preview plays from the start.
    function togglePreview() {
        if (previewStatus.playing) {
            previewPlayer.pause();
            return;
        }
        if (
            previewStatus.isLoaded &&
            previewStatus.duration > 0 &&
            previewStatus.currentTime >= previewStatus.duration - 0.05
        ) {
            previewPlayer
                .seekTo(0)
                .then(() => previewPlayer.play())
                .catch(() => {});
            return;
        }
        previewPlayer.play();
    }

    useEffect(() => {
        // An open recorder (recording, previewing or sending) must not be cut
        // off by a background release's reload (backgroundRelease.ts).
        const release = holdPageAlive();
        void start();
        return () => {
            release();
            cleanup();
        };
    }, []);

    return (
        <View className="input-box relative flex-row items-center gap-3 bg-discord-backgroundSecondary rounded-lg px-3 py-2.5 border border-transparent">
            {phase === "recording" ? (
                <>
                    {/* Cancel */}
                    <Pressable
                        accessibilityRole="button"
                        onPress={discard}
                        className="flex-shrink-0 p-1.5 rounded transition-colors"
                        accessibilityLabel={t("voiceRecorder.cancelRecording")}
                    >
                        <SvgIcon
                            className="w-5 h-5 text-discord-textMuted"
                            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                        />
                    </Pressable>

                    {/* Red pulsing dot */}
                    <Animated.View
                        style={VOICE_REC_PULSE}
                        importantForAccessibility="no-hide-descendants"
                        accessibilityElementsHidden
                    >
                        <View className="w-3 h-3 rounded-full flex-shrink-0 bg-discord-danger" />
                    </Animated.View>

                    {/* Elapsed time */}
                    <Text className="flex-shrink-0 text-sm font-mono tabular-nums text-discord-textPrimary">
                        {formatCallDuration(elapsedMs)}
                    </Text>

                    {/* Live level meter */}
                    <View className="flex-1 min-w-0 h-2 rounded-full bg-discord-backgroundTertiary overflow-hidden">
                        <View
                            className="h-full rounded-full bg-discord-accent"
                            style={{ width: `${level * 100}%` }}
                        />
                    </View>

                    {/* Stop */}
                    <Pressable
                        accessibilityRole="button"
                        onPress={stop}
                        className="flex-shrink-0 flex-row items-center gap-1.5 px-3 py-1.5 rounded bg-discord-accent hover:opacity-90 transition-opacity"
                    >
                        <SvgIcon className="w-4 h-4 text-white">
                            <Rect x="6" y="6" width="12" height="12" rx="1.5" />
                        </SvgIcon>
                        <Text className="text-white text-sm font-medium">
                            {t("voiceRecorder.stop")}
                        </Text>
                    </Pressable>
                </>
            ) : (
                <>
                    {/* Discard */}
                    <Pressable
                        accessibilityRole="button"
                        onPress={discard}
                        disabled={phase === "sending"}
                        className="flex-shrink-0 p-1.5 rounded transition-colors disabled:opacity-40"
                        accessibilityLabel={t("voiceRecorder.discardRecording")}
                    >
                        <SvgIcon
                            className="w-5 h-5 text-discord-textMuted"
                            d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                        />
                    </Pressable>

                    {/* Waveform preview */}
                    <View className="flex-1 min-w-0 flex-row items-center gap-[2px] h-8 overflow-hidden">
                        {waveform.length > 0 ? (
                            waveform.map((bar, i) => (
                                <View
                                    key={i}
                                    className="flex-1 min-w-[2px] rounded-full bg-discord-accent/80"
                                    style={{
                                        height: `${Math.max(8, (bar / 1024) * 100)}%`,
                                    }}
                                />
                            ))
                        ) : (
                            <Text className="text-xs text-discord-textMuted">
                                {t("voiceRecorder.voiceMessage")}
                            </Text>
                        )}
                    </View>

                    {/* Duration */}
                    <Text className="flex-shrink-0 text-sm font-mono tabular-nums text-discord-textMuted">
                        {formatCallDuration(previewDurationMs)}
                    </Text>

                    {/* Playback. Zami: <audio controls> has no React Native
                        equivalent; this plays and pauses the preview. */}
                    {previewUrl && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("voiceRecorder.voiceMessage")}
                            onPress={togglePreview}
                            className="flex-shrink-0 w-8 h-8 rounded-full bg-discord-backgroundTertiary items-center justify-center"
                        >
                            {previewStatus.playing ? (
                                <SvgIcon
                                    className="w-4 h-4 text-discord-textPrimary"
                                    d="M6 5h4v14H6zM14 5h4v14h-4z"
                                />
                            ) : (
                                <SvgIcon
                                    className="w-4 h-4 ms-0.5 text-discord-textPrimary"
                                    d="M8 5v14l11-7z"
                                />
                            )}
                        </Pressable>
                    )}

                    {/* Send */}
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void send()}
                        disabled={phase === "sending"}
                        className="flex-shrink-0 flex-row items-center gap-1.5 px-3 py-1.5 rounded bg-discord-accent hover:opacity-90 transition-opacity disabled:opacity-60"
                    >
                        {phase === "sending" ? (
                            <>
                                <Spin className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                                <Text className="text-white text-sm font-medium">
                                    {t("voiceRecorder.sending")}
                                </Text>
                            </>
                        ) : (
                            <>
                                <SvgIcon
                                    className="w-4 h-4 text-white"
                                    d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"
                                />
                                <Text className="text-white text-sm font-medium">
                                    {t("voiceRecorder.send")}
                                </Text>
                            </>
                        )}
                    </Pressable>
                </>
            )}
        </View>
    );
}
