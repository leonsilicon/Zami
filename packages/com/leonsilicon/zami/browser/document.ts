// `document` for Zam's code. Visibility and focus come from AppState (a backgrounded
// app is a hidden page). Zam's theme switches (`documentElement.dataset.theme`) and CSS
// variables (`documentElement.style.setProperty("--x", …)`) go to Uniwind. Building or
// querying DOM nodes has no equivalent: queries find nothing, and creating a node
// throws where it's called, except the head-only ones (`<style>`, `<link>`, `<meta>`),
// which can't affect React Native views: they're inert, and appending them does nothing.
// An `<a>` works as Zam uses one off-screen: clicking it opens its link, or with
// `download` set, saves the file through the share sheet.
import { AppState, Linking } from "react-native";
import { Uniwind } from "uniwind";
import { shareDownload } from "#download";
import { createEventHub, noDom } from "#events";

export const documentEvents = createEventHub();

let appState = AppState.currentState;
AppState.addEventListener("change", (next) => {
  const wasHidden = appState === "background";
  appState = next;
  if ((next === "background") !== wasHidden) documentEvents.dispatch("visibilitychange");
});

/** Zam's `[data-theme]` themes are Uniwind's; its unscoped `:root` is Uniwind's "dark". */
function setTheme(theme: string | undefined): void {
  const name = theme !== undefined && Uniwind.themes.includes(theme as never) ? theme : "dark";
  Uniwind.setTheme(name as never);
}

const dataset = new Proxy<Record<string, string>>(
  {},
  {
    set(target, key, value) {
      if (key === "theme") setTheme(String(value));
      return Reflect.set(target, key, String(value));
    },
    deleteProperty(target, key) {
      if (key === "theme") setTheme(undefined);
      return Reflect.deleteProperty(target, key);
    },
  },
);

// Inline CSS variables on the root, as Uniwind variables of the current theme. Removing
// one restores the theme's own value, which Uniwind has no call for, so it's kept from
// before the first override.
const cssVariables: Record<string, string> = {};
const themeValues = new Map<string, string>();

function setVariable(name: string, value: string): void {
  Uniwind.updateCSSVariables(Uniwind.currentTheme, { [name]: value });
}

const rootStyle = {
  setProperty(name: string, value: string | null): void {
    if (!name.startsWith("--")) return;
    if (value === null || value === "") {
      rootStyle.removeProperty(name);
      return;
    }
    const key = `${Uniwind.currentTheme} ${name}`;
    if (!themeValues.has(key)) themeValues.set(key, String(Uniwind.getCSSVariable(name) ?? ""));
    cssVariables[name] = value;
    setVariable(name, value);
  },
  removeProperty(name: string): string {
    const value = cssVariables[name] ?? "";
    delete cssVariables[name];
    const original = themeValues.get(`${Uniwind.currentTheme} ${name}`);
    if (value !== "" && original !== undefined && original !== "") setVariable(name, original);
    return value;
  },
  getPropertyValue: (name: string): string => cssVariables[name] ?? "",
  // Zami: not ported: the root font size (Zam's text scale) and other inline styles.
};

const classList = {
  add(): void {},
  remove(): void {},
  toggle: (): boolean => false,
  contains: (): boolean => false,
};

const INERT_TAGS = new Set(["style", "link", "meta", "a"]);
const inert = new WeakSet<object>();

function appendChild<T>(parent: string, child: T): T {
  if (typeof child === "object" && child !== null && inert.has(child)) return child;
  return noDom(`<${parent}>.appendChild`);
}

function element(tagName: string, style: object = {}) {
  return {
    tagName: tagName.toUpperCase(),
    style,
    dataset: {} as Record<string, string>,
    classList,
    lang: "",
    dir: "",
    setAttribute(): void {},
    removeAttribute(): void {},
    getAttribute: (): null => null,
    textContent: "",
    appendChild: <T>(child: T): T => appendChild(tagName, child),
    remove(): void {},
    querySelector: (): null => null,
    querySelectorAll: (): never[] => [],
  };
}

function anchor() {
  return {
    ...element("a"),
    href: "",
    download: "",
    target: "",
    rel: "",
    click(this: { href: string; download: string }): void {
      if (this.href === "") return;
      if (this.download !== "") {
        shareDownload(this.href, this.download).catch((error: unknown) =>
          console.error("[zami] download failed", error),
        );
      } else void Linking.openURL(this.href);
    },
  };
}

export const zamiDocument = {
  get visibilityState(): "visible" | "hidden" {
    return appState === "background" ? "hidden" : "visible";
  },
  get hidden(): boolean {
    return appState === "background";
  },
  hasFocus: (): boolean => appState === "active",
  addEventListener: documentEvents.addEventListener,
  removeEventListener: documentEvents.removeEventListener,
  title: "Zami",
  activeElement: null,
  documentElement: { ...element("html", rootStyle), dataset },
  head: element("head"),
  body: element("body"),
  images: [] as never[],
  fonts: {
    ready: Promise.resolve(),
    load: async (): Promise<never[]> => [],
    check: (): boolean => true,
    add(): void {},
    delete: (): boolean => false,
  },
  pictureInPictureEnabled: false,
  pictureInPictureElement: null,
  exitPictureInPicture: async (): Promise<void> => {},
  getElementById: (): null => null,
  querySelector: (): null => null,
  querySelectorAll: (): never[] => [],
  createElement(tagName: string) {
    if (!INERT_TAGS.has(tagName.toLowerCase())) noDom(`document.createElement("${tagName}")`);
    const node = tagName.toLowerCase() === "a" ? anchor() : element(tagName);
    inert.add(node);
    return node;
  },
  createTreeWalker: (): never => noDom("document.createTreeWalker"),
  createRange: (): never => noDom("document.createRange"),
};
