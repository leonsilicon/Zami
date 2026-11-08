// The agent in Zam's web build (the reference). `_parity` builds Zam with this module
// imported from its client hooks; it only starts inside the parity WebView, which sets
// `window.__ZAMI_PARITY__` before Zam's code runs.
import type { Driver, Dump, ParityNode, Rect, Target, WebParityConfig } from "#protocol";
import {
  byReadingOrder,
  describeTarget,
  intersect,
  normalizeText,
  pick,
  pickOnTop,
  round,
  runAgent,
  sleep,
  union,
  waitUntil,
  type Candidate,
} from "#agent";

declare global {
  interface Window {
    __ZAMI_PARITY__?: WebParityConfig;
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

const config = typeof window === "undefined" ? undefined : window.__ZAMI_PARITY__;

function viewport(): Rect {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

/** Viewport coordinates → the screen's, where the WebView sits at `config.frame`. */
function toScreen(rect: Rect): Rect {
  const frame = config?.frame ?? { x: 0, y: 0 };
  return round({ ...rect, x: rect.x + frame.x, y: rect.y + frame.y });
}

function isHidden(element: Element): boolean {
  if (
    "checkVisibility" in element &&
    !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  ) {
    return true;
  }
  let opacity = 1;
  for (let current: Element | null = element; current; current = current.parentElement) {
    opacity *= Number(getComputedStyle(current).opacity);
  }
  return opacity < 0.01;
}

/**
 * The part of `rect` (inside `element`) that `element` and its scrolling and clipping
 * ancestors leave visible, or undefined if none: a `truncate` text block cuts its own
 * glyphs off. A fixed-position element ends the walk: what contains it doesn't clip it.
 */
function visiblePart(element: Element, rect: Rect): Rect | undefined {
  let visible = intersect(rect, viewport());
  for (let current: Element | null = element; current && visible; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      visible = intersect(visible, current.getBoundingClientRect());
    }
    if (style.position === "fixed") break;
  }
  return visible;
}

function fromDomRect(rect: DOMRect): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/** The element a text node's line boxes belong to: its nearest non-inline ancestor. */
function blockOf(text: Node): Element | null {
  let element = text.parentElement;
  while (element) {
    const display = getComputedStyle(element).display;
    if (display !== "inline" && display !== "contents") return element;
    element = element.parentElement;
  }
  return null;
}

function alignOf(style: CSSStyleDeclaration): ParityNode["align"] {
  const rtl = style.direction === "rtl";
  switch (style.textAlign) {
    case "center":
    case "-webkit-center": {
      return "center";
    }
    case "right":
    case "-webkit-right": {
      return "right";
    }
    case "end": {
      return rtl ? "left" : "right";
    }
    case "start": {
      return rtl ? "right" : "left";
    }
    default: {
      return "left";
    }
  }
}

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** Zam draws emoji as Twemoji images; Zami draws them as text. Both count as text here. */
function isEmojiImage(node: Node): node is HTMLImageElement {
  return (
    node instanceof HTMLImageElement &&
    EMOJI.test(node.alt) &&
    getComputedStyle(node).display === "inline"
  );
}

function contentOf(node: Text | HTMLImageElement): string {
  return node instanceof HTMLImageElement ? node.alt : node.data;
}

function textCandidates(): Candidate<Element>[] {
  const blocks = new Map<Element, (Text | HTMLImageElement)[]>();
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const run = node instanceof Text ? node : isEmojiImage(node) ? node : undefined;
    if (!run || normalizeText(contentOf(run)) === "") continue;
    const parent = run.parentElement;
    if (!parent || parent.closest("svg, script, style, template, noscript, select")) continue;
    const block = blockOf(run);
    if (!block) continue;
    blocks.set(block, [...(blocks.get(block) ?? []), run]);
  }

  const candidates: Candidate<Element>[] = [];
  for (const [block, texts] of blocks) {
    if (isHidden(block)) continue;
    const content = normalizeText(texts.map(contentOf).join(""));
    const rects: Rect[] = [];
    for (const text of texts) {
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) rects.push(fromDomRect(rect));
      }
    }
    const glyphs = union(rects);
    const visible = glyphs && visiblePart(block, glyphs);
    if (!visible) continue;
    const first = texts.find((run) => run instanceof Text) ?? texts[0];
    const style = getComputedStyle(first?.parentElement ?? block);
    const blockStyle = getComputedStyle(block);
    const fontSize = Number.parseFloat(style.fontSize);
    const lineHeight =
      style.lineHeight === "normal" ? fontSize * 1.2 : Number.parseFloat(style.lineHeight);
    candidates.push({
      handle: block,
      node: {
        kind: "text",
        key: `text:${content}`,
        rect: toScreen(visible),
        align: alignOf(blockStyle),
        lines: Math.max(1, Math.round((glyphs?.height ?? 0) / lineHeight)),
        color: style.color,
        fontSize,
        fontWeight: Number(style.fontWeight),
      },
    });
  }
  return candidates;
}

