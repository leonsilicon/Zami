import { untrack } from "svelte";

/** Runs `read` in a Svelte effect and calls `onChange` whenever anything it read changes. */
export function subscribeRune(read: () => unknown, onChange: () => void): () => void {
  let first = true;
  return $effect.root(() => {
    $effect(() => {
      read();
      if (first) {
        first = false;
        return;
      }
      untrack(onChange);
    });
  });
}
