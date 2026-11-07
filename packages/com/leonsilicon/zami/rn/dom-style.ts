// CSS for DomView: an element's inline `style` as React Native styles. A practical
// subset: the box (sizes, margins, padding, borders, radii, background, opacity,
// shadows, transforms, position), flexbox (and grid, as wrapping rows), text (color,
// font, line height, alignment, decoration, transform, white-space, ellipsis), and
// `var(--x)` from Zam's theme, `calc()`/`min()`/`max()`/`clamp()` over px, em, rem, vw
// and vh, and CSS Color 4's space-separated rgb()/hsl().
import type { TextStyle, ViewStyle } from "react-native";

export interface StyleContext {
  /** A CSS custom property's value (`--discord-divider`), or undefined. */
  variable: (name: string) => string | number | undefined;
  /** The parent's font size in px, for `em` and `%` font sizes. */
  parentFontSize: number;
  /** The root font size in px, for `rem`. */
  rootFontSize: number;
  viewport: { width: number; height: number };
  /** The inherited text color, for `currentColor`. */
  color?: string;
}

export type Display =
  | "none"
  | "block"
  | "inline"
  | "inline-block"
  | "flex"
  | "inline-flex"
  | "grid"
  | "contents"
  | "list-item"
  | "table"
  | "table-row"
  | "table-cell";

export type WhiteSpace = "normal" | "nowrap" | "pre" | "pre-wrap" | "pre-line";

/** An element's computed style, as React Native needs it. */
export interface ElementStyle {
  /** `display`, if the style sets it (the tag's default applies otherwise). */
  display?: Display;
  /** The element's own box. */
  box: ViewStyle;
  /** Text properties the element sets, which its descendants inherit. */
  text: TextStyle;
  /** The element's font size in px (its own or the parent's). */
  fontSize: number;
  whiteSpace?: WhiteSpace;
  /** `text-overflow: ellipsis` (with `white-space: nowrap`, one line). */
  ellipsis?: boolean;
  /** `-webkit-line-clamp` / `line-clamp`. */
  lineClamp?: number;
  /** `overflow` scrolls (`auto`/`scroll`) along this axis. */
  scroll?: "x" | "y";
  hidden?: boolean;
  pointerEvents?: "none" | "auto";
  objectFit?: "contain" | "cover" | "fill" | "none" | "scale-down";
  /** The style gives the element a box of its own (padding, border, size, a radius),
   *  which an inline element can't draw inside a line of text. */
  hasBox: boolean;
}

const DEFAULT_ROOT_FONT_SIZE = 16;

/** `a: b; c: d !important` → [["a", "b"], ["c", "d"]], later ones winning. */
export function parseDeclarations(cssText: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!cssText) return out;
  // Split on `;` outside parentheses and quotes (`url(data:…;base64,…)`).
  let depth = 0;
  let quote = "";
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < cssText.length; i++) {
    const ch = cssText[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      parts.push(cssText.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(cssText.slice(start));
  for (const part of parts) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim();
    const value = part
      .slice(colon + 1)
      .replace(/!\s*important\s*$/i, "")
      .trim();
    if (!name || !value) continue;
    out.set(name.startsWith("--") ? name : name.toLowerCase(), value);
  }
  return out;
}

/** The `--x` names a style's `var()`s read. */
export function variableNames(cssText: string | null | undefined): string[] {
  return cssText ? [...cssText.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]!) : [];
}

/** Index of the `)` closing the `(` at `open`. */
function closing(value: string, open: number): number {
  let depth = 0;
  for (let i = open; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")" && --depth === 0) return i;
  }
  return value.length;
}

