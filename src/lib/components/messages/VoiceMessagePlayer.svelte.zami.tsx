import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import {
    Pressable,
    Text,
    View,
    type AccessibilityActionEvent,
    type GestureResponderEvent,
} from "react-native";
import RNSvg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";
import { mediaSource } from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";
import { mxcToHttp } from "$lib/matrix/client";
import { decryptAttachment } from "$lib/utils/decryptAttachment";
import { formatCallDuration } from "$lib/utils/callDuration";

// Upstream's inline SVG icons: `w-*`/`h-*` size them, `colorClassName` is their
// `currentColor`.
const Svg = withUniwind(RNSvg);

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

// The file extension that tells AVPlayer and ExoPlayer the clip's container.
// Zami: not ported: Ogg and WebM (Opus) clips, what Element and Chromium or
// Firefox send, play on Android but not on iOS: AVPlayer has neither container.
const AUDIO_EXTENSIONS: [string, string][] = [
    ["mp4", ".m4a"],
    ["m4a", ".m4a"],
    ["aac", ".aac"],
    ["ogg", ".ogg"],
    ["opus", ".ogg"],
    ["webm", ".webm"],
    ["mpeg", ".mp3"],
    ["mp3", ".mp3"],
    ["wav", ".wav"],
    ["3gpp", ".3gp"],
    ["amr", ".amr"],
];

function audioExtension(mimetype: string | undefined): string {
    const type = mimetype?.toLowerCase() ?? "";
    return AUDIO_EXTENSIONS.find(([name]) => type.includes(name))?.[1] ?? "";
}

/**
 * Zami: upstream fetches the clip into a blob: URL (`fetchAttachmentBlob`, or
 * `fetchDecryptedAttachmentBlob` for an encrypted one). React Native can't build
 * those Blobs from bytes, and AVPlayer and ExoPlayer can't open a blob: URL, so
 * the clip is downloaded to a cache file instead, decrypted in place when it's
 * encrypted. The caller owns the file and must delete it.
 */
async function fetchAudioFile(
    httpUrl: string,
    encryptedFile: EncryptedFile | undefined,
    mimetype: string | undefined,
): Promise<File> {
    const file = new File(
        Paths.cache,
        `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${audioExtension(mimetype)}`,
    );
    try {
        // `mediaSource` attaches the account's token only to its own
        // homeserver's media, the guard the blob fetchers apply.
        await File.downloadFileAsync(httpUrl, file, {
            headers: mediaSource(httpUrl)?.headers,
            idempotent: true,
        });
        if (encryptedFile) {
            const plaintext = await decryptAttachment(
                await file.arrayBuffer(),
                encryptedFile,
            );
            await file.write(new Uint8Array(plaintext));
        }
        return file;
    } catch (err) {
        if (file.exists) file.delete();
        throw err;
    }
}

const LOAD_TIMEOUT_MS = 10_000;

/** Resolves once `player` can play its source; rejects if it can't load it. */
function whenLoaded(player: AudioPlayer): Promise<void> {
    return new Promise((resolve, reject) => {
        const settle = (error?: Error) => {
            subscription.remove();
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
        };
        const subscription = player.addListener(
            "playbackStatusUpdate",
            (status) => {
                if (status.isLoaded) settle();
                else if (status.error) settle(new Error(status.error));
            },
        );
        const timer = setTimeout(
            () => settle(new Error("timed out loading the clip")),
            LOAD_TIMEOUT_MS,
        );
        if (player.isLoaded) settle();
    });
}

export default function VoiceMessagePlayer({
    mxcUrl,
    encryptedFile,
    mimetype,
    waveform,
    durationMs,
}: Props) {
    // Zami: an expo-audio player stands in for the <audio> element, and the
    // downloaded file for the blob URL it plays.
    const audioEl = useRef<AudioPlayer | null>(null);
    const audioFile = useRef<File | null>(null);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [currentMs, setCurrentMsState] = useState(0);
    const [mediaDurationMs, setMediaDurationMs] = useState(0);
    const raf = useRef(0);
    // What the player's events and `toggle` (across its awaits) read.
    const playingRef = useRef(false);
    const currentMsRef = useRef(0);
    const destroyed = useRef(false);
    // The seek bar's width, for turning a tap's x into a position.
    const [sliderWidth, setSliderWidth] = useState(0);

    function setCurrentMs(ms: number) {
        currentMsRef.current = ms;
        setCurrentMsState(ms);
    }

    function setPlayingState(value: boolean) {
        playingRef.current = value;
        setPlaying(value);
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
        if (blobUrl) return true;
        setLoading(true);
        let file: File | null = null;
        let player: AudioPlayer | null = null;
        try {
            const http = mxcToHttp(encryptedFile ? encryptedFile.url : mxcUrl);
            if (!http) return false;
            file = await fetchAudioFile(http, encryptedFile, mimetype);
            player = createAudioPlayer({ uri: file.uri });
            listen(player);
            // Seeking (and so playing from a pre-seek) needs the clip loaded.
            await whenLoaded(player);
            if (destroyed.current) throw new Error("unmounted");
            audioEl.current = player;
            audioFile.current = file;
            setBlobUrl(file.uri);
            return true;
        } catch {
            player?.remove();
            if (file?.exists) file.delete();
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
            await audio.seekTo(currentMsRef.current / 1000); // resume from a pre-seek
        audio?.play();
    }

    function seekTo(ms: number) {
        setCurrentMs(ms);
        if (audioEl.current && blobUrl) void audioEl.current.seekTo(ms / 1000);
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

    // Drive progress at animation-frame rate while playing — the player's
    // status updates only arrive every 500ms, which makes the fill jump.
    function startProgressLoop() {
        cancelAnimationFrame(raf.current);
        const step = () => {
            const audio = audioEl.current;
            if (audio?.playing) {
                setCurrentMs(audio.currentTime * 1000);
                raf.current = requestAnimationFrame(step);
            }
        };
        raf.current = requestAnimationFrame(step);
    }

    // The <audio> element's onplay / onpause / onended / onloadedmetadata.
    function listen(player: AudioPlayer) {
        player.addListener("playbackStatusUpdate", (status) => {
            if (
                status.isLoaded &&
                Number.isFinite(status.duration) &&
                status.duration > 0
            )
                setMediaDurationMs(status.duration * 1000);
            if (status.didJustFinish) {
                setPlayingState(false);
                cancelAnimationFrame(raf.current);
                setCurrentMs(0);
                // A finished player stays at the end; the next play starts over.
                void player.seekTo(0);
            } else if (status.playing && !playingRef.current) {
                setPlayingState(true);
                startProgressLoop();
            } else if (!status.playing && playingRef.current) {
                setPlayingState(false);
                cancelAnimationFrame(raf.current);
                setCurrentMs(player.currentTime * 1000);
            }
        });
    }

    useEffect(
        () => () => {
            destroyed.current = true;
            cancelAnimationFrame(raf.current);
            audioEl.current?.remove();
            if (audioFile.current?.exists) audioFile.current.delete();
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
                    <View className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : playing ? (
                    <Svg
                        className="w-4 h-4"
                        colorClassName="accent-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <Path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                    </Svg>
                ) : (
                    <Svg
                        className="w-4 h-4 ms-0.5"
                        colorClassName="accent-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <Path d="M8 5v14l11-7z" />
                    </Svg>
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
