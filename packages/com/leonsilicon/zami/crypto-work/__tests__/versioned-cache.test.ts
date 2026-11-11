import { describe, expect, test } from "vite-plus/test";
import { createVersionedCache } from "#versioned-cache";

describe("createVersionedCache", () => {
  test("keeps a looked-up value until it's invalidated", () => {
    const cache = createVersionedCache<string, number>();
    const ticket = cache.begin("a");
    expect(cache.set("a", 1, ticket)).toBe(true);
    expect(cache.get("a")).toBe(1);
    cache.invalidate("a");
    expect(cache.has("a")).toBe(false);
  });

  test("refuses a value looked up before an invalidation", () => {
    const cache = createVersionedCache<string, number>();
    const stale = cache.begin("a");
    cache.invalidate("a");
    expect(cache.isCurrent("a", stale)).toBe(false);
    expect(cache.set("a", 1, stale)).toBe(false);
    const fresh = cache.begin("a");
    expect(cache.set("a", 2, fresh)).toBe(true);
    expect(cache.get("a")).toBe(2);
  });

  test("invalidateWhere reaches a key whose first lookup is in flight", () => {
    const cache = createVersionedCache<string, number>();
    const inFlight = cache.begin("@bob DEV");
    cache.invalidateWhere((key) => key.startsWith("@bob "));
    expect(cache.set("@bob DEV", 1, inFlight)).toBe(false);
  });

  test("clear refuses every lookup started before it", () => {
    const cache = createVersionedCache<string, number>();
    const a = cache.begin("a");
    cache.set("b", 2, cache.begin("b"));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.set("a", 1, a)).toBe(false);
  });
});
