// Hardware key presses as a browser delivers them, without React Native (so Node's tests
// run it): each press from @-/com.leonsilicon.zami.keyboard becomes a KeyboardEvent-like
// object that goes through a browser's phases, in this order:
//
//   1. capture listeners on `window` (`addEventListener(type, l, true)`);
//   2. the focused input's own `onkeydown`/`onkeyup` (the target);
//   3. the containers around it (a dialog's or a picker's `onkeydown`), innermost first.
//      With nothing focused, the topmost container gets the press, as the dialog a
//      browser's focus trap would have focused into;
//   4. `document`'s listeners, then `window`'s (bubbling).
//
// `stopPropagation()` ends the press after the current phase, `stopImmediatePropagation()`
// at once. `preventDefault()` only marks the event: the module observes presses, so the
// text field has already taken the key, and code that cancels a key's typing deals with
// the text it typed.
import type { KeyPress } from "@-/com.leonsilicon.zami.keyboard";

export type KeyType = "keydown" | "keyup";

/** The KeyboardEvent fields and methods Zam's handlers use. */
export interface ZamiKeyboardEvent {
  type: KeyType;
  key: string;
  code: string;
  /** The legacy DOM key code (13 for Enter), not the HID usage. */
  keyCode: number;
  which: number;
  charCode: number;
  location: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  bubbles: boolean;
  cancelable: boolean;
  timeStamp: number;
  /** The focused input (a stand-in `<textarea>`), or `document.body`. */
  target: unknown;
  currentTarget: unknown;
  srcElement: unknown;
  defaultPrevented: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
  stopImmediatePropagation: () => void;
  getModifierState: (key: string) => boolean;
}

/** What a key listener gets: typed as the DOM's event, which Zam's handlers take. */
export type KeyListener = (event: KeyboardEvent) => void;

export interface KeyHandlers {
  onKeydown?: KeyListener;
  onKeyup?: KeyListener;
}

/** `document`'s and `window`'s listeners (#events' hubs). */
export interface KeyHub {
  dispatch: (type: string, detail?: Record<string, unknown>) => void;
}

/**
 * The element a focused text input stands for: a `<textarea>`, so Zam's "is the user
 * typing?" checks (`tagName === "TEXTAREA"`) see one. `input` is the TextInput itself.
 */
export function inputTarget(input: unknown): Record<string, unknown> {
  return {
    tagName: "TEXTAREA",
    nodeName: "TEXTAREA",
    nodeType: 1,
    localName: "textarea",
    isContentEditable: false,
    input,
    dataset: {},
    getAttribute: (): null => null,
    hasAttribute: (): boolean => false,
    closest: (): null => null,
    matches: (): boolean => false,
    contains: (other: unknown): boolean => other === input,
    focus: (): void => (input as { focus?: () => void } | null)?.focus?.(),
    blur: (): void => (input as { blur?: () => void } | null)?.blur?.(),
  };
}

const NAMED_KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  NumpadEnter: 13,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  AltLeft: 18,
  AltRight: 18,
  CapsLock: 20,
  Escape: 27,
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
  MetaLeft: 91,
  MetaRight: 93,
  Semicolon: 186,
  Equal: 187,
  Comma: 188,
  Minus: 189,
  Period: 190,
  Slash: 191,
  Backquote: 192,
  BracketLeft: 219,
  Backslash: 220,
  BracketRight: 221,
  Quote: 222,
};

const KEY_CODES_BY_KEY: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  CapsLock: 20,
  Escape: 27,
  " ": 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
  Meta: 91,
};

/** A key's legacy DOM `keyCode`, from its `code` (or its `key` for unidentified codes). */
export function legacyKeyCode(key: string, code: string): number {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!.charCodeAt(0);
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return 48 + Number(digit[1]);
  const fn = /^F(\d{1,2})$/.exec(key);
  if (fn) return 111 + Number(fn[1]);
  return NAMED_KEY_CODES[code] ?? KEY_CODES_BY_KEY[key] ?? 0;
}

const MODIFIER_KEYS: Record<string, "shiftKey" | "ctrlKey" | "altKey" | "metaKey"> = {
  Shift: "shiftKey",
  Control: "ctrlKey",
  Alt: "altKey",
  Meta: "metaKey",
};

interface DispatchState {
  defaultPrevented: boolean;
  stopped: boolean;
  immediate: boolean;
}

