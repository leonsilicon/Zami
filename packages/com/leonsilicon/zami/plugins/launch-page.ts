// The launch page: the app as it last looked, kept as HTML and drawn again the moment the
// app opens, over the session restore that used to show "Restoring session…". It's a copy of
// the app's own DOM (Zam's stylesheets style it as they did the original), with what a copy
// can't keep made static: images become data: URLs, what was hidden is left out, and
// nothing in it does anything except the composer, which takes typing (launch.ts carries
// that over to the real composer).

/** A saved launch page. */
export interface LaunchPage {
  userId: string;
  /** The build that drew it: another build's classes may not style it. */
  build: string;
  /** The room it shows, and whether that was a plugin's registered home. */
  roomId: string | null;
  home: boolean;
  /** When the home it shows expires (ms since the epoch), if it does. */
  until: number | null;
  width: number;
  height: number;
  savedAt: number;
  html: string;
  /** The `<style>` elements of the page (plugins' and themes'), as text. */
  styles: string[];
  /** The stylesheets the page had loaded. */
  stylesheets: string[];
  /** `<html>`'s `data-` attributes, which plugins' styles select on. */
  rootAttributes: Record<string, string>;
}

/** The DOM of a launch page: what `captureDom` returns of a `LaunchPage`. */
export type LaunchDom = Pick<LaunchPage, "html" | "styles" | "stylesheets" | "rootAttributes">;

const REGION = "data-zam-region";
/** Zam's regions in a launch page: plugins looking for the app's own mustn't find the copy. */
export const LAUNCH_REGION = "data-zami-launch-region";
const SCROLL = "data-zami-launch-scroll";

const DROPPED = new Set(["SCRIPT", "NOSCRIPT", "IFRAME", "VIDEO", "AUDIO", "OBJECT", "EMBED"]);
/** All the images of a page, as data: URLs. */
const IMAGE_BUDGET = 1_500_000;
const MAX_HTML = 4_000_000;
const MAX_STYLES = 500_000;
const MAX_IMAGE_SIDE = 800;
/** Up to this many pixels an image is checked for transparency (and kept as PNG if it has any). */
const ALPHA_SCAN_PIXELS = 160 * 160;

interface CaptureState {
  imageBudget: number;
  images: Map<string, string | null>;
  viewport: { width: number; height: number };
}

/** A data: URL of an image as it's shown, or null if it can't be read (another origin's). */
function imageData(image: HTMLImageElement, rect: DOMRect): string | null {
  const density = Math.min(globalThis.devicePixelRatio || 1, 2);
  const natural = Math.max(image.naturalWidth, image.naturalHeight);
  const shown = Math.max(rect.width, rect.height) * density;
  const scale = Math.min(1, Math.min(MAX_IMAGE_SIDE, Math.max(shown, 16)) / natural);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, width, height);
    const webp = canvas.toDataURL("image/webp", 0.8);
    // (A browser that can't write WebP answers with a PNG.)
    if (webp.startsWith("data:image/webp")) return webp;
    if (width * height <= ALPHA_SCAN_PIXELS) {
      const pixels = context.getImageData(0, 0, width, height).data;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index]! < 250) return webp;
      }
    }
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

function copyImage(image: HTMLImageElement, copy: HTMLImageElement, state: CaptureState): void {
  copy.removeAttribute("srcset");
  copy.removeAttribute("loading");
  const source = image.currentSrc || image.src;
  if (!source) return;
  const rect = image.getBoundingClientRect();
  const blank = () => {
    // Its box stays, so nothing around it moves.
    copy.removeAttribute("src");
    copy.style.width = `${rect.width}px`;
    copy.style.height = `${rect.height}px`;
    copy.style.visibility = "hidden";
  };
  const near =
    rect.bottom > -state.viewport.height &&
    rect.top < state.viewport.height * 2 &&
    rect.right > -state.viewport.width &&
    rect.left < state.viewport.width * 2;
  if (!near) return blank();
  let data = source.startsWith("data:") ? source : state.images.get(source);
  if (data === undefined) {
    data = image.complete && image.naturalWidth > 0 ? imageData(image, rect) : null;
    state.images.set(source, data);
  }
  if (data === null) {
    // Another origin's image can't be read, but its URL may still load at launch. A blob:
    // URL dies with this page.
    if (/^https?:/.test(source)) copy.setAttribute("src", source);
    else blank();
    return;
  }
  if (data.length > state.imageBudget) return blank();
  state.imageBudget -= data.length;
  copy.setAttribute("src", data);
}

