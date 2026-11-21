// The Zami plugin: `zam.zami.native` from the page (@-/com.leonsilicon.zami.plugins), which
// gives Zam's plugins the app's native side. It calls any function of the Expo modules built
// into the app (`globalThis.expo.modules`), and a few of React Native's APIs. Plugins run
// with full trust, as in Zam. Arguments and results cross the bridge as JSON.
import { Linking, Share, Vibration, type ShareContent } from "react-native";
import { PluginError, type ShellPlugin } from "#bridge";

type NativeModule = Record<string, unknown>;

function expoModules(): Record<string, NativeModule> {
  return (globalThis as { expo?: { modules?: Record<string, NativeModule> } }).expo?.modules ?? {};
}

/** The functions of an Expo module: its own ones (not its event emitter's, or internals). */
function functionNames(module: NativeModule): string[] {
  return Object.getOwnPropertyNames(module)
    .filter((name) => !name.startsWith("__") && typeof module[name] === "function")
    .sort();
}

/** React Native's APIs a plugin may call. */
const REACT_NATIVE_APIS: Record<string, Record<string, (...args: never[]) => unknown>> = {
  Linking: {
    openURL: (url: string) => Linking.openURL(url),
    canOpenURL: (url: string) => Linking.canOpenURL(url),
    openSettings: () => Linking.openSettings(),
  },
  Share: {
    share: (content: ShareContent) => Share.share(content),
  },
  Vibration: {
    vibrate: (pattern?: number | number[]) => Vibration.vibrate(pattern ?? 400),
    cancel: () => Vibration.cancel(),
  },
};

function argsOf(options: Record<string, unknown>): unknown[] {
  return Array.isArray(options.args) ? options.args : [];
}

export function createZamiPlugin(): ShellPlugin {
  return {
    name: "Zami",
    methods: {
      modules: () => {
        // Object.keys, not entries: Hermes lists a JSI host object's names only through it.
        const modules = expoModules();
        return {
          modules: Object.fromEntries(
            Object.keys(modules).map((name) => [name, functionNames(modules[name] ?? {})]),
          ),
        };
      },
      call: async (options) => {
        const { module: name, method } = options;
        if (typeof name !== "string" || typeof method !== "string") {
          throw new PluginError("Must provide a module and a method");
        }
        const module = expoModules()[name];
        const fn = module?.[method];
        if (typeof fn !== "function") {
          throw new PluginError(`The app has no native ${name}.${method}()`, "UNIMPLEMENTED");
        }
        return {
          value: await (fn as (...args: unknown[]) => unknown).apply(module, argsOf(options)),
        };
      },
      reactNative: async (options) => {
        const { api, method } = options;
        const fn =
          typeof api === "string" && typeof method === "string"
            ? REACT_NATIVE_APIS[api]?.[method]
            : undefined;
        if (!fn) {
          throw new PluginError(
            `React Native's ${String(api)}.${String(method)}() isn't one a plugin can call`,
            "UNIMPLEMENTED",
          );
        }
        return { value: await (fn as (...args: unknown[]) => unknown)(...argsOf(options)) };
      },
    },
  };
}
