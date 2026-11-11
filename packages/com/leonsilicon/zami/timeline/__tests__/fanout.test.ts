import { describe, expect, test } from "vite-plus/test";
import { createFanout } from "#fanout";
import { movesOthersReceipts, publicReceiptReaders } from "#receipts";

function harness() {
  let attached: ((...args: [string, number]) => void) | null = null;
  let factsMade = 0;
  const fanout = createFanout<[string, number], { upper: string }>({
    facts: (s) => {
      factsMade++;
      return { upper: s.toUpperCase() };
    },
    attach: (emit) => (attached = emit),
    detach: () => (attached = null),
  });
  return { fanout, attached: () => attached, factsMade: () => factsMade };
}

describe("createFanout", () => {
  test("attaches on the first subscriber and detaches after the last", () => {
    const h = harness();
    expect(h.attached()).toBeNull();
    const a = h.fanout.add(() => {});
    const b = h.fanout.add(() => {});
    expect(h.attached()).toBe(h.fanout.emit);
    a();
    a();
    expect(h.attached()).not.toBeNull();
    b();
    expect(h.attached()).toBeNull();
    expect(h.fanout.size).toBe(0);
  });

  test("makes the facts once and runs a shared classifier once per event", () => {
    const h = harness();
    let classified = 0;
    const classify = (facts: { upper: string }, s: string, n: number) => {
      classified++;
      return n > 0 ? ([facts.upper, s] as [string, string]) : null;
    };
    const got: string[] = [];
    h.fanout.addClassified(classify, (upper, s) => got.push(`1:${upper}:${s}`));
    h.fanout.addClassified<[string, string]>(classify, (upper) => got.push(`2:${upper}`));
    h.fanout.add((facts, s, n) => got.push(`raw:${facts.upper}:${s}:${n}`));
    h.fanout.emit("a", 1);
    h.fanout.emit("b", 0);
    expect(classified).toBe(2);
    expect(h.factsMade()).toBe(2);
    expect(got).toEqual(["1:A:a", "2:A", "raw:A:a:1", "raw:B:b:0"]);
  });

  test("subscribers with the same key share the first one's result", () => {
    const h = harness();
    let classified = 0;
    const make = (tag: string) => (facts: { upper: string }) => {
      classified++;
      return [`${tag}:${facts.upper}`] as [string];
    };
    const got: string[] = [];
    h.fanout.addClassified(make("first"), (r) => got.push(`a ${r}`), "k");
    h.fanout.addClassified(make("second"), (r) => got.push(`b ${r}`), "k");
    h.fanout.emit("x", 1);
    expect(classified).toBe(1);
    expect(got).toEqual(["a first:X", "b first:X"]);
  });

  test("a throwing subscriber doesn't keep the event from the others", () => {
    const h = harness();
    const got: string[] = [];
    h.fanout.add(() => {
      throw new Error("first");
    });
    h.fanout.add((_f, s) => got.push(s));
    expect(() => h.fanout.emit("x", 1)).toThrow("first");
    expect(got).toEqual(["x"]);
  });

  test("a subscriber removed mid-emit still gets that event, not the next", () => {
    const h = harness();
    const got: string[] = [];
    let removeB = () => {};
    h.fanout.add(() => removeB());
    removeB = h.fanout.add((_f, s) => got.push(s));
    h.fanout.emit("x", 1);
    h.fanout.emit("y", 1);
    expect(got).toEqual(["x"]);
  });
});

describe("receipts", () => {
  const content = {
    $e1: { "m.read": { "@me:hs": { ts: 1 } }, "m.read.private": { "@me:hs": { ts: 1 } } },
    $e2: { "m.read": { "@bob:hs": { ts: 2 } } },
  };

  test("publicReceiptReaders lists the m.read readers", () => {
    expect([...publicReceiptReaders(content)]).toEqual(["@me:hs", "@bob:hs"]);
    expect(publicReceiptReaders(undefined).size).toBe(0);
  });

  test("movesOthersReceipts ignores the user's own and private receipts", () => {
    expect(movesOthersReceipts(content, "@me:hs")).toBe(true);
    expect(
      movesOthersReceipts(
        { $e1: { "m.read": { "@me:hs": {} }, "m.read.private": { "@me:hs": {} } } },
        "@me:hs",
      ),
    ).toBe(false);
  });
});