/** Splits a function's arguments on top-level commas. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "(") depth++;
    else if (args[i] === ")") depth--;
    else if (args[i] === "," && depth === 0) {
      out.push(args.slice(start, i));
      start = i + 1;
    }
  }
  out.push(args.slice(start));
  return out.map((arg) => arg.trim());
}

/** Replaces `var(--x, fallback)` with the variable's value (or the fallback). */
export function substituteVariables(
  value: string,
  variable: StyleContext["variable"],
  seen: ReadonlySet<string> = new Set(),
): string {
  let out = "";
  let at = 0;
  for (;;) {
    const index = value.indexOf("var(", at);
    if (index < 0) break;
    const end = closing(value, index + 3);
    const [name = "", ...rest] = splitArgs(value.slice(index + 4, end));
    let resolved: string | undefined;
    if (!seen.has(name)) {
      const raw = variable(name);
      if (raw !== undefined && raw !== "")
        resolved = substituteVariables(String(raw), variable, new Set([...seen, name]));
    }
    if (resolved === undefined && rest.length > 0)
      resolved = substituteVariables(rest.join(","), variable, seen);
    out += value.slice(at, index) + (resolved ?? "");
    at = end + 1;
  }
  return out + value.slice(at);
}

type LengthContext = Pick<StyleContext, "rootFontSize" | "viewport"> & { fontSize: number };

/** A length in px from a number and unit, or undefined (unknown units, `%`). */
function unitToPx(n: number, unit: string, ctx: LengthContext): number | undefined {
  switch (unit.toLowerCase()) {
    case "":
    case "px":
      return n;
    case "rem":
      return n * ctx.rootFontSize;
    case "em":
      return n * ctx.fontSize;
    case "vw":
      return (n * ctx.viewport.width) / 100;
    case "vh":
    case "dvh":
    case "svh":
    case "lvh":
      return (n * ctx.viewport.height) / 100;
    case "vmin":
      return (n * Math.min(ctx.viewport.width, ctx.viewport.height)) / 100;
    case "vmax":
      return (n * Math.max(ctx.viewport.width, ctx.viewport.height)) / 100;
    case "pt":
      return (n * 4) / 3;
    case "ch":
      return n * ctx.fontSize * 0.5;
    case "ex":
      return n * ctx.fontSize * 0.5;
    default:
      return undefined;
  }
}

