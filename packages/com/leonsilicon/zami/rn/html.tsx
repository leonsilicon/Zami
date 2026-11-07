import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type TextStyle,
} from "react-native";
import { useCSSVariable, useResolveClassNames } from "uniwind";
import {
  flattenLayout,
  layoutHtml,
  listStart,
  parseHtml,
  readClassName,
  type HtmlBlock,
  type HtmlClassName,
  type HtmlElement,
  type HtmlLayout,
  type HtmlNode,
} from "#html-tree";
import { Image, mediaSource } from "#image";

export interface HtmlProps {
  /** Matrix `org.matrix.custom.html` (or Zam's own generated HTML), as Zam passes to `{@html}`. */
  html: string;
  /** Classes for the text: color, size, weight. They apply to every run of text inside. */
  className?: string;
  /** Turns an `mxc://` URI (an `<img>` in the HTML) into a loadable URL; null drops it. */
  resolveMxc?: (mxc: string) => string | null;
  /** A link was pressed. Defaults to opening it with the system. */
  onLinkPress?: (href: string) => void;
  /** Lines to clamp to, like `line-clamp-*`. */
  numberOfLines?: number;
}

// Zam's look for message content: `.message-body` in src/app.zami.css and the
// `:global(.message-body …)` styles in MessageItem.svelte, over Tailwind's preflight
// (which zeroes every margin and padding). Sizes are px at Uniwind's 16px rem; colors
// come from Zam's theme through Uniwind, so they follow the theme.

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
// `.message-body`'s 0.875rem, which is React Native's default too.
const DEFAULT_FONT_SIZE = 14;
const LINK_CLASS = "text-discord-accent";
const MARGIN: Readonly<Record<string, number>> = {
  blockquote: 4,
  h1: 4,
  h2: 4,
  h3: 4,
  ul: 4,
  ol: 4,
  pre: 5.6,
};
const HEADING_SIZE: Readonly<Record<string, number>> = { h1: 24, h2: 20, h3: 16.8 };
// `.emoji-only .twemoji` draws emoji 36px high; here emoji are text.
const EMOJI_ONLY: TextStyle = { fontSize: 30, lineHeight: 40 };
// The themes' values, for a variable Uniwind doesn't have.
const SPOILER = { cover: "#1e1f22", uncovered: "rgba(255, 255, 255, 0.1)" };
const SYNTAX_KINDS = ["keyword", "string", "number", "title", "comment", "variable"] as const;
type SyntaxKind = (typeof SYNTAX_KINDS)[number];
type SyntaxColors = Readonly<Record<SyntaxKind, string>>;
const SYNTAX_FALLBACK: SyntaxColors = {
  keyword: "#ff7ab2",
  string: "#a8cc8c",
  number: "#d2a8ff",
  title: "#82aaff",
  comment: "#8b949e",
  variable: "#f8c555",
};
// highlight.js classes, in MessageItem.svelte's order (a later rule wins).
const SYNTAX_CLASSES: Readonly<Record<string, SyntaxKind>> = {
  "hljs-keyword": "keyword",
  "hljs-selector-tag": "keyword",
  "hljs-literal": "keyword",
  "hljs-string": "string",
  "hljs-attr": "string",
  "hljs-template-tag": "string",
  "hljs-number": "number",
  "hljs-symbol": "number",
  "hljs-bullet": "number",
  "hljs-title": "title",
  "hljs-function": "title",
  "hljs-section": "title",
  "hljs-comment": "comment",
  "hljs-quote": "comment",
  "hljs-variable": "variable",
  "hljs-params": "variable",
  "hljs-type": "variable",
};

const TEXT_STYLE_KEYS = [
  "color",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "opacity",
  "textAlign",
  "textDecorationColor",
  "textDecorationLine",
  "textDecorationStyle",
  "textShadowColor",
  "textShadowOffset",
  "textShadowRadius",
  "textTransform",
  "writingDirection",
] as const satisfies ReadonlyArray<keyof TextStyle>;

type Decoration = NonNullable<TextStyle["textDecorationLine"]>;
type Spacing = { marginTop: number; marginBottom: number } | undefined;

