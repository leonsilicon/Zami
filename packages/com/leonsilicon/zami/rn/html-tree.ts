import { Parser } from "htmlparser2";

// The pure half of `Html`: parse HTML with htmlparser2, keep what Zam's
// `sanitizeMatrixHtml` (src/lib/utils/sanitizeHtml.zami.ts) keeps, and lay the result out
// as blocks of inline runs for React Native. DOMPurify can't run without a DOM, so on
// React Native `sanitize()` hands its input over unchanged and this module is the
// allowlist.

/** Text, with its entities decoded. */
export interface HtmlText {
  type: "text";
  text: string;
}

/** An element the allowlist keeps, with only the attributes legal on its tag. */
export interface HtmlElement {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

export type HtmlNode = HtmlText | HtmlElement;

/** Inline content (text and inline elements only) that renders as one `Text`. */
export interface HtmlRun {
  type: "run";
  children: HtmlNode[];
}

/** A block element, whose children are runs and blocks. */
export interface HtmlBlock {
  type: "block";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlLayout[];
  /** A picture's line of its own (`tag` "img"): the `<img>` itself. */
  image?: HtmlElement;
}

export type HtmlLayout = HtmlRun | HtmlBlock;

export interface ParseOptions {
  /** Turns an `mxc://` image source into a loadable URL; null (or no resolver) drops it. */
  resolveMxc?: (mxc: string) => string | null;
}

export interface LayoutOptions {
  /** Keep spaces and newlines as written (`white-space: pre-wrap`), as room topics do. */
  preserveWhitespace?: boolean;
}

// sanitizeHtml.zami.ts's ALLOWED_TAGS: the Matrix spec's tags for org.matrix.custom.html.
const ALLOWED_TAGS = new Set([
  "font",
  "del",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "p",
  "a",
  "ul",
  "ol",
  "sup",
  "sub",
  "li",
  "b",
  "i",
  "u",
  "strong",
  "em",
  "code",
  "hr",
  "br",
  "div",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "caption",
  "pre",
  "span",
  "img",
  "details",
  "summary",
]);

// Its ALLOWED_ATTR (the outer gate) narrowed by PER_TAG_ATTRS, as DOMPurify applies both:
// `rel` is legal on `a` per tag but not in ALLOWED_ATTR, so it never survives.
const PER_TAG_ATTRS: Record<string, ReadonlySet<string>> = {
  a: new Set(["href", "target", "title"]),
  img: new Set(["src", "alt", "title", "width", "height", "data-mx-emoticon"]),
  font: new Set(["color", "data-mx-color", "data-mx-bg-color"]),
  span: new Set(["data-mx-color", "data-mx-bg-color", "data-mx-spoiler", "data-mx-maths"]),
  div: new Set(["data-mx-maths"]),
  code: new Set(["class"]),
  ol: new Set(["start"]),
};

const HREF_SCHEME = /^(?:https?|ftp|mailto|magnet|matrix):/i;

// DOMPurify's SAFE_FOR_XML check: an attribute value that could close a comment or a
// raw-text element is dropped.
const UNSAFE_ATTR_VALUE = /((--!?|])>)|<\/(style|title)/i;

// Disallowed elements DOMPurify removes together with their content (its default
// FORBID_CONTENTS, plus the FORBID_TAGS sanitizeMatrixHtml adds). Every other disallowed
// element is unwrapped: its content stays. `mx-reply` is the rich-reply fallback, which
// Zam strips before sanitizing and renders from the replied-to event instead.
const DROPPED_WITH_CONTENT = new Set([
  "annotation-xml",
  "audio",
  "colgroup",
  "desc",
  "foreignobject",
  "head",
  "iframe",
  "math",
  "mi",
  "mn",
  "mo",
  "ms",
  "mtext",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "svg",
  "template",
  "title",
  "video",
  "xmp",
  "mx-reply",
]);

// Zami: classes Zam's own HTML adds after sanitizing (highlight.js tokens from
// highlightCodeBlocks, `room-mention` from highlightRoomMention). They only pick colors.
const PRESENTATION_CLASS = /^(?:hljs-[\w-]+|room-mention)$/;

