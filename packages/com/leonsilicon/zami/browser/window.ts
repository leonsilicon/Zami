// `window` for Zam's code: the global object, plus the browser window's events and
// methods. Focus and blur follow AppState, resize follows the window dimensions,
// `open` hands links to the system, `matchMedia` answers width and preference queries.
import { AccessibilityInfo, AppState, Appearance, Dimensions, Linking } from "react-native";
import { createEventHub } from "#events";

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

/** The global object, with the window members above taking precedence. */
export const zamiWindow: typeof globalThis = new Proxy(globalThis, {
  get(target, key) {
    if (key === "location") return (globalThis as Record<string, unknown>).__ZAMI_LOCATION__;
    if (key === "document") return (globalThis as Record<string, unknown>).__ZAMI_DOCUMENT__;
    if (key === "navigator") return (globalThis as Record<string, unknown>).__ZAMI_NAVIGATOR__;
    if (key in extras) {
      const descriptor = Object.getOwnPropertyDescriptor(extras, key);
      return descriptor?.get ? descriptor.get.call(extras) : extras[key];
    }
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" && /^[a-z]/.test(String(key))
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  },
  has: (target, key) => key in extras || Reflect.has(target, key),
});
