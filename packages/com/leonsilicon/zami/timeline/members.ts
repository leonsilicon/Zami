// A room's full member list: loaded a slice at a time, and searched through an index
// built once rather than lowercasing every member per keystroke.

import { forEachSliced } from "#sliced";

/** The out-of-band member calls of matrix-js-sdk's RoomState this loader makes. */
export interface OutOfBandMemberState<E> {
  markOutOfBandMembersStarted(): void;
  markOutOfBandMembersFailed(): void;
  setOutOfBandMember(event: E): void;
  setOutOfBandMembers(events: E[]): void;
}

/** The parts of matrix-js-sdk's Room the loader uses (`membersPromise` is private there). */
export interface SlicedMembersRoom<E> {
  readonly currentState: OutOfBandMemberState<E>;
  loadMembersFromServer(): Promise<object[]>;
  recalculate(): void;
  membersPromise?: Promise<boolean>;
}

export interface LoadMembersOptions<E> {
  /** A raw member event from `/members` as the SDK's event (the client's event mapper). */
  mapEvent: (raw: object) => E;
  /** How long one slice of applying members may run (ms). */
  sliceMs?: number;
  /** For tests. */
  now?: () => number;
  schedule?: (run: () => void) => void;
}

const unsafeProp = (prop: unknown) =>
  prop === "__proto__" || prop === "prototype" || prop === "constructor";

/** matrix-js-sdk's `noUnsafeEventProps`. */
function safeEvent(raw: object): boolean {
  const e = raw as { room_id?: unknown; sender?: unknown; event_id?: unknown };
  return !(unsafeProp(e.room_id) || unsafeProp(e.sender) || unsafeProp(e.event_id));
}

/**
 * matrix-js-sdk's `Room.loadMembersIfNeeded`, without its two costs for a large room:
 * it applies the members a slice at a time (the SDK turns every member into an event,
 * sets it on the room state and emits for it, all in one go), and it doesn't write them
 * to the sync store (the SDK puts one record per member there, which the next launch
 * then reads back whole). It always asks the server, as the SDK does for an encrypted
 * room.
 *
 * Shares the room's `membersPromise` with the SDK both ways: a load already under way
 * (the SDK's or this one) is returned as is, and the SDK's own callers (encryption,
 * leaving the room) wait for this one. Resolves `true` (members came from the server),
 * as the SDK's does.
 */
export function loadMembersInSlices<E>(
  room: SlicedMembersRoom<E>,
  options: LoadMembersOptions<E>,
): Promise<boolean> {
  if (room.membersPromise) return room.membersPromise;
  // Incoming member events now count as newer than the list on its way.
  room.currentState.markOutOfBandMembersStarted();
  const load = (async () => {
    const raw = await room.loadMembersFromServer();
    await forEachSliced(
      raw,
      (event) => {
        // Read each time: a reset of the live timeline swaps the room state, and the
        // new one carries over what was set on the old.
        if (safeEvent(event)) room.currentState.setOutOfBandMember(options.mapEvent(event));
      },
      { sliceMs: options.sliceMs ?? 8, now: options.now, schedule: options.schedule },
    );
    // Marks the load finished (with nothing more to set) and tells the listeners.
    room.currentState.setOutOfBandMembers([]);
    // The room name may come from its members.
    room.recalculate();
    return true;
  })();
  room.membersPromise = load;
  load.catch(() => {
    // Let the next caller try again, as the SDK does.
    if (room.membersPromise === load) room.membersPromise = undefined;
    room.currentState.markOutOfBandMembersFailed();
  });
  return load;
}

export interface IndexedMember {
  userId: string;
  rawDisplayName?: string;
}

/**
 * Members with their user ids and display names lowercased once, for the composer's
 * mention search and mention decoration.
 */
export class MemberIndex<M extends IndexedMember> {
  readonly members: readonly M[];
  private readonly ids: string[];
  private readonly names: string[];
  private readonly exactIds: Set<string>;
  private readonly lowerNames: Set<string>;
  private trimmedNames: Map<string, number> | null = null;
  private readonly tokens = new Map<string, boolean>();

  constructor(members: readonly M[]) {
    this.members = members;
    this.ids = members.map((m) => m.userId.toLowerCase());
    this.names = members.map((m) => (m.rawDisplayName ?? "").toLowerCase());
    this.exactIds = new Set(members.map((m) => m.userId));
    this.lowerNames = new Set(this.names);
  }

  /**
   * The first `limit` members, in order, other than `excludeUserId`, whose user id or
   * display name contains `query` (any case).
   */
  search(query: string, excludeUserId: string | null, limit: number): M[] {
    const q = query.toLowerCase();
    const found: M[] = [];
    for (let i = 0; i < this.members.length && found.length < limit; i++) {
      const member = this.members[i]!;
      if (member.userId === excludeUserId) continue;
      if (this.ids[i]!.includes(q) || this.names[i]!.includes(q)) found.push(member);
    }
    return found;
  }

  /**
   * Whether `@token` (as typed, trailing punctuation allowed) names a member: their
   * exact user id, part of a user id, or a whole display name (any case).
   */
  matchesToken(token: string): boolean {
    let known = this.tokens.get(token);
    if (known !== undefined) return known;
    const name = token
      .slice(1)
      .replace(/[.,!?;:]$/, "")
      .toLowerCase();
    known =
      this.exactIds.has(token) ||
      this.lowerNames.has(name) ||
      this.ids.some((id) => id.includes(name));
    this.tokens.set(token, known);
    return known;
  }

  /** How many members' display names are `name` once trimmed (any case). */
  countSharingName(name: string): number {
    if (!this.trimmedNames) {
      this.trimmedNames = new Map();
      for (const m of this.members) {
        const key = (m.rawDisplayName ?? "").trim().toLowerCase();
        this.trimmedNames.set(key, (this.trimmedNames.get(key) ?? 0) + 1);
      }
    }
    return this.trimmedNames.get(name.toLowerCase()) ?? 0;
  }
}
