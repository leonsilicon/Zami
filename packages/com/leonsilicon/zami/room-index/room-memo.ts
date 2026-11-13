// A per-room memo: a value computed from a room, kept until the room changes.

export interface RoomMemoOptions<R, V> {
  /** The room's id, which `invalidate` names it by. */
  idOf: (room: R) => string;
  /** How many values `fingerprint` writes. */
  fingerprintSize: number;
  /**
   * Writes cheap reads that `compute`'s answer depends on into `out` (`out[0]` to
   * `out[fingerprintSize - 1]`), such as the timeline object, its length and its newest
   * event. When any of them differs from the last computation (`Object.is`), the value is
   * computed again, so a change that no event reported is still seen.
   */
  fingerprint: (room: R, out: unknown[]) => void;
  compute: (room: R) => V;
}

export interface RoomMemo<R, V> {
  /** The value for `room`, computed again only if it was invalidated or its fingerprint changed. */
  get(room: R): V;
  /** Computes this room's value again on the next `get`. */
  invalidate(roomId: string): void;
  /** Computes every room's value again on its next `get`. */
  invalidateAll(): void;
  /** How many rooms have a value kept, for tests. */
  readonly size: number;
}

interface Entry<R, V> {
  room: R;
  fingerprint: unknown[];
  value: V;
}

/**
 * Keeps `compute(room)` per room id until `invalidate(roomId)`, `invalidateAll()`, a
 * different object for the same id (a cached stand-in replaced by the live room), or a
 * change in the room's fingerprint.
 */
export function createRoomMemo<R, V>(options: RoomMemoOptions<R, V>): RoomMemo<R, V> {
  const { idOf, fingerprintSize, fingerprint, compute } = options;
  const entries = new Map<string, Entry<R, V>>();
  // Reused by every `get`: a hit allocates nothing.
  const scratch: unknown[] = Array.from({ length: fingerprintSize });

  const matches = (entry: Entry<R, V>) => {
    for (let i = 0; i < fingerprintSize; i++)
      if (!Object.is(entry.fingerprint[i], scratch[i])) return false;
    return true;
  };

  return {
    get(room) {
      const id = idOf(room);
      fingerprint(room, scratch);
      const entry = entries.get(id);
      if (entry && entry.room === room && matches(entry)) return entry.value;
      // Copied before computing, which might read another room and reuse `scratch`.
      const kept = scratch.slice();
      const value = compute(room);
      entries.set(id, { room, fingerprint: kept, value });
      return value;
    },
    invalidate(roomId) {
      entries.delete(roomId);
    },
    invalidateAll() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
