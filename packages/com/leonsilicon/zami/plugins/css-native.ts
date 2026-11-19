// Applies the stylesheets (#css-rules) to the app, in the three places a page's CSS lands:
//  - the root's custom properties are theme variables: they go over the theme's own
//    (@-/com.leonsilicon.zami.browser, where Zam's `<html>` style goes too);
//  - rules for classes style the React Native views that have them: Uniwind turns a
//    view's `className` into its style, and its resolver is wrapped to add the rules';
//  - every rule styles the DOM plugins build, which DomView draws
//    (@-/com.leonsilicon.zami.rn takes them through `setDomStyleSource`).
// And `<style>` elements in Zami's document are sheets, as they are in a page.
//
// Nothing here runs until the first sheet is set (or `installStyleSheets` is called), and
// with no rule for a class the wrapped resolver adds one test to a style Uniwind is
// working out anyway (its results are cached per `className`).
import { createElement, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Appearance, Dimensions, Platform } from "react-native";
import { ScopedVariables, Uniwind } from "uniwind";
import { onRootThemeChange, setRootVariableOverrides } from "@-/com.leonsilicon.zami.browser";
import { computeStyle, domGlobals, setDomStyleSource } from "@-/com.leonsilicon.zami.rn";
import {
  classDeclarations,
  environmentChanged,
  hasClassRules,
  hasImportantClassRules,
  matchElement,
  nativeStyle,
  referencedVariables,
  rootVariables,
  setStyleEnvironment,
  setStyleSheet,
  subscribeStyleSheets,
} from "#css-rules";
import { uniwindStore, type UniwindStore, type UniwindStyles } from "#css-uniwind";
import { addInterceptor } from "#elements";

// ---------------------------------------------------------------------------
// Uniwind
// ---------------------------------------------------------------------------

// Uniwind's `StyleDependency`: what a resolved style is worked out again for.
const COLOR_SCHEME = 1;
const THEME = 2;
const DIMENSIONS = 3;
const VARIABLES = 9;

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const ROOT_FONT_SIZE = 16;
/** On a resolved style: its `!important` declarations, which go over the inline style. */
const IMPORTANT = Symbol("zami.important");

let store: UniwindStore | null = null;

function toStyle(declarations: ReadonlyMap<string, string>): Record<string, unknown> {
  const window = Dimensions.get("window");
  return nativeStyle(declarations, (all) =>
    computeStyle(
      all,
      {
        variable: (name) => Uniwind.getCSSVariable(name) as string | number | undefined,
        // A view's font size isn't known here: `em` is the root's.
        parentFontSize: ROOT_FONT_SIZE,
        rootFontSize: ROOT_FONT_SIZE,
        viewport: { width: window.width, height: window.height },
      },
      MONO,
    ),
  );
}

function reads(declarations: ReadonlyMap<string, string>, pattern: RegExp): boolean {
  for (const value of declarations.values()) if (pattern.test(value)) return true;
  return false;
}

