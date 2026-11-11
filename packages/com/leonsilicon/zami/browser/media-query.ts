// `MediaQueryList`s for `window.matchMedia`. A list only watches for changes while
// something listens to it (a `change` listener or `onchange`), and all watched lists
// share the window's one dimensions and preference listeners (`recheckMediaQueries`),
// so a component that calls `matchMedia` on every render leaks nothing.
import { createEventHub } from "#events";

const watched = new Set<() => void>();

/** Checks every list with a listener again; call when the window or a preference changes. */
export function recheckMediaQueries(): void {
  for (const check of Array.from(watched)) check();
}

/** How many lists are watching, for the tests. */
export function watchedMediaQueryCount(): number {
  return watched.size;
}

type ChangeListener = ((event: Event) => void) | { handleEvent: (event: Event) => void };

export function createMediaQueryList(query: string, evaluate: (query: string) => boolean) {
  const hub = createEventHub();
  const changeListeners = new Set<unknown>();
  let onchange: ((event: Event) => void) | null = null;
  let matches = evaluate(query);

  const check = () => {
    const next = evaluate(query);
    if (next === matches) return;
    matches = next;
    hub.dispatch("change", { matches, media: query });
    try {
      onchange?.({ type: "change", matches, media: query } as unknown as Event);
    } catch (error) {
      console.error('[zami] "change" listener failed', error);
    }
  };
  /** Watches while anything listens, and stops when the last listener goes. */
  const sync = () => {
    if (changeListeners.size > 0 || onchange !== null) {
      if (watched.has(check)) return;
      matches = evaluate(query);
      watched.add(check);
    } else watched.delete(check);
  };

  const list = {
    media: query,
    get matches(): boolean {
      return evaluate(query);
    },
    addEventListener(type: string, listener: unknown): void {
      hub.addEventListener(type, listener);
      if (type !== "change" || listener === null || listener === undefined) return;
      changeListeners.add(listener);
      sync();
    },
    removeEventListener(type: string, listener: unknown): void {
      hub.removeEventListener(type, listener);
      if (type !== "change") return;
      changeListeners.delete(listener);
      sync();
    },
    addListener: (listener: ChangeListener | null) => list.addEventListener("change", listener),
    removeListener: (listener: ChangeListener | null) =>
      list.removeEventListener("change", listener),
    get onchange(): ((event: Event) => void) | null {
      return onchange;
    },
    set onchange(value: ((event: Event) => void) | null) {
      onchange = typeof value === "function" ? value : null;
      sync();
    },
    dispatchEvent: (): boolean => true,
  };
  return list;
}
