// The font Zam's settings choose for the whole app. On the web, Zam sets it as a CSS stack
// on the root element (`--zam-font-family`, which `html, body` use) and every element
// inherits it. React Native text inherits nothing from the root and takes one family, so
// the app keeps it here: the stack's first family the app has (as on the web, where a
// family that isn't loaded or installed falls back to the next), or none (the system
// font). With no font picked, that's Zam's own stack, as on the web.
// Plain TypeScript, so Zam's code can set it from anywhere, tests included.

type Listener = () => void;

let stack: string | null = null;
/** The families the app has loaded, by the name Zam's stacks use, to the name to render. */
const loaded = new Map<string, string>();
let family: string | null = null;
const listeners = new Set<Listener>();

/**
 * Zam's font when none is picked: its stylesheet's stack for `html, body` (src/app.css),
 * which a browser on iOS draws in Helvetica Neue.
 */
export const DEFAULT_FONT_STACK = '"gg sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

/**
 * The families iOS ships that Zam's stacks name, which a browser there finds installed
 * (see setFontsInstalled).
 */
export const IOS_INSTALLED_FONTS: readonly string[] = ["Helvetica Neue", "Helvetica", "Arial"];

/** The families in a CSS `font-family` value, unquoted. */
export function fontFamilies(value: string): string[] {
  return value
    .split(",")
    .map((name) => name.trim().replace(/^(["'])(.*)\1$/, "$2"))
    .filter((name) => name !== "");
}

/**
 * The family to render for a CSS stack (Zam's default stack for null): its first family
 * the app has, or null for none (the system font).
 */
export function resolveFontStack(value: string | null): string | null {
  for (const name of fontFamilies(value ?? DEFAULT_FONT_STACK)) {
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

/** Sets the app's font as Zam's CSS stack (`--zam-font-family`), or null for Zam's default. */
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

/** Makes families the platform has installed available to stacks, as a browser finds them. */
export function setFontsInstalled(names: readonly string[]): void {
  for (const name of names) loaded.set(name, name);
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
