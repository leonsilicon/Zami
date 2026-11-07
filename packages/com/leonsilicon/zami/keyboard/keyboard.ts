import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

/** A hardware key press or release, shaped like a DOM KeyboardEvent's fields. */
export interface KeyPress {
  type: "keydown" | "keyup";
  key: string;
  code: string;
  keyCode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
}

interface ZamiKeyboardModule {
  addListener(event: "onKey", listener: (press: KeyPress) => void): EventSubscription;
}

const native = requireOptionalNativeModule<ZamiKeyboardModule>("ZamiKeyboard");

/**
 * Calls `listener` for every hardware key press and release, whatever has focus. Without
 * the native module (Android for now) it never fires.
 */
export function addKeyListener(listener: (press: KeyPress) => void): () => void {
  if (native === null) return () => {};
  const subscription = native.addListener("onKey", listener);
  return () => subscription.remove();
}
