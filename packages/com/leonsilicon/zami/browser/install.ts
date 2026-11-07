import { installLocation } from "@-/com.leonsilicon.zami.sveltekit";
import { zamiDocument } from "#document";
import { zamiNavigator } from "#navigator";
import { zamiWindow } from "#window";

/**
 * Defines the browser globals Metro points Zam's code at (`window`, `document`,
 * `navigator` and `location` become `globalThis.__ZAMI_WINDOW__` and so on, in Zam's tree
 * only). Call it before any of Zam's modules load.
 */
export function installBrowserGlobals(): void {
  installLocation();
  Object.assign(globalThis, {
    __ZAMI_DOCUMENT__: zamiDocument,
    __ZAMI_NAVIGATOR__: zamiNavigator,
    __ZAMI_WINDOW__: zamiWindow,
  });
}
