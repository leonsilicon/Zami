// The home a plugin registers, and where it's written for Zam to open on it: checked
// against the pinned Zam, whose rooms store has to read what `landOnHome` writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zamDir } from "@-/com.leonsilicon.zami.paths";
import { test } from "vite-plus/test";
import {
  clearHome,
  landOnHome,
  pruneHomes,
  readHome,
  writeHome,
  zamScopedKey,
  ZAM_HOME_SPACE,
  ZAM_LAST_ROOMS_KEY,
  ZAM_LAST_SPACE_KEY,
  type HomeStorage,
} from "#home";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage: HomeStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
  return { storage, values };
}

const ALICE = "@alice:example.org";

test("a registered home is read back until it expires", () => {
  const { storage } = memoryStorage();
  assert.equal(readHome(storage, ALICE), null);
  writeHome(storage, ALICE, "leon", { roomId: "!today:example.org", until: 2000 });
  assert.deepEqual(readHome(storage, ALICE, 1999), {
    roomId: "!today:example.org",
    spaceId: null,
    until: 2000,
    pluginId: "leon",
  });
  assert.equal(readHome(storage, ALICE, 2000), null);
  assert.equal(readHome(storage, "@bob:example.org", 0), null);
});

test("a home needs a room", () => {
  const { storage } = memoryStorage();
  assert.throws(() => writeHome(storage, ALICE, "leon", { roomId: "" }), TypeError);
});

test("a plugin clears only its own home", () => {
  const { storage, values } = memoryStorage();
  writeHome(storage, ALICE, "leon", { roomId: "!a:example.org" });
  assert.equal(clearHome(storage, ALICE, "other"), false);
  assert.equal(readHome(storage, ALICE)?.roomId, "!a:example.org");
  assert.equal(clearHome(storage, ALICE, "leon"), true);
  assert.equal(readHome(storage, ALICE), null);
  assert.equal(values.size, 0);
});

test("the homes of accounts that signed out go", () => {
  const { storage } = memoryStorage();
  writeHome(storage, ALICE, "leon", { roomId: "!a:example.org" });
  writeHome(storage, "@bob:example.org", "leon", { roomId: "!b:example.org" });
  pruneHomes(storage, [ALICE]);
  assert.equal(readHome(storage, ALICE)?.roomId, "!a:example.org");
  assert.equal(readHome(storage, "@bob:example.org"), null);
});

test("landing on a home keeps the other spaces' last rooms", () => {
  const roomsKey = zamScopedKey(ZAM_LAST_ROOMS_KEY, ALICE);
  const spaceKey = zamScopedKey(ZAM_LAST_SPACE_KEY, ALICE);
  const { storage, values } = memoryStorage({
    [roomsKey]: JSON.stringify({ [ZAM_HOME_SPACE]: "!old:example.org", "!space": "!kept" }),
    [spaceKey]: "!space",
  });
  const home = writeHome(storage, ALICE, "leon", { roomId: "!today:example.org" });
  landOnHome(storage, ALICE, home);
  assert.deepEqual(JSON.parse(values.get(roomsKey) ?? ""), {
    [ZAM_HOME_SPACE]: "!today:example.org",
    "!space": "!kept",
  });
  // Zam's Home is "no last space".
  assert.equal(values.has(spaceKey), false);

  const inSpace = writeHome(storage, ALICE, "leon", { roomId: "!r", spaceId: "!work" });
  landOnHome(storage, ALICE, inSpace);
  assert.equal(values.get(spaceKey), "!work");
  assert.equal(JSON.parse(values.get(roomsKey) ?? "")["!work"], "!r");
});

test("Zam still keeps its last place where landOnHome writes it", () => {
  const source = (path: string) => readFileSync(join(zamDir(import.meta.dirname), path), "utf8");
  const rooms = source("src/lib/stores/rooms.svelte.ts");
  assert.ok(rooms.includes(`const STORAGE_KEY = "${ZAM_LAST_ROOMS_KEY}";`));
  assert.ok(rooms.includes(`const SPACE_KEY = "${ZAM_LAST_SPACE_KEY}";`));
  assert.ok(rooms.includes(`const HOME_KEY = "${ZAM_HOME_SPACE}";`));
  // The last room of a space is under the space's id, Home's under HOME_KEY; no stored
  // space means Home.
  assert.ok(rooms.includes("map[spaceId ?? HOME_KEY] = roomId;"));
  assert.ok(rooms.includes("return getLastRoom(readScoped(SPACE_KEY, userId), userId);"));
  assert.ok(rooms.includes("removeScoped(SPACE_KEY, auth.userId);"));
  const scoped = source("src/lib/utils/scopedStorage.ts");
  assert.ok(scoped.includes("return userId ? `${base}:${userId}` : base;"));
});
