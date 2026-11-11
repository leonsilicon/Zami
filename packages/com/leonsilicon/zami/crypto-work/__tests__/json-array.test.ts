import { describe, expect, test } from "vite-plus/test";
import { countJsonKey, splitJsonArray } from "#json-array";

const key = (i: number, extra: Record<string, unknown> = {}) => ({
  algorithm: "m.megolm.v1.aes-sha2",
  room_id: `!room${i % 7}:example.org`,
  sender_key: "senderKeyBase64",
  session_id: `session${i}`,
  session_key: "A".repeat(40 + (i % 13)),
  sender_claimed_keys: { ed25519: "edKey" },
  forwarding_curve25519_key_chain: [],
  ...extra,
});

describe("countJsonKey", () => {
  test("counts the keys of a key list without parsing it", async () => {
    const keys = Array.from({ length: 2500 }, (_, i) => key(i));
    expect(await countJsonKey(JSON.stringify(keys), "session_id")).toBe(2500);
    expect(await countJsonKey("[]", "session_id")).toBe(0);
  });

  test("doesn't count the name inside a string value", async () => {
    const keys = [key(1, { note: 'has "session_id": inside' })];
    expect(await countJsonKey(JSON.stringify(keys), "session_id")).toBe(1);
  });
});

describe("splitJsonArray", () => {
  const join = (pieces: { text: string }[]) =>
    pieces.flatMap((p) => JSON.parse(p.text) as unknown[]);

  test("splits a list into pieces of whole elements, in order", async () => {
    const keys = Array.from({ length: 1000 }, (_, i) => key(i));
    const pieces = await splitJsonArray(JSON.stringify(keys), 4096);
    expect(pieces).not.toBeNull();
    expect(pieces!.length).toBeGreaterThan(20);
    expect(pieces!.reduce((n, p) => n + p.count, 0)).toBe(1000);
    expect(join(pieces!)).toEqual(keys);
    for (const p of pieces!) expect(p.text.length).toBeLessThan(4096 + 1024);
  });

  test("splits pretty-printed text with surrounding whitespace", async () => {
    const keys = Array.from({ length: 300 }, (_, i) => key(i));
    const pieces = await splitJsonArray(`\n ${JSON.stringify(keys, null, 2)}\n`, 2048);
    expect(join(pieces!)).toEqual(keys);
  });

  test("keeps a list smaller than a piece whole, and an empty one", async () => {
    expect(await splitJsonArray(JSON.stringify([key(1)]), 4096)).toEqual([
      { text: `[${JSON.stringify(key(1))}]`, count: 1 },
    ]);
    expect(await splitJsonArray("[]", 4096)).toEqual([{ text: "[]", count: 0 }]);
  });

  test("never cuts inside a string: such a list isn't split", async () => {
    // A value holding the element separator, placed where a cut would fall.
    const tricky = Array.from({ length: 50 }, (_, i) =>
      key(i, { note: "x".repeat(i % 5) + '"}, {"' + "y" }),
    );
    const pieces = await splitJsonArray(JSON.stringify(tricky), 64);
    if (pieces) expect(join(pieces)).toEqual(tricky);
    // Separators in strings are escaped quotes, so a cut there can't parse: either the
    // cuts all fell between elements, or the text is refused whole.
  });

  test("refuses text that isn't one JSON array", async () => {
    expect(await splitJsonArray('{"a": 1}', 10)).toBeNull();
    expect(await splitJsonArray("[1, 2] trailing", 10)).toBeNull();
    expect(await splitJsonArray('[{"a": 1}, {"b": ]', 2)).toBeNull();
  });

  test("refuses a cut between objects nested deeper than the list", async () => {
    const nested = [
      { a: [{ x: 1 }, { y: 2 }], session_id: "s1" },
      { a: [{ x: 3 }, { y: 4 }], session_id: "s2" },
    ];
    // Every cut position: a deeper cut leaves brackets unclosed and fails its check.
    for (let target = 1; target < 60; target++) {
      const pieces = await splitJsonArray(JSON.stringify(nested), target);
      if (pieces) expect(join(pieces)).toEqual(nested);
    }
  });
});