const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;
// `<font color>` takes legacy values too: bare hex and color names. These are names
// React Native also knows.
const BARE_HEX_COLOR = /^(?:[\da-f]{3}|[\da-f]{6})$/i;
const NAMED_COLORS = new Set([
  "aqua",
  "black",
  "blue",
  "brown",
  "cyan",
  "fuchsia",
  "gold",
  "gray",
  "green",
  "grey",
  "indigo",
  "lime",
  "magenta",
  "maroon",
  "navy",
  "olive",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "teal",
  "violet",
  "white",
  "yellow",
]);

function color(value: string, legacy: boolean): string | undefined {
  if (HEX_COLOR.test(value)) return value;
  if (!legacy) return undefined;
  const name = value.toLowerCase();
  if (NAMED_COLORS.has(name)) return name;
  return BARE_HEX_COLOR.test(value) ? `#${value}` : undefined;
}

function allowedAttrs(
  tag: string,
  attribs: Record<string, string>,
  options: ParseOptions | undefined,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (tag === "span" && attribs.class) {
    const classes = attribs.class.split(/\s+/).filter((name) => PRESENTATION_CLASS.test(name));
    if (classes.length > 0) attrs.class = classes.join(" ");
  }
  const allowed = PER_TAG_ATTRS[tag];
  if (!allowed) return attrs;
  for (const [name, raw] of Object.entries(attribs)) {
    if (!allowed.has(name)) continue;
    // DOMPurify trims every value before checking it.
    let value: string | undefined = raw.trim();
    if (UNSAFE_ATTR_VALUE.test(value)) continue;
    if (name === "href") {
      // Spec: not relative, listed schemes only (+ matrix:).
      if (!HREF_SCHEME.test(value)) continue;
    } else if (name === "src") {
      // Spec: an image's source must be a Matrix content URI.
      if (!value.startsWith("mxc://")) continue;
      value = options?.resolveMxc?.(value) ?? undefined;
    } else if (name === "class") {
      const languages = value.split(/\s+/).filter((name) => name.startsWith("language-"));
      value = languages.length > 0 ? languages.join(" ") : undefined;
    } else if (name === "color" || name === "data-mx-color" || name === "data-mx-bg-color") {
      value = color(value, name === "color");
    }
    if (value !== undefined) attrs[name] = value;
  }
  return attrs;
}

type Frame = "keep" | "unwrap" | "drop";

/**
 * Parses HTML into the elements and attributes `sanitizeMatrixHtml` keeps. Disallowed
 * elements are unwrapped (their content stays), except scripts, styles, SVG, MathML,
 * media and `mx-reply`, which go with their content. Comments are dropped.
 */
export function parseHtml(html: string, options?: ParseOptions): HtmlNode[] {
  const root: HtmlNode[] = [];
  const containers: HtmlNode[][] = [root];
  const frames: Frame[] = [];
  let dropping = 0;
  const parser = new Parser({
    onopentag(name, attribs) {
      const tag = name.toLowerCase();
      if (dropping > 0 || DROPPED_WITH_CONTENT.has(tag)) {
        dropping++;
        frames.push("drop");
      } else if (ALLOWED_TAGS.has(tag)) {
        const element: HtmlElement = {
          type: "element",
          tag,
          attrs: allowedAttrs(tag, attribs, options),
          children: [],
        };
        containers.at(-1)!.push(element);
        containers.push(element.children);
        frames.push("keep");
      } else {
        frames.push("unwrap");
      }
    },
    onclosetag() {
      const frame = frames.pop();
      if (frame === "drop") dropping--;
      else if (frame === "keep") containers.pop();
    },
    ontext(text) {
      if (dropping > 0) return;
      const container = containers.at(-1)!;
      const last = container.at(-1);
      if (last?.type === "text") last.text += text;
      else container.push({ type: "text", text });
    },
  });
  parser.end(html);
  return root;
}

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "blockquote",
  "pre",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "caption",
  "details",
  "summary",
]);

function wrapBlock(block: HtmlBlock, inline: HtmlElement): HtmlBlock {
  return {
    ...block,
    children: block.children.map((child) =>
      child.type === "run"
        ? { type: "run", children: [{ ...inline, children: child.children }] }
        : wrapBlock(child, inline),
    ),
  };
}

/**
 * A picture rather than an emote or a Twemoji emoji: it gets a line of its own. iOS
 * doesn't make room in a line for a view taller than the text, so a picture inside
 * a paragraph would draw over its text.
 */
export function isPictureImage(node: HtmlElement): boolean {
  return (
    node.tag === "img" &&
    !!node.attrs.src &&
    node.attrs["data-mx-emoticon"] === undefined &&
    !/(^|\s)(name-)?twemoji(\s|$)/.test(node.attrs.class ?? "")
  );
}

