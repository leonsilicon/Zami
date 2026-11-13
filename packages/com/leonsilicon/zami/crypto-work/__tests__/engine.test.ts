import { describe, expect, test } from "vite-plus/test";
import {
  BACKUP_DECRYPT_CHUNK,
  BACKUP_IMPORT_CHUNK,
  KEY_CLAIM_CHUNK,
  TO_DEVICE_CHUNK,
  TRACK_USERS_CHUNK,
  sliceEngineWork,
  slicedEngineWork,
  waitForSlicedEngineWork,
} from "#engine";

class DeviceLists {
  readonly empty = true;
}

/** An OlmMachine stand-in that records each receiveSyncChanges call. */
function fakeMachine() {
  const calls: { variant: string; events: unknown[]; args: unknown[] }[] = [];
  let closed = 0;
  const record = (variant: string) =>
    async function (events: string, ...args: unknown[]) {
      if (closed) throw new Error("closed");
      const list = JSON.parse(events) as unknown[];
      calls.push({ variant, events: list, args });
      return list.map((e) => ({ processed: e }));
    };
  const machine = {
    receiveSyncChanges: record("v2"),
    receiveSyncChangesMsc4186: record("msc4186"),
    close() {
      closed++;
    },
  };
  return { machine, calls, closed: () => closed };
}

const events = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ type: "m.room.encrypted", i }));

describe("sliceEngineWork: to-device messages", () => {
  test("leaves a small batch to one call", async () => {
    const { machine, calls } = fakeMachine();
    sliceEngineWork({ olmMachine: machine }, { DeviceLists });
    const devices = new DeviceLists();
    const out = await machine.receiveSyncChanges(
      JSON.stringify(events(3)),
      devices,
      new Map(),
      new Set(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0]).toBe(devices);
    expect(out).toHaveLength(3);
  });

  test("hands a large batch over in order: sync data first, then MSC4186 parts", async () => {
    const { machine, calls } = fakeMachine();
    sliceEngineWork({ olmMachine: machine }, { DeviceLists });
    const devices = new DeviceLists();
    const counts = new Map([["signed_curve25519", 3]]);
    const fallback = new Set(["signed_curve25519"]);
    const all = events(TO_DEVICE_CHUNK * 3 + 2);
    const out = (await machine.receiveSyncChanges(
      JSON.stringify(all),
      devices,
      counts,
      fallback,
    )) as {
      processed: unknown;
    }[];
    expect(out.map((o) => o.processed)).toEqual(all);
    expect(calls.map((c) => c.variant)).toEqual(["v2", "msc4186", "msc4186", "msc4186"]);
    expect(calls.flatMap((c) => c.events)).toEqual(all);
    // Device lists, key counts and fallback keys go with the first part only.
    expect(calls[0]!.args).toEqual([devices, counts, fallback]);
    for (const later of calls.slice(1)) {
      expect(later.args[0]).toBeInstanceOf(DeviceLists);
      expect(later.args[0]).not.toBe(devices);
      expect(later.args[1]).toEqual(new Map());
      expect(later.args[2]).toBeUndefined();
    }
    expect(slicedEngineWork()).toBe(0);
  });

  test("the MSC4186 variant is split the same way", async () => {
    const { machine, calls } = fakeMachine();
    sliceEngineWork({ olmMachine: machine }, { DeviceLists });
    await machine.receiveSyncChangesMsc4186(
      JSON.stringify(events(TO_DEVICE_CHUNK + 1)),
      new DeviceLists(),
      new Map(),
    );
    expect(calls.map((c) => c.variant)).toEqual(["msc4186", "msc4186"]);
  });

  test("a close asked between parts waits for the last part", async () => {
    const { machine, calls, closed } = fakeMachine();
    sliceEngineWork({ olmMachine: machine }, { DeviceLists });
    const all = events(TO_DEVICE_CHUNK * 4);
    const done = machine.receiveSyncChanges(
      JSON.stringify(all),
      new DeviceLists(),
      new Map(),
      undefined,
    );
    // Let the first part finish, then close as stopClient does.
    await Promise.resolve();
    await Promise.resolve();
    machine.close();
    expect(closed()).toBe(0);
    expect(slicedEngineWork()).toBe(1);
    const idle = waitForSlicedEngineWork(1000);
    await done;
    expect(await idle).toBe(true);
    expect(calls.flatMap((c) => c.events)).toEqual(all);
    expect(closed()).toBe(1);
    // With nothing running, a close is immediate.
    machine.close();
    expect(closed()).toBe(2);
  });

  test("installs once per machine", async () => {
    const { machine, calls } = fakeMachine();
    expect(sliceEngineWork({ olmMachine: machine }, { DeviceLists })).toEqual(["to-device"]);
    expect(sliceEngineWork({ olmMachine: machine }, { DeviceLists })).toEqual([]);
    await machine.receiveSyncChanges(
      JSON.stringify(events(TO_DEVICE_CHUNK + 1)),
      new DeviceLists(),
      new Map(),
    );
    expect(calls).toHaveLength(2);
  });
});

