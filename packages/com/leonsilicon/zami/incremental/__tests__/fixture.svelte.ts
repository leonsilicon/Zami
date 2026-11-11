// A `$state` counter shaped like Zam's ticks, for the throttled store tests.
export function createTick() {
  const state = $state({ tick: 0 });
  return state;
}
