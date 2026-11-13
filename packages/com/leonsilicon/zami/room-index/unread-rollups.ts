// Unread roll-ups for groups of rooms (a space's rooms, Home), kept as counts that change
// only when a member room's own state does.

/** One room's unread state, as a roll-up counts it. */
export interface UnreadFlags {
  /** Unread messages, or a count from the server. */
  unread: boolean;
  /** Unread mentions (highlights). */
  highlight: boolean;
}

export interface UnreadGroup {
  /** Member rooms that are unread or have a highlight. */
  readonly unread: number;
  /** Member rooms that have a highlight. */
  readonly highlight: number;
  /** The member room ids. Don't change it. */
  readonly members: ReadonlySet<string>;
}

export interface UnreadRollupsOptions {
  /** A room's current state, or null for an id that is no room (it counts as read). */
  flags: (roomId: string) => UnreadFlags | null;
  /**
   * How long one read, or one turn of the event loop after it, may spend counting rooms
   * (ms). Without it every room is counted when read, however many. With it, a read counts
   * for at most this long, and the rest is counted a slice per turn (`schedule`) until done,
   * then `onCounted` is called: a group's counts can trail its rooms until then, but the
   * first read of a group of thousands of rooms (or a sync that changed them all) doesn't
   * hold up the app.
   */
  sliceMs?: number;
  /** Called when rooms left for later have all been counted, so readers read again. */
  onCounted?: () => void;
  /** How to wait for the next turn (default `setTimeout(run, 0)`), for tests. */
  schedule?: (run: () => void) => void;
  /** Clock, for tests. */
  now?: () => number;
}

export interface UnreadRollups {
  /**
   * The group named `key`. It is built from `members()` on first use, and again after
   * `invalidateStructure()`; until then `members` is not called, so it may be expensive.
   */
  group(key: string, members: () => Iterable<string>): UnreadGroup;
  /** This room's state may have changed: its groups count it again. */
  changed(roomId: string): void;
  /** Which rooms belong to which group may have changed: rebuild groups as they are read. */
  invalidateStructure(): void;
  /** Forget everything (another account). */
  invalidateAll(): void;
  /** Rooms waiting to be counted, for tests. */
  readonly backlog: number;
}

const UNREAD = 1;
const HIGHLIGHT = 2;

interface Group {
  unread: number;
  highlight: number;
  members: Set<string>;
}

function bitsOf(flags: UnreadFlags | null): number {
  if (!flags) return 0;
  // A highlight counts as unread too, as the badges show it.
  return (flags.unread || flags.highlight ? UNREAD : 0) | (flags.highlight ? HIGHLIGHT : 0);
}

/**
 * Counts per group, adjusted as member rooms change: reading a group costs the rooms that
 * changed since the last read, not the group's size. A room's state is asked for once per
 * change, however many groups it is in.
 */
export function createUnreadRollups(options: UnreadRollupsOptions): UnreadRollups {
  const { flags, sliceMs = Infinity, onCounted } = options;
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((run) => void setTimeout(run, 0));
  // Each counted room's state as its groups count it. Kept across structure changes, so
  // rebuilding a group counts from here instead of asking every room again.
  const counted = new Map<string, number>();
  // Rooms to count: new to the groups, or changed since they were counted.
  const queue = new Set<string>();
  const groups = new Map<string, Group>();
  const groupsOfRoom = new Map<string, Group[]>();
  // Bumped by invalidateAll, so a slice scheduled before it does nothing.
  let epoch = 0;
  let scheduled = false;

  const count = (roomId: string) => {
    const before = counted.get(roomId) ?? 0;
    const after = bitsOf(flags(roomId));
    counted.set(roomId, after);
    if (after === before) return;
    const unread = (after & UNREAD) - (before & UNREAD);
    const highlight = ((after & HIGHLIGHT) - (before & HIGHLIGHT)) / HIGHLIGHT;
    for (const group of groupsOfRoom.get(roomId) ?? []) {
      group.unread += unread;
      group.highlight += highlight;
    }
  };

  /** Counts queued rooms for up to `budgetMs`; whether the queue is empty. */
  const drain = (budgetMs: number): boolean => {
    const start = budgetMs === Infinity ? 0 : now();
    for (const roomId of queue) {
      queue.delete(roomId);
      count(roomId);
      if (queue.size > 0 && budgetMs !== Infinity && now() - start >= budgetMs) return false;
    }
    return true;
  };

  const drainLater = () => {
    if (scheduled) return;
    scheduled = true;
    const at = epoch;
    const turn = () => {
      if (at !== epoch) return;
      if (drain(sliceMs)) {
        scheduled = false;
        onCounted?.();
      } else schedule(turn);
    };
    schedule(turn);
  };

  const build = (members: Iterable<string>): Group => {
    const group: Group = { unread: 0, highlight: 0, members: new Set() };
    for (const roomId of members) {
      if (group.members.has(roomId)) continue;
      group.members.add(roomId);
      const bits = counted.get(roomId);
      // Not counted yet: counted below, or later, into this group.
      if (bits === undefined) queue.add(roomId);
      else {
        if (bits & UNREAD) group.unread++;
        if (bits & HIGHLIGHT) group.highlight++;
      }
      const of = groupsOfRoom.get(roomId);
      if (of) of.push(group);
      else groupsOfRoom.set(roomId, [group]);
    }
    return group;
  };

  return {
    group(key, members) {
      let group = groups.get(key);
      if (!group) {
        group = build(members());
        groups.set(key, group);
      }
      if (queue.size > 0 && !scheduled && !drain(sliceMs)) drainLater();
      return group;
    },
    changed(roomId) {
      if (counted.has(roomId)) queue.add(roomId);
    },
    invalidateStructure() {
      // Counts already taken stay; a room queued since is counted into the rebuilt groups.
      groups.clear();
      groupsOfRoom.clear();
    },
    invalidateAll() {
      epoch++;
      scheduled = false;
      queue.clear();
      counted.clear();
      groups.clear();
      groupsOfRoom.clear();
    },
    get backlog() {
      return queue.size;
    },
  };
}