describe("sliceEngineWork: one-time key claims", () => {
  test("claims for a large room a few users at a time, in order", async () => {
    const parts: string[][] = [];
    const manager = {
      ensureSessionsForUsersInner: async (_logger: unknown, users: string[]) => {
        parts.push(users);
      },
    };
    sliceEngineWork({ keyClaimManager: manager }, { DeviceLists });
    const users = Array.from({ length: KEY_CLAIM_CHUNK * 2 + 1 }, (_, i) => `@u${i}:x`);
    await manager.ensureSessionsForUsersInner(null, users);
    expect(parts.map((p) => p.length)).toEqual([KEY_CLAIM_CHUNK, KEY_CLAIM_CHUNK, 1]);
    expect(parts.flat()).toEqual(users);
  });

  test("a failed part stops the claim, as the single call failed", async () => {
    let calls = 0;
    const manager = {
      ensureSessionsForUsersInner: async (_logger: unknown, _users: string[]) => {
        calls++;
        throw new Error("shutting down");
      },
    };
    sliceEngineWork({ keyClaimManager: manager }, { DeviceLists });
    const users = Array.from({ length: KEY_CLAIM_CHUNK * 3 }, (_, i) => `@u${i}:x`);
    await expect(manager.ensureSessionsForUsersInner(null, users)).rejects.toThrow("shutting down");
    expect(calls).toBe(1);
  });
});

describe("sliceEngineWork: key backup restore", () => {
  function fakeBackupManager() {
    const imported: unknown[][] = [];
    const decrypted: string[][] = [];
    const manager = {
      importBackedUpRoomKeys: async (
        keys: unknown[],
        _version: unknown,
        opts?: {
          progressCallback?: (p: { total: number; successes: number; failures: number }) => void;
        },
      ) => {
        imported.push(keys);
        opts?.progressCallback?.({ total: keys.length, successes: keys.length, failures: 0 });
      },
      createBackupDecryptor: (_key: unknown) => ({
        decryptSessions: async (ciphertexts: Record<string, unknown>) => {
          decrypted.push(Object.keys(ciphertexts));
          return Object.keys(ciphertexts).map((id) => ({ session_id: id }));
        },
        free() {},
      }),
    };
    return { manager, imported, decrypted };
  }

  test("imports a group in parts, in order, reporting progress over the group", async () => {
    const { manager, imported } = fakeBackupManager();
    sliceEngineWork({ backupManager: manager }, { DeviceLists });
    const keys = Array.from({ length: 200 }, (_, i) => ({ session_id: `s${i}` }));
    const progress: number[] = [];
    await manager.importBackedUpRoomKeys(keys, "1", {
      progressCallback: (p) => {
        expect(p.total).toBe(200);
        progress.push(p.successes);
      },
    });
    expect(imported.map((p) => p.length)).toEqual([50, 50, 50, 50].map(() => BACKUP_IMPORT_CHUNK));
    expect(imported.flat()).toEqual(keys);
    expect(progress).toEqual([50, 100, 150, 200]);
  });

  test("decrypts a group in parts, in order", async () => {
    const { manager, decrypted } = fakeBackupManager();
    sliceEngineWork({ backupManager: manager }, { DeviceLists });
    const decryptor = manager.createBackupDecryptor("key");
    const ids = Array.from({ length: BACKUP_DECRYPT_CHUNK * 2 + 3 }, (_, i) => `s${i}`);
    const out = await decryptor.decryptSessions(Object.fromEntries(ids.map((id) => [id, {}])));
    expect(decrypted.map((p) => p.length)).toEqual([BACKUP_DECRYPT_CHUNK, BACKUP_DECRYPT_CHUNK, 3]);
    expect(out.map((k) => k.session_id)).toEqual(ids);
  });

  test("skips what doesn't look like matrix-js-sdk's internals", () => {
    expect(sliceEngineWork({ olmMachine: {}, backupManager: {} }, { DeviceLists })).toEqual([]);
    expect(sliceEngineWork(undefined, { DeviceLists })).toEqual([]);
  });
});

describe("sliceEngineWork: device tracking", () => {
  class UserId {
    freed = false;
    constructor(readonly id: string) {}
    toString() {
      return this.id;
    }
    free() {
      this.freed = true;
    }
  }

  function trackingMachine(fail?: (users: UserId[]) => boolean) {
    const calls: string[][] = [];
    const machine = {
      updateTrackedUsers: async (users: UserId[]) => {
        calls.push(users.map(String));
        if (fail?.(users)) throw new Error("store error");
      },
    };
    sliceEngineWork({ olmMachine: machine }, { DeviceLists });
    return { machine, calls };
  }

  test("gathers one-user calls into a few calls, once per user", async () => {
    const { machine, calls } = trackingMachine();
    const users = Array.from({ length: TRACK_USERS_CHUNK * 2 + 5 }, (_, i) => `@u${i}:x`);
    const done = users.map((id) => machine.updateTrackedUsers([new UserId(id)]));
    const again = new UserId("@u0:x");
    done.push(machine.updateTrackedUsers([again]));
    await Promise.all(done);
    expect(calls.map((c) => c.length)).toEqual([TRACK_USERS_CHUNK, TRACK_USERS_CHUNK, 5]);
    expect(calls.flat()).toEqual(users);
    expect(again.freed).toBe(true);
  });

  test("a call made after a batch started goes in the next one", async () => {
    const { machine, calls } = trackingMachine();
    await machine.updateTrackedUsers([new UserId("@a:x")]);
    await machine.updateTrackedUsers([new UserId("@b:x"), new UserId("@c:x")]);
    expect(calls).toEqual([["@a:x"], ["@b:x", "@c:x"]]);
  });

  test("a failed call fails its batch's callers, after the rest were handed over", async () => {
    const { machine, calls } = trackingMachine((users) => String(users[0]) === "@u0:x");
    const users = Array.from({ length: TRACK_USERS_CHUNK + 1 }, (_, i) => new UserId(`@u${i}:x`));
    await expect(machine.updateTrackedUsers(users)).rejects.toThrow("store error");
    expect(calls.flat()).toHaveLength(TRACK_USERS_CHUNK + 1);
  });
});
