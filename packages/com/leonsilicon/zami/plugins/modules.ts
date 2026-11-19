/// <reference types="expo/types" />
// oxlint-disable typescript/no-require-imports -- every module here is loaded by name, on request
// The app's own modules and the libraries it bundles, by the names Zam's code imports
// them by. A plugin's code is loaded at run time, after Metro has turned every import in
// the bundle into a number, so this is the only way for it to reach a module: and what
// it gets is the module the app itself runs, with its live state.
//
// Nothing loads until it's asked for: `require.context` builds a table of getters, and
// each library is a function. Modules the app would never have loaded (code for a
// platform it isn't on) are in the bundle too, and load if a plugin asks.
import { bindingsForKey, rememberModule, type ModuleBindings } from "#bindings";
import { componentNameForKey, normalizeSpecifier, specifierForKey } from "#module-names";

/**
 * The Zami versions of Zam's modules, keyed `./lib/stores/rooms.svelte.zami.ts`. Left out:
 * tests (which import their runner), type declarations, and the scripts of Web Workers
 * and audio worklets, which are written for those global scopes and import packages the
 * app doesn't have. Metro bundles every file this matches, so each must resolve all its
 * imports even when the app itself never loads it (`vp run bundle` checks).
 */
const APP_MODULES = require.context(
  "../../../../../src",
  true,
  /^\.\/(?:lib|routes)\/(?!.*\.(?:test|spec|worker|worklet)\.zami\.).*\.zami\.(?:ts|tsx)$/,
);

const LIBRARIES: Readonly<Record<string, () => unknown>> = {
  react: () => require("react"),
  "react/jsx-runtime": () => require("react/jsx-runtime"),
  // The app's `react-native`: Uniwind's, whose components take `className`.
  "react-native": () => require("react-native"),
  "react-native-audio-api": () => require("react-native-audio-api"),
  "react-native-gesture-handler": () => require("react-native-gesture-handler"),
  "react-native-keyboard-controller": () => require("react-native-keyboard-controller"),
  "react-native-maps": () => require("react-native-maps"),
  "react-native-reanimated": () => require("react-native-reanimated"),
  "react-native-safe-area-context": () => require("react-native-safe-area-context"),
  "react-native-svg": () => require("react-native-svg"),
  "react-native-webview": () => require("react-native-webview"),
  uniwind: () => require("uniwind"),
  expo: () => require("expo"),
  "expo-application": () => require("expo-application"),
  "expo-asset": () => require("expo-asset"),
  "expo-audio": () => require("expo-audio"),
  "expo-camera": () => require("expo-camera"),
  "expo-clipboard": () => require("expo-clipboard"),
  "expo-constants": () => require("expo-constants"),
  "expo-crypto": () => require("expo-crypto"),
  "expo-device": () => require("expo-device"),
  "expo-document-picker": () => require("expo-document-picker"),
  "expo-file-system": () => require("expo-file-system"),
  "expo-font": () => require("expo-font"),
  "expo-haptics": () => require("expo-haptics"),
  "expo-image": () => require("expo-image"),
  "expo-image-picker": () => require("expo-image-picker"),
  "expo-linking": () => require("expo-linking"),
  "expo-localization": () => require("expo-localization"),
  "expo-location": () => require("expo-location"),
  "expo-modules-core": () => require("expo-modules-core"),
  "expo-notifications": () => require("expo-notifications"),
  "expo-sharing": () => require("expo-sharing"),
  "expo-sqlite": () => require("expo-sqlite"),
  "expo-status-bar": () => require("expo-status-bar"),
  "expo-video": () => require("expo-video"),
  "expo-web-browser": () => require("expo-web-browser"),
  "matrix-js-sdk": () => require("matrix-js-sdk"),
  "date-fns": () => require("date-fns"),
  svelte: () => require("svelte"),
  "lucide-react-native": () => require("lucide-react-native"),
  // Zam's icons as its components import them (they take `size` and `className`).
  // oxlint-disable-next-line flatcap/no-undeclared-dependencies -- Metro's name for the icons package (with-zami.js)
  "lucide-svelte": () => require("lucide-svelte"),
  "@-/com.leonsilicon.zami.rn": () => require("@-/com.leonsilicon.zami.rn"),
  "@-/com.leonsilicon.zami.svelte-react": () => require("@-/com.leonsilicon.zami.svelte-react"),
  "@-/com.leonsilicon.zami.browser": () => require("@-/com.leonsilicon.zami.browser"),
  "@-/com.leonsilicon.zami.blob": () => require("@-/com.leonsilicon.zami.blob"),
};