// Blocks stay blocks; an inline element holding blocks is split around them, its
// formatting carried into each block's runs (CSS's block-in-inline).
function split(nodes: HtmlNode[]): Array<HtmlNode | HtmlBlock> {
  const out: Array<HtmlNode | HtmlBlock> = [];
  for (const node of nodes) {
    if (node.type === "text") {
      out.push(node);
    } else if (isPictureImage(node)) {
      out.push({ type: "block", tag: "img", attrs: node.attrs, children: [], image: node });
    } else if (BLOCK_TAGS.has(node.tag)) {
      out.push({
        type: "block",
        tag: node.tag,
        attrs: node.attrs,
        children: group(split(node.children)),
      });
    } else {
      const parts = split(node.children);
      let inline: HtmlNode[] = [];
      for (const part of parts) {
        if (part.type !== "block") {
          inline.push(part);
          continue;
        }
        if (inline.length > 0) out.push({ ...node, children: inline });
        inline = [];
        out.push(wrapBlock(part, node));
      }
      if (inline.length > 0 || parts.length === 0) out.push({ ...node, children: inline });
    }
  }
  return out;
}

function group(items: Array<HtmlNode | HtmlBlock>): HtmlLayout[] {
  const out: HtmlLayout[] = [];
  for (const item of items) {
    if (item.type === "block") {
      out.push(item);
      continue;
    }
    const last = out.at(-1);
    if (last?.type === "run") last.children.push(item);
    else out.push({ type: "run", children: [item] });
  }
  return out;
}

interface Collapse {
  lineStart: boolean;
  space: boolean;
  last: HtmlText | undefined;
}

// `white-space: normal`: runs of spaces, tabs and newlines become one space, and spaces
// at the start or end of a line go.
function collapse(nodes: HtmlNode[], state: Collapse): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      let text = node.text.replaceAll(/[\t\n\f\r ]+/g, " ");
      if ((state.lineStart || state.space) && text.startsWith(" ")) text = text.slice(1);
      if (text === "") continue;
      const copy: HtmlText = { type: "text", text };
      state.lineStart = false;
      state.space = text.endsWith(" ");
      state.last = copy;
      out.push(copy);
    } else if (node.tag === "br" || node.tag === "img") {
      if (node.tag === "br" && state.space && state.last) {
        state.last.text = state.last.text.slice(0, -1);
      }
      state.lineStart = node.tag === "br";
      state.space = false;
      state.last = undefined;
      out.push(node);
    } else {
      out.push({ ...node, children: collapse(node.children, state) });
    }
  }
  return out;
}

function clone(nodes: HtmlNode[]): HtmlNode[] {
  return nodes.map((node) =>
    node.type === "text" ? { ...node } : { ...node, children: clone(node.children) },
  );
}

interface Leaf {
  siblings: HtmlNode[];
  index: number;
  node: HtmlNode;
}

// The text, line breaks and images of a run, in order, skipping empty text.
function leaves(nodes: HtmlNode[], out: Leaf[] = []): Leaf[] {
  for (const [index, node] of nodes.entries()) {
    if (node.type === "text") {
      if (node.text !== "") out.push({ siblings: nodes, index, node });
    } else if (node.tag === "br" || node.tag === "img") {
      out.push({ siblings: nodes, index, node });
    } else {
      leaves(node.children, out);
    }
  }
  return out;
}

function normalizeRun(
  run: HtmlRun,
  mode: "normal" | "pre",
  first: boolean,
  inPre: boolean,
): HtmlRun | undefined {
  // Both branches copy, so the parsed tree stays as parsed.
  let children: HtmlNode[];
  if (mode === "normal") {
    const state: Collapse = { lineStart: true, space: false, last: undefined };
    children = collapse(run.children, state);
    if (state.space && state.last) state.last.text = state.last.text.slice(0, -1);
  } else {
    children = clone(run.children);
    const content = leaves(children);
    // HTML drops a newline right after `<pre>`, and the newline ending a block's last
    // line draws no empty line after it.
    const head = children[0];
    if (first && inPre && head?.type === "text" && head.text.startsWith("\n")) {
      head.text = head.text.slice(1);
    }
    const tail = content.at(-1)?.node;
    if (tail?.type === "text" && tail.text.endsWith("\n")) tail.text = tail.text.slice(0, -1);
  }
  const content = leaves(children);
  if (content.length === 0) return undefined;
  // A `<br>` ending a block draws no empty line after it either. Alone, it is one empty
  // line, which a zero-width space holds open.
  const tail = content.at(-1)!;
  if (tail.node.type === "element" && tail.node.tag === "br") {
    if (content.length === 1) tail.siblings[tail.index] = { type: "text", text: "\u200B" };
    else tail.siblings.splice(tail.index, 1);
  }
  return { type: "run", children };
}

