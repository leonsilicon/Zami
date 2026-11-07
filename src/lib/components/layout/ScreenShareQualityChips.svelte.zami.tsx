import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useRef, useState } from "react";
import {
    Pressable,
    Text,
    TextInput,
    View,
    type GestureResponderEvent,
} from "react-native";
import { t } from "$lib/i18n";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import {
    settingsState,
    setScreenShareResolution,
    setScreenShareFps,
    setShareSystemAudio,
    setScreenShareBitrate,
    setUploadSpeedOverride,
} from "$lib/stores/settings.svelte";
import {
    measuredUpload,
    screenShareBitrateCeiling,
    uploadOverride,
} from "$lib/stores/uploadEstimate.svelte";
import { voiceCallState } from "$lib/stores/voiceCall.svelte";
import { switchCallVideoCodec } from "$lib/matrix/client";
import { VIDEO_CODEC_LABELS, type VideoCodec } from "$lib/utils/videoCodecs";
import {
    BITRATE_SLIDER_STEPS,
    bitrateFromSlider,
    bitrateParts,
    clampBitrate,
    sliderFromBitrate,
} from "$lib/utils/screenShareBitrate";
import { SCREEN_RESOLUTIONS, SCREEN_FPS_OPTIONS } from "$lib/utils/voiceCall";

interface Props {
    onQualityChange?: (resKey: string, fps: number) => void;
}