/** Evaluates `calc()`-style arithmetic over lengths; undefined if it can't (a `%`). */
function evaluateMath(expression: string, ctx: LengthContext): number | undefined {
  // Numbers with units, operators, parentheses, commas and function names (`min(`).
  const tokens = expression.match(/(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?[a-z%]*|[-+*/(),]|[a-z-]+\(/gi);
  if (!tokens) return undefined;
  let i = 0;
  const peek = () => tokens[i];
  const primary = (): number | undefined => {
    const token = tokens[i++];
    if (token === undefined) return undefined;
    if (token === "(" || /^calc\($/i.test(token)) {
      const value = sum();
      if (tokens[i] === ")") i++;
      return value;
    }
    const fn = /^(min|max|clamp)\($/i.exec(token);
    if (fn) {
      const values: (number | undefined)[] = [];
      for (;;) {
        values.push(sum());
        if (tokens[i] === ",") i++;
        else break;
      }
      if (tokens[i] === ")") i++;
      const known = values.filter((v): v is number => v !== undefined);
      if (known.length === 0) return undefined;
      const name = fn[1]!.toLowerCase();
      if (name === "min") return Math.min(...known);
      if (name === "max") return Math.max(...known);
      // clamp(min, preferred, max) with an unknown preferred: the max bound.
      const [lo, mid, hi] = values;
      if (lo !== undefined && mid !== undefined && hi !== undefined)
        return Math.min(Math.max(mid, lo), hi);
      return hi ?? mid ?? lo;
    }
    if (token === "-") {
      const value = primary();
      return value === undefined ? undefined : -value;
    }
    const m = /^((?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)([a-z%]*)$/i.exec(token);
    if (!m) return undefined;
    if (m[2] === "%") return undefined;
    return unitToPx(Number(m[1]), m[2]!, ctx);
  };
  const product = (): number | undefined => {
    let value = primary();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[i++];
      const right = primary();
      if (value === undefined || right === undefined) value = undefined;
      else value = op === "*" ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number | undefined => {
    let value = product();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[i++];
      const right = product();
      if (value === undefined || right === undefined) value = undefined;
      else value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  const value = sum();
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/** A CSS length as React Native takes it: px, a percentage string, or "auto". */
export function parseLength(
  raw: string | undefined,
  ctx: LengthContext,
  { allowAuto = true }: { allowAuto?: boolean } = {},
): number | `${number}%` | "auto" | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "auto") return allowAuto ? "auto" : undefined;
  if (value === "0") return 0;
  const percent = /^(-?(?:\d+\.?\d*|\.\d+))%$/.exec(value);
  if (percent) return `${Number(percent[1])}%`;
  const plain = /^(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)([a-z]*)$/.exec(value);
  if (plain) return unitToPx(Number(plain[1]), plain[2]!, ctx);
  if (/^(calc|min|max|clamp)\(/.test(value)) {
    const px = evaluateMath(value, ctx);
    if (px !== undefined) return px;
    // `min(100%, 32rem)`-style caps whose only unknown is a percentage of the parent.
    const only = /^calc\(\s*(-?(?:\d+\.?\d*|\.\d+))%\s*\)$/.exec(value);
    if (only) return `${Number(only[1])}%`;
  }
  return undefined;
}

function px(raw: string | undefined, ctx: LengthContext): number | undefined {
  const value = parseLength(raw, ctx, { allowAuto: false });
  return typeof value === "number" ? value : undefined;
}

/** Splits a value on top-level whitespace (`1px solid rgb(0 0 0)` → three). */
function words(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value.trim()) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = "";
    } else current += ch;
  }
  if (current) out.push(current);
  return out;
}

const COLOR_KEYWORDS = new Set([
  "transparent",
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "gray",
  "grey",
  "pink",
  "brown",
  "cyan",
  "magenta",
  "lime",
  "navy",
  "teal",
  "olive",
  "maroon",
  "silver",
  "gold",
  "indigo",
  "violet",
  "crimson",
  "coral",
  "salmon",
  "tomato",
  "orchid",
  "plum",
  "tan",
  "khaki",
  "beige",
  "ivory",
  "lavender",
  "turquoise",
  "aqua",
  "fuchsia",
  "darkgray",
  "darkgrey",
  "lightgray",
  "lightgrey",
  "dimgray",
  "dimgrey",
  "whitesmoke",
  "gainsboro",
]);

/** A CSS color as React Native parses it, or undefined. */
export function parseColor(raw: string | undefined, currentColor?: string): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (lower === "currentcolor") return currentColor;
  if (lower === "inherit" || lower === "initial" || lower === "unset") return undefined;
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return value;
  if (COLOR_KEYWORDS.has(lower)) return lower;
  const fn = /^(rgba?|hsla?)\((.*)\)$/i.exec(value);
  if (!fn) return undefined;
  const parts = fn[2]!
    .split(/[\s,/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return undefined;
  const alphaRaw = parts[3];
  const alpha =
    alphaRaw === undefined
      ? 1
      : alphaRaw.endsWith("%")
        ? Number.parseFloat(alphaRaw) / 100
        : Number.parseFloat(alphaRaw);
  if (Number.isNaN(alpha)) return undefined;
  if (fn[1]!.toLowerCase().startsWith("rgb")) {
    const channels = parts
      .slice(0, 3)
      .map((part) =>
        part.endsWith("%") ? (Number.parseFloat(part) * 255) / 100 : Number.parseFloat(part),
      );
    if (channels.some(Number.isNaN)) return undefined;
    return `rgba(${channels.map((c) => Math.round(Math.min(255, Math.max(0, c)))).join(", ")}, ${alpha})`;
  }
  const hue = Number.parseFloat(parts[0]!);
  const saturation = Number.parseFloat(parts[1]!);
  const lightness = Number.parseFloat(parts[2]!);
  if ([hue, saturation, lightness].some(Number.isNaN)) return undefined;
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

/** Colors inside a value (a shadow) rewritten for React Native. */
function normalizeColorsIn(value: string, currentColor?: string): string {
  return value
    .replace(/(rgba?|hsla?)\([^()]*\)/gi, (match) => parseColor(match, currentColor) ?? match)
    .replace(/currentcolor/gi, currentColor ?? "black");
}

/** 1–4 box values (`margin: 0 auto`) → top, right, bottom, left. */
function fourSides<T>(values: T[]): [T, T, T, T] | undefined {
  const [a, b = a, c = a, d = b] = values;
  if (a === undefined) return undefined;
  return [a, b as T, c as T, d as T];
}

const SIDES = ["Top", "Right", "Bottom", "Left"] as const;
type Side = (typeof SIDES)[number];

const JUSTIFY: Readonly<Record<string, ViewStyle["justifyContent"]>> = {
  "flex-start": "flex-start",
  start: "flex-start",
  left: "flex-start",
  normal: "flex-start",
  "flex-end": "flex-end",
  end: "flex-end",
  right: "flex-end",
  center: "center",
  "space-between": "space-between",
  "space-around": "space-around",
  "space-evenly": "space-evenly",
};
const ALIGN: Readonly<Record<string, ViewStyle["alignItems"]>> = {
  "flex-start": "flex-start",
  start: "flex-start",
  "self-start": "flex-start",
  "flex-end": "flex-end",
  end: "flex-end",
  "self-end": "flex-end",
  center: "center",
  stretch: "stretch",
  normal: "stretch",
  baseline: "baseline",
  "first baseline": "baseline",
};
const FONT_SIZE_KEYWORDS: Readonly<Record<string, number>> = {
  "xx-small": 9,
  "x-small": 10,
  small: 13,
  medium: 16,
  large: 18,
  "x-large": 24,
  "xx-large": 32,
};
const MONO_FAMILY = /mono|menlo|courier|consolas|monaco/i;

function fontWeight(value: string): TextStyle["fontWeight"] | undefined {
  const lower = value.toLowerCase();
  if (lower === "normal") return "normal";
  if (lower === "bold" || lower === "bolder") return "bold";
  if (lower === "lighter") return "300";
  if (/^[1-9]00$/.test(lower)) return lower as TextStyle["fontWeight"];
  const n = Number(lower);
  if (Number.isFinite(n) && n >= 1 && n <= 1000)
    return String(
      Math.min(900, Math.max(100, Math.round(n / 100) * 100)),
    ) as TextStyle["fontWeight"];
  return undefined;
}

/**
 * Computes an element's style from its declarations. `monospace` is the platform's
 * monospaced family, for `font-family: monospace` and the like.
 */
export function computeStyle(
  declarations: ReadonlyMap<string, string>,
  ctx: StyleContext,
  monospace = "monospace",
): ElementStyle {
  // Built up property by property (React Native's style types are read-only).
  const box: Record<string, unknown> = {};
  const text: Record<string, unknown> = {};
  const result: ElementStyle = {
    box: box as ViewStyle,
    text: text as TextStyle,
    fontSize: ctx.parentFontSize,
    hasBox: false,
  };
  const get = (name: string) => {
    const raw = declarations.get(name);
    if (raw === undefined) return undefined;
    const value = raw.includes("var(") ? substituteVariables(raw, ctx.variable).trim() : raw;
    return value === "" || /^(inherit|initial|unset|revert)$/i.test(value) ? undefined : value;
  };

  // The font size first: `em` lengths below are the element's own.
  const fontShorthand = get("font");
  let fontSizeRaw = get("font-size");
  if (fontSizeRaw === undefined && fontShorthand) {
    const size = words(fontShorthand).find((word) => /^[\d.]+(?:px|r?em|%|pt)(?:\/|$)/.test(word));
    if (size) fontSizeRaw = size.split("/")[0];
  }
  if (fontSizeRaw !== undefined) {
    const lower = fontSizeRaw.toLowerCase();
    const parent = ctx.parentFontSize;
    const size =
      FONT_SIZE_KEYWORDS[lower] ??
      (lower === "smaller"
        ? parent / 1.2
        : lower === "larger"
          ? parent * 1.2
          : lower.endsWith("%")
            ? (Number.parseFloat(lower) * parent) / 100
            : px(lower, { ...ctx, fontSize: parent }));
    if (size !== undefined && size > 0) {
      result.fontSize = size;
      text.fontSize = size;
    }
  }
  const lengthCtx: LengthContext = { ...ctx, fontSize: result.fontSize };
  const length = (raw: string | undefined) => parseLength(raw, lengthCtx);

  for (const name of declarations.keys()) {
    const value = get(name);
    if (value === undefined) continue;
    const lower = value.toLowerCase();
    switch (name) {
      // Text (inherited).
      case "color": {
        const color = parseColor(value, ctx.color);
        if (color) text.color = color;
        break;
      }
      case "font-weight": {
        const weight = fontWeight(value);
        if (weight) text.fontWeight = weight;
        break;
      }
      case "font-style":
        if (lower === "italic" || lower === "oblique") text.fontStyle = "italic";
        else if (lower === "normal") text.fontStyle = "normal";
        break;
      case "font-family":
        if (MONO_FAMILY.test(value)) text.fontFamily = monospace;
        break;
      case "font":
        for (const word of words(value)) {
          const weight = /^(bold|bolder|lighter|[1-9]00)$/i.test(word)
            ? fontWeight(word)
            : undefined;
          if (weight) text.fontWeight = weight;
          else if (/^(italic|oblique)$/i.test(word)) text.fontStyle = "italic";
          else if (MONO_FAMILY.test(word)) text.fontFamily = monospace;
        }
        break;
      case "line-height": {
        if (lower === "normal") break;
        const unitless = /^(\d+\.?\d*|\.\d+)$/.exec(lower);
        const height = unitless
          ? Number(unitless[1]) * result.fontSize
          : lower.endsWith("%")
            ? (Number.parseFloat(lower) * result.fontSize) / 100
            : px(lower, lengthCtx);
        if (height !== undefined) text.lineHeight = height;
        break;
      }
      case "letter-spacing": {
        const spacing = lower === "normal" ? 0 : px(lower, lengthCtx);
        if (spacing !== undefined) text.letterSpacing = spacing;
        break;
      }
      case "text-align":
        text.textAlign =
          lower === "start"
            ? "left"
            : lower === "end"
              ? "right"
              : (lower as TextStyle["textAlign"]);
        if (!["left", "right", "center", "justify"].includes(String(text.textAlign)))
          delete text.textAlign;
        break;
      case "text-transform":
        if (["uppercase", "lowercase", "capitalize", "none"].includes(lower))
          text.textTransform = lower as TextStyle["textTransform"];
        break;
      case "text-decoration":
      case "text-decoration-line": {
        const underline = lower.includes("underline");
        const through = lower.includes("line-through");
        text.textDecorationLine =
          underline && through
            ? "underline line-through"
            : underline
              ? "underline"
              : through
                ? "line-through"
                : "none";
        break;
      }
      case "white-space":
        if (["normal", "nowrap", "pre", "pre-wrap", "pre-line"].includes(lower))
          result.whiteSpace = lower as WhiteSpace;
        else if (lower === "break-spaces") result.whiteSpace = "pre-wrap";
        break;
      case "text-overflow":
        result.ellipsis = lower === "ellipsis";
        break;
      case "-webkit-line-clamp":
      case "line-clamp": {
        const n = Number.parseInt(lower, 10);
        if (n > 0) result.lineClamp = n;
        break;
      }

      // Display and flexbox.
      case "display": {
        const display = lower.split(/\s+/).join("-");
        const known: Record<string, Display> = {
          none: "none",
          block: "block",
          "flow-root": "block",
          inline: "inline",
          "inline-block": "inline-block",
          flex: "flex",
          "block-flex": "flex",
          "inline-flex": "inline-flex",
          grid: "grid",
          "inline-grid": "grid",
          contents: "contents",
          "list-item": "list-item",
          table: "table",
          "inline-table": "table",
          "table-row": "table-row",
          "table-cell": "table-cell",
          "table-row-group": "table",
          "table-header-group": "table",
          "table-footer-group": "table",
        };
        if (known[display]) result.display = known[display];
        break;
      }
      case "flex-direction":
        if (["row", "column", "row-reverse", "column-reverse"].includes(lower))
          box.flexDirection = lower as ViewStyle["flexDirection"];
        break;
      case "flex-wrap":
        if (["wrap", "nowrap", "wrap-reverse"].includes(lower))
          box.flexWrap = lower as ViewStyle["flexWrap"];
        break;
      case "flex-flow":
        for (const word of words(lower)) {
          if (["row", "column", "row-reverse", "column-reverse"].includes(word))
            box.flexDirection = word as ViewStyle["flexDirection"];
          else if (["wrap", "nowrap", "wrap-reverse"].includes(word))
            box.flexWrap = word as ViewStyle["flexWrap"];
        }
        break;
      case "flex": {
        const parts = words(lower);
        if (lower === "none") {
          box.flexGrow = 0;
          box.flexShrink = 0;
          box.flexBasis = "auto";
        } else if (lower === "auto") {
          box.flexGrow = 1;
          box.flexShrink = 1;
          box.flexBasis = "auto";
        } else {
          const [grow, second, third] = parts;
          const growN = Number(grow);
          if (Number.isFinite(growN)) {
            box.flexGrow = growN;
            const shrinkN = Number(second);
            const shrinkGiven = second !== undefined && Number.isFinite(shrinkN);
            box.flexShrink = shrinkGiven ? shrinkN : 1;
            const basis = shrinkGiven ? third : second;
            box.flexBasis = basis === undefined ? 0 : (length(basis) ?? 0);
          } else {
            const basis = length(grow);
            if (basis !== undefined) {
              box.flexGrow = 1;
              box.flexShrink = 1;
              box.flexBasis = basis;
            }
          }
        }
        break;
      }
      case "flex-grow":
      case "flex-shrink": {
        const n = Number(lower);
        if (Number.isFinite(n)) box[name === "flex-grow" ? "flexGrow" : "flexShrink"] = n;
        break;
      }
      case "flex-basis": {
        const basis = lower === "content" ? "auto" : length(lower);
        if (basis !== undefined) box.flexBasis = basis;
        break;
      }
      case "align-items":
      case "align-self":
      case "align-content": {
        const align =
          ALIGN[lower] ?? (lower === "auto" && name === "align-self" ? "auto" : undefined);
        const key =
          name === "align-items"
            ? "alignItems"
            : name === "align-self"
              ? "alignSelf"
              : "alignContent";
        if (align) box[key] = name === "align-content" ? (JUSTIFY[lower] ?? align) : align;
        break;
      }
      case "justify-content": {
        const justify = JUSTIFY[lower];
        if (justify) box.justifyContent = justify;
        break;
      }
      case "place-items": {
        const align = ALIGN[words(lower)[0] ?? ""];
        if (align) box.alignItems = align;
        break;
      }
      case "gap":
      case "grid-gap": {
        const [row, column = row] = words(lower).map((word) => px(word, lengthCtx));
        if (row !== undefined) box.rowGap = row;
        if (column !== undefined) box.columnGap = column;
        break;
      }
      case "row-gap":
      case "column-gap": {
        const gap = px(lower, lengthCtx);
        if (gap !== undefined) box[name === "row-gap" ? "rowGap" : "columnGap"] = gap;
        break;
      }

      // Size.
      case "width":
      case "height":
      case "min-width":
      case "min-height":
      case "max-width":
      case "max-height": {
        if ((name.startsWith("max") && lower === "none") || lower === "fit-content") break;
        const size = length(lower);
        const key = name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
        if (size !== undefined && !(size === "auto" && name.startsWith("m"))) {
          box[key] = size;
          if (name === "width" || name === "height") result.hasBox = true;
        }
        break;
      }
      case "aspect-ratio": {
        const [w, h = "1"] = lower.split("/").map((part) => part.trim());
        const ratio = Number(w) / Number(h);
        if (Number.isFinite(ratio) && ratio > 0) box.aspectRatio = ratio;
        break;
      }

      // Margins and padding.
      case "margin":
      case "padding": {
        const sides = fourSides(words(lower).map((word) => length(word)));
        if (!sides) break;
        sides.forEach((size, i) => {
          if (size !== undefined && !(size === "auto" && name === "padding"))
            box[`${name}${SIDES[i]}`] = size;
        });
        if (name === "padding") result.hasBox = true;
        break;
      }
      case "margin-inline":
      case "margin-block":
      case "padding-inline":
      case "padding-block": {
        const [first, second = first] = words(lower).map((word) => length(word));
        const [prop, axis] = name.split("-") as [string, string];
        const [a, b] =
          axis === "inline" ? (["Left", "Right"] as const) : (["Top", "Bottom"] as const);
        if (first !== undefined) box[`${prop}${a}`] = first;
        if (second !== undefined) box[`${prop}${b}`] = second;
        if (prop === "padding") result.hasBox = true;
        break;
      }

      // Borders.
      case "border":
      case "border-top":
      case "border-right":
      case "border-bottom":
      case "border-left": {
        const side = name === "border" ? "" : name.slice(7, 8).toUpperCase() + name.slice(8);
        let width: number | undefined;
        let color: string | undefined;
        let style: string | undefined;
        for (const word of words(value)) {
          const asColor = parseColor(word, ctx.color);
          if (asColor) color = asColor;
          else if (/^(none|hidden)$/i.test(word)) style = "none";
          else if (/^(solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(word))
            style = word.toLowerCase();
          else if (/^(thin|medium|thick)$/i.test(word))
            width = { thin: 1, medium: 3, thick: 5 }[word.toLowerCase()];
          else width = px(word, lengthCtx) ?? width;
        }
        if (style === "none") width = 0;
        else if (width === undefined) width = style ? 3 : 0;
        if (style && style !== "none")
          box.borderStyle = style === "dashed" || style === "dotted" ? style : "solid";
        box[`border${side}Width`] = width;
        if (color) box[`border${side}Color`] = color;
        result.hasBox = true;
        break;
      }
      case "border-width":
      case "border-color": {
        const sides = fourSides(words(value));
        if (!sides) break;
        const kind = name === "border-width" ? "Width" : "Color";
        sides.forEach((word, i) => {
          const parsed = kind === "Width" ? px(word, lengthCtx) : parseColor(word, ctx.color);
          if (parsed !== undefined) box[`border${SIDES[i]}${kind}`] = parsed;
        });
        result.hasBox = true;
        break;
      }
      case "border-style":
        if (/^(dashed|dotted)$/.test(lower)) box.borderStyle = lower as "dashed" | "dotted";
        else if (lower === "none") box.borderWidth = 0;
        break;
      case "border-top-width":
      case "border-right-width":
      case "border-bottom-width":
      case "border-left-width":
      case "border-top-color":
      case "border-right-color":
      case "border-bottom-color":
      case "border-left-color": {
        const [, sideName, kind] = name.split("-") as [string, string, string];
        const side = (sideName[0]!.toUpperCase() + sideName.slice(1)) as Side;
        const parsed = kind === "width" ? px(lower, lengthCtx) : parseColor(value, ctx.color);
        if (parsed !== undefined)
          box[`border${side}${kind === "width" ? "Width" : "Color"}`] = parsed;
        result.hasBox = true;
        break;
      }
      case "border-radius": {
        const corners = fourSides(
          words(value.split("/")[0]!).map((word) =>
            parseLength(word, lengthCtx, { allowAuto: false }),
          ),
        );
        if (!corners) break;
        const keys = [
          "borderTopLeftRadius",
          "borderTopRightRadius",
          "borderBottomRightRadius",
          "borderBottomLeftRadius",
        ];
        corners.forEach((radius, i) => {
          if (radius !== undefined) box[keys[i]!] = radius;
        });
        result.hasBox = true;
        break;
      }
      case "border-top-left-radius":
      case "border-top-right-radius":
      case "border-bottom-right-radius":
      case "border-bottom-left-radius": {
        const radius = parseLength(words(value)[0], lengthCtx, { allowAuto: false });
        if (radius !== undefined)
          box[name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = radius;
        result.hasBox = true;
        break;
      }

      // Paint.
      case "background":
      case "background-color": {
        if (lower === "none") {
          box.backgroundColor = "transparent";
          break;
        }
        const color =
          parseColor(value, ctx.color) ??
          (name === "background"
            ? words(value)
                .map((word) => parseColor(word, ctx.color))
                .find((c) => c !== undefined)
            : undefined);
        if (color) box.backgroundColor = color;
        break;
      }
      case "opacity": {
        const opacity = lower.endsWith("%") ? Number.parseFloat(lower) / 100 : Number(lower);
        if (Number.isFinite(opacity)) box.opacity = Math.min(1, Math.max(0, opacity));
        break;
      }
      case "box-shadow":
        box.boxShadow = lower === "none" ? "none" : normalizeColorsIn(value, ctx.color);
        break;
      case "transform":
        if (lower !== "none") box.transform = value;
        break;
      case "visibility":
        if (lower === "hidden" || lower === "collapse") result.hidden = true;
        break;
      case "pointer-events":
        if (lower === "none" || lower === "auto") result.pointerEvents = lower;
        break;
      case "object-fit":
        if (["contain", "cover", "fill", "none", "scale-down"].includes(lower))
          result.objectFit = lower as ElementStyle["objectFit"];
        break;

      // Position and overflow.
      case "position":
        if (lower === "absolute" || lower === "fixed") box.position = "absolute";
        else if (lower === "relative" || lower === "static" || lower === "sticky")
          box.position = "relative";
        break;
      case "top":
      case "right":
      case "bottom":
      case "left": {
        const offset = length(lower);
        if (offset !== undefined && offset !== "auto") box[name] = offset;
        break;
      }
      case "inset": {
        const sides = fourSides(words(lower).map((word) => length(word)));
        sides?.forEach((offset, i) => {
          if (offset !== undefined && offset !== "auto") box[SIDES[i]!.toLowerCase()] = offset;
        });
        break;
      }
      case "z-index": {
        const z = Number.parseInt(lower, 10);
        if (Number.isFinite(z)) box.zIndex = z;
        break;
      }
      case "overflow":
      case "overflow-x":
      case "overflow-y": {
        const [first, second = first] = words(lower);
        const axisValue = name === "overflow-x" ? first : name === "overflow-y" ? first : second;
        if (axisValue === "auto" || axisValue === "scroll")
          result.scroll = name === "overflow-x" ? "x" : "y";
        if (lower.includes("hidden") || lower.includes("clip") || result.scroll)
          box.overflow = "hidden";
        break;
      }
    }
  }
  if (box.position === "absolute" && box.zIndex === undefined) box.zIndex = 1;
  if (result.whiteSpace === "nowrap" && result.ellipsis) result.lineClamp = 1;
  return result;
}

export { DEFAULT_ROOT_FONT_SIZE };