/** `resolved` with what the sheets declare for `className` over it. */
function withRules(className: string, resolved: UniwindStyles): UniwindStyles {
  const rules = classDeclarations(className);
  if (rules === undefined) return resolved;
  const normal = rules.normal.size > 0 ? toStyle(rules.normal) : undefined;
  const important = rules.important.size > 0 ? toStyle(rules.important) : undefined;
  // Over the classes' own styles. The view's inline style goes over these in turn
  // (Uniwind's components pass `[this, props.style]`), all but the important ones.
  const styles = { ...resolved.styles, ...normal, ...important };
  if (important !== undefined) Object.defineProperty(styles, IMPORTANT, { value: important });

  // Uniwind keeps the result until one of its dependencies changes, and views whose
  // style has one re-render then: the rules' own are added to the classes'.
  const dependencies = [...resolved.dependencies];
  let dependencySum = resolved.dependencySum;
  const depend = (dependency: number) => {
    if (dependencies.includes(dependency)) return;
    dependencies.push(dependency);
    dependencySum |= 1 << dependency;
  };
  if (rules.conditional) {
    depend(THEME);
    depend(DIMENSIONS);
    depend(COLOR_SCHEME);
  }
  for (const layer of [rules.normal, rules.important]) {
    if (reads(layer, /var\(/)) {
      depend(VARIABLES);
      depend(THEME);
    }
    if (reads(layer, /\d(?:vw|vh|vmin|vmax)\b/i)) depend(DIMENSIONS);
  }
  return { ...resolved, styles, dependencies, dependencySum };
}

/**
 * Wraps the function Uniwind resolves a `className` with: its store's own, which every
 * styled component and `useResolveClassNames` go through, and whose results Uniwind
 * caches and invalidates itself. If a later Uniwind has no such function, class rules
 * don't reach native views; variables and plugin DOM still work.
 */
function hookUniwind(): void {
  const found = uniwindStore();
  const resolve = found?.resolveStyles;
  if (found === undefined || typeof resolve !== "function") {
    console.warn("[zami] stylesheets: Uniwind's resolver wasn't found; class rules are off");
    return;
  }
  store = found;
  found.resolveStyles = (className, componentProps, state, context) => {
    const resolved = resolve.call(found, className, componentProps, state, context);
    if (!hasClassRules()) return resolved;
    try {
      return withRules(className, resolved);
    } catch (error) {
      console.error("[zami] stylesheets: a class rule couldn't be applied", error);
      return resolved;
    }
  };
}

// The root of the app's views, when the app mounts one: a new (empty) set of scoped
// variables is a new Uniwind context, which re-renders every styled component.
let scopeVariables: Record<string, string> = {};
const scopeListeners = new Set<() => void>();
let scopes = 0;

function subscribeScope(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}
const readScope = () => scopeVariables;

/**
 * Around the app's views (once, at the root), so a change of class rules restyles what's
 * on screen at once. A view whose classes depend on nothing (`flex-1`) listens for
 * nothing, and would otherwise keep its style until something else re-renders it.
 */
export function StyleSheetScope({ children }: { children?: ReactNode }): ReactNode {
  const variables = useSyncExternalStore(subscribeScope, readScope, readScope);
  useEffect(() => {
    scopes++;
    return () => {
      scopes--;
    };
  }, []);
  return createElement(ScopedVariables, { variables }, children);
}

/** Has every styled view work its style out again. */
function restyle(): void {
  for (const cache of Object.values(store?.cache ?? {})) cache?.clear();
  if (scopes > 0) {
    scopeVariables = {};
    for (const listener of Array.from(scopeListeners)) listener();
  } else {
    // Without the scope: the views whose classes read a variable (most of Zam's do).
    Uniwind.updateCSSVariables(Uniwind.currentTheme, {});
  }
}

type Props = Record<string, unknown>;

/**
 * For the element hook (#elements), while some class rule has `!important` declarations:
 * a view Uniwind styled gets them after its inline style. Uniwind's components create
 * their view with `style: [resolved, props.style]`, and `resolved` carries them.
 */
function importantOverInline(_type: unknown, props: Props): { props: Props } | void {
  const style = props.style;
  if (!Array.isArray(style) || style.length !== 2) return;
  const [resolved, inline] = style as [unknown, unknown];
  if (inline === undefined || inline === null || typeof resolved !== "object" || resolved === null)
    return;
  const important = (resolved as Record<symbol, unknown>)[IMPORTANT];
  if (important === undefined) return;
  return { props: { ...props, style: [resolved, inline, important] } };
}

// ---------------------------------------------------------------------------
// Applying a change
// ---------------------------------------------------------------------------

let pending = false;
let hadClassRules = false;
let removeInterceptor: (() => void) | null = null;

function apply(): void {
  pending = false;
  setRootVariableOverrides(rootVariables());
  const classRules = store !== null && hasClassRules();
  if (classRules || hadClassRules) restyle();
  hadClassRules = classRules;
  const important = classRules && hasImportantClassRules();
  if (important && removeInterceptor === null)
    removeInterceptor = addInterceptor("zami:stylesheets", importantOverInline);
  else if (!important && removeInterceptor !== null) {
    removeInterceptor();
    removeInterceptor = null;
  }
}

/** Once per task, however many sheets change in it (a plugin adding several). */
function schedule(): void {
  if (pending) return;
  pending = true;
  queueMicrotask(apply);
}

// ---------------------------------------------------------------------------
// `<style>` elements
// ---------------------------------------------------------------------------

interface ZamiGlobals {
  __ZAMI_DOCUMENT__?: Document;
  __ZAMI_WINDOW__?: { matchMedia?: (query: string) => { matches: boolean } };
}
const globals = globalThis as ZamiGlobals;

const styleElements = new Map<Element, string>();
let nextStyleElement = 1;
let watching = false;

/** Reads the document's `<style>` elements as sheets (each one's, by its own id). */
function readStyleElements(root: Element): void {
  const found = new Set<Element>();
  // (By tag: a selector would be compiled again for every change to the document.)
  for (const element of Array.from(root.getElementsByTagName("style"))) {
    // Zam's own, for sheets it also hands over directly (`setStyleSheet`).
    if (element.hasAttribute("data-zam-css")) continue;
    found.add(element);
    let id = styleElements.get(element);
    if (id === undefined) styleElements.set(element, (id = `style:${nextStyleElement++}`));
    const css = element.textContent ?? "";
    const media = element.getAttribute("media");
    setStyleSheet(id, media && css.trim() !== "" ? `@media ${media}{${css}}` : css);
  }
  for (const [element, id] of Array.from(styleElements)) {
    if (found.has(element)) continue;
    styleElements.delete(element);
    setStyleSheet(id, "");
  }
}

/**
 * Plugins written for the web add `<style>` elements: to `document.head`, or within what
 * they render. Either way they're in Zami's (detached) document, which is watched for
 * them. The watch costs every change to that document a walk up to its root.
 */
function watchStyleElements(): void {
  const document = globals.__ZAMI_DOCUMENT__;
  const root = document?.head?.parentNode as Element | null | undefined;
  // Not there yet (the browser globals are installed as the app starts): the next sheet
  // tries again.
  if (!document || !root) return;
  watching = true;
  const read = () => {
    try {
      readStyleElements(root);
    } catch (error) {
      console.error("[zami] stylesheets: couldn't read the document's <style> elements", error);
    }
  };
  read();
  const Observer = domGlobals(document).MutationObserver as typeof MutationObserver | null;
  if (!Observer) return;
  // An attribute filter, or linkedom reports every attribute change in the document.
  new Observer(read).observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributeFilter: ["media"],
  });
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

let installed = false;

/**
 * Starts applying stylesheets to the app. `setStyleSheet` (#stylesheet) does it for the
 * first sheet; call it earlier to have `<style>` elements count before any sheet is set.
 */
export function installStyleSheets(): void {
  if (installed) {
    if (!watching) watchStyleElements();
    return;
  }
  installed = true;
  setStyleEnvironment({
    theme: () => Uniwind.currentTheme,
    matchMedia: (query) => globals.__ZAMI_WINDOW__?.matchMedia?.(query).matches === true,
  });
  hookUniwind();
  setDomStyleSource({
    subscribe: subscribeStyleSheets,
    match: matchElement,
    variables: referencedVariables,
  });
  subscribeStyleSheets(schedule);

  // Rules under a theme or a media query: what holds of them follows these.
  let theme: string = Uniwind.currentTheme;
  onRootThemeChange(() => {
    if (theme === Uniwind.currentTheme) return;
    theme = Uniwind.currentTheme;
    environmentChanged();
  });
  Dimensions.addEventListener("change", environmentChanged);
  Appearance.addChangeListener(environmentChanged);

  watchStyleElements();
}
