// DomView: a DOM subtree (Zami's detached linkedom DOM, where Zam's plugins build their
// UIs) shown as React Native views. Presses and edits go back to the nodes as DOM
// events, and the view re-renders when the subtree changes.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type AccessibilityRole,
  type ImageStyle,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";
import { useCSSVariable, useResolveClassNames } from "uniwind";
import { WebView } from "react-native-webview";
import {
  CustomEvent as LinkedomCustomEvent,
  Event as LinkedomEvent,
  EventTarget as LinkedomEventTarget,
  HTMLSelectElement as LinkedomSelect,
  InputEvent as LinkedomInputEvent,
} from "linkedom";
import { Checkbox } from "#checkbox";
import {
  computeStyle,
  parseDeclarations,
  variableNames,
  type Display,
  type ElementStyle,
  type WhiteSpace,
} from "#dom-style";
import { openLink } from "#html";
import { Image, mediaSource } from "#image";
import { Radio } from "#radio";
import { Range } from "#range";
import { Select } from "#select";
import { Video } from "#video";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const ROOT_FONT_SIZE = 16;
const DEFAULT_TEXT_CLASS = "text-base text-discord-textPrimary";
const ACCENT = "--discord-accent";

// ---------------------------------------------------------------------------
// The detached DOM: events, listeners, and the gaps plugins hit
// ---------------------------------------------------------------------------

type EventInitLike = EventInit & Record<string, unknown>;
type EventClass = new (type: string, init?: EventInitLike) => Event;

const BaseEvent = LinkedomEvent as unknown as EventClass;

/** `KeyboardEvent` for the detached DOM: `key`, `code` and the modifier flags. */
class DomKeyboardEvent extends BaseEvent {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  constructor(type: string, init: EventInitLike = {}) {
    super(type, init);
    this.key = typeof init.key === "string" ? init.key : "";
    this.code = typeof init.code === "string" ? init.code : "";
    this.altKey = !!init.altKey;
    this.ctrlKey = !!init.ctrlKey;
    this.metaKey = !!init.metaKey;
    this.shiftKey = !!init.shiftKey;
    this.repeat = !!init.repeat;
    this.isComposing = !!init.isComposing;
  }
}

/** `MouseEvent` for the detached DOM: a press is a primary-button click. */
class DomMouseEvent extends BaseEvent {
  button: number;
  buttons: number;
  detail: number;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  relatedTarget: unknown;
  constructor(type: string, init: EventInitLike = {}) {
    super(type, init);
    this.button = Number(init.button ?? 0);
    this.buttons = Number(init.buttons ?? 0);
    this.detail = Number(init.detail ?? 0);
    this.clientX = Number(init.clientX ?? 0);
    this.clientY = Number(init.clientY ?? 0);
    this.screenX = Number(init.screenX ?? 0);
    this.screenY = Number(init.screenY ?? 0);
    this.altKey = !!init.altKey;
    this.ctrlKey = !!init.ctrlKey;
    this.metaKey = !!init.metaKey;
    this.shiftKey = !!init.shiftKey;
    this.relatedTarget = init.relatedTarget ?? null;
  }
}

class DomPointerEvent extends DomMouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: EventInitLike = {}) {
    super(type, init);
    this.pointerId = Number(init.pointerId ?? 1);
    this.pointerType = typeof init.pointerType === "string" ? init.pointerType : "touch";
    this.isPrimary = init.isPrimary === undefined ? true : !!init.isPrimary;
  }
}

class DomFocusEvent extends BaseEvent {
  relatedTarget: unknown;
  constructor(type: string, init: EventInitLike = {}) {
    super(type, init);
    this.relatedTarget = init.relatedTarget ?? null;
  }
}

/** `CSS.escape` (the CSSOM spec's algorithm). */
function cssEscape(value: string): string {
  const string = String(value);
  const first = string.charCodeAt(0);
  let result = "";
  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);
    if (code === 0) result += "�";
    else if (
      (code >= 1 && code <= 31) ||
      code === 127 ||
      (i === 0 && code >= 48 && code <= 57) ||
      (i === 1 && code >= 48 && code <= 57 && first === 45)
    )
      result += `\\${code.toString(16)} `;
    else if (i === 0 && string.length === 1 && code === 45) result += `\\${string.charAt(i)}`;
    else if (
      code >= 128 ||
      code === 45 ||
      code === 95 ||
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    )
      result += string.charAt(i);
    else result += `\\${string.charAt(i)}`;
  }
  return result;
}

/** linkedom's `MutationObserver` for `document`: it hangs off the document, built on
 *  first use through `defaultView`, a proxy of `globalThis` this only reads it from. */
function mutationObserverOf(document: Document | null | undefined): typeof MutationObserver | null {
  if (!document) return null;
  const doc = document as unknown as Record<symbol, { class?: typeof MutationObserver | null }>;
  const symbol = Object.getOwnPropertySymbols(doc).find(
    (s) => s.description === "MutationObserver",
  );
  if (!symbol) {
    // Not linkedom's: a real DOM (tests run in jsdom).
    return typeof globalThis.MutationObserver === "function" ? globalThis.MutationObserver : null;
  }
  if (!doc[symbol]?.class) {
    try {
      void (document.defaultView as unknown as Record<string, unknown> | null)?.MutationObserver;
    } catch {
      // The proxy's invariant check can throw after the class is built; it's built.
    }
  }
  return doc[symbol]?.class ?? null;
}

/**
 * The names a plugin's code needs to work with the DOM nodes DomView shows, which the
 * browser would have as globals: the event classes (linkedom's, which its nodes
 * dispatch), `MutationObserver` for `document`, `CSS.escape` and `getComputedStyle`
 * (the element's inline style).
 */
export function domGlobals(document: Pick<Document, "createElement">): Record<string, unknown> {
  const owner = document.createElement("div").ownerDocument;
  return {
    Event: LinkedomEvent,
    CustomEvent: LinkedomCustomEvent,
    InputEvent: LinkedomInputEvent,
    KeyboardEvent: DomKeyboardEvent,
    MouseEvent: DomMouseEvent,
    PointerEvent: DomPointerEvent,
    FocusEvent: DomFocusEvent,
    EventTarget: LinkedomEventTarget,
    MutationObserver: mutationObserverOf(owner),
    CSS: { escape: cssEscape, supports: () => false },
    getComputedStyle: (element: HTMLElement) => element.style,
  };
}

/** An event of `element`'s own DOM (linkedom's, or a real DOM's in tests). */
function domEvent(
  element: Node,
  kind: "event" | "keyboard" | "mouse" | "focus" | "input",
  type: string,
  init: EventInitLike,
): Event {
  if (element instanceof (LinkedomEventTarget as unknown as typeof EventTarget)) {
    const Class =
      kind === "keyboard"
        ? DomKeyboardEvent
        : kind === "mouse"
          ? DomPointerEvent
          : kind === "focus"
            ? DomFocusEvent
            : kind === "input"
              ? (LinkedomInputEvent as unknown as EventClass)
              : BaseEvent;
    const event = new Class(type, init) as unknown as Record<string, unknown>;
    // What the event's own class would carry: a form's submitter, a custom detail.
    for (const key of ["submitter", "detail"])
      if (key in init && event[key] === undefined) event[key] = init[key];
    return event as unknown as Event;
  }
  const g = globalThis as unknown as Record<string, EventClass | undefined>;
  const Class =
    (kind === "keyboard"
      ? g.KeyboardEvent
      : kind === "mouse"
        ? g.MouseEvent
        : kind === "focus"
          ? g.FocusEvent
          : kind === "input"
            ? g.InputEvent
            : g.Event) ?? (g.Event as EventClass);
  return new Class(type, init);
}

