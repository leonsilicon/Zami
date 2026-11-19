// A plugin's share of the web runtime: its `Worker` (the global its code sees, and
// `zam.zami.web.Worker`) and the web contexts it opens, all ended when it unloads.
import type { Disposable, ZamiWeb } from "#types";
import { openWebContext } from "#web-context";
import { createWorkerClass } from "#worker";

interface PluginWorkers {
  Worker: typeof Worker;
  end: () => void;
}

/** The workers of each plugin that has made one since it was loaded. */
const loaded = new Map<string, PluginWorkers>();
const constructors = new Map<string, typeof Worker>();

function workersOf(pluginId: string): PluginWorkers {
  let workers = loaded.get(pluginId);
  if (workers === undefined) {
    const undo = new Set<Disposable>();
    const Worker = createWorkerClass(
      {
        track: (disposable) => {
          undo.add(disposable);
          return disposable;
        },
      },
      { label: pluginId },
    );
    workers = {
      Worker,
      end: () => {
        for (const disposable of undo) disposable.dispose();
      },
    };
    loaded.set(pluginId, workers);
  }
  return workers;
}

/**
 * The plugin's `Worker`. The plugin's code gets it before its host exists, and keeps it
 * across a reload, so it's a constructor that makes each worker with the class of the
 * plugin's current load (a class whose owner unloaded makes no more).
 */
export function pluginWorker(pluginId: string): typeof Worker {
  let constructor = constructors.get(pluginId);
  if (constructor === undefined) {
    const PluginWorker = function (url: string | URL, options?: WorkerOptions): Worker {
      return new (workersOf(pluginId).Worker)(url, options);
    };
    constructor = PluginWorker as unknown as typeof Worker;
    constructors.set(pluginId, constructor);
  }
  return constructor;
}

/** The globals of the plugin's own that its code sees. */
export function pluginScope(pluginId: string): Record<string, unknown> {
  return { Worker: pluginWorker(pluginId) };
}

/** The plugin unloaded: its workers end, and their page closes. */
export function unloadPluginWeb(pluginId: string): void {
  const workers = loaded.get(pluginId);
  if (workers === undefined) return;
  loaded.delete(pluginId);
  workers.end();
}

/** `zam.zami.web`. */
export function pluginWeb(
  pluginId: string,
  track: (disposable: Disposable) => Disposable,
): ZamiWeb {
  return {
    open: (options) => {
      const context = openWebContext(options, { label: pluginId });
      // A context that closed on its own (the system ended its page) needs no undoing.
      const tracked = track({ dispose: () => context.dispose() });
      context.onClose(() => tracked.dispose());
      return context;
    },
    Worker: pluginWorker(pluginId),
  };
}
