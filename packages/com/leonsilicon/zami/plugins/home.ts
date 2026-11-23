// `zam.zami.app.home`: a plugin registers the room an account opens on at its next
// launch. We write the registered home where Zam's rooms store reads its last location.

/** What a plugin registers. */
export interface HomeOptions {
  /** The room to open on. */
  roomId: string;
  /** The space to show it in; Zam's own Home (no space) when left out. */
  spaceId?: string | null;
  /** When it stops being the home (ms since the epoch): a room for one day, say. */
  until?: number;
}

export interface Home {
  roomId: string;
  spaceId: string | null;
  until: number | null;
  /** The plugin that registered it. */
  pluginId: string;
}

/** The parts of `localStorage` used here. */
export type HomeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const HOMES_KEY = "zami_home";

// Zam's rooms store (`src/lib/stores/rooms.svelte.ts`) and its per-account keys
// (`src/lib/utils/scopedStorage.ts`). `__tests__/home.test.ts` checks them against the
// pinned Zam, so a change upstream fails there, not silently at launch.
export const ZAM_LAST_ROOMS_KEY = "matrix_last_room_by_space";
export const ZAM_LAST_SPACE_KEY = "matrix_last_space";
export const ZAM_HOME_SPACE = "__home__";

export function zamScopedKey(base: string, userId: string): string {
  return `${base}:${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(storage: HomeStorage, key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseHome(value: unknown): Home | null {
  if (!isRecord(value)) return null;
  const { roomId, spaceId, until, pluginId } = value;
  if (typeof roomId !== "string" || !roomId || typeof pluginId !== "string") return null;
  return {
    roomId,
    spaceId: typeof spaceId === "string" && spaceId ? spaceId : null,
    until: typeof until === "number" && Number.isFinite(until) ? until : null,
    pluginId,
  };
}

/** The account's home, unless it has expired. */
export function readHome(storage: HomeStorage, userId: string, now = Date.now()): Home | null {
  const home = parseHome(readJson(storage, HOMES_KEY)[userId]);
  if (!home || (home.until !== null && home.until <= now)) return null;
  return home;
}

export function writeHome(
  storage: HomeStorage,
  userId: string,
  pluginId: string,
  options: HomeOptions,
): Home {
  if (typeof options?.roomId !== "string" || !options.roomId) {
    throw new TypeError("zam.zami.app.home.set needs a roomId");
  }
  const home: Home = {
    roomId: options.roomId,
    spaceId: options.spaceId || null,
    until:
      typeof options.until === "number" && Number.isFinite(options.until) ? options.until : null,
    pluginId,
  };
  storage.setItem(HOMES_KEY, JSON.stringify({ ...readJson(storage, HOMES_KEY), [userId]: home }));
  return home;
}

/** Removes the account's home; with `pluginId`, only if that plugin registered it. */
export function clearHome(storage: HomeStorage, userId: string, pluginId?: string): boolean {
  const homes = readJson(storage, HOMES_KEY);
  const home = parseHome(homes[userId]);
  if (!home || (pluginId !== undefined && home.pluginId !== pluginId)) return false;
  delete homes[userId];
  if (Object.keys(homes).length === 0) storage.removeItem(HOMES_KEY);
  else storage.setItem(HOMES_KEY, JSON.stringify(homes));
  return true;
}

/** Removes the homes of accounts that aren't signed in here any more. */
export function pruneHomes(storage: HomeStorage, userIds: readonly string[]): void {
  const homes = readJson(storage, HOMES_KEY);
  const kept = Object.fromEntries(Object.entries(homes).filter(([id]) => userIds.includes(id)));
  if (Object.keys(kept).length === Object.keys(homes).length) return;
  if (Object.keys(kept).length === 0) storage.removeItem(HOMES_KEY);
  else storage.setItem(HOMES_KEY, JSON.stringify(kept));
}

/**
 * Makes the home the place Zam opens on: its last space, and that space's last room. Called
 * before Zam's rooms store loads (it reads them as it starts, and so does the restore, for
 * the room whose messages it decrypts first).
 */
export function landOnHome(storage: HomeStorage, userId: string, home: Home): void {
  const roomsKey = zamScopedKey(ZAM_LAST_ROOMS_KEY, userId);
  const rooms = readJson(storage, roomsKey);
  rooms[home.spaceId ?? ZAM_HOME_SPACE] = home.roomId;
  storage.setItem(roomsKey, JSON.stringify(rooms));
  const spaceKey = zamScopedKey(ZAM_LAST_SPACE_KEY, userId);
  if (home.spaceId === null) storage.removeItem(spaceKey);
  else storage.setItem(spaceKey, home.spaceId);
}
