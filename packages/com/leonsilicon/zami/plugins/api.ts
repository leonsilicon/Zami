// Builds a plugin's `zam.zami`. Everything a plugin adds through it is tracked by the
// host, so disabling the plugin undoes it.
import { setDomContent } from "@-/com.leonsilicon.zami.rn";
import { createRuneStore, useDeepRune, useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { reloadAppAsync, requireOptionalNativeModule } from "expo";
import { NativeModules, Platform, TurboModuleRegistry } from "react-native";
import { earlyPreference, setEarlyPreference, wasLoadedEarly } from "#early";
import {
  addInterceptor,
  changeOutput,
  changeProps,
  findElement,
  mapElements,
  nameType,
  wrapComponent,
} from "#elements";
import type { ZamiApiContext } from "#host";
import { addLayer } from "#layers";
import {
  hasModule,
  listComponents,
  listLibraries,
  listModules,
  moduleBindings,
  requireComponent,
  requireModule,
  requireStore,
  storeNames,
} from "#modules";
import { patchAfter, patchBefore, patchInstead } from "#patcher";
import { pluginWeb } from "#plugin-web";
import { setStyleSheet, setVariables } from "#stylesheet";
import type { AnyComponent, ComponentTarget, Disposable, ZamiPluginApi } from "#types";

/** Raised when `zam.zami` gains something. */
export const ZAMI_API_VERSION = 1;

interface Toasts {
  showToast: (
    message: string,
    options?: { action?: { label: string; run: () => void }; tone?: string; sticky?: boolean },
  ) => number;
  dismissToast: (id: number) => void;
}

/** Zam's toasts, through the module table: this package doesn't import Zam's tree. */
export function toasts(): Toasts {
  return requireModule("$lib/stores/toasts.svelte") as Toasts;
}

/** Zam's stores by name, each loaded when first read. */
function storesByName(): Record<string, Record<string, unknown>> {
  let names: Set<string> | undefined;
  const has = (name: string | symbol): name is string =>
    typeof name === "string" && (names ??= new Set(storeNames())).has(name);
  return new Proxy(
    {},
    {
      get: (_, name) => (has(name) ? requireStore(name) : undefined),
      has: (_, name) => has(name),
      ownKeys: () => [...(names ??= new Set(storeNames()))],
      getOwnPropertyDescriptor: (_, name) =>
        has(name) ? { enumerable: true, configurable: true, value: requireStore(name) } : undefined,
    },
  );
}

export function createZamiApi({ pluginId, track }: ZamiApiContext): ZamiPluginApi {
  const undoable = (undo: () => void): Disposable => track({ dispose: undo });
  const typeOf = (target: ComponentTarget): unknown => {
    if (typeof target !== "string") return target;
    const type = requireComponent(target);
    // "RoomList", from the name or the module it was asked for by.
    nameType(type, target.replace(/^.*\//, "").replace(/\.svelte$/, ""));
    return type;
  };
  // A patch only reaches elements created after it: from the next launch on, this plugin
  // loads before the first render (unless it has said otherwise).
  const patching = (): void => {
    if (earlyPreference(pluginId) === undefined) setEarlyPreference(pluginId, true);
  };
  let sheets = 0;
  const addStyles = (css: string): Disposable => {
    const id = `plugin:${pluginId}:zami:${++sheets}`;
    setStyleSheet(id, String(css));
    return undoable(() => setStyleSheet(id, ""));
  };

  return {
    version: ZAMI_API_VERSION,
    platform: { os: Platform.OS, version: Platform.Version },

    React: requireModule("react") as typeof import("react"),
    ReactNative: requireModule("react-native") as typeof import("react-native"),
    require: <T>(specifier: string) => requireModule(specifier) as T,
    modules: {
      list: (prefix) => listModules(prefix),
      libraries: () => listLibraries(),
      has: (specifier) => hasModule(specifier),
      names: (specifier) => moduleBindings(specifier).names(),
      get: (specifier, name) => moduleBindings(specifier).get(name),
      set: (specifier, name, value) => {
        const bindings = moduleBindings(specifier);
        const previous = bindings.get(name);
        bindings.set(name, value);
        // Only if it's still ours: a later change (another plugin's) isn't ours to undo.
        return undoable(() => {
          if (bindings.get(name) === value) bindings.set(name, previous);
        });
      },
    },
    stores: storesByName(),

    runes: {
      useRune: (read, deps) => useRune(read, deps),
      useDeepRune: (read, deps) => useDeepRune(read, deps),
      watch: (read, onChange) => {
        const store = createRuneStore(read);
        store.getSnapshot();
        let stop: (() => void) | undefined;
        let stopped = false;
        // The store watches from an effect root, which must not be made inside whatever
        // effect is calling us (it would be attached to it): the next microtask is outside.
        queueMicrotask(() => {
          if (stopped) return;
          stop = store.subscribe(() => {
            try {
              onChange(store.getSnapshot().value);
            } catch (error) {
              console.error(`[plugin ${pluginId}] a runes.watch handler threw`, error);
            }
          });
        });
        return undoable(() => {
          stopped = true;
          stop?.();
        });
      },
    },

    components: {
      list: () => listComponents(),
      get: (target) => requireComponent(target) as AnyComponent,
      wrap: (target, wrap) => {
        patching();
        return undoable(
          wrapComponent(typeOf(target), pluginId, wrap as (Original: AnyComponent) => unknown),
        );
      },
      replace: (target, Replacement) => {
        patching();
        const { createElement } = requireModule("react") as typeof import("react");
        return undoable(
          wrapComponent(typeOf(target), pluginId, (Original) => {
            const Replaced = (props: Record<string, unknown>) =>
              createElement(Replacement, { ...props, Original });
            return Replaced;
          }),
        );
      },
      props: (target, change) => {
        patching();
        return undoable(changeProps(typeOf(target), pluginId, change));
      },
      output: (target, change) => {
        patching();
        return undoable(changeOutput(typeOf(target), pluginId, change));
      },
    },

    elements: {
      intercept: (interceptor) => {
        patching();
        return undoable(addInterceptor(pluginId, interceptor));
      },
      find: findElement,
      map: mapElements,
    },

    patch: {
      before: (object, method, hook) => undoable(patchBefore(object, method, hook)),
      after: (object, method, hook) => undoable(patchAfter(object, method, hook)),
      instead: (object, method, hook) =>
        undoable(
          patchInstead(object, method, (args, original, self) =>
            hook(args, original as (...inner: never[]) => unknown, self),
          ),
        ),
    },

    ui: {
      render: (element, content) => {
        setDomContent(element, content);
        return undoable(() => setDomContent(element, undefined));
      },
      addLayer: (Layer) => undoable(addLayer(pluginId, Layer)),
      toast: (message, options) => {
        const id = toasts().showToast(String(message), {
          tone: options?.tone ?? "accent",
          sticky: options?.sticky,
          action: options?.action,
        });
        return { dispose: () => toasts().dismissToast(id) };
      },
    },

    styles: {
      add: addStyles,
      setVariables: (variables) => {
        const id = `plugin:${pluginId}:zami:${++sheets}`;
        setVariables(id, variables);
        return undoable(() => setStyleSheet(id, ""));
      },
    },

    native: {
      modules: NativeModules as Record<string, unknown>,
      turbo: <T>(name: string) => TurboModuleRegistry.get(name) as T | null,
      expo: <T>(name: string) => requireOptionalNativeModule<T>(name),
    },

    web: pluginWeb(pluginId, track),

    app: {
      get early() {
        return wasLoadedEarly(pluginId);
      },
      loadEarly: (early = true) => setEarlyPreference(pluginId, early),
      reload: () => void reloadAppAsync(`plugin ${pluginId}`),
    },
  };
}
