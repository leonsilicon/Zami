// `document` for Zam's code. Visibility and focus come from AppState (a backgrounded
// app is a hidden page). Zam's theme switches (`documentElement.dataset.theme`) and CSS
// variables (`documentElement.style.setProperty("--x", …)`) go to Uniwind. Building or
// querying DOM nodes has no equivalent: queries find nothing, and creating a node
// throws where it's called.
import { AppState } from "react-native";
import { Uniwind } from "uniwind";
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

const cssVariables: Record<string, string> = {};
const rootStyle = {
  setProperty(name: string, value: string | null): void {
    if (!name.startsWith("--") || value === null) return;
    cssVariables[name] = value;
    Uniwind.updateCSSVariables(Uniwind.currentTheme, { [name]: value });
  },
  removeProperty(name: string): string {
    const value = cssVariables[name] ?? "";
    delete cssVariables[name];
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
    appendChild: (): never => noDom(`<${tagName}>.appendChild`),
    querySelector: (): null => null,
    querySelectorAll: (): never[] => [],
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
  createElement: (tagName: string): never => noDom(`document.createElement("${tagName}")`),
  createTreeWalker: (): never => noDom("document.createTreeWalker"),
  createRange: (): never => noDom("document.createRange"),
};