/** Dispatches an event at `element`; false if a listener cancelled it. */
function fire(
  element: Node,
  type: string,
  {
    kind = "event",
    ...init
  }: EventInitLike & { kind?: "event" | "keyboard" | "mouse" | "focus" | "input" } = {},
): boolean {
  try {
    return element.dispatchEvent(domEvent(element, kind, type, init));
  } catch (error) {
    // A listener that throws mustn't take the view down, as in a browser.
    console.error(`[DomView] a "${type}" listener threw`, error);
    return true;
  }
}

// Which event types each node has listeners for, so a node with a `click` listener can
// be pressed. linkedom keeps its listeners private, so its addEventListener is wrapped.
const listenerTypes = new WeakMap<object, Map<string, number>>();
{
  const proto = (LinkedomEventTarget as unknown as { prototype: EventTarget }).prototype;
  // oxlint-disable-next-line typescript/unbound-method -- called with the node as `this`
  const add = proto.addEventListener;
  // oxlint-disable-next-line typescript/unbound-method -- called with the node as `this`
  const remove = proto.removeEventListener;
  proto.addEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
    let types = listenerTypes.get(this);
    if (!types) listenerTypes.set(this, (types = new Map()));
    types.set(type, (types.get(type) ?? 0) + 1);
    return (add as (...args: unknown[]) => void).call(this, type, ...rest);
  } as EventTarget["addEventListener"];
  proto.removeEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
    const types = listenerTypes.get(this);
    const count = types?.get(type) ?? 0;
    if (count <= 1) types?.delete(type);
    else types?.set(type, count - 1);
    return (remove as (...args: unknown[]) => void).call(this, type, ...rest);
  } as EventTarget["removeEventListener"];

  // linkedom's <select> has a read-only `value` (setting it throws in strict code) and
  // no `selectedIndex`: both select an option, as in a browser.
  const selectProto = (LinkedomSelect as unknown as { prototype: object }).prototype;
  const options = (select: Element) => [...select.querySelectorAll("option")];
  const selectIndex = (select: Element, index: number) =>
    options(select).forEach((option, i) =>
      i === index ? option.setAttribute("selected", "") : option.removeAttribute("selected"),
    );
  const valueOf = (option: Element) => option.getAttribute("value") ?? option.textContent ?? "";
  Object.defineProperty(selectProto, "value", {
    configurable: true,
    get(this: Element) {
      const all = options(this);
      const selected = all.find((option) => option.hasAttribute("selected")) ?? all[0];
      return selected ? valueOf(selected) : "";
    },
    set(this: Element, value: unknown) {
      selectIndex(
        this,
        options(this).findIndex((option) => valueOf(option) === String(value)),
      );
    },
  });
  Object.defineProperty(selectProto, "selectedIndex", {
    configurable: true,
    get(this: Element) {
      const all = options(this);
      const index = all.findIndex((option) => option.hasAttribute("selected"));
      return index < 0 && all.length > 0 ? 0 : index;
    },
    set(this: Element, index: unknown) {
      selectIndex(this, Number(index));
    },
  });
}

function hasListener(node: Node, type: string): boolean {
  return (listenerTypes.get(node)?.get(type) ?? 0) > 0;
}

/** Whether a checkbox or radio is checked: its `checked` property, else its attribute. */
function isChecked(input: Element): boolean {
  const own = (input as unknown as { checked?: unknown }).checked;
  return typeof own === "boolean" ? own : input.hasAttribute("checked");
}

function setChecked(input: Element, checked: boolean): void {
  (input as unknown as { checked: boolean }).checked = checked;
}

function isDisabled(element: Element): boolean {
  return element.hasAttribute("disabled") || element.closest("fieldset[disabled]") !== null;
}

// ---------------------------------------------------------------------------
// Rendering context
// ---------------------------------------------------------------------------

/** A style being built up (React Native's style types are read-only). */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** What a text field's native input offers that `el.focus()` and labels use. */
interface Focusable {
  focus(): void;
  blur(): void;
}

interface Inherited {
  /** Every inherited text property, for the root of a run of text. */
  text: TextStyle;
  fontSize: number;
  color?: string;
  whiteSpace: WhiteSpace;
}

interface DomContextValue {
  root: Element;
  variable: (name: string) => string | number | undefined;
  viewport: { width: number; height: number };
  refresh: () => void;
  onLinkPress: (href: string) => void;
  resolveMxc?: (mxc: string) => string | null;
  /** Each text field's input, so `el.focus()` and a `<label>` can focus it. */
  inputs: WeakMap<Element, Focusable>;
}

const DomContext = createContext<DomContextValue | null>(null);

function useDom(): DomContextValue {
  const ctx = useContext(DomContext);
  if (!ctx) throw new Error("DomView: rendered outside a DomView");
  return ctx;
}

// Stable React keys for nodes, so a field keeps its focus when its siblings change.
let nextKey = 1;
const nodeKeys = new WeakMap<object, number>();
function keyOf(node: object): number {
  let key = nodeKeys.get(node);
  if (key === undefined) nodeKeys.set(node, (key = nextKey++));
  return key;
}

const declarationCache = new WeakMap<
  Element,
  { text: string | null; declarations: Map<string, string> }
>();
function declarationsOf(element: Element): Map<string, string> {
  const text = element.getAttribute("style");
  const cached = declarationCache.get(element);
  if (cached && cached.text === text) return cached.declarations;
  const declarations = parseDeclarations(text);
  declarationCache.set(element, { text, declarations });
  return declarations;
}

const TEXT_KEYS = new Set([
  "color",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "textDecorationLine",
]);

/** An element's `class` resolved through Uniwind, split into text and box styles. */
function useClassStyle(className: string | null): { text: TextStyle; box: ViewStyle } {
  const resolved = useResolveClassNames(className ?? "") as Record<string, unknown>;
  return useMemo(() => {
    const text: Record<string, unknown> = {};
    const box: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(resolved ?? {}))
      (TEXT_KEYS.has(key) ? text : box)[key] = value;
    return { text: text as TextStyle, box: box as ViewStyle };
  }, [resolved]);
}

// ---------------------------------------------------------------------------
// Element kinds and tag defaults
// ---------------------------------------------------------------------------

