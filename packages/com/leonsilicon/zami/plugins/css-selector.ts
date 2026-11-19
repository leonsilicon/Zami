// What a stylesheet rule's selector can apply to in an app with no DOM:
//  - only the root (`:root`, `html`, `body`, `*`, `[data-theme="light"]`): its custom
//    properties are theme variables;
//  - one compound of classes (`.foo`, `.a.b`): any React Native view with those classes;
//  - anything else: only elements of the DOM plugins build (matched by `matches()`).
// A root scope in front of a selector (`:root[data-theme="light"] .foo`) is taken off and
// kept as a theme condition: the detached DOM's `<html>` carries no theme attribute, and a
// native view has no ancestors to match at all.

import { splitList } from "#css-parse";

export interface SelectorInfo {
  /** The selector to match elements with, without a leading root scope. Empty when the
   *  selector is only a root scope. */
  text: string;
  /** Comparable: ids, then classes/attributes/pseudo-classes, then tags. */
  specificity: number;
  /** The theme its root scope names; null for any (or no root scope). */
  theme: string | null;
  /** It selects the root itself. */
  root: boolean;
  /** Its classes, when it's one compound of classes and nothing else. */
  classes: string[] | null;
  /** The rightmost compound's id, classes and tag: an element lacking any of them can't
   *  match, which is cheaper to tell than running the selector. */
  key: { id?: string; classes: string[]; tag?: string };
}

interface Attribute {
  name: string;
  operator: string;
  value: string;
}

interface Compound {
  tag?: string;
  universal: boolean;
  id?: string;
  classes: string[];
  attributes: Attribute[];
  pseudoClasses: { name: string; argument?: string }[];
  pseudoElements: number;
  /** Where it starts in the selector, and the combinator before it ("" for the first). */
  start: number;
  combinator: string;
}

const HEX = /[\da-f]/i;
const NAME_CHAR = /[\w-]|[^\0-\x7f]/;

/** Reads an identifier at `at` (with CSS escapes); returns it and the index after it. */
function readName(text: string, at: number): [string, number] {
  let out = "";
  let i = at;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\") {
      let hex = "";
      let j = i + 1;
      while (j < text.length && hex.length < 6 && HEX.test(text[j]!)) hex += text[j++];
      if (hex !== "") {
        // One whitespace after a hex escape belongs to it.
        if (j < text.length && /\s/.test(text[j]!)) j++;
        const code = Number.parseInt(hex, 16);
        out += code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
        i = j;
      } else if (i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
      } else i++;
    } else if (NAME_CHAR.test(ch)) {
      out += ch;
      i++;
    } else break;
  }
  return [out, i];
}

/** The index of the bracket closing the one at `open`, or -1. */
function closing(text: string, open: number): number {
  const opener = text[open]!;
  const closer = opener === "(" ? ")" : "]";
  let depth = 0;
  let quote = "";
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === "\\") i++;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === opener) depth++;
    else if (ch === closer && --depth === 0) return i;
  }
  return -1;
}

function parseAttribute(body: string): Attribute | null {
  const match = /^\s*([^\s~|^$*=]+)\s*(?:([~|^$*]?=)\s*([\s\S]*))?$/.exec(body);
  if (!match) return null;
  const raw = (match[3] ?? "").trim();
  // Quoted, or a bare word; a case flag (`i`, `s`) may follow either.
  const quoted = /^(["'])([\s\S]*?)\1/.exec(raw);
  const value = quoted ? quoted[2]! : (raw.split(/\s/)[0] ?? "");
  return { name: match[1]!.toLowerCase(), operator: match[2] ?? "", value };
}

/** A selector's compounds, or null for one this can't read. */
function parseCompounds(selector: string): Compound[] | null {
  const compounds: Compound[] = [];
  let current: Compound | undefined;
  let combinator = "";
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i]!;
    if (/\s/.test(ch) || ch === ">" || ch === "+" || ch === "~") {
      // A run of whitespace around at most one combinator sign.
      let sign = "";
      while (i < selector.length && /[\s>+~]/.test(selector[i]!)) {
        if (!/\s/.test(selector[i]!)) {
          if (sign !== "") return null;
          sign = selector[i]!;
        }
        i++;
      }
      if (current !== undefined) combinator = sign === "" ? " " : sign;
      else if (sign !== "") return null;
      current = undefined;
      continue;
    }
    if (current === undefined) {
      current = {
        universal: false,
        classes: [],
        attributes: [],
        pseudoClasses: [],
        pseudoElements: 0,
        start: i,
        combinator,
      };
      compounds.push(current);
      combinator = "";
    }
    const compound: Compound = current;
    if (ch === "*") {
      compound.universal = true;
      i++;
    } else if (ch === "." || ch === "#") {
      const [name, next] = readName(selector, i + 1);
      if (name === "") return null;
      if (ch === ".") compound.classes.push(name);
      else compound.id = name;
      i = next;
    } else if (ch === "[") {
      const end = closing(selector, i);
      if (end < 0) return null;
      const attribute = parseAttribute(selector.slice(i + 1, end));
      if (!attribute) return null;
      compound.attributes.push(attribute);
      i = end + 1;
    } else if (ch === ":") {
      const element = selector[i + 1] === ":";
      const [name, next] = readName(selector, i + (element ? 2 : 1));
      if (name === "") return null;
      i = next;
      let argument: string | undefined;
      if (selector[i] === "(") {
        const end = closing(selector, i);
        if (end < 0) return null;
        argument = selector.slice(i + 1, end);
        i = end + 1;
      }
      const lower = name.toLowerCase();
      // CSS 2's pseudo-elements may be written with one colon.
      if (element || /^(before|after|first-line|first-letter)$/.test(lower))
        compound.pseudoElements++;
      else compound.pseudoClasses.push({ name: lower, argument });
    } else {
      // A tag: a name (which can't start with a digit) first in its compound. Anything
      // else here is unreadable.
      if (/[\d-]/.test(ch)) return null;
      const [name, next] = readName(selector, i);
      if (name === "" || next === i) return null;
      if (compound.tag !== undefined || compound.universal || compound.start !== i) return null;
      compound.tag = name.toLowerCase();
      i = next;
    }
  }
  // A selector can't end on a combinator.
  return compounds.length > 0 && combinator === "" ? compounds : null;
}

