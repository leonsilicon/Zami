// `zam.zami`: the contract for what Zami adds to the `zam` object a plugin's `onload`
// receives. Types only, like Zam's own `src/lib/plugins/types.ts`, which refers to it.
import type { ComponentType, ReactElement, ReactNode } from "react";

/** One undo handle. `dispose()` is idempotent. */
export interface Disposable {
  dispose(): void;
}

// oxlint-disable-next-line typescript/no-explicit-any -- a component of any props
export type AnyComponent = ComponentType<any>;

/**
 * What a patch applies to: a component (anything an element's type can be: a function, a
 * class, a `memo` or `forwardRef` object, a native component's name), or the name or
 * module of one of the app's own (`"RoomList"`, `"$lib/components/layout/RoomList.svelte"`).
 */
export type ComponentTarget = string | AnyComponent | object;

export interface ZamiModules {
  /** The app's modules, as Zam imports them: `"$lib/stores/rooms.svelte"`,
   *  `"$lib/components/layout/RoomList.svelte"`, `"routes/+page.svelte"`. */
  list(prefix?: string): string[];
  /** The libraries the app bundles: `"react"`, `"react-native"`, `"matrix-js-sdk"`, … */
  libraries(): string[];
  has(specifier: string): boolean;
  /**
   * What an app module declares at its top level: its functions, classes, constants and
   * variables, exported or not.
   */
  names(specifier: string): readonly string[];
  /** The current value of one of those names. */
  get(specifier: string, name: string): unknown;
  /**
   * Sets one of those names, for the module's own code and for everything that imports
   * it: a constant (`set("$lib/stores/toasts.svelte", "TOAST_TTL_MS", 10_000)`), or a
   * whole function or class. Undone when the plugin unloads. To wrap a function rather
   * than replace it, use `patch`.
   */
  set(specifier: string, name: string, value: unknown): Disposable;
}

export interface ZamiRunes {
  /** A component re-renders when the runes `read` touched change (Zam's stores). */
  useRune<T>(read: () => T, deps?: readonly unknown[]): T;
  /** `useRune` that also follows changes inside the objects and arrays `read` returns. */
  useDeepRune<T>(read: () => T, deps?: readonly unknown[]): T;
  /** Outside React: calls `onChange` with the new value whenever what `read` touched changes. */
  watch<T>(read: () => T, onChange: (value: T) => void): Disposable;
}

export interface ZamiComponents {
  /** The app's own components by name (the file's, without `.svelte`). */
  list(): string[];
  /** One of the app's components: by name, or by module (`"$lib/components/…"`). */
  get(target: string): AnyComponent;
  /**
   * Draws `wrap(Original)` wherever the app draws the component. `Original` draws what
   * would have been drawn without this patch (the component itself, or an earlier patch
   * of it).
   */
  wrap(target: ComponentTarget, wrap: (Original: AnyComponent) => AnyComponent): Disposable;
  /** Draws `Replacement` in the component's place; it gets the same props, plus `Original`. */
  replace(target: ComponentTarget, Replacement: AnyComponent): Disposable;
  /** Changes the props the component gets: return new props, or nothing to keep them. */
  props(
    target: ComponentTarget,
    change: (props: Record<string, unknown>) => Record<string, unknown> | void,
  ): Disposable;
  /**
   * Changes what a function component returns: `change` gets its output (a tree of React
   * elements; see `elements.find` and `elements.map`) and returns what to draw.
   */
  output(
    target: ComponentTarget,
    change: (output: ReactNode, props: Record<string, unknown>) => ReactNode,
  ): Disposable;
}

export interface ZamiElements {
  /**
   * Sees every React element the app creates, before React does: return a `type` or
   * `props` to create it with those instead. It runs for each of thousands of elements
   * per render, so decide fast.
   */
  intercept(
    interceptor: (
      type: unknown,
      props: Record<string, unknown>,
    ) => { type?: unknown; props?: Record<string, unknown> } | void,
  ): Disposable;
  /** The first element in `tree` (depth first, through `children`) that `match` accepts. */
  find(tree: ReactNode, match: (element: ReactElement) => boolean): ReactElement | null;
  /** `tree` with each element `change` returns something for replaced by that (its
   *  children aren't visited); elements it returns `undefined` for stay, children mapped. */
  map(tree: ReactNode, change: (element: ReactElement) => ReactNode | undefined): ReactNode;
}

type Method = (...args: never[]) => unknown;

/**
 * Hooks on a function: a method of any object (a store's state, the Matrix client), or a
 * function of an app module, named on what `require` returned for the module. For a
 * module's function the patch replaces the module's own name for it, so it also applies
 * to the calls the module makes itself, and to functions it doesn't export.
 */
