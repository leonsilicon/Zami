# @-/com.leonsilicon.zami.crypto-work

Keeps the end-to-end encryption's bulk work from freezing the app.

On React Native, matrix-js-sdk's Rust crypto engine (`react-native-matrix-sdk-crypto-wasm`,
wasm2c over JSI) and its IndexedDB store run on the JS thread, and nothing yields between a
call's microtasks. A call that grows with the account or the room, or a burst of thousands of
small calls, holds the thread until it's done. This package is the interim answer, until the
engine runs on a thread of its own:

- **`cryptoQueue`**: the one sliced queue (`@-/com.leonsilicon.zami.scheduler`, 8 ms per
  turn) for every backlog of crypto calls: queued decryption, retries after trust changes
  (`queueRetries`), identity and device-trust lookups, key-request answers. Priorities are
  timestamps, so the newest work goes first; `interactivePriority()` is "now". Pass an
  `AbortSignal` to drop work that stopped mattering (the room was left).
- **`sliceEngineWork(rustCrypto, { DeviceLists })`**: splits matrix-js-sdk's long engine calls
  where the work is a list the engine can take in parts: a sync's to-device messages, one-time
  key claims for a large room, and key backup decryption and import. Same calls, same order,
  smaller parts, a turn of the event loop between them. It also gathers the SDK's one-user
  device-tracking calls (one per member applied to an encrypted room) into a few calls on the
  queue. `waitForSlicedEngineWork` tells a background release to wait for a split sequence to
  finish.
- **`createVersionedCache`**: trust answers cached until a change event, refusing an answer
  that was looked up before the event.
- **Key export files**: `countJsonKey` and `splitJsonArray` read a key list without one
  `JSON.parse` of the whole; `encodeBase64Lines`, `decodeBase64Lines` and `aesCtrInPieces` do
  the file format's base64 armour and AES-CTR a piece at a time.
- **Key requests**: `probeOwnSession` tells with one store lookup whether this device created
  a room key, and `createOwnKeyExporter` makes requests that arrived together share one export.

## What it can't split

These are single engine calls with a single result, so they still hold the JS thread for as
long as they take (measured with the official engine in Node, V8, IndexedDB store; a phone is
two to three times slower):

| Call                                                              | Cost                |
| ----------------------------------------------------------------- | ------------------- |
| `shareRoomKey`, a new room key for a 2,000-member room            | 0.47 s              |
| `shareRoomKey`, the same room, key already shared (every send)    | 0.10 s              |
| a `/keys/query` response (the engine sends 250 users per request) | 0.06 s              |
| `exportRoomKeys` (any predicate: it loads every session)          | 0.31 ms per session |

Splitting `shareRoomKey` by users would make the engine rotate the session (it reads users
missing from the list as users who left). The fix for all of them is running the engine and its
store on a thread of their own, behind an asynchronous interface.