interface Context {
  /** The style of each block's `Text`: the className's, as the blocks around it change it. */
  text: TextStyle;
  fontSize: number;
  lineHeightRatio: number | undefined;
  /** Classes for links. */
  link: string;
  press: (href: string) => void;
  emojiOnly: boolean;
  /** Inside a spoiler that isn't revealed. */
  hidden: boolean;
  decoration: Decoration;
  /** Inside a code block: highlight.js's colors. */
  syntax: SyntaxColors | undefined;
}

// Only text styles: a className's layout classes would repeat on every block.
function textStyle(style: TextStyle): TextStyle {
  const text: Record<string, unknown> = {};
  for (const key of TEXT_STYLE_KEYS) {
    if (style[key] !== undefined) text[key] = style[key];
  }
  return text as TextStyle;
}

// Text decorations add up in CSS; in React Native a nested Text's replaces its parent's.
function decorate(current: Decoration, added: TextStyle["textDecorationLine"]): Decoration {
  const underline = current.includes("underline") || added?.includes("underline") === true;
  const through = current.includes("line-through") || added?.includes("line-through") === true;
  if (underline && through) return "underline line-through";
  if (underline) return "underline";
  return through ? "line-through" : "none";
}

function cssColor(value: string | number | undefined, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function rootContext(
  style: TextStyle,
  classes: HtmlClassName,
  press: (href: string) => void,
): Context {
  const text = textStyle(style);
  const fontSize = typeof text.fontSize === "number" ? text.fontSize : DEFAULT_FONT_SIZE;
  const lineHeightRatio =
    typeof text.lineHeight === "number" ? text.lineHeight / fontSize : undefined;
  if (classes.emojiOnly) Object.assign(text, EMOJI_ONLY);
  return {
    text,
    fontSize,
    lineHeightRatio,
    link: classes.link || LINK_CLASS,
    press,
    emojiOnly: classes.emojiOnly,
    hidden: false,
    decoration: decorate("none", text.textDecorationLine),
    syntax: undefined,
  };
}

function withText(context: Context, text: TextStyle): Context {
  return { ...context, text: { ...context.text, ...text } };
}

function heading(context: Context, size: number): Context {
  // `line-height` is inherited as a ratio (`leading-relaxed`'s 1.625).
  const ratio = context.lineHeightRatio;
  const text: TextStyle = {
    fontSize: size,
    fontWeight: "700",
    ...(ratio ? { lineHeight: size * ratio } : {}),
  };
  return { ...withText(context, text), fontSize: size };
}

// --- Inline content: nested `Text`s inside one `Text`, so it wraps as one paragraph. ---

function renderInlines(nodes: HtmlNode[], context: Context): ReactNode[] {
  return nodes.map((node, index) => renderInline(node, context, index));
}

function renderInline(node: HtmlNode, context: Context, key: number): ReactNode {
  if (node.type === "text") return node.text;
  switch (node.tag) {
    case "br":
      return "\n";
    case "img":
      // Twemoji's `<img alt="😀">` (its source isn't mxc:) is its emoji, which iOS
      // draws; any other image that can't load is its alt text.
      return node.attrs.src ? (
        <HtmlImage key={key} element={node} context={context} />
      ) : (
        (node.attrs.alt ?? "")
      );
    case "a":
      return <Link key={key} href={node.attrs.href} nodes={node.children} context={context} />;
    case "b":
    case "strong":
      return (
        <Text key={key} style={styles.bold}>
          {renderInlines(node.children, context)}
        </Text>
      );
    case "i":
    case "em":
      return (
        <Text key={key} style={styles.italic}>
          {renderInlines(node.children, context)}
        </Text>
      );
    case "u":
      return decorated(node, context, key, "underline");
    case "s":
    case "del":
      return decorated(node, context, key, "line-through");
    case "code":
      return (
        <Text key={key} style={styles.mono}>
          {renderInlines(node.children, context)}
        </Text>
      );
    case "sup":
    case "sub": {
      // Zami: not ported: the raised/lowered baseline; React Native text has none.
      const fontSize = context.fontSize * 0.75;
      return (
        <Text key={key} style={{ fontSize }}>
          {renderInlines(node.children, { ...context, fontSize })}
        </Text>
      );
    }
    default:
      return renderSpan(node, context, key);
  }
}

function decorated(
  node: HtmlElement,
  context: Context,
  key: number,
  line: "underline" | "line-through",
): ReactNode {
  const decoration = decorate(context.decoration, line);
  return (
    <Text key={key} style={{ textDecorationLine: decoration }}>
      {renderInlines(node.children, { ...context, decoration })}
    </Text>
  );
}

function syntaxColor(classes: string[], syntax: SyntaxColors | undefined): string | undefined {
  if (!syntax) return undefined;
  let kind: SyntaxKind | undefined;
  for (const name of classes) {
    const match = SYNTAX_CLASSES[name];
    if (match && (!kind || SYNTAX_KINDS.indexOf(match) > SYNTAX_KINDS.indexOf(kind))) kind = match;
  }
  return kind && syntax[kind];
}

// Without the keys that are unset: an undefined color would hide the inherited one.
function colors(color: string | undefined, backgroundColor: string | undefined): TextStyle {
  return { ...(color ? { color } : {}), ...(backgroundColor ? { backgroundColor } : {}) };
}

// `span` and `font`: colors, spoilers, and Zam's own room mentions and highlight.js tokens.
function renderSpan(node: HtmlElement, context: Context, key: number): ReactNode {
  const { attrs } = node;
  if (attrs["data-mx-spoiler"] !== undefined) {
    return <Spoiler key={key} element={node} context={context} />;
  }
  const classes = attrs.class?.split(" ") ?? [];
  if (classes.includes("room-mention")) {
    return <Link key={key} nodes={node.children} context={context} />;
  }
  const color = attrs["data-mx-color"] ?? attrs.color ?? syntaxColor(classes, context.syntax);
  const backgroundColor = attrs["data-mx-bg-color"];
  const italic =
    context.syntax !== undefined && classes.some((name) => SYNTAX_CLASSES[name] === "comment");
  if (!color && !backgroundColor && !italic) {
    return <Fragment key={key}>{renderInlines(node.children, context)}</Fragment>;
  }
  return (
    <Text
      key={key}
      style={[
        italic ? styles.italic : undefined,
        context.hidden ? styles.hidden : colors(color, backgroundColor),
      ]}
    >
      {renderInlines(node.children, context)}
    </Text>
  );
}

function Link({
  href,
  nodes,
  context,
}: {
  href?: string;
  nodes: HtmlNode[];
  context: Context;
}): ReactNode {
  const style = useResolveClassNames(context.link);
  const decoration = decorate(context.decoration, style.textDecorationLine);
  const inner = decoration === context.decoration ? context : { ...context, decoration };
  return (
    <Text
      accessibilityRole={href === undefined ? undefined : "link"}
      onPress={href === undefined || context.hidden ? undefined : () => context.press(href)}
      style={[
        textStyle(style),
        decoration === "none" ? undefined : { textDecorationLine: decoration },
        context.hidden ? styles.hidden : undefined,
      ]}
    >
      {renderInlines(nodes, inner)}
    </Text>
  );
}

/** `<span data-mx-spoiler>`: covered until pressed, and pressing again covers it, as in Zam. */
function Spoiler({ element, context }: { element: HtmlElement; context: Context }): ReactNode {
  const [revealed, setRevealed] = useState(false);
  const [cover, uncovered] = useCSSVariable([
    "--discord-spoiler-bg",
    "--discord-spoiler-revealed-bg",
  ]);
  const hidden = context.hidden || !revealed;
  const color = element.attrs["data-mx-color"];
  return (
    <Text
      onPress={() => setRevealed((value) => !value)}
      style={[
        {
          backgroundColor: revealed
            ? cssColor(uncovered, SPOILER.uncovered)
            : cssColor(cover, SPOILER.cover),
        },
        hidden ? styles.hidden : colors(color, undefined),
      ]}
    >
      {renderInlines(
        element.children,
        hidden === context.hidden ? context : { ...context, hidden },
      )}
    </Text>
  );
}

function dimension(value: string | undefined): number | undefined {
  const number = Number.parseFloat(value ?? "");
  return number > 0 ? number : undefined;
}

/**
 * An `<img>` with an mxc: source, inline in the text. Custom emoji (`data-mx-emoticon`) are
 * 1.25em high (36px in an emoji-only message) whatever their height attribute says, as
 * Zam's `!important` rule has it; other images take their width attribute or natural size,
 * at most the width of the screen.
 */
function HtmlImage({ element, context }: { element: HtmlElement; context: Context }): ReactNode {
  const { attrs } = element;
  const screen = useWindowDimensions();
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const width = dimension(attrs.width);
  const height = dimension(attrs.height);
  let ratio = 1;
  if (natural) ratio = natural.width / natural.height;
  else if (width && height) ratio = width / height;
  const emoticon = attrs["data-mx-emoticon"] !== undefined;
  let size: { width: number; height: number };
  if (emoticon) {
    const emojiHeight = context.emojiOnly ? 36 : Math.round(context.fontSize * 1.25);
    size = { width: emojiHeight * ratio, height: emojiHeight };
  } else {
    // `max-width: 100%`: the message column, about the screen less the avatar gutter.
    const maxWidth = Math.max(48, screen.width - 72);
    const imageWidth = Math.min(width ?? natural?.width ?? context.fontSize * 1.25, maxWidth);
    size = { width: imageWidth, height: imageWidth / ratio };
  }
  return (
    <Image
      accessibilityLabel={attrs.alt}
      contentFit="contain"
      onLoad={({ source }) => {
        if (source.width > 0 && source.height > 0 && !natural) {
          setNatural({ width: source.width, height: source.height });
        }
      }}
      source={mediaSource(attrs.src)}
      style={[
        size,
        // `vertical-align: -0.25em`.
        emoticon ? { transform: [{ translateY: size.height / 5 }] } : undefined,
        context.hidden ? styles.invisible : undefined,
      ]}
    />
  );
}

// --- Blocks: `View`s, with each run of inline content in a `Text`. ---

function marginOf(item: HtmlLayout): number {
  return item.type === "block" ? (MARGIN[item.tag] ?? 0) : 0;
}

// Vertical margins between siblings collapse, as in CSS.
function renderBlocks(items: HtmlLayout[], context: Context): ReactNode[] {
  return items.map((item, index) => {
    const margin = marginOf(item);
    const top = index === 0 ? margin : Math.max(marginOf(items[index - 1]!), margin);
    const bottom = index === items.length - 1 ? margin : 0;
    const spacing = top > 0 || bottom > 0 ? { marginTop: top, marginBottom: bottom } : undefined;
    return renderBlock(item, context, index, spacing);
  });
}

function renderBlock(item: HtmlLayout, context: Context, key: number, spacing: Spacing): ReactNode {
  if (item.type === "run") {
    return (
      <Text key={key} style={[context.text, spacing]}>
        {renderInlines(item.children, context)}
      </Text>
    );
  }
  switch (item.tag) {
    case "h1":
    case "h2":
    case "h3":
      return renderBox(item, heading(context, HEADING_SIZE[item.tag]!), key, spacing);
    case "blockquote":
      return <Blockquote key={key} block={item} context={context} spacing={spacing} />;
    case "pre":
      return <CodeBlock key={key} block={item} context={context} spacing={spacing} />;
    case "ul":
    case "ol":
      return (
        <View key={key} style={spacing}>
          {renderList(item, context)}
        </View>
      );
    case "hr":
      // Preflight's `hr`: a 1px top border in the text's color.
      return <View key={key} style={[styles.hr, { borderColor: context.text.color }, spacing]} />;
    case "table":
      return <Table key={key} block={item} context={context} spacing={spacing} />;
    case "details":
      return <Details key={key} block={item} context={context} spacing={spacing} />;
    case "th":
      return renderBox(item, withText(context, styles.th), key, spacing);
    default:
      // p, div, h4–h6 (preflight leaves them body text), li and table parts out of place.
      return renderBox(item, context, key, spacing);
  }
}

function renderBox(block: HtmlBlock, context: Context, key: number, spacing: Spacing): ReactNode {
  const [only] = block.children;
  if (block.children.length === 1 && only?.type === "run") {
    return (
      <Text key={key} style={[context.text, spacing]}>
        {renderInlines(only.children, context)}
      </Text>
    );
  }
  if (block.children.length === 0 && !spacing) return null;
  return (
    <View key={key} style={spacing}>
      {renderBlocks(block.children, context)}
    </View>
  );
}

function renderList(list: HtmlBlock, context: Context): ReactNode[] {
  let number = listStart(list);
  return list.children.map((item, index) => {
    if (item.type !== "block" || item.tag !== "li") {
      return (
        <View key={index} style={styles.listIndent}>
          {renderBlock(item, context, index, undefined)}
        </View>
      );
    }
    const marker = list.tag === "ol" ? `${number}.` : "•";
    number += 1;
    return (
      <View key={index} style={styles.row}>
        <Text style={[context.text, styles.marker]}>{marker}</Text>
        <View style={styles.fill}>{renderBlocks(item.children, context)}</View>
      </View>
    );
  });
}

interface BlockProps {
  block: HtmlBlock;
  context: Context;
  spacing: Spacing;
}

function Blockquote({ block, context, spacing }: BlockProps): ReactNode {
  const { color } = useResolveClassNames("text-discord-textSecondary");
  return (
    <View className="border-discord-divider" style={[styles.blockquote, spacing]}>
      {renderBlocks(block.children, color === undefined ? context : withText(context, { color }))}
    </View>
  );
}

/** `<pre>`: monospace, scrolling sideways. */
function CodeBlock({ block, context, spacing }: BlockProps): ReactNode {
  const colors = useCSSVariable([
    "--syntax-keyword",
    "--syntax-string",
    "--syntax-number",
    "--syntax-title",
    "--syntax-comment",
    "--syntax-variable",
  ]);
  const syntax = Object.fromEntries(
    SYNTAX_KINDS.map((kind, index) => [kind, cssColor(colors[index], SYNTAX_FALLBACK[kind])]),
  ) as SyntaxColors;
  // `.message-body pre code`: 0.8125rem, line-height 1.5.
  const code: Context = {
    ...withText(context, styles.code),
    fontSize: styles.code.fontSize,
    syntax,
  };
  return (
    <View
      className="bg-discord-backgroundTertiary border-discord-divider"
      style={[styles.pre, spacing]}
    >
      <ScrollView horizontal contentContainerStyle={styles.preContent}>
        <View>{renderBlocks(block.children, code)}</View>
      </ScrollView>
    </View>
  );
}

function tableCells(row: HtmlBlock): HtmlBlock[] {
  return row.children.filter(
    (cell): cell is HtmlBlock => cell.type === "block" && (cell.tag === "td" || cell.tag === "th"),
  );
}

/** `<table>`: rows of cells, each column as wide as its widest cell, scrolling sideways. */
function Table({ block, context, spacing }: BlockProps): ReactNode {
  const [widths, setWidths] = useState<readonly number[]>([]);
  const { rows, other } = useMemo(() => {
    const rows: HtmlBlock[][] = [];
    const other: HtmlLayout[] = [];
    for (const child of block.children) {
      if (child.type === "block" && child.tag === "tr") {
        rows.push(tableCells(child));
      } else if (child.type === "block" && (child.tag === "thead" || child.tag === "tbody")) {
        for (const row of child.children) {
          if (row.type === "block" && row.tag === "tr") rows.push(tableCells(row));
        }
      } else {
        other.push(child);
      }
    }
    return { rows, other };
  }, [block]);
  const measure = (column: number, event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setWidths((current) => {
      if (width <= (current[column] ?? 0)) return current;
      const next = [...current];
      next[column] = width;
      return next;
    });
  };
  return (
    <View style={spacing}>
      {renderBlocks(other, context)}
      <ScrollView horizontal>
        <View>
          {rows.map((cells, row) => (
            <View key={row} style={styles.row}>
              {cells.map((cell, column) => (
                <View
                  key={column}
                  onLayout={(event) => measure(column, event)}
                  style={[styles.cell, { minWidth: widths[column] }]}
                >
                  {renderBlocks(
                    cell.children,
                    cell.tag === "th" ? withText(context, styles.th) : context,
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** `<details>`: closed until its summary is pressed. */
function Details({ block, context, spacing }: BlockProps): ReactNode {
  const [open, setOpen] = useState(false);
  const summary = block.children.find(
    (child): child is HtmlBlock => child.type === "block" && child.tag === "summary",
  );
  return (
    <View style={spacing}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.row}
      >
        <Text style={context.text}>{open ? "▾ " : "▸ "}</Text>
        <View style={styles.fill}>
          {summary ? (
            renderBlocks(summary.children, context)
          ) : (
            <Text style={context.text}>Details</Text>
          )}
        </View>
      </Pressable>
      {open
        ? renderBlocks(
            block.children.filter((child) => child !== summary),
            context,
          )
        : null}
    </View>
  );
}

/**
 * Renders the HTML Zam renders with `{@html}`, as React Native text and views, keeping
 * only the Matrix spec's allowed tags and attributes (DOMPurify can't run without a DOM,
 * so its `sanitize()` returns its input unchanged here).
 *
 * The HTML is parsed once per string (and `resolveMxc`, so pass a stable function such
 * as Zam's `mxcToHttp`). Inline content renders as nested `Text`s in one `Text`; blocks
 * as `View`s. Besides text classes, `className` takes `[&_a]:…` classes for links,
 * `emoji-only`, and `whitespace-pre-wrap` to keep spaces and newlines.
 */
export function Html({
  html,
  className,
  resolveMxc,
  onLinkPress,
  numberOfLines,
}: HtmlProps): ReactNode {
  const classes = useMemo(() => readClassName(className), [className]);
  const layout = useMemo(
    () =>
      layoutHtml(parseHtml(html, { resolveMxc }), {
        preserveWhitespace: classes.preserveWhitespace,
      }),
    [html, resolveMxc, classes.preserveWhitespace],
  );
  const style = useResolveClassNames(classes.text);
  // A changing `onLinkPress` (an inline arrow) doesn't re-render the content.
  const latestOnLinkPress = useRef(onLinkPress);
  useLayoutEffect(() => {
    latestOnLinkPress.current = onLinkPress;
  }, [onLinkPress]);
  const press = useCallback((href: string) => (latestOnLinkPress.current ?? openLink)(href), []);
  const context = useMemo(() => rootContext(style, classes, press), [style, classes, press]);
  return useMemo(() => {
    if (numberOfLines) {
      return (
        <Text numberOfLines={numberOfLines} style={context.text}>
          {renderInlines(flattenLayout(layout), context)}
        </Text>
      );
    }
    const blocks = renderBlocks(layout, context);
    if (blocks.length === 0) return null;
    return blocks.length === 1 ? blocks[0] : <View>{blocks}</View>;
  }, [layout, context, numberOfLines]);
}

/** Opens a link the way Zam's root layout does for external links. */
export function openLink(href: string): void {
  // A scheme nothing on the device handles (magnet:, matrix:) rejects; there's nothing to do.
  void Linking.openURL(href).catch(() => undefined);
}

const styles = StyleSheet.create({
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  mono: { fontFamily: MONO },
  hidden: { color: "transparent" },
  invisible: { opacity: 0 },
  blockquote: { borderStartWidth: 4, paddingStart: 12 },
  pre: { borderWidth: 1, borderRadius: 6, overflow: "hidden" },
  preContent: { padding: 12 },
  code: { fontFamily: MONO, fontSize: 13, lineHeight: 19.5 },
  hr: { borderTopWidth: 1 },
  row: { flexDirection: "row" },
  fill: { flex: 1 },
  // A list's `padding-inline-start: 1.5rem`, where its markers sit.
  marker: { minWidth: 24, paddingEnd: 6, textAlign: "right" },
  listIndent: { paddingStart: 24 },
  cell: { paddingEnd: 12 },
  th: { fontWeight: "700", textAlign: "center" },
});
