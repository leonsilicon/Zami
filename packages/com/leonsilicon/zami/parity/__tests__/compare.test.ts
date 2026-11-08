import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { test } from "vite-plus/test";
import type { ParityNode } from "#protocol";
import { judge, type ViewResult } from "#baseline";
import { compareNodes, comparePixels, parseColor } from "#compare";

const region = { x: 0, y: 0, width: 400, height: 800 };

function text(content: string, x: number, y: number, extra: Partial<ParityNode> = {}): ParityNode {
  return {
    kind: "text",
    key: `text:${content}`,
    rect: { x, y, width: 80, height: 20 },
    align: "left",
    lines: 1,
    color: "rgb(219, 222, 225)",
    fontSize: 14,
    fontWeight: 400,
    ...extra,
  };
}

test("identical nodes have no issues", () => {
  const nodes = [text("Kevin Wang", 100, 200), text("ROOMS", 100, 150)];
  assert.deepEqual(compareNodes(nodes, structuredClone(nodes), region), []);
});

test("the drawer bug: room names pushed right by the rail", () => {
  // Zam's rail is 72 pt wide; Zami's grew to 192 pt and pushed the room list right.
  const issues = compareNodes(
    [text("Kevin Wang", 92, 200)],
    [text("Kevin Wang", 212, 200)],
    region,
  );
  assert.deepEqual(
    issues.map((issue) => issue.id),
    ["moved:text:Kevin Wang#0"],
  );
});

test("texts pair in reading order, and extra or missing ones are reported", () => {
  const issues = compareNodes(
    [text("Bob", 10, 100), text("Bob", 10, 300), text("Carol", 10, 400)],
    [text("Bob", 10, 100), text("Bob", 10, 300), text("Dave", 10, 400)],
    region,
  );
  assert.deepEqual(issues.map((issue) => issue.id).toSorted(), [
    "extra:text:Dave#0",
    "missing:text:Carol#0",
  ]);
});

test("centered text compares its middle, so a stretched React Native box still matches", () => {
  const zam = text("Welcome", 160, 100, { align: "center" });
  const zami = text("Welcome", 0, 100, {
    align: "center",
    rect: { x: 0, y: 100, width: 400, height: 20 },
  });
  assert.deepEqual(compareNodes([zam], [zami], region), []);
});

test("truncated text, wrapping, color and font differences", () => {
  const zam = text("Pending Invites", 10, 10, { rect: { x: 10, y: 10, width: 120, height: 20 } });
  const zami = text("Pending Invites", 10, 10, {
    rect: { x: 10, y: 10, width: 60, height: 20 },
    color: "#ff0000",
    fontWeight: 700,
  });
  assert.deepEqual(
    compareNodes([zam], [zami], region)
      .map((issue) => issue.kind)
      .toSorted(),
    ["clipped", "color", "font"],
  );
  assert.deepEqual(
    compareNodes([zam], [{ ...zam, lines: 2 }], region).map((issue) => issue.kind),
    ["wraps"],
  );
});

test("controls compare position and size", () => {
  const home: ParityNode = {
    kind: "control",
    key: "label:Home",
    rect: { x: 12, y: 60, width: 48, height: 48 },
  };
  assert.deepEqual(compareNodes([home], [{ ...home }], region), []);
  const issues = compareNodes(
    [home],
    [{ ...home, rect: { x: 72, y: 60, width: 48, height: 40 } }],
    region,
  );
  assert.deepEqual(
    issues.map((issue) => issue.kind),
    ["moved", "resized"],
  );
});

test("nodes outside the compared region are ignored", () => {
  assert.deepEqual(compareNodes([], [text("9:41", 10, 900)], region), []);
});

test("parseColor reads CSS and React Native colors", () => {
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), [1, 2, 3, 1]);
  assert.deepEqual(parseColor("rgba(1, 2, 3, 0.5)"), [1, 2, 3, 0.5]);
  assert.deepEqual(parseColor("#fff"), [255, 255, 255, 1]);
  assert.deepEqual(parseColor("#11223380"), [17, 34, 51, 128 / 255]);
  assert.equal(parseColor("papayawhip"), undefined);
});

