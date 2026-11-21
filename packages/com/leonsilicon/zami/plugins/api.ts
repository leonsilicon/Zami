// `zam.zami`: what the Zami app adds to Zam's plugin API. Zam's plugins already run in a real
// browser here (the DOM, CSS, WebAssembly, Workers, canvas, iframes); this adds what Zam
// doesn't give them: every module of the app and its top-level names, patches of any
// function or component, Zam's stores, loading before the first render, and the app's
// native side. Everything a plugin adds through it goes when the plugin unloads.
import {
  flushSync,
  mount,
  tick,
  unmount,
  untrack,
  type Component as SvelteComponent,
} from "svelte";
import {
  aroundComponent,
  changedProps,
  componentIds,
  componentNames,
  domComponent,
  getComponent,
  patchComponent,
  type Component,
  type Render,
} from "#components";
import { openWebContext, type WebContextOptions } from "#contexts";
import { noteComponentPatch, setEarly, wasLoadedEarly } from "#early";
import { addLayer, type Disposable } from "#layers";
import { callNative, callReactNative, nativeAvailable, nativeModules } from "#native";
import { createPatcher } from "#patch";
import {
  accessorFor,
  hasModule,
  importModule,
  isLoaded,
  moduleIds,
  normalizeId,
  readName,
  requireModule,
} from "#registry";
import { watch } from "#runes.svelte";

export interface ZamiApiOptions {
  pluginId: string;
  manifest: { id: string; name?: string };
  /** Zam's host: the handle comes off when the plugin unloads. */
  track: (disposable: Disposable) => Disposable;
}

type ToastTone = "danger" | "accent" | "success";

interface ToastOptions {
  tone?: ToastTone;
  sticky?: boolean;
  action?: { label: string; run(): void };
}

/** One of the app's toasts. */
function toast(message: string, options?: ToastOptions): void {
  void importModule("$lib/stores/toasts.svelte").then((toasts) =>
    (toasts.showToast as (message: string, options?: ToastOptions) => number)(message, options),
  );
}

/** A layer over the whole window: it lets touches through wherever it draws nothing. */
function addOverlay(render: (el: HTMLElement) => void | (() => void)): Disposable {
  const layer = document.createElement("div");
  layer.dataset.zamiLayer = "";
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483000;";
  document.body.append(layer);
  const cleanup = render(layer);
  return {
    dispose() {
      if (typeof cleanup === "function") cleanup();
      layer.remove();
    },
  };
}

function addStyle(css: string): Disposable {
  const style = document.createElement("style");
  style.dataset.zamiPlugin = "";
  style.textContent = css;
  document.head.append(style);
  return { dispose: () => style.remove() };
}

/** Theme variables over Zam's own (which its theme code sets inline on <html>). */
function setVariables(variables: Record<string, string>): Disposable {
  const declarations = Object.entries(variables)
    .map(([name, value]) => `${name}: ${value} !important;`)
    .join(" ");
  return addStyle(`:root { ${declarations} }`);
}

