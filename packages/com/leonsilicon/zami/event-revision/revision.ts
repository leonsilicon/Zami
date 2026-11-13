import type { MatrixEvent, Relations } from "matrix-js-sdk";
import { createSubscriber } from "svelte/reactivity";

/**
 * What matrix-js-sdk emits on a `MatrixEvent` itself when what it renders changes
 * (`MatrixEventEvent`). Emitted on the event, so a listener hears its own event and no
 * other: one decryption in another room costs a row nothing.
 */
const EVENT_CHANGES = [
  // Decrypted, or failed to (the failure reason changed).
  "Event.decrypted",
  // An edit was applied or taken back.
  "Event.replaced",
  // A local echo's send status.
  "Event.status",
  // A local echo got its real id.
  "Event.localEventIdReplaced",
  // Redacted: the SDK clears the content in place right after, synchronously, and the
  // readers run in a later microtask.
  "Event.beforeRedaction",
  // Hidden or shown again (MSC3531).
  "Event.visibilityChange",
  // Its first relation of a kind (the first reaction, the first edit or thread reply).
  "Event.relationsCreated",
] as const;

const DECRYPTED = "Event.decrypted";
const REPLACED = "Event.replaced";
const STATUS = "Event.status";
const LOCAL_ID_REPLACED = "Event.localEventIdReplaced";
const RELATIONS_CREATED = "Event.relationsCreated";

/** What a `Relations` collection emits when its events change (`RelationsEvent`). */
const RELATIONS_ADD = "Relations.add";
const RELATIONS_CHANGES = [RELATIONS_ADD, "Relations.remove", "Relations.redaction"] as const;

/** The part of a room's `RelationsContainer` (`room.relations`) this reads. */
export interface RelationsSource {
  getChildEventsForEvent(
    eventId: string,
    relationType: string,
    eventType: string,
  ): Relations | undefined;
}

type Listener = (...args: never[]) => void;
type Emitter = {
  on(name: string, listener: Listener): unknown;
  off(name: string, listener: Listener): unknown;
};
/** matrix-js-sdk's typed emitters, as plain ones. */
const emitter = (target: MatrixEvent | Relations): Emitter => target as unknown as Emitter;

/**
 * A counter that rune readers follow. It subscribes to its source (`start`) while an
 * effect reads it (Svelte's `createSubscriber` counts the readers), and every change moves
 * the count and re-runs those effects.
 */
interface Revision {
  read(): number;
  bump(): void;
}

function createRevision(start: (changed: () => void) => () => void): Revision {
  let count = 0;
  let update: (() => void) | undefined;
  const bump = () => {
    count++;
    update?.();
  };
  const subscribe = createSubscriber((rerun) => {
    update = rerun;
    // Nothing listened since the last reader left, so the source may have changed
    // unseen: a reader that starts again (a `PauseRunes` resuming) must not take
    // the old count for "unchanged".
    count++;
    const stop = start(bump);
    return () => {
      update = undefined;
      stop();
    };
  });
  return {
    read() {
      subscribe();
      return count;
    },
    bump,
  };
}

const eventRevisions = new WeakMap<MatrixEvent, Revision>();

function watchEvent(event: MatrixEvent, changed: () => void): () => void {
  const source = emitter(event);
  // An edit's content is the edit's own: an edit that decrypts after it was applied (its
  // key came later) changes this event's text with nothing emitted on this event.
  let replacement: MatrixEvent | null = null;
  const followReplacement = () => {
    const next = event.replacingEvent();
    if (next === replacement) return;
    if (replacement) emitter(replacement).off(DECRYPTED, changed);
    replacement = next;
    if (replacement) emitter(replacement).on(DECRYPTED, changed);
  };
  const onReplaced = () => {
    followReplacement();
    changed();
  };
  for (const name of EVENT_CHANGES) source.on(name, name === REPLACED ? onReplaced : changed);
  followReplacement();
  return () => {
    for (const name of EVENT_CHANGES) source.off(name, name === REPLACED ? onReplaced : changed);
    if (replacement) emitter(replacement).off(DECRYPTED, changed);
    replacement = null;
  };
}

