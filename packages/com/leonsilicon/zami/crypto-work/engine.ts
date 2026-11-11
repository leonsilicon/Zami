// Splitting matrix-js-sdk's long calls into the Rust crypto engine.
//
// On React Native the engine (wasm2c over JSI) runs on the JS thread, and one call into it
// runs to the end without a frame drawn. A few calls grow with the account and the room:
// processing a sync's to-device messages, claiming one-time keys for every device of a large
// room, and decrypting and importing a key backup. Where the work is a list that can be
// handed over in parts without changing what the engine ends up with, these wrappers hand it
// over in parts, in the same order, with a turn of the event loop between them.
//
// Measured with the official engine in Node (V8, fake-indexeddb store, 2026-11-10): a to-device
// room key costs about 2 ms to process, a claimed one-time key (a new Olm session) 0.6 ms, a
// backed-up key 0.15 ms to decrypt and 0.1 ms to import. A phone runs this two to three times
// slower, so the chunks below each stay near 20-50 ms there.
//
// And the other way round: matrix-js-sdk tracks a room's members' devices with one engine call
// per member as each member is applied (RoomEncryptor.onRoomMembership), and one per room
// when a room's encryptor is made. Those calls are gathered into a few larger ones on the
// crypto queue: 2,000 one-user calls took 3 s in a row; 50 users at a time, 5-15 ms a call.
//
// What can't be split from here (one call, one result): sharing a new room key with every
// device of a room (shareRoomKey), a /keys/query response (the engine already splits those
// into 250 users per request), and a full key export. Those need the engine off the JS thread.
import { cryptoQueue, interactivePriority } from "#queue";
import { createYielder, yieldToEventLoop } from "#yield";

/** To-device messages per call: Synapse sends up to 100 per sync. */
export const TO_DEVICE_CHUNK = 8;
/** Users per one-time key claim (one /keys/claim request each). */
export const KEY_CLAIM_CHUNK = 50;
/** Backed-up keys per decryption call. */
export const BACKUP_DECRYPT_CHUNK = 50;
/** Backed-up keys per import call (the SDK hands over 200 at a time). */
export const BACKUP_IMPORT_CHUNK = 50;
/** Users per device-tracking call. */
export const TRACK_USERS_CHUNK = 50;
/** How long a run of quick chunks may go before giving the event loop a turn (ms). */
const CHUNK_BUDGET_MS = 8;

/** The engine's classes the wrappers need: they're passed in, not imported here. */
export interface EngineClasses {
  /** `new DeviceLists()` is an empty list of changed and left users. */
  DeviceLists: new () => unknown;
}

type AnyFn = (...args: unknown[]) => unknown;

interface Machine {
  receiveSyncChanges?: AnyFn;
  receiveSyncChangesMsc4186?: AnyFn;
  updateTrackedUsers?: (users: unknown[]) => Promise<unknown>;
  close?: AnyFn;
}

interface ImportProgress {
  total: number;
  successes: number;
  failures: number;
  stage?: unknown;
}

interface BackupManager {
  importBackedUpRoomKeys?: (
    keys: unknown[],
    version: unknown,
    opts?: { progressCallback?: (p: ImportProgress) => void },
  ) => Promise<unknown>;
  createBackupDecryptor?: (key: unknown) => { decryptSessions?: AnyFn } | undefined;
}

interface KeyClaimManager {
  ensureSessionsForUsersInner?: (logger: unknown, users: unknown[]) => Promise<unknown>;
}

/** The parts of matrix-js-sdk's RustCrypto this reaches into (private there). */
interface RustCryptoInternals {
  olmMachine?: Machine;
  backupManager?: BackupManager;
  keyClaimManager?: KeyClaimManager;
}

// Split sequences still running, across every engine: a background release must wait for
// them as for any call into the engine (they write to its store), and a sequence's next part
// would otherwise start after the release let go of the store.
let running = 0;
const idleWaiters = new Set<() => void>();

function begin(): void {
  running++;
}

function end(): void {
  running--;
  // A waiter removes itself as it wakes; a Set iteration allows that.
  if (running === 0) for (const wake of idleWaiters) wake();
}

/** Split sequences in flight. */
export function slicedEngineWork(): number {
  return running;
}

/**
 * Resolves true once no split sequence is running, or false if that took longer than
 * `timeoutMs`.
 */
export function waitForSlicedEngineWork(timeoutMs: number): Promise<boolean> {
  if (running === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (idle: boolean) => {
      clearTimeout(timer);
      idleWaiters.delete(wake);
      resolve(idle);
    };
    const wake = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    idleWaiters.add(wake);
  });
}

/**
 * Install the wrappers on a RustCrypto just created by `initRustCrypto`. Each part is skipped
 * if matrix-js-sdk's internals don't look as expected. Returns what was installed, for the log.
 */
