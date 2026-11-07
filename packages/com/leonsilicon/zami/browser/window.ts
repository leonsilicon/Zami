// `window` for Zam's code: the global object, plus the browser window's events and
// methods. Focus and blur follow AppState, resize follows the window dimensions,
// `open` hands links to the system, `matchMedia` answers width and preference queries,
// and the DOM classes (`DOMParser`, `Node`, `HTMLElement`, …) are the detached DOM's.
import { AccessibilityInfo, AppState, Appearance, Dimensions, Linking } from "react-native";
import { audioGlobals } from "#audio";
import { DOM_CLASSES } from "#dom";
import { createEventHub } from "#events";
import { notificationGlobals } from "#notification";

export const windowEvents = createEventHub();

let active = AppState.currentState === "active";
AppState.addEventListener("change", (next) => {
  if ((next === "active") === active) return;
  active = next === "active";
  windowEvents.dispatch(active ? "focus" : "blur");
});
Dimensions.addEventListener("change", () => windowEvents.dispatch("resize"));

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion = on));
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

/** Evaluates the media queries Zam uses: widths/heights in px, hover, pointer, preferences. */
function evaluate(query: string): boolean {
  const { width, height } = Dimensions.get("window");
  return query.split(",").some((part) =>
    [...part.matchAll(/\(\s*([a-z-]+)\s*(?::\s*([^)]+))?\)/g)].every(([, feature, value]) => {
      const px = Number.parseFloat(value ?? "");
      switch (feature) {
        case "max-width":
          return width <= px;
        case "min-width":
          return width >= px;
        case "max-height":
          return height <= px;
        case "min-height":
          return height >= px;
        case "hover":
        case "any-hover":
          return value?.trim() === "none";
        case "pointer":
        case "any-pointer":
          return value?.trim() === "coarse";
        case "prefers-reduced-motion":
          return (value?.trim() === "reduce") === reduceMotion;
        case "prefers-color-scheme":
          return value?.trim() === (Appearance.getColorScheme() ?? "dark");
        case "display-mode":
          return value?.trim() === "standalone";
        default:
          return false;
      }
    }),
  );
}

function matchMedia(query: string) {
  const hub = createEventHub();
  const list = {
    media: query,
    get matches(): boolean {
      return evaluate(query);
    },
    addEventListener: hub.addEventListener,
    removeEventListener: hub.removeEventListener,
    addListener: (listener: unknown) => hub.addEventListener("change", listener),
    removeListener: (listener: unknown) => hub.removeEventListener("change", listener),
    onchange: null,
  };
  let matches = list.matches;
  Dimensions.addEventListener("change", () => {
    if (list.matches === matches) return;
    matches = list.matches;
    hub.dispatch("change", { matches, media: query });
  });
  return list;
}

const extras: Record<PropertyKey, unknown> = {
  ...DOM_CLASSES,
  ...audioGlobals,
  ...notificationGlobals,
  addEventListener: windowEvents.addEventListener,
  removeEventListener: windowEvents.removeEventListener,
  dispatchEvent: (event: Event): boolean => {
    windowEvents.dispatch(event.type);
    return true;
  },
  matchMedia,
  open: (url?: string | URL): null => {
    if (url !== undefined) void Linking.openURL(String(url));
    return null;
  },
  focus(): void {},
  blur(): void {},
  getSelection: (): null => null,
  isSecureContext: true,
  opener: null,
  get innerWidth(): number {
    return Dimensions.get("window").width;
  },
  get innerHeight(): number {
    return Dimensions.get("window").height;
  },
  get devicePixelRatio(): number {
    return Dimensions.get("window").scale;
  },
};

/**
 * The global object, with the window members above taking precedence. The proxy's
 * target is a plain object that forwards to `globalThis`: proxying `globalThis` itself
 * would have to return its non-configurable properties exactly as they are, and global
 * functions are handed out bound to it.
 */
const global = globalThis as unknown as Record<PropertyKey, unknown>;
export const zamiWindow: typeof globalThis = new Proxy({} as typeof globalThis, {
  get(_target, key) {
    if (key === "location") return global.__ZAMI_LOCATION__;
    if (key === "document") return global.__ZAMI_DOCUMENT__;
    if (key === "navigator") return global.__ZAMI_NAVIGATOR__;
    if (key === "window" || key === "self" || key === "globalThis") return zamiWindow;
    if (key in extras) {
      const descriptor = Object.getOwnPropertyDescriptor(extras, key);
      return descriptor?.get ? descriptor.get.call(extras) : extras[key];
    }
    const value = global[key];
    return typeof value === "function" && /^[a-z]/.test(String(key))
      ? (value as (...args: unknown[]) => unknown).bind(globalThis)
      : value;
  },
  set(_target, key, value) {
    global[key] = value;
    return true;
  },
  has: (_target, key) => key in extras || key in global,
  deleteProperty: (_target, key) => delete global[key],
});