const SKIPPED = new Set([
  "script",
  "style",
  "template",
  "head",
  "meta",
  "link",
  "title",
  "noscript",
  "base",
  "source",
  "track",
  "param",
  "datalist",
  "option",
  "optgroup",
  "colgroup",
  "col",
  "area",
  "map",
  "audio",
  "canvas",
  "object",
  "embed",
]);
const INLINE = new Set([
  "span",
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "del",
  "ins",
  "mark",
  "small",
  "big",
  "sub",
  "sup",
  "code",
  "kbd",
  "samp",
  "var",
  "abbr",
  "cite",
  "q",
  "time",
  "label",
  "font",
  "bdi",
  "bdo",
  "data",
  "output",
  "dfn",
  "tt",
  "strike",
  "nobr",
  "br",
  "wbr",
]);
const ATOMIC = new Set([
  "img",
  "button",
  "input",
  "select",
  "textarea",
  "svg",
  "video",
  "iframe",
  "progress",
  "meter",
]);
const CLASS_DISPLAY: Readonly<Record<string, Display>> = {
  hidden: "none",
  block: "block",
  "inline-block": "inline-block",
  inline: "inline",
  flex: "flex",
  "inline-flex": "inline-flex",
  grid: "grid",
  "inline-grid": "grid",
  contents: "contents",
};

const TAG_TEXT: Readonly<Record<string, TextStyle>> = {
  b: { fontWeight: "bold" },
  strong: { fontWeight: "bold" },
  th: { fontWeight: "bold" },
  i: { fontStyle: "italic" },
  em: { fontStyle: "italic" },
  cite: { fontStyle: "italic" },
  dfn: { fontStyle: "italic" },
  var: { fontStyle: "italic" },
  address: { fontStyle: "italic" },
  u: { textDecorationLine: "underline" },
  ins: { textDecorationLine: "underline" },
  s: { textDecorationLine: "line-through" },
  del: { textDecorationLine: "line-through" },
  strike: { textDecorationLine: "line-through" },
  code: { fontFamily: MONO },
  kbd: { fontFamily: MONO },
  samp: { fontFamily: MONO },
  pre: { fontFamily: MONO },
  tt: { fontFamily: MONO },
};
const TAG_FONT_SCALE: Readonly<Record<string, number>> = {
  small: 0.83,
  sub: 0.83,
  sup: 0.83,
  big: 1.2,
};

type Kind = "skip" | "text" | "inline" | "atomic" | "block" | "contents";

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/** `display` from the element's inline style, then its classes. */
function declaredDisplay(element: Element): Display | undefined {
  const fromStyle = declarationsOf(element).get("display");
  if (fromStyle) {
    const style = computeStyle(new Map([["display", fromStyle]]), PLAIN_CONTEXT);
    if (style.display) return style.display;
  }
  const classes = element.getAttribute("class");
  if (classes)
    for (const token of classes.split(/\s+/).reverse())
      if (Object.hasOwn(CLASS_DISPLAY, token)) return CLASS_DISPLAY[token];
  return undefined;
}

const PLAIN_CONTEXT = {
  variable: () => undefined,
  parentFontSize: ROOT_FONT_SIZE,
  rootFontSize: ROOT_FONT_SIZE,
  viewport: { width: 0, height: 0 },
};

function kindOf(node: Node): Kind {
  if (node.nodeType === 3) return "text";
  if (!isElement(node)) return "skip";
  const tag = node.localName;
  if (SKIPPED.has(tag) || node.hasAttribute("hidden")) return "skip";
  if (tag === "input" && node.getAttribute("type")?.toLowerCase() === "hidden") return "skip";
  const display = declaredDisplay(node);
  if (display === "none") return "skip";
  if (display === "contents") return "contents";
  if (ATOMIC.has(tag)) return display === "block" || display === "flex" ? "block" : "atomic";
  if (display === "inline") return "inline";
  if (display === "inline-block" || display === "inline-flex") return "atomic";
  if (display) return "block";
  if (INLINE.has(tag)) {
    // An inline element with a box of its own (padding, a border) can't be drawn
    // inside a line of text: it's laid out as an inline-block.
    const declarations = declarationsOf(node);
    for (const name of declarations.keys())
      if (/^(padding|border|width|height|min-|max-)/.test(name)) return "atomic";
    return "inline";
  }
  return "block";
}

/** Children, with `display: contents` elements replaced by theirs. */
function flowChildren(element: Element): Node[] {
  const out: Node[] = [];
  for (const child of element.childNodes) {
    if (isElement(child) && kindOf(child) === "contents") out.push(...flowChildren(child));
    else out.push(child);
  }
  return out;
}

function collapse(text: string, whiteSpace: WhiteSpace): string {
  if (whiteSpace === "pre" || whiteSpace === "pre-wrap") return text;
  if (whiteSpace === "pre-line") return text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n");
  return text.replace(/[ \t\n\r\f]+/g, " ");
}