/**
 * The event for a press. Its fields are its own and enumerable, and its methods read
 * the press's shared state through closures, so the copies #events' hubs make of it
 * (`{ type, ...detail }`) behave as the same event.
 */
export function createKeyEvent(
  press: KeyPress,
  target: unknown,
  timeStamp: number,
  capsLock = false,
): { event: ZamiKeyboardEvent; state: DispatchState } {
  const state: DispatchState = { defaultPrevented: false, stopped: false, immediate: false };
  const keyCode = legacyKeyCode(press.key, press.code);
  const event: ZamiKeyboardEvent = {
    type: press.type,
    key: press.key,
    code: press.code,
    keyCode,
    which: keyCode,
    charCode: 0,
    location: /(Left)$/.test(press.code) ? 1 : /(Right)$/.test(press.code) ? 2 : 0,
    shiftKey: press.shiftKey,
    ctrlKey: press.ctrlKey,
    altKey: press.altKey,
    metaKey: press.metaKey,
    repeat: press.repeat,
    isComposing: false,
    bubbles: true,
    cancelable: true,
    timeStamp,
    target,
    currentTarget: null,
    srcElement: target,
    defaultPrevented: false,
    preventDefault(this: { defaultPrevented?: boolean } | undefined) {
      state.defaultPrevented = true;
      event.defaultPrevented = true;
      // The copy the listener was handed, which the hub's later listeners read.
      if (this !== undefined && this !== null && typeof this === "object") {
        this.defaultPrevented = true;
      }
    },
    stopPropagation() {
      state.stopped = true;
    },
    stopImmediatePropagation() {
      state.stopped = true;
      state.immediate = true;
    },
    getModifierState(key: string): boolean {
      if (key === "CapsLock") return capsLock;
      if (key === "OS") return press.metaKey;
      const field = MODIFIER_KEYS[key];
      return field === undefined ? false : press[field];
    },
  };
  return { event, state };
}

export interface KeyDispatcherOptions {
  /** The focused text input (React Native's `TextInput.State.currentlyFocusedInput()`). */
  focusedInput: () => unknown;
  /** The target when nothing is focused (`document.body`). */
  body: () => unknown;
  document: KeyHub;
  window: KeyHub;
  now?: () => number;
}

interface InputEntry {
  input: () => unknown;
  handlers: () => KeyHandlers;
}

interface ScopeEntry {
  contains: (input: unknown) => boolean;
  handlers: () => KeyHandlers;
}

export type ModifierName = "Shift" | "Control" | "Alt" | "Meta";

export interface KeyDispatcher {
  /** Dispatches a press through every phase, and returns its event. */
  dispatch: (press: KeyPress) => ZamiKeyboardEvent;
  /** `window.addEventListener(type, listener, true)`. Returns its removal. */
  addCaptureListener: (type: KeyType, listener: KeyListener) => () => void;
  /** A text input's own handlers: they run while `input()` is the focused input. */
  addInputHandlers: (input: () => unknown, handlers: () => KeyHandlers) => () => void;
  /**
   * A container's handlers (a dialog's, a picker's `onkeydown`): they run while the
   * focused input is one `contains` accepts, or, with nothing focused, while it's the
   * newest container.
   */
  addScope: (contains: (input: unknown) => boolean, handlers: () => KeyHandlers) => () => void;
  /** Whether a modifier key is held now. */
  isModifierHeld: (name: ModifierName) => boolean;
  /** Whether the user types on a hardware keyboard: since its last press, unless the
   *  on-screen keyboard came up after it. */
  hardwareKeyboard: () => boolean;
  /** The on-screen keyboard came up: the user types on it, not on a hardware keyboard. */
  softwareKeyboardShown: () => void;
  /** A text field took focus without the on-screen keyboard (iOS shows only its
   *  shortcuts bar while a hardware keyboard is connected). */
  hardwareKeyboardShown: () => void;
  /** Calls `listener` when `hardwareKeyboard()` changes. */
  onHardwareKeyboardChange: (listener: () => void) => () => void;
  /** The app lost focus: the keyups of the keys held won't arrive. */
  releaseAll: () => void;
}

function remover<T>(set: Set<T> | T[], entry: T): () => void {
  return () => {
    if (Array.isArray(set)) {
      const index = set.indexOf(entry);
      if (index !== -1) set.splice(index, 1);
    } else set.delete(entry);
  };
}

