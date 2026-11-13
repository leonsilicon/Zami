/**
 * A memo of one result: `memo(keys, compute)` runs `compute` the first time, and again
 * only when a key differs (`Object.is`) from the call before. Otherwise it returns the
 * same result, so a caller that compares by identity (`useRune` with `sameObject`,
 * `useMemo`) sees nothing new.
 *
 *   const packsMemo = createKeyedMemo<Pack[]>();
 *   const packs = packsMemo([client, revision, roomId], () => buildPacks());
 */
export type KeyedMemo<T> = (keys: readonly unknown[], compute: () => T) => T;

export function createKeyedMemo<T>(): KeyedMemo<T> {
  let last: { keys: readonly unknown[]; value: T } | undefined;
  return (keys, compute) => {
    if (last !== undefined && sameKeys(last.keys, keys)) return last.value;
    const value = compute();
    last = { keys: [...keys], value };
    return value;
  };
}

function sameKeys(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
