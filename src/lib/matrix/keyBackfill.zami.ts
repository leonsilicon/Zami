// Getting back a room key that never arrived, from the session that made it.
//
// A sender shares each room key (megolm session) with every recipient session
// once, when it creates it, and then keeps using it for up to a week or 100
// messages. If that one share is lost (the recipient's encryption wasn't
// running when it arrived, say), the recipient can't read anything that
// sender session sends until the key rotates. The SDK's own key requests
// can't help: matrix-js-sdk turns them off, they only ever go to the
// requester's own sessions, and rust-crypto only accepts forwarded keys from
// the user's own verified sessions.
//
// So Zam sessions ask each other directly, over Olm-encrypted to-device
// messages:
//   - a session that can't find the key for a message waits a moment (the
//     key often lands just after the message), then asks the sender's
//     sessions for that session id;
//   - the sender session that created that key re-sends it, if the requester
//     is in the room and could have read those messages anyway (see
//     answerRefusal);
//   - the requester imports it, but only if it asked for that session and the
//     key came from the very device that created it (see responseRefusal),
//     which is what an original m.room_key share proves too.
//
// A session that is still being verified is where this matters most: senders
// that only share with verified sessions withhold the key, and the SDK's
// one-shot backup lookup runs before our other sessions have backed the key
// up. So once this session turns verified, or gets the backup key, failed
// messages are retried and each missing session is asked about once more.
// requestRoomKeys is the manual version, for a "request keys" button.

import { ClientEvent, MatrixEventEvent } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api";
import type { CryptoApi } from "matrix-js-sdk/lib/crypto-api";
import { isUserBlocked } from "$lib/stores/ignoredUsers.svelte";
import { readScoped } from "$lib/utils/scopedStorage";
// Zami: retries and answers wait their turn on the shared crypto queue (see
// attachKeyBackfill).
import {
    createOwnKeyExporter,
    cryptoQueue,
    forEachSliced,
    interactivePriority,
    probeOwnSession,
    queueRetries,
} from "@-/com.leonsilicon.zami.crypto-work";

export const KEY_REQUEST_TYPE = "moe.crafty.room_key_request";
export const KEY_RESPONSE_TYPE = "moe.crafty.room_key";

/** A room key as exported by the crypto store. */
type ExportedRoomKey = Parameters<CryptoApi["importRoomKeys"]>[0][number];

/** What ClientEvent.ReceivedToDeviceMessage hands us. */
export interface ReceivedToDevice {
    message: {
        type: string;
        content: Record<string, unknown>;
    };
    encryptionInfo: {
        sender: string;
        senderDevice?: string;
        senderCurve25519KeyBase64: string;
    } | null;
}

/** How long a missing key gets to arrive on its own before we ask. */
export const REQUEST_DELAY_MS = 10_000;
/** How long before the same session is asked about again. */
export const REQUEST_RETRY_MS = 60 * 60_000;
/** Requests (or answers) per minute, so a long scroll can't flood anyone. */
export const PER_MINUTE_LIMIT = 20;

/**
 * When failed messages are retried after this session turns verified or gets
 * the backup key: soon, and again once our other sessions have had time to
 * back up keys they only just received.
 */
export const RETRY_AFTER_TRUST_MS = [5_000, 2 * 60_000];

// Failures a re-share (or a backup download) can fix. A key withheld for an
// unverified device is one: the sender may share it once we are verified. A
// plain withhold (we're blocked) or a sender-trust refusal is not.
const MISSING_KEY_CODES = new Set([
    "MEGOLM_UNKNOWN_INBOUND_SESSION_ID",
    "OLM_UNKNOWN_MESSAGE_INDEX",
    "MEGOLM_KEY_WITHHELD_FOR_UNVERIFIED_DEVICE",
]);
// Also worth a manual try: messages from before this session existed, which
// only the backup or the sender can supply.
const MANUAL_CODES = new Set([
    ...MISSING_KEY_CODES,
    "HISTORICAL_MESSAGE_NO_KEY_BACKUP",
    "HISTORICAL_MESSAGE_BACKUP_UNCONFIGURED",
    "HISTORICAL_MESSAGE_WORKING_BACKUP",
]);