function controlCandidates(): Candidate<Element>[] {
  const candidates: Candidate<Element>[] = [];
  for (const element of document.querySelectorAll("[aria-label], input, textarea")) {
    if (isHidden(element)) continue;
    const visible = visiblePart(element, fromDomRect(element.getBoundingClientRect()));
    if (!visible) continue;
    const label = element.getAttribute("aria-label");
    const placeholder = element.getAttribute("placeholder");
    if (label !== null && label !== "") {
      candidates.push({
        handle: element,
        node: { kind: "control", key: `label:${label}`, rect: toScreen(visible) },
      });
    } else if (placeholder !== null && placeholder !== "") {
      candidates.push({
        handle: element,
        node: { kind: "input", key: `placeholder:${placeholder}`, rect: toScreen(visible) },
      });
    }
  }
  return candidates;
}

let measuring: CanvasRenderingContext2D | null = null;

/** How wide `text` draws in `style`'s font. */
function textWidth(text: string, style: CSSStyleDeclaration): number {
  measuring ??= document.createElement("canvas").getContext("2d");
  if (!measuring) return 0;
  measuring.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return measuring.measureText(text).width;
}

/**
 * An empty text field's placeholder, which shows as text (Zami may draw it as a Text):
 * an input's or textarea's, or the composer's (an empty contenteditable whose `::before`
 * shows its `placeholder` attribute).
 */
function placeholderCandidates(): Candidate<Element>[] {
  const candidates: Candidate<Element>[] = [];
  const fields = document.querySelectorAll(
    "input[placeholder], textarea[placeholder], [contenteditable][placeholder]",
  );
  for (const element of fields) {
    const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
    const placeholder = element.getAttribute("placeholder") ?? "";
    const empty = field ? element.value === "" : (element.textContent ?? "") === "";
    if (placeholder === "" || !empty || isHidden(element)) continue;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const px = (value: string): number => Number.parseFloat(value) || 0;
    const left = px(style.paddingLeft) + px(style.borderLeftWidth);
    const top = px(style.paddingTop) + px(style.borderTopWidth);
    const inner = {
      x: box.x + left,
      y: box.y + top,
      width: box.width - left - px(style.paddingRight) - px(style.borderRightWidth),
      height: box.height - top - px(style.paddingBottom) - px(style.borderBottomWidth),
    };
    // The glyphs, as far as the field shows them.
    const glyphs = { ...inner, width: Math.min(inner.width, textWidth(placeholder, style)) };
    const visible = visiblePart(element, glyphs);
    if (!visible) continue;
    candidates.push({
      handle: element,
      node: {
        kind: "text",
        key: `text:${normalizeText(placeholder)}`,
        rect: toScreen(visible),
        align: alignOf(style),
        lines: 1,
        color: getComputedStyle(element, field ? "::placeholder" : "::before").color,
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight),
      },
    });
  }
  return candidates;
}

function candidates(): Candidate<Element>[] {
  return [...textCandidates(), ...placeholderCandidates(), ...controlCandidates()];
}

/**
 * What a recipe can target: the candidates, plus buttons Zam names only with `title`
 * (Zami gives those an accessibility label instead).
 */
function targets(): Candidate<Element>[] {
  const titled: Candidate<Element>[] = [];
  for (const element of document.querySelectorAll("[title]:not([aria-label])")) {
    const title = element.getAttribute("title");
    if (title === null || title === "" || isHidden(element)) continue;
    const visible = visiblePart(element, fromDomRect(element.getBoundingClientRect()));
    if (!visible) continue;
    titled.push({
      handle: element,
      node: { kind: "control", key: `label:${title}`, rect: toScreen(visible) },
    });
  }
  // Inline elements with text of their own (a link in a sentence), as Zami's nested texts.
  const runs: Candidate<Element>[] = [];
  for (const element of document.querySelectorAll("body *")) {
    if (getComputedStyle(element).display !== "inline") continue;
    const own = normalizeText(
      [...element.childNodes]
        .filter((node): node is Text => node instanceof Text)
        .map((node) => node.data)
        .join(""),
    );
    if (own === "" || isHidden(element)) continue;
    const visible = visiblePart(element, fromDomRect(element.getBoundingClientRect()));
    if (!visible) continue;
    runs.push({
      handle: element,
      node: { kind: "text", key: `text:${own}`, rect: toScreen(visible) },
    });
  }
  return [...candidates(), ...titled, ...runs];
}

