// What `@capacitor/core` and its plugins look like to Zam's code in the Zami app. Zam
// runs on Capacitor only in its Android build; here `isNativePlatform()` is false, as on
// Zam's web build, so Zam takes the paths it takes there. Zami ports native features to
// Expo modules in the translations instead of through Capacitor plugins.

export const Capacitor = {
  isNativePlatform: (): boolean => false,
  getPlatform: (): string => "web",
  isPluginAvailable: (): boolean => false,
  convertFileSrc: (path: string): string => path,
};

const listenerHandle = { remove: async (): Promise<void> => {} };

/** A plugin whose methods reject, except `addListener`, which never fires. */
export function registerPlugin(name: string): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, method) {
        if (typeof method !== "string" || method === "then") return undefined;
        if (method === "addListener") return () => Promise.resolve(listenerHandle);
        if (method === "removeAllListeners") return () => Promise.resolve();
        return () =>
          Promise.reject(
            new Error(`Zami: the Capacitor plugin ${name}.${method}() isn't available`),
          );
      },
    },
  );
}

export class WebPlugin {}

export class CapacitorException extends Error {}