function normalize(items: HtmlLayout[], mode: "normal" | "pre", inPre: boolean): HtmlLayout[] {
  const out: HtmlLayout[] = [];
  for (const [index, item] of items.entries()) {
    if (item.type === "run") {
      const run = normalizeRun(item, mode, index === 0, inPre);
      if (run) out.push(run);
    } else {
      const pre = item.tag === "pre";
      out.push({ ...item, children: normalize(item.children, pre ? "pre" : mode, pre) });
    }
  }
  return out;
}

/**
 * Lays parsed HTML out as React Native draws it: block elements, and runs of inline
 * content between them. Whitespace collapses as CSS's `white-space: normal` does (or is
 * kept, inside `<pre>` and with `preserveWhitespace`), and runs left empty go.
 */
export function layoutHtml(nodes: HtmlNode[], options?: LayoutOptions): HtmlLayout[] {
  return normalize(group(split(nodes)), options?.preserveWhitespace ? "pre" : "normal", false);
}

const BR: HtmlElement = { type: "element", tag: "br", attrs: {}, children: [] };

/**
 * Flattens laid-out HTML into a single run, for clamping to a number of lines: blocks
 * become lines, list items get their markers, code blocks stay monospace and a closed
 * `<details>` shows its summary.
 */
export function flattenLayout(items: HtmlLayout[]): HtmlNode[] {
  const out: HtmlNode[] = [];
  let prefix = "";
  function line(nodes: HtmlNode[]): void {
    if (out.length > 0) out.push(BR);
    if (prefix) out.push({ type: "text", text: prefix });
    prefix = "";
    out.push(...nodes);
  }
  function walk(children: HtmlLayout[], inPre: boolean): void {
    for (const child of children) {
      if (child.type === "run") {
        line(
          inPre
            ? [{ type: "element", tag: "code", attrs: {}, children: child.children }]
            : child.children,
        );
      } else if (child.tag === "ul" || child.tag === "ol") {
        let number = listStart(child);
        for (const item of child.children) {
          if (item.type === "block" && item.tag === "li") {
            prefix = child.tag === "ol" ? `${number++}. ` : "• ";
          }
          walk([item], inPre);
          prefix = "";
        }
      } else if (child.tag === "details") {
        const summary = child.children.find(
          (item) => item.type === "block" && item.tag === "summary",
        );
        if (summary) walk([summary], inPre);
      } else {
        walk(child.children, inPre || child.tag === "pre");
      }
    }
  }
  walk(items, false);
  return out;
}

/** The number an `<ol>` starts counting from. */
export function listStart(list: HtmlBlock): number {
  const start = Number.parseInt(list.attrs.start ?? "", 10);
  return Number.isNaN(start) ? 1 : start;
}

export interface HtmlClassName {
  /** The classes for the text itself. */
  text: string;
  /** Classes given for links with Tailwind's descendant variant: `[&_a]:underline`. */
  link: string;
  /** `emoji-only`: Zam's class for a message that is only emoji, which draws them large. */
  emojiOnly: boolean;
  /** `whitespace-pre*`: spaces and newlines are kept. */
  preserveWhitespace: boolean;
}

/** Splits `Html`'s `className` into what applies to text, to links, and what it means for layout. */
export function readClassName(className: string | undefined): HtmlClassName {
  const text: string[] = [];
  const link: string[] = [];
  let emojiOnly = false;
  let preserveWhitespace = false;
  for (const name of className?.split(/\s+/) ?? []) {
    if (name === "") continue;
    if (name.startsWith("[&_a]:")) link.push(name.slice("[&_a]:".length));
    else if (name === "emoji-only") emojiOnly = true;
    else if (/^whitespace-(?:pre|pre-wrap|pre-line|break-spaces)$/.test(name))
      preserveWhitespace = true;
    else text.push(name);
  }
  return { text: text.join(" "), link: link.join(" "), emojiOnly, preserveWhitespace };
}
