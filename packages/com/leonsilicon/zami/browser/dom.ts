// A detached DOM (linkedom) for Zam's string-level HTML work: twemoji, code highlighting,
// reply fallbacks and the like build a `<template>`, set its innerHTML, walk and rewrite
// it, and read the HTML back. Nothing in it is ever displayed.
//
// The document comes from linkedom's DOMParser, not `parseHTML`: that builds a `window`
// proxying `globalThis`, which Hermes rejects (a proxy can't return anything but a
// non-configurable global's own value). Nothing here touches the document's
// `defaultView`, which would build it lazily.
import {
  DOMParser,
  DocumentFragment,
  Element,
  HTMLAnchorElement,
  HTMLElement,
  HTMLImageElement,
  HTMLTemplateElement,
  Node,
  Text,
} from "linkedom";

export const domDocument = new DOMParser().parseFromString(
  "<!doctype html><html><head></head><body></body></html>",
  "text/html",
) as unknown as Document;

/** `NodeFilter`'s constants, which linkedom's tree walker takes but doesn't define. */
export const NodeFilter = {
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3,
  SHOW_ALL: 0xffffffff,
  SHOW_ELEMENT: 0x1,
  SHOW_ATTRIBUTE: 0x2,
  SHOW_TEXT: 0x4,
  SHOW_CDATA_SECTION: 0x8,
  SHOW_PROCESSING_INSTRUCTION: 0x40,
  SHOW_COMMENT: 0x80,
  SHOW_DOCUMENT: 0x100,
  SHOW_DOCUMENT_TYPE: 0x200,
  SHOW_DOCUMENT_FRAGMENT: 0x400,
} as const;

/** `XMLSerializer`, which linkedom lacks: a node's markup. */
export class XMLSerializer {
  serializeToString(node: Node): string {
    return (node as Element).outerHTML ?? node.textContent ?? "";
  }
}

/** The DOM classes Zam's code names (Metro points them here in Zam's tree). */
export const DOM_CLASSES: Record<string, unknown> = {
  DOMParser,
  XMLSerializer,
  NodeFilter,
  Node,
  Element,
  HTMLElement,
  HTMLAnchorElement,
  HTMLImageElement,
  HTMLTemplateElement,
  Text,
  DocumentFragment,
};
