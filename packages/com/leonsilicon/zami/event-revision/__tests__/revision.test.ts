import {
  EventStatus,
  MatrixEvent,
  MatrixEventEvent,
  Relations,
  RelationsEvent,
} from "matrix-js-sdk";
import { flushSync } from "svelte";
import { describe, expect, test } from "vite-plus/test";
import { bumpEventRevision, eventRevision, relationsRevision } from "#revision";
import type { RelationsSource } from "#revision";
import { watch } from "./watch.svelte";

function message(id: string, content: Record<string, unknown> = { msgtype: "m.text" }) {
  return new MatrixEvent({
    event_id: id,
    type: "m.room.message",
    sender: "@alice:example.org",
    room_id: "!room:example.org",
    origin_server_ts: 1,
    content,
  });
}

function reaction(id: string, targetId: string, key: string) {
  return new MatrixEvent({
    event_id: id,
    type: "m.reaction",
    sender: "@bob:example.org",
    room_id: "!room:example.org",
    origin_server_ts: 2,
    content: { "m.relates_to": { rel_type: "m.annotation", event_id: targetId, key } },
  });
}

/** Lets the readers' teardowns, which Svelte runs a microtask later, finish. */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("eventRevision", () => {
  test("re-runs a reader when its own event changes, and not for another event", () => {
    const event = message("$a");
    const other = message("$b");
    const reader = watch(() => eventRevision(event));
    const first = reader.value();
    expect(reader.runs()).toBe(1);
    other.setStatus(EventStatus.SENT);
    flushSync();
    expect(reader.runs()).toBe(1);
    event.setStatus(EventStatus.SENT);
    flushSync();
    expect(reader.runs()).toBe(2);
    expect(reader.value()).not.toBe(first);
    reader.stop();
  });

  test("a reader that starts again sees a new revision, whatever changed unheard", async () => {
    const event = message("$a");
    const first = watch(() => eventRevision(event));
    const before = first.value();
    first.stop();
    await settle();
    event.setStatus(EventStatus.SENT);
    const second = watch(() => eventRevision(event));
    expect(second.value()).not.toBe(before);
    second.stop();
  });

  test("moves on decryption, edits, a new id, redaction and a first relation", () => {
    const event = message("~local");
    const reader = watch(() => eventRevision(event));
    const changes: (() => void)[] = [
      () => event.emit(MatrixEventEvent.Decrypted, event),
      () => event.makeReplaced(message("$edit")),
      () => event.replaceLocalEventId("$real"),
      () => event.markLocallyRedacted(message("$redaction")),
      () => event.emit(MatrixEventEvent.RelationsCreated, "m.annotation", "m.reaction"),
    ];
    for (const [i, change] of changes.entries()) {
      change();
      flushSync();
      expect(reader.runs()).toBe(i + 2);
    }
    reader.stop();
  });

  test("follows an edit that decrypts after it was applied", () => {
    const event = message("$a");
    const edit = message("$edit");
    const reader = watch(() => eventRevision(event));
    event.makeReplaced(edit);
    flushSync();
    expect(reader.runs()).toBe(2);
    edit.emit(MatrixEventEvent.Decrypted, edit);
    flushSync();
    expect(reader.runs()).toBe(3);
    reader.stop();
  });

  test("listens while read, once for all readers, and stops with the last", async () => {
    const event = message("$a");
    const first = watch(() => eventRevision(event));
    const second = watch(() => eventRevision(event));
    expect(event.listenerCount(MatrixEventEvent.Status)).toBe(1);
    first.stop();
    await settle();
    expect(event.listenerCount(MatrixEventEvent.Status)).toBe(1);
    second.stop();
    await settle();
    expect(event.listenerCount(MatrixEventEvent.Status)).toBe(0);
    expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });

  test("outside an effect, returns the count without listening", () => {
    const event = message("$a");
    expect(eventRevision(event)).toBe(0);
    expect(event.listenerCount(MatrixEventEvent.Status)).toBe(0);
  });

  test("bumpEventRevision moves it by hand", () => {
    const event = message("$a");
    const reader = watch(() => eventRevision(event));
    bumpEventRevision(event);
    flushSync();
    expect(reader.runs()).toBe(2);
    reader.stop();
  });
});

describe("relationsRevision", () => {
  function setup() {
    const collections = new Map<string, Relations>();
    const source: RelationsSource = {
      getChildEventsForEvent: (eventId, relationType, eventType) =>
        collections.get(`${eventId}|${relationType}|${eventType}`),
    };
    /** Creates the collection, as the SDK does on the first relation. */
    const collection = (target: MatrixEvent) => {
      const relations = new Relations("m.annotation", "m.reaction", {} as never);
      collections.set(`${target.getId()}|m.annotation|m.reaction`, relations);
      void relations.setTargetEvent(target);
      return relations;
    };
    return { source, collection };
  }

  test("follows reactions, from the first one", () => {
    const { source, collection } = setup();
    const target = message("$t");
    const reader = watch(() => relationsRevision(source, target, "m.annotation", ["m.reaction"]));
    const relations = collection(target);
    void relations.addEvent(reaction("$r1", "$t", "👍"));
    flushSync();
    expect(reader.runs()).toBe(2);
    void relations.addEvent(reaction("$r2", "$t", "🎉"));
    flushSync();
    expect(reader.runs()).toBe(3);
    reader.stop();
  });

  test("follows a reaction of ours until it is sent", () => {
    const { source, collection } = setup();
    const target = message("$t");
    const relations = collection(target);
    const mine = reaction("~txn", "$t", "👍");
    mine.setStatus(EventStatus.SENDING);
    void relations.addEvent(mine);
    const reader = watch(() => relationsRevision(source, target, "m.annotation", ["m.reaction"]));
    mine.setStatus(EventStatus.SENT);
    flushSync();
    expect(reader.runs()).toBe(2);
    mine.setStatus(null);
    flushSync();
    expect(reader.runs()).toBe(3);
    expect(mine.listenerCount(MatrixEventEvent.Status)).toBe(0);
    reader.stop();
  });

  test("ignores other kinds of relation and other events", () => {
    const { source, collection } = setup();
    const target = message("$t");
    const other = message("$o");
    const reader = watch(() => relationsRevision(source, target, "m.annotation", ["m.reaction"]));
    target.emit(MatrixEventEvent.RelationsCreated, "m.reference", "m.poll.response");
    void collection(other).addEvent(reaction("$r", "$o", "👍"));
    flushSync();
    expect(reader.runs()).toBe(1);
    reader.stop();
  });

  test("stops listening with the last reader", async () => {
    const { source, collection } = setup();
    const target = message("$t");
    const relations = collection(target);
    const reader = watch(() => relationsRevision(source, target, "m.annotation", ["m.reaction"]));
    expect(relations.listenerCount(RelationsEvent.Add)).toBe(1);
    reader.stop();
    await settle();
    expect(relations.listenerCount(RelationsEvent.Add)).toBe(0);
    expect(target.listenerCount(MatrixEventEvent.RelationsCreated)).toBe(0);
  });
});
