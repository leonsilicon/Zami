// A stylesheet's text as rules: selectors, their declarations (normal and `!important`)
// and the `@media` conditions around them. It reads what people write for a browser
// (comments, strings, escaped class names, nested rules and at-rules) and never throws:
// what it can't read is skipped, and the rest of the sheet still applies.

export interface Declaration {
  /** Lowercased, except a custom property's (`--x`), whose case counts. */
  name: string;
  value: string;
  important: boolean;
}

export interface StyleRule {
  /** The rule's selector list, split at its commas; nested rules joined to their parents. */
  selectors: string[];
  declarations: Declaration[];
  /** The conditions of the `@media` blocks the rule is in. All of them must hold. */
  media: string[];
}

/** `css` without its comments (a comment inside a string is the string's text). */
function stripComments(css: string): string {
  if (!css.includes("/*")) return css;
  let out = "";
  let quote = "";
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote || ch === "\n") quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "\\") i++;
    else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      // A comment replaces a space (`a/**/b` is two tokens).
      out += `${css.slice(start, i)} `;
      // Unterminated: the rest of the sheet is the comment.
      if (end < 0) return out;
      i = end + 1;
      start = end + 2;
    }
  }
  return out + css.slice(start);
}

/**
 * The index of the first of `stops` at or after `from` that is outside strings,
 * parentheses, brackets and escapes, or the text's length.
 */
function scan(css: string, from: number, stops: string): number {
  let depth = 0;
  let quote = "";
  for (let i = from; i < css.length; i++) {
    const ch = css[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote || ch === "\n") quote = "";
      continue;
    }
    if (ch === "\\") i++;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && stops.includes(ch)) return i;
  }
  return css.length;
}

/** The index just past the `}` that closes the block opened before `from`. */
function skipBlock(css: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < css.length) {
    i = scan(css, i, "{}");
    if (i >= css.length) break;
    depth += css[i] === "{" ? 1 : -1;
    i++;
    if (depth === 0) break;
  }
  return i;
}

/** Splits at top-level commas. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (;;) {
    const comma = scan(text, start, ",");
    const part = text.slice(start, comma).trim();
    if (part !== "") out.push(part);
    if (comma >= text.length) break;
    start = comma + 1;
  }
  return out;
}

function parseDeclaration(text: string): Declaration | null {
  const colon = text.indexOf(":");
  if (colon < 0) return null;
  const rawName = text.slice(0, colon).trim();
  let value = text.slice(colon + 1).trim();
  const important = /!\s*important$/i.test(value);
  if (important) value = value.replace(/!\s*important$/i, "").trim();
  if (rawName === "" || value === "" || /\s/.test(rawName)) return null;
  return { name: rawName.startsWith("--") ? rawName : rawName.toLowerCase(), value, important };
}

/** A nested rule's selectors, each joined to each of its parent's. */
function nest(parents: string[] | null, children: string[]): string[] {
  if (parents === null) return children;
  const out: string[] = [];
  for (const parent of parents)
    for (const child of children)
      out.push(child.includes("&") ? child.split("&").join(parent) : `${parent} ${child}`);
  return out;
}

// At-rules whose blocks hold rules that apply as if they stood outside them.
const TRANSPARENT = new Set(["layer", "supports", "document"]);
const MAX_DEPTH = 32;

/** The rules of `css`, in order. */
export function parseStyleSheet(css: string): StyleRule[] {
  const rules: StyleRule[] = [];
  try {
    const text = stripComments(String(css));
    parseBlock(text, 0, null, [], rules, 0);
  } catch (error) {
    console.error("[zami] stylesheet: stopped at what it couldn't read", error);
  }
  return rules.filter((rule) => rule.declarations.length > 0);
}

/**
 * Reads a block's contents from `at` to its `}` (or the end of the text, at the top
 * level) and returns the index after it. In a rule's block (`selectors` set), what ends
 * in `;` is a declaration; anything followed by `{` is a rule nested in it.
 */
function parseBlock(
  css: string,
  at: number,
  selectors: string[] | null,
  media: string[],
  rules: StyleRule[],
  depth: number,
): number {
  // The block's own declarations, in one rule, placed where the block starts.
  let own: StyleRule | null = null;
  let i = at;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i]!)) i++;
    if (i >= css.length) break;
    const ch = css[i]!;
    // A `}` with no block open (the top level) is a typo: the sheet goes on after it.
    if (ch === "}" && depth > 0) return i + 1;
    if (ch === ";" || ch === "}") {
      i++;
      continue;
    }
    const end = scan(css, i, "{};");
    const prelude = css.slice(i, end).trim();
    const stop = css[end];
    if (stop !== "{") {
      // A declaration, or (at the top level, or an at-rule like `@import …;`) nothing.
      if (selectors !== null && !prelude.startsWith("@")) {
        const declaration = parseDeclaration(prelude);
        if (declaration) {
          if (own === null) rules.push((own = { selectors, declarations: [], media }));
          own.declarations.push(declaration);
        }
      }
      i = stop === ";" ? end + 1 : end;
      continue;
    }
    // A block.
    if (depth >= MAX_DEPTH) {
      i = skipBlock(css, end + 1);
      continue;
    }
    if (prelude.startsWith("@")) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
      const condition = prelude.slice(name.length + 1).trim();
      if (name === "media")
        i = parseBlock(css, end + 1, selectors, [...media, condition], rules, depth + 1);
      else if (TRANSPARENT.has(name) && !/^not\b/i.test(condition))
        i = parseBlock(css, end + 1, selectors, media, rules, depth + 1);
      // `@keyframes`, `@font-face`, `@container` and whatever comes next: not rules for
      // elements, or under a condition nothing here can evaluate.
      else i = skipBlock(css, end + 1);
      continue;
    }
    const nested = nest(selectors, splitList(prelude));
    i =
      nested.length > 0
        ? parseBlock(css, end + 1, nested, media, rules, depth + 1)
        : skipBlock(css, end + 1);
  }
  return i;
}
