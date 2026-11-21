// `zam.zami.native`: the Zami app's native side, from the page. The shell's Zami plugin
// (@-/com.leonsilicon.zami.shell) calls any function of the Expo modules built into the app,
// and a few of React Native's APIs, over the same bridge as Zam's own Capacitor calls.
// Arguments and results cross as JSON.

interface CapacitorGlobal {
  isPluginAvailable?(name: string): boolean;
  nativePromise?(pluginId: string, methodName: string, options: unknown): Promise<unknown>;
}

function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** Whether this is the Zami app (not Zam on the web or the desktop). */
export function nativeAvailable(): boolean {
  return capacitor()?.isPluginAvailable?.("Zami") === true;
}

async function call(method: string, options: Record<string, unknown>): Promise<unknown> {
  const native = capacitor();
  if (!native?.nativePromise || !nativeAvailable()) {
    throw new Error("There's no native side here: this isn't the Zami app");
  }
  return native.nativePromise("Zami", method, options);
}

/** The Expo modules built into the app, with their functions' names. */
export async function nativeModules(): Promise<Record<string, string[]>> {
  const result = (await call("modules", {})) as { modules?: Record<string, string[]> };
  return result.modules ?? {};
}

/** Calls `method` of the Expo module `module` with `args`; resolves with what it returns. */
export async function callNative(
  module: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const result = (await call("call", { module, method, args })) as { value?: unknown };
  return result.value;
}

/** Calls one of React Native's APIs the shell offers (`Linking`, `Share`, `Vibration`). */
export async function callReactNative(
  api: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const result = (await call("reactNative", { api, method, args })) as { value?: unknown };
  return result.value;
}
