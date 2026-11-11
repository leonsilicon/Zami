import { describe, expect, test } from "vite-plus/test";
import { type CacheProgress, type CacheRequest, createMediaCache } from "#cache";
import { createLimiter } from "#limiter";
import { fakeNative, settle } from "./helpers.ts";

const DIRECTORY = "file:///cache/media/acct/";

function setup(concurrency = 4) {
  const fake = fakeNative();
  const cache = createMediaCache({
    native: fake.native,
    files: {
      exists: (uri) => fake.native.exists(uri),
      move: (from, to) => fake.native.move(from, to),
    },
    directory: DIRECTORY,
    maxBytes: 1000,
    concurrency,
  });
  return { ...fake, cache };
}

function request(key: string, extra: Partial<CacheRequest> = {}): CacheRequest {
  return {
    key,
    url: `https://hs.example/_matrix/client/v1/media/download/hs.example/${key}`,
    headers: { Authorization: "Bearer t" },
    extension: () => ".jpg",
    httpError: (status) => new Error(`HTTP ${status}`),
    ...extra,
  };
}

describe("the media cache", () => {
  test("downloads once into a file named for the attachment, then serves it from disk", async () => {
    const { cache, pending, files } = setup();
    const cipher = { key: "k", iv: "i", sha256: "h" };
    const first = cache.fetch(request("e1", { cipher }));
    await settle();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.request).toMatchObject({
      dest: `${DIRECTORY}e1`,
      headers: { Authorization: "Bearer t" },
      key: "k",
      iv: "i",
      sha256: "h",
    });
    pending[0]?.finish({ size: 10 });
    expect(await first).toBe(`${DIRECTORY}e1.jpg`);
    expect(files.has(`${DIRECTORY}e1.jpg`)).toBe(true);
    expect(files.has(`${DIRECTORY}e1`)).toBe(false);
    expect(cache.cached("e1")).toBe(`${DIRECTORY}e1.jpg`);
    expect(await cache.fetch(request("e1"))).toBe(`${DIRECTORY}e1.jpg`);
    expect(pending).toHaveLength(1);
  });

  test("knows the files earlier runs left, as pruned", async () => {
    const fake = fakeNative();
    fake.setPruneResult(["eold.mp4", "pother"]);
    fake.files.set(`${DIRECTORY}eold.mp4`, new Uint8Array(1));
    fake.files.set(`${DIRECTORY}pother`, new Uint8Array(1));
    const fresh = createMediaCache({
      native: fake.native,
      files: {
        exists: (uri) => fake.native.exists(uri),
        move: (from, to) => fake.native.move(from, to),
      },
      directory: DIRECTORY,
      maxBytes: 1000,
      concurrency: 4,
    });
    await settle();
    expect(fresh.cached("eold")).toBe(`${DIRECTORY}eold.mp4`);
    expect(fresh.cached("pother")).toBe(`${DIRECTORY}pother`);
    // Cleared by the system since: forgotten.
    fake.files.delete(`${DIRECTORY}eold.mp4`);
    expect(fresh.cached("eold")).toBeNull();
  });

  test("one download serves everyone asking, with progress for each", async () => {
    const { cache, pending } = setup();
    const seen: CacheProgress[][] = [[], []];
    const a = cache.fetch(request("e2", { onProgress: (p) => seen[0]?.push(p) }));
    const b = cache.fetch(
      request("e2", { expectedSize: 100, onProgress: (p) => seen[1]?.push(p) }),
    );
    await settle();
    expect(pending).toHaveLength(1);
    pending[0]?.progress(40, -1);
    pending[0]?.finish({ size: 100 });
    expect(await a).toBe(await b);
    // No Content-Length: the event's size stands in, for whoever gave one.
    expect(seen[0]).toContainEqual({ loaded: 40, total: null });
    expect(seen[1]).toContainEqual({ loaded: 40, total: 100 });
    expect(seen[1]?.at(-1)).toEqual({ loaded: 100, total: 100 });
  });

  test("a download stops only once nobody wants it", async () => {
    const { cache, pending, cancelled } = setup();
    const first = new AbortController();
    const second = new AbortController();
    const a = cache.fetch(request("e3", { signal: first.signal }));
    const b = cache.fetch(request("e3", { signal: second.signal }));
    await settle();
    first.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toEqual([]);
    second.abort();
    await expect(b).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveLength(1);
    // Asking again starts a new download.
    const again = cache.fetch(request("e3"));
    await settle();
    expect(pending).toHaveLength(1);
    pending[0]?.finish();
    expect(await again).toBe(`${DIRECTORY}e3.jpg`);
  });

  test("an aborted signal never starts anything", async () => {
    const { cache, pending } = setup();
    const aborted = AbortSignal.abort();
    await expect(cache.fetch(request("e4", { signal: aborted }))).rejects.toMatchObject({
      name: "AbortError",
    });
    await settle();
    expect(pending).toHaveLength(0);
  });

  test("a response that isn't 2xx is the caller's error, and leaves no file", async () => {
    const { cache, pending, files } = setup();
    const result = cache.fetch(request("e5"));
    await settle();
    pending[0]?.finish({ status: 404 });
    await expect(result).rejects.toThrow("HTTP 404");
    expect(cache.cached("e5")).toBeNull();
    expect([...files.keys()].some((uri) => uri.includes("e5"))).toBe(false);
  });

  test("names a plain download for its Content-Type", async () => {
    const { cache, pending } = setup();
    const result = cache.fetch(
      request("p1", { extension: (type) => (type === "video/mp4" ? ".mp4" : "") }),
    );
    await settle();
    pending[0]?.finish({ contentType: "video/mp4" });
    expect(await result).toBe(`${DIRECTORY}p1.mp4`);
  });

  test("runs a few at a time, the newest first", async () => {
    const { cache, pending } = setup(2);
    const results = ["a", "b", "c", "d"].map((key) => cache.fetch(request(key)));
    await settle();
    expect(pending.map((download) => download.request.dest)).toEqual([
      `${DIRECTORY}a`,
      `${DIRECTORY}b`,
    ]);
    pending.shift()?.finish();
    await settle();
    // d was asked for last, so it goes before c.
    expect(pending.map((download) => download.request.dest)).toEqual([
      `${DIRECTORY}b`,
      `${DIRECTORY}d`,
    ]);
    for (const download of pending.splice(0)) download.finish();
    await settle();
    pending.shift()?.finish();
    await Promise.all(results);
  });
});

describe("the limiter", () => {
  test("never runs a cancelled task, and keeps to its cap", async () => {
    const limiter = createLimiter(1);
    let release: () => void = () => {};
    const first = limiter.run(() => new Promise<void>((resolve) => (release = resolve)));
    let ran = false;
    const second = limiter.run(
      async () => {
        ran = true;
      },
      () => new Error("cancelled"),
    );
    expect(limiter.running).toBe(1);
    expect(limiter.waiting).toBe(1);
    release();
    await first;
    await expect(second).rejects.toThrow("cancelled");
    expect(ran).toBe(false);
    expect(limiter.running).toBe(0);
  });
});
