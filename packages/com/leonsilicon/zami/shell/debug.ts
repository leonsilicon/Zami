// For a debug build: evaluates code in the page, from React Native's debugger
// (`globalThis.__zamiShell.evaluate("return location.href")`, then `.results[id]`), since
// the page's own inspector (Safari's, Chrome's) needs a person at it.
import type { DebugMessage } from "#protocol";

export interface ShellDebug {
  /** Starts evaluating `code` (a function body; it may await) in the page; returns its id. */
  evaluate(code: string): string;
  /** Results by id, as they come back. */
  results: Record<string, { value?: unknown; error?: string }>;
}

let next = 1;

export function createShellDebug(inject: (script: string) => void): ShellDebug {
  const results: ShellDebug["results"] = {};
  return {
    results,
    evaluate(code) {
      const id = `debug${next++}`;
      const reply = (field: string) =>
        `window.ReactNativeWebView.postMessage(JSON.stringify({ type: "zami", event: "debug", id: ${JSON.stringify(id)}, ${field} }))`;
      inject(
        `(async () => { try { const value = await (async () => { ${code}\n })(); ${reply("value")}; } ` +
          `catch (e) { ${reply("error: String((e && e.stack) || e)")}; } })(); true;`,
      );
      return id;
    },
  };
}

export function receiveDebug(debug: ShellDebug, message: DebugMessage): void {
  debug.results[message.id] =
    message.error === undefined ? { value: message.value } : { error: message.error };
}
