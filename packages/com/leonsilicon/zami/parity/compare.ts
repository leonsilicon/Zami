// Comparing one view in the two apps: the nodes each agent measured (texts, labelled
// controls, text fields), paired by key and reading order, and the screenshots' pixels.
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { ParityNode, Rect } from "#protocol";

export type IssueKind =
  | "missing"
  | "extra"
  | "moved"
  | "resized"
  | "clipped"
  | "wraps"
  | "color"
  | "font";

export interface Issue {
  /** Stable across runs, for the baseline: kind, key and which occurrence of the key. */
  id: string;
  kind: IssueKind;
  key: string;
  message: string;
  zam?: Rect;
  zami?: Rect;
}

export interface Tolerances {
  /** Points a node may sit away from its counterpart. */
  position: number;
  /** Points a control's size may differ by. */
  size: number;
  /** Per channel, 0–255. */
  color: number;
}

export const DEFAULT_TOLERANCES: Tolerances = { position: 3, size: 3, color: 16 };

function center(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Where Zami's glyphs start, `width` wide. Zam reports the glyphs themselves, but a React
 * Native Text box can be wider than its text (stretched by its parent), and its alignment
 * says where in the box the text sits.
 */
function glyphLeft(node: ParityNode, width: number): number {
  switch (node.align) {
    case "center": {
      return node.rect.x + (node.rect.width - width) / 2;
    }
    case "right": {
      return node.rect.x + node.rect.width - width;
    }
    default: {
      return node.rect.x;
    }
  }
}

const NAMED: Record<string, [number, number, number, number]> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
};

/** `rgb()`, `rgba()`, `#rgb[a]`, `#rrggbb[aa]` or a few names, as [r, g, b, a]. */
export function parseColor(
  color: string | undefined,
): [number, number, number, number] | undefined {
  if (color === undefined) return undefined;
  const value = color.trim().toLowerCase();
  if (value in NAMED) return NAMED[value];
  const functional = /^rgba?\(([^)]+)\)$/.exec(value);
  if (functional?.[1] !== undefined) {
    const parts = functional[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    const [r = 0, g = 0, b = 0, a = 1] = parts;
    return [r, g, b, a];
  }
  const hex = /^#([\da-f]{3,8})$/.exec(value)?.[1];
  if (hex !== undefined) {
    const full = hex.length <= 4 ? hex.replaceAll(/./g, "$&$&") : hex;
    const channel = (index: number): number => Number.parseInt(full.slice(index, index + 2), 16);
    return [channel(0), channel(2), channel(4), full.length === 8 ? channel(6) / 255 : 1];
  }
  return undefined;
}

function colorsDiffer(a: string | undefined, b: string | undefined, tolerance: number): boolean {
  const left = parseColor(a);
  const right = parseColor(b);
  if (!left || !right) return false;
  return (
    left
      .slice(0, 3)
      .some((channel, index) => Math.abs(channel - (right[index] ?? 0)) > tolerance) ||
    Math.abs(left[3] - right[3]) > 0.1
  );
}

function format(rect: Rect): string {
  return `(${Math.round(rect.x)}, ${Math.round(rect.y)}) ${Math.round(rect.width)}×${Math.round(rect.height)}`;
}

/**
 * A key as the baseline records it, without what changes every run: clock times (the
 * seeded messages' timestamps) read `<time>`, and room and event IDs `<room>`/`<event>`.
 */
export function stableKey(key: string): string {
  return key
    .replaceAll(/\b\d{1,2}:\d{2}(?:\s?[AP]M)?\b/g, "<time>")
    .replaceAll(/![\w-]{16,}(?::[\w.-]+)?/g, "<room>")
    .replaceAll(/\$[\w-]{16,}(?::[\w.-]+)?/g, "<event>");
}

function shortKey(key: string): string {
  return key.length > 60 ? `${key.slice(0, 57)}…` : key;
}

function within(node: ParityNode, region: Rect): boolean {
  const { x, y } = center(node.rect);
  return (
    x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height
  );
}

function groupByKey(nodes: ParityNode[]): Map<string, ParityNode[]> {
  const groups = new Map<string, ParityNode[]>();
  for (const node of nodes) groups.set(node.key, [...(groups.get(node.key) ?? []), node]);
  return groups;
}

/**
 * The differences between the two apps' nodes inside `region` (the safe area, where
 * Zam lays out), Zam's being the reference.
 */
function inReadingOrder(nodes: ParityNode[]): ParityNode[] {
  return nodes.toSorted((a, b) =>
    Math.abs(a.rect.y - b.rect.y) < 2 ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
  );
}

