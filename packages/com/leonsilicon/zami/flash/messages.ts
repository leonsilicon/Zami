/** Ruffle's two wasm builds, the only files the sandbox may ask for (as Zam has it). */
export const RUFFLE_WASM = /^[0-9a-f]{20}\.wasm$/;

/** A `require.context` key of a Zami version in static/ruffle/ as the file Ruffle loads. */
export function ruffleFileName(key: string): string {
  return key.replace(/^\.\//, "").replace(/\.zami(?=\.[^.]+$)/, "");
}

/**
 * A message the sandbox's page posted (JSON over the WebView's bridge), or null if it
 * isn't an object. Its fields are the page's: check them as Zam checks a MessagePort's.
 */
export function parseFrameMessage(data: string): Record<string, unknown> | null {
  try {
    const message: unknown = JSON.parse(data);
    return typeof message === "object" && message !== null && !Array.isArray(message)
      ? (message as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The page's own URL, without a fragment, decoded: how WebKit may report it back. */
function normalized(url: string): string {
  const bare = url.replace(/#.*$/, "");
  try {
    return decodeURI(bare);
  } catch {
    return bare;
  }
}

/** Whether a navigation the WebView asks about is the sandbox's page loading. */
export function isSandboxPage(url: string, pageUri: string): boolean {
  return normalized(url) === normalized(pageUri);
}
