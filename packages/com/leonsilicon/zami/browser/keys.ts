// Hardware keyboard presses as `keydown`/`keyup` for Zam's code and the translations.
// @-/com.leonsilicon.zami.keyboard reports every press and release, whatever has focus;
// #key-events turns each into a KeyboardEvent-like object and sends it through a
// browser's phases: window capture listeners, the focused TextInput's own handlers, the
// containers around it, then `document`'s and `window`'s listeners (#events' hubs, which
// `document.addEventListener("keydown", …)` and `window.addEventListener(…)` reach).
//
// The target is a stand-in `<textarea>` while a TextInput has focus (React Native's
// `TextInput.State.currentlyFocusedInput()`), and `document.body` otherwise, so Zam's
// "is the user typing?" checks work.
import { addKeyListener } from "@-/com.leonsilicon.zami.keyboard";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { AppState, Keyboard, TextInput } from "react-native";
import { documentEvents, zamiDocument } from "#document";
import {
  createKeyDispatcher,
  type KeyHandlers,
  type KeyListener,
  type KeyType,
  type ModifierName,
} from "#key-events";
import { windowEvents } from "#window";

export type { KeyHandlers, KeyListener, ZamiKeyboardEvent } from "#key-events";

const dispatcher = createKeyDispatcher({
  focusedInput: () => TextInput.State.currentlyFocusedInput() ?? null,
  body: () => zamiDocument.body,
  document: documentEvents,
  window: windowEvents,
});

/** On-screen keyboards shorter than this are the bar a hardware keyboard leaves. */
const SOFTWARE_KEYBOARD_MIN_HEIGHT = 150;

let installed = false;

// The native subscription, kept on the global object: in development, Fast Refresh can
// run this module again, and the old copy's dispatcher must stop receiving presses.
const global = globalThis as { __zamiKeysSubscription?: () => void };

export function installKeys(): void {
  if (installed) return;
  installed = true;
  global.__zamiKeysSubscription?.();
  global.__zamiKeysSubscription = addKeyListener((press) => dispatcher.dispatch(press));
  Keyboard.addListener("keyboardDidShow", (event) => {
    if (event.endCoordinates.height >= SOFTWARE_KEYBOARD_MIN_HEIGHT) {
      dispatcher.softwareKeyboardShown();
    } else dispatcher.hardwareKeyboardShown();
  });
  AppState.addEventListener("change", (state) => {
    if (state !== "active") dispatcher.releaseAll();
  });
}

/**
 * `window.addEventListener(type, listener, true)`: a capture-phase listener, which runs
 * before the focused input's and anyone else's. Returns its removal.
 */
export function addCaptureKeyListener(type: KeyType, listener: KeyListener): () => void {
  return dispatcher.addCaptureListener(type, listener);
}

/** Whether a modifier key is held now. */
export function isModifierHeld(name: ModifierName): boolean {
  return dispatcher.isModifierHeld(name);
}

/** Whether the user is typing on a hardware keyboard (see `useHardwareKeyboard`). */
export function hardwareKeyboardInUse(): boolean {
  return dispatcher.hardwareKeyboard();
}

/**
 * Whether the user is typing on a hardware keyboard: true from its first press (or a
 * text field focused with only the shortcuts bar showing), until the on-screen keyboard
 * comes up.
 */
export function useHardwareKeyboard(): boolean {
  return useSyncExternalStore(dispatcher.onHardwareKeyboardChange, dispatcher.hardwareKeyboard);
}

function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * A TextInput's `onkeydown`/`onkeyup`: they get the hardware key presses while the
 * TextInput `input` holds has focus, before its containers and the window do.
 */
export function useInputKeys(
  input: RefObject<unknown>,
  handlers: KeyHandlers,
  enabled = true,
): void {
  const latest = useLatest(handlers);
  useEffect(() => {
    if (!enabled) return;
    return dispatcher.addInputHandlers(
      () => input.current,
      () => latest.current,
    );
  }, [input, latest, enabled]);
}

/**
 * A container's `onkeydown`/`onkeyup` (a dialog's, a picker's): they get the presses
 * while focus is in one of its `inputs`, or, with no TextInput focused, while it's the
 * newest container mounted (the one a browser would have moved focus into).
 */
export function useKeyScope(
  handlers: KeyHandlers,
  inputs: readonly RefObject<unknown>[] = [],
  enabled = true,
): void {
  const latest = useLatest(handlers);
  const latestInputs = useLatest(inputs);
  useEffect(() => {
    if (!enabled) return;
    return dispatcher.addScope(
      (focused) => latestInputs.current.some((input) => input.current === focused),
      () => latest.current,
    );
  }, [latest, latestInputs, enabled]);
}

/** How often, and how many times, keepFocus looks for the focus change the system made. */
const FOCUS_POLL_MS = 50;
const FOCUS_POLLS = 10;

/**
 * Puts focus back in `input` after a key the system also acts on: a Tab a handler took
 * still moves focus from a single-line TextInput to the next one. It waits for React
 * Native to see that move (focusing an input it still thinks is focused does nothing).
 */
export function keepFocus(input: RefObject<{ focus: () => void } | null>): void {
  let polls = 0;
  const poll = () => {
    const target = input.current;
    if (target === null) return;
    if (TextInput.State.currentlyFocusedInput() !== target) target.focus();
    else if (++polls < FOCUS_POLLS) setTimeout(poll, FOCUS_POLL_MS);
  };
  setTimeout(poll, FOCUS_POLL_MS);
}
