// `document` for Zam's code. Visibility and focus come from AppState (a backgrounded
// app is a hidden page). Zam's theme switches (`documentElement.dataset.theme`) and CSS
// variables (`documentElement.style.setProperty("--x", …)`) go to Uniwind. Building or
// building, parsing and querying DOM nodes happen in a detached DOM (#dom, linkedom),
// which Zam uses for string-level HTML work; nothing in it is displayed. An `<a>` works
// as Zam uses one off-screen: clicking it opens its link, or with `download` set, saves
// the file through the share sheet.
import { AppState, Linking } from "react-native";
import { Uniwind } from "uniwind";
import { shareDownload } from "#download";
import { domDocument } from "#dom";
import { createEventHub } from "#events";

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

// The root's classes (Zam's `cap-native` and the like) style nothing here.
const classList = {
  add(): void {},
  remove(): void {},
  toggle: (): boolean => false,
  contains: (): boolean => false,
};

/** A DOM `<a>` whose click does what a browser's would for the app. */
function anchor(): HTMLAnchorElement {
  const node = domDocument.createElement("a");
  node.click = () => {
    const href = node.getAttribute("href") ?? "";
    const download = (node as { download?: string }).download ?? node.getAttribute("download");
    if (href === "") return;
    if (download) {
      shareDownload(href, download).catch((error: unknown) =>
        console.error("[zami] download failed", error),
      );
    } else void Linking.openURL(href);
  };
  return node;
}

// The root element: Zam's themes and CSS variables (see above), on top of the detached
// DOM's `<html>` for everything else.
const htmlElement = domDocument.documentElement as unknown as Record<PropertyKey, unknown>;
// A plain target that forwards to the element, so the element's own property invariants
// don't constrain the overrides.
const documentElement = new Proxy({} as HTMLElement, {
  get(_target, key) {
    if (key === "dataset") return dataset;
    if (key === "style") return rootStyle;
    if (key === "classList") return classList;
    const value = htmlElement[key];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(htmlElement)
      : value;
  },
  set(_target, key, value) {
    htmlElement[key] = value;
    return true;
  },
  has: (_target, key) => key in htmlElement,
});

const bound = <K extends keyof Document>(key: K) =>
  (domDocument[key] as (...args: unknown[]) => unknown).bind(domDocument);

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
  documentElement,
  get head(): HTMLHeadElement {
    return domDocument.head;
  },
  get body(): HTMLElement {
    return domDocument.body;
  },
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
  createElement(tagName: string): Element {
    return tagName.toLowerCase() === "a" ? anchor() : domDocument.createElement(tagName);
  },
  createElementNS: bound("createElementNS"),
  createTextNode: bound("createTextNode"),
  createComment: bound("createComment"),
  createDocumentFragment: bound("createDocumentFragment"),
  createTreeWalker: bound("createTreeWalker"),
  createRange: bound("createRange"),
  importNode: bound("importNode"),
  getElementById: bound("getElementById"),
  querySelector: bound("querySelector"),
  querySelectorAll: bound("querySelectorAll"),
  getElementsByTagName: bound("getElementsByTagName"),
};
