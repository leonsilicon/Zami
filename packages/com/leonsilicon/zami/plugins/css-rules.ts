// The stylesheets in force and what they say: which theme variables they set, what they
// declare for a React Native view with given classes, and what for an element of the DOM
// plugins build. Nothing here touches React Native, so the tests run it as it is;
// #css-native applies it to the app.
//
// A sheet belongs to an id (the user's custom CSS, one of a plugin's `addStyles`, a
// `<style>` element) and sheets apply in the order they were first set, as `<style>`
// elements do in the order they stand in the page.
import { parseStyleSheet } from "#css-parse";
import { analyzeSelector, type SelectorInfo } from "#css-selector";

export interface StyleEnvironment {
  /** Whether a media query holds now. */
  matchMedia: (query: string) => boolean;
  /** The app's theme ("dark" while Zam's `data-theme` is unset). */
  theme: () => string;
}

/** A theme variable a sheet sets: for `theme`, or with null for every theme. */
export interface VariableOverride {
  theme: string | null;
  name: string;
  value: string;
}

/** What the rules declare for something, as two layers of an element's cascade. */
export interface RuleDeclarations {
  /** Under the element's inline style. */
  normal: Map<string, string>;
  /** `!important`: over it. */
  important: Map<string, string>;
  /**
   * Some rule for it holds only in one theme or under a media query, so what applies can
   * change while the sheets stay the same.
   */
  conditional: boolean;
}

type Pairs = readonly (readonly [name: string, value: string])[];

/** One selector of one rule. */
interface Entry {
  info: SelectorInfo;
  normal: Pairs;
  important: Pairs;
  media: readonly string[];
  /** Its place among every sheet's entries. */
  order: number;
  /** Its selector made `matches()` throw: it's never tried again. */
  dead: boolean;
}

interface Sheet {
  css: string;
  entries: Entry[];
}

const sheets = new Map<string, Sheet>();
const listeners = new Set<() => void>();
let version = 0;
let environment: StyleEnvironment = { matchMedia: () => false, theme: () => "dark" };

function compile(css: string): Entry[] {
  const entries: Entry[] = [];
  for (const rule of parseStyleSheet(css)) {
    const normal = rule.declarations
      .filter((d) => !d.important)
      .map((d) => [d.name, d.value] as const);
    const important = rule.declarations
      .filter((d) => d.important)
      .map((d) => [d.name, d.value] as const);
    for (const selector of rule.selectors) {
      const info = analyzeSelector(selector);
      if (info) entries.push({ info, normal, important, media: rule.media, order: 0, dead: false });
    }
  }
  return entries;
}

function changed(): void {
  version++;
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (error) {
      console.error("[zami] stylesheet listener threw", error);
    }
  }
}

/** Sets the sheet `id` owns; with empty `css`, removes it. */
export function setStyleSheet(id: string, css: string): void {
  const text = String(css ?? "");
  const existing = sheets.get(id);
  if (text.trim() === "") {
    if (!existing) return;
    sheets.delete(id);
  } else {
    if (existing?.css === text) return;
    // An id's sheet keeps its place when its text changes (a Map keeps a key's).
    sheets.set(id, { css: text, entries: compile(text) });
  }
  changed();
}

/** The ids with a sheet, in the order the sheets apply. */
export function styleSheetIds(): string[] {
  return [...sheets.keys()];
}

/** Calls `listener` after the sheets (or what holds of them) change. */
export function subscribeStyleSheets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes whenever what the sheets say does. */
export function styleSheetVersion(): number {
  return version;
}

/** How media queries and the theme are read (the app's; the tests' own). */
export function setStyleEnvironment(next: Partial<StyleEnvironment>): void {
  environment = { ...environment, ...next };
}

// ---------------------------------------------------------------------------
// The index: every sheet's entries, sorted out by what they can apply to
// ---------------------------------------------------------------------------

interface Index {
  version: number;
  /** Entries for the root: theme variables. */
  root: Entry[];
  /** Entries for React Native views, by the first of their classes. */
  classes: Map<string, Entry[]>;
  /** Entries for DOM elements (the class ones among them), each under the one thing its
   *  rightmost compound asks of an element that fewest have: an id, a class, a tag. */
  dom: {
    size: number;
    ids: Map<string, Entry[]>;
    classes: Map<string, Entry[]>;
    tags: Map<string, Entry[]>;
    /** With no such thing (`.a > *`, `[hidden]`): tried on every element. */
    rest: Entry[];
  };
  /** The `--x` names the declarations read. */
  variables: string[];
  /** Some class entry has `!important` declarations. */
  importantClasses: boolean;
  /** Some entry holds only in a theme or under a media query. */
  conditional: boolean;
}

