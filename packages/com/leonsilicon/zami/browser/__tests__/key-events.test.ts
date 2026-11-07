import type { KeyPress } from "@-/com.leonsilicon.zami.keyboard";
import { describe, expect, test } from "vite-plus/test";
import { createEventHub } from "#events";
import { createKeyDispatcher, createKeyEvent, legacyKeyCode, type KeyHandlers } from "#key-events";

function press(fields: Partial<KeyPress> & { key: string }): KeyPress {
  return {
    type: "keydown",
    code: "",
    keyCode: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    ...fields,
  };
}

function setup() {
  const document = createEventHub();
  const window = createEventHub();
  const body = { tagName: "BODY" };
  let focused: unknown = null;
  const dispatcher = createKeyDispatcher({
    focusedInput: () => focused,
    body: () => body,
    document,
    window,
    now: () => 1234,
  });
  return {
    dispatcher,
    document,
    window,
    body,
    focus: (input: unknown) => (focused = input),
  };
}

describe("createKeyEvent", () => {
  test("has a KeyboardEvent's fields", () => {
    const { event } = createKeyEvent(
      press({ key: "k", code: "KeyK", keyCode: 0x0e, metaKey: true }),
      "target",
      5,
    );
    expect(event).toMatchObject({
      type: "keydown",
      key: "k",
      code: "KeyK",
      keyCode: 75,
      which: 75,
      metaKey: true,
      ctrlKey: false,
      repeat: false,
      isComposing: false,
      target: "target",
      timeStamp: 5,
      defaultPrevented: false,
    });
    expect(event.getModifierState("Meta")).toBe(true);
    expect(event.getModifierState("Shift")).toBe(false);
  });

  test("preventDefault marks the event and the copy it's called on", () => {
    const { event, state } = createKeyEvent(press({ key: "Enter", code: "Enter" }), null, 0);
    const copy = { ...event };
    copy.preventDefault();
    expect(copy.defaultPrevented).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(state.defaultPrevented).toBe(true);
  });
});

describe("legacyKeyCode", () => {
  test.each([
    ["a", "KeyA", 65],
    ["Z", "KeyZ", 90],
    ["1", "Digit1", 49],
    ["0", "Digit0", 48],
    ["Enter", "Enter", 13],
    ["Enter", "NumpadEnter", 13],
    ["Escape", "Escape", 27],
    ["Tab", "Tab", 9],
    ["ArrowUp", "ArrowUp", 38],
    ["ArrowDown", "ArrowDown", 40],
    [" ", "Space", 32],
    ["Shift", "ShiftRight", 16],
    ["F5", "Unidentified", 116],
    ["/", "Slash", 191],
    ["'", "Quote", 222],
    ["PageUp", "Unidentified", 33],
  ])("%s (%s) is %i", (key, code, expected) => {
    expect(legacyKeyCode(key, code)).toBe(expected);
  });
});

