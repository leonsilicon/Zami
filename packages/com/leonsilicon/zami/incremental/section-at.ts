/**
 * The index of the last of the ascending `offsets` at or before `y`, or -1 when `y` is
 * before the first. A list's scroll handler finds the section it is in with this: a
 * binary search over the section headers' offsets, worked out once per layout.
 */
export function lastIndexAtOrBefore(offsets: readonly number[], y: number): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] <= y) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}
