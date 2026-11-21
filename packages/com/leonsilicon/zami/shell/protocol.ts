// The messages between the page (bootstrap.ts) and React Native (bridge.ts). The Capacitor
// ones are Capacitor's own native bridge protocol.

/** How the page calls a plugin method: and awaits a result, or keeps getting them. */
export type MethodReturnType = "promise" | "callback";

export interface PluginMethodHeader {
  name: string;
  rtype: MethodReturnType;
}

/** A plugin the native side implements, as `window.Capacitor.PluginHeaders` lists it. */
export interface PluginHeader {
  name: string;
  methods: PluginMethodHeader[];
}

/** The page calling a plugin method. */
export interface CapacitorCall {
  type: "capacitor";
  callbackId: string;
  pluginId: string;
  methodName: string;
  options: Record<string, unknown>;
}

/** The page's theme colour changed. */
export interface ThemeMessage {
  type: "zami";
  event: "theme";
  color: string;
}

/** The result of code a debug build evaluated in the page (debug.ts). */
export interface DebugMessage {
  type: "zami";
  event: "debug";
  id: string;
  value?: unknown;
  error?: string;
}

export type PageMessage = CapacitorCall | ThemeMessage | DebugMessage;

export interface CallError {
  message: string;
  code?: string;
  data?: unknown;
}

/** A result for the page (`window.Capacitor.fromNative`). */
export interface CallResult {
  callbackId: string;
  pluginId: string;
  methodName: string;
  success: boolean;
  /** Keep the callback for more results: a listener's events. */
  save?: boolean;
  data?: unknown;
  error?: CallError;
}

export function parsePageMessage(raw: string): PageMessage | null {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const record = message as Record<string, unknown>;
  if (
    record.type === "capacitor" &&
    typeof record.callbackId === "string" &&
    typeof record.pluginId === "string" &&
    typeof record.methodName === "string"
  ) {
    const options =
      typeof record.options === "object" && record.options !== null
        ? (record.options as Record<string, unknown>)
        : {};
    return {
      type: "capacitor",
      callbackId: record.callbackId,
      pluginId: record.pluginId,
      methodName: record.methodName,
      options,
    };
  }
  if (record.type === "zami" && record.event === "debug" && typeof record.id === "string") {
    return {
      type: "zami",
      event: "debug",
      id: record.id,
      value: record.value,
      ...(typeof record.error === "string" ? { error: record.error } : {}),
    };
  }
  if (record.type === "zami" && record.event === "theme" && typeof record.color === "string") {
    return { type: "zami", event: "theme", color: record.color };
  }
  return null;
}
