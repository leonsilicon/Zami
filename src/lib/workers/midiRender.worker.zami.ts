/// <reference lib="webworker" />
/**
 * Renders a MIDI file to WAV with a real sound bank (SF2/SF3/DLS) using
 * spessasynth_core. Runs in a worker because it's pure-JS synthesis: a
 * 90-second song is seconds of CPU that would otherwise freeze the UI.
 * Driven by $lib/utils/midiSoundBank.ts.
 */
import {
    BasicMIDI,
    InterpolationTypes,
    SoundBankLoader,
    SpessaSynthProcessor,
    SpessaSynthSequencer,
    audioToWav,
    BasicSoundBank,
} from "spessasynth_core";
import { decodeBankOpusSamples } from "$lib/utils/opusSample";

// Zami: spessasynth's SF3 Vorbis decoder is WebAssembly, which Hermes lacks.
// Its constructor attaches a success-only .then to this shared promise, so
// catching it only at our await still left an unhandled rejection. Resolve
// the native fallback before making a synth; Opus/PCM samples are decoded here.
if (typeof WebAssembly === "undefined") {
    BasicSoundBank.isSF3DecoderReady = BasicSoundBank.isSF3DecoderReady.catch(
        () => {},
    );
}

export interface MidiRenderRequest {
    id: number;
    midi: ArrayBuffer;
    /** Sent once per bank; later requests reuse the parsed one. */
    bank?: { key: string; data: ArrayBuffer };
    bankKey: string;
}

export type MidiRenderResponse =
    | { id: number; wav: ArrayBuffer }
    | { id: number; error: string };

const SAMPLE_RATE = 44100;
const BLOCK = 128;
/** Reverb/release tail kept after the last event. */
const TAIL_SECONDS = 2;
/** Same bound as the WebAudio fallback in $lib/utils/midi.ts. */
const MAX_SECONDS = 15 * 60;
/** Zami: how long the render runs before letting the UI handle input and draw. */
const YIELD_EVERY_MS = 12;

let loaded: { key: string; bank: BasicSoundBank } | null = null;

/**
 * The bundled bank stores its samples as Opus (see $lib/utils/opusSample),
 * which the synth can't decode itself: decode them all up front.
 */
async function decodeOpusSamples(bank: BasicSoundBank): Promise<void> {
    for (const d of await decodeBankOpusSamples(bank.samples)) {
        bank.samples[d.index].setAudioData(d.pcm, d.sampleRate);
    }
}

// Zami: exported: React Native has no Web Workers, so midiSoundBank calls it on
// the app's own thread.
export async function render(req: MidiRenderRequest): Promise<ArrayBuffer> {
    if (req.bank) {
        const bank = SoundBankLoader.fromArrayBuffer(req.bank.data);
        await decodeOpusSamples(bank);
        loaded = { key: req.bank.key, bank };
    }
    if (!loaded || loaded.key !== req.bankKey) {
        throw new Error("Sound bank not loaded");
    }

    const synth = new SpessaSynthProcessor(SAMPLE_RATE, {
        maxBufferSize: BLOCK,
        eventsEnabled: false,
    });
    try {
        // Linear interpolation audibly dulls the top octave whenever a sample
        // is played at a fractional step, i.e. almost always (and always for
        // the bundled bank, whose samples are resampled to ~48 kHz).
        synth.setSystemParameter(
            "interpolationType",
            InterpolationTypes.hermite,
        );
        synth.soundBankManager.addSoundBank(loaded.bank, "main");
        // Zami: this waits for spessasynth's SF3 Vorbis decoder, which is
        // WebAssembly (Hermes has none), so it fails. Only Vorbis samples need
        // it: the bundled bank's are Opus (decoded above), SF2 and DLS banks'
        // are PCM; a custom SF3's Vorbis samples play silent.
        await synth.processorInitialized.catch(() => {});
        const seq = new SpessaSynthSequencer(synth);
        seq.loopCount = 0;
        const song = BasicMIDI.fromArrayBuffer(req.midi);
        seq.loadNewSongList([song]);
        seq.play();

        const maxFrames = Math.ceil(
            Math.min(song.duration + TAIL_SECONDS, MAX_SECONDS) * SAMPLE_RATE,
        );
        const left = new Float32Array(maxFrames);
        const right = new Float32Array(maxFrames);
        const tailFrames = TAIL_SECONDS * SAMPLE_RATE;
        let endFrame = maxFrames;
        // Zami: on the app's one JS thread, so the UI gets a turn every few ms.
        let lastYield = performance.now();
        for (let i = 0; i < endFrame; i += BLOCK) {
            if (performance.now() - lastYield > YIELD_EVERY_MS) {
                await new Promise((resolve) => setTimeout(resolve, 0));
                lastYield = performance.now();
            }
            seq.processTick();
            synth.process(left, right, i, Math.min(BLOCK, endFrame - i));
            if (seq.isFinished && endFrame === maxFrames) {
                endFrame = Math.min(maxFrames, i + BLOCK + tailFrames);
            }
        }
        return audioToWav(
            [left.subarray(0, endFrame), right.subarray(0, endFrame)],
            SAMPLE_RATE,
            { normalizeAudio: true },
        );
    } finally {
        // destroySynthProcessor() also destroys every bank still attached,
        // which would leave the cached `loaded.bank` empty and every later
        // render silent. Detach it first (deleteSoundBank doesn't destroy).
        if (synth.soundBankManager.priorityOrder.includes("main")) {
            synth.soundBankManager.deleteSoundBank("main");
        }
        synth.destroySynthProcessor();
    }
}

self.onmessage = async (e: MessageEvent<MidiRenderRequest>) => {
    const { id } = e.data;
    try {
        const wav = await render(e.data);
        (self as DedicatedWorkerGlobalScope).postMessage(
            { id, wav } satisfies MidiRenderResponse,
            [wav],
        );
    } catch (err) {
        (self as DedicatedWorkerGlobalScope).postMessage({
            id,
            error: err instanceof Error ? err.message : String(err),
        } satisfies MidiRenderResponse);
    }
};