/** Whether our encryption settings allow sending secrets to this device. */
export function deviceAllowed(
    crypto: CryptoApi,
    ownUserId: string,
    status: Awaited<
        ReturnType<CryptoApi["getDeviceVerificationStatus"]>
    > | null,
): boolean {
    if (!status) return false;
    if (crypto.globalBlacklistUnverifiedDevices && !status.isVerified())
        return false;
    const excludeInsecure =
        readScoped("settings:excludeInsecureDevices", ownUserId) === "true";
    return !excludeInsecure || status.signedByOwner;
}

/** Whether a decryption failure is one a re-share can fix. */
export function isMissingRoomKey(event: MatrixEvent): boolean {
    return (
        event.isDecryptionFailure() &&
        MISSING_KEY_CODES.has(event.decryptionFailureReason ?? "")
    );
}

/** Whether to offer a manual "request keys" for a failed message. */
export function canRequestRoomKeys(reason: string | null | undefined): boolean {
    return MANUAL_CODES.has(reason ?? "");
}

let manualRequest: ((event: MatrixEvent) => Promise<void>) | null = null;

/**
 * Try a failed message again now: retry decryption (which re-checks the key
 * backup) and, if the key is still missing, ask the sender's sessions for it
 * even if we asked recently. Resolves once the request is sent; the message
 * unlocks on its own if an answer comes.
 */
export function requestRoomKeys(event: MatrixEvent): Promise<void> {
    return manualRequest?.(event) ?? Promise.resolve();
}

/**
 * Why we won't re-send one of our room keys to the device asking, or null to
 * send it. The export starts at the key's first message, so the requester
 * must be someone who may read the room's history anyway: joined, and the
 * room's history shared with members.
 */
export function answerRefusal(input: {
    /** The request arrived Olm-encrypted from a device we know. */
    fromKnownDevice: boolean;
    requesterBlocked: boolean;
    requesterJoined: boolean;
    historyVisibility: string | null;
    /** We created this key ourselves (it isn't one we received). */
    ownKey: boolean;
    /** The requesting device passes our "who gets keys" settings. */
    deviceAllowed: boolean;
}): string | null {
    if (!input.fromKnownDevice) return "not from a known device";
    if (input.requesterBlocked) return "requester is blocked";
    if (!input.requesterJoined) return "requester is not in the room";
    if (
        input.historyVisibility !== "shared" &&
        input.historyVisibility !== "world_readable"
    )
        return `history visibility is ${input.historyVisibility}`;
    if (!input.ownKey) return "not a key this session created";
    if (!input.deviceAllowed) return "device excluded by our settings";
    return null;
}

/**
 * Why we won't import a re-sent key, or null to import it. The key must be
 * one we asked for, from the user we asked, and created by the device that
 * sent it: its sender_key is the Olm identity the message came from.
 */
export function responseRefusal(input: {
    asked: { roomId: string; sender: string } | undefined;
    roomId: unknown;
    fromUser: string;
    fromDevice: string | undefined;
    fromCurve25519: string;
    key: Partial<ExportedRoomKey> | undefined;
    sessionId: unknown;
}): string | null {
    const { asked, key } = input;
    if (!asked) return "not a key we asked for";
    if (!input.fromDevice) return "not from a known device";
    if (input.fromUser !== asked.sender) return "not from the sender we asked";
    if (!key || typeof key !== "object") return "no key";
    if (key.session_id !== input.sessionId) return "session id mismatch";
    if (key.room_id !== asked.roomId || input.roomId !== asked.roomId)
        return "room mismatch";
    if (key.sender_key !== input.fromCurve25519)
        return "key was not created by the device that sent it";
    return null;
}

/** A sliding one-minute budget. */
export function createRateLimit(perMinute: number, now = () => Date.now()) {
    const stamps: number[] = [];
    return (): boolean => {
        const t = now();
        while (stamps.length && t - stamps[0] >= 60_000) stamps.shift();
        if (stamps.length >= perMinute) return false;
        stamps.push(t);
        return true;
    };
}

/** RustCrypto internals: exporting just the keys we need. */
interface ExportHooks {
    olmMachine?: {
        exportRoomKeys(
            predicate: (session: {
                sessionId: string;
                roomId: { toString(): string };
                senderKey: { toBase64(): string };
                hasBeenImported(): boolean;
            }) => boolean,
        ): Promise<string>;
        // Zami: for probeOwnSession.
        getRoomEventEncryptionInfo?: unknown;
    };
}