export function createKeyDispatcher(options: KeyDispatcherOptions): KeyDispatcher {
  const now = options.now ?? (() => Date.now());
  const capture: Record<KeyType, Set<KeyListener>> = { keydown: new Set(), keyup: new Set() };
  const inputs = new Set<InputEntry>();
  // Oldest first.
  const scopes: ScopeEntry[] = [];
  const held = new Set<ModifierName>();
  let capsLock = false;
  let hardware = false;
  const hardwareListeners = new Set<() => void>();

  function setHardware(on: boolean): void {
    if (hardware === on) return;
    hardware = on;
    for (const listener of Array.from(hardwareListeners)) listener();
  }

  function track(press: KeyPress): void {
    const modifier = press.key as ModifierName;
    if (modifier in MODIFIER_KEYS) {
      if (press.type === "keydown") held.add(modifier);
      else held.delete(modifier);
      return;
    }
    if (press.key === "CapsLock") {
      if (press.type === "keydown") capsLock = !capsLock;
      return;
    }
    // Any other key carries the modifiers held with it.
    for (const [name, field] of Object.entries(MODIFIER_KEYS)) {
      if (press[field]) held.add(name as ModifierName);
      else held.delete(name as ModifierName);
    }
  }

  function call(
    listener: KeyListener | undefined,
    event: ZamiKeyboardEvent,
    currentTarget: unknown,
  ): void {
    if (listener === undefined) return;
    event.currentTarget = currentTarget;
    try {
      listener(event as unknown as KeyboardEvent);
    } catch (error) {
      console.error(`[zami] "${event.type}" listener failed`, error);
    }
  }

  function dispatch(press: KeyPress): ZamiKeyboardEvent {
    track(press);
    setHardware(true);
    const focused = options.focusedInput() ?? null;
    // A text input UIKit says has focus, before React Native's focus state hears of it
    // (the tap that focused it is still on its way): the press types into it, so its
    // target is an input too, or "type to focus" would type the key a second time.
    const target =
      focused !== null
        ? inputTarget(focused)
        : press.textInputFocused === true
          ? inputTarget(null)
          : options.body();
    const { event, state } = createKeyEvent(press, target, now(), capsLock);
    const handlerName = press.type === "keydown" ? "onKeydown" : "onKeyup";

    // 1. Capture on window.
    for (const listener of Array.from(capture[press.type])) {
      call(listener, event, null);
      if (state.immediate) return event;
    }
    if (state.stopped) return event;

    // 2. The focused input.
    if (focused !== null) {
      for (const entry of Array.from(inputs)) {
        if (entry.input() !== focused) continue;
        call(entry.handlers()[handlerName], event, target);
        if (state.immediate) return event;
      }
      if (state.stopped) return event;
    }

    // 3. The containers around it, innermost (newest) first.
    const around =
      focused === null
        ? scopes.slice(-1)
        : scopes.filter((scope) => scope.contains(focused)).reverse();
    for (const scope of around) {
      call(scope.handlers()[handlerName], event, null);
      if (state.stopped) return event;
    }

    // 4. Bubbling to document, then window.
    for (const hub of [options.document, options.window]) {
      hub.dispatch(press.type, {
        ...event,
        defaultPrevented: state.defaultPrevented,
        currentTarget: null,
      } as unknown as Record<string, unknown>);
      if (state.stopped) return event;
    }
    return event;
  }

  return {
    dispatch,
    addCaptureListener(type, listener) {
      capture[type].add(listener);
      return remover(capture[type], listener);
    },
    addInputHandlers(input, handlers) {
      const entry = { input, handlers };
      inputs.add(entry);
      return remover(inputs, entry);
    },
    addScope(contains, handlers) {
      const entry = { contains, handlers };
      scopes.push(entry);
      return remover(scopes, entry);
    },
    isModifierHeld: (name) => held.has(name),
    hardwareKeyboard: () => hardware,
    softwareKeyboardShown() {
      held.clear();
      setHardware(false);
    },
    hardwareKeyboardShown() {
      setHardware(true);
    },
    onHardwareKeyboardChange(listener) {
      hardwareListeners.add(listener);
      return remover(hardwareListeners, listener);
    },
    releaseAll() {
      held.clear();
    },
  };
}
