/**
 * CSS variable writes for Uniwind, collected until the end of the current task and sent
 * as one call per theme with only the variables whose value changed.
 *
 * Each `Uniwind.updateCSSVariables` call notifies every styled component, and applying
 * a theme preset removes and sets about 80 variables one `style.setProperty` at a time:
 * sent as they came, that is 160 notifications for what is one change (and none at all
 * when the preset is applied again unchanged).
 */
export interface VariableBatch {
  set: (theme: string, name: string, value: string) => void;
  /**
   * Schedules the flush now, ahead of whatever is scheduled next: call it before
   * something that makes React render (a theme switch), so the variables set right
   * after it reach Uniwind before that render rather than in a second one.
   */
  begin: () => void;
  /** Sends what's pending now (otherwise at the end of the task). */
  flush: () => void;
}

export function createVariableBatch(
  update: (theme: string, variables: Record<string, string>) => void,
  schedule: (run: () => void) => void = queueMicrotask,
): VariableBatch {
  /** What Uniwind holds for each "theme name" this batch wrote. */
  const sent = new Map<string, string>();
  let pending: Map<string, Map<string, string>> | undefined;

  const flush = () => {
    const batch = pending;
    pending = undefined;
    if (batch === undefined) return;
    for (const [theme, variables] of batch) {
      const changed: Record<string, string> = {};
      let any = false;
      for (const [name, value] of variables) {
        const key = `${theme} ${name}`;
        if (sent.get(key) === value) continue;
        sent.set(key, value);
        changed[name] = value;
        any = true;
      }
      if (any) update(theme, changed);
    }
  };

  const begin = () => {
    if (pending !== undefined) return;
    pending = new Map();
    schedule(flush);
  };

  return {
    set(theme, name, value) {
      begin();
      let variables = pending!.get(theme);
      if (variables === undefined) pending!.set(theme, (variables = new Map()));
      variables.set(name, value);
    },
    begin,
    flush,
  };
}

/** A variable a stylesheet sets on the root, for one theme or (null) for all of them. */
export interface VariableOverride {
  theme: string | null;
  name: string;
  value: string;
}

export interface RootVariablesHost {
  /** The theme in force, whose variables are the ones written. */
  theme: () => string;
  /** A variable's value in that theme as the app holds it now ("" if it has none). */
  read: (name: string) => string;
  write: (theme: string, name: string, value: string) => void;
}

/**
 * The root element's custom properties, from the three places a page gets them, the later
 * over the earlier: the theme's own (which the app holds), the root's inline style (Zam's
 * theme code: `style.setProperty`), and stylesheets' rules for the root (`setOverrides`:
 * plugins' and the user's CSS, which a page needs `!important` for and here win as they
 * are). Taking a layer's value away brings back the one under it, which the app has no
 * call for: a theme's own value is read before the first write over it and kept.
 */
export function createRootVariables(host: RootVariablesHost) {
  const inline: Record<string, string> = {};
  /** `theme name` → the theme's own value. */
  const own = new Map<string, string>();
  let overrides: readonly VariableOverride[] = [];
  /** What `overrides` has written, per theme: a theme keeps its variables while another
   *  is in force, so what was written there is undone when it's back. */
  const applied = new Map<string, Map<string, string>>();

  const keep = (theme: string, name: string) => {
    const key = `${theme} ${name}`;
    if (!own.has(key)) own.set(key, host.read(name));
  };

  /** Brings the theme in force in line with `overrides`. */
  const sync = () => {
    const theme = host.theme();
    const want = new Map<string, string>();
    for (const override of overrides)
      if (override.theme === null || override.theme === theme)
        want.set(override.name, override.value);
    let have = applied.get(theme);
    if (have === undefined) applied.set(theme, (have = new Map()));
    for (const name of Array.from(have.keys())) {
      if (want.has(name)) continue;
      have.delete(name);
      const under = inline[name] ?? own.get(`${theme} ${name}`);
      // A variable the theme never had can't be unset; it keeps the override's value.
      if (under !== undefined && under !== "") host.write(theme, name, under);
    }
    for (const [name, value] of want) {
      if (have.get(name) === value) continue;
      keep(theme, name);
      have.set(name, value);
      host.write(theme, name, value);
    }
  };

  return {
    setProperty(name: string, value: string): void {
      const theme = host.theme();
      keep(theme, name);
      inline[name] = value;
      if (!applied.get(theme)?.has(name)) host.write(theme, name, value);
    },
    removeProperty(name: string): string {
      const value = inline[name] ?? "";
      delete inline[name];
      const theme = host.theme();
      const original = own.get(`${theme} ${name}`);
      if (
        value !== "" &&
        original !== undefined &&
        original !== "" &&
        !applied.get(theme)?.has(name)
      )
        host.write(theme, name, original);
      return value;
    },
    getPropertyValue: (name: string): string => inline[name] ?? "",
    /** The stylesheets' variables, in the order they apply (a later one wins). */
    setOverrides(next: readonly VariableOverride[]): void {
      overrides = next;
      sync();
    },
    /** The theme in force changed: its variables get the overrides for it. */
    themeChanged: sync,
  };
}