let current: Index | null = null;
// A `className` string → the entries all of whose classes it has (for most, none), until
// the sheets change.
const classCandidates = new Map<string, Entry[] | null>();
const CANDIDATE_LIMIT = 5000;

function add(map: Map<string, Entry[]>, key: string, entry: Entry): void {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

function index(): Index {
  if (current !== null && current.version === version) return current;
  const next: Index = {
    version,
    root: [],
    classes: new Map(),
    dom: { size: 0, ids: new Map(), classes: new Map(), tags: new Map(), rest: [] },
    variables: [],
    importantClasses: false,
    conditional: false,
  };
  const variables = new Set<string>();
  let order = 0;
  for (const sheet of sheets.values()) {
    for (const entry of sheet.entries) {
      entry.order = order++;
      const { info } = entry;
      if (info.theme !== null || entry.media.length > 0) next.conditional = true;
      if (info.root) next.root.push(entry);
      else {
        const { key } = info;
        next.dom.size++;
        if (key.id !== undefined) add(next.dom.ids, key.id, entry);
        else if (key.classes.length > 0) add(next.dom.classes, key.classes[0]!, entry);
        else if (key.tag !== undefined) add(next.dom.tags, key.tag, entry);
        else next.dom.rest.push(entry);
        if (info.classes) {
          add(next.classes, info.classes[0]!, entry);
          if (entry.important.length > 0) next.importantClasses = true;
        }
      }
      for (const pairs of [entry.normal, entry.important])
        for (const [, value] of pairs)
          if (value.includes("var("))
            for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) variables.add(match[1]!);
    }
  }
  next.variables = [...variables].sort();
  classCandidates.clear();
  return (current = next);
}

/** The cascade's order: the more specific later, and among equals the one written later. */
function byCascade(a: Entry, b: Entry): number {
  return a.info.specificity - b.info.specificity || a.order - b.order;
}