/** `color` at half opacity: Tailwind's placeholder color. */
function halfOpacity(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  if (hex) {
    const digits = hex[1]!.length === 3 ? hex[1]!.replace(/./g, (d) => d + d) : hex[1]!;
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, 0.5)`;
  }
  const rgba = /^rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(color);
  if (rgba) return `rgba(${rgba[1]},${rgba[2]},${rgba[3]}, ${Number(rgba[4]) * 0.5})`;
  return color;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

interface Resolved {
  style: ElementStyle;
  /** The element's own text style (for a nested Text: what it adds). */
  ownText: TextStyle;
  box: ViewStyle;
  /** What its children inherit. */
  inherited: Inherited;
}

function resolveStyle(
  element: Element,
  inherited: Inherited,
  ctx: DomContextValue,
  classStyle: { text: TextStyle; box: ViewStyle },
): Resolved {
  const tag = element.localName;
  const scale = TAG_FONT_SCALE[tag];
  const parentFontSize = inherited.fontSize;
  const style = computeStyle(
    declarationsOf(element),
    {
      variable: ctx.variable,
      parentFontSize,
      rootFontSize: ROOT_FONT_SIZE,
      viewport: ctx.viewport,
      color: (classStyle.text.color as string | undefined) ?? inherited.color,
    },
    MONO,
  );
  const ownText: Writable<TextStyle> = { ...TAG_TEXT[tag], ...classStyle.text, ...style.text };
  if (style.text.fontSize === undefined && classStyle.text.fontSize === undefined && scale)
    ownText.fontSize = parentFontSize * scale;
  const fontSize = (ownText.fontSize as number | undefined) ?? parentFontSize;
  const box: Writable<ViewStyle> = { ...classStyle.box, ...style.box };
  // A border with no color of its own is drawn in the text color, as `currentColor`.
  const color = (ownText.color as string | undefined) ?? inherited.color;
  const borderWidths = [
    "borderWidth",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
  ] as const;
  const borderColors = [
    "borderColor",
    "borderTopColor",
    "borderRightColor",
    "borderBottomColor",
    "borderLeftColor",
  ] as const;
  if (
    borderWidths.some((key) => (box[key] as number | undefined) ?? 0) &&
    !borderColors.some((key) => box[key])
  )
    box.borderColor = color;
  if (tag === "hr") {
    box.borderTopWidth ??= 1;
    box.borderColor ??= color;
  }
  if (style.hidden) {
    box.opacity = 0;
  }
  return {
    style,
    ownText,
    box,
    inherited: {
      text: { ...inherited.text, ...ownText },
      fontSize,
      color,
      whiteSpace: style.whiteSpace ?? (tag === "pre" ? "pre" : inherited.whiteSpace),
    },
  };
}

// ---------------------------------------------------------------------------
// Presses and default actions
// ---------------------------------------------------------------------------

const PRESSABLE_ROLES = new Set([
  "button",
  "link",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "checkbox",
  "switch",
  "radio",
  "treeitem",
  "gridcell",
]);

/** Whether a press on the element should reach it as a click. */
function isInteractive(element: Element): boolean {
  const tag = element.localName;
  if (tag === "button" || tag === "summary" || tag === "label") return true;
  if (tag === "a" && element.hasAttribute("href")) return true;
  if (
    hasListener(element, "click") ||
    hasListener(element, "pointerdown") ||
    hasListener(element, "mousedown")
  )
    return true;
  if ((element as unknown as { onclick?: unknown }).onclick) return true;
  const role = element.getAttribute("role");
  if (role && PRESSABLE_ROLES.has(role)) return true;
  if (element.hasAttribute("tabindex")) return true;
  return /cursor\s*:\s*pointer/i.test(element.getAttribute("style") ?? "");
}

function accessibilityRoleOf(element: Element): AccessibilityRole | undefined {
  const role = element.getAttribute("role");
  const map: Record<string, AccessibilityRole> = {
    button: "button",
    link: "link",
    checkbox: "checkbox",
    switch: "switch",
    radio: "radio",
    tab: "tab",
    menuitem: "menuitem",
    option: "button",
    heading: "header",
    img: "image",
    list: "list",
    progressbar: "progressbar",
  };
  if (role && map[role]) return map[role];
  const tag = element.localName;
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (/^h[1-6]$/.test(tag)) return "header";
  return undefined;
}

function accessibilityProps(element: Element) {
  const label = element.getAttribute("aria-label") ?? undefined;
  const hidden = element.getAttribute("aria-hidden") === "true";
  const selected = element.getAttribute("aria-selected");
  const checked = element.getAttribute("aria-checked");
  const expanded = element.getAttribute("aria-expanded");
  return {
    accessibilityLabel: label,
    accessibilityElementsHidden: hidden || undefined,
    importantForAccessibility: hidden ? ("no-hide-descendants" as const) : undefined,
    accessibilityState:
      selected || checked || expanded || isDisabled(element)
        ? {
            selected: selected === null ? undefined : selected === "true",
            checked:
              checked === null
                ? undefined
                : checked === "mixed"
                  ? ("mixed" as const)
                  : checked === "true",
            expanded: expanded === null ? undefined : expanded === "true",
            disabled: isDisabled(element) || undefined,
          }
        : undefined,
  };
}

/** Submits a form as a browser does when a submit button is pressed: a cancelable
 *  `submit` event, and nothing else (there's no page to navigate). */
function submit(form: Element, submitter: Element | null): void {
  fire(form, "submit", { bubbles: true, cancelable: true, submitter });
}

/** Checks a checkbox or radio as a press does: toggled first, then `click` (which may
 *  cancel the toggle), then `input` and `change`. */
function toggleCheckable(input: Element, ctx: DomContextValue): void {
  if (isDisabled(input)) return;
  const radio = input.getAttribute("type")?.toLowerCase() === "radio";
  const was = isChecked(input);
  if (radio && was) {
    fire(input, "click", { kind: "mouse", bubbles: true, cancelable: true, detail: 1 });
    ctx.refresh();
    return;
  }
  const group: Element[] = [];
  if (radio) {
    const name = input.getAttribute("name");
    const scope = input.closest("form") ?? ctx.root;
    if (name)
      for (const other of scope.querySelectorAll("input"))
        if (
          other !== input &&
          other.getAttribute("type")?.toLowerCase() === "radio" &&
          other.getAttribute("name") === name &&
          isChecked(other)
        ) {
          group.push(other);
          setChecked(other, false);
        }
  }
  setChecked(input, !was);
  if (!fire(input, "click", { kind: "mouse", bubbles: true, cancelable: true, detail: 1 })) {
    setChecked(input, was);
    for (const other of group) setChecked(other, true);
  } else {
    fire(input, "input", { kind: "input", bubbles: true });
    fire(input, "change", { bubbles: true });
  }
  ctx.refresh();
}

/** The control a `<label>` is for: its `for` element, else the first one inside it. */
function labelControl(label: Element, ctx: DomContextValue): Element | null {
  const id = label.getAttribute("for");
  if (id) {
    const selector = `#${cssEscape(id)}`;
    return ctx.root.querySelector(selector) ?? label.ownerDocument?.querySelector(selector) ?? null;
  }
  return label.querySelector("input, select, textarea, button");
}

/** A press on `element`: a click, then what the browser does by default for it or the
 *  nearest ancestor with a default action. */
function press(element: Element, ctx: DomContextValue): void {
  if (isDisabled(element) && (element.localName === "button" || element.localName === "input"))
    return;
  const allowed = fire(element, "click", {
    kind: "mouse",
    bubbles: true,
    cancelable: true,
    detail: 1,
  });
  if (allowed) {
    const target = element.closest("a[href], button, summary, label, input");
    switch (target?.localName) {
      case "a":
        ctx.onLinkPress(target.getAttribute("href")!);
        break;
      case "button":
      case "input": {
        const type = (
          target.getAttribute("type") ?? (target.localName === "button" ? "submit" : "text")
        ).toLowerCase();
        const form = target.closest("form");
        if (form && (type === "submit" || type === "image")) submit(form, target);
        break;
      }
      case "summary": {
        const details = target.parentElement;
        if (
          details?.localName === "details" &&
          details.querySelector(":scope > summary") === target
        ) {
          if (details.hasAttribute("open")) details.removeAttribute("open");
          else details.setAttribute("open", "");
          fire(details, "toggle");
        }
        break;
      }
      case "label": {
        const control = labelControl(target, ctx);
        if (!control || control === element) break;
        const type = control.getAttribute("type")?.toLowerCase();
        if (control.localName === "input" && (type === "checkbox" || type === "radio"))
          toggleCheckable(control, ctx);
        else ctx.inputs.get(control)?.focus();
        break;
      }
    }
  }
  ctx.refresh();
}

/** Gives the element `getBoundingClientRect()` of the view showing it (a plugin anchors
 *  a popover to an element it built). */
