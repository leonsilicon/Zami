interface Loadable {
  manifest: { id: string; name: string };
}

type Enable<Plugin> = (plugin: Plugin, onError?: (error: unknown) => void) => Promise<boolean>;

interface StartupAttempt {
  name: string;
  disable: () => void;
  result: Promise<boolean>;
}

const attempts = new Map<string, StartupAttempt>();
const bundles = new Map<string, StartupAttempt>();
let listeners: AbortController | undefined;
let finished = false;
let recoveryShown = false;

/** Both boot paths share the attempt, including when early boot hits its render deadline. */
export function runStartupPlugin<Plugin extends Loadable>(
  plugin: Plugin,
  enable: Enable<Plugin>,
  disable: () => void,
): Promise<boolean> {
  if (finished) return enable(plugin);
  const { id, name } = plugin.manifest;
  const existing = attempts.get(id);
  if (existing) return existing.result;
  const attempt: StartupAttempt = {
    name,
    disable,
    result: Promise.resolve().then(() =>
      enable(plugin, (error) => showStartupFailure(attempt, error)),
    ),
  };
  attempts.set(id, attempt);
  return attempt.result;
}

/** Remember which dynamically imported bundle owns errors that escape its onload promise. */
export function trackStartupPluginBundle(id: string, url: string): void {
  const attempt = attempts.get(id);
  if (attempt) bundles.set(url, attempt);
}

export function reportStartupScriptError(error: unknown, filename = ""): boolean {
  const source = bundles.get(filename);
  if (source) {
    showStartupFailure(source, error);
    return true;
  }
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  let nearest: StartupAttempt | undefined;
  let offset = Infinity;
  for (const [url, attempt] of bundles) {
    const frame = stack.indexOf(url);
    if (frame >= 0 && frame < offset) {
      nearest = attempt;
      offset = frame;
    }
  }
  if (!nearest) return false;
  showStartupFailure(nearest, error);
  return true;
}

export function watchStartupPluginErrors(): void {
  listeners = new AbortController();
  const { signal } = listeners;
  window.addEventListener(
    "error",
    (event) => {
      reportStartupScriptError(event.error ?? event.message, event.filename);
    },
    { signal },
  );
  window.addEventListener(
    "unhandledrejection",
    (event) => {
      reportStartupScriptError(event.reason);
    },
    { signal },
  );
}

/** Keep listening through the shell's initial paint, when early component patches can run. */
export async function finishStartupPluginChecks(): Promise<void> {
  await Promise.allSettled([...attempts.values()].map(({ result }) => result));
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      finished = true;
      listeners?.abort();
      attempts.clear();
      bundles.clear();
    }),
  );
}

function showStartupFailure(attempt: StartupAttempt, error: unknown): void {
  if (recoveryShown) return;
  recoveryShown = true;

  // Mount outside Zam's Svelte root so a failed route or component can't take the controls down.
  const dialog = document.createElement("dialog");
  dialog.id = "zami-plugin-recovery";
  dialog.setAttribute("aria-labelledby", "zami-plugin-recovery-title");
  dialog.setAttribute("aria-describedby", "zami-plugin-recovery-description");
  dialog.addEventListener("cancel", (event) => event.preventDefault());

  const style = document.createElement("style");
  style.textContent = `
    #zami-plugin-recovery {
      box-sizing: border-box; position: fixed; inset: 0; width: 100%; height: 100%;
      max-width: none; max-height: none; margin: 0; border: 0; overflow: auto;
      background: Canvas; color: CanvasText; color-scheme: light dark;
      font: 1rem/1.5 system-ui, sans-serif;
      padding: max(1.5rem, env(safe-area-inset-top)) 1.5rem max(1.5rem, env(safe-area-inset-bottom));
    }
    #zami-plugin-recovery[open] { display: grid; align-items: center; justify-items: center; }
    #zami-plugin-recovery > section { width: min(100%, 32rem); min-width: 0; margin: auto; }
    #zami-plugin-recovery h1 { font-size: 1.5rem; font-weight: 700; }
    #zami-plugin-recovery p { margin-block: .75rem; overflow-wrap: anywhere; }
    #zami-plugin-recovery pre {
      margin-block: 1rem; padding: .75rem; max-height: 30vh; overflow: auto;
      white-space: pre-wrap; overflow-wrap: anywhere; background: ButtonFace; border-radius: .5rem;
    }
    #zami-plugin-recovery button {
      min-height: 2.75rem; padding: .5rem .875rem; border-radius: .5rem;
      border: 1px solid ButtonText; background: ButtonFace; color: ButtonText; cursor: pointer;
    }
    #zami-plugin-recovery .zami-recovery-actions { display: flex; flex-wrap: wrap; gap: .625rem; }
    #zami-plugin-recovery .zami-recovery-disable { background: CanvasText; color: Canvas; }
  `;
  const panel = document.createElement("section");
  const title = document.createElement("h1");
  title.id = "zami-plugin-recovery-title";
  title.textContent = "A plugin failed at startup";
  const description = document.createElement("p");
  description.id = "zami-plugin-recovery-description";
  description.textContent = `Zami couldn’t start “${attempt.name}”. Try loading it again or disable it and restart Zami.`;
  const detail = document.createElement("pre");
  detail.textContent = (error instanceof Error ? error.message : String(error)) || "Unknown error";
  const actions = document.createElement("div");
  actions.className = "zami-recovery-actions";
  const disable = document.createElement("button");
  disable.type = "button";
  disable.className = "zami-recovery-disable";
  disable.textContent = "Disable plugin";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Try loading again";
  const status = document.createElement("p");
  status.setAttribute("role", "alert");

  disable.onclick = () => {
    try {
      attempt.disable();
      location.reload();
    } catch {
      status.textContent = "Zami couldn’t save the plugin setting. Try loading it again.";
    }
  };
  retry.onclick = () => location.reload();
  actions.append(disable, retry);
  panel.append(title, description, detail, actions, status);
  dialog.append(style, panel);
  document.body.append(dialog);
  dialog.showModal();
}