function textOf(node: ParityNode): string {
  return node.key.slice("text:".length);
}

/**
 * The same sentence can be one text in one app and pieces in the other: Zam puts an
 * inline-block button in a paragraph ("Don't have an account?" + "Register") where React
 * Native nests a Text in the sentence. `pieces`' texts that, joined in reading order on one
 * line, spell a text of `whole` that `pieces` lacks become one node.
 */
export function joinSplitTexts(whole: ParityNode[], pieces: ParityNode[]): ParityNode[] {
  const pieceKeys = new Set(pieces.map((node) => node.key));
  const wholeKeys = new Set(whole.map((node) => node.key));
  let loose = inReadingOrder(
    pieces.filter((node) => node.kind === "text" && !wholeKeys.has(node.key)),
  );
  const merged: ParityNode[] = [];
  const used = new Set<ParityNode>();
  for (const target of whole) {
    if (target.kind !== "text" || pieceKeys.has(target.key)) continue;
    const wanted = textOf(target);
    search: for (let start = 0; start < loose.length; start++) {
      for (let length = 2; length <= 4 && start + length <= loose.length; length++) {
        const run = loose.slice(start, start + length);
        const line = center(run[0]!.rect).y;
        if (run.some((node) => Math.abs(center(node.rect).y - line) > 3)) break;
        const texts = run.map(textOf);
        if (texts.join(" ") !== wanted && texts.join("") !== wanted) continue;
        const rects = run.map((node) => node.rect);
        const x = Math.min(...rects.map((rect) => rect.x));
        const y = Math.min(...rects.map((rect) => rect.y));
        merged.push({
          ...run[0]!,
          key: target.key,
          rect: {
            x,
            y,
            width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
            height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
          },
          align: "left",
        });
        for (const node of run) used.add(node);
        loose = loose.filter((node) => !used.has(node));
        break search;
      }
    }
  }
  return [...pieces.filter((node) => !used.has(node)), ...merged];
}

