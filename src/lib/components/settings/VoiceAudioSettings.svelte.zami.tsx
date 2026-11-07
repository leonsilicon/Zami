import {
    notificationPermission,
    Range,
    requestNotificationPermission,
    Select,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useRef, useState } from "react";
import {
    AppState,
    Pressable,
    Text,
    View,
    type NativeEventSubscription,
} from "react-native";
import {
    VIDEO_CODECS,
    VIDEO_CODEC_LABELS,
    isMandatoryCodec,
} from "$lib/utils/videoCodecs";
import { t } from "$lib/i18n";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import {
    settingsState,
    setAudioInputDeviceId,
    setAudioOutputDeviceId,
    setVideoInputDeviceId,
    setCameraDisabled,
    setCallOutputVolume,
    setNoiseSuppressionMode,
    setEchoCancellation,
    setMicGainMode,
    setNormalizeCallAudio,
    setCallSoundsEnabled,
    setCallSoundsVolume,
    setRingEnabled,
    setRingVolume,
    setMirrorCamera,
    setPushToTalk,
    setCallVideoCodec,
    setBlockedDecodeCodecs,
    setAdaptiveStream,
    setNoiseSuppressionGpu,
} from "$lib/stores/settings.svelte";
import {
    toDeviceOptions,
    resolveDeviceId,
    outputPickerMode,
    buildDeviceConstraint,
    isOverconstrainedError,
    CAMERA_DISABLED,
    type DeviceOption,
} from "$lib/utils/audioDevices";
import {
    listMediaDevices,
    onDevicesChanged,
    canSetAudioSink,
    canSelectAudioOutput,
    promptSelectAudioOutput,
} from "$lib/audio/devices";
// Zami: startMicMeter is this file's own (below).
import type { MicMeterHandle, MicMeterOptions } from "$lib/audio/micMeter";
import { startOutputMeter, streamSetKey } from "$lib/audio/outputMeter";
import { normalizeMicGainMode } from "$lib/utils/micGainMode";
import {
    normalizeNoiseSuppressionMode,
    noiseSuppressionHasGpu,
    noiseSuppressionUsesGpu,
} from "$lib/utils/noiseSuppressionMode";
import { planMicProcessing } from "$lib/utils/micProcessing";
import { deepFilterSupported } from "$lib/audio/deepFilter";
import { rnnoiseSupported } from "$lib/audio/rnnoise";
import { fastEnhancerSupported } from "$lib/audio/fastenhancer";
import { fastEnhancerGpuSupported } from "$lib/audio/fastenhancerGpu";
import {
    findMicFilter,
    isPluginFilterKey,
    listMicFilters,
    micFilterUsable,
} from "$lib/audio/micFilters";
import { pluginRegistry } from "$lib/stores/plugins.svelte";
import { playSpeakerTestTone } from "$lib/audio/speakerTest";
// Zami: not ported: call sounds and the ringtone are synthesized with Web Audio,
// which React Native doesn't have, so these play nothing (they return without an
// AudioContext). Their settings are still stored and configured.
import {
    playCallSound,
    configureCallSounds,
    configureRing,
    playRingBlip,
    playRingPreview,
} from "$lib/audio/soundEffects";
// Zami: requestNotificationPermission is the shared one, through expo-notifications.
import { callAlertHint } from "$lib/utils/notifyPermission";
import {
    setVoiceInputDevice,
    setVoiceOutputDevice,
    setVoiceOutputVolume,
    setVoiceNormalization,
    updateServiceWorkerRingEnabled,
    setVoiceCaptureConstraints,
    getRemoteAudioStreams,
    refreshDecodeSupport,
} from "$lib/matrix/client";
import { syncNativeRingEnabled } from "$lib/nativeSession";
import {
    hasNativeCallService,
    canUseFullScreenCalls,
    openFullScreenCallSettings,
} from "$lib/nativeCall";
import {
    voiceCallState,
    setCallVideoInputDevice,
    stopCallCamera,
    refreshMicGate,
} from "$lib/stores/voiceCall.svelte";
import { bindingFor, keybindsState } from "$lib/stores/keybinds.svelte";
import { openAppSettingsTab } from "$lib/stores/interface.svelte";
import {
    newCaptureLifecycle,
    beginCapture,
    cancelCapture,
    disposeCaptures,
    isCaptureCurrent,
    adoptCapture,
    stopTracks,
    stopHandle,
} from "$lib/utils/captureLifecycle";

// Zami: not ported: the mic test. $lib/audio/micMeter opens the mic through
// navigator.mediaDevices and meters it with Web Audio, neither of which React
// Native has, so this fails the way a mic that can't be opened does: the tab
// shows "Microphone unavailable" in place of the level meter and "Test mic".
function startMicMeter(opts: MicMeterOptions): Promise<MicMeterHandle> {
    void opts;
    return Promise.reject(new Error("Zami: no Web Audio microphone"));
}