export function createZamiApi(options: ZamiApiOptions) {
  const { pluginId, track } = options;
  const name = options.manifest.name ?? pluginId;
  const patcher = createPatcher((error) => {
    console.error(`[plugin ${pluginId}] a patch threw`, error);
  });

  const patchComponents = (target: string, wrap: (Original: Component) => Component) => {
    if (noteComponentPatch(pluginId) && !wasLoadedEarly(pluginId)) {
      toast(`${name} changed how parts of the app are drawn. Reload to see it everywhere.`, {
        tone: "accent",
        sticky: true,
        action: { label: "Reload", run: () => location.reload() },
      });
    }
    return track(patchComponent(target, wrap));
  };

  return {
    /** The platform the app runs on: "ios" or "android". */
    platform: (globalThis as { Capacitor?: { getPlatform?(): string } }).Capacitor?.getPlatform?.(),

    /** One of the app's modules that has loaded, as Zam imports it (`$lib/stores/rooms.svelte`). */
    require: requireModule,
    /** One of the app's modules, loaded if it hasn't been. */
    import: importModule,
    modules: {
      list: moduleIds,
      has: hasModule,
      isLoaded,
      /** The names a module declares at its top level, exported or not. */
      names: (specifier: string): readonly string[] => accessorFor(specifier)?.names ?? [],
      get: (specifier: string, name: string) => readName(normalizeId(specifier), name),
      /** Sets a top-level name of a module, for the module itself and its importers. */
      set: (specifier: string, name: string, value: unknown) =>
        track(addLayer(requireModule(specifier), name, () => value)),
    },
    /** Zam's stores by name: `stores.rooms` is `$lib/stores/rooms.svelte`. */
    stores: new Proxy({} as Record<string, Record<string, unknown>>, {
      get: (_, store) =>
        typeof store === "string" ? requireModule(`$lib/stores/${store}.svelte`) : undefined,
    }),
    runes: {
      /** Calls `onChange` with what `read` returns, now and whenever what it read changes. */
      watch: <T>(read: () => T, onChange: (value: T) => void) =>
        track({ dispose: watch(read, onChange) }),
    },
    patch: {
      before: (...args: Parameters<typeof patcher.before>) => track(patcher.before(...args)),
      after: (...args: Parameters<typeof patcher.after>) => track(patcher.after(...args)),
      instead: (...args: Parameters<typeof patcher.instead>) => track(patcher.instead(...args)),
    },
    components: {
      /** The app's components by name. */
      list: componentNames,
      /** The app's component modules. */
      modules: componentIds,
      get: getComponent,
      /** Draws `wrap(Original)` wherever the app draws the component. */
      wrap: patchComponents,
      /** Draws `Replacement` in its place, with the same props plus `Original`. */
      replace: (target: string, Replacement: Component) =>
        patchComponents(
          target,
          (Original) => (anchor, props) =>
            Replacement(
              anchor,
              changedProps(props, () => ({ Original })),
            ),
        ),
      /** Changes the props it's drawn with: return the props to change. */
      props: (
        target: string,
        change: (props: Record<string, unknown>) => Record<string, unknown> | void,
      ) =>
        patchComponents(
          target,
          (Original) => (anchor, props) => Original(anchor, changedProps(props, change)),
        ),
      /** Draws DOM before and after it. */
      around: (target: string, sides: { before?: Render; after?: Render }) =>
        patchComponents(target, (Original) => aroundComponent(Original, sides)),
      /** A component that draws what `render(el, props)` puts in `el`. */
      dom: domComponent,
    },
    ui: {
      toast,
      /** A layer over the whole app, drawn by `render(el)`. */
      addLayer: (render: (el: HTMLElement) => void | (() => void)) => track(addOverlay(render)),
      /** Draws a Svelte component (one of the app's, say) into `target`. */
      render: (target: HTMLElement, Component: Component, props: Record<string, unknown> = {}) => {
        // (Svelte types a component's anchor as its own internal type.)
        const instance = mount(Component as unknown as SvelteComponent<Record<string, unknown>>, {
          target,
          props,
        });
        return track({ dispose: () => void unmount(instance) });
      },
    },
    styles: {
      add: (css: string) => track(addStyle(css)),
      setVariables: (variables: Record<string, string>) => track(setVariables(variables)),
    },
    native: {
      available: nativeAvailable,
      /** The callable Expo packages and native modules, with their methods. */
      modules: nativeModules,
      /** Calls a method such as `call("expo-haptics", "selectionAsync")`. */
      call: (module: string, method: string, ...args: unknown[]) =>
        callNative(module, method, args),
      /** Calls one of React Native's APIs: `reactNative("Vibration", "vibrate", 50)`. */
      reactNative: (api: string, method: string, ...args: unknown[]) =>
        callReactNative(api, method, args),
    },
    web: {
      open: (contextOptions?: WebContextOptions) => {
        const context = openWebContext(contextOptions);
        track({ dispose: () => context.dispose() });
        return context;
      },
      Worker: globalThis.Worker,
    },
    app: {
      /** Whether this run loaded the plugin before the first render. */
      get early() {
        return wasLoadedEarly(pluginId);
      },
      /** Load before the first render from the next launch on (or not, with `false`). */
      loadEarly: (early = true) => setEarly(pluginId, early),
      reload: () => location.reload(),
    },
    /** The app's own Svelte, for drawing its components or a plugin's. */
    svelte: { mount, unmount, flushSync, tick, untrack },
  };
}

export type ZamiApi = ReturnType<typeof createZamiApi>;
