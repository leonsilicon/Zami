// The seam between Zam's plugin host (the copied `src/lib/plugins` files, which upstream's
// tests also load in jsdom) and what Zami adds to it. This module imports nothing: the
// app fills the slots when it starts (#install), and with them empty Zam's host behaves
// as upstream's does.
import type { Disposable, ZamiPluginApi } from "#types";

/** What the host knows about the plugin it builds an API for. */
export interface ZamiApiContext {
  pluginId: string;
  /** The plugin's manifest (`name` labels what it adds). */
  manifest: { name?: string; capabilities?: string[] };
  /** Registers something to undo when the plugin is disabled or unloads. */
  track: (disposable: Disposable) => Disposable;
}

export interface FrameRule {
  urlPrefixes: string[];
  script?: string;
  referrer?: string;
}

export const zamiHost = {
  /** Builds a plugin's `zam.zami`. */
  createApi: null as null | ((context: ZamiApiContext) => ZamiPluginApi),
  /** Sets (or with empty `css`, removes) the stylesheet `id` owns: user CSS, a plugin's. */
  setStyleSheet: null as null | ((id: string, css: string) => void),
  /** Globals for a plugin's code beyond the browser's stand-ins (`Worker`). */
  pluginScope: null as null | ((pluginId: string) => Record<string, unknown>),
  /** The plugin's host was disposed: ends what its code made outside the host (workers). */
  unload: null as null | ((pluginId: string) => void),
  /** Adds a rule for the pages embedded in the app (`zam.frames`). */
  addFrameRule: null as null | ((pluginId: string, rule: FrameRule) => Disposable),
  /** What the rules say for an embedded page about to load `url`. */
  frameRules: null as null | ((url: string) => { script?: string; referrer?: string }),
};
