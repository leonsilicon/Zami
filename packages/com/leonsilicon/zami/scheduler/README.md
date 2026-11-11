# @-/com.leonsilicon.zami.scheduler

Runs a backlog of async tasks a few milliseconds per turn of the event loop, highest priority
first.

React Native draws a frame only between tasks of the JS event loop, and a promise chain never
gives up its turn: a burst of thousands of small async jobs (decrypting every unread message of
a large account at launch) keeps the screen frozen until the last one is done. A sliced queue
runs them one at a time for at most `sliceMs`, then waits for the next turn (`setTimeout(0)`),
so the app keeps drawing and responding.

```ts
const queue = createSlicedQueue({ sliceMs: 8 });
await queue.add(() => decrypt(event), event.getTs()); // newest first
```

Tasks with equal priority run in the order they were added. A task's result or error reaches
the promise `add` returned; it never stops the queue.

A task can be dropped before it starts by passing an `AbortSignal`; its promise then rejects
with the signal's reason. Use it for work that only matters while something is on screen
(the identity checks of the room being viewed):

```ts
const controller = new AbortController();
void queue.add(() => check(userId), Date.now(), { signal: controller.signal });
controller.abort(); // the user left the room
```

Every `createSlicedQueue` call with the same `name` returns the same queue, so independent
callers (decryption in the client, retries and trust lookups in crypto) share one time budget
per turn instead of each taking their own. The first call's options apply.
