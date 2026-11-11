// createIndexSearch must give what the event index's upstream search does
// (src/lib/utils/eventIndex: resolveEntries, then searchEntries over entryMatches), which
// is copied below as the reference, on messy histories: edits in other blocks than their
// originals, orphan edits, duplicates, redactions and equal timestamps.
import { describe, expect, test } from "vite-plus/test";
import { createIndexSearch, prepareEntry, searchBody, type IndexedMessage } from "#index-search";
import { createSlicer } from "#slicer";

const normalize = (text: string): string =>
  text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

// --- The reference: upstream's resolveEntries and searchEntries, as written there. ---

function resolveEntries(
  entries: Iterable<IndexedMessage>,
  redacted: ReadonlySet<string>,
): IndexedMessage[] {
  const originals = new Map<string, IndexedMessage>();
  const latestEdit = new Map<string, IndexedMessage>();
  for (const entry of entries) {
    if (redacted.has(entry.e)) continue;
    if (entry.o) {
      if (redacted.has(entry.o)) continue;
      const prev = latestEdit.get(entry.o);
      if (!prev || prev.t < entry.t) latestEdit.set(entry.o, entry);
    } else {
      originals.set(entry.e, entry);
    }
  }
  const out: IndexedMessage[] = [];
  for (const [id, original] of originals) {
    const edit = latestEdit.get(id);
    out.push(edit ? { ...original, b: edit.b, m: edit.m || original.m } : original);
    latestEdit.delete(id);
  }
  for (const [target, edit] of latestEdit) out.push({ ...edit, e: target, o: undefined });
  return out.sort((a, b) => b.t - a.t);
}

interface Query {
  words: string[];
  sender?: string;
}

function referenceMatches(entry: IndexedMessage, query: Query): boolean {
  if (query.words.length > 0) {
    const body = normalize(entry.b);
    if (!query.words.every((w) => body.includes(w))) return false;
  }
  return query.sender === undefined || entry.s === query.sender;
}