/** The target, once it's on screen (a drawer may still be sliding in): 5 s at most. */
async function locate(target: Target): Promise<Element> {
  await waitUntil(
    () => pick(targets(), target) !== undefined,
    5000,
    `Zam to show ${describeTarget(target)}`,
  );
  const found = await pickOnTop(targets(), target, ({ handle }) => {
    // What a tap at the element's middle would reach.
    const rect = handle.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit !== null && (handle.contains(hit) || hit.contains(handle));
  });
  if (!found) throw new Error(`Zam shows no ${describeTarget(target)}`);
  return found.handle;
}

const INTERACTIVE = "button, a[href], input, textarea, select, label, [role], [tabindex]";

const driver: Driver = {
  side: "zam",
  async press(target) {
    const element = await locate(target);
    (element.closest(INTERACTIVE) ?? element).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
    );
    await sleep(50);
  },
  async longPress(target) {
    // Zam's `longPress` action (a held touch, as on a phone) listens for touch events.
    const element = await locate(target);
    const rect = element.getBoundingClientRect();
    const touch = new Touch({
      identifier: Date.now(),
      target: element,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    });
    const init = { bubbles: true, cancelable: true, composed: true };
    element.dispatchEvent(
      new TouchEvent("touchstart", {
        ...init,
        touches: [touch],
        targetTouches: [touch],
        changedTouches: [touch],
      }),
    );
    await sleep(700);
    element.dispatchEvent(new TouchEvent("touchend", { ...init, changedTouches: [touch] }));
    await sleep(50);
  },
  async fill(target, value) {
    const element = await locate(target);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      throw new Error(`Zam's ${describeTarget(target)} isn't a text field`);
    }
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(50);
  },
  async waitFor(target, timeoutMs = 10_000) {
    await waitUntil(
      () => pick(targets(), target) !== undefined,
      timeoutMs,
      `Zam to show ${describeTarget(target)}`,
    );
  },
  exists(target) {
    return pick(targets(), target) !== undefined;
  },
  sleep,
};

let lastMutation = Date.now();

async function settle(quietMs: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const busy = (): boolean =>
    Date.now() - lastMutation < quietMs ||
    document.fonts.status !== "loaded" ||
    [...document.images].some((image) => !image.complete) ||
    document
      .getAnimations()
      .some(
        (animation) =>
          animation.playState === "running" &&
          animation.effect?.getComputedTiming().iterations !== Infinity,
      );
  while (busy() && Date.now() < deadline) await sleep(50);
}

/** Elements between `element` and the nearest ancestor it shares with `other`. */
function elementsToCommonAncestor(element: Element, other: Element): number {
  let count = 0;
  for (let current = element.parentElement; current; current = current.parentElement) {
    if (current.contains(other)) return count;
    count++;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Whether a tap at the middle of `rect` (screen points) would reach `element`, or what it
 * reaches is part of the same small widget (as in native.tsx).
 */
function reachable(element: Element, rect: Rect): boolean {
  const frame = config?.frame ?? { x: 0, y: 0 };
  const hit = document.elementFromPoint(
    rect.x - frame.x + rect.width / 2,
    rect.y - frame.y + rect.height / 2,
  );
  if (hit === null) return false;
  return (
    element.contains(hit) || hit.contains(element) || elementsToCommonAncestor(element, hit) <= 2
  );
}

/** What's on screen and not covered by something else (an open page, a sheet). */
function dump(): Dump {
  const shown = candidates().filter(({ handle, node }) => reachable(handle, node.rect));
  return { nodes: byReadingOrder(shown.map((candidate) => candidate.node)) };
}

/**
 * A tap on a phone doesn't draw focus rings, but this WebView never gets a real touch, so
 * WebKit treats Zam's programmatic focus (a dialog focusing its first button) as keyboard
 * focus and draws `:focus-visible` outlines and rings a phone never shows.
 */
function hideFocusRings(): void {
  const style = document.createElement("style");
  style.textContent = `:focus-visible {
  outline: none !important;
  --tw-ring-offset-shadow: 0 0 #0000 !important;
  --tw-ring-shadow: 0 0 #0000 !important;
}`;
  document.head.append(style);
}

function start(settings: WebParityConfig): void {
  hideFocusRings();
  new MutationObserver(() => {
    lastMutation = Date.now();
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

  // The WebView paints the safe-area strips around itself in Zam's background.
  const reportBackground = (): void => {
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({ background: getComputedStyle(document.body).backgroundColor }),
    );
  };
  window.addEventListener("load", reportBackground);
  setInterval(reportBackground, 2000);

  runAgent(settings.runner, {
    side: "zam",
    window: () => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scale: window.devicePixelRatio,
    }),
    frame: () => settings.frame,
    insets: () => settings.insets,
    driver,
    dump,
    settle,
    reload: () => location.reload(),
  });
}

if (config) start(config);