/**
 * A number that moves whenever `event` changes how it renders: it decrypts (or fails to),
 * is edited, changes send status or gets its real id (a local echo), is redacted or
 * hidden, or gets its first relation of a kind. matrix-js-sdk mutates a `MatrixEvent` in
 * place, so a reader can't see these by its identity.
 *
 * Read it in a rune reader (a `useRune` getter) to follow one event instead of a global
 * tick: `useRune(() => eventRevision(event), [event])`. While read, it listens on that
 * event only; with no reader left it stops. Outside an effect it just returns the count.
 */
export function eventRevision(event: MatrixEvent): number {
  let revision = eventRevisions.get(event);
  if (!revision) {
    revision = createRevision((changed) => watchEvent(event, changed));
    eventRevisions.set(event, revision);
  }
  return revision.read();
}

/** Moves `event`'s revision by hand, for a change matrix-js-sdk doesn't emit on it. */
export function bumpEventRevision(event: MatrixEvent): void {
  eventRevisions.get(event)?.bump();
}

const relationsRevisions = new WeakMap<MatrixEvent, Map<string, Revision>>();

function watchRelations(
  source: RelationsSource,
  event: MatrixEvent,
  relationType: string,
  eventTypes: readonly string[],
  changed: () => void,
): () => void {
  const collections = new Set<Relations>();
  // Our own relation events still being sent: their status and id show (a reaction of
  // ours can be taken back only once it has its real id), and Relations doesn't emit
  // for either.
  const sending = new Set<MatrixEvent>();
  const onSendingChange = (related: MatrixEvent) => {
    if (!related.isSending()) unwatchSending(related);
    changed();
  };
  const watchSending = (related: MatrixEvent) => {
    if (!related.isSending() || sending.has(related)) return;
    sending.add(related);
    emitter(related).on(STATUS, onSendingChange);
  };
  const unwatchSending = (related: MatrixEvent) => {
    if (!sending.delete(related)) return;
    emitter(related).off(STATUS, onSendingChange);
  };
  const onAdd = (related: MatrixEvent) => {
    watchSending(related);
    changed();
  };
  const handler = (name: string): Listener => (name === RELATIONS_ADD ? onAdd : changed);
  // Collections are created on the first relation, and keyed by the event's id, which a
  // local echo swaps for its real one.
  const attach = () => {
    const id = event.getId();
    if (!id) return;
    for (const eventType of eventTypes) {
      const collection = source.getChildEventsForEvent(id, relationType, eventType);
      if (!collection || collections.has(collection)) continue;
      collections.add(collection);
      for (const name of RELATIONS_CHANGES) emitter(collection).on(name, handler(name));
      for (const related of collection.getRelations()) watchSending(related);
    }
  };
  const onCreated = (createdType: string, createdEventType: string) => {
    if (createdType !== relationType || !eventTypes.includes(createdEventType)) return;
    attach();
    changed();
  };
  const onIdReplaced = () => {
    attach();
    changed();
  };
  emitter(event).on(RELATIONS_CREATED, onCreated as Listener);
  emitter(event).on(LOCAL_ID_REPLACED, onIdReplaced);
  attach();
  return () => {
    emitter(event).off(RELATIONS_CREATED, onCreated as Listener);
    emitter(event).off(LOCAL_ID_REPLACED, onIdReplaced);
    for (const collection of collections) {
      for (const name of RELATIONS_CHANGES) emitter(collection).off(name, handler(name));
    }
    collections.clear();
    for (const related of sending) emitter(related).off(STATUS, onSendingChange);
    sending.clear();
  };
}

/**
 * A number that moves whenever the relations of `relationType` and one of `eventTypes`
 * to `event` change: one is added, removed or redacted, or one of ours being sent changes
 * status. `source` is the room's `RelationsContainer` (`room.relations`).
 *
 * `eventRevision` for the relations of one kind, so the reactions under a message follow
 * that message's reactions only: `relationsRevision(room.relations, event,
 * "m.annotation", ["m.reaction"])`.
 */
export function relationsRevision(
  source: RelationsSource,
  event: MatrixEvent,
  relationType: string,
  eventTypes: readonly string[],
): number {
  let byKind = relationsRevisions.get(event);
  if (!byKind) {
    byKind = new Map();
    relationsRevisions.set(event, byKind);
  }
  const key = `${relationType}\u0000${eventTypes.join("\u0000")}`;
  let revision = byKind.get(key);
  if (!revision) {
    revision = createRevision((changed) =>
      watchRelations(source, event, relationType, eventTypes, changed),
    );
    byKind.set(key, revision);
  }
  return revision.read();
}
