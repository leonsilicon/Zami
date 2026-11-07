import { useEffect, useRef, useState } from "react";
import {
    Pressable,
    Text,
    View,
    type AccessibilityActionEvent,
    type GestureResponderEvent,
} from "react-native";
import { Spin, SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";
import {
    fetchAttachmentBlob,
    fetchDecryptedAttachmentBlob,
    mxcToHttp,
} from "$lib/matrix/client";
import { formatCallDuration } from "$lib/utils/callDuration";

type EncryptedFile = {
    url: string;
    key: {
        k: string;
        alg?: string;
        kty?: string;
        ext?: boolean;
        key_ops?: string[];
    };
    iv: string;
    hashes: { sha256: string };
    v?: string;
};

interface Props {
    /** mxc:// url of the audio (unencrypted only). */
    mxcUrl?: string;
    /** Encrypted file metadata (encrypted only). */
    encryptedFile?: EncryptedFile;
    /** Plaintext mimetype (for encrypted files). */
    mimetype?: string;
    /** Stored amplitude bars (0..1024). */
    waveform: number[];
    /** Stored clip length in ms (fallback when media metadata is unusable). */
    durationMs: number;
}

export default function VoiceMessagePlayer({
    mxcUrl,
    encryptedFile,
    mimetype,
    waveform,
    durationMs,
}: Props) {
    // Zami: the hidden <audio> is an element nothing displays, made with the
    // blob URL it plays (Zami's `Audio` plays Ogg and WebM Opus too).
    const audioEl = useRef<HTMLAudioElement | null>(null);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [currentMs, setCurrentMsState] = useState(0);
    const [mediaDurationMs, setMediaDurationMs] = useState(0);
    const raf = useRef(0);
    // What the element's events and `toggle` (across its awaits) read.
    const currentMsRef = useRef(0);
    const destroyed = useRef(false);
    // The seek bar's width, for turning a tap's x into a position.
    const [sliderWidth, setSliderWidth] = useState(0);

    function setCurrentMs(ms: number) {
        currentMsRef.current = ms;
        setCurrentMsState(ms);
    }

    // Prefer the media's real duration once known — but MediaRecorder webm blobs
    // often report Infinity/NaN until fully buffered, so fall back to the
    // sender's stored value.
    const totalMs = mediaDurationMs > 0 ? mediaDurationMs : durationMs;
    const progress = totalMs > 0 ? Math.min(1, currentMs / totalMs) : 0;
    // Count up while active, show the full length at rest.
    const timeLabel = formatCallDuration(
        playing || currentMs > 0 ? currentMs : totalMs,
    );

    async function ensureLoaded(): Promise<boolean> {
        if (audioEl.current) return true;
        setLoading(true);
        try {
            let url: string;
            if (encryptedFile) {
                url = await fetchDecryptedAttachmentBlob(
                    encryptedFile,
                    mimetype,
                );
            } else {
                const http = mxcToHttp(mxcUrl);
                if (!http) return false;
                url = await fetchAttachmentBlob(http);
            }
            if (destroyed.current) {
                URL.revokeObjectURL(url);
                return false;
            }
            // Zami: upstream's `await tick()` lets the <audio> mount and bind;
            // here the element is made now.
            audioEl.current = createAudio(url);
            setBlobUrl(url);
            return true;
        } catch {
            return false;
        } finally {
            if (!destroyed.current) setLoading(false);
        }
    }

    async function toggle() {
        if (playing) {
            audioEl.current?.pause();
            return;
        }
        if (!(await ensureLoaded())) return;
        const audio = audioEl.current;
        if (audio && currentMsRef.current > 0)
            audio.currentTime = currentMsRef.current / 1000; // resume from a pre-seek
        await audio?.play().catch(() => {});
    }

    function seekTo(ms: number) {
        setCurrentMs(ms);
        if (audioEl.current && blobUrl) audioEl.current.currentTime = ms / 1000;
    }

    function seekFromEvent(e: GestureResponderEvent) {
        if (totalMs <= 0 || sliderWidth <= 0) return;
        const frac = Math.min(
            1,
            Math.max(0, e.nativeEvent.locationX / sliderWidth),
        );
        seekTo(frac * totalMs);
    }

    // Zami: the arrow keys' ±5% steps, as the screen reader's adjust actions.
    function onAccessibilityAction(e: AccessibilityActionEvent) {
        const name = e.nativeEvent.actionName;
        if (name === "increment" || name === "decrement") {
            const delta = (name === "increment" ? 0.05 : -0.05) * totalMs;
            seekTo(Math.min(totalMs, Math.max(0, currentMs + delta)));
        }
    }

    // Drive progress at animation-frame rate while playing — the audio
    // element's `timeupdate` only fires ~4×/s, which makes the fill jump.
    function startProgressLoop() {
        cancelAnimationFrame(raf.current);
        const step = () => {
            const audio = audioEl.current;
            if (audio && !audio.paused) {
                setCurrentMs(audio.currentTime * 1000);
                raf.current = requestAnimationFrame(step);
            }
        };
        raf.current = requestAnimationFrame(step);
    }

    // The <audio> element, with its onplay / onpause / onended /
    // onloadedmetadata.
    function createAudio(src: string): HTMLAudioElement {
        const audio = new Audio();
        audio.onplay = () => {
            setPlaying(true);
            startProgressLoop();
        };
        audio.onpause = () => {
            setPlaying(false);
            cancelAnimationFrame(raf.current);
            setCurrentMs(audio.currentTime * 1000);
        };
        audio.onended = () => {
            setPlaying(false);
            cancelAnimationFrame(raf.current);
            setCurrentMs(0);
        };
        audio.onloadedmetadata = () => {
            if (Number.isFinite(audio.duration))
                setMediaDurationMs(audio.duration * 1000);
        };
        audio.src = src;
        return audio;
    }

    useEffect(
        () => () => {
            destroyed.current = true;
            cancelAnimationFrame(raf.current);
            const audio = audioEl.current;
            if (audio) {
                // Zami: an unmounted <audio> stops; this one isn't in a page.
                audio.onpause = null;
                audio.pause();
                URL.revokeObjectURL(audio.src);
            }
        },
        [],
    );

    return (
        <View className="flex-row items-center gap-3 p-3 bg-discord-backgroundTertiary rounded-lg mt-1 max-w-sm w-full">
            <Pressable
                accessibilityRole="button"
                onPress={() => void toggle()}
                disabled={loading}
                className="w-8 h-8 rounded-full bg-discord-accent flex-shrink-0 flex items-center justify-center disabled:opacity-50"
            >
                {loading ? (
                    <Spin className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : playing ? (
                    <SvgIcon
                        className="w-4 h-4 text-white"
                        d="M6 5h4v14H6zM14 5h4v14h-4z"
                    />
                ) : (
                    <SvgIcon
                        className="w-4 h-4 ms-0.5 text-white"
                        d="M8 5v14l11-7z"
                    />
                )}
            </Pressable>

            <View className="flex-1 min-w-0">
                {waveform.length > 0 ? (
                    <Pressable
                        accessibilityRole="adjustable"
                        accessibilityLabel={t("voiceMessagePlayer.seek")}
                        accessibilityValue={{
                            min: 0,
                            max: 100,
                            now: Math.round(progress * 100),
                        }}
                        accessibilityActions={[
                            { name: "increment" },
                            { name: "decrement" },
                        ]}
                        onAccessibilityAction={onAccessibilityAction}
                        className="relative h-6 w-full cursor-pointer"
                        onLayout={(e) =>
                            setSliderWidth(e.nativeEvent.layout.width)
                        }
                        onPress={seekFromEvent}
                    >
                        {/* Base (unplayed) bars */}
                        <View
                            pointerEvents="none"
                            className="absolute inset-0 flex-row items-center gap-[2px] pointer-events-none"
                        >
                            {waveform.map((bar, i) => (
                                <View
                                    key={i}
                                    className="flex-1 min-w-[2px] rounded-full bg-discord-divider"
                                    style={{
                                        height: `${Math.max(8, (bar / 1024) * 100)}%`,
                                    }}
                                />
                            ))}
                        </View>
                        {/* Played bars, revealed by a continuous left-to-right clip so
                            the fill edge moves smoothly (sub-bar), not bar-by-bar.
                            Zami: no clip-path; a clipping box as wide as the played
                            part holds the bars at the full width. */}
                        <View
                            pointerEvents="none"
                            className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none"
                            style={{ width: `${progress * 100}%` }}
                        >
                            <View
                                className="absolute inset-y-0 left-0 flex-row items-center gap-[2px]"
                                style={{ width: sliderWidth }}
                            >
                                {waveform.map((bar, i) => (
                                    <View
                                        key={i}
                                        className="flex-1 min-w-[2px] rounded-full bg-discord-accent"
                                        style={{
                                            height: `${Math.max(8, (bar / 1024) * 100)}%`,
                                        }}
                                    />
                                ))}
                            </View>
                        </View>
                    </Pressable>
                ) : (
                    <Text
                        className="text-discord-textPrimary text-xs font-medium truncate"
                        numberOfLines={1}
                    >
                        {t("voiceMessagePlayer.voiceMessage")}
                    </Text>
                )}
            </View>

            <Text className="text-discord-textMuted text-xs tabular-nums flex-shrink-0 w-9 text-end">
                {timeLabel}
            </Text>
        </View>
    );
}