export function compareNodes(
  zamNodes: ParityNode[],
  zamiNodes: ParityNode[],
  region: Rect,
  tolerances: Tolerances = DEFAULT_TOLERANCES,
): Issue[] {
  const issues: Issue[] = [];
  const inRegion = (nodes: ParityNode[]): ParityNode[] =>
    nodes.filter((node) => within(node, region));
  const zami = joinSplitTexts(inRegion(zamNodes), inRegion(zamiNodes));
  const zam = joinSplitTexts(zami, inRegion(zamNodes));
  const zamByKey = groupByKey(inReadingOrder(zam));
  const zamiByKey = groupByKey(inReadingOrder(zami));
  const keys = [...new Set([...zamByKey.keys(), ...zamiByKey.keys()])];

  for (const key of keys) {
    const zam = zamByKey.get(key) ?? [];
    const zami = zamiByKey.get(key) ?? [];
    const count = Math.max(zam.length, zami.length);
    for (let index = 0; index < count; index++) {
      const expected = zam[index];
      const actual = zami[index];
      const id = (kind: IssueKind): string => `${kind}:${stableKey(key)}#${index}`;
      const label = `${shortKey(key)}${count > 1 ? ` #${index + 1}` : ""}`;
      if (expected === undefined && actual !== undefined) {
        // An accessibility label only Zami has changes nothing on screen.
        if (actual.kind === "control") continue;
        issues.push({
          id: id("extra"),
          kind: "extra",
          key,
          message: `${label}: only in Zami, at ${format(actual.rect)}`,
          zami: actual.rect,
        });
        continue;
      }
      if (actual === undefined && expected !== undefined) {
        issues.push({
          id: id("missing"),
          kind: "missing",
          key,
          message: `${label}: missing in Zami (Zam: ${format(expected.rect)})`,
          zam: expected.rect,
        });
        continue;
      }
      if (expected === undefined || actual === undefined) continue;
      const rects = { zam: expected.rect, zami: actual.rect };
      // A backdrop that closes a dialog spans the screen (Zami's reaches under the status
      // bar too) and shows nothing of its own.
      const backdrop = (rect: Rect): boolean =>
        rect.width >= region.width * 0.9 && rect.height >= region.height * 0.9;
      if (expected.kind === "control" && backdrop(expected.rect) && backdrop(actual.rect)) {
        continue;
      }

      if (expected.kind === "text") {
        const dx =
          glyphLeft(actual, Math.min(expected.rect.width, actual.rect.width)) - expected.rect.x;
        const dy = center(actual.rect).y - center(expected.rect).y;
        if (Math.abs(dx) > tolerances.position || Math.abs(dy) > tolerances.position) {
          issues.push({
            id: id("moved"),
            kind: "moved",
            key,
            message: `${label}: moved ${Math.round(dx)}, ${Math.round(dy)} pt (Zam ${format(expected.rect)}, Zami ${format(actual.rect)})`,
            ...rects,
          });
        }
        if (actual.rect.width < expected.rect.width - tolerances.size) {
          issues.push({
            id: id("clipped"),
            kind: "clipped",
            key,
            message: `${label}: ${Math.round(actual.rect.width)} pt wide in Zami, ${Math.round(expected.rect.width)} pt in Zam (cut off or wrapped)`,
            ...rects,
          });
        }
        if ((actual.lines ?? 1) !== (expected.lines ?? 1)) {
          issues.push({
            id: id("wraps"),
            kind: "wraps",
            key,
            message: `${label}: ${actual.lines} line(s) in Zami, ${expected.lines} in Zam`,
            ...rects,
          });
        }
        if (colorsDiffer(expected.color, actual.color, tolerances.color)) {
          issues.push({
            id: id("color"),
            kind: "color",
            key,
            message: `${label}: color ${actual.color} in Zami, ${expected.color} in Zam`,
            ...rects,
          });
        }
        const sizeDiffers =
          expected.fontSize !== undefined &&
          actual.fontSize !== undefined &&
          Math.abs(expected.fontSize - actual.fontSize) > 0.5;
        const weightDiffers =
          expected.fontWeight !== undefined &&
          actual.fontWeight !== undefined &&
          !Number.isNaN(actual.fontWeight) &&
          Math.abs(expected.fontWeight - actual.fontWeight) >= 100;
        if (sizeDiffers || weightDiffers) {
          issues.push({
            id: id("font"),
            kind: "font",
            key,
            message: `${label}: font ${actual.fontSize}px/${actual.fontWeight} in Zami, ${expected.fontSize}px/${expected.fontWeight} in Zam`,
            ...rects,
          });
        }
        continue;
      }

      const delta = {
        x: center(actual.rect).x - center(expected.rect).x,
        y: center(actual.rect).y - center(expected.rect).y,
      };
      if (Math.abs(delta.x) > tolerances.position || Math.abs(delta.y) > tolerances.position) {
        issues.push({
          id: id("moved"),
          kind: "moved",
          key,
          message: `${label}: moved ${Math.round(delta.x)}, ${Math.round(delta.y)} pt (Zam ${format(expected.rect)}, Zami ${format(actual.rect)})`,
          ...rects,
        });
      }
      if (
        Math.abs(actual.rect.width - expected.rect.width) > tolerances.size ||
        Math.abs(actual.rect.height - expected.rect.height) > tolerances.size
      ) {
        issues.push({
          id: id("resized"),
          kind: "resized",
          key,
          message: `${label}: ${Math.round(actual.rect.width)}×${Math.round(actual.rect.height)} in Zami, ${Math.round(expected.rect.width)}×${Math.round(expected.rect.height)} in Zam`,
          ...rects,
        });
      }
    }
  }
  return issues;
}

export interface PixelDiff {
  /** Share of the region's pixels that differ, 0–1. */
  ratio: number;
  /** The region's pixels, differences marked in red over a faded copy of Zami's. */
  image: Buffer;
}

function crop(png: PNG, region: Rect): PNG {
  const out = new PNG({ width: region.width, height: region.height });
  PNG.bitblt(png, out, region.x, region.y, region.width, region.height, 0, 0);
  return out;
}

/** Compares the two screenshots inside `region` (pixels). */
export function comparePixels(zamPng: Buffer, zamiPng: Buffer, region: Rect): PixelDiff {
  const zam = PNG.sync.read(zamPng);
  const zami = PNG.sync.read(zamiPng);
  const bounds = {
    x: Math.max(0, Math.round(region.x)),
    y: Math.max(0, Math.round(region.y)),
    width: Math.round(Math.min(region.width, zam.width - region.x, zami.width - region.x)),
    height: Math.round(Math.min(region.height, zam.height - region.y, zami.height - region.y)),
  };
  const left = crop(zam, bounds);
  const right = crop(zami, bounds);
  const diff = new PNG({ width: bounds.width, height: bounds.height });
  const differing = pixelmatch(left.data, right.data, diff.data, bounds.width, bounds.height, {
    threshold: 0.1,
    includeAA: false,
    alpha: 0.2,
  });
  return { ratio: differing / (bounds.width * bounds.height), image: PNG.sync.write(diff) };
}

/** Two screenshots match exactly (the screen has settled). */
export function samePixels(a: Buffer, b: Buffer): boolean {
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  return left.width === right.width && left.height === right.height && left.data.equals(right.data);
}
