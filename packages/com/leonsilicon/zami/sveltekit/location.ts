// `window.location` for Zam's code (see @-/com.leonsilicon.zami.browser, which installs
// it as `globalThis.__ZAMI_LOCATION__`). The app is the one page `page.url` describes (at
// https://zami.invalid), so reading it reads `page.url`. Assigning it is a full
// navigation in a browser: Zam relies on that to boot an account switch with fresh
// stores (`location.assign("/")`). Here it reloads the JS bundle, and the new run starts
// at the assigned URL.
import { DevSettings } from "react-native";
import { goto } from "#navigation";
import { ORIGIN, page } from "#page.svelte";

const NEXT_URL_KEY = "zami.location.next";

function navigate(url: string | URL): void {
  const next = new URL(url, page.url);
  if (next.origin !== ORIGIN) {
    // Leaving the app: Zam only does this for sign-in redirects, which open a browser.
    throw new Error(`Zami: location can't leave the app (${next.href})`);
  }
  try {
    localStorage.setItem(NEXT_URL_KEY, next.href);
  } catch {
    /* the reload starts at "/" */
  }
  reload();
}

function reload(): void {
  // Zami: not ported: reloading a release build (expo-updates' reloadAsync).
  DevSettings.reload();
}

const location = {
  get href(): string {
    return page.url.href;
  },
  set href(url: string) {
    navigate(url);
  },
  get origin(): string {
    return page.url.origin;
  },
  get protocol(): string {
    return page.url.protocol;
  },
  get host(): string {
    return page.url.host;
  },
  get hostname(): string {
    return page.url.hostname;
  },
  get port(): string {
    return page.url.port;
  },
  get pathname(): string {
    return page.url.pathname;
  },
  get search(): string {
    return page.url.search;
  },
  get hash(): string {
    return page.url.hash;
  },
  set hash(hash: string) {
    const url = new URL(page.url);
    url.hash = hash;
    void goto(url);
  },
  assign: navigate,
  replace: navigate,
  reload,
  toString(): string {
    return page.url.href;
  },
};

/** Defines Zam's `location`, starting the page at the URL the run before assigned, if any. */
export function installLocation(): void {
  try {
    const next = localStorage.getItem(NEXT_URL_KEY);
    if (next !== null) {
      localStorage.removeItem(NEXT_URL_KEY);
      void goto(next);
    }
  } catch {
    /* start at "/" */
  }
  Object.defineProperty(globalThis, "__ZAMI_LOCATION__", {
    value: location,
    configurable: true,
    writable: true,
  });
}
