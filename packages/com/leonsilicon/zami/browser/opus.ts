// Opus audio as Ogg Opus, the one Opus container iOS's audio decoders read. Chromium's
// MediaRecorder writes Opus in WebM (Zam's voice messages from Chrome and Electron), and
// WebCodecs hands over bare packets (the bundled SoundFont's samples); both are rewrapped
// here, without decoding, for react-native-audio-api to decode.

const OPUS_RATE = 48000;

/** The samples (at 48 kHz) an Opus packet decodes to, from its TOC byte (RFC 6716, 3.1). */
export function opusPacketSamples(packet: Uint8Array): number {
  if (packet.length === 0) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  const frameSize =
    config < 12
      ? [480, 960, 1920, 2880][config & 3]
      : config < 16
        ? [480, 960][config & 1]
        : [120, 240, 480, 960][config & 3];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return frameSize * frames;
}

export interface OpusHeadOptions {
  channels: number;
  /** Samples (at 48 kHz) to drop from the start of the decoded stream. */
  preSkip?: number;
  /** The sample rate the audio was recorded at (informational). */
  inputSampleRate?: number;
}

/** An `OpusHead` identification header (RFC 7845, 5.1) for mono or stereo audio. */
export function opusHead({
  channels,
  preSkip = 0,
  inputSampleRate = OPUS_RATE,
}: OpusHeadOptions): Uint8Array<ArrayBuffer> {
  if (channels < 1 || channels > 2)
    throw new Error(`Opus: ${channels} channels need a mapping table`);
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);
  head.set(ascii("OpusHead"));
  head[8] = 1; // version
  head[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputSampleRate, true);
  view.setInt16(16, 0, true); // output gain
  head[18] = 0; // channel mapping family: mono or stereo
  return head;
}

/** The pre-skip an `OpusHead` asks for. */
export function opusHeadPreSkip(head: Uint8Array): number {
  return head.length >= 12 ? head[10] | (head[11] << 8) : 0;
}

function isOpusHead(bytes: Uint8Array | undefined): bytes is Uint8Array {
  return bytes !== undefined && bytes.length >= 19 && startsWith(bytes, ascii("OpusHead"));
}

/**
 * An Ogg Opus stream of `packets` behind the identification header `head`. Each page's
 * granule position counts the samples decoded so far, pre-skip included, so the stream
 * ends exactly at its last packet.
 */
export function oggOpus(head: Uint8Array, packets: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const vendor = ascii("Zami");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set(ascii("OpusTags"));
  new DataView(tags.buffer).setUint32(8, vendor.length, true);
  tags.set(vendor, 12); // and no user comments

  const serial = 0x5a414d49; // "ZAMI"
  const pages: Uint8Array[] = [
    oggPage({ serial, sequence: 0, granule: 0, flags: BEGINNING_OF_STREAM, packets: [head] }),
    oggPage({ serial, sequence: 1, granule: 0, flags: 0, packets: [tags] }),
  ];
  let granule = 0;
  let pending: Uint8Array[] = [];
  let segments = 0;
  const flush = (last: boolean) => {
    if (pending.length === 0 && !last) return;
    pages.push(
      oggPage({
        serial,
        sequence: pages.length,
        granule,
        flags: last ? END_OF_STREAM : 0,
        packets: pending,
      }),
    );
    pending = [];
    segments = 0;
  };
  for (const packet of packets) {
    const needed = Math.floor(packet.length / 255) + 1;
    if (needed > 255) throw new Error("Opus: packet too large for one Ogg page");
    // A page holds 255 lacing values; about a second of 20 ms packets fits.
    if (segments + needed > 255 || pending.length >= 50) flush(false);
    pending.push(packet);
    segments += needed;
    granule += opusPacketSamples(packet);
  }
  flush(true);
  return concat(pages);
}

const BEGINNING_OF_STREAM = 0x02;
const END_OF_STREAM = 0x04;

function oggPage({
  serial,
  sequence,
  granule,
  flags,
  packets,
}: {
  serial: number;
  sequence: number;
  granule: number;
  flags: number;
  packets: readonly Uint8Array[];
}): Uint8Array {
  const lacing: number[] = [];
  for (const packet of packets) {
    for (let left = packet.length; ; left -= 255) {
      lacing.push(Math.min(left, 255));
      if (left < 255) break;
    }
  }
  const bodyLength = packets.reduce((sum, packet) => sum + packet.length, 0);
  const page = new Uint8Array(27 + lacing.length + bodyLength);
  const view = new DataView(page.buffer);
  page.set(ascii("OggS"));
  page[4] = 0; // version
  page[5] = flags;
  view.setUint32(6, granule % 2 ** 32, true);
  view.setUint32(10, Math.floor(granule / 2 ** 32), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const packet of packets) {
    page.set(packet, at);
    at += packet.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

let crcTable: Uint32Array | undefined;

/** Ogg's CRC-32: polynomial 0x04c11db7, not reflected, starting at 0 (RFC 3533, 6). */
export function oggCrc(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let bit = 0; bit < 8; bit++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      crcTable[i] = r >>> 0;
    }
  }
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc;
}

// --- WebM ---

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

/** Whether `bytes` start like a Matroska or WebM file. */
export function isWebM(bytes: Uint8Array): boolean {
  return startsWith(bytes, EBML_MAGIC);
}

