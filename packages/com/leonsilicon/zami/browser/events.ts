/** A minimal `addEventListener`/`removeEventListener` target, for the browser stand-ins. */
export interface EventHub {
  addEventListener: (type: string, listener: unknown) => void;
  removeEventListener: (type: string, listener: unknown) => void;
  dispatch: (type: string, detail?: Record<string, unknown>) => void;
}

type Listener = ((event: Event) => void) | { handleEvent: (event: Event) => void };

export function createEventHub(): EventHub {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type, listener) {
      if (listener === null || listener === undefined) return;
      let set = listeners.get(type);
      if (set === undefined) listeners.set(type, (set = new Set()));
      set.add(listener as Listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener as Listener);
    },
    dispatch(type, detail) {
      const event = { type, ...detail } as unknown as Event;
      // A copy: a listener added while dispatching waits for the next event.
      for (const listener of Array.from(listeners.get(type) ?? [])) {
        try {
          if (typeof listener === "function") listener(event);
          else listener.handleEvent(event);
        } catch (error) {
          console.error(`[zami] "${type}" listener failed`, error);
        }
      }
    },
  };
}

/** For DOM features React Native has no equivalent of: fails where Zam's code calls it. */
export function noDom(what: string): never {
  throw new Error(`Zami: there's no DOM (${what})`);
}
