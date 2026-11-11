import { useEffect, useEffectEvent, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Pause, Play } from "lucide-svelte";
import { Range } from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";
import { midiUrlToWavUrl } from "$lib/utils/midi";
import { formatCallDuration } from "$lib/utils/callDuration";
import { rememberVolume, saveVolume } from "$lib/actions/rememberVolume";

interface Props {
    midiUrl: string;
    onfail?: () => void;
}

export default function MidiPlayer({ midiUrl, onfail }: Props) {
    // Zami: not ported: real-time AudioWorklet synthesis. Native WebAudio has
    // no AudioWorklet, so use upstream's WAV fallback through the native Audio
    // element. Keep the caller's original URL for saving/retrying the file.
    const [audio] = useState(() => new Audio());
    const [ready, setReady] = useState(false);
    const [, redraw] = useState(0);
    const fail = useEffectEvent(() => onfail?.());
    useEffect(() => {
        let cancelled = false;
        let wav: string | null = null;
        setReady(false);
        const volume = rememberVolume(audio);
        const update = () => redraw((value) => value + 1);
        const events = [
            "play",
            "pause",
            "ended",
            "timeupdate",
            "durationchange",
            "volumechange",
        ];
        for (const event of events) audio.addEventListener(event, update);
        const onError = () => {
            if (!cancelled) fail();
        };
        audio.addEventListener("error", onError);
        void (async () => {
            // midiUrlToWavUrl consumes its input URL; give it an owned copy.
            const copy = URL.createObjectURL(
                await (await fetch(midiUrl)).blob(),
            );
            const made = await midiUrlToWavUrl(copy);
            if (cancelled) return URL.revokeObjectURL(made);
            wav = made;
            audio.src = made;
            setReady(true);
            await audio.play();
        })().catch(onError);
        return () => {
            cancelled = true;
            for (const event of events)
                audio.removeEventListener(event, update);
            audio.removeEventListener("error", onError);
            audio.pause();
            audio.src = "";
            volume.destroy();
            if (wav) URL.revokeObjectURL(wav);
        };
    }, [midiUrl, audio]);

    if (!ready)
        return (
            <Text className="text-xs text-discord-textMuted">
                {t("common.loading")}
            </Text>
        );
    const playing = !audio.paused;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    return (
        <View className="w-full gap-1">
            <Range
                min={0}
                max={duration || 1}
                step={0.1}
                value={audio.currentTime}
                onChange={(value) => {
                    audio.currentTime = value;
                }}
                accessibilityLabel={t("midiPlayer.seek")}
                className="w-full"
            />
            <View className="flex-row items-center gap-2">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(
                        playing ? "midiPlayer.pause" : "midiPlayer.play",
                    )}
                    className="w-7 h-7 rounded-full bg-discord-accent items-center justify-center"
                    onPress={() => {
                        if (playing) audio.pause();
                        else void audio.play().catch(() => {});
                    }}
                >
                    {playing ? (
                        <Pause size={14} className="text-white" />
                    ) : (
                        <Play size={14} className="text-white" />
                    )}
                </Pressable>
                <Text className="text-discord-textMuted text-xs tabular-nums">
                    {formatCallDuration(audio.currentTime * 1000)} /{" "}
                    {formatCallDuration(duration * 1000)}
                </Text>
                <View className="ms-auto w-20 shrink-0">
                    <Range
                        min={0}
                        max={1}
                        step={0.01}
                        value={audio.muted ? 0 : audio.volume}
                        onChange={(value) => {
                            audio.volume = value;
                            audio.muted = false;
                            saveVolume(value, false);
                        }}
                        accessibilityLabel={t("midiPlayer.volume")}
                    />
                </View>
            </View>
        </View>
    );
}