export function sliceEngineWork(crypto: unknown, classes: EngineClasses): string[] {
  const rust = crypto as RustCryptoInternals | null | undefined;
  const installed: string[] = [];
  const once = (target: object | undefined, install: (t: never) => boolean, what: string) => {
    if (!target) return;
    const done = wrapped.get(target) ?? new Set<string>();
    if (done.has(what)) return;
    if (install(target as never)) {
      done.add(what);
      wrapped.set(target, done);
      installed.push(what);
    }
  };
  once(rust?.olmMachine, (m: Machine) => sliceToDevice(m, classes), "to-device");
  once(rust?.olmMachine, batchTrackedUsers, "device tracking");
  once(rust?.keyClaimManager, sliceKeyClaims, "key claims");
  once(rust?.backupManager, sliceBackup, "backup restore");
  return installed;
}

// What's already wrapped, so installing twice doesn't wrap twice.
const wrapped = new WeakMap<object, Set<string>>();

interface TrackBatch {
  /** The users asked for, once each (the engine's UserId objects, by id). */
  users: Map<string, unknown>;
  waiters: { resolve: () => void; reject: (error: unknown) => void }[];
}

/**
 * `updateTrackedUsers` calls gathered while the crypto queue gets to them, then made a few
 * users per call, each call a task of the queue. A caller's promise settles once every user
 * of its batch was handed over (rejecting with the first error, as its own call would have).
 * Tracking is a set: the engine adds the users it doesn't track yet and ignores the rest, so
 * one call with everyone does what the many did. A task of the crypto queue must not wait for
 * `updateTrackedUsers` (it would wait for a task behind it); matrix-js-sdk calls it from
 * encryption and membership changes, never from decryption.
 */
function batchTrackedUsers(machine: Machine): boolean {
  const update = machine.updateTrackedUsers;
  if (typeof update !== "function") return false;
  let gathering: TrackBatch | null = null;

  const runFrom = (batch: TrackBatch, list: unknown[], from: number, failure: unknown) => {
    void cryptoQueue
      .add(
        () => update.call(machine, list.slice(from, from + TRACK_USERS_CHUNK)),
        interactivePriority(),
      )
      .then(
        () => failure,
        (error: unknown) => failure ?? error ?? new Error("updateTrackedUsers failed"),
      )
      .then((failed) => {
        const next = from + TRACK_USERS_CHUNK;
        if (next < list.length) return runFrom(batch, list, next, failed);
        for (const waiter of batch.waiters) {
          if (failed === undefined) waiter.resolve();
          else waiter.reject(failed);
        }
        return undefined;
      });
  };

  machine.updateTrackedUsers = function (this: unknown, users: unknown[]) {
    if (!Array.isArray(users) || users.length === 0) return update.call(machine, users);
    if (!gathering) {
      const batch: TrackBatch = { users: new Map(), waiters: [] };
      gathering = batch;
      // The batch closes when its first call's turn on the queue comes.
      void cryptoQueue
        .add(async () => {
          if (gathering === batch) gathering = null;
        }, interactivePriority())
        .then(() => runFrom(batch, [...batch.users.values()], 0, undefined));
    }
    const batch = gathering;
    for (const user of users) {
      const id = String(user);
      if (batch.users.has(id)) (user as { free?(): void }).free?.();
      else batch.users.set(id, user);
    }
    return new Promise<void>((resolve, reject) => batch.waiters.push({ resolve, reject }));
  };
  return true;
}

/**
 * A sync's to-device messages, a few per call. The first call carries the sync's device list
 * changes, one-time key counts and fallback keys, exactly as given, so they apply before any
 * message as in a single call. The rest use the MSC4186 variant with none of those: there, a
 * missing key count means "unchanged" (sync v2 would read it as zero keys on the server).
 *
 * The parts must all run, or the messages after a part are lost (the server deletes them once
 * the next sync is requested). So if the engine is closed between parts (the app went to the
 * background), the close waits until the last part is done, and the rest run without pausing.
 */