// The elements on the way to the Opus track and its blocks (Matroska's IDs, markers kept).
const SEGMENT = 0x18538067;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_NUMBER = 0xd7;
const CODEC_ID = 0x86;
const CODEC_PRIVATE = 0x63a2;
const CODEC_DELAY = 0x56aa;
const AUDIO = 0xe1;
const CHANNELS = 0x9f;
const CLUSTER = 0x1f43b675;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const BLOCK = 0xa1;
/** Elements whose children are read in place, rather than skipped. */
const CONTAINERS = new Set([SEGMENT, TRACKS, TRACK_ENTRY, AUDIO, CLUSTER, BLOCK_GROUP]);

interface Track {
  number?: number;
  codec?: string;
  codecPrivate?: Uint8Array;
  codecDelayNs?: number;
  channels?: number;
}

/**
 * The Opus track of a WebM (or Matroska) file as Ogg Opus, or null when there's none.
 * Handles what MediaRecorder writes: a Segment and Clusters of unknown size, and blocks
 * with or without lacing.
 */
export function webmOpusToOgg(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (!isWebM(bytes)) return null;
  const tracks: Track[] = [];
  let opus: Track | undefined;
  const packets: Uint8Array[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    const id = readVint(bytes, pos, true);
    if (!id || id.value === undefined) break;
    const size = readVint(bytes, pos + id.length, false);
    if (!size) break;
    const start = pos + id.length + size.length;
    const end =
      size.value === undefined ? bytes.length : Math.min(start + size.value, bytes.length);
    const element = id.value;
    if (CONTAINERS.has(element)) {
      if (element === TRACK_ENTRY) tracks.push({});
      pos = start;
      continue;
    }
    // Skipping an element needs its size; one of unknown size outside the path ends the walk.
    if (size.value === undefined) break;
    const data = bytes.subarray(start, end);
    const track = tracks.at(-1);
    switch (element) {
      case TRACK_NUMBER:
        if (track) track.number = readUint(data);
        break;
      case CODEC_ID:
        if (track) track.codec = String.fromCharCode(...data).replace(/\0+$/, "");
        break;
      case CODEC_PRIVATE:
        if (track) track.codecPrivate = data;
        break;
      case CODEC_DELAY:
        if (track) track.codecDelayNs = readUint(data);
        break;
      case CHANNELS:
        if (track) track.channels = readUint(data);
        break;
      case SIMPLE_BLOCK:
      case BLOCK: {
        opus ??= tracks.find((candidate) => candidate.codec === "A_OPUS");
        const block = opus && readBlock(data);
        if (block && block.track === opus?.number) packets.push(...block.frames);
        break;
      }
    }
    pos = end;
  }
  if (!opus) return null;
  const head = isOpusHead(opus.codecPrivate)
    ? opus.codecPrivate
    : opusHead({
        channels: opus.channels ?? 1,
        preSkip: Math.round(((opus.codecDelayNs ?? 0) * OPUS_RATE) / 1e9),
      });
  return oggOpus(head, packets);
}

/**
 * An EBML variable-length integer at `at`: an element ID (marker bit kept) or a size
 * (marker removed; all ones is an unknown size, `value: undefined`).
 */
function readVint(
  bytes: Uint8Array,
  at: number,
  id: boolean,
): { value: number | undefined; length: number } | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (length > (id ? 4 : 8) || at + length > bytes.length) return null;
  let value = id ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[at + i];
    allOnes &&= bytes[at + i] === 0xff;
  }
  return { value: !id && allOnes ? undefined : value, length };
}

function readUint(data: Uint8Array): number {
  let value = 0;
  for (const byte of data) value = value * 256 + byte;
  return value;
}

/** A SimpleBlock's or Block's track and frames (RFC 9559, 10). */
function readBlock(data: Uint8Array): { track: number; frames: Uint8Array[] } | null {
  const track = readVint(data, 0, false);
  if (!track || track.value === undefined) return null;
  let at = track.length + 2; // the track, then a 16-bit timecode
  const flags = data[at++];
  if (flags === undefined) return null;
  const lacing = (flags >> 1) & 3;
  if (lacing === 0) return { track: track.value, frames: [data.subarray(at)] };
  const count = data[at++] + 1;
  const sizes: number[] = [];
  if (lacing === 1) {
    // Xiph lacing: each size is a run of 255s and the byte that ends it.
    for (let i = 0; i < count - 1; i++) {
      let size = 0;
      let byte: number;
      do {
        byte = data[at++];
        size += byte;
      } while (byte === 255);
      sizes.push(size);
    }
  } else if (lacing === 3) {
    // EBML lacing: the first size, then signed differences from the one before.
    const first = readVint(data, at, false);
    if (!first || first.value === undefined) return null;
    sizes.push(first.value);
    at += first.length;
    for (let i = 1; i < count - 1; i++) {
      const delta = readVint(data, at, false);
      if (!delta || delta.value === undefined) return null;
      sizes.push(sizes[i - 1] + delta.value - (2 ** (7 * delta.length - 1) - 1));
      at += delta.length;
    }
  } else {
    // Fixed-size lacing.
    const size = Math.floor((data.length - at) / count);
    for (let i = 0; i < count - 1; i++) sizes.push(size);
  }
  const frames: Uint8Array[] = [];
  for (const size of sizes) {
    frames.push(data.subarray(at, at + size));
    at += size;
  }
  frames.push(data.subarray(at));
  return { track: track.value, frames };
}

// --- Bytes ---

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

function startsWith(bytes: Uint8Array, prefix: readonly number[] | Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