function mediaHolds(entry: Entry): boolean {
  for (const query of entry.media) {
    try {
      if (!environment.matchMedia(query)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function holds(entry: Entry): boolean {
  if (entry.info.theme !== null && entry.info.theme !== environment.theme()) return false;
  return mediaHolds(entry);
}

/** Sets `name`, last in the map: a later declaration also wins over the shorthands and
 *  longhands declared before it, which are applied in the map's order. */
function declare(map: Map<string, string>, name: string, value: string): void {
  map.delete(name);
  map.set(name, value);
}

function collect(entries: readonly Entry[], conditional: boolean): RuleDeclarations {
  const result: RuleDeclarations = { normal: new Map(), important: new Map(), conditional };
  for (const entry of entries) {
    for (const [name, value] of entry.normal) declare(result.normal, name, value);
    for (const [name, value] of entry.important) declare(result.important, name, value);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Theme variables
// ---------------------------------------------------------------------------

/**
 * The custom properties the sheets declare on the root, the later of two for one name
 * and theme winning. A rule under a media query counts while the query holds.
 */
export function rootVariables(): VariableOverride[] {
  const { root } = index();
  if (root.length === 0) return [];
  // The theme goes with each variable: whoever applies them knows the theme in force.
  const sorted = root.filter(mediaHolds).sort(byCascade);
  const out: VariableOverride[] = [];
  for (const layer of ["normal", "important"] as const)
    for (const entry of sorted)
      for (const [name, value] of entry[layer])
        if (name.startsWith("--")) out.push({ theme: entry.info.theme, name, value });
  return out;
}

// ---------------------------------------------------------------------------
// React Native views, by their classes
// ---------------------------------------------------------------------------

/** Whether any rule is for classes: with none, views aren't looked at at all. */
export function hasClassRules(): boolean {
  return index().classes.size > 0;
}

/** Whether a class rule has `!important` declarations (which go over inline styles). */
export function hasImportantClassRules(): boolean {
  return index().importantClasses;
}

/** What the rules declare for a view with this `className`, or undefined if nothing. */
export function classDeclarations(className: string): RuleDeclarations | undefined {
  const { classes } = index();
  if (classes.size === 0) return undefined;
  let candidates = classCandidates.get(className);
  if (candidates === undefined) {
    const tokens = className.split(/\s+/);
    const found: Entry[] = [];
    for (const token of tokens) {
      const list = classes.get(token);
      if (!list) continue;
      for (const entry of list) {
        const wanted = entry.info.classes!;
        if (wanted.length > 1 && !wanted.every((name) => tokens.includes(name))) continue;
        if (!found.includes(entry)) found.push(entry);
      }
    }
    candidates = found.length > 0 ? found.sort(byCascade) : null;
    if (classCandidates.size >= CANDIDATE_LIMIT) classCandidates.clear();
    classCandidates.set(className, candidates);
  }
  if (candidates === null) return undefined;
  const conditional = candidates.some(
    (entry) => entry.info.theme !== null || entry.media.length > 0,
  );
  return collect(conditional ? candidates.filter(holds) : candidates, conditional);
}

// ---------------------------------------------------------------------------
// DOM elements
// ---------------------------------------------------------------------------

/** What the rules declare for `element`, or undefined if none matches it. */
export function matchElement(element: Element): RuleDeclarations | undefined {
  const { dom } = index();
  if (dom.size === 0) return undefined;
  const tag = element.localName.toLowerCase();
  const id = element.getAttribute("id");
  const tokens = new Set((element.getAttribute("class") ?? "").split(/\s+/));
  let matched: Entry[] | undefined;
  let conditional = false;
  const consider = (entries: readonly Entry[] | undefined) => {
    if (entries === undefined) return;
    for (const entry of entries) {
      if (entry.dead) continue;
      const { key } = entry.info;
      if (key.tag !== undefined && key.tag !== tag) continue;
      if (key.id !== undefined && key.id !== id) continue;
      if (key.classes.length > 1 && !key.classes.every((name) => tokens.has(name))) continue;
      // For a compound of classes alone, having them is the match.
      if (entry.info.classes === null) {
        try {
          if (!element.matches(entry.info.text)) continue;
        } catch {
          // A selector the DOM can't run (a pseudo-element, a typo).
          entry.dead = true;
          continue;
        }
      }
      if (entry.info.theme !== null || entry.media.length > 0) {
        conditional = true;
        if (!holds(entry)) continue;
      }
      (matched ??= []).push(entry);
    }
  };
  consider(dom.rest);
  consider(dom.tags.get(tag));
  if (id !== null) consider(dom.ids.get(id));
  for (const token of tokens) consider(dom.classes.get(token));
  if (!matched) return undefined;
  return collect((matched as Entry[]).sort(byCascade), conditional);
}

/** The `--x` names the sheets' values read, for whoever resolves them. */
export function referencedVariables(): readonly string[] {
  return index().variables;
}

/**
 * The theme, the window or a preference changed. If some rule depends on any of them,
 * that's a change in what the sheets say.
 */
export function environmentChanged(): void {
  if (index().conditional) changed();
}

// ---------------------------------------------------------------------------
// Declarations as a React Native style
// ---------------------------------------------------------------------------

/** What DomView's `computeStyle` makes of declarations (its `ElementStyle`). */
export interface ComputedStyle {
  box: object;
  text: object;
  display?: string;
  hidden?: boolean;
  pointerEvents?: string;
  objectFit?: string;
}

const GENERIC_FAMILIES =
  /^(serif|sans-serif|system-ui|ui-serif|ui-sans-serif|ui-rounded|cursive|fantasy|emoji|math|inherit|initial|unset)$/i;

/**
 * `declarations` as a style for a React Native view: `compute`'s box and text styles in
 * one object, with what a view has in place of the DOM-only parts.
 */
export function nativeStyle(
  declarations: ReadonlyMap<string, string>,
  compute: (declarations: ReadonlyMap<string, string>) => ComputedStyle,
): Record<string, unknown> {
  const computed = compute(declarations);
  const style: Record<string, unknown> = { ...computed.box, ...computed.text };
  if (computed.display !== undefined)
    style.display =
      computed.display === "none" || computed.display === "contents" ? computed.display : "flex";
  if (computed.hidden) style.opacity = 0;
  if (computed.pointerEvents !== undefined) style.pointerEvents = computed.pointerEvents;
  if (computed.objectFit !== undefined) style.objectFit = computed.objectFit;
  // DomView stacks positioned elements over their siblings, as a page does; a view's
  // order is its own unless the sheet says otherwise.
  if (style.zIndex !== undefined && !declarations.has("z-index")) delete style.zIndex;
  if (/^visible$/i.test(declarations.get("overflow") ?? "")) style.overflow = "visible";
  // A named font, when the sheet names one the app has: DomView only knows monospace.
  const family = declarations.get("font-family");
  if (family !== undefined && style.fontFamily === undefined && !family.includes("var(")) {
    const first = family
      .split(",")[0]!
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
    if (first !== "" && !GENERIC_FAMILIES.test(first)) style.fontFamily = first;
  }
  return style;
}

/** Forgets every sheet (the tests'). */
export function resetStyleSheets(): void {
  sheets.clear();
  classCandidates.clear();
  current = null;
  changed();
}
