// `$app/state`. One page at a fixed origin, so code that reads `page.url` keeps working;
// `goto` and `replaceState` in #navigation update it.
export const ORIGIN = "https://zami.invalid";

class Page {
  url = $state(new URL(`${ORIGIN}/`));
  params = $state<Record<string, string>>({});
  route = $state<{ id: string | null }>({ id: "/" });
  state = $state<Record<string, unknown>>({});
  status = $state(200);
  error = $state<Error | null>(null);
  data = $state<Record<string, unknown>>({});
  form = $state<unknown>(null);
}

export const page = new Page();

/** There's no deployed web build to update from; new versions ship as app updates. */
export const updated = {
  get current(): boolean {
    return false;
  },
  check: async (): Promise<boolean> => false,
};
