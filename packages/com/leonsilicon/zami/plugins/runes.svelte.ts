// `zam.zami.runes.watch`: follows what a getter reads of Zam's stores (Svelte 5 runes) from
// code that isn't a component, such as a plugin's. Compiled by Svelte with Zam's app, so it
// runs on the app's own Svelte.
import { untrack } from "svelte";

/** Calls `onChange` with what `read` returns, now and whenever what it read changes. */
export function watch<T>(read: () => T, onChange: (value: T) => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      const value = read();
      untrack(() => onChange(value));
    });
  });
}
