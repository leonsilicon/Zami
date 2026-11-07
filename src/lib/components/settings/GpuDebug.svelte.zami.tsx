import {
    useEffect,
    useEffectEvent,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { ChevronDown, ChevronRight } from "lucide-svelte";
import { Select } from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import {
    memorySeriesCsv,
    memorySeriesText,
    type MemorySample,
} from "$lib/utils/memorySeries";
import { downloadObjectUrl } from "$lib/utils/saveFile";

// Which video codecs decode and encode on the GPU, probed in the page so
// the web and Android builds show them too. On desktop (window.desktop.gpu
// exists) it adds Chromium's GPU report and the switches to turn hardware
// acceleration (or Linux GPU encoding) off for drivers that misbehave.
//
// Zami: React Native has neither the desktop bridge nor the web's media APIs
// (MediaSource, navigator.mediaCapabilities, WebCodecs' VideoEncoder), so the
// probes below find nothing: every codec reads as unsupported, and the encode
// rows, the encode test and the desktop sections don't show. That is the panel's
// unavailable state, which this renders. The desktop and WebCodecs code is kept
// as upstream has it, behind the same feature checks, so it never runs here.
// Zami: not ported: probing the platform's own decoders (VideoToolbox,
// MediaCodec), which the native video player uses.
type GpuReport = Awaited<
    ReturnType<NonNullable<NonNullable<Window["desktop"]>["gpu"]>["info"]>
>;
type Decode = "hardware" | "software" | "unsupported";

// One common stream per codec; HEVC twice because 10-bit (Main10) is the
// one phones record and the one drivers most often lack.
const CODECS: [string, string][] = [
    ["H.264", 'video/mp4; codecs="avc1.640028"'],
    ["HEVC", 'video/mp4; codecs="hvc1.1.6.L120.90"'],
    ["HEVC 10-bit", 'video/mp4; codecs="hvc1.2.4.L120.90"'],
    ["VP9", 'video/webm; codecs="vp09.00.40.08"'],
    ["AV1", 'video/mp4; codecs="av01.0.08M.08"'],
];

// WebCodecs names for the codecs a call can send. Calls send VP8 (LiveKit's
// default), so that row is what decides whether a call encodes on the GPU.
const ENCODE_CODECS: [string, string][] = [
    ["VP8", "vp8"],
    ["VP9", "vp09.00.10.08"],
    ["H.264", "avc1.42001f"],
    ["HEVC", "hev1.1.6.L93.B0"],
    ["HEVC 10-bit", "hev1.2.4.L93.B0"],
    ["AV1", "av01.0.04M.08"],
];

// Chromium reports a codec it can only play in software as supported but
// not power efficient; power efficient means the GPU decodes it.
async function probe(contentType: string): Promise<Decode> {
    if (
        typeof MediaSource === "undefined" ||
        !MediaSource.isTypeSupported(contentType)
    )
        return "unsupported";
    try {
        const result = await navigator.mediaCapabilities.decodingInfo({
            type: "media-source",
            video: {
                contentType,
                width: 1920,
                height: 1080,
                bitrate: 8_000_000,
                framerate: 30,
            },
        });
        if (!result.supported) return "unsupported";
        return result.powerEfficient ? "hardware" : "software";
    } catch {
        return "software";
    }
}

// WebCodecs refuses a "prefer-hardware" config when no GPU encoder takes
// it, so asking twice tells hardware from software. A 720p30 stream is
// what a call's top camera layer sends. Calls encode at a constant bitrate
// (WebRTC on Linux asks VA-API for CBR); WebCodecs' default is variable,
// which a CBR-only encoder like Zam's NVENC driver would fail.
async function probeEncode(codec: string): Promise<Decode> {
    const config = {
        codec,
        width: 1280,
        height: 720,
        bitrate: 2_500_000,
        bitrateMode: "constant" as const,
        framerate: 30,
    };
    const supported = async (hardwareAcceleration: HardwareAcceleration) => {
        try {
            return !!(
                await VideoEncoder.isConfigSupported({
                    ...config,
                    hardwareAcceleration,
                })
            ).supported;
        } catch {
            return false;
        }
    };
    if (await supported("prefer-hardware")) return "hardware";
    return (await supported("no-preference")) ? "software" : "unsupported";
}

// isConfigSupported only asks whether an encoder could exist. This runs
// one: 60 frames of H.264 at the settings a call sends (baseline, constant
// bitrate), once per size, hardware then software. A GPU encoder that
// creates fine but then errors shows its message here, and the per-frame
// times tell hardware from OpenH264. Opt-in and not on Linux: WebCodecs
// there hands the GPU process dma-bufs that crash it on NVIDIA.
const ENCODE_TEST_SIZES: [number, number, number][] = [
    [1280, 720, 2_500_000],
    [640, 360, 800_000],
    [320, 180, 200_000],
];

async function encodeRun(
    width: number,
    height: number,
    bitrate: number,
    hardwareAcceleration: HardwareAcceleration,
): Promise<string> {
    const config: VideoEncoderConfig = {
        codec: "avc1.42001f",
        width,
        height,
        bitrate,
        bitrateMode: "constant",
        framerate: 30,
        hardwareAcceleration,
        latencyMode: "realtime",
    };
    try {
        const { supported } = await VideoEncoder.isConfigSupported(config);
        if (!supported) return t("gpuDebug.encodeTestRejected");
    } catch (e) {
        return (e as Error)?.message ?? String(e);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    let failure = "";
    let chunks = 0;
    const encoder = new VideoEncoder({
        output: () => chunks++,
        error: (e) => (failure = e.message || String(e)),
    });
    const frames = 60;
    try {
        encoder.configure(config);
        const started = performance.now();
        for (let i = 0; i < frames && !failure; i++) {
            ctx!.fillStyle = `hsl(${(i * 9) % 360},70%,45%)`;
            ctx!.fillRect(0, 0, width, height);
            ctx!.fillStyle = "#fff";
            ctx!.fillRect(
                (i * 17) % (width - 80),
                (i * 11) % (height - 80),
                80,
                80,
            );
            const frame = new VideoFrame(canvas, { timestamp: i * 33_333 });
            encoder.encode(frame, { keyFrame: i === 0 });
            frame.close();
            if (encoder.encodeQueueSize > 4) await encoder.flush();
        }
        if (!failure) await encoder.flush();
        const ms = performance.now() - started;
        if (failure) return failure;
        return t("gpuDebug.encodeTestResult", {
            chunks,
            ms: (ms / frames).toFixed(1),
        });
    } catch (e) {
        return failure || ((e as Error)?.message ?? String(e));
    } finally {
        try {
            encoder.close();
        } catch {
            /* already closed by an error */
        }
    }
}

type NvidiaMode = "auto" | "vulkan" | "off";

const decodeLabel = (d: Decode) =>
    d === "hardware"
        ? t("gpuDebug.decodeHardware")
        : d === "software"
          ? t("gpuDebug.decodeSoftware")
          : t("gpuDebug.decodeUnsupported");

// Chromium's memory by process and allocator, for working out what a
// large GPU or RAM figure in Task Manager is made of.
type MemoryReport = Awaited<
    ReturnType<
        NonNullable<
            NonNullable<NonNullable<Window["desktop"]>["gpu"]>["memoryReport"]
        >
    >
>;
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

const elapsed = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const smallButtonClass =
    "px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover disabled:opacity-50";
// Zami: the text half of upstream's small button classes, for the Text inside.
const smallButtonTextClass = "text-xs font-semibold text-discord-textPrimary";

// Zami: Text classes sit on each Text; a `<pre>` is a nested ScrollView of selectable
// Text, and `<details>` a pressable summary (Details, below).
export default function GpuDebug() {
    const desktop = !!window.desktop?.gpu;
    const [report, setReport] = useState<GpuReport | null>(null);
    const [decode, setDecode] = useState<[string, Decode][]>([]);
    const [encode, setEncode] = useState<[string, Decode][]>([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    // isConfigSupported only asks whether an encoder could exist; encodeRun
    // (above) runs one. Opt-in and not on Linux.
    const canRunEncodeTest =
        typeof VideoEncoder !== "undefined" &&
        /Windows|Macintosh/.test(navigator.userAgent);
    const [encodeTest, setEncodeTest] = useState<[string, string][]>([]);
    const [encodeTesting, setEncodeTesting] = useState(false);

    async function runEncodeTest() {
        setEncodeTesting(true);
        setEncodeTest([]);
        try {
            for (const [w, h, bitrate] of ENCODE_TEST_SIZES) {
                for (const mode of [
                    "prefer-hardware",
                    "prefer-software",
                ] as const) {
                    const result = await encodeRun(w, h, bitrate, mode);
                    setEncodeTest((current) => [
                        ...current,
                        [
                            `${w}x${h} ${mode === "prefer-hardware" ? t("gpuDebug.decodeHardware") : t("gpuDebug.decodeSoftware")}`,
                            result,
                        ],
                    ]);
                }
            }
        } finally {
            setEncodeTesting(false);
        }
    }

    async function load() {
        const gpu = window.desktop?.gpu;
        setLoading(true);
        setError("");
        try {
            const [next, codecs, encoders] = await Promise.all([
                gpu ? gpu.info() : null,
                Promise.all(
                    CODECS.map(
                        async ([name, type]) =>
                            [name, await probe(type)] as [string, Decode],
                    ),
                ),
                typeof VideoEncoder === "undefined"
                    ? []
                    : Promise.all(
                          ENCODE_CODECS.map(
                              async ([name, codec]) =>
                                  [name, await probeEncode(codec)] as [
                                      string,
                                      Decode,
                                  ],
                          ),
                      ),
            ]);
            setReport(next);
            setDecode(codecs);
            setEncode(encoders);
        } catch (e) {
            setError((e as Error)?.message ?? String(e));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
    }, []);

    // Zami: upstream writes into the `$state` report; here each change is a new
    // report, and a failed save puts the old value back the same way.
    async function setHardwareAcceleration(enabled: boolean) {
        if (!report) return;
        setReport({ ...report, hardwareAcceleration: enabled });
        try {
            await window.desktop?.gpu?.setHardwareAcceleration(enabled);
        } catch (e) {
            setReport((r) => r && { ...r, hardwareAcceleration: !enabled });
            setError((e as Error)?.message ?? String(e));
        }
    }

    async function setVideoEncode(enabled: boolean) {
        const ve = report?.videoEncode;
        if (!report || !ve) return;
        setReport({ ...report, videoEncode: { ...ve, enabled } });
        try {
            await window.desktop?.gpu?.setVideoEncode(enabled);
        } catch (e) {
            setReport(
                (r) =>
                    r && {
                        ...r,
                        videoEncode: r.videoEncode && {
                            ...r.videoEncode,
                            enabled: !enabled,
                        },
                    },
            );
            setError((e as Error)?.message ?? String(e));
        }
    }

    async function setSkiaGraphite(enabled: boolean) {
        const sg = report?.skiaGraphite;
        if (!report || !sg) return;
        setReport({ ...report, skiaGraphite: { ...sg, enabled } });
        try {
            await window.desktop?.gpu?.setSkiaGraphite(enabled);
        } catch (e) {
            setReport(
                (r) =>
                    r && {
                        ...r,
                        skiaGraphite: { ...r.skiaGraphite, enabled: !enabled },
                    },
            );
            setError((e as Error)?.message ?? String(e));
        }
    }

    // Applies on the next launch (zam.sh); a flag rather than a comparison with
    // activeAtLaunch, which stays false on machines zam.sh finds no NVIDIA in.
    const [nvidiaEncodeChanged, setNvidiaEncodeChanged] = useState(false);

    async function setNvidiaEncode(enabled: boolean) {
        const ne = report?.nvidiaEncode;
        if (!report || !ne) return;
        setReport({ ...report, nvidiaEncode: { ...ne, enabled } });
        setNvidiaEncodeChanged(true);
        try {
            await window.desktop?.gpu?.setNvidiaEncode(enabled);
        } catch (e) {
            setReport(
                (r) =>
                    r && {
                        ...r,
                        nvidiaEncode: r.nvidiaEncode && {
                            ...r.nvidiaEncode,
                            enabled: !enabled,
                        },
                    },
            );
            setError((e as Error)?.message ?? String(e));
        }
    }

    // The Vulkan path only takes effect on the next launch (zam.sh).
    const [nvidiaChanged, setNvidiaChanged] = useState(false);

    async function setNvidiaVideo(mode: NvidiaMode) {
        const nv = report?.nvidiaVideo;
        if (!report || !nv) return;
        const prev = nv.mode;
        setReport({ ...report, nvidiaVideo: { ...nv, mode, failedAt: null } });
        setNvidiaChanged(true);
        try {
            await window.desktop?.gpu?.setNvidiaVideo(mode);
        } catch (e) {
            setReport(
                (r) =>
                    r && {
                        ...r,
                        nvidiaVideo: r.nvidiaVideo && {
                            ...r.nvidiaVideo,
                            mode: prev,
                        },
                    },
            );
            setError((e as Error)?.message ?? String(e));
        }
    }

    // The flag is only on with hardware acceleration, so a run without it
    // can't tell whether the encode choice changed.
    const encodeChanged =
        !!report?.videoEncode &&
        report.hardwareAccelerationAtLaunch &&
        report.videoEncode.enabled !== report.videoEncode.activeAtLaunch;

    const graphiteChanged =
        !!report?.skiaGraphite &&
        report.hardwareAccelerationAtLaunch &&
        report.skiaGraphite.enabled !== report.skiaGraphite.activeAtLaunch;

    const reportJson =
        report || decode.length
            ? JSON.stringify(
                  {
                      ...report,
                      videoDecode: Object.fromEntries(decode),
                      videoEncode: Object.fromEntries(encode),
                  },
                  null,
                  2,
              )
            : "";

    const canMeasureMemory = !!window.desktop?.gpu?.memoryReport;
    const [memory, setMemory] = useState<MemoryReport | null>(null);
    const [measuringMemory, setMeasuringMemory] = useState(false);
    const [memoryCopied, setMemoryCopied] = useState(false);

    async function measureMemory() {
        const run = window.desktop?.gpu?.memoryReport;
        if (!run) return;
        setMeasuringMemory(true);
        try {
            setMemory(await run());
        } catch (e) {
            setMemory({ error: (e as Error)?.message ?? String(e) });
        } finally {
            setMeasuringMemory(false);
        }
    }

    // The same report on an interval. Main keeps the samples, so this only
    // fetches what's new while the panel is open.
    const memoryRecord = window.desktop?.gpu?.memoryRecord;
    const [recording, setRecording] = useState(false);
    const [recordInterval, setRecordInterval] = useState(10000);
    const [samples, setSamples] = useState<MemorySample[]>([]);
    const [recordStartedAt, setRecordStartedAt] = useState<number | null>(null);
    const [seriesCopied, setSeriesCopied] = useState(false);
    const [now, setNow] = useState(Date.now());
    const sampleIndex = useRef(0);

    function takeRecording(r: MemoryRecording, append: boolean) {
        setRecording(r.running);
        setRecordStartedAt(r.startedAt ?? null);
        if (r.intervalMs) setRecordInterval(r.intervalMs);
        setSamples((current) =>
            append ? [...current, ...r.samples] : r.samples,
        );
        sampleIndex.current = (r.from ?? 0) + r.samples.length;
    }

    async function pollRecording() {
        if (!memoryRecord) return;
        takeRecording(
            await memoryRecord.get(sampleIndex.current),
            sampleIndex.current > 0,
        );
    }

    // Zami: the interval reads `recording` as it is at each tick.
    const onRecordTick = useEffectEvent(() => {
        setNow(Date.now());
        if (recording) void pollRecording();
    });

    useEffect(() => {
        if (!memoryRecord) return;
        void pollRecording();
        const id = setInterval(onRecordTick, 2000);
        return () => clearInterval(id);
    }, []);

    async function toggleRecording() {
        if (!memoryRecord) return;
        if (recording) {
            setRecording((await memoryRecord.stop()).running);
            await pollRecording();
        } else {
            takeRecording(await memoryRecord.start(recordInterval), false);
        }
    }

    const seriesText = memorySeriesText(samples);

    async function copySeries() {
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(seriesText);
            setSeriesCopied(true);
            setTimeout(() => setSeriesCopied(false), 2000);
        } catch {
            /* clipboard denied: the summary is still on screen to select */
        }
    }

    // Zami: desktop only (memoryRecord), so never reached on React Native, where
    // downloadObjectUrl's <a download> doesn't exist.
    function saveSeriesCsv() {
        const url = URL.createObjectURL(
            new Blob([memorySeriesCsv(samples)], { type: "text/csv" }),
        );
        const stamp = new Date(samples[0]?.at ?? Date.now())
            .toISOString()
            .slice(0, 19)
            .replace(/:/g, "-");
        downloadObjectUrl(url, `zam-memory-${stamp}.csv`);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    const memoryText =
        !memory || "error" in memory
            ? ""
            : memory.processes
                  .map((p) =>
                      [
                          `${p.name} (pid ${p.pid})${p.workingSetKb != null ? `, working set ${mb(p.workingSetKb * 1024)}` : ""}`,
                          ...p.allocators.map(
                              ([name, bytes]) =>
                                  `  ${mb(bytes).padStart(10)}  ${name}`,
                          ),
                      ].join("\n"),
                  )
                  .join("\n\n");

    async function copyMemory() {
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(memoryText);
            setMemoryCopied(true);
            setTimeout(() => setMemoryCopied(false), 2000);
        } catch {
            /* clipboard denied: the report is still on screen to select */
        }
    }

    async function copy() {
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(reportJson);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* clipboard denied: the report is still on screen to select */
        }
    }

    const decodeClass = (d: Decode) =>
        `font-mono text-xs ${
            d === "hardware"
                ? "text-discord-textPositive"
                : d === "software"
                  ? "text-discord-warning"
                  : "text-discord-danger"
        }`;

    const sg = report?.skiaGraphite;
    const ve = report?.videoEncode;
    const nv = report?.nvidiaVideo;
    const ne = report?.nvidiaEncode;

    return (
        <View>
            <View className="mb-2 flex-row items-center gap-2">
                <Text className="flex-1 text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                    {t("gpuDebug.title")}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    onPress={load}
                    disabled={loading}
                    className={smallButtonClass}
                >
                    <Text className={smallButtonTextClass}>
                        {t("debugSettings.refresh")}
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    onPress={copy}
                    disabled={!reportJson}
                    className={smallButtonClass}
                >
                    <Text className={smallButtonTextClass}>
                        {copied ? t("debugSettings.copied") : t("common.copy")}
                    </Text>
                </Pressable>
            </View>

            {desktop && (
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("gpuDebug.hardwareAcceleration")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("gpuDebug.hardwareAccelerationHint")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={report?.hardwareAcceleration ?? true}
                        onChange={setHardwareAcceleration}
                        label={t("gpuDebug.hardwareAcceleration")}
                    />
                </View>
            )}
            {report && sg && (
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("gpuDebug.skiaGraphite")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("gpuDebug.skiaGraphiteHint")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {report.featureStatus?.skia_graphite?.startsWith(
                                "enabled",
                            )
                                ? t("gpuDebug.nvidiaVideoActive")
                                : t("gpuDebug.nvidiaVideoInactive")}
                        </Text>
                        {sg.failedAt && !sg.enabled ? (
                            <Text className="text-xs text-discord-warning">
                                {t("gpuDebug.skiaGraphiteFailed")}
                            </Text>
                        ) : null}
                    </View>
                    <ToggleSwitch
                        checked={sg.enabled}
                        onChange={setSkiaGraphite}
                        label={t("gpuDebug.skiaGraphite")}
                    />
                </View>
            )}
            {ve && (
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("gpuDebug.videoEncode")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("gpuDebug.videoEncodeHint")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {ve.activeAtLaunch
                                ? t("gpuDebug.nvidiaVideoActive")
                                : t("gpuDebug.nvidiaVideoInactive")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={ve.enabled}
                        onChange={setVideoEncode}
                        label={t("gpuDebug.videoEncode")}
                    />
                </View>
            )}
            {nv && (
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("gpuDebug.nvidiaVideo")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("gpuDebug.nvidiaVideoHint")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {nv.activeAtLaunch
                                ? t("gpuDebug.nvidiaVideoActive")
                                : t("gpuDebug.nvidiaVideoInactive")}
                        </Text>
                        {nv.failedAt && nv.mode === "auto" ? (
                            <Text className="text-xs text-discord-warning">
                                {t("gpuDebug.nvidiaVideoFailed")}
                            </Text>
                        ) : null}
                    </View>
                    <Select
                        className="bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-2 py-1.5 border border-discord-divider focus:outline-none focus:ring-2 focus:ring-discord-accent sm:max-w-[16rem]"
                        value={nv.mode}
                        onChange={(mode) => setNvidiaVideo(mode)}
                        accessibilityLabel={t("gpuDebug.nvidiaVideo")}
                        options={[
                            {
                                value: "auto",
                                label: t("gpuDebug.nvidiaVideoAuto"),
                            },
                            {
                                value: "vulkan",
                                label: t("gpuDebug.nvidiaVideoVulkan"),
                            },
                            {
                                value: "off",
                                label: t("gpuDebug.nvidiaVideoOff"),
                            },
                        ]}
                    />
                </View>
            )}
            {ne && (
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("gpuDebug.nvidiaEncode")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("gpuDebug.nvidiaEncodeHint")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {ne.activeAtLaunch
                                ? t("gpuDebug.nvidiaVideoActive")
                                : t("gpuDebug.nvidiaVideoInactive")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={ne.enabled}
                        onChange={setNvidiaEncode}
                        label={t("gpuDebug.nvidiaEncode")}
                    />
                </View>
            )}
            {report &&
                (nvidiaChanged ||
                    report.hardwareAcceleration !==
                        report.hardwareAccelerationAtLaunch ||
                    encodeChanged ||
                    graphiteChanged ||
                    nvidiaEncodeChanged) && (
                    <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                        <Text className="flex-1 text-xs text-discord-warning">
                            {t("gpuDebug.restartToApply")}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => window.desktop?.gpu?.relaunch()}
                            className="px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover"
                        >
                            <Text className="text-sm font-medium text-white">
                                {t("gpuDebug.restart")}
                            </Text>
                        </Pressable>
                    </View>
                )}

            {window.desktop?.gpu?.repaint && (
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("gpuDebug.repaint")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("gpuDebug.repaintHint")}
                        </Text>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void window.desktop?.gpu?.repaint?.()}
                        className={smallButtonClass}
                    >
                        <Text className={smallButtonTextClass}>
                            {t("gpuDebug.repaint")}
                        </Text>
                    </Pressable>
                </View>
            )}

            {canMeasureMemory && (
                <View className="py-2 border-b border-discord-divider">
                    <View className="flex-row items-center gap-3">
                        <View className="flex-1 min-w-0">
                            <Text className="text-sm text-discord-textPrimary">
                                {t("gpuDebug.memoryReport")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t("gpuDebug.memoryReportHint")}
                            </Text>
                        </View>
                        {memoryText ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={copyMemory}
                                className={smallButtonClass}
                            >
                                <Text className={smallButtonTextClass}>
                                    {memoryCopied
                                        ? t("debugSettings.copied")
                                        : t("common.copy")}
                                </Text>
                            </Pressable>
                        ) : null}
                        <Pressable
                            accessibilityRole="button"
                            onPress={measureMemory}
                            disabled={measuringMemory}
                            className={smallButtonClass}
                        >
                            <Text className={smallButtonTextClass}>
                                {measuringMemory
                                    ? t("gpuDebug.memoryMeasuring")
                                    : t("gpuDebug.memoryMeasure")}
                            </Text>
                        </Pressable>
                    </View>
                    {memory && "error" in memory ? (
                        <Text className="mt-2 text-xs text-discord-danger break-all">
                            {memory.error}
                        </Text>
                    ) : memoryText ? (
                        <Pre className="mt-2 max-h-80">{memoryText}</Pre>
                    ) : null}
                    {memoryRecord && (
                        <>
                            <View className="mt-3 flex-row items-center gap-3">
                                <View className="flex-1 min-w-0">
                                    <Text className="text-sm text-discord-textPrimary">
                                        {t("gpuDebug.memoryRecord")}
                                    </Text>
                                    <Text className="text-xs text-discord-textMuted">
                                        {t("gpuDebug.memoryRecordHint")}
                                    </Text>
                                </View>
                                <Select
                                    value={String(recordInterval)}
                                    onChange={(value) =>
                                        setRecordInterval(Number(value))
                                    }
                                    disabled={recording}
                                    accessibilityLabel={t(
                                        "gpuDebug.memoryRecordInterval",
                                    )}
                                    className="rounded bg-discord-backgroundSecondary px-1.5 py-1 text-xs text-discord-textPrimary disabled:opacity-50"
                                    options={[5, 10, 30, 60].map((s) => ({
                                        value: String(s * 1000),
                                        label: t("gpuDebug.memoryRecordEvery", {
                                            seconds: s,
                                        }),
                                    }))}
                                />
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={toggleRecording}
                                    className={`px-2.5 py-1 rounded ${
                                        recording
                                            ? "bg-discord-danger"
                                            : "bg-discord-backgroundSecondary hover:bg-discord-messageHover"
                                    }`}
                                >
                                    <Text
                                        className={`text-xs font-semibold ${
                                            recording
                                                ? "text-white"
                                                : "text-discord-textPrimary"
                                        }`}
                                    >
                                        {recording
                                            ? t("gpuDebug.memoryRecordStop")
                                            : t("gpuDebug.memoryRecordStart")}
                                    </Text>
                                </Pressable>
                            </View>
                            {(samples.length > 0 || recording) && (
                                <>
                                    <View className="mt-2 flex-row items-center gap-2">
                                        <Text className="flex-1 text-xs text-discord-textMuted">
                                            {t("gpuDebug.memoryRecordStatus", {
                                                count: samples.length,
                                                elapsed: elapsed(
                                                    (recording
                                                        ? now
                                                        : (samples.at(-1)?.at ??
                                                          now)) -
                                                        (recordStartedAt ??
                                                            now),
                                                ),
                                            })}
                                        </Text>
                                        {seriesText ? (
                                            <>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={copySeries}
                                                    className={smallButtonClass}
                                                >
                                                    <Text
                                                        className={
                                                            smallButtonTextClass
                                                        }
                                                    >
                                                        {seriesCopied
                                                            ? t(
                                                                  "debugSettings.copied",
                                                              )
                                                            : t("common.copy")}
                                                    </Text>
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={saveSeriesCsv}
                                                    className={smallButtonClass}
                                                >
                                                    <Text
                                                        className={
                                                            smallButtonTextClass
                                                        }
                                                    >
                                                        {t(
                                                            "gpuDebug.memoryRecordCsv",
                                                        )}
                                                    </Text>
                                                </Pressable>
                                            </>
                                        ) : null}
                                    </View>
                                    {seriesText ? (
                                        <Pre className="mt-2 max-h-80">
                                            {seriesText}
                                        </Pre>
                                    ) : null}
                                </>
                            )}
                        </>
                    )}
                </View>
            )}

            {error ? (
                <Text className="mt-2 text-xs text-discord-danger break-all">
                    {error}
                </Text>
            ) : (desktop ? !report : loading && !decode.length) ? (
                <Text className="mt-2 text-xs text-discord-textMuted">
                    {t("common.loading")}
                </Text>
            ) : (
                <>
                    <Text className="mt-3 mb-1 text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                        {t("gpuDebug.videoDecoding")}
                    </Text>
                    {decode.map(([name, d]) => (
                        <View
                            key={name}
                            className="flex-row items-start gap-3 py-1 border-b border-discord-divider"
                        >
                            <Text className="text-sm text-discord-textMuted flex-shrink-0 w-44">
                                {name}
                            </Text>
                            <Text className={decodeClass(d)}>
                                {decodeLabel(d)}
                            </Text>
                        </View>
                    ))}

                    {encode.length > 0 && (
                        <>
                            <Text className="mt-3 mb-1 text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                                {t("gpuDebug.videoEncoding")}
                            </Text>
                            {encode.map(([name, d]) => (
                                <View
                                    key={name}
                                    className="flex-row items-start gap-3 py-1 border-b border-discord-divider"
                                >
                                    <Text className="text-sm text-discord-textMuted flex-shrink-0 w-44">
                                        {name}
                                    </Text>
                                    <Text className={decodeClass(d)}>
                                        {decodeLabel(d)}
                                    </Text>
                                </View>
                            ))}
                            <Text className="mt-1 text-xs text-discord-textMuted">
                                {t("gpuDebug.videoEncodingHint")}
                            </Text>
                            {canRunEncodeTest && (
                                <>
                                    <View className="mt-2 flex-row items-center gap-2">
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={runEncodeTest}
                                            disabled={encodeTesting}
                                            className={smallButtonClass}
                                        >
                                            <Text
                                                className={smallButtonTextClass}
                                            >
                                                {t("gpuDebug.encodeTest")}
                                            </Text>
                                        </Pressable>
                                        <Text className="flex-1 text-xs text-discord-textMuted">
                                            {t("gpuDebug.encodeTestHint")}
                                        </Text>
                                    </View>
                                    {encodeTest.map(([label, result], i) => (
                                        <View
                                            key={i}
                                            className="flex-row items-start gap-3 py-1 border-b border-discord-divider"
                                        >
                                            <Text className="text-sm text-discord-textMuted flex-shrink-0 w-44">
                                                {label}
                                            </Text>
                                            <Text className="flex-1 font-mono text-xs text-discord-textPrimary break-all">
                                                {result}
                                            </Text>
                                        </View>
                                    ))}
                                </>
                            )}
                        </>
                    )}

                    {report && (
                        <>
                            <Text className="mt-3 mb-1 text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                                {t("gpuDebug.featureStatus")}
                            </Text>
                            {Object.entries(report.featureStatus).map(
                                ([feature, status]) => (
                                    <View
                                        key={feature}
                                        className="flex-row items-start gap-3 py-1 border-b border-discord-divider"
                                    >
                                        <Text className="text-discord-textMuted flex-shrink-0 w-44 break-all font-mono text-xs">
                                            {feature}
                                        </Text>
                                        <Text className="flex-1 text-discord-textPrimary break-all font-mono text-xs">
                                            {status}
                                        </Text>
                                    </View>
                                ),
                            )}

                            <Details
                                className="mt-3"
                                summary={
                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                                        {t("gpuDebug.details")}
                                    </Text>
                                }
                            >
                                <Pre className="mt-1 max-h-80" wrap>
                                    {reportJson}
                                </Pre>
                            </Details>
                        </>
                    )}
                </>
            )}
        </View>
    );
}

