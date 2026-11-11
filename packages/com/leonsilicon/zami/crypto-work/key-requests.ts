// Answering a request for one of our room keys (keyBackfill) without reading the whole key
// store for every request.
//
// The engine can only export keys through `exportRoomKeys(predicate)`, which loads every
// session in the store whatever the predicate says: about 0.3 ms per session in Node with an
// IndexedDB store, so seconds for a large account. Two things keep that rare:
//   - a probe first: one lookup of the requested session, by asking the engine where an
//     event encrypted with it would come from. Most requests are for a session some other
//     device of ours created (the requester asks all of them), or one we don't have.
//   - requests that arrived before an export ran share it.

/** A room key as the engine exports it; only the ids are read here. */
export interface ExportedKey {
  room_id?: unknown;
  session_id?: unknown;
  [field: string]: unknown;
}

/** What `exportRoomKeys`' predicate sees of a stored session. */
export interface SessionInfo {
  sessionId: string;
  roomId: { toString(): string };
  senderKey: { toBase64(): string };
  hasBeenImported(): boolean;
}

/**
 * "own": this device created the session; "not-own": another device did, or we don't have it;
 * "unknown": the probe couldn't tell (the caller exports, as without a probe).
 */
export type ProbeResult = "own" | "not-own" | "unknown";

interface ProbeMachine {
  getRoomEventEncryptionInfo?: (
    this: unknown,
    event: string,
    roomId: unknown,
  ) => Promise<{ senderCurve25519Key?: string; free?(): void } | undefined>;
}

// A well-formed Megolm message (version 3, message index 0, a one-byte ciphertext, an empty
// MAC and signature): enough for the engine to find the session it names, which is all the
// probe asks. It is never decrypted.
const PROBE_CIPHERTEXT = btoa(
  String.fromCharCode(3, 0x08, 0, 0x12, 1, 0, ...Array.from({ length: 72 }, () => 0)),
).replace(/=+$/, "");

/**
 * Which device created a stored room key, from one store lookup. The engine answers through
 * `getRoomEventEncryptionInfo` for an event that names the session; a session we don't hold
 * fails with "Can't find the room key".
 */
export async function probeOwnSession(
  machine: unknown,
  makeRoomId: (roomId: string) => { free?(): void },
  roomId: string,
  sessionId: string,
  ownCurve25519: string,
): Promise<ProbeResult> {
  const probe = (machine as ProbeMachine | null)?.getRoomEventEncryptionInfo;
  if (typeof probe !== "function") return "unknown";
  const event = JSON.stringify({
    type: "m.room.encrypted",
    event_id: "$zami-key-request-probe",
    sender: "@probe:invalid",
    origin_server_ts: 0,
    room_id: roomId,
    content: {
      algorithm: "m.megolm.v1.aes-sha2",
      sender_key: ownCurve25519,
      device_id: "PROBE",
      session_id: sessionId,
      ciphertext: PROBE_CIPHERTEXT,
    },
  });
  const room = makeRoomId(roomId);
  try {
    const info = await probe.call(machine, event, room);
    const sender = info?.senderCurve25519Key;
    info?.free?.();
    if (typeof sender !== "string") return "unknown";
    return sender === ownCurve25519 ? "own" : "not-own";
  } catch (error) {
    return /can't find the room key/i.test(String(error)) ? "not-own" : "unknown";
  } finally {
    room.free?.();
  }
}

export interface OwnKeyExporter {
  /** Note a request when it arrives, so an export that runs before its turn includes it. */
  want(roomId: string, sessionId: string): symbol;
  /**
   * The keys this device created for the request's room and session and didn't import
   * (one, or none). The first request to need an export exports for every request waiting.
   */
  take(ticket: symbol): Promise<ExportedKey[]>;
  /** Forget a request, answered or not, and the key exported for it. */
  release(ticket: symbol): void;
  clear(): void;
}

interface Wanted {
  roomId: string;
  sessionId: string;
  keys?: Promise<ExportedKey[]>;
}

export function createOwnKeyExporter(
  exportRoomKeys: (predicate: (session: SessionInfo) => boolean) => Promise<string>,
  ownCurve25519: () => Promise<string>,
): OwnKeyExporter {
  const waiting = new Map<symbol, Wanted>();
  return {
    want(roomId, sessionId) {
      const ticket = Symbol(sessionId);
      waiting.set(ticket, { roomId, sessionId });
      return ticket;
    },
    take(ticket) {
      const entry = waiting.get(ticket);
      if (!entry) return Promise.resolve([]);
      if (entry.keys) return entry.keys;
      const batch = [...waiting.values()].filter((w) => !w.keys);
      const rooms = new Map<string, Set<string>>();
      for (const w of batch) {
        const set = rooms.get(w.sessionId) ?? new Set<string>();
        set.add(w.roomId);
        rooms.set(w.sessionId, set);
      }
      const exported = (async () => {
        const own = await ownCurve25519();
        return JSON.parse(
          await exportRoomKeys(
            (s) =>
              !!rooms.get(s.sessionId)?.has(s.roomId.toString()) &&
              s.senderKey.toBase64() === own &&
              !s.hasBeenImported(),
          ),
        ) as ExportedKey[];
      })();
      for (const w of batch) {
        w.keys = exported.then((keys) =>
          keys.filter((k) => k.session_id === w.sessionId && k.room_id === w.roomId),
        );
        // A request refused before its turn never takes its keys; its copy of a failed
        // export mustn't be an unhandled rejection.
        w.keys.catch(() => {});
      }
      return entry.keys!;
    },
    release(ticket) {
      waiting.delete(ticket);
    },
    clear() {
      waiting.clear();
    },
  };
}