export interface ZamiPatcher {
  /** Runs `hook` before `object[method]`: return an array to call it with those arguments. */
  before(
    object: object,
    method: string,
    hook: (args: unknown[], self: unknown) => unknown[] | void,
  ): Disposable;
  /** Runs `hook` after `object[method]`: return something other than `undefined` to
   *  return that instead. A promise's result is passed as the promise. */
  after(
    object: object,
    method: string,
    hook: (result: unknown, args: unknown[], self: unknown) => unknown,
  ): Disposable;
  /** Runs `hook` in place of `object[method]`; `original` calls what it replaced. */
  instead(
    object: object,
    method: string,
    hook: (args: unknown[], original: Method, self: unknown) => unknown,
  ): Disposable;
}

export interface ZamiToastOptions {
  tone?: "danger" | "accent";
  /** Stays until dismissed. */
  sticky?: boolean;
  action?: { label: string; run: () => void };
}

export interface ZamiUi {
  /**
   * Shows React (Native) content in an element Zam gave the plugin to render into: a
   * popover's, a panel's, a header button's, a link embed's, or any element inside them.
   */
  render(element: HTMLElement, content: ReactNode): Disposable;
  /** A component drawn over the whole app (it fills the window and lets touches through
   *  wherever it draws nothing). */
  addLayer(Layer: AnyComponent): Disposable;
  /** One of the app's toasts. */
  toast(message: string, options?: ZamiToastOptions): Disposable;
}

export interface ZamiStyles {
  /** `zam.ui.addStyles(css)`: theme variables, and rules for classes. */
  add(css: string): Disposable;
  /** Sets theme variables (`{ "--zam-bg": "#101014" }`) over the theme's own. */
  setVariables(variables: Record<string, string>): Disposable;
}

export interface ZamiNative {
  /** React Native's `NativeModules`. */
  modules: Record<string, unknown>;
  /** A TurboModule by name, or null. */
  turbo<T = unknown>(name: string): T | null;
  /** An Expo native module by name, or null. */
  expo<T = unknown>(name: string): T | null;
}

export interface WebContextOptions {
  /** The page's HTML (an empty page without it). */
  html?: string;
  /** A page to load instead of `html`. */
  url?: string;
  /** The URL `html` is loaded at: its origin for requests, and what relative URLs resolve
   *  against. */
  baseUrl?: string;
  /** JavaScript run in the page once it has loaded. */
  script?: string;
}

/** A web page running out of sight: a real browser engine for what the app's own
 *  JavaScript runtime lacks (WebAssembly, Workers, canvas, WebGL, WebCodecs). */
export interface WebContext extends Disposable {
  /** Resolves once the page (and `script`) has loaded. */
  ready: Promise<void>;
  /**
   * Runs `source` in the page as the body of an async function whose parameters are
   * `args` (`args[0]`, …) and resolves with what it returns. Arguments and results are
   * copied: JSON values, plus `ArrayBuffer`s and typed arrays.
   */
  run<T = unknown>(source: string, ...args: unknown[]): Promise<T>;
  /** Sends `message` to the page: a `message` event on its `window` (`event.data`). */
  post(message: unknown): void;
  /** What the page sends with `zami.post(message)`. */
  onMessage(handler: (message: unknown) => void): Disposable;
  /** Why the context closed (disposed, or the system ended its page), or null while open. */
  readonly closed: string | null;
  /** Called once when the context closes, with the reason. */
  onClose(handler: (reason: string) => void): Disposable;
}

export interface ZamiWeb {
  open(options?: WebContextOptions): WebContext;
  /** A browser's `Worker`, run in a web context. (Plugin code also sees it as `Worker`.) */
  Worker: typeof Worker;
}

export interface ZamiApp {
  /** Whether this plugin was loaded before the app's first render. */
  readonly early: boolean;
  /**
   * Loads this plugin before the app's first render from the next launch on (or stops).
   * Zami does this itself for a plugin that patches components, since a patch only
   * reaches the elements created after it.
   */
  loadEarly(early?: boolean): void;
  /** Restarts the app's JavaScript (as an account switch does). */
  reload(): void;
}

/** `zam.zami`. */
export interface ZamiPluginApi {
  /** Raised when this API gains something, so a plugin can check for it. */
  version: number;
  platform: { os: string; version: string | number };

  React: typeof import("react");
  ReactNative: typeof import("react-native");
  /**
   * An app module or bundled library by the name Zam's code imports it by:
   * `require("$lib/stores/rooms.svelte")`, `require("matrix-js-sdk")`. Modules are the
   * live ones the app runs, so what a plugin changes in them, the app sees.
   */
  require<T = unknown>(specifier: string): T;
  modules: ZamiModules;
  /** Zam's stores by name: `stores.rooms` is `$lib/stores/rooms.svelte`. */
  stores: Record<string, Record<string, unknown>>;
  runes: ZamiRunes;
  components: ZamiComponents;
  elements: ZamiElements;
  patch: ZamiPatcher;
  ui: ZamiUi;
  styles: ZamiStyles;
  native: ZamiNative;
  web: ZamiWeb;
  app: ZamiApp;
}