// Zami: <pre class="… overflow-auto rounded bg-discord-backgroundTertiary p-2
// text-xs font-mono text-discord-textPrimary select-text"> → a nested ScrollView of
// selectable Text, which keeps the spaces and line breaks. `whitespace-pre` lines
// don't wrap, so they scroll sideways; `wrap` is `whitespace-pre-wrap`.
function Pre({
    className,
    wrap = false,
    children,
}: {
    className: string;
    wrap?: boolean;
    children: string;
}) {
    const text = (
        <Text selectable className="text-xs font-mono text-discord-textPrimary">
            {children}
        </Text>
    );
    return (
        <ScrollView
            nestedScrollEnabled
            className={`rounded bg-discord-backgroundTertiary ${className}`}
            contentContainerClassName="p-2"
        >
            {wrap ? (
                text
            ) : (
                <ScrollView horizontal nestedScrollEnabled>
                    {text}
                </ScrollView>
            )}
        </ScrollView>
    );
}

// Zami: <details>/<summary> → a pressable summary, with the browser's disclosure
// marker, that shows or hides the body.
function Details({
    className,
    summary,
    children,
}: {
    className: string;
    summary: ReactNode;
    children?: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const Marker = open ? ChevronDown : ChevronRight;
    return (
        <View className={className}>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => setOpen(!open)}
                className="flex-row items-center gap-1"
            >
                <Marker size={14} className="text-discord-textMuted" />
                {summary}
            </Pressable>
            {open && children}
        </View>
    );
}