function sliceToDevice(machine: Machine, classes: EngineClasses): boolean {
  const v2 = machine.receiveSyncChanges;
  const msc4186 = machine.receiveSyncChangesMsc4186;
  const close = machine.close;
  if (typeof v2 !== "function" || typeof msc4186 !== "function" || typeof close !== "function")
    return false;
  let parts = 0;
  let closeAsked = false;
  machine.close = function (this: unknown, ...args: unknown[]) {
    if (parts > 0) {
      closeAsked = true;
      return undefined;
    }
    return close.apply(machine, args);
  };
  const split = (first: AnyFn) =>
    async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const [events, devices, counts, fallbackKeys, ...rest] = args;
      let list: unknown;
      try {
        list = typeof events === "string" ? JSON.parse(events) : null;
      } catch {
        list = null;
      }
      // Decryption settings are an engine object a call takes ownership of: it can't be
      // handed to several calls, so such a call isn't split.
      if (!Array.isArray(list) || list.length <= TO_DEVICE_CHUNK || rest.some((a) => a != null))
        return first.apply(machine, args);
      parts++;
      begin();
      try {
        const out: unknown[] = [];
        const take = (processed: unknown) => {
          if (Array.isArray(processed)) out.push(...processed);
        };
        take(
          await first.call(
            machine,
            JSON.stringify(list.slice(0, TO_DEVICE_CHUNK)),
            devices,
            counts,
            fallbackKeys,
          ),
        );
        const maybeYield = createYielder(CHUNK_BUDGET_MS);
        for (let i = TO_DEVICE_CHUNK; i < list.length; i += TO_DEVICE_CHUNK) {
          if (!closeAsked) {
            const turn = maybeYield();
            if (turn) await turn;
          }
          take(
            await msc4186.call(
              machine,
              JSON.stringify(list.slice(i, i + TO_DEVICE_CHUNK)),
              new classes.DeviceLists(),
              new Map(),
              undefined,
            ),
          );
        }
        return out;
      } finally {
        parts--;
        end();
        if (parts === 0 && closeAsked) {
          closeAsked = false;
          close.call(machine);
        }
      }
    };
  machine.receiveSyncChanges = split(v2);
  machine.receiveSyncChangesMsc4186 = split(msc4186);
  return true;
}

/**
 * Olm sessions for a large room's devices, claimed for a few users at a time. The SDK runs
 * one claim at a time (KeyClaimManager chains them), and each part here is a whole claim of
 * its own (ask the engine which devices lack a session, /keys/claim, hand the response
 * back), so the result is the same sessions, over more requests.
 */
function sliceKeyClaims(manager: KeyClaimManager): boolean {
  const inner = manager.ensureSessionsForUsersInner;
  if (typeof inner !== "function") return false;
  manager.ensureSessionsForUsersInner = async function (
    this: unknown,
    logger: unknown,
    users: unknown[],
  ) {
    if (!Array.isArray(users) || users.length <= KEY_CLAIM_CHUNK)
      return inner.call(manager, logger, users);
    const maybeYield = createYielder(CHUNK_BUDGET_MS);
    for (let i = 0; i < users.length; i += KEY_CLAIM_CHUNK) {
      if (i > 0) {
        const turn = maybeYield();
        if (turn) await turn;
      }
      await inner.call(manager, logger, users.slice(i, i + KEY_CLAIM_CHUNK));
    }
    return undefined;
  };
  return true;
}

/**
 * A key backup restore, decrypted and imported a few keys at a time. The SDK already walks a
 * full backup in groups of 200; each group is split further here, in order. Progress is
 * reported over the whole group, as before.
 */
function sliceBackup(manager: BackupManager): boolean {
  const importKeys = manager.importBackedUpRoomKeys;
  const createDecryptor = manager.createBackupDecryptor;
  if (typeof importKeys !== "function" || typeof createDecryptor !== "function") return false;
  manager.importBackedUpRoomKeys = async function (this: unknown, keys, version, opts) {
    if (!Array.isArray(keys) || keys.length <= BACKUP_IMPORT_CHUNK)
      return importKeys.call(manager, keys, version, opts);
    begin();
    try {
      const report = opts?.progressCallback;
      let successes = 0;
      let failures = 0;
      for (let i = 0; i < keys.length; i += BACKUP_IMPORT_CHUNK) {
        if (i > 0) await yieldToEventLoop();
        const part = keys.slice(i, i + BACKUP_IMPORT_CHUNK);
        let last: ImportProgress | null = null;
        await importKeys.call(
          manager,
          part,
          version,
          report
            ? {
                ...opts,
                progressCallback: (p: ImportProgress) => {
                  last = p;
                  report({
                    ...p,
                    total: keys.length,
                    successes: successes + p.successes,
                    failures: failures + p.failures,
                  });
                },
              }
            : opts,
        );
        const reported = last as ImportProgress | null;
        successes += reported ? reported.successes : part.length;
        failures += reported ? reported.failures : 0;
      }
      return undefined;
    } finally {
      end();
    }
  };
  manager.createBackupDecryptor = function (this: unknown, key: unknown) {
    const decryptor = createDecryptor.call(manager, key);
    const decrypt = decryptor?.decryptSessions;
    if (!decryptor || typeof decrypt !== "function") return decryptor;
    decryptor.decryptSessions = async function (ciphertexts: unknown) {
      const entries =
        ciphertexts && typeof ciphertexts === "object" ? Object.entries(ciphertexts) : null;
      if (!entries || entries.length <= BACKUP_DECRYPT_CHUNK)
        return decrypt.call(decryptor, ciphertexts);
      const out: unknown[] = [];
      for (let i = 0; i < entries.length; i += BACKUP_DECRYPT_CHUNK) {
        if (i > 0) await yieldToEventLoop();
        const part = await decrypt.call(
          decryptor,
          Object.fromEntries(entries.slice(i, i + BACKUP_DECRYPT_CHUNK)),
        );
        if (Array.isArray(part)) out.push(...part);
      }
      return out;
    };
    return decryptor;
  };
  return true;
}