describe("createKeyDispatcher", () => {
  test("goes through capture, the focused input, its containers, document, then window", () => {
    const { dispatcher, document, window, focus } = setup();
    const input = { name: "composer" };
    const order: string[] = [];
    window.addEventListener("keydown", () => order.push("window"));
    document.addEventListener("keydown", () => order.push("document"));
    dispatcher.addCaptureListener("keydown", () => order.push("capture"));
    dispatcher.addInputHandlers(
      () => input,
      () => ({ onKeydown: () => order.push("input") }),
    );
    dispatcher.addInputHandlers(
      () => ({ name: "other" }),
      () => ({ onKeydown: () => order.push("other input") }),
    );
    dispatcher.addScope(
      (focused) => focused === input,
      () => ({ onKeydown: () => order.push("outer") }),
    );
    dispatcher.addScope(
      (focused) => focused === input,
      () => ({ onKeydown: () => order.push("inner") }),
    );
    dispatcher.addScope(
      () => false,
      () => ({ onKeydown: () => order.push("elsewhere") }),
    );
    focus(input);
    dispatcher.dispatch(press({ key: "a", code: "KeyA" }));
    expect(order).toEqual(["capture", "input", "inner", "outer", "document", "window"]);
  });

  test("the target is a textarea while an input has focus, and body otherwise", () => {
    const { dispatcher, window, body, focus } = setup();
    const targets: unknown[] = [];
    window.addEventListener("keydown", (e: KeyboardEvent) => targets.push(e.target));
    dispatcher.dispatch(press({ key: "a", code: "KeyA" }));
    const input = { focus() {} };
    focus(input);
    dispatcher.dispatch(press({ key: "a", code: "KeyA" }));
    expect(targets[0]).toBe(body);
    expect(targets[1]).toMatchObject({ tagName: "TEXTAREA", isContentEditable: false, input });
  });

  test("with nothing focused, only the newest container gets the press", () => {
    const { dispatcher } = setup();
    const got: string[] = [];
    const scope =
      (name: string): (() => KeyHandlers) =>
      () => ({
        onKeydown: () => got.push(name),
      });
    dispatcher.addScope(() => true, scope("older"));
    const remove = dispatcher.addScope(() => true, scope("newer"));
    dispatcher.dispatch(press({ key: "Escape", code: "Escape" }));
    remove();
    dispatcher.dispatch(press({ key: "Escape", code: "Escape" }));
    expect(got).toEqual(["newer", "older"]);
  });

  test("stopPropagation ends the press after the phase; preventDefault carries on", () => {
    const { dispatcher, document, window } = setup();
    let windowSaw: boolean | null = null;
    window.addEventListener("keydown", (e: KeyboardEvent) => (windowSaw = e.defaultPrevented));
    document.addEventListener("keydown", (e: KeyboardEvent) => e.preventDefault());
    const event = dispatcher.dispatch(press({ key: "Enter", code: "Enter" }));
    expect(windowSaw).toBe(true);
    expect(event.defaultPrevented).toBe(true);

    windowSaw = null;
    const calls: string[] = [];
    const removeA = dispatcher.addCaptureListener("keydown", (e) => {
      calls.push("a");
      e.stopPropagation();
    });
    const removeB = dispatcher.addCaptureListener("keydown", () => calls.push("b"));
    dispatcher.dispatch(press({ key: "x", code: "KeyX" }));
    expect(calls).toEqual(["a", "b"]);
    expect(windowSaw).toBe(null);
    removeA();
    removeB();

    dispatcher.addCaptureListener("keydown", (e) => {
      calls.push("c");
      e.stopImmediatePropagation();
    });
    dispatcher.addCaptureListener("keydown", () => calls.push("d"));
    dispatcher.dispatch(press({ key: "x", code: "KeyX" }));
    expect(calls).toEqual(["a", "b", "c"]);
  });

  test("a preventDefault in a hub is seen by that hub's later listeners", () => {
    const { dispatcher, window } = setup();
    const seen: boolean[] = [];
    window.addEventListener("keydown", (e: KeyboardEvent) => e.preventDefault());
    window.addEventListener("keydown", (e: KeyboardEvent) => seen.push(e.defaultPrevented));
    dispatcher.dispatch(press({ key: "k", code: "KeyK", metaKey: true }));
    expect(seen).toEqual([true]);
  });

  test("keyup goes to onKeyup", () => {
    const { dispatcher, focus } = setup();
    const input = {};
    focus(input);
    const got: string[] = [];
    dispatcher.addInputHandlers(
      () => input,
      () => ({
        onKeydown: (e) => got.push(`down ${e.key}`),
        onKeyup: (e) => got.push(`up ${e.key}`),
      }),
    );
    dispatcher.dispatch(press({ key: "a", code: "KeyA" }));
    dispatcher.dispatch(press({ type: "keyup", key: "a", code: "KeyA" }));
    expect(got).toEqual(["down a", "up a"]);
  });

  test("tracks the modifiers held and whether a hardware keyboard is in use", () => {
    const { dispatcher } = setup();
    let changes = 0;
    dispatcher.onHardwareKeyboardChange(() => changes++);
    expect(dispatcher.hardwareKeyboard()).toBe(false);
    dispatcher.dispatch(press({ key: "Shift", code: "ShiftLeft", shiftKey: true }));
    expect(dispatcher.hardwareKeyboard()).toBe(true);
    expect(dispatcher.isModifierHeld("Shift")).toBe(true);
    dispatcher.dispatch(press({ key: "A", code: "KeyA", shiftKey: true }));
    expect(dispatcher.isModifierHeld("Shift")).toBe(true);
    dispatcher.dispatch(press({ type: "keyup", key: "Shift", code: "ShiftLeft" }));
    expect(dispatcher.isModifierHeld("Shift")).toBe(false);
    dispatcher.dispatch(press({ key: "Control", code: "ControlLeft", ctrlKey: true }));
    dispatcher.releaseAll();
    expect(dispatcher.isModifierHeld("Control")).toBe(false);
    dispatcher.softwareKeyboardShown();
    expect(dispatcher.hardwareKeyboard()).toBe(false);
    expect(changes).toBe(2);
  });

  test("a listener that throws doesn't stop the others", () => {
    const { dispatcher, window } = setup();
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      let reached = false;
      dispatcher.addCaptureListener("keydown", () => {
        throw new Error("boom");
      });
      window.addEventListener("keydown", () => (reached = true));
      dispatcher.dispatch(press({ key: "a", code: "KeyA" }));
      expect(reached).toBe(true);
      expect(errors).toHaveLength(1);
    } finally {
      console.error = original;
    }
  });
});
