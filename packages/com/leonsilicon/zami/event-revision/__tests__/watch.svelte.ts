// Runs `read` in an effect, as `useRune` does, and counts the runs.
export function watch<T>(read: () => T) {
  let runs = 0;
  let value: T | undefined;
  const stop = $effect.root(() => {
    $effect.pre(() => {
      value = read();
      runs++;
    });
  });
  return {
    runs: () => runs,
    value: () => value,
    stop,
  };
}
