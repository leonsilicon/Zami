// `$state` trees shaped like Zam's stores, for the rune store tests.
export function createState() {
  const state = $state({
    count: 0,
    toasts: [] as string[],
    byRoom: {} as Record<string, { events: string[] }>,
  });
  return state;
}