let appIndex: Map<string, string> | undefined;

/** Specifier → `require.context` key. An `index` module also answers to its folder. */
function index(): Map<string, string> {
  if (appIndex) return appIndex;
  appIndex = new Map();
  for (const key of APP_MODULES.keys()) {
    const specifier = specifierForKey(key);
    appIndex.set(specifier, key);
    if (specifier.endsWith("/index")) appIndex.set(specifier.slice(0, -"/index".length), key);
  }
  return appIndex;
}

export function hasModule(specifier: string): boolean {
  return Object.hasOwn(LIBRARIES, specifier) || index().has(normalizeSpecifier(specifier));
}

/** The module `specifier` names: a bundled library, or one of the app's own. */
export function requireModule(specifier: string): unknown {
  if (Object.hasOwn(LIBRARIES, specifier)) return LIBRARIES[specifier]!();
  const key = index().get(normalizeSpecifier(specifier));
  if (key === undefined) {
    throw new Error(
      `Zami has no module "${specifier}". App modules are named as Zam imports them ("$lib/stores/rooms.svelte"); modules.list() and modules.libraries() name them all.`,
    );
  }
  const exports: unknown = APP_MODULES(key);
  // So a patch of a function in these exports can go to the module's own name for it.
  rememberModule(exports, key);
  return exports;
}

/**
 * The names declared at the top level of one of the app's modules (loading it if it
 * hasn't run), readable and settable. Libraries have none: they aren't compiled for it.
 */
export function moduleBindings(specifier: string): ModuleBindings {
  const key = index().get(normalizeSpecifier(specifier));
  if (key === undefined) throw new Error(`Zami has no app module "${specifier}".`);
  requireModule(specifier);
  const bindings = bindingsForKey(key);
  if (bindings === undefined) throw new Error(`"${specifier}" declares nothing at its top level.`);
  return bindings;
}

/** The app's modules, optionally only those starting with `prefix`. */
export function listModules(prefix = ""): string[] {
  const all = new Set<string>();
  for (const key of APP_MODULES.keys()) {
    const specifier = specifierForKey(key);
    if (specifier.startsWith(prefix)) all.add(specifier);
  }
  return [...all].sort();
}

export function listLibraries(): string[] {
  return Object.keys(LIBRARIES);
}

let componentIndex: Map<string, string[]> | undefined;

/** The app's components (the translated `.svelte` files): name → specifiers. */
function components(): Map<string, string[]> {
  if (componentIndex) return componentIndex;
  componentIndex = new Map();
  for (const key of APP_MODULES.keys()) {
    const name = componentNameForKey(key);
    if (name === undefined) continue;
    const specifiers = componentIndex.get(name) ?? [];
    specifiers.push(specifierForKey(key));
    componentIndex.set(name, specifiers);
  }
  return componentIndex;
}

export function listComponents(): string[] {
  return [...components().keys()].sort();
}

/**
 * One of the app's components: by name (`"RoomList"`) or by module
 * (`"$lib/components/layout/RoomList.svelte"`). It's the module's default export, which
 * is what the app's own elements are created with.
 */
export function requireComponent(target: string): unknown {
  let specifier = target;
  if (!target.includes("/")) {
    const specifiers = components().get(target.replace(/\.svelte$/, ""));
    if (specifiers === undefined)
      throw new Error(`Zami has no component named "${target}". components.list() names them all.`);
    if (specifiers.length > 1) {
      throw new Error(
        `Several components are named "${target}": name the module (${specifiers.join(", ")}).`,
      );
    }
    specifier = specifiers[0]!;
  }
  const component = (requireModule(specifier) as { default?: unknown }).default;
  if (component === undefined) throw new Error(`"${specifier}" has no default export.`);
  return component;
}

const STORE_PREFIX = "$lib/stores/";

/** Zam's stores by name: `rooms` is `$lib/stores/rooms.svelte`. */
export function storeNames(): string[] {
  return listModules(STORE_PREFIX).map((specifier) =>
    specifier.slice(STORE_PREFIX.length).replace(/\.svelte$/, ""),
  );
}

export function requireStore(name: string): unknown {
  const specifier = `${STORE_PREFIX}${name}`;
  return requireModule(index().has(`${specifier}.svelte`) ? `${specifier}.svelte` : specifier);
}
