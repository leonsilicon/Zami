// The font Zam's settings choose for the whole app. On the web, Zam sets it as a CSS stack
// on the root element (`--zam-font-family`, which `html, body` use) and every element
// inherits it. React Native text inherits nothing from the root and takes one family, so
// the app keeps it here: the stack's first family the app has loaded (as on the web,
// where a family that isn't loaded falls back to the next), or none (the system font).
// Plain TypeScript, so Zam's code can set it from anywhere, tests included.

type Listener = () => void;

let stack: string | null = null;
/** The families the app has loaded, by the name Zam's stacks use, to the name to render. */
const loaded = new Map<string, string>();
let family: string | null = null;
const listeners = new Set<Listener>();

/** The families in a CSS `font-family` value, unquoted. */
export function fontFamilies(value: string): string[] {
  return value
    .split(",")
    .map((name) => name.trim().replace(/^(["'])(.*)\1$/, "$2"))
    .filter((name) => name !== "");
}

/** The family to render for a CSS stack: its first loaded family, or null for none. */
export function resolveFontStack(value: string | null): string | null {
  if (value === null) return null;
  for (const name of fontFamilies(value)) {
    const rendered = loaded.get(name);
    if (rendered !== undefined) return rendered;
  }
  return null;
}

function update(): void {
  const next = resolveFontStack(stack);
  if (next === family) return;
  family = next;
  for (const listener of listeners) listener();
}

/** Sets the app's font as Zam's CSS stack (`--zam-font-family`), or null for the system's. */
export function setAppFontStack(value: string | null): void {
  stack = value;
  update();
}

/**
 * Records that the app has loaded the family Zam's stacks call `name`, rendered as
 * `rendered` (the name it was registered under, by default the same), or with null, that
 * it no longer has it.
 */
export function setFontLoaded(name: string, rendered: string | null = name): void {
  if (rendered === null) loaded.delete(name);
  else loaded.set(name, rendered);
  update();
}

/** The family the app's text renders in, or null for the system font. */
export function appFontFamily(): string | null {
  return family;
}

/** Calls `listener` whenever appFontFamily() changes; returns the unsubscribe. */
export function subscribeAppFont(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