const ID = 10000;
const CLASS = 100;

function specificityOf(compounds: Compound[]): number {
  let total = 0;
  for (const compound of compounds) {
    if (compound.id !== undefined) total += ID;
    total += (compound.classes.length + compound.attributes.length) * CLASS;
    total += compound.pseudoElements + (compound.tag === undefined ? 0 : 1);
    for (const pseudo of compound.pseudoClasses) {
      if (pseudo.name === "where") continue;
      if (/^(is|not|has|matches|-webkit-any|-moz-any)$/.test(pseudo.name)) {
        // The most specific of its arguments.
        let most = 0;
        for (const argument of splitList(pseudo.argument ?? "")) {
          const inner = parseCompounds(argument);
          if (inner) most = Math.max(most, specificityOf(inner));
        }
        total += most;
      } else total += CLASS;
    }
  }
  return total;
}

/** The theme a root-scope compound names (null: any), or undefined if it isn't one. */
function rootScope(compound: Compound): string | null | undefined {
  if (compound.id !== undefined || compound.classes.length > 0 || compound.pseudoElements > 0)
    return undefined;
  if (compound.tag !== undefined && compound.tag !== "html" && compound.tag !== "body")
    return undefined;
  if (compound.pseudoClasses.some((pseudo) => pseudo.name !== "root")) return undefined;
  let theme: string | null = null;
  for (const attribute of compound.attributes) {
    if (attribute.name !== "data-theme") return undefined;
    // `[data-theme]` alone: any theme that is set, which here is any.
    if (attribute.operator === "") continue;
    if (attribute.operator !== "=") return undefined;
    theme = attribute.value;
  }
  const named =
    compound.tag !== undefined ||
    compound.universal ||
    compound.pseudoClasses.length > 0 ||
    compound.attributes.length > 0;
  return named ? theme : undefined;
}

const cache = new Map<string, SelectorInfo | null>();
const CACHE_LIMIT = 4000;

/** What `selector` (one, not a list) applies to, or null for one that can't be read. */
export function analyzeSelector(selector: string): SelectorInfo | null {
  const source = selector.trim();
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  let info: SelectorInfo | null = null;
  const compounds = parseCompounds(source);
  if (compounds) {
    const first = compounds[0]!;
    const scope = rootScope(first);
    const second = compounds[1];
    let theme: string | null = null;
    let rest = compounds;
    let text = source;
    if (scope !== undefined && second === undefined) {
      info = {
        text: "",
        specificity: specificityOf(compounds),
        theme: scope,
        root: true,
        classes: null,
        key: { classes: [] },
      };
    } else {
      // `html .x` is `.x`; `:root[data-theme="light"] > .x` can only be told apart from
      // `.x` by the theme, so that's what is kept of it.
      if (
        scope !== undefined &&
        second !== undefined &&
        (second.combinator === " " || (second.combinator === ">" && first.attributes.length > 0))
      ) {
        theme = scope;
        rest = compounds.slice(1);
        text = source.slice(second.start);
      }
      const only = rest.length === 1 ? rest[0]! : null;
      const last = rest[rest.length - 1]!;
      info = {
        text,
        specificity: specificityOf(compounds),
        theme,
        root: false,
        classes:
          only !== null &&
          only.classes.length > 0 &&
          only.tag === undefined &&
          !only.universal &&
          only.id === undefined &&
          only.attributes.length === 0 &&
          only.pseudoClasses.length === 0 &&
          only.pseudoElements === 0
            ? only.classes
            : null,
        key: { id: last.id, classes: last.classes, tag: last.tag },
      };
    }
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(source, info);
  return info;
}
