/**
 * Which one item of a list is selected (a keyboard cursor in a grid), kept outside
 * React state so moving it re-renders only the item it leaves and the one it lands
 * on: each item subscribes to its own key (`useSelected` in `./react`).
 */
export interface Selection<K> {
  get: () => K | null;
  set: (key: K | null) => void;
  /** Calls `listener` when `key` becomes or stops being the selected one. */
  subscribe: (key: K, listener: () => void) => () => void;
}

export function createSelection<K>(): Selection<K> {
  let selected: K | null = null;
  const listeners = new Map<K, Set<() => void>>();
  const notify = (key: K | null) => {
    if (key === null) return;
    const set = listeners.get(key);
    // A copy: a listener may unsubscribe while this runs.
    if (set !== undefined) for (const listener of Array.from(set)) listener();
  };
  return {
    get: () => selected,
    set(key) {
      if (Object.is(key, selected)) return;
      const previous = selected;
      selected = key;
      notify(previous);
      notify(key);
    },
    subscribe(key, listener) {
      let set = listeners.get(key);
      if (set === undefined) listeners.set(key, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0 && listeners.get(key) === set) listeners.delete(key);
      };
    },
  };
}