function png(width: number, height: number, paint: (x: number, y: number) => number): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const value = paint(x, y);
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

test("comparePixels counts differing pixels inside the region only", () => {
  const black = png(20, 20, () => 0);
  // White outside the region, black inside: no difference.
  const framed = png(20, 20, (x, y) => (x < 5 || y < 5 ? 255 : 0));
  assert.equal(comparePixels(black, framed, { x: 5, y: 5, width: 15, height: 15 }).ratio, 0);
  // A white 5×5 square inside a 10×10 region: a quarter of it differs.
  const square = png(20, 20, (x, y) => (x >= 10 && x < 15 && y >= 10 && y < 15 ? 255 : 0));
  assert.equal(comparePixels(black, square, { x: 10, y: 10, width: 10, height: 10 }).ratio, 0.25);
});

function result(overrides: Partial<ViewResult>): ViewResult {
  return {
    name: "room",
    pixels: 0,
    issues: [],
    errors: {},
    components: [],
    seconds: 1,
    ...overrides,
  };
}

const moved = { id: "moved:text:Bob#0", kind: "moved" as const, key: "text:Bob", message: "" };

test("judge: matches, known differences, regressions and fixes", () => {
  assert.equal(judge(result({}), undefined, false).status, "match");
  assert.equal(judge(result({ issues: [moved] }), undefined, false).status, "new");
  const base = { pixels: 0.05, issues: [moved.id] };
  assert.deepEqual(
    [judge(result({ pixels: 0.05, issues: [moved] }), base, false)].map(({ status, failed }) => [
      status,
      failed,
    ]),
    [["known", false]],
  );
  assert.equal(judge(result({ pixels: 0.05, issues: [moved] }), base, true).failed, true);
  const worse = judge(
    result({ pixels: 0.05, issues: [moved, { ...moved, id: "extra:text:Dave#0" }] }),
    base,
    false,
  );
  assert.deepEqual([worse.status, worse.added], ["regressed", ["extra:text:Dave#0"]]);
  assert.equal(judge(result({ pixels: 0.06, issues: [moved] }), base, false).status, "regressed");
  const better = judge(result({ pixels: 0.01 }), base, false);
  assert.deepEqual([better.status, better.fixed, better.failed], ["improved", [moved.id], false]);
  assert.equal(
    judge(result({ pixels: 0.05, issues: [moved], errors: { zami: "boom" } }), base, false).status,
    "error",
  );
});

test("a sentence split around an inline button matches the same sentence as one text", () => {
  const zam = [
    text("Don't have an account?", 60, 500, { rect: { x: 60, y: 500, width: 180, height: 20 } }),
    text("Register", 244, 500, { rect: { x: 244, y: 500, width: 60, height: 20 } }),
  ];
  const zami = [
    text("Don't have an account? Register", 60, 500, {
      rect: { x: 60, y: 500, width: 244, height: 20 },
    }),
  ];
  assert.deepEqual(compareNodes(zam, zami, region), []);
  assert.deepEqual(compareNodes(zami, zam, region), []);
});

test("issue ids leave out clock times, which change every run", () => {
  const issues = compareNodes([text("11:24 PM", 10, 10)], [text("11:24 PM", 30, 10)], region);
  assert.deepEqual(
    issues.map((issue) => issue.id),
    ["moved:text:<time>#0"],
  );
});

test("issue ids leave out room and event IDs, which change every run", () => {
  const room = "!3nqBVyvSCAvR7DaiXlSBitjWpGdGVvDvHoZtqHSzNMU";
  const issues = compareNodes([text(room, 10, 10)], [text(room, 30, 10)], region);
  assert.deepEqual(
    issues.map((issue) => issue.id),
    ["moved:text:<room>#0"],
  );
});