export default function ScreenShareQualityChips({ onQualityChange }: Props) {
    const screenShareResolution = useRune(
        () => settingsState.screenShareResolution,
    );
    const screenShareFps = useRune(() => settingsState.screenShareFps);
    const screenShareBitrate = useRune(() => settingsState.screenShareBitrate);
    const uploadSpeedOverride = useRune(
        () => settingsState.uploadSpeedOverride,
    );
    const shareSystemAudio = useRune(() => settingsState.shareSystemAudio);

    // Live mode = a share is currently running and onQualityChange adjusts it.
    // Setup mode = pre-share settings, onQualityChange is undefined.
    const isLive = onQualityChange !== undefined;

    function pickRes(key: string): void {
        setScreenShareResolution(key);
        onQualityChange?.(key, Number(settingsState.screenShareFps));
    }
    function pickFps(fps: number): void {
        setScreenShareFps(String(fps));
        onQualityChange?.(settingsState.screenShareResolution, fps);
    }

    // The bitrate is picked apart from resolution and fps, from about 240p's
    // bitrate up to 10% under the measured upload. While dragging only the
    // label follows; the pick is saved (and a live share retargeted) on
    // release.
    const ceiling = useRune(() => screenShareBitrateCeiling());
    const measured = useRune(() => measuredUpload());
    const overridden = useRune(() => uploadOverride() !== null);
    const [draftBitrate, setDraftBitrate] = useState<number | null>(null);
    const shownBitrate =
        draftBitrate ?? clampBitrate(screenShareBitrate, ceiling);

    function bitrateLabel(bps: number): string {
        const { unit, n } = bitrateParts(bps);
        return unit === "kbps"
            ? t("screenShareQualityChips.kbps", { n })
            : t("screenShareQualityChips.mbps", { n });
    }

    // The typed-in upload speed is in Mbps; empty or 0 goes back to measuring.
    function commitUploadOverride(text: string): void {
        const mbps = Number(text.replace(",", "."));
        setUploadSpeedOverride(
            text.trim() !== "" && Number.isFinite(mbps) && mbps > 0
                ? mbps * 1_000_000
                : 0,
        );
        // The ceiling moved: bring a live share's cap along with it.
        onQualityChange?.(
            settingsState.screenShareResolution,
            Number(settingsState.screenShareFps),
        );
    }

    function commitBitrate(position: number): void {
        setDraftBitrate(null);
        setScreenShareBitrate(bitrateFromSlider(position, ceiling));
        onQualityChange?.(
            settingsState.screenShareResolution,
            Number(settingsState.screenShareFps),
        );
    }

    // In a call: the codecs we can send that everyone can watch, plus the one
    // in use if someone who joined since can't (they get an H.264 backup).
    const codecs = useRune(() => voiceCallState.codecs);
    const codecChoices = codecs
        ? codecs.sendable.filter(
              (c) => codecs.available.includes(c) || c === codecs.current,
          )
        : [];

    function pickCodec(codec: VideoCodec): void {
        if (codec === codecs?.current && codec === codecs.picked) return;
        void switchCallVideoCodec(codec);
    }

    // Zami: the chip's text classes are split off onto its Text (`chipText`,
    // `chipTextOn`, `chipTextOff`), as text styles don't inherit here.
    const chipBase = "px-2.5 py-1 rounded border transition-colors";
    const chipOn = "bg-discord-accent border-discord-accent";
    const chipOff =
        "bg-discord-backgroundTertiary border-transparent hover:bg-discord-messageHover";
    const chipText = "text-xs font-medium";
    const chipTextOn = "text-white";
    const chipTextOff = "text-discord-textMuted";

    // Zami: the input's text while it is being edited. `onchange` (blur or
    // Return) commits it; until then the field shows the saved figure.
    const [uploadText, setUploadText] = useState<string | null>(null);
    const savedUploadText =
        uploadSpeedOverride > 0
            ? String(Math.round((uploadSpeedOverride / 1_000_000) * 10) / 10)
            : "";

    return (
        <View className="gap-3">
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                    {t("screenShareQualityChips.resolution")}
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                    {SCREEN_RESOLUTIONS.map((r) => (
                        <Pressable
                            key={r.key}
                            accessibilityRole="button"
                            className={`${chipBase} ${
                                screenShareResolution === r.key
                                    ? chipOn
                                    : chipOff
                            }`}
                            accessibilityState={{
                                selected: screenShareResolution === r.key,
                            }}
                            onPress={() => pickRes(r.key)}
                        >
                            <Text
                                className={`${chipText} ${
                                    screenShareResolution === r.key
                                        ? chipTextOn
                                        : chipTextOff
                                }`}
                            >
                                {r.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </View>
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                    {t("screenShareQualityChips.frameRate")}
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                    {SCREEN_FPS_OPTIONS.map((f) => (
                        <Pressable
                            key={f}
                            accessibilityRole="button"
                            className={`${chipBase} ${
                                screenShareFps === String(f) ? chipOn : chipOff
                            }`}
                            accessibilityState={{
                                selected: screenShareFps === String(f),
                            }}
                            onPress={() => pickFps(f)}
                        >
                            <Text
                                className={`${chipText} ${
                                    screenShareFps === String(f)
                                        ? chipTextOn
                                        : chipTextOff
                                }`}
                            >
                                {t("screenShareQualityChips.fps", { f })}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </View>
            {codecs && codecChoices.length > 0 && (
                <View>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                        {t("screenShareQualityChips.videoCodec")}
                    </Text>
                    <View className="flex-row flex-wrap gap-1.5">
                        {/* Zami: `title` (hardware or software encoding) has no
                            React Native equivalent; it's the chip's
                            accessibility hint instead. */}
                        {codecChoices.map((codec) => (
                            <Pressable
                                key={codec}
                                accessibilityRole="button"
                                className={`flex-row items-baseline ${chipBase} ${
                                    codecs.current === codec ? chipOn : chipOff
                                }`}
                                accessibilityState={{
                                    selected: codecs.current === codec,
                                }}
                                accessibilityHint={
                                    codecs.hardware.includes(codec)
                                        ? t(
                                              "screenShareQualityChips.codecHardware",
                                          )
                                        : t(
                                              "screenShareQualityChips.codecSoftware",
                                          )
                                }
                                onPress={() => pickCodec(codec)}
                            >
                                <Text
                                    className={`${chipText} ${
                                        codecs.current === codec
                                            ? chipTextOn
                                            : chipTextOff
                                    }`}
                                >
                                    {VIDEO_CODEC_LABELS[codec]}
                                </Text>
                                {codecs.hardware.includes(codec) && (
                                    <Text
                                        className={`ml-0.5 opacity-75 ${chipText} ${
                                            codecs.current === codec
                                                ? chipTextOn
                                                : chipTextOff
                                        }`}
                                    >
                                        {` ${t("screenShareQualityChips.hw")}`}
                                    </Text>
                                )}
                            </Pressable>
                        ))}
                    </View>
                    <Text className="text-xs text-discord-textMuted mt-0.5">
                        {codecs.picked !== codecs.current
                            ? t(
                                  "screenShareQualityChips.codecEncryptedFallbackHint",
                                  {
                                      picked: VIDEO_CODEC_LABELS[codecs.picked],
                                      current:
                                          VIDEO_CODEC_LABELS[codecs.current],
                                  },
                              )
                            : codecs.available.includes(codecs.current)
                              ? t("screenShareQualityChips.codecHint")
                              : t("screenShareQualityChips.codecBackupHint", {
                                    codec: VIDEO_CODEC_LABELS[codecs.current],
                                })}
                    </Text>
                </View>
            )}
            <View>
                <View className="flex-row items-baseline justify-between gap-2 mb-1.5">
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                        {t("screenShareQualityChips.bitrate")}
                    </Text>
                    <Text className="text-xs text-discord-textPrimary tabular-nums">
                        {`${t("screenShareQualityChips.bitrateUpTo")} ${bitrateLabel(shownBitrate)}`}
                    </Text>
                </View>
                <Range
                    min={0}
                    max={BITRATE_SLIDER_STEPS}
                    step={1}
                    className="w-full"
                    value={sliderFromBitrate(shownBitrate, ceiling)}
                    accessibilityLabel={t("screenShareQualityChips.bitrate")}
                    accessibilityValueText={bitrateLabel(shownBitrate)}
                    onInput={(position) =>
                        setDraftBitrate(bitrateFromSlider(position, ceiling))
                    }
                    onChange={(position) => commitBitrate(position)}
                />
                <Text className="text-xs text-discord-textMuted mt-0.5">
                    {t("screenShareQualityChips.bitrateCapHint")}
                </Text>
                <Text className="text-xs text-discord-textMuted mt-0.5">
                    {overridden && measured !== null
                        ? t("screenShareQualityChips.bitrateOverridden", {
                              upload: bitrateLabel(measured),
                              max: bitrateLabel(ceiling),
                          })
                        : measured === null
                          ? t("screenShareQualityChips.bitrateUnmeasured", {
                                max: bitrateLabel(ceiling),
                            })
                          : t("screenShareQualityChips.bitrateMeasured", {
                                upload: bitrateLabel(measured),
                                max: bitrateLabel(ceiling),
                            })}
                </Text>
                <View className="flex-row items-center justify-between gap-2 mt-1.5">
                    <Text className="flex-shrink text-xs text-discord-textMuted">
                        {t("screenShareQualityChips.uploadOverride")}
                    </Text>
                    {/* Zami: `text-end` isn't React Native's; `inputmode="decimal"`
                        is the decimal keypad. */}
                    <TextInput
                        accessibilityLabel={t(
                            "screenShareQualityChips.uploadOverride",
                        )}
                        keyboardType="decimal-pad"
                        autoComplete="off"
                        autoCorrect={false}
                        className="w-24 px-2 py-1 rounded text-xs bg-discord-backgroundTertiary text-discord-textPrimary border border-transparent focus:border-discord-accent outline-none"
                        placeholder={t(
                            "screenShareQualityChips.uploadOverrideAuto",
                        )}
                        placeholderTextColorClassName="accent-discord-textMuted"
                        value={uploadText ?? savedUploadText}
                        onChangeText={setUploadText}
                        onEndEditing={(e) => {
                            setUploadText(null);
                            commitUploadOverride(e.nativeEvent.text);
                        }}
                    />
                </View>
                <Text className="text-xs text-discord-textMuted mt-0.5">
                    {t("screenShareQualityChips.uploadOverrideHint")}
                </Text>
            </View>
            <View className="flex-row items-center justify-between gap-3">
                <View className="flex-shrink">
                    <Text className="text-sm text-discord-textPrimary">
                        {t("screenShareQualityChips.shareSystemAudio")}
                    </Text>
                    {isLive && (
                        <Text className="text-xs text-discord-textMuted mt-0.5">
                            {t("screenShareQualityChips.appliesToNextShare")}
                        </Text>
                    )}
                </View>
                <ToggleSwitch
                    checked={shareSystemAudio}
                    onChange={(v) => setShareSystemAudio(v)}
                    label={
                        isLive
                            ? t(
                                  "screenShareQualityChips.shareSystemAudioAppliesToNext",
                              )
                            : t("screenShareQualityChips.shareSystemAudio")
                    }
                />
            </View>
        </View>
    );
}

// Zami: React Native has no <input type="range">. This is a track and thumb: a touch
// or drag along it reports each value as it moves (`oninput`) and the last one on
// release (`onchange`), and VoiceOver steps it (swipe up/down).
function Range({
    min,
    max,
    step,
    value,
    onInput,
    onChange,
    accessibilityLabel,
    accessibilityValueText,
    className = "",
}: {
    min: number;
    max: number;
    step: number;
    value: number;
    onInput?: (value: number) => void;
    onChange?: (value: number) => void;
    accessibilityLabel: string;
    accessibilityValueText?: string;
    className?: string;
}) {
    const [width, setWidth] = useState(0);
    // The track's left edge on the page, taken when a touch starts.
    const left = useRef(0);
    // The value when the touch started, and the last one it moved to.
    const start = useRef(value);
    const last = useRef(value);
    const fraction =
        max > min ? Math.min(Math.max((value - min) / (max - min), 0), 1) : 0;
    const THUMB = 16;

    function clamp(next: number): number {
        return Math.min(max, Math.max(min, next));
    }

    function track(pageX: number) {
        if (width <= 0) return;
        const at = Math.min(Math.max((pageX - left.current) / width, 0), 1);
        const next = clamp(min + Math.round((at * (max - min)) / step) * step);
        if (next === last.current) return;
        last.current = next;
        onInput?.(next);
    }

    function release() {
        if (last.current !== start.current) onChange?.(last.current);
    }

    return (
        <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={accessibilityLabel}
            accessibilityValue={
                accessibilityValueText !== undefined
                    ? { text: accessibilityValueText }
                    : { min, max, now: value }
            }
            accessibilityActions={[
                { name: "increment" },
                { name: "decrement" },
            ]}
            onAccessibilityAction={(event) => {
                const delta =
                    event.nativeEvent.actionName === "increment" ? step : -step;
                const next = clamp(value + delta);
                if (next === value) return;
                onInput?.(next);
                onChange?.(next);
            }}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={(event: GestureResponderEvent) => {
                left.current =
                    event.nativeEvent.pageX - event.nativeEvent.locationX;
                start.current = value;
                last.current = value;
                track(event.nativeEvent.pageX);
            }}
            onResponderMove={(event: GestureResponderEvent) =>
                track(event.nativeEvent.pageX)
            }
            onResponderRelease={release}
            onResponderTerminate={release}
            className={`h-6 justify-center ${className}`}
        >
            <View
                pointerEvents="none"
                className="h-1 rounded-full bg-discord-divider overflow-hidden"
            >
                <View
                    className="h-1 bg-discord-accent"
                    style={{ width: `${fraction * 100}%` }}
                />
            </View>
            <View
                pointerEvents="none"
                className="absolute w-4 h-4 rounded-full bg-discord-accent"
                style={{ left: fraction * Math.max(width - THUMB, 0) }}
            />
        </View>
    );
}
