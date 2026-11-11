// audioToWavSliced must write the same bytes as spessasynth_core's audioToWav, which the
// MIDI render worker used before.
import { audioToWav } from "spessasynth_core";
import { describe, expect, test } from "vite-plus/test";
import { createSlicer } from "#slicer";
import { audioToWavSliced } from "#wav";

function noise(frames: number, seed: number, scale: number): Float32Array {
  const out = new Float32Array(frames);
  let state = seed;
  for (let i = 0; i < frames; i++) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    out[i] = ((state / 2 ** 32) * 2 - 1) * scale;
  }
  return out;
}

const bytes = (buffer: ArrayBuffer) => new Uint8Array(buffer);

describe("audioToWavSliced", () => {
  test("writes audioToWav's bytes", async () => {
    for (const channels of [
      [noise(10_000, 1, 0.4), noise(10_000, 2, 0.9)],
      [noise(5_001, 3, 1.7)],
      [noise(3, 4, 0.01), noise(3, 5, 0.02), noise(3, 6, 0.03)],
      [new Float32Array(100), new Float32Array(100)],
      [Float32Array.from([1, -1, 0.5, -0.5, 1e-9, -1e-9, Number.NaN, 0.99999])],
      [new Float32Array(0), new Float32Array(0)],
    ]) {
      const expected = audioToWav(channels, 44_100, { normalizeAudio: true });
      expect(bytes(await audioToWavSliced(channels, 44_100))).toEqual(bytes(expected));
    }
  });

  test("gives the event loop turns on a long song", async () => {
    let clock = 0;
    let turns = 0;
    const slicer = createSlicer({
      sliceMs: 3,
      now: () => clock++,
      schedule: (run) => {
        turns++;
        setTimeout(run, 0);
      },
    });
    const frames = 44_100 * 2;
    const channels = [noise(frames, 7, 0.5), noise(frames, 8, 0.5)];
    const wav = await audioToWavSliced(channels, 44_100, slicer);
    expect(turns).toBeGreaterThan(10);
    expect(bytes(wav)).toEqual(bytes(audioToWav(channels, 44_100, { normalizeAudio: true })));
  });
});