function copyElement(element: Element, state: CaptureState, inSvg: boolean): Element | null {
  if (DROPPED.has(element.tagName)) return null;
  // What isn't drawn isn't kept: a plugin may hide whole panels of the app with a style
  // that the copy's renamed regions wouldn't match.
  if (!inSvg && getComputedStyle(element).display === "none") return null;
  const copy = element.cloneNode(false) as Element;
  // (A copy of the list: it changes as attributes are removed.)
  for (const { name } of Array.from(copy.attributes)) {
    if (name.startsWith("on")) copy.removeAttribute(name);
  }
  const region = copy.getAttribute(REGION);
  if (region !== null) {
    copy.removeAttribute(REGION);
    copy.setAttribute(LAUNCH_REGION, region);
  }
  if (element instanceof HTMLElement) {
    const { scrollTop, scrollLeft, scrollHeight, clientHeight } = element;
    if (scrollTop !== 0 || scrollLeft !== 0 || region === "timeline") {
      const atEnd = scrollHeight - clientHeight - scrollTop < 8;
      copy.setAttribute(SCROLL, `${scrollTop},${scrollLeft},${atEnd ? "end" : ""}`);
    }
    if (element instanceof HTMLImageElement) {
      copyImage(element, copy as HTMLImageElement, state);
      return copy;
    }
  }
  const svg = inSvg || element.tagName.toLowerCase() === "svg";
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      copy.append(document.createTextNode(child.nodeValue ?? ""));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childCopy = copyElement(child as Element, state, svg);
      if (childCopy) copy.append(childCopy);
    }
  }
  return copy;
}

/** The app's DOM as a launch page, or null if it's too large to keep. */
export function captureDom(app: HTMLElement): LaunchDom | null {
  const state: CaptureState = {
    imageBudget: IMAGE_BUDGET,
    images: new Map(),
    viewport: { width: innerWidth, height: innerHeight },
  };
  const copy = copyElement(app, state, false);
  if (!copy) return null;
  const html = copy.outerHTML;
  if (html.length > MAX_HTML) return null;

  const styles: string[] = [];
  let styleSize = 0;
  for (const style of document.querySelectorAll("style")) {
    const css = style.textContent ?? "";
    if (!css.trim() || app.contains(style) || style.closest("[data-zami-launch]")) continue;
    styleSize += css.length;
    if (styleSize > MAX_STYLES) break;
    styles.push(css);
  }
  const stylesheets = [...loadedStylesheets()];
  const rootAttributes: Record<string, string> = {};
  for (const { name, value } of document.documentElement.attributes) {
    if (name.startsWith("data-")) rootAttributes[name] = value;
  }
  return { html, styles, stylesheets, rootAttributes };
}

/** The stylesheets the document has loaded, as paths of this origin. */
function loadedStylesheets(): Set<string> {
  const paths = new Set<string>();
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')) {
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin) paths.add(url.pathname);
  }
  return paths;
}

export interface DrawnLaunchPage {
  element: HTMLElement;
  /** The page's composer, which takes typing. */
  composer: HTMLElement | null;
  /** What the composer held when the page was drawn. */
  composerText: string;
  /** Fades the page out, then removes it (at once with `false`). */
  dismiss(fade?: boolean): void;
}

/** What a composer holds, as text. */
export function composerText(composer: HTMLElement): string {
  return composer.innerText.replace(/\n$/, "");
}

const FADE_MS = 140;

