import { subtle } from "#subtle";

/**
 * Gives `globalThis.crypto` this package's `subtle` if it has none, as in Hermes. A
 * platform's own (a browser's, Node's) stays.
 */
export function installWebCrypto(): void {
  const host = globalThis as { crypto?: { subtle?: unknown } };
  host.crypto ??= {};
  if (host.crypto.subtle) return;
  Object.defineProperty(host.crypto, "subtle", {
    value: subtle,
    enumerable: true,
    configurable: true,
  });
}