function bindHost(element: Element, host: unknown): void {
  if (!host) return;
  const view = host as {
    getBoundingClientRect?: () => DOMRect;
    measureInWindow?: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: () => {
      const rect = view.getBoundingClientRect?.();
      if (rect) return rect;
      let box = { x: 0, y: 0, width: 0, height: 0 };
      view.measureInWindow?.((x, y, width, height) => (box = { x, y, width, height }));
      return {
        ...box,
        left: box.x,
        top: box.y,
        right: box.x + box.width,
        bottom: box.y + box.height,
        toJSON: () => box,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Flow: blocks, runs of text, flex items
// ---------------------------------------------------------------------------

function renderFlow(
  element: Element,
  inherited: Inherited,
  mode: "block" | "flex",
  lines?: number,
): ReactNode[] {
  const out: ReactNode[] = [];
  const children = flowChildren(element);
  if (mode === "flex") {
    for (const child of children) {
      const kind = kindOf(child);
      if (kind === "skip") continue;
      if (kind === "text") {
        const text = collapse(child.textContent ?? "", inherited.whiteSpace);
        if (text.trim() === "") continue;
        out.push(
          <Text key={keyOf(child)} style={inherited.text} numberOfLines={lines}>
            {inherited.whiteSpace.startsWith("pre") ? text : text.trim()}
          </Text>,
        );
      } else if (child.nodeType === 1 && (child as Element).localName !== "br") {
        out.push(
          <DomElement key={keyOf(child)} node={child as Element} inherited={inherited} flexItem />,
        );
      }
    }
    return out;
  }
  let run: Node[] = [];
  const flush = () => {
    if (run.length > 0) {
      const nodes = run;
      run = [];
      const visible = nodes.some(
        (node) =>
          node.nodeType !== 3 ||
          collapse(node.textContent ?? "", inherited.whiteSpace).trim() !== "",
      );
      if (visible)
        out.push(<Run key={keyOf(nodes[0]!)} nodes={nodes} inherited={inherited} lines={lines} />);
    }
  };
  for (const child of children) {
    const kind = kindOf(child);
    if (kind === "skip") continue;
    if (kind === "block") {
      flush();
      out.push(<DomElement key={keyOf(child)} node={child as Element} inherited={inherited} />);
    } else run.push(child);
  }
  flush();
  return out;
}

/** A run of inline content: one Text, or a wrapping row when it holds inline-blocks. */
function Run({
  nodes,
  inherited,
  lines,
}: {
  nodes: Node[];
  inherited: Inherited;
  lines?: number;
}): ReactNode {
  if (!nodes.some((node) => kindOf(node) === "atomic"))
    return <TextRun nodes={nodes} inherited={inherited} lines={lines} />;
  const pieces: ReactNode[] = [];
  let text: Node[] = [];
  const flush = () => {
    if (text.some((node) => node.nodeType !== 3 || (node.textContent ?? "").trim() !== ""))
      pieces.push(
        <TextRun key={keyOf(text[0]!)} nodes={text} inherited={inherited} lines={lines} />,
      );
    text = [];
  };
  for (const node of nodes) {
    if (kindOf(node) === "atomic") {
      flush();
      pieces.push(
        <DomElement key={keyOf(node)} node={node as Element} inherited={inherited} inlineBlock />,
      );
    } else text.push(node);
  }
  flush();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 4 }}>
      {pieces}
    </View>
  );
}

function TextRun({
  nodes,
  inherited,
  lines,
}: {
  nodes: Node[];
  inherited: Inherited;
  lines?: number;
}): ReactNode {
  const children = inlineChildren(nodes, inherited);
  // Trim the run's edges, as a line box drops the spaces at its start and end.
  if (!inherited.whiteSpace.startsWith("pre")) {
    if (typeof children[0] === "string") children[0] = children[0].trimStart();
    const last = children.length - 1;
    if (typeof children[last] === "string") children[last] = (children[last] as string).trimEnd();
  }
  return (
    <Text style={inherited.text} numberOfLines={lines} ellipsizeMode="tail">
      {children}
    </Text>
  );
}

function inlineChildren(nodes: Node[], inherited: Inherited): ReactNode[] {
  const out: ReactNode[] = [];
  for (const node of nodes) {
    const kind = kindOf(node);
    if (kind === "skip") continue;
    if (kind === "text") out.push(collapse(node.textContent ?? "", inherited.whiteSpace));
    else if ((node as Element).localName === "br") out.push("\n");
    else if (kind === "inline")
      out.push(<DomInline key={keyOf(node)} node={node as Element} inherited={inherited} />);
    // A block inside an inline element: drawn inline, on its own.
    else
      out.push(
        <DomElement key={keyOf(node)} node={node as Element} inherited={inherited} inlineBlock />,
      );
  }
  return out;
}

/** An inline element inside a run of text: a nested Text. */
function DomInline({ node, inherited }: { node: Element; inherited: Inherited }): ReactNode {
  const ctx = useDom();
  const classStyle = useClassStyle(node.getAttribute("class"));
  const resolved = resolveStyle(node, inherited, ctx, classStyle);
  const interactive = isInteractive(node);
  const style: Writable<TextStyle> = { ...resolved.ownText };
  if (resolved.box.backgroundColor) style.backgroundColor = resolved.box.backgroundColor;
  if (resolved.box.opacity !== undefined) style.opacity = resolved.box.opacity;
  return (
    <Text
      style={style}
      onPress={interactive ? () => press(node, ctx) : undefined}
      accessibilityRole={accessibilityRoleOf(node)}
      {...accessibilityProps(node)}
    >
      {inlineChildren(flowChildren(node), resolved.inherited)}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Elements with a box
// ---------------------------------------------------------------------------

interface ElementProps {
  node: Element;
  inherited: Inherited;
  /** A child of a flex container: it shrinks, as CSS flex items do. */
  flexItem?: boolean;
  /** Laid out in a line of inline content. */
  inlineBlock?: boolean;
}

function DomElement({ node, inherited, flexItem, inlineBlock }: ElementProps): ReactNode {
  const ctx = useDom();
  const classStyle = useClassStyle(node.getAttribute("class"));
  const resolved = resolveStyle(node, inherited, ctx, classStyle);
  const tag = node.localName;
  const box: Writable<ViewStyle> = { ...resolved.box };
  if (flexItem && box.flexShrink === undefined && box.flex === undefined) box.flexShrink = 1;
  if (inlineBlock) box.alignSelf ??= "flex-start";
  const ref = (host: unknown) => bindHost(node, host);

  switch (tag) {
    case "img":
      return <ImageElement node={node} resolved={resolved} box={box} hostRef={ref} />;
    case "input": {
      const type = (node.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox" || type === "radio")
        return <CheckableElement node={node} type={type} box={box} />;
      if (type === "range") return <RangeElement node={node} box={box} />;
      if (type === "button" || type === "submit" || type === "reset" || type === "image")
        return (
          <Pressable
            ref={ref}
            style={({ pressed }) => [box, pressed && { opacity: (box.opacity ?? 1) * 0.6 }]}
            onPress={() => press(node, ctx)}
            disabled={isDisabled(node)}
            accessibilityRole="button"
            {...accessibilityProps(node)}
          >
            <Text style={resolved.inherited.text}>
              {node.getAttribute("value") ??
                (type === "submit" ? "Submit" : type === "reset" ? "Reset" : "")}
            </Text>
          </Pressable>
        );
      if (type === "file" || type === "color") return null;
      return <TextFieldElement node={node} resolved={resolved} box={box} multiline={false} />;
    }
    case "textarea":
      return <TextFieldElement node={node} resolved={resolved} box={box} multiline />;
    case "select":
      return <SelectElement node={node} box={box} />;
    case "svg":
      return <SvgElement node={node} resolved={resolved} box={box} />;
    case "video":
      return (
        <View ref={ref} style={[{ width: "100%", aspectRatio: 16 / 9 }, box]}>
          <Video
            src={
              node.getAttribute("src") ??
              node.querySelector("source")?.getAttribute("src") ??
              undefined
            }
            poster={node.getAttribute("poster") ?? undefined}
            controls={node.hasAttribute("controls")}
            autoplay={node.hasAttribute("autoplay")}
            muted={node.hasAttribute("muted")}
            loop={node.hasAttribute("loop")}
            style={{ flex: 1 }}
          />
        </View>
      );
    case "iframe":
      return <FrameElement node={node} box={box} />;
    case "progress":
    case "meter": {
      const max = Number(node.getAttribute("max") ?? 1) || 1;
      const value = Number(node.getAttribute("value") ?? 0);
      return (
        <View
          ref={ref}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max, now: value }}
          style={[
            {
              width: 160,
              height: 8,
              borderRadius: 4,
              overflow: "hidden",
              backgroundColor: "rgba(128, 128, 128, 0.3)",
            },
            box,
          ]}
        >
          <View
            style={{
              width: `${Math.max(0, Math.min(1, value / max)) * 100}%`,
              height: "100%",
              backgroundColor: (ctx.variable(ACCENT) as string | undefined) ?? "#5865f2",
            }}
          />
        </View>
      );
    }
  }

  const display = resolved.style.display;
  const flex =
    display === "flex" || display === "inline-flex" || display === "grid" || tag === "tr";
  if (flex) {
    box.flexDirection ??= "row";
    if (display === "grid") box.flexWrap ??= "wrap";
  }
  if (tag === "td" || tag === "th") {
    box.flexGrow ??= 1;
    box.flexBasis ??= 0;
  }
  let childInherited = resolved.inherited;
  if (tag === "button" && !flex) {
    // A button centres its content.
    box.alignItems ??= "center";
    box.justifyContent ??= "center";
    childInherited = { ...childInherited, text: { textAlign: "center", ...childInherited.text } };
  }
  const lines =
    resolved.style.lineClamp ?? (resolved.inherited.whiteSpace === "nowrap" ? 1 : undefined);

  let children: ReactNode[];
  if (tag === "details") {
    const open = node.hasAttribute("open");
    const summary = node.querySelector(":scope > summary");
    children = renderFlow(node, childInherited, "block", lines).filter(
      (child) =>
        open ||
        (summary !== null && (child as { key?: unknown } | null)?.key === String(keyOf(summary))),
    );
  } else {
    children = renderFlow(node, childInherited, flex ? "flex" : "block", lines);
  }
  if (tag === "summary") {
    const open = node.parentElement?.hasAttribute("open") ?? false;
    box.flexDirection ??= "row";
    box.alignItems ??= "center";
    children.unshift(
      <Text key="marker" style={{ ...childInherited.text, marginRight: 4 }}>
        {open ? "▾" : "▸"}
      </Text>,
    );
  }

  const a11y = accessibilityProps(node);
  const role = accessibilityRoleOf(node);
  const pointerEvents =
    resolved.style.pointerEvents === "none" || resolved.style.hidden ? "none" : undefined;

  if (resolved.style.scroll) {
    // The box (size, border, background) outside; its content (padding, gaps, layout) inside.
    const inner: ViewStyle = {};
    const outer: ViewStyle = {};
    for (const [key, value] of Object.entries(box) as [keyof ViewStyle, unknown][]) {
      if (
        /^(padding|rowGap|columnGap|gap|flexDirection|flexWrap|justifyContent|alignItems|alignContent)/.test(
          key,
        )
      )
        (inner as Record<string, unknown>)[key] = value;
      else (outer as Record<string, unknown>)[key] = value;
    }
    return (
      <ScrollView
        ref={ref}
        style={outer}
        contentContainerStyle={inner}
        horizontal={resolved.style.scroll === "x"}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        pointerEvents={pointerEvents}
        {...a11y}
      >
        {children}
      </ScrollView>
    );
  }
  if (isInteractive(node))
    return (
      <Pressable
        ref={ref}
        style={({ pressed }) => [box, pressed && { opacity: (box.opacity ?? 1) * 0.6 }]}
        onPress={() => press(node, ctx)}
        disabled={tag === "button" && isDisabled(node)}
        accessibilityRole={role}
        pointerEvents={pointerEvents}
        {...a11y}
      >
        {children}
      </Pressable>
    );
  return (
    <View ref={ref} style={box} accessibilityRole={role} pointerEvents={pointerEvents} {...a11y}>
      {children}
    </View>
  );
}

function numberAttribute(element: Element, name: string): number | undefined {
  const raw = element.getAttribute(name);
  if (raw === null) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

function ImageElement({
  node,
  resolved,
  box,
  hostRef,
}: {
  node: Element;
  resolved: Resolved;
  box: ViewStyle;
  hostRef: (host: unknown) => void;
}): ReactNode {
  const ctx = useDom();
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const src = node.getAttribute("src");
  const uri = src?.startsWith("mxc://") ? (ctx.resolveMxc?.(src) ?? null) : src;
  const width = box.width ?? numberAttribute(node, "width");
  const height = box.height ?? numberAttribute(node, "height");
  const ratio = natural && natural.height > 0 ? natural.width / natural.height : undefined;
  const size: ViewStyle = {
    width: width ?? (typeof height === "number" && ratio ? height * ratio : (natural?.width ?? 1)),
    height: height ?? (typeof width === "number" && ratio ? width / ratio : (natural?.height ?? 1)),
  };
  const alt = node.getAttribute("alt") ?? undefined;
  const image = (
    <Image
      ref={hostRef as never}
      source={uri ? mediaSource(uri) : undefined}
      style={[{ maxWidth: "100%" }, box, size] as StyleProp<ImageStyle>}
      contentFit={
        resolved.style.objectFit === "scale-down"
          ? "scale-down"
          : (resolved.style.objectFit ?? "fill")
      }
      accessible={!!alt}
      accessibilityLabel={alt}
      onLoad={(event) => {
        const { width: w, height: h } = event.source;
        if (w > 0 && h > 0 && (natural?.width !== w || natural?.height !== h))
          setNatural({ width: w, height: h });
        fire(node, "load");
      }}
      onError={() => fire(node, "error")}
    />
  );
  return isInteractive(node) ? (
    <Pressable onPress={() => press(node, ctx)}>{image}</Pressable>
  ) : (
    image
  );
}

const KEYBOARD: Readonly<Record<string, KeyboardTypeOptions>> = {
  number: "numeric",
  email: "email-address",
  url: "url",
  tel: "phone-pad",
  search: "web-search",
};

function TextFieldElement({
  node,
  resolved,
  box,
  multiline,
}: {
  node: Element;
  resolved: Resolved;
  box: ViewStyle;
  multiline: boolean;
}): ReactNode {
  const ctx = useDom();
  const input = useRef<Focusable | null>(null);
  const ours = useRef(false);
  const valueAtFocus = useRef("");
  const field = node as unknown as { value: string };
  const value = String(field.value ?? "");
  const type = (node.getAttribute("type") ?? "text").toLowerCase();

  // `el.focus()` / `el.blur()` in the plugin's code move the keyboard.
  useEffect(() => {
    const onFocus = () => {
      if (!ours.current) input.current?.focus();
    };
    const onBlur = () => {
      if (!ours.current) input.current?.blur();
    };
    node.addEventListener("focus", onFocus);
    node.addEventListener("blur", onBlur);
    return () => {
      node.removeEventListener("focus", onFocus);
      node.removeEventListener("blur", onBlur);
    };
  }, [node]);

  const ownFire = (type: string, init: Parameters<typeof fire>[2] = {}) => {
    ours.current = true;
    try {
      return fire(node, type, init);
    } finally {
      ours.current = false;
    }
  };
  const rows = numberAttribute(node, "rows") ?? 2;
  const lineHeight =
    (resolved.inherited.text.lineHeight as number | undefined) ??
    resolved.inherited.fontSize * 1.25;
  const autocapitalize = node.getAttribute("autocapitalize")?.toLowerCase();
  const autocorrect = node.getAttribute("autocorrect")?.toLowerCase();
  const spellcheck = node.getAttribute("spellcheck");
  const { textAlign, ...text } = resolved.inherited.text;
  return (
    <TextInput
      ref={(view) => {
        input.current = view;
        if (view) ctx.inputs.set(node, view);
        bindHost(node, view);
      }}
      value={value}
      placeholder={node.getAttribute("placeholder") ?? undefined}
      placeholderTextColor={halfOpacity(resolved.inherited.color)}
      editable={!isDisabled(node) && !node.hasAttribute("readonly")}
      multiline={multiline}
      secureTextEntry={type === "password"}
      keyboardType={KEYBOARD[type]}
      inputMode={type === "number" ? "decimal" : undefined}
      maxLength={numberAttribute(node, "maxlength")}
      autoCapitalize={
        autocapitalize === "off" || autocapitalize === "none"
          ? "none"
          : autocapitalize === "words" || autocapitalize === "characters"
            ? autocapitalize
            : type === "email" || type === "url" || type === "password"
              ? "none"
              : "sentences"
      }
      autoCorrect={autocorrect === "off" || spellcheck === "false" ? false : undefined}
      submitBehavior={multiline ? "newline" : "submit"}
      accessibilityLabel={
        node.getAttribute("aria-label") ?? node.getAttribute("placeholder") ?? undefined
      }
      style={[
        text,
        { textAlign: textAlign === "justify" ? "left" : textAlign, minWidth: 40, padding: 0 },
        multiline ? { minHeight: rows * lineHeight, textAlignVertical: "top" } : null,
        box,
      ]}
      onFocus={() => {
        valueAtFocus.current = String(field.value ?? "");
        ownFire("focus", { kind: "focus" });
        ownFire("focusin", { kind: "focus", bubbles: true });
      }}
      onBlur={() => {
        ownFire("blur", { kind: "focus" });
        ownFire("focusout", { kind: "focus", bubbles: true });
        if (String(field.value ?? "") !== valueAtFocus.current)
          fire(node, "change", { bubbles: true });
        ctx.refresh();
      }}
      onChangeText={(next) => {
        field.value = next;
        fire(node, "input", { kind: "input", bubbles: true, inputType: "insertText", data: null });
        ctx.refresh();
      }}
      onKeyPress={({ nativeEvent }) => {
        // Enter in a single-line field arrives as a submit, below.
        if (nativeEvent.key === "Enter" && !multiline) return;
        const key = nativeEvent.key === "Backspace" ? "Backspace" : nativeEvent.key;
        fire(node, "keydown", {
          kind: "keyboard",
          key,
          code: key,
          bubbles: true,
          cancelable: true,
        });
        fire(node, "keyup", { kind: "keyboard", key, code: key, bubbles: true, cancelable: true });
      }}
      onSubmitEditing={() => {
        const allowed = fire(node, "keydown", {
          kind: "keyboard",
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        });
        fire(node, "keyup", {
          kind: "keyboard",
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        });
        // Implicit submission: Enter in a form's field submits it.
        const form = node.closest("form");
        if (allowed && form) submit(form, null);
        ctx.refresh();
      }}
    />
  );
}

function CheckableElement({
  node,
  type,
  box,
}: {
  node: Element;
  type: "checkbox" | "radio";
  box: ViewStyle;
}): ReactNode {
  const ctx = useDom();
  const checked = isChecked(node);
  const disabled = isDisabled(node);
  const label = node.getAttribute("aria-label") ?? undefined;
  // The controls' default box is the browser's (Uniwind compiles only class names it
  // saw at build time, so the size can't follow the text's).
  return (
    <View ref={(host) => bindHost(node, host)} style={box}>
      {type === "checkbox" ? (
        <Checkbox
          checked={checked}
          onChange={() => toggleCheckable(node, ctx)}
          disabled={disabled}
          accessibilityLabel={label}
          className="items-center"
        />
      ) : (
        <Radio
          value="on"
          group={checked ? "on" : "off"}
          onChange={() => toggleCheckable(node, ctx)}
          disabled={disabled}
          accessibilityLabel={label}
          className="items-center"
        />
      )}
    </View>
  );
}

function RangeElement({ node, box }: { node: Element; box: ViewStyle }): ReactNode {
  const ctx = useDom();
  const min = numberAttribute(node, "min") ?? 0;
  const max = numberAttribute(node, "max") ?? 100;
  const step = numberAttribute(node, "step") ?? 1;
  const field = node as unknown as { value: string };
  const raw = Number.parseFloat(String(field.value ?? ""));
  const value = Number.isFinite(raw) ? raw : (min + max) / 2;
  return (
    <View ref={(host) => bindHost(node, host)} style={[{ minWidth: 120 }, box]}>
      <Range
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={isDisabled(node)}
        accessibilityLabel={node.getAttribute("aria-label") ?? undefined}
        onChange={(next) => {
          field.value = String(next);
          fire(node, "input", { kind: "input", bubbles: true });
          ctx.refresh();
        }}
        onChangeEnd={() => {
          fire(node, "change", { bubbles: true });
          ctx.refresh();
        }}
      />
    </View>
  );
}

function SelectElement({ node, box }: { node: Element; box: ViewStyle }): ReactNode {
  const ctx = useDom();
  const options = [...node.querySelectorAll("option")].map((option, i) => ({
    value: option.getAttribute("value") ?? option.textContent ?? "",
    label: option.getAttribute("label") ?? (option.textContent ?? "").trim(),
    key: String(i),
  }));
  const selected = (node as unknown as { value?: unknown }).value;
  const value = typeof selected === "string" ? selected : (options[0]?.value ?? "");
  return (
    <View ref={(host) => bindHost(node, host)} style={[{ minWidth: 120 }, box]}>
      <Select
        value={value}
        options={options}
        disabled={isDisabled(node)}
        accessibilityLabel={node.getAttribute("aria-label") ?? undefined}
        onChange={(next) => {
          (node as unknown as { value: string }).value = next;
          fire(node, "input", { kind: "input", bubbles: true });
          fire(node, "change", { bubbles: true });
          ctx.refresh();
        }}
      />
    </View>
  );
}

function FrameElement({ node, box }: { node: Element; box: ViewStyle }): ReactNode {
  const src = node.getAttribute("src");
  const srcdoc = node.getAttribute("srcdoc");
  const dimension = (name: "width" | "height", fallback: number) => {
    const raw = node.getAttribute(name);
    if (raw?.endsWith("%")) return raw as `${number}%`;
    return numberAttribute(node, name) ?? fallback;
  };
  if (!src && srcdoc === null) return null;
  return (
    <View
      ref={(host) => bindHost(node, host)}
      style={[
        {
          width: dimension("width", 300),
          height: dimension("height", 150),
          maxWidth: "100%",
          overflow: "hidden",
        },
        box,
      ]}
    >
      <WebView
        source={srcdoc !== null ? { html: srcdoc } : { uri: src! }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        originWhitelist={["*"]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const SVG_ATTRIBUTES: Readonly<Record<string, string>> = {
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "stroke-opacity": "strokeOpacity",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
};
const SVG_COMPONENTS: Readonly<Record<string, unknown>> = {
  path: Path,
  circle: Circle,
  rect: Rect,
  line: Line,
  polyline: Polyline,
  polygon: Polygon,
  ellipse: Ellipse,
  g: G,
};

function svgProps(element: Element, color: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const { name, value } of element.attributes) {
    if (name === "class" || name === "style" || name.startsWith("aria-") || name === "xmlns")
      continue;
    const key = SVG_ATTRIBUTES[name] ?? name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    props[key] = value.toLowerCase() === "currentcolor" ? color : value;
  }
  return props;
}

function svgChildren(element: Element, color: string): ReactNode[] {
  return [...element.children].flatMap((child) => {
    const Component = SVG_COMPONENTS[child.localName] as
      | ((props: Record<string, unknown>) => ReactNode)
      | undefined;
    if (!Component) return [];
    return [
      <Component key={keyOf(child)} {...svgProps(child, color)}>
        {child.localName === "g" ? svgChildren(child, color) : undefined}
      </Component>,
    ];
  });
}

function SvgElement({
  node,
  resolved,
  box,
}: {
  node: Element;
  resolved: Resolved;
  box: ViewStyle;
}): ReactNode {
  const ctx = useDom();
  const color = resolved.inherited.color ?? "black";
  const width = box.width ?? numberAttribute(node, "width") ?? 24;
  const height = box.height ?? numberAttribute(node, "height") ?? 24;
  const { viewBox, fill, stroke, strokeWidth, strokeLinecap, strokeLinejoin } = svgProps(
    node,
    color,
  );
  const svg = (
    <View
      ref={(host) => bindHost(node, host)}
      style={[box, { width, height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={
          (viewBox as string | undefined) ??
          `0 0 ${typeof width === "number" ? width : 24} ${typeof height === "number" ? height : 24}`
        }
        fill={(fill as string | undefined) ?? "black"}
        stroke={stroke as string | undefined}
        strokeWidth={strokeWidth as string | undefined}
        strokeLinecap={strokeLinecap as "round" | undefined}
        strokeLinejoin={strokeLinejoin as "round" | undefined}
        color={color}
      >
        {svgChildren(node, color)}
      </Svg>
    </View>
  );
  return isInteractive(node) ? <Pressable onPress={() => press(node, ctx)}>{svg}</Pressable> : svg;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface DomViewProps {
  /** The element to show: its own style and classes apply to the outer box. */
  node: Element;
  /** Classes for the text, inherited as CSS inherits them: color, size, weight. */
  textClassName?: string;
  /** Classes for the box around the element. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** A link was pressed (and its click not cancelled). Defaults to opening it. */
  onLinkPress?: (href: string) => void;
  /** Turns an `mxc://` image source into a loadable URL. */
  resolveMxc?: (mxc: string) => string | null;
}

/** Calls `callback` when anything in `node`'s subtree changes. */
function observe(node: Element, callback: () => void): () => void {
  const Observer = mutationObserverOf(node.ownerDocument);
  if (!Observer) return () => {};
  const observer = new Observer(callback);
  observer.observe(node, { childList: true, subtree: true, attributes: true, characterData: true });
  return () => observer.disconnect();
}

/** The `--x` names the subtree's inline styles read, and the accent (progress bars). */
function subtreeVariables(node: Element): string[] {
  const names = new Set<string>([ACCENT]);
  for (const name of variableNames(node.getAttribute("style"))) names.add(name);
  for (const element of node.querySelectorAll("[style]"))
    for (const name of variableNames(element.getAttribute("style"))) names.add(name);
  return [...names].sort();
}

/**
 * Shows a DOM element and its subtree as React Native views. Block and inline elements,
 * text, images, SVG, controls (buttons, links, text fields, checkboxes, radios, ranges,
 * selects, `<details>`) and frames, styled by a practical subset of their inline styles
 * and their (Uniwind) classes. A press is a `click` on the element (or the nearest one
 * that listens for it), and edits are `input`/`change` events, with `submit` for forms.
 * It re-renders when the subtree changes.
 */
export function DomView({
  node,
  textClassName = DEFAULT_TEXT_CLASS,
  className,
  style,
  onLinkPress,
  resolveMxc,
}: DomViewProps): ReactNode {
  const [version, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => observe(node, refresh), [node]);
  const viewport = useWindowDimensions();
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `version` re-reads the subtree
  const names = useMemo(() => subtreeVariables(node), [node, version]);
  const values = useCSSVariable(names) as (string | number | undefined)[];
  const base = useResolveClassNames(textClassName) as TextStyle;
  const inputs = useRef(new WeakMap<Element, Focusable>()).current;
  const latestLinkPress = useRef(onLinkPress);
  latestLinkPress.current = onLinkPress;

  const variables = new Map(names.map((name, i) => [name, values[i]]));
  const ctx: DomContextValue = {
    root: node,
    variable: (name) => variables.get(name),
    viewport: { width: viewport.width, height: viewport.height },
    refresh,
    onLinkPress: (href) => (latestLinkPress.current ?? openLink)(href),
    resolveMxc,
    inputs,
  };
  const fontSize = typeof base.fontSize === "number" ? base.fontSize : ROOT_FONT_SIZE;
  const inherited: Inherited = {
    text: { ...base, fontSize },
    fontSize,
    color: typeof base.color === "string" ? base.color : undefined,
    whiteSpace: "normal",
  };
  return (
    <DomContext.Provider value={ctx}>
      <View className={className} style={style}>
        <DomElement node={node} inherited={inherited} />
      </View>
    </DomContext.Provider>
  );
}

export interface DomMountProps extends Omit<DomViewProps, "node"> {
  /** The document the element is made in (Zam's `document`). */
  document: Pick<Document, "createElement">;
  /** Builds the content into the element, as Zam's `use:` actions do; returns what
   *  undoes it. It runs once per mount: give the DomMount a `key` to run it again. */
  mount: (element: HTMLElement) => void | (() => void);
}

/**
 * A `<div>` that `mount` builds into (a plugin's `render(el)`), shown with DomView. The
 * element is in the document's body while mounted, as a mounted element is in a browser.
 */
export function DomMount({ document, mount, ...props }: DomMountProps): ReactNode {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const latestMount = useRef(mount);
  latestMount.current = mount;
  useEffect(() => {
    const element = document.createElement("div");
    element.ownerDocument?.body?.appendChild(element);
    let cleanup: void | (() => void);
    try {
      cleanup = latestMount.current(element);
    } catch (error) {
      console.error("[DomMount] mount threw", error);
    }
    setHost(element);
    return () => {
      try {
        cleanup?.();
      } catch (error) {
        console.error("[DomMount] cleanup threw", error);
      }
      element.remove();
    };
  }, [document]);
  return host ? <DomView node={host} {...props} /> : null;
}
