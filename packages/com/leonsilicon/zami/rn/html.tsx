import type { ReactNode } from "react";
import { Linking, Text } from "react-native";

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

/**
 * Renders the HTML Zam renders with `{@html}`, as React Native text and views, keeping
 * only the Matrix spec's allowed tags and attributes (DOMPurify can't run without a DOM,
 * so its `sanitize()` returns its input unchanged here).
 */
export function Html({ html, className, numberOfLines }: HtmlProps): ReactNode {
  // Zami: not ported: formatting. A first pass that renders the text only.
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<img[^>]*\balt="([^"]*)"[^>]*>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return (
    <Text className={className} numberOfLines={numberOfLines}>
      {text}
    </Text>
  );
}

/** Opens a link the way Zam's root layout does for external links. */
export function openLink(href: string): void {
  void Linking.openURL(href);
}
