import * as Clipboard from "expo-clipboard";
import { X } from "lucide-svelte";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { t } from "$lib/i18n";
import Portal from "$lib/components/ui/Portal.svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import { openModal, clearModalIfOwner } from "$lib/stores/interface.svelte";
import { voiceCallState } from "$lib/stores/voiceCall.svelte";
import { getRoom } from "$lib/matrix/client";
import {
    getCallDebugStats,
    type CallDebugConnection,
} from "$lib/matrix/livekitCall";
import {
    summarizeTransport,
    summarizeRtpStreams,
    diagnoseVideo,
    codecLabel,
    opusFeatures,
    pathIsTcp,
    rttTone,
    lossTone,
    jitterTone,
    type CallPath,
    type RtpStreamSummary,
    type StatTone,
    type StreamSource,
    type TransportSummary,
    type VideoStatus,
    type VideoTrackDebug,
} from "$lib/utils/callStats";
import { showToast } from "$lib/stores/toasts.svelte";

interface Props {
    onClose: () => void;
}

const POLL_MS = 1000;

interface ParticipantView {
    identity: string;
    name: string;
    quality: string;
    audio: TransportSummary | null;
}
interface VideoView {
    key: string;
    track: VideoTrackDebug;
    /** The RTP stream carrying it (the largest active layer when sent). */
    stream: RtpStreamSummary | null;
    status: VideoStatus;
    tone: StatTone;
    /** Frames decoded (received) or encoded (sent) per second, from the
     *  interval. */
    framesPerSec: number | null;
    /** Frames that arrived per second (received only). */
    receivedPerSec: number | null;
}
/** How a connection's traffic is routed (desktop proxy), PAC style. */
interface RouteView {
    signalling: string | null;
    sending: string | null;
    receiving: string | null;
}
interface ConnectionView {
    raw: CallDebugConnection;
    publisher: TransportSummary | null;
    subscriber: TransportSummary | null;
    participants: ParticipantView[];
    /** Sent streams first, then received; inactive simulcast layers
     *  left out. */
    streams: RtpStreamSummary[];
    videos: VideoView[];
    routes: RouteView | null;
}

const SOURCE_ORDER: StreamSource[] = [
    "microphone",
    "camera",
    "screen_share",
    "screen_share_audio",
    "unknown",
];

