/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
  isWebM,
  oggCrc,
  oggOpus,
  opusHead,
  opusHeadPreSkip,
  opusPacketSamples,
  webmOpusToOgg,
} from "#opus";

// Made with FFmpeg: a 0.3 s sine in Opus, as WebM (the mono one written live, with a
// Segment and Clusters of unknown size, as MediaRecorder writes them) and remuxed to Ogg.
function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
}

interface OggPage {
  flags: number;
  granule: number;
  sequence: number;
  crcOk: boolean;
}

/** Reads an Ogg stream's pages and packets, checking each page's CRC. */
function readOgg(bytes: Uint8Array): { pages: OggPage[]; packets: Uint8Array[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages: OggPage[] = [];
  const packets: Uint8Array[] = [];
  let partial: number[] = [];
  let at = 0;
  while (at < bytes.length) {
    expect(String.fromCharCode(...bytes.subarray(at, at + 4))).toBe("OggS");
    const segments = bytes[at + 26];
    const length =
      27 + segments + bytes.subarray(at + 27, at + 27 + segments).reduce((a, b) => a + b, 0);
    const page = bytes.slice(at, at + length);
    const stored = new DataView(page.buffer).getUint32(22, true);
    page.fill(0, 22, 26);
    pages.push({
      flags: bytes[at + 5],
      granule: view.getUint32(at + 6, true) + view.getUint32(at + 10, true) * 2 ** 32,
      sequence: view.getUint32(at + 18, true),
      crcOk: oggCrc(page) === stored,
    });
    let body = at + 27 + segments;
    for (let i = 0; i < segments; i++) {
      const lace = bytes[at + 27 + i];
      partial.push(...bytes.subarray(body, body + lace));
      body += lace;
      if (lace < 255) {
        packets.push(Uint8Array.from(partial));
        partial = [];
      }
    }
    at += length;
  }
  return { pages, packets };
}

describe("opusPacketSamples", () => {
  test("reads the frame size and count from the TOC byte", () => {
    // CELT 20 ms (config 31), one frame.
    expect(opusPacketSamples(Uint8Array.of(31 << 3))).toBe(960);
    // SILK 60 ms (config 3), two frames (code 1).
    expect(opusPacketSamples(Uint8Array.of((3 << 3) | 1))).toBe(5760);
    // Hybrid 10 ms (config 12), code 3 with five frames.
    expect(opusPacketSamples(Uint8Array.of((12 << 3) | 3, 5))).toBe(2400);
    // CELT 2.5 ms (config 16), two frames of different sizes (code 2).
    expect(opusPacketSamples(Uint8Array.of((16 << 3) | 2))).toBe(240);
    expect(opusPacketSamples(new Uint8Array())).toBe(0);
  });
});

describe("oggCrc", () => {
  test("matches the CRC of FFmpeg's pages", () => {
    const { pages } = readOgg(fixture("opus-mono-live.ogg"));
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.every((page) => page.crcOk)).toBe(true);
  });
});

describe("oggOpus", () => {
  test("writes header pages, then the packets with their granule positions", () => {
    const head = opusHead({ channels: 2, preSkip: 312 });
    expect(opusHeadPreSkip(head)).toBe(312);
    const packets = Array.from({ length: 120 }, (_, i) =>
      Uint8Array.from({ length: 1 + (i % 7) * 100 }, (_, j) => (j === 0 ? 31 << 3 : i)),
    );
    const { pages, packets: read } = readOgg(oggOpus(head, packets));
    expect(read[0]).toEqual(head);
    expect(String.fromCharCode(...read[1].subarray(0, 8))).toBe("OpusTags");
    expect(read.slice(2)).toEqual(packets);
    expect(pages.every((page) => page.crcOk)).toBe(true);
    expect(pages.map((page) => page.sequence)).toEqual(pages.map((_, i) => i));
    expect(pages[0].flags).toBe(0x02);
    expect(pages.at(-1)?.flags).toBe(0x04);
    expect(pages.at(-1)?.granule).toBe(120 * 960);
    // Granule positions only grow.
    const granules = pages.map((page) => page.granule);
    expect([...granules].sort((a, b) => a - b)).toEqual(granules);
  });

  test("laces a packet whose length is a multiple of 255", () => {
    const packet = new Uint8Array(510).fill(7);
    packet[0] = 31 << 3;
    const { packets } = readOgg(oggOpus(opusHead({ channels: 1 }), [packet]));
    expect(packets[2]).toEqual(packet);
  });
});

describe("webmOpusToOgg", () => {
  for (const name of ["opus-mono-live", "opus-stereo"]) {
    test(`rewraps ${name}.webm as FFmpeg does`, () => {
      const webm = fixture(`${name}.webm`);
      expect(isWebM(webm)).toBe(true);
      const ogg = webmOpusToOgg(webm);
      expect(ogg).not.toBeNull();
      const ours = readOgg(ogg!);
      const ffmpeg = readOgg(fixture(`${name}.ogg`));
      expect(ours.pages.every((page) => page.crcOk)).toBe(true);
      // The same OpusHead (WebM's CodecPrivate) and the same audio packets.
      expect(ours.packets[0]).toEqual(ffmpeg.packets[0]);
      expect(ours.packets.slice(2)).toEqual(ffmpeg.packets.slice(2));
      const samples = ours.packets.slice(2).reduce((sum, p) => sum + opusPacketSamples(p), 0);
      expect(ours.pages.at(-1)?.granule).toBe(samples);
    });
  }

  test("returns null for what isn't WebM Opus", () => {
    expect(webmOpusToOgg(fixture("opus-stereo.ogg"))).toBeNull();
    expect(isWebM(fixture("opus-stereo.ogg"))).toBe(false);
  });
});