// Zami: not ported: the camera preview. There's no navigator.mediaDevices in
// React Native (expo-camera's CameraView could show the preview), so this fails
// the way a camera that can't be opened does: "Preview" shows "Camera
// unavailable".
function getUserMedia(
    constraints: MediaStreamConstraints,
): Promise<MediaStream> {
    void constraints;
    return Promise.reject(new Error("Zami: no getUserMedia"));
}

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. Text classes sit on each Text, a button in a column
// gets `self-start` (a <button> is as wide as its text), and a label beside a
// control gets `shrink` or `flex-1` so its text wraps as a web flex item's does.
export default function VoiceAudioSettings() {
    const [inputs, setInputs] = useState<DeviceOption[]>([]);
    const [outputs, setOutputs] = useState<DeviceOption[]>([]);
    const [cameras, setCameras] = useState<DeviceOption[]>([]);
    const [micLevel, setMicLevel] = useState(0);
    const [outLevel, setOutLevel] = useState(0);
    const [loopbackOn, setLoopbackOnState] = useState(false);
    const [micError, setMicError] = useState<string | null>(null);
    const [cameraOn, setCameraOnState] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    // Why incoming-call OS alerts stay silent (blocked/unsupported), or null.
    const [ringNotifyHint, setRingNotifyHint] = useState<string | null>(null);
    // Android 14+: whether an incoming DM call may ring full screen over the
    // lock screen. Re-checked when the user comes back from system settings.
    const [fullScreenCallsGranted, setFullScreenCallsGranted] = useState(true);
    // Zami: `document.visibilityState` is AppState's.
    const refreshFullScreenCalls = () => {
        if (AppState.currentState !== "active") return;
        void canUseFullScreenCalls().then((granted) => {
            if (!destroyed.current) setFullScreenCallsGranted(granted);
        });
    };
    // Zami: no `videoEl`: the preview <video> isn't ported (see getUserMedia).
    const cameraStream = useRef<MediaStream | null>(null);
    const meter = useRef<MicMeterHandle | null>(null);
    const stopOutputMeter = useRef<(() => void) | null>(null);
    const unsubDevices = useRef<(() => void) | null>(null);
    // Separate channels: restarting the mic meter must not cancel an in-flight
    // camera grant, or vice versa.
    const [micCapture] = useState(newCaptureLifecycle);
    const [cameraCapture] = useState(newCaptureLifecycle);
    // Guards the post-await *state* writes that aren't captures.
    const destroyed = useRef(false);

    // Zami: the callbacks below run after awaits, and toggleCamera runs right after
    // stopCamera, so they read these through refs rather than the last render.
    const inputsRef = useRef<DeviceOption[]>([]);
    const loopbackOnRef = useRef(false);
    const cameraOnRef = useRef(false);
    function setLoopbackOn(on: boolean): void {
        loopbackOnRef.current = on;
        setLoopbackOnState(on);
    }
    function setCameraOn(on: boolean): void {
        cameraOnRef.current = on;
        setCameraOnState(on);
    }

    const audioInputDeviceId = useRune(() => settingsState.audioInputDeviceId);
    const audioOutputDeviceId = useRune(
        () => settingsState.audioOutputDeviceId,
    );
    const videoInputDeviceId = useRune(() => settingsState.videoInputDeviceId);
    const cameraDisabled = useRune(() => settingsState.cameraDisabled);
    const callOutputVolume = useRune(() => settingsState.callOutputVolume);
    const noiseSuppressionMode = useRune(
        () => settingsState.noiseSuppressionMode,
    );
    const noiseSuppressionGpu = useRune(
        () => settingsState.noiseSuppressionGpu,
    );
    const echoCancellation = useRune(() => settingsState.echoCancellation);
    const micGainMode = useRune(() => settingsState.micGainMode);
    const normalizeCallAudio = useRune(() => settingsState.normalizeCallAudio);
    const pushToTalk = useRune(() => settingsState.pushToTalk);
    const mirrorCamera = useRune(() => settingsState.mirrorCamera);
    const callVideoCodec = useRune(() => settingsState.callVideoCodec);
    const blockedDecodeCodecs = useRune(
        () => settingsState.blockedDecodeCodecs,
    );
    const adaptiveStream = useRune(() => settingsState.adaptiveStream);
    const callSoundsEnabled = useRune(() => settingsState.callSoundsEnabled);
    const callSoundsVolume = useRune(() => settingsState.callSoundsVolume);
    const ringEnabled = useRune(() => settingsState.ringEnabled);
    const ringVolume = useRune(() => settingsState.ringVolume);
    const connState = useRune(() => voiceCallState.connState);

    // Zami: not ported: output devices. React Native has no setSinkId, so the
    // mode is "hidden": the system routes audio, as the panel then says.
    const outputMode = outputPickerMode({
        canSetSink: canSetAudioSink(),
        hasOutputs: outputs.length > 0,
        canSelectAudioOutput: canSelectAudioOutput(),
    });
    const inputFallback = resolveDeviceId(
        audioInputDeviceId,
        inputs,
    ).usedFallback;

    // Zami: not ported: device lists. listMediaDevices finds none without
    // navigator.mediaDevices, so each picker offers only its built-in entries.
    async function refreshDevices(): Promise<void> {
        const all = await listMediaDevices();
        if (destroyed.current) return;
        inputsRef.current = toDeviceOptions(all, "audioinput");
        setInputs(inputsRef.current);
        setOutputs(toDeviceOptions(all, "audiooutput"));
        setCameras(toDeviceOptions(all, "videoinput"));
    }

    const pttBound = useRune(() => {
        void keybindsState.overrides;
        return bindingFor("pushToTalk") !== null;
    });
    // Set when the user tried to turn push to talk on with no key bound.
    const [pttNeedsKey, setPttNeedsKey] = useState(false);
    useEffect(() => {
        if (pttBound) setPttNeedsKey(false);
    }, [pttBound]);

    function togglePushToTalk(on: boolean): void {
        if (on && !pttBound) {
            setPttNeedsKey(true);
            return;
        }
        setPttNeedsKey(false);
        setPushToTalk(on);
        refreshMicGate();
    }

    const dfSupported = deepFilterSupported();
    const rnnSupported = rnnoiseSupported();
    const gpuSupported = fastEnhancerGpuSupported();
    const feSupported = fastEnhancerSupported();
    // Noise filters plugins have registered (zam.audio.registerMicFilter).
    const pluginFilters = useRune(() => {
        void pluginRegistry.tick;
        return listMicFilters();
    });
    const nsMode = noiseSuppressionMode;
    // The chosen plugin filter, if its plugin is loaded (null: not loaded,
    // or not a plugin mode).
    const nsFilter = useRune(() => {
        void pluginRegistry.tick;
        return isPluginFilterKey(nsMode) ? findMicFilter(nsMode) : null;
    }, [nsMode]);
    // Zami: a function rather than a value from the last render: startMeter reads
    // it right after applyConstraints' settings change.
    const micPlan = () =>
        planMicProcessing(
            settingsState.noiseSuppressionMode,
            settingsState.micGainMode,
            dfSupported,
            {
                pauseGate: settingsState.micPauseGate,
                attenuationDb: settingsState.dfAttenuationDb,
                feGpu: noiseSuppressionUsesGpu(
                    settingsState.noiseSuppressionMode,
                    settingsState.noiseSuppressionGpu,
                ),
            },
        );

    async function startMeter(): Promise<void> {
        // Claim the channel first: two overlapping starts used to leave the
        // earlier meter's stream running with only the later handle stored.
        const ticket = beginCapture(micCapture);
        stopHandle(meter.current);
        meter.current = null;
        setLoopbackOn(false);
        setMicError(null);
        setMicLevel(0);
        let started: MicMeterHandle | null = null;
        try {
            const plan = micPlan();
            started = await startMicMeter({
                deviceId: resolveDeviceId(
                    settingsState.audioInputDeviceId,
                    inputsRef.current,
                ).id,
                noiseSuppression: plan.noiseSuppression,
                echoCancellation: settingsState.echoCancellation,
                autoGainControl: plan.autoGainControl,
                chain: plan.chain,
                onLevel: (v) => setMicLevel(v),
            });
        } catch {
            if (isCaptureCurrent(micCapture, ticket))
                setMicError(
                    t(
                        "voiceAudioSettings.microphoneUnavailableCheckBrowserPermissions",
                    ),
                );
            return;
        }
        // A grant that arrives after the tab closed (or after a newer start)
        // owns a live mic + AudioContext that nothing else can reach.
        const adopted = adoptCapture(micCapture, ticket, started, stopHandle);
        // Return WITHOUT writing on the stale path: two grants can resolve out
        // of order, and the newer one already stored the only handle that can
        // release its mic. Nulling it here would orphan a live microphone.
        if (!adopted) return;
        meter.current = adopted;
        // The first grant unlocks device labels — refresh the lists.
        void refreshDevices();
    }

    function pickInput(id: string): void {
        const dev = id === "" ? null : id;
        setAudioInputDeviceId(dev);
        void setVoiceInputDevice(dev);
        void startMeter();
    }

    function pickOutput(id: string): void {
        const dev = id === "" ? null : id;
        setAudioOutputDeviceId(dev);
        setVoiceOutputDevice(dev);
        configureCallSounds({ sinkId: dev });
        if (loopbackOnRef.current) void meter.current?.setLoopback(true, dev);
    }

    async function chooseOutputViaBrowser(): Promise<void> {
        const picked = await promptSelectAudioOutput();
        if (!picked) return;
        await refreshDevices();
        // Deliberately NOT gated on `destroyed`: the user really did pick an
        // output, and everything below is global (or null-safe once the meter
        // is gone), so abandoning it would just lose their choice.
        pickOutput(picked.deviceId);
    }

    // The call and this tab's mic test both hold the microphone. Re-opening
    // it for the call with new processing while the test still has it open
    // with the old processing can fail, so let go of the test first and
    // bring it back once the call has its new mic.
    async function applyConstraints(): Promise<void> {
        cancelCapture(micCapture); // a test start still in flight drops its grant
        stopHandle(meter.current);
        meter.current = null;
        setMicLevel(0);
        setLoopbackOn(false);
        await setVoiceCaptureConstraints({
            noiseSuppressionMode: settingsState.noiseSuppressionMode,
            echoCancellation: settingsState.echoCancellation,
            micGainMode: settingsState.micGainMode,
        });
        if (!destroyed.current) await startMeter();
    }

    async function toggleLoopback(): Promise<void> {
        const on = !loopbackOnRef.current;
        setLoopbackOn(on);
        await meter.current?.setLoopback(on, settingsState.audioOutputDeviceId);
    }

    async function toggleCamera(): Promise<void> {
        if (cameraOnRef.current) {
            stopCamera();
            return;
        }
        const ticket = beginCapture(cameraCapture);
        setCameraError(null);
        let granted: MediaStream;
        try {
            // `exact` (not `ideal`) so the browser honors the chosen camera;
            // `ideal` was ignored, so selecting a camera never switched the
            // preview off the default device.
            const wanted = buildDeviceConstraint(
                settingsState.videoInputDeviceId,
            );
            try {
                granted = await getUserMedia({
                    video: wanted ? { deviceId: wanted } : {},
                });
            } catch (e) {
                // Chosen camera vanished → retry once on the default so the
                // preview falls back instead of dying; other errors (permission
                // denied) rethrow to the handler below.
                if (!wanted || !isOverconstrainedError(e)) throw e;
                granted = await getUserMedia({
                    video: {},
                });
            }
        } catch {
            if (isCaptureCurrent(cameraCapture, ticket))
                setCameraError(
                    t(
                        "voiceAudioSettings.cameraUnavailableCheckBrowserPermissions",
                    ),
                );
            return;
        }
        // Leaving the tab (or clicking Preview twice) used to leave the camera
        // on with no element bound and no handle to stop it.
        const adopted = adoptCapture(
            cameraCapture,
            ticket,
            granted,
            stopTracks,
        );
        // Return WITHOUT writing on the stale path: a newer grant that resolved
        // first holds the live stream, and nulling `cameraStream` here would
        // leave it playing with `stopCamera()` unable to reach its tracks.
        if (!adopted) return;
        cameraStream.current = adopted;
        setCameraOn(true);
        // Zami: not ported: `videoEl.srcObject = cameraStream` (no preview view).
        void refreshDevices(); // camera grant unlocks camera labels
    }

    function stopCamera(): void {
        // Cancel an in-flight grant too, or a prompt answered after Stop
        // silently reopens the camera.
        cancelCapture(cameraCapture);
        setCameraOn(false);
        stopTracks(cameraStream.current);
        cameraStream.current = null;
    }

    function pickCamera(id: string): void {
        const disabled = id === CAMERA_DISABLED;
        // First: a camera mid-start checks this once it's up.
        setCameraDisabled(disabled);
        if (disabled) {
            stopCamera();
            stopCallCamera();
            return;
        }
        const dev = id === "" ? null : id;
        setVideoInputDeviceId(dev);
        setCallVideoInputDevice(dev);
        if (cameraOnRef.current) {
            stopCamera();
            void toggleCamera();
        }
    }

    // Zami: `Notification.permission` is asynchronous here.
    function currentNotifyPermission() {
        return notificationPermission();
    }

    useEffect(() => {
        let visibility: NativeEventSubscription | null = null;
        if (hasNativeCallService()) {
            refreshFullScreenCalls();
            visibility = AppState.addEventListener(
                "change",
                refreshFullScreenCalls,
            );
        }
        void refreshDevices().then(() => {
            if (!destroyed.current) void startMeter();
        });
        unsubDevices.current = onDevicesChanged(() => void refreshDevices());
        // A user who blocked notifications long ago and still has ringing on
        // gets no OS call alerts; surface why without making them re-toggle.
        if (settingsState.ringEnabled)
            void currentNotifyPermission().then((p) => {
                if (!destroyed.current) setRingNotifyHint(callAlertHint(p));
            });

        // onDestroy
        return () => {
            destroyed.current = true;
            visibility?.remove();
            disposeCaptures(micCapture);
            disposeCaptures(cameraCapture);
            stopHandle(meter.current);
            meter.current = null;
            stopOutputMeter.current?.();
            stopCamera();
            unsubDevices.current?.();
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as onMount/onDestroy.
    }, []);

    // Incoming-audio meter while in a call; re-taps as tracks come and go.
    // Keyed on the set of remote streams, not on voiceTick itself: the tick
    // bumps on every remote mute and membership change, and re-tapping on each
    // one built and closed a fresh AudioContext every time (audit IMP-2).
    const remoteStreamsKey = useRune(() => {
        void voiceCallState.voiceTick;
        return voiceCallState.connState === "connected"
            ? streamSetKey(getRemoteAudioStreams())
            : null;
    });
    useEffect(() => {
        const key = remoteStreamsKey;
        stopOutputMeter.current?.();
        stopOutputMeter.current = null;
        setOutLevel(0);
        // Zami: not ported: the meter is Web Audio; without an AudioContext
        // startOutputMeter does nothing, so it stays empty.
        if (key !== null)
            stopOutputMeter.current = startOutputMeter(
                getRemoteAudioStreams(),
                (v) => setOutLevel(v),
            );
    }, [remoteStreamsKey]);

    const selectClass =
        "w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none border border-transparent focus:border-discord-accent/50";

    return (
        <View className="gap-6">
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("voiceAudioSettings.inputDevice")}
                </Text>
                <Select
                    className={selectClass}
                    value={audioInputDeviceId ?? ""}
                    onChange={pickInput}
                    accessibilityLabel={t("voiceAudioSettings.inputDevice")}
                    options={[
                        { value: "", label: t("common.default") },
                        ...inputs.map((d) => ({ value: d.id, label: d.label })),
                    ]}
                />
                {inputFallback ? (
                    <Text className="text-xs text-discord-warning mt-1">
                        {t(
                            "voiceAudioSettings.savedMicrophoneNotFoundUsingThe",
                        )}
                    </Text>
                ) : null}
                {micError ? (
                    <Text className="text-xs text-discord-danger mt-2">
                        {micError}
                    </Text>
                ) : (
                    <>
                        <View
                            accessibilityLabel={t(
                                "voiceAudioSettings.microphoneLevel",
                            )}
                            className="mt-3 h-2 rounded bg-discord-backgroundTertiary overflow-hidden"
                        >
                            <View
                                className="h-full bg-discord-accent"
                                style={{
                                    width: `${Math.round(micLevel * 100)}%`,
                                }}
                            />
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void toggleLoopback()}
                            className={`mt-2 self-start px-3 py-1 rounded ${
                                loopbackOn
                                    ? "bg-discord-accent"
                                    : "bg-discord-backgroundTertiary hover:bg-discord-messageHover"
                            }`}
                        >
                            <Text
                                className={`text-xs font-medium ${
                                    loopbackOn
                                        ? "text-white"
                                        : "text-discord-textMuted"
                                }`}
                            >
                                {loopbackOn
                                    ? t("voiceAudioSettings.stopTest")
                                    : t("voiceAudioSettings.testMic")}
                            </Text>
                        </Pressable>
                    </>
                )}
                <View className="mt-3 flex-row items-center gap-3">
                    <View className="flex-1">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("voiceAudioSettings.pushToTalk")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("voiceAudioSettings.pushToTalkHint")}
                        </Text>
                        {pttNeedsKey ? (
                            <Text className="text-xs text-discord-warning mt-1">
                                {t("voiceAudioSettings.pushToTalkNoKey")}{" "}
                                <Text
                                    accessibilityRole="button"
                                    className="text-xs underline text-discord-accent"
                                    onPress={() =>
                                        openAppSettingsTab("keybinds")
                                    }
                                >
                                    {t("voiceAudioSettings.pushToTalkSetKey")}
                                </Text>
                            </Text>
                        ) : null}
                    </View>
                    <ToggleSwitch
                        checked={pushToTalk && pttBound}
                        onChange={togglePushToTalk}
                        label={t("voiceAudioSettings.pushToTalk")}
                    />
                </View>
            </View>

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("voiceAudioSettings.outputDevice")}
                </Text>
                {outputMode === "picker" ? (
                    <Select
                        className={selectClass}
                        value={audioOutputDeviceId ?? ""}
                        onChange={pickOutput}
                        accessibilityLabel={t(
                            "voiceAudioSettings.outputDevice",
                        )}
                        options={[
                            { value: "", label: t("common.default") },
                            ...outputs.map((d) => ({
                                value: d.id,
                                label: d.label,
                            })),
                        ]}
                    />
                ) : outputMode === "browser-prompt" ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void chooseOutputViaBrowser()}
                        className="self-start px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover"
                    >
                        <Text className="text-sm text-discord-textPrimary">
                            {t("voiceAudioSettings.chooseOutputDevice")}
                        </Text>
                    </Pressable>
                ) : (
                    <Text className="text-xs text-discord-textMuted">
                        {t("voiceAudioSettings.audioOutputIsRoutedByThe")}
                    </Text>
                )}
                {outputMode !== "hidden" ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                            void playSpeakerTestTone(
                                settingsState.audioOutputDeviceId,
                            )
                        }
                        className="mt-2 self-start px-3 py-1 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover"
                    >
                        <Text className="text-xs font-medium text-discord-textMuted">
                            {t("voiceAudioSettings.testSpeaker")}
                        </Text>
                    </Pressable>
                ) : null}
                <View className="mt-3 flex-row items-center gap-3">
                    <Text className="text-sm text-discord-textPrimary flex-shrink-0">
                        {t("voiceAudioSettings.callVolume")}
                    </Text>
                    {/* Zami: `flex-1` in place of `w-full`: React Native doesn't
                        shrink a full-width child to fit beside the label. */}
                    <Range
                        min={0}
                        max={1}
                        step={0.01}
                        className="flex-1"
                        value={callOutputVolume}
                        accessibilityLabel={t("voiceAudioSettings.callVolume")}
                        onChange={(v) => {
                            setCallOutputVolume(v);
                            setVoiceOutputVolume(v);
                        }}
                    />
                </View>
                <View className="mt-3 flex-row items-center gap-3">
                    <View className="flex-1">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("voiceAudioSettings.normalizeVoices")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("voiceAudioSettings.normalizeVoicesHint")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={normalizeCallAudio}
                        onChange={(v) => {
                            setNormalizeCallAudio(v);
                            setVoiceNormalization(v);
                        }}
                        label={t("voiceAudioSettings.normalizeVoices")}
                    />
                </View>
                {connState === "connected" ? (
                    <>
                        <View
                            accessibilityLabel={t(
                                "voiceAudioSettings.incomingCallAudio",
                            )}
                            className="mt-3 h-2 rounded bg-discord-backgroundTertiary overflow-hidden"
                        >
                            <View
                                className="h-full bg-discord-accent transition-[width] duration-75"
                                style={{
                                    width: `${Math.round(outLevel * 100)}%`,
                                }}
                            />
                        </View>
                        <Text className="text-xs text-discord-textMuted mt-1">
                            {t(
                                "voiceAudioSettings.incomingCallAudioIfThisMoves",
                            )}
                        </Text>
                    </>
                ) : null}
            </View>

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("voiceAudioSettings.voiceProcessing")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("voiceAudioSettings.noiseSuppression")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {isPluginFilterKey(nsMode)
                                ? !dfSupported
                                    ? t(
                                          "voiceAudioSettings.nsPluginUnsupported",
                                      )
                                    : !nsFilter
                                      ? t(
                                            "voiceAudioSettings.nsPluginUnavailable",
                                        )
                                      : !micFilterUsable(nsFilter)
                                        ? t(
                                              "voiceAudioSettings.nsPluginCantRun",
                                          )
                                        : (nsFilter.description ??
                                          t("voiceAudioSettings.nsPluginHint"))
                                : noiseSuppressionMode === "fastenhancer" ||
                                    noiseSuppressionMode === "fastenhancer-tiny"
                                  ? !feSupported
                                      ? t(
                                            "voiceAudioSettings.nsFastEnhancerUnsupported",
                                        )
                                      : noiseSuppressionMode === "fastenhancer"
                                        ? t(
                                              "voiceAudioSettings.nsFastEnhancerHint",
                                          )
                                        : t(
                                              "voiceAudioSettings.nsFastEnhancerTinyHint",
                                          )
                                  : noiseSuppressionMode === "rnnoise"
                                    ? rnnSupported
                                        ? t("voiceAudioSettings.nsRnnoiseHint")
                                        : t(
                                              "voiceAudioSettings.nsRnnoiseUnsupported",
                                          )
                                    : noiseSuppressionMode === "deepfilter"
                                      ? dfSupported
                                          ? t(
                                                "voiceAudioSettings.nsDeepFilterHint",
                                            )
                                          : t(
                                                "voiceAudioSettings.nsDeepFilterUnsupported",
                                            )
                                      : noiseSuppressionMode === "browser"
                                        ? t("voiceAudioSettings.nsBrowserHint")
                                        : t("voiceAudioSettings.nsOffHint")}
                        </Text>
                    </View>
                    {/* Zami: a <select> is as wide as its longest option; Select's
                        label fills its box instead, so a box beside a label
                        needs a width (`w-40`). */}
                    <Select
                        nativeID="noise-suppression-mode"
                        accessibilityLabel={t(
                            "voiceAudioSettings.noiseSuppression",
                        )}
                        className="flex-shrink-0 w-40 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none border border-transparent focus:border-discord-accent/50"
                        value={noiseSuppressionMode}
                        onChange={(value) => {
                            setNoiseSuppressionMode(
                                normalizeNoiseSuppressionMode(value, true),
                            );
                            void applyConstraints();
                        }}
                        options={[
                            {
                                value: "fastenhancer",
                                label: t("voiceAudioSettings.nsFastEnhancer"),
                            },
                            {
                                value: "fastenhancer-tiny",
                                label: t(
                                    "voiceAudioSettings.nsFastEnhancerTiny",
                                ),
                            },
                            {
                                value: "rnnoise",
                                label: t("voiceAudioSettings.nsRnnoise"),
                            },
                            ...pluginFilters.map((f) => ({
                                value: f.key,
                                label: f.label,
                            })),
                            ...(isPluginFilterKey(nsMode) && !nsFilter
                                ? [
                                      {
                                          value: nsMode,
                                          label: t(
                                              "voiceAudioSettings.nsPluginMissing",
                                          ),
                                      },
                                  ]
                                : []),
                            {
                                value: "deepfilter",
                                label: t("voiceAudioSettings.nsDeepFilter"),
                            },
                            {
                                value: "browser",
                                label: t("voiceAudioSettings.nsBrowser"),
                            },
                            {
                                value: "off",
                                label: t("voiceAudioSettings.nsOff"),
                            },
                        ]}
                    />
                </View>
                {gpuSupported &&
                noiseSuppressionHasGpu(noiseSuppressionMode) ? (
                    <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                        <View className="flex-1">
                            <Text className="text-sm text-discord-textPrimary">
                                {t("voiceAudioSettings.noiseSuppressionGpu")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t(
                                    "voiceAudioSettings.noiseSuppressionGpuHint",
                                )}
                            </Text>
                        </View>
                        <ToggleSwitch
                            checked={noiseSuppressionUsesGpu(
                                noiseSuppressionMode,
                                noiseSuppressionGpu,
                            )}
                            onChange={(v) => {
                                setNoiseSuppressionGpu(
                                    settingsState.noiseSuppressionMode,
                                    v,
                                );
                                void applyConstraints();
                            }}
                            label={t("voiceAudioSettings.noiseSuppressionGpu")}
                        />
                    </View>
                ) : null}
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <Text className="flex-1 text-sm text-discord-textPrimary">
                        {t("voiceAudioSettings.echoCancellation")}
                    </Text>
                    <ToggleSwitch
                        checked={echoCancellation}
                        onChange={(v) => {
                            setEchoCancellation(v);
                            void applyConstraints();
                        }}
                        label={t("voiceAudioSettings.echoCancellation")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("voiceAudioSettings.autoGainControl")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {micGainMode === "normalize"
                                ? t("voiceAudioSettings.agcNormalizeHint")
                                : micGainMode === "zam"
                                  ? t("voiceAudioSettings.agcZamHint")
                                  : micGainMode === "browser"
                                    ? t("voiceAudioSettings.agcBrowserHint")
                                    : t("voiceAudioSettings.agcOffHint")}
                        </Text>
                    </View>
                    <Select
                        nativeID="mic-gain-mode"
                        accessibilityLabel={t(
                            "voiceAudioSettings.autoGainControl",
                        )}
                        className="flex-shrink-0 w-40 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none border border-transparent focus:border-discord-accent/50"
                        value={micGainMode}
                        onChange={(value) => {
                            setMicGainMode(normalizeMicGainMode(value, true));
                            void applyConstraints();
                        }}
                        options={[
                            {
                                value: "normalize",
                                label: t("voiceAudioSettings.agcNormalize"),
                            },
                            {
                                value: "zam",
                                label: t("voiceAudioSettings.agcZam"),
                            },
                            {
                                value: "browser",
                                label: t("voiceAudioSettings.agcBrowser"),
                            },
                            {
                                value: "off",
                                label: t("voiceAudioSettings.agcOff"),
                            },
                        ]}
                    />
                </View>
            </View>

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("voiceAudioSettings.camera")}
                </Text>
                <Select
                    className={selectClass}
                    value={
                        cameraDisabled
                            ? CAMERA_DISABLED
                            : (videoInputDeviceId ?? "")
                    }
                    onChange={pickCamera}
                    accessibilityLabel={t("voiceAudioSettings.camera")}
                    options={[
                        { value: "", label: t("common.default") },
                        {
                            value: CAMERA_DISABLED,
                            label: t("voiceAudioSettings.cameraDisabled"),
                        },
                        ...cameras.map((d) => ({
                            value: d.id,
                            label: d.label,
                        })),
                    ]}
                />
                <View className="flex-row items-center justify-between gap-3 py-2">
                    <View className="shrink">
                        <Text className="text-sm font-medium text-discord-textPrimary">
                            {t("voiceAudioSettings.mirrorMyCamera")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "voiceAudioSettings.flipYourOwnPreviewOthersAlways",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={mirrorCamera}
                        onChange={(v) => setMirrorCamera(v)}
                        label={t("voiceAudioSettings.mirrorMyCamera")}
                    />
                </View>
                <View className="flex-row items-center justify-between gap-3 py-2">
                    <View className="shrink">
                        <Text className="text-sm font-medium text-discord-textPrimary">
                            {t("voiceAudioSettings.videoCodec")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("voiceAudioSettings.videoCodecHint")}
                        </Text>
                    </View>
                    <Select
                        className="flex-shrink-0 w-32 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-2 py-1.5 border border-discord-divider focus:outline-none focus:ring-2 focus:ring-discord-accent"
                        value={callVideoCodec}
                        onChange={(value) => setCallVideoCodec(value)}
                        accessibilityLabel={t("voiceAudioSettings.videoCodec")}
                        options={[
                            {
                                value: "auto",
                                label: t("voiceAudioSettings.videoCodecAuto"),
                            },
                            ...VIDEO_CODECS.map((codec) => ({
                                value: codec,
                                label: VIDEO_CODEC_LABELS[codec],
                            })),
                        ]}
                    />
                </View>
                <View className="py-2">
                    <Text className="text-sm font-medium text-discord-textPrimary">
                        {t("voiceAudioSettings.cannotWatch")}
                    </Text>
                    <Text className="text-xs text-discord-textMuted mb-1.5">
                        {t("voiceAudioSettings.cannotWatchHint")}
                    </Text>
                    <View className="flex-row flex-wrap gap-1.5">
                        {VIDEO_CODECS.filter((c) => !isMandatoryCodec(c)).map(
                            (codec) => {
                                const blocked =
                                    blockedDecodeCodecs.includes(codec);
                                return (
                                    <Pressable
                                        key={codec}
                                        accessibilityRole="button"
                                        accessibilityState={{
                                            selected: blocked,
                                        }}
                                        className={`px-2.5 py-1 rounded border transition-colors ${
                                            blocked
                                                ? "bg-discord-accent border-discord-accent"
                                                : "bg-discord-backgroundTertiary border-transparent hover:bg-discord-messageHover"
                                        }`}
                                        onPress={() => {
                                            setBlockedDecodeCodecs(
                                                blocked
                                                    ? settingsState.blockedDecodeCodecs.filter(
                                                          (c) => c !== codec,
                                                      )
                                                    : [
                                                          ...settingsState.blockedDecodeCodecs,
                                                          codec,
                                                      ],
                                            );
                                            refreshDecodeSupport();
                                        }}
                                    >
                                        <Text
                                            className={`text-xs font-medium ${
                                                blocked
                                                    ? "text-white"
                                                    : "text-discord-textMuted"
                                            }`}
                                        >
                                            {VIDEO_CODEC_LABELS[codec]}
                                        </Text>
                                    </Pressable>
                                );
                            },
                        )}
                    </View>
                </View>
                <View className="flex-row items-center justify-between gap-3 py-2">
                    <View className="shrink">
                        <Text className="text-sm font-medium text-discord-textPrimary">
                            {t("voiceAudioSettings.adaptiveStream")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("voiceAudioSettings.adaptiveStreamHint")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={adaptiveStream}
                        onChange={(v) => setAdaptiveStream(v)}
                        label={t("voiceAudioSettings.adaptiveStream")}
                    />
                </View>
                {!cameraDisabled ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void toggleCamera()}
                        className={`mt-2 self-start px-3 py-1 rounded ${
                            cameraOn
                                ? "bg-discord-accent"
                                : "bg-discord-backgroundTertiary hover:bg-discord-messageHover"
                        }`}
                    >
                        <Text
                            className={`text-xs font-medium ${
                                cameraOn
                                    ? "text-white"
                                    : "text-discord-textMuted"
                            }`}
                        >
                            {cameraOn
                                ? t("voiceAudioSettings.stopPreview")
                                : t("voiceAudioSettings.preview")}
                        </Text>
                    </Pressable>
                ) : null}
                {cameraError ? (
                    <Text className="text-xs text-discord-danger mt-2">
                        {cameraError}
                    </Text>
                ) : null}
                {/* Zami: not ported: the preview <video> (`mt-3 w-full max-w-sm
                    rounded bg-black`, shown while cameraOn). See getUserMedia. */}
            </View>

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("voiceAudioSettings.callSounds")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <Text className="flex-1 text-sm text-discord-textPrimary">
                        {t("voiceAudioSettings.playCallSounds")}
                    </Text>
                    <ToggleSwitch
                        checked={callSoundsEnabled}
                        onChange={(v) => {
                            setCallSoundsEnabled(v);
                            configureCallSounds({ enabled: v });
                            if (v) playCallSound("selfJoin");
                        }}
                        label={t("voiceAudioSettings.playCallSounds")}
                    />
                </View>
                <View className="mt-3 flex-row items-center gap-3">
                    <Text className="text-sm text-discord-textPrimary flex-shrink-0">
                        {t("voiceAudioSettings.soundVolume")}
                    </Text>
                    <Range
                        min={0}
                        max={1}
                        step={0.01}
                        className="flex-1"
                        value={callSoundsVolume}
                        accessibilityLabel={t("voiceAudioSettings.soundVolume")}
                        onChange={(v) => {
                            setCallSoundsVolume(v);
                            configureCallSounds({ volume: v });
                        }}
                        onChangeEnd={() => playCallSound("selfJoin")}
                    />
                </View>
            </View>

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("voiceAudioSettings.ringing")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("voiceAudioSettings.ringForIncomingDmCalls")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted mt-0.5">
                            {t(
                                "voiceAudioSettings.directMessagesRingRoomsNeverDo",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={ringEnabled}
                        onChange={(v) => {
                            setRingEnabled(v);
                            configureRing({ enabled: v });
                            // Background ringers keep their own copy.
                            syncNativeRingEnabled(v).catch(() => {});
                            updateServiceWorkerRingEnabled(v);
                            if (v) {
                                playRingBlip();
                                // Ringing wants an OS notification when the window is
                                // hidden; this click is the gesture that lets us ask.
                                // Surface a hint if it's blocked/unsupported so the
                                // user knows why call alerts stay silent.
                                void requestNotificationPermission().then(
                                    (p) => {
                                        setRingNotifyHint(callAlertHint(p));
                                    },
                                );
                            } else {
                                setRingNotifyHint(null);
                            }
                        }}
                        label={t("voiceAudioSettings.ringForIncomingDmCalls")}
                    />
                </View>
                {ringNotifyHint ? (
                    <Text className="text-xs text-discord-danger mt-2">
                        {ringNotifyHint}
                    </Text>
                ) : null}
                {ringEnabled && !fullScreenCallsGranted ? (
                    <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                        <View className="flex-1">
                            <Text className="text-sm text-discord-textPrimary">
                                {t("voiceAudioSettings.fullScreenCalls")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted mt-0.5">
                                {t("voiceAudioSettings.fullScreenCallsHint")}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void openFullScreenCallSettings()}
                            className="px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover flex-shrink-0"
                        >
                            <Text className="text-sm text-discord-textPrimary">
                                {t("voiceAudioSettings.fullScreenCallsAllow")}
                            </Text>
                        </Pressable>
                    </View>
                ) : null}
                <View className="mt-3 flex-row items-center gap-3">
                    <Text className="text-sm text-discord-textPrimary flex-shrink-0">
                        {t("voiceAudioSettings.ringtoneVolume")}
                    </Text>
                    <Range
                        min={0}
                        max={1}
                        step={0.01}
                        className="flex-1"
                        value={ringVolume}
                        accessibilityLabel={t(
                            "voiceAudioSettings.ringtoneVolume",
                        )}
                        onChange={(v) => {
                            setRingVolume(v);
                            configureRing({ volume: v });
                        }}
                        onChangeEnd={() => playRingPreview()}
                    />
                </View>
            </View>
        </View>
    );
}