function searchEntries(entries: IndexedMessage[], query: Query, limit = 500): IndexedMessage[] {
  const out: IndexedMessage[] = [];
  for (const entry of entries) {
    if (referenceMatches(entry, query)) {
      out.push(entry);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// --- Histories. ---

/** Reproducible pseudo-random numbers in [0, 1). */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
}

const WORDS = ["café", "Meeting", "tomorrow", "ÉCOLE", "東京", "lunch", "ﬁle", "naïve", "ok"];
const SENDERS = ["@amy:x", "@bob:x", "@cat:x"];

/** A room's index as searchLocalIndex reads it: the tail, then blocks newest first. */
function history(seed: number, messages: number) {
  const next = random(seed);
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
  const body = () =>
    Array.from({ length: 1 + Math.floor(next() * 4) }, () => pick(WORDS)).join(" ");
  const entries: IndexedMessage[] = [];
  const ids: string[] = [];
  for (let i = 0; i < messages; i++) {
    // Coarse timestamps, so ties happen.
    const t = Math.floor(i / 3) * 10 + Math.floor(next() * 5);
    const roll = next();
    if (roll < 0.15 && ids.length > 0) {
      // An edit of an earlier message, or of one that isn't indexed.
      const target = next() < 0.8 ? pick(ids) : `$missing${Math.floor(next() * 20)}`;
      entries.push({
        e: `$edit${i}`,
        s: pick(SENDERS),
        t,
        m: pick(["m.text", ""]),
        b: body(),
        o: target,
      });
    } else if (roll < 0.2 && ids.length > 0) {
      // A second copy of a message (a crawled page overlapping the live feed).
      const copy = entries.find((entry) => entry.e === pick(ids));
      if (copy) entries.push({ ...copy });
    } else {
      const e = `$${i}`;
      ids.push(e);
      entries.push({ e, s: pick(SENDERS), t, m: pick(["m.text", "m.notice"]), b: body() });
    }
  }
  const redacted = new Set(ids.filter(() => next() < 0.05));
  redacted.add("$missing3");
  // Shuffle a little: crawled blocks interleave with live ones.
  const blocks: IndexedMessage[][] = [];
  for (let at = 0; at < entries.length; at += 25) blocks.push(entries.slice(at, at + 25));
  blocks.sort(() => next() - 0.5);
  const tail = blocks.pop() ?? [];
  return { tail, blocks, redacted };
}

function clone(entries: IndexedMessage[]): IndexedMessage[] {
  return entries.map((entry) => ({ ...entry }));
}

const QUERIES: Query[] = [
  { words: [] },
  { words: ["cafe"] },
  { words: ["ecole", "meet"] },
  { words: ["東京"] },
  { words: ["file"] },
  { words: ["naive"], sender: "@bob:x" },
  { words: ["zzz"] },
  { words: [], sender: "@cat:x" },
];

describe("createIndexSearch", () => {
  test("gives what resolveEntries then searchEntries give", async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { tail, blocks, redacted } = history(seed, 600);
      const all = [...tail, ...blocks.flat()];
      for (const query of QUERIES) {
        for (const limit of [500, 7]) {
          const expected = searchEntries(resolveEntries(clone(all), redacted), query, limit);
          for (const prepared of [true, false]) {
            const search = createIndexSearch<IndexedMessage>({
              redacted,
              normalize,
              matches: (entry, body) =>
                (query.words.length === 0 || query.words.every((w) => body.includes(w))) &&
                (query.sender === undefined || entry.s === query.sender),
              limit,
            });
            for (const batch of [tail, ...blocks]) {
              const entries = clone(batch);
              if (prepared) for (const entry of entries) prepareEntry(entry, normalize);
              await search.add(entries, prepared);
            }
            const strip = (entry: IndexedMessage) => ({ ...entry, n: undefined });
            expect((await search.results()).map(strip)).toEqual(expected.map(strip));
          }
        }
      }
    }
  });

  test("gives partial results and then the full ones", async () => {
    const { tail, blocks, redacted } = history(9, 300);
    const search = createIndexSearch<IndexedMessage>({
      redacted,
      normalize,
      matches: () => true,
    });
    await search.add(clone(tail), false);
    const partial = await search.results();
    expect(partial.length).toBeGreaterThan(0);
    for (const block of blocks) await search.add(clone(block), false);
    const all = [...tail, ...blocks.flat()];
    const strip = (entry: IndexedMessage) => ({ ...entry, n: undefined });
    expect((await search.results()).map(strip)).toEqual(
      searchEntries(resolveEntries(clone(all), redacted), { words: [] }).map(strip),
    );
  });

  test("gives the event loop turns as it goes", async () => {
    const { tail, blocks, redacted } = history(11, 400);
    let clock = 0;
    let turns = 0;
    const slicer = createSlicer({
      sliceMs: 5,
      now: () => clock++,
      schedule: (run) => {
        turns++;
        setTimeout(run, 0);
      },
    });
    const search = createIndexSearch<IndexedMessage>({
      redacted,
      normalize,
      matches: () => true,
      slicer,
    });
    for (const batch of [tail, ...blocks]) await search.add(clone(batch), false);
    const afterAdding = turns;
    expect(afterAdding).toBeGreaterThan(10);
    await search.results();
    expect(turns).toBeGreaterThan(afterAdding);
  });
});

describe("prepareEntry", () => {
  test("stores the search body only when it isn't the body in lower case", () => {
    const plain: IndexedMessage = { e: "$1", s: "@a:x", t: 1, m: "m.text", b: "Hello There" };
    prepareEntry(plain, normalize);
    expect(plain.n).toBeUndefined();
    expect(searchBody(plain)).toBe("hello there");
    const accented: IndexedMessage = { e: "$2", s: "@a:x", t: 1, m: "m.text", b: "Café ﬁle" };
    prepareEntry(accented, normalize);
    expect(accented.n).toBe("cafe file");
    expect(searchBody(accented)).toBe(normalize(accented.b));
    // Edited back to plain text: the stale search body goes.
    accented.b = "plain";
    prepareEntry(accented, normalize);
    expect(accented.n).toBeUndefined();
  });
});