// Zami: the stats are React Native WebRTC's (LiveKit's React Native SDK). It
// has no <video> elements, so each video's painted-frame count stays empty.
export default function CallStatsPanel({ onClose }: Props) {
    const close = useEffectEvent(() => onClose());
    useEffect(() => {
        const token = openModal("call-stats", () => close());
        return () => {
            clearModalIfOwner(token);
        };
    }, []);

    const [connections, setConnections] = useState<ConnectionView[] | null>(
        null,
    );
    // Previous summary per transport / participant, for interval rates.
    const [prev] = useState(() => new Map<string, TransportSummary>());
    const [prevStreams] = useState(() => new Map<string, RtpStreamSummary[]>());
    // Per video: its stream and painted-frame count at the previous poll.
    const [prevVideo] = useState(
        () =>
            new Map<
                string,
                {
                    stream: RtpStreamSummary | null;
                    elementFrames: number | null;
                }
            >(),
    );

    function videosOf(
        c: CallDebugConnection,
        streams: RtpStreamSummary[],
    ): VideoView[] {
        return c.videos.map((v) => {
            const key = `${c.key}|v|${v.identity ?? "me"}|${v.source}`;
            const direction = v.identity === null ? "send" : "receive";
            const stream =
                streams
                    .filter(
                        (s) =>
                            s.kind === "video" &&
                            s.direction === direction &&
                            s.source === v.source &&
                            (direction === "send" || s.identity === v.identity),
                    )
                    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0] ?? null;
            const before = prevVideo.get(key);
            const { status, tone } = diagnoseVideo(
                v,
                stream,
                before?.stream?.id === stream?.id
                    ? (before?.stream ?? null)
                    : null,
                before?.elementFrames ?? null,
            );
            prevVideo.set(key, { stream, elementFrames: v.elementFrames });
            const dt =
                stream && before?.stream ? stream.at - before.stream.at : 0;
            const perSec = (now: number | null, then: number | null) =>
                dt > 0 && now !== null && then !== null && now >= then
                    ? ((now - then) * 1000) / dt
                    : null;
            return {
                key,
                track: v,
                stream,
                status,
                tone,
                framesPerSec: perSec(
                    stream?.frames ?? null,
                    before?.stream?.frames ?? null,
                ),
                receivedPerSec: perSec(
                    stream?.framesReceived ?? null,
                    before?.stream?.framesReceived ?? null,
                ),
            };
        });
    }

    /** Desktop only: ask main how each leg is routed right now. UDP never
     *  goes through a proxy, so only TCP media paths are asked about. */
    async function routesOf(
        c: CallDebugConnection,
        pub: TransportSummary | null,
        sub: TransportSummary | null,
    ): Promise<RouteView | null> {
        const route = window.desktop?.proxy?.route;
        if (!route) return null;
        const media = async (s: TransportSummary | null) => {
            if (!s?.remoteAddress) return null;
            if (s.path === "udp" || s.path === "relay-udp")
                return "DIRECT (UDP)";
            const addr = s.remoteAddress.includes("]")
                ? s.remoteAddress
                : s.remoteAddress.split(":").length > 2
                  ? `[${s.remoteAddress.replace(/:(\d+)$/, "]:$1")}`
                  : s.remoteAddress;
            return route(`https://${addr}/`).catch(() => null);
        };
        const [signalling, sending, receiving] = await Promise.all([
            c.sfuUrl ? route(c.sfuUrl).catch(() => null) : null,
            media(pub),
            media(sub),
        ]);
        return { signalling, sending, receiving };
    }

    function foldStreams(
        key: string,
        stats: CallDebugConnection["publisher"],
        owners: CallDebugConnection["owners"],
        at: number,
    ): RtpStreamSummary[] {
        if (!stats) return [];
        const s = summarizeRtpStreams(
            stats,
            at,
            owners,
            prevStreams.get(key) ?? [],
        );
        prevStreams.set(key, s);
        return s;
    }

    function streamsOf(c: CallDebugConnection, at: number) {
        const all = [
            ...foldStreams(`${c.key}|pub`, c.publisher, c.owners, at),
            ...foldStreams(`${c.key}|sub`, c.subscriber, c.owners, at),
        ].filter((s) => s.active !== false);
        return all.sort(
            (a, b) =>
                (a.direction === b.direction
                    ? 0
                    : a.direction === "send"
                      ? -1
                      : 1) ||
                (a.identity ?? "").localeCompare(b.identity ?? "") ||
                SOURCE_ORDER.indexOf(a.source) -
                    SOURCE_ORDER.indexOf(b.source) ||
                (b.width ?? 0) - (a.width ?? 0),
        );
    }

    function fold(
        key: string,
        stats: CallDebugConnection["publisher"],
        at: number,
    ): TransportSummary | null {
        if (!stats) return null;
        const s = summarizeTransport(stats, at, prev.get(key) ?? null);
        prev.set(key, s);
        return s;
    }

    function displayName(userId: string): string {
        const roomId = voiceCallState.roomId;
        const member = roomId ? getRoom(roomId)?.getMember(userId) : null;
        return member?.name || userId;
    }

    async function poll(): Promise<void> {
        const raw = await getCallDebugStats();
        const at = performance.now();
        if (!raw) {
            setConnections([]);
            return;
        }
        setConnections(
            await Promise.all(
                raw.map(async (c) => {
                    const publisher = fold(`${c.key}|pub`, c.publisher, at);
                    const subscriber = fold(`${c.key}|sub`, c.subscriber, at);
                    const streams = streamsOf(c, at);
                    return {
                        raw: c,
                        publisher,
                        subscriber,
                        participants: c.participants.map((p) => ({
                            identity: p.identity,
                            name: displayName(p.userId),
                            quality: p.quality,
                            audio: fold(
                                `${c.key}|p|${p.identity}`,
                                p.audio,
                                at,
                            ),
                        })),
                        streams,
                        videos: videosOf(c, streams),
                        routes: await routesOf(c, publisher, subscriber),
                    };
                }),
            ),
        );
    }

    const pollNow = useEffectEvent(() => poll());
    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const loop = async () => {
            try {
                await pollNow();
            } catch (e) {
                console.warn("[callStats] poll failed", e);
            }
            if (alive) timer = setTimeout(loop, POLL_MS);
        };
        void loop();
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, []);

    const ms = (v: number | null) => (v === null ? "-" : `${Math.round(v)} ms`);
    const kbps = (v: number | null) =>
        v === null
            ? "-"
            : v >= 1000
              ? `${(v / 1000).toFixed(2)} Mbit/s`
              : `${Math.round(v)} kbit/s`;
    const pct = (v: number | null) =>
        v === null ? "-" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

    function pathLabel(path: CallPath): string {
        switch (path) {
            case "udp":
                return t("callStats.pathUdp");
            case "tcp":
                return t("callStats.pathTcp");
            case "relay-udp":
                return t("callStats.pathRelayUdp");
            case "relay-tcp":
                return t("callStats.pathRelayTcp");
            case "relay-tls":
                return t("callStats.pathRelayTls");
            default:
                return t("callStats.pathUnknown");
        }
    }

    function pathTone(path: CallPath): StatTone {
        if (pathIsTcp(path)) return "bad";
        return path === "relay-udp" ? "warn" : "ok";
    }

    function qualityTone(q: string): StatTone {
        if (q === "excellent" || q === "good") return "ok";
        if (q === "poor") return "warn";
        return q === "lost" ? "bad" : "ok";
    }

    function qualityLabel(q: string): string {
        switch (q) {
            case "excellent":
                return t("callStats.qualityExcellent");
            case "good":
                return t("callStats.qualityGood");
            case "poor":
                return t("callStats.qualityPoor");
            case "lost":
                return t("callStats.qualityLost");
            default:
                return t("callStats.qualityUnknown");
        }
    }

    function sourceLabel(source: StreamSource): string {
        switch (source) {
            case "microphone":
                return t("callStats.sourceMicrophone");
            case "camera":
                return t("callStats.sourceCamera");
            case "screen_share":
                return t("callStats.sourceScreenShare");
            case "screen_share_audio":
                return t("callStats.sourceScreenShareAudio");
            default:
                return t("callStats.sourceUnknown");
        }
    }

    function streamTitle(s: RtpStreamSummary): string {
        const who =
            s.direction === "send"
                ? t("callStats.you")
                : s.identity
                  ? displayName(
                        s.identity.slice(0, s.identity.lastIndexOf(":")),
                    )
                  : "?";
        return `${who} · ${sourceLabel(s.source)}`;
    }

    function videoStatusLabel(status: VideoStatus): string {
        switch (status) {
            case "checking":
                return t("callStats.videoChecking");
            case "sending":
                return t("callStats.videoSending");
            case "notSending":
                return t("callStats.videoNotSending");
            case "captureEnded":
                return t("callStats.videoCaptureEnded");
            case "captureStalled":
                return t("callStats.videoCaptureStalled");
            case "playing":
                return t("callStats.videoPlaying");
            case "notSubscribed":
                return t("callStats.videoNotSubscribed");
            case "hiddenByYou":
                return t("callStats.videoHiddenByYou");
            case "turnedOff":
                return t("callStats.videoTurnedOff");
            case "pausedByServer":
                return t("callStats.videoPausedByServer");
            case "noPackets":
                return t("callStats.videoNoPackets");
            case "cantDecrypt":
                return t("callStats.videoCantDecrypt");
            case "cantDecode":
                return t("callStats.videoCantDecode");
            case "notShown":
                return t("callStats.videoNotShown");
            case "notPainting":
                return t("callStats.videoNotPainting");
        }
    }

    function videoTitle(v: VideoView): string {
        const who = v.track.identity
            ? displayName(
                  v.track.identity.slice(0, v.track.identity.lastIndexOf(":")),
              )
            : t("callStats.you");
        return `${who} · ${sourceLabel(v.track.source)}`;
    }

    const fpsLabel = (v: number | null) =>
        v === null ? "-" : `${Math.round(v)} fps`;

    function routeLabel(r: string | null): string {
        if (!r) return "-";
        if (r.startsWith("DIRECT")) return t("callStats.routeDirect");
        return t("callStats.routeProxy", {
            proxy: r.split(";")[0].trim(),
        });
    }
    function routeTone(r: string | null): StatTone {
        return r && !r.startsWith("DIRECT") ? "warn" : "ok";
    }

    function limitLabel(reason: string): string {
        switch (reason) {
            case "cpu":
                return t("callStats.limitCpu");
            case "bandwidth":
                return t("callStats.limitBandwidth");
            case "none":
                return t("callStats.limitNone");
            default:
                return t("callStats.limitOther");
        }
    }

    function limitTone(reason: string): StatTone {
        if (reason === "cpu") return "bad";
        return reason === "bandwidth" ? "warn" : "ok";
    }

    function implLabel(s: RtpStreamSummary): string {
        const kind =
            s.hardware === null
                ? ""
                : ` (${s.hardware ? t("callStats.hardware") : t("callStats.software")})`;
        return `${s.implementation ?? "?"}${kind}`;
    }

    function bitrateLabel(s: RtpStreamSummary): string {
        if (s.targetKbps === null || s.kind === "audio") return kbps(s.kbps);
        return t("callStats.bitrateTarget", {
            rate: kbps(s.kbps),
            target: kbps(s.targetKbps),
        });
    }

    const sendsVideo = (c: ConnectionView) =>
        c.streams.filter((s) => s.direction === "send" && s.kind === "video");
    const softwareEncode =
        connections?.some((c) =>
            sendsVideo(c).some((s) => s.hardware === false),
        ) ?? false;
    const cpuLimited =
        connections?.some((c) =>
            sendsVideo(c).some((s) => s.qualityLimitation === "cpu"),
        ) ?? false;

    const TONE_CLASS: Record<StatTone, string> = {
        ok: "text-discord-textPrimary",
        warn: "text-discord-warning",
        bad: "text-discord-danger",
    };

    const anyTcp =
        connections?.some(
            (c) =>
                (c.publisher && pathIsTcp(c.publisher.path)) ||
                (c.subscriber && pathIsTcp(c.subscriber.path)),
        ) ?? false;

    const serverSwitchedTcp =
        connections?.some(
            (c) =>
                c.publisher?.serverOfferedNoUdp ||
                c.subscriber?.serverOfferedNoUdp,
        ) ?? false;

    async function copyJson(): Promise<void> {
        const snapshot = {
            takenAt: new Date().toISOString(),
            // Zami: React Native's navigator has no userAgent; the platform and
            // its version stand in.
            userAgent:
                (navigator.userAgent as string | undefined) ??
                `${Platform.OS} ${Platform.Version}`,
            connections: connections?.map((c) => ({
                server: c.raw.server,
                publishing: c.raw.publishing,
                state: c.raw.state,
                region: c.raw.region,
                serverVersion: c.raw.serverVersion,
                signalRttMs: c.raw.signalRttMs,
                localQuality: c.raw.localQuality,
                publisher: c.publisher,
                subscriber: c.subscriber,
                participants: c.participants.map((p) => ({
                    identity: p.identity,
                    quality: p.quality,
                    audioIn: p.audio?.audioIn ?? null,
                    intervalAudioLoss: p.audio?.intervalAudioLoss ?? null,
                })),
                streams: c.streams,
                videos: c.videos.map((v) => ({
                    ...v.track,
                    status: v.status,
                    framesPerSec: v.framesPerSec,
                    receivedPerSec: v.receivedPerSec,
                })),
                routes: c.routes,
            })),
        };
        // Zami: navigator.clipboard → expo-clipboard.
        try {
            await Clipboard.setStringAsync(JSON.stringify(snapshot, null, 2));
            showToast(t("callStats.copied"));
        } catch {
            showToast(t("callStats.copyFailed"));
        }
    }

    // Zami: the `row` snippet takes its text size from the list it sits in
    // (`text-sm` from the panel, `text-xs` in a stream or video card), as the
    // web's inherits it; `rowIn` makes the row for one size. `text-end` isn't
    // React Native's; the value sits at the end of the row.
    const rowIn =
        (size: string) =>
        (label: string, value: string, tone: StatTone = "ok"): ReactNode => (
            <View className="flex-row justify-between gap-3 py-0.5">
                <Text className={`${size} text-discord-textMuted`}>
                    {label}
                </Text>
                <Text
                    className={`flex-shrink ${size} font-mono ${TONE_CLASS[tone]}`}
                >
                    {value}
                </Text>
            </View>
        );
    const row = rowIn("text-sm");

    const transport = (title: string, s: TransportSummary | null) => (
        <View className="min-w-0 sm:flex-1">
            <Text
                accessibilityRole="header"
                className="text-xs font-semibold uppercase tracking-wide text-discord-textMuted mb-1"
            >
                {title}
            </Text>
            {!s ? (
                <Text className="text-sm text-discord-textMuted">
                    {t("callStats.noTransport")}
                </Text>
            ) : (
                <View>
                    {row(
                        t("callStats.path"),
                        pathLabel(s.path),
                        pathTone(s.path),
                    )}
                    {row(
                        t("callStats.iceRtt"),
                        ms(s.iceRttMs),
                        rttTone(s.iceRttMs),
                    )}
                    {s.mediaRttMs !== null &&
                        row(
                            t("callStats.mediaRtt"),
                            ms(s.mediaRttMs),
                            rttTone(s.mediaRttMs),
                        )}
                    {row(t("callStats.upload"), kbps(s.sendKbps))}
                    {row(t("callStats.download"), kbps(s.recvKbps))}
                    {s.availableOutgoingKbps !== null &&
                        row(
                            t("callStats.availableUpload"),
                            kbps(s.availableOutgoingKbps),
                        )}
                    {s.outgoingLoss !== null &&
                        row(
                            t("callStats.outgoingLoss"),
                            pct(s.outgoingLoss),
                            lossTone(s.outgoingLoss),
                        )}
                    {!!s.remoteAddress &&
                        row(t("callStats.remoteAddress"), s.remoteAddress)}
                    {s.serverOfferedNoUdp &&
                        row(
                            t("callStats.serverCandidates"),
                            t("callStats.serverCandidatesNoUdp"),
                            "bad",
                        )}
                    {!!s.localCandidateType &&
                        row(
                            t("callStats.candidates"),
                            `${s.localCandidateType} → ${s.remoteCandidateType ?? "?"}`,
                        )}
                </View>
            )}
        </View>
    );

    // Zami: `grid sm:grid-cols-2` → a column that wraps into rows of two cards
    // (`sm:w-[48%]`) from `sm` up.
    const stream = (s: RtpStreamSummary) => {
        const row = rowIn("text-xs");
        return (
            <View
                key={s.id}
                className="min-w-0 sm:w-[48%] rounded bg-discord-backgroundSecondary px-3 py-2"
            >
                <View className="flex-row flex-wrap items-baseline gap-x-2 mb-1">
                    <Text className="text-sm font-medium text-discord-textPrimary">
                        {streamTitle(s)}
                    </Text>
                    <Text className="text-xs text-discord-textMuted">
                        {`${
                            s.direction === "send"
                                ? t("callStats.sent")
                                : t("callStats.received")
                        }${s.rid ? ` · ${t("callStats.layer", { rid: s.rid })}` : ""}`}
                    </Text>
                </View>
                <View>
                    {row(t("callStats.codec"), codecLabel(s.codec))}
                    {s.kind === "audio" &&
                        opusFeatures(s.codec?.fmtp ?? null).length > 0 &&
                        row(
                            t("callStats.codecOptions"),
                            opusFeatures(s.codec?.fmtp ?? null).join(", "),
                        )}
                    {row(t("callStats.bitrate"), bitrateLabel(s))}
                    {s.packetMs !== null &&
                        row(
                            t("callStats.packetDuration"),
                            `${Math.round(s.packetMs)} ms`,
                        )}
                    {!!s.width &&
                        !!s.height &&
                        row(
                            t("callStats.resolution"),
                            `${s.width}×${s.height}${s.fps !== null ? ` @ ${Math.round(s.fps)} fps` : ""}`,
                        )}
                    {(!!s.implementation || s.hardware !== null) &&
                        row(
                            s.direction === "send"
                                ? t("callStats.encoder")
                                : t("callStats.decoder"),
                            implLabel(s),
                            s.kind === "video" && s.hardware === false
                                ? "warn"
                                : "ok",
                        )}
                    {!!s.qualityLimitation &&
                        row(
                            t("callStats.limitedBy"),
                            limitLabel(s.qualityLimitation),
                            limitTone(s.qualityLimitation),
                        )}
                    {s.kind === "video" &&
                        s.frameTimeMs !== null &&
                        row(t("callStats.frameTime"), ms(s.frameTimeMs))}
                    {s.retransmitShare !== null &&
                        s.kind === "video" &&
                        row(
                            t("callStats.resent"),
                            pct(s.retransmitShare),
                            lossTone(s.retransmitShare),
                        )}
                    {!!s.framesDropped &&
                        row(
                            t("callStats.droppedFrames"),
                            String(s.framesDropped),
                        )}
                    {s.kind === "video" &&
                        (s.nackCount !== null || s.pliCount !== null) &&
                        row(
                            t("callStats.nackPli"),
                            `${s.nackCount ?? "-"} / ${s.pliCount ?? "-"}`,
                        )}
                    {s.direction === "receive" &&
                        s.jitterMs !== null &&
                        row(
                            t("callStats.jitter"),
                            ms(s.jitterMs),
                            jitterTone(s.jitterMs),
                        )}
                </View>
            </View>
        );
    };

    const video = (v: VideoView) => {
        const tr = v.track;
        const s = v.stream;
        const row = rowIn("text-xs");
        return (
            <View
                key={v.key}
                className="min-w-0 sm:w-[48%] rounded bg-discord-backgroundSecondary px-3 py-2"
            >
                <Text className="text-sm font-medium text-discord-textPrimary mb-1">
                    {videoTitle(v)}
                </Text>
                <Text className={`text-xs mb-1 ${TONE_CLASS[v.tone]}`}>
                    {videoStatusLabel(v.status)}
                </Text>
                <View>
                    {tr.identity === null &&
                        !!tr.captureWidth &&
                        !!tr.captureHeight &&
                        row(
                            t("callStats.capture"),
                            `${tr.captureWidth}×${tr.captureHeight}${tr.captureFps ? ` @ ${Math.round(tr.captureFps)} fps` : ""}${tr.displaySurface ? ` · ${tr.displaySurface}` : ""}`,
                        )}
                    {s && (
                        <>
                            {row(t("callStats.codec"), codecLabel(s.codec))}
                            {!!s.width &&
                                !!s.height &&
                                row(
                                    t("callStats.resolution"),
                                    `${s.width}×${s.height}`,
                                )}
                            {tr.identity !== null
                                ? row(
                                      t("callStats.framesArrivedDecoded"),
                                      `${fpsLabel(v.receivedPerSec)} / ${fpsLabel(v.framesPerSec)}`,
                                      v.status === "cantDecode" ||
                                          v.status === "cantDecrypt"
                                          ? "bad"
                                          : "ok",
                                  )
                                : row(
                                      t("callStats.framesEncoded"),
                                      fpsLabel(v.framesPerSec),
                                      v.status === "captureStalled"
                                          ? "bad"
                                          : "ok",
                                  )}
                            {!!s.implementation &&
                                row(
                                    s.direction === "send"
                                        ? t("callStats.encoder")
                                        : t("callStats.decoder"),
                                    implLabel(s),
                                )}
                        </>
                    )}
                    {tr.identity !== null &&
                        row(
                            t("callStats.onScreen"),
                            tr.elements === 0
                                ? t("callStats.onScreenNo")
                                : tr.elementWidth
                                  ? `${tr.elementWidth}×${tr.elementHeight}`
                                  : t("callStats.onScreenNoPicture"),
                        )}
                    {tr.decryptErrors > 0 &&
                        row(
                            t("callStats.decryptErrors"),
                            String(tr.decryptErrors),
                            "bad",
                        )}
                    {tr.trackMuted &&
                        row(
                            t("callStats.trackState"),
                            t("callStats.trackNoFrames"),
                            "warn",
                        )}
                </View>
            </View>
        );
    };

    // Zami: `max-h-[90dvh]` → `max-h-[90%]` of the dialog's layer, and the
    // panel's `flex flex-col` is a View's own layout. The `role="status"` notes
    // are polite live regions.
    return (
        <Portal>
            <ModalDialog
                onClose={onClose}
                labelledBy="call-stats-title"
                panelClass="relative bg-discord-background rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90%]"
            >
                <View className="flex-row items-center gap-2 px-5 py-3 border-b border-discord-divider flex-shrink-0">
                    <Text
                        nativeID="call-stats-title"
                        accessibilityRole="header"
                        className="flex-shrink text-lg font-bold text-discord-textPrimary"
                    >
                        {t("callStats.title")}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void copyJson()}
                        disabled={!connections?.length}
                        accessibilityState={{ disabled: !connections?.length }}
                        className="ms-auto px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover disabled:opacity-50"
                    >
                        <Text className="text-sm text-discord-textPrimary">
                            {t("callStats.copyJson")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={onClose}
                        className="p-1.5 rounded hover:bg-discord-messageHover"
                        accessibilityLabel={t("common.closeDialog")}
                    >
                        <X size={18} className="text-discord-textMuted" />
                    </Pressable>
                </View>

                <ScrollView
                    className="shrink"
                    contentContainerClassName="px-5 py-4 gap-4"
                >
                    {connections === null ? (
                        <Text className="text-sm text-discord-textMuted">
                            {t("callStats.loading")}
                        </Text>
                    ) : connections.length === 0 ? (
                        <Text className="text-sm text-discord-textMuted">
                            {t("callStats.notInCall")}
                        </Text>
                    ) : (
                        <>
                            {serverSwitchedTcp ? (
                                <View
                                    accessibilityLiveRegion="polite"
                                    className="rounded px-3 py-2 bg-discord-danger/15"
                                >
                                    <Text className="text-sm text-discord-textPrimary">
                                        {t("callStats.serverSwitchedTcp")}
                                    </Text>
                                </View>
                            ) : (
                                anyTcp && (
                                    <View
                                        accessibilityLiveRegion="polite"
                                        className="rounded px-3 py-2 bg-discord-danger/15"
                                    >
                                        <Text className="text-sm text-discord-textPrimary">
                                            {t("callStats.tcpWarning")}
                                        </Text>
                                    </View>
                                )
                            )}
                            {cpuLimited && (
                                <View
                                    accessibilityLiveRegion="polite"
                                    className="rounded px-3 py-2 bg-discord-danger/15"
                                >
                                    <Text className="text-sm text-discord-textPrimary">
                                        {t("callStats.cpuLimitHint")}
                                    </Text>
                                </View>
                            )}
                            {softwareEncode && (
                                <View
                                    accessibilityLiveRegion="polite"
                                    className="rounded px-3 py-2 bg-discord-warning/15"
                                >
                                    <Text className="text-sm text-discord-textPrimary">
                                        {t("callStats.softwareEncodeHint")}
                                    </Text>
                                </View>
                            )}
                            {connections.map((c) => (
                                <View
                                    key={c.raw.key}
                                    className="rounded-lg border border-discord-divider p-3 gap-3"
                                >
                                    <View className="flex-row flex-wrap items-baseline gap-x-2">
                                        <Text
                                            accessibilityRole="header"
                                            className="text-sm font-semibold text-discord-textPrimary"
                                        >
                                            {c.raw.server}
                                        </Text>
                                        <Text className="text-xs text-discord-textMuted">
                                            {`${
                                                c.raw.publishing
                                                    ? t("callStats.publishing")
                                                    : t("callStats.listening")
                                            } · ${c.raw.state}${
                                                c.raw.region
                                                    ? ` · ${c.raw.region}`
                                                    : ""
                                            }${
                                                c.raw.serverVersion
                                                    ? ` · v${c.raw.serverVersion}`
                                                    : ""
                                            }`}
                                        </Text>
                                    </View>
                                    <View>
                                        {row(
                                            t("callStats.signalRtt"),
                                            ms(c.raw.signalRttMs),
                                            rttTone(c.raw.signalRttMs),
                                        )}
                                        {row(
                                            t("callStats.yourQuality"),
                                            qualityLabel(c.raw.localQuality),
                                            qualityTone(c.raw.localQuality),
                                        )}
                                    </View>
                                    {/* Zami: `grid sm:grid-cols-2` → a column,
                                        a row of two from `sm` up. */}
                                    <View className="gap-4 sm:flex-row">
                                        {transport(
                                            t("callStats.sending"),
                                            c.publisher,
                                        )}
                                        {transport(
                                            t("callStats.receiving"),
                                            c.subscriber,
                                        )}
                                    </View>
                                    {c.routes && (
                                        <View>
                                            <Text
                                                accessibilityRole="header"
                                                className="text-xs font-semibold uppercase tracking-wide text-discord-textMuted mb-1"
                                            >
                                                {t("callStats.proxyRoute")}
                                            </Text>
                                            <View>
                                                {row(
                                                    t(
                                                        "callStats.routeSignalling",
                                                    ),
                                                    routeLabel(
                                                        c.routes.signalling,
                                                    ),
                                                    routeTone(
                                                        c.routes.signalling,
                                                    ),
                                                )}
                                                {row(
                                                    t("callStats.routeSending"),
                                                    routeLabel(
                                                        c.routes.sending,
                                                    ),
                                                    routeTone(c.routes.sending),
                                                )}
                                                {row(
                                                    t(
                                                        "callStats.routeReceiving",
                                                    ),
                                                    routeLabel(
                                                        c.routes.receiving,
                                                    ),
                                                    routeTone(
                                                        c.routes.receiving,
                                                    ),
                                                )}
                                            </View>
                                        </View>
                                    )}
                                    {c.videos.length > 0 && (
                                        <View>
                                            <Text
                                                accessibilityRole="header"
                                                className="text-xs font-semibold uppercase tracking-wide text-discord-textMuted mb-1"
                                            >
                                                {t("callStats.video")}
                                            </Text>
                                            <View className="gap-2 sm:flex-row sm:flex-wrap">
                                                {c.videos.map((v) => video(v))}
                                            </View>
                                        </View>
                                    )}
                                    {/* Zami: the table as rows of cells with
                                        set widths, in a horizontal scroller
                                        (`overflow-x-auto`). `text-start` /
                                        `text-end` aren't React Native's, and
                                        `title` (the identity) has no
                                        equivalent. */}
                                    {c.participants.length > 0 && (
                                        <ScrollView
                                            horizontal
                                            contentContainerClassName="min-w-full"
                                        >
                                            <View className="w-full">
                                                <View className="flex-row">
                                                    <Text className="flex-1 min-w-28 max-w-[12rem] text-xs text-discord-textMuted font-medium py-1 pe-2">
                                                        {t(
                                                            "callStats.participant",
                                                        )}
                                                    </Text>
                                                    <Text className="w-24 text-xs text-discord-textMuted font-medium py-1 pe-2">
                                                        {t(
                                                            "callStats.theirQuality",
                                                        )}
                                                    </Text>
                                                    <Text className="w-16 text-xs text-discord-textMuted font-medium py-1 pe-2">
                                                        {t("callStats.loss")}
                                                    </Text>
                                                    <Text className="w-16 text-xs text-discord-textMuted font-medium py-1 pe-2">
                                                        {t("callStats.jitter")}
                                                    </Text>
                                                    <Text className="w-16 text-xs text-discord-textMuted font-medium py-1">
                                                        {t("callStats.buffer")}
                                                    </Text>
                                                </View>
                                                {c.participants.map((p) => (
                                                    <View
                                                        key={p.identity}
                                                        className="flex-row border-t border-discord-divider"
                                                    >
                                                        <Text
                                                            numberOfLines={1}
                                                            className="flex-1 min-w-28 max-w-[12rem] py-1 pe-2 text-xs font-sans text-discord-textPrimary truncate"
                                                        >
                                                            {p.name}
                                                        </Text>
                                                        <Text
                                                            className={`w-24 py-1 pe-2 text-xs font-sans ${
                                                                TONE_CLASS[
                                                                    qualityTone(
                                                                        p.quality,
                                                                    )
                                                                ]
                                                            }`}
                                                        >
                                                            {qualityLabel(
                                                                p.quality,
                                                            )}
                                                        </Text>
                                                        <Text
                                                            className={`w-16 py-1 pe-2 text-xs font-mono ${
                                                                TONE_CLASS[
                                                                    lossTone(
                                                                        p.audio
                                                                            ?.intervalAudioLoss ??
                                                                            null,
                                                                    )
                                                                ]
                                                            }`}
                                                        >
                                                            {pct(
                                                                p.audio
                                                                    ?.intervalAudioLoss ??
                                                                    null,
                                                            )}
                                                        </Text>
                                                        <Text
                                                            className={`w-16 py-1 pe-2 text-xs font-mono ${
                                                                TONE_CLASS[
                                                                    jitterTone(
                                                                        p.audio
                                                                            ?.audioIn
                                                                            .jitterMs ??
                                                                            null,
                                                                    )
                                                                ]
                                                            }`}
                                                        >
                                                            {ms(
                                                                p.audio?.audioIn
                                                                    .jitterMs ??
                                                                    null,
                                                            )}
                                                        </Text>
                                                        <Text className="w-16 py-1 text-xs font-mono text-discord-textPrimary">
                                                            {ms(
                                                                p.audio?.audioIn
                                                                    .jitterBufferMs ??
                                                                    null,
                                                            )}
                                                        </Text>
                                                    </View>
                                                ))}
                                            </View>
                                        </ScrollView>
                                    )}
                                    {c.streams.length > 0 && (
                                        <View>
                                            <Text
                                                accessibilityRole="header"
                                                className="text-xs font-semibold uppercase tracking-wide text-discord-textMuted mb-1"
                                            >
                                                {t("callStats.streams")}
                                            </Text>
                                            <View className="gap-2 sm:flex-row sm:flex-wrap">
                                                {c.streams.map((s) =>
                                                    stream(s),
                                                )}
                                            </View>
                                        </View>
                                    )}
                                </View>
                            ))}
                            <Text className="text-xs text-discord-textMuted">
                                {t("callStats.legend")}
                            </Text>
                        </>
                    )}
                </ScrollView>
            </ModalDialog>
        </Portal>
    );
}
