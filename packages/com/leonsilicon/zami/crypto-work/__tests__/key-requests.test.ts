import { describe, expect, test } from "vite-plus/test";
import { createOwnKeyExporter, probeOwnSession, type SessionInfo } from "#key-requests";

const OWN = "ownCurve";

function store(
  sessions: { sessionId: string; roomId: string; senderKey: string; imported?: boolean }[],
) {
  let exports = 0;
  const exportRoomKeys = async (predicate: (s: SessionInfo) => boolean) => {
    exports++;
    return JSON.stringify(
      sessions
        .filter((s) =>
          predicate({
            sessionId: s.sessionId,
            roomId: { toString: () => s.roomId },
            senderKey: { toBase64: () => s.senderKey },
            hasBeenImported: () => !!s.imported,
          }),
        )
        .map((s) => ({ session_id: s.sessionId, room_id: s.roomId, sender_key: s.senderKey })),
    );
  };
  return { exportRoomKeys, exports: () => exports };
}

describe("createOwnKeyExporter", () => {
  test("requests waiting together share one export", async () => {
    const s = store([
      { sessionId: "S1", roomId: "!a", senderKey: OWN },
      { sessionId: "S2", roomId: "!b", senderKey: OWN },
      { sessionId: "S3", roomId: "!a", senderKey: "other" },
      { sessionId: "S4", roomId: "!a", senderKey: OWN, imported: true },
    ]);
    const exporter = createOwnKeyExporter(s.exportRoomKeys, async () => OWN);
    const t1 = exporter.want("!a", "S1");
    const t2 = exporter.want("!b", "S2");
    const t3 = exporter.want("!a", "S3");
    const t4 = exporter.want("!a", "S4");
    const t5 = exporter.want("!b", "S1");
    expect((await exporter.take(t1)).map((k) => k.session_id)).toEqual(["S1"]);
    expect((await exporter.take(t2)).map((k) => k.session_id)).toEqual(["S2"]);
    // Created by another device, imported, or asked for in the wrong room: nothing.
    expect(await exporter.take(t3)).toEqual([]);
    expect(await exporter.take(t4)).toEqual([]);
    expect(await exporter.take(t5)).toEqual([]);
    expect(s.exports()).toBe(1);
  });

  test("a request that arrives after an export gets its own", async () => {
    const s = store([{ sessionId: "S1", roomId: "!a", senderKey: OWN }]);
    const exporter = createOwnKeyExporter(s.exportRoomKeys, async () => OWN);
    const t1 = exporter.want("!a", "S1");
    await exporter.take(t1);
    exporter.release(t1);
    const t2 = exporter.want("!a", "S1");
    expect(await exporter.take(t2)).toHaveLength(1);
    expect(s.exports()).toBe(2);
  });

  test("a released request is forgotten", async () => {
    const s = store([{ sessionId: "S1", roomId: "!a", senderKey: OWN }]);
    const exporter = createOwnKeyExporter(s.exportRoomKeys, async () => OWN);
    const t1 = exporter.want("!a", "S1");
    exporter.release(t1);
    expect(await exporter.take(t1)).toEqual([]);
    expect(s.exports()).toBe(0);
  });
});

describe("probeOwnSession", () => {
  const roomId = () => ({ free() {} });

  test("asks for the session named in the request", async () => {
    let asked: Record<string, unknown> | null = null;
    const machine = {
      getRoomEventEncryptionInfo: async (event: string) => {
        asked = JSON.parse(event) as Record<string, unknown>;
        return { senderCurve25519Key: OWN, free() {} };
      },
    };
    expect(await probeOwnSession(machine, roomId, "!a", "S1", OWN)).toBe("own");
    expect(asked).toMatchObject({ room_id: "!a", content: { session_id: "S1" } });
  });

  test("tells another device's session and a missing one apart from not knowing", async () => {
    const other = { getRoomEventEncryptionInfo: async () => ({ senderCurve25519Key: "theirs" }) };
    expect(await probeOwnSession(other, roomId, "!a", "S1", OWN)).toBe("not-own");
    const missing = {
      getRoomEventEncryptionInfo: async () => {
        throw new Error("Can't find the room key to decrypt the event, withheld code: None");
      },
    };
    expect(await probeOwnSession(missing, roomId, "!a", "S1", OWN)).toBe("not-own");
    const broken = {
      getRoomEventEncryptionInfo: async () => {
        throw new Error("deserialization failed");
      },
    };
    expect(await probeOwnSession(broken, roomId, "!a", "S1", OWN)).toBe("unknown");
    expect(await probeOwnSession({}, roomId, "!a", "S1", OWN)).toBe("unknown");
  });
});