/** Draws a launch page over the whole window. */
export function drawLaunchPage(page: LaunchDom): DrawnLaunchPage {
  const element = document.createElement("div");
  element.dataset.zamiLaunch = "";
  element.setAttribute("aria-busy", "true");
  // Under the layers plugins add (api.ts), over everything of the app.
  element.style.cssText = "position:fixed;inset:0;z-index:2147482000;contain:strict;";

  const loaded = loadedStylesheets();
  for (const href of page.stylesheets) {
    if (loaded.has(href)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }
  for (const [name, value] of Object.entries(page.rootAttributes)) {
    if (!document.documentElement.hasAttribute(name)) {
      document.documentElement.setAttribute(name, value);
    }
  }
  for (const css of page.styles) {
    const style = document.createElement("style");
    style.textContent = css;
    element.append(style);
  }
  const content = document.createElement("div");
  content.innerHTML = page.html;
  element.append(...content.childNodes);

  // It's on its way: a line along the top, moving unless motion is reduced.
  const bar = document.createElement("div");
  bar.style.cssText =
    "position:absolute;top:env(safe-area-inset-top,0px);left:0;height:2px;width:40%;" +
    "border-radius:2px;background:var(--zam-accent-fill);opacity:.7;pointer-events:none;";
  element.append(bar);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches && "animate" in bar) {
    bar.animate([{ transform: "translateX(-100%)" }, { transform: "translateX(250%)" }], {
      duration: 1600,
      iterations: Infinity,
      easing: "ease-in-out",
    });
  }

  for (const image of element.querySelectorAll("img")) {
    image.addEventListener("error", () => {
      image.style.visibility = "hidden";
    });
  }

  // Nothing in the page acts: no handler came with the copy, and a link mustn't navigate.
  // Its events don't reach the app's own listeners on the document either.
  for (const type of ["click", "auxclick", "dblclick", "contextmenu", "submit"]) {
    element.addEventListener(
      type,
      (event) => {
        event.stopPropagation();
        if (!(event.target instanceof Element && event.target.closest("[contenteditable]"))) {
          event.preventDefault();
        }
      },
      true,
    );
  }
  for (const type of ["keydown", "keyup", "keypress", "beforeinput", "input", "paste"]) {
    element.addEventListener(type, (event) => {
      event.stopPropagation();
      // The message isn't sent from here: Enter is a line break until the app is up.
      if (type === "keydown" && (event as KeyboardEvent).key === "Tab") event.preventDefault();
    });
  }

  const composer = element.querySelector<HTMLElement>(
    `[${LAUNCH_REGION}="composer"] [contenteditable]`,
  );
  composer?.setAttribute("contenteditable", "true");

  document.body.append(element);
  for (const scrolled of element.querySelectorAll<HTMLElement>(`[${SCROLL}]`)) {
    const [top, left, end] = (scrolled.getAttribute(SCROLL) ?? "").split(",");
    scrolled.scrollLeft = Number(left) || 0;
    // The app opens a room at its newest message, so that's where a timeline that was
    // there is put, whatever the window's height is now.
    scrolled.scrollTop = end ? scrolled.scrollHeight : Number(top) || 0;
  }

  let dismissed = false;
  return {
    element,
    composer,
    composerText: composer ? composerText(composer) : "",
    dismiss(fade = true) {
      if (dismissed) return;
      dismissed = true;
      if (!fade) {
        element.remove();
        return;
      }
      element.style.pointerEvents = "none";
      element.style.transition = `opacity ${FADE_MS}ms ease-out`;
      element.style.opacity = "0";
      setTimeout(() => element.remove(), FADE_MS + 40);
    },
  };
}

/** Whether a saved page is the one to show for this launch. */
export function launchPageFits(
  page: LaunchPage,
  launch: {
    userId: string;
    build: string;
    width: number;
    home: { roomId: string } | null;
    now: number;
  },
): boolean {
  if (page.userId !== launch.userId || page.build !== launch.build) return false;
  if (Math.abs(page.width - launch.width) > 1) return false;
  if (page.until !== null && page.until <= launch.now) return false;
  // A registered home shows only itself; without one, the page is where the app was left,
  // unless that was a home that's gone since (the app lands elsewhere then).
  return launch.home ? page.roomId === launch.home.roomId : !page.home;
}
