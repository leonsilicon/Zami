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