function log(message: string): void {
    console.info(`[key-backfill] ${message}`);
}

/**
 * Start answering and making key requests for `client`. Returns the
 * teardown. Call once crypto is running.
 */
export function attachKeyBackfill(client: MatrixClient): () => void {
    const crypto = client.getCrypto();
    if (!crypto) return () => {};
    const ownUserId = client.getUserId();
    const ownDeviceId = client.getDeviceId();
    if (!ownUserId || !ownDeviceId) return () => {};

    // Session id -> what we asked, and the events waiting on it.
    const asked = new Map<
        string,
        { roomId: string; sender: string; at: number; events: MatrixEvent[] }
    >();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const canRequest = createRateLimit(PER_MINUTE_LIMIT);
    const canAnswer = createRateLimit(PER_MINUTE_LIMIT);
    // When this session last turned verified. A request made before then may
    // have been refused for it, so it doesn't hold back a new one.
    let verifiedAt = 0;
    let ownVerified: boolean | null = null;

    async function sendEncrypted(
        type: string,
        devices: { userId: string; deviceId: string }[],
        content: Record<string, unknown>,
    ): Promise<void> {
        if (devices.length === 0) return;
        const batch = await crypto!.encryptToDeviceMessages(
            type,
            devices,
            content,
        );
        if (batch.batch.length > 0) await client.queueToDevice(batch);
    }

    async function request(event: MatrixEvent, force = false): Promise<void> {
        const content = event.getWireContent();
        const sessionId = content.session_id;
        const roomId = event.getRoomId();
        const sender = event.getSender();
        if (typeof sessionId !== "string" || !roomId || !sender) return;
        const previous = asked.get(sessionId);
        if (
            !force &&
            previous &&
            previous.at > verifiedAt &&
            Date.now() - previous.at < REQUEST_RETRY_MS
        ) {
            if (!previous.events.includes(event)) previous.events.push(event);
            return;
        }
        if (!canRequest()) return;
        // Older senders name the device; otherwise ask all of theirs.
        const named =
            typeof content.device_id === "string" ? content.device_id : null;
        const known = (await crypto!.getUserDeviceInfo([sender])).get(sender);
        const deviceIds = named
            ? [named]
            : [...(known?.keys() ?? [])].filter(
                  (id) => !(sender === ownUserId && id === ownDeviceId),
              );
        const events = previous?.events ?? [];
        if (!events.includes(event)) events.push(event);
        asked.set(sessionId, { roomId, sender, at: Date.now(), events });
        log(`asking ${sender} (${deviceIds.length} sessions) for ${sessionId}`);
        await sendEncrypted(
            KEY_REQUEST_TYPE,
            deviceIds.map((deviceId) => ({ userId: sender, deviceId })),
            { room_id: roomId, session_id: sessionId },
        );
    }

    // Zami: exportRoomKeys reads every session in the store, whatever it's
    // asked for (seconds on a large account), so an answer exports last, and
    // requests that arrived before an export ran share it
    // (createOwnKeyExporter).
    const machine = (crypto as unknown as ExportHooks).olmMachine;
    const exporter = createOwnKeyExporter(
        (predicate) => machine!.exportRoomKeys(predicate),
        async () => (await crypto!.getOwnDeviceKeys()).curve25519,
    );
    // Zami: retries not started yet are dropped on teardown.
    const retries = new AbortController();

    async function answer(payload: ReceivedToDevice): Promise<void> {
        const { message } = payload;
        const roomId = message.content.room_id;
        const sessionId = message.content.session_id;
        if (typeof roomId !== "string" || typeof sessionId !== "string") return;
        // Zami: the checks and the export are one task on the crypto queue,
        // queued before anything is awaited; the reply is sent after it,
        // outside the queue.
        const ticket = exporter.want(roomId, sessionId);
        let reply: Awaited<ReturnType<typeof answerable>>;
        try {
            reply = await cryptoQueue.add(
                () => answerable(payload, roomId, sessionId, ticket),
                interactivePriority(),
            );
        } finally {
            exporter.release(ticket);
        }
        if (!reply) return;
        log(`re-sending ${sessionId} to ${reply.requester} ${reply.deviceId}`);
        await sendEncrypted(
            KEY_RESPONSE_TYPE,
            [{ userId: reply.requester, deviceId: reply.deviceId }],
            { room_id: roomId, session_id: sessionId, key: reply.key },
        );
    }

    /** Zami: answer's checks and export: the key to send, or null to refuse. */
    async function answerable(
        payload: ReceivedToDevice,
        roomId: string,
        sessionId: string,
        ticket: symbol,
    ): Promise<{
        requester: string;
        deviceId: string;
        key: ExportedRoomKey;
    } | null> {
        const { encryptionInfo } = payload;
        // Who Olm says sent it, not what the message claims.
        const requester = encryptionInfo!.sender;
        const deviceId = encryptionInfo!.senderDevice;
        const room = client.getRoom(roomId);
        const own = await crypto!.getOwnDeviceKeys();
        const status = deviceId
            ? await crypto!.getDeviceVerificationStatus(requester, deviceId)
            : null;
        const refusalIf = (ownKey: boolean) =>
            answerRefusal({
                fromKnownDevice: !!deviceId,
                requesterBlocked: isUserBlocked(requester),
                requesterJoined:
                    room?.getMember(requester)?.membership === "join",
                historyVisibility: room?.getHistoryVisibility() ?? null,
                ownKey,
                deviceAllowed: deviceAllowed(crypto!, ownUserId!, status),
            });
        // Zami: everything but whose key it is first, then one lookup of who
        // created it (usually another of our devices: the requester asks them
        // all), then the rate limit, and only then the export.
        const early = refusalIf(true);
        if (early) {
            log(`not re-sending ${sessionId} to ${requester}: ${early}`);
            return null;
        }
        if (
            room &&
            machine &&
            (await probeSession(roomId, sessionId, own.curve25519)) ===
                "not-own"
        ) {
            log(
                `not re-sending ${sessionId} to ${requester}: ${refusalIf(false)}`,
            );
            return null;
        }
        if (!canAnswer()) return null;
        const keys: ExportedRoomKey[] =
            room && machine
                ? ((await exporter.take(ticket)) as ExportedRoomKey[])
                : [];
        const refusal = refusalIf(keys.length === 1);
        if (refusal) {
            log(`not re-sending ${sessionId} to ${requester}: ${refusal}`);
            return null;
        }
        return { requester, deviceId: deviceId!, key: keys[0] };
    }

    /** Zami: who created a stored room key, from one lookup (probeOwnSession). */
    async function probeSession(
        roomId: string,
        sessionId: string,
        ownCurve25519: string,
    ): Promise<string> {
        if (typeof machine?.getRoomEventEncryptionInfo !== "function")
            return "unknown";
        const { RoomId } = await import("@matrix-org/matrix-sdk-crypto-wasm");
        return probeOwnSession(
            machine,
            (id) => new RoomId(id),
            roomId,
            sessionId,
            ownCurve25519,
        );
    }

    async function receive(payload: ReceivedToDevice): Promise<void> {
        const { message, encryptionInfo } = payload;
        const sessionId = message.content.session_id;
        if (typeof sessionId !== "string" || !encryptionInfo) return;
        const pending = asked.get(sessionId);
        const key = message.content.key as Partial<ExportedRoomKey> | undefined;
        const refusal = responseRefusal({
            asked: pending,
            roomId: message.content.room_id,
            fromUser: encryptionInfo.sender,
            fromDevice: encryptionInfo.senderDevice,
            fromCurve25519: encryptionInfo.senderCurve25519KeyBase64,
            key,
            sessionId,
        });
        if (refusal) {
            log(`ignoring a key for ${sessionId}: ${refusal}`);
            return;
        }
        await crypto!.importRoomKeys([key as ExportedRoomKey]);
        asked.delete(sessionId);
        log(`got ${sessionId} back from ${encryptionInfo.sender}`);
        // Zami: on the crypto queue, newest first.
        void queueRetries(
            pending!.events,
            (event) =>
                event.attemptDecryption(crypto as never, { isRetry: true }),
            {
                stillNeeded: (event) => event.isDecryptionFailure(),
                signal: retries.signal,
            },
        );
    }

    const onToDevice = (payload: ReceivedToDevice): void => {
        // Only Olm-encrypted messages: the plaintext ones carry no proof of
        // who sent them.
        if (!payload.encryptionInfo) return;
        const run =
            payload.message.type === KEY_REQUEST_TYPE
                ? answer
                : payload.message.type === KEY_RESPONSE_TYPE
                  ? receive
                  : null;
        run?.(payload).catch((err) =>
            console.warn(`[key-backfill] ${payload.message.type} failed`, err),
        );
    };

    function retryFailed(): void {
        // Zami: the scan gives the event loop a turn every few ms, and the
        // retries wait their turn on the crypto queue, newest first: every
        // failed message of every room at once froze a large account.
        const failed: MatrixEvent[] = [];
        void forEachSliced(client.getRooms(), (room) => {
            const timelines = [
                room.getLiveTimeline(),
                ...room.getThreads().map((t) => t.liveTimeline),
            ];
            for (const timeline of timelines) {
                for (const event of timeline.getEvents()) {
                    if (!isMissingRoomKey(event)) continue;
                    failed.push(event);
                }
            }
        }).then(() =>
            // A failed retry fires Decrypted again, which asks.
            queueRetries(
                failed,
                (event) =>
                    event.attemptDecryption(crypto as never, { isRetry: true }),
                {
                    stillNeeded: isMissingRoomKey,
                    signal: retries.signal,
                    // This runs from a timer: the first retries start right
                    // away.
                    startNow: true,
                },
            ),
        );
    }

    function scheduleRetries(): void {
        for (const delay of RETRY_AFTER_TRUST_MS) {
            const timer = setTimeout(() => {
                timers.delete(timer);
                retryFailed();
            }, delay);
            timers.add(timer);
        }
    }

    async function checkOwnTrust(): Promise<void> {
        const status = await crypto!.getDeviceVerificationStatus(
            ownUserId!,
            ownDeviceId!,
        );
        const verified = !!status?.crossSigningVerified;
        const was = ownVerified;
        ownVerified = verified;
        // The first check only learns the starting state.
        if (was === false && verified) {
            log("this session is verified now, retrying missing keys");
            verifiedAt = Date.now();
            scheduleRetries();
        }
    }

    const onTrustChange = (): void => {
        checkOwnTrust().catch((err) =>
            console.warn("[key-backfill] trust check failed", err),
        );
    };

    const onDevicesUpdated = (users: string[]): void => {
        if (users.includes(ownUserId)) onTrustChange();
    };

    const onUserTrust = (userId: string): void => {
        if (userId === ownUserId) onTrustChange();
    };

    const onBackupKey = (): void => {
        log("got the backup key, retrying missing keys");
        scheduleRetries();
    };

    manualRequest = async (event) => {
        if (event.isDecryptionFailure())
            await event
                .attemptDecryption(crypto as never, { isRetry: true })
                .catch(() => {});
        if (!event.isDecryptionFailure()) return;
        await request(event, true);
    };

    const onDecrypted = (event: MatrixEvent): void => {
        if (!isMissingRoomKey(event)) return;
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (!isMissingRoomKey(event)) return;
            request(event).catch((err) =>
                console.warn("[key-backfill] request failed", err),
            );
        }, REQUEST_DELAY_MS);
        timers.add(timer);
    };

    client.on(
        ClientEvent.ReceivedToDeviceMessage as never,
        onToDevice as never,
    );
    client.on(MatrixEventEvent.Decrypted as never, onDecrypted as never);
    client.on(CryptoEvent.DevicesUpdated as never, onDevicesUpdated as never);
    client.on(
        CryptoEvent.UserTrustStatusChanged as never,
        onUserTrust as never,
    );
    client.on(
        CryptoEvent.KeyBackupDecryptionKeyCached as never,
        onBackupKey as never,
    );
    onTrustChange();
    return () => {
        client.off(
            ClientEvent.ReceivedToDeviceMessage as never,
            onToDevice as never,
        );
        client.off(MatrixEventEvent.Decrypted as never, onDecrypted as never);
        client.off(
            CryptoEvent.DevicesUpdated as never,
            onDevicesUpdated as never,
        );
        client.off(
            CryptoEvent.UserTrustStatusChanged as never,
            onUserTrust as never,
        );
        client.off(
            CryptoEvent.KeyBackupDecryptionKeyCached as never,
            onBackupKey as never,
        );
        manualRequest = null;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        // Zami: queued retries for this client stop here.
        retries.abort();
        exporter.clear();
    };
}
