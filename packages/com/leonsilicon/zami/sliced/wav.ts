// spessasynth_core's audioToWav, a slice at a time: a rendered song is millions of samples,
// which Hermes takes seconds to scan and convert in one go.
import { createSlicer, type Slicer } from "#slicer";

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
/** Frames converted between checks of the slicer's clock. */
const CHUNK_FRAMES = 1024;

const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function writeAscii(view: DataView, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
}

/**
 * A 16-bit PCM WAV file of `channels` (one Float32Array a channel, all as long), normalized
 * so the loudest sample is full scale: the same bytes as spessasynth_core's
 * `audioToWav(channels, sampleRate, { normalizeAudio: true })`, which its MIDI render
 * worker writes with. It yields to the event loop as it goes.
 */
export async function audioToWavSliced(
  channels: readonly Float32Array[],
  sampleRate: number,
  slicer: Slicer = createSlicer(),
): Promise<ArrayBuffer> {
  const frames = channels[0]?.length ?? 0;
  const count = channels.length;
  const dataBytes = frames * count * BYTES_PER_SAMPLE;
  const wav = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(wav);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, HEADER_BYTES + dataBytes - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * BYTES_PER_SAMPLE, true);
  view.setUint16(32, count * BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let loudest = 0;
  for (const channel of channels) {
    for (let start = 0; start < frames; start += CHUNK_FRAMES) {
      if (slicer.due) await slicer.pause();
      const end = Math.min(frames, start + CHUNK_FRAMES);
      for (let i = start; i < end; i++) {
        const sample = Math.abs(channel[i]!);
        if (sample > loudest) loudest = sample;
      }
    }
  }
  const multiplier = loudest > 0 ? 32767 / loudest : 1;

  // Interleaved, frame by frame. A typed array truncates toward zero as audioToWav's
  // `sample & 255` does; DataView where the platform isn't little-endian.
  const out = littleEndian ? new Int16Array(wav, HEADER_BYTES, frames * count) : null;
  for (let start = 0; start < frames; start += CHUNK_FRAMES) {
    if (slicer.due) await slicer.pause();
    const end = Math.min(frames, start + CHUNK_FRAMES);
    for (let c = 0; c < count; c++) {
      const channel = channels[c]!;
      for (let i = start; i < end; i++) {
        const sample = Math.min(32767, Math.max(-32768, channel[i]! * multiplier));
        const at = i * count + c;
        if (out) out[at] = sample;
        else view.setInt16(HEADER_BYTES + at * BYTES_PER_SAMPLE, sample, true);
      }
    }
  }
  return wav;
}
