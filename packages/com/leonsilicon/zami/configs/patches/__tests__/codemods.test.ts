// A source codemod applied to a copy of its tree with jssg, and the loud failures when its
// target drifted.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vite-plus/test";
import { applySourceCodemods, discoverCodemods, sourceCodemods } from "#codemods";

const dir = mkdtempSync(join(tmpdir(), "zami-codemods-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const codemods = join(dir, "codemods");
mkdirSync(join(codemods, "fixture.greeting"), { recursive: true });
writeFileSync(
  join(codemods, "fixture.greeting/patch.json"),
  JSON.stringify({ source: "fixture", bundles: ["src/greeting.ts"] }),
);
writeFileSync(
  join(codemods, "fixture.greeting/codemod.ts"),
  `export default function codemod(root) {
  const source = root.root().text();
  if (source.includes("Zami")) return null;
  return source.replace('"Hello from Zam"', '"Hello from Zami"');
}
`,
);

function tree(content: string): string {
  const root = mkdtempSync(join(dir, "tree-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/greeting.ts"), content);
  return root;
}

test("codemods are found with their targets", () => {
  const found = discoverCodemods(codemods);
  assert.deepEqual(
    found.map((codemod) => [codemod.name, codemod.config.target]),
    [["fixture.greeting", { kind: "source", source: "fixture" }]],
  );
  assert.equal(sourceCodemods("fixture", codemods).length, 1);
  assert.equal(sourceCodemods("other", codemods).length, 0);
});

test("a source codemod changes the copy of its tree", () => {
  const root = tree('export const greeting = "Hello from Zam";\n');
  applySourceCodemods("fixture", root, codemods);
  assert.equal(
    readFileSync(join(root, "src/greeting.ts"), "utf8"),
    'export const greeting = "Hello from Zami";\n',
  );
});

test("a codemod whose anchor drifted fails instead of leaving the file unpatched", () => {
  const root = tree('export const greeting = "Hi from Zam";\n');
  assert.throws(
    () => applySourceCodemods("fixture", root, codemods),
    /changed nothing in src\/greeting\.ts/,
  );
});

test("a codemod whose file is gone fails", () => {
  const root = mkdtempSync(join(dir, "tree-"));
  assert.throws(
    () => applySourceCodemods("fixture", root, codemods),
    /src\/greeting\.ts isn't there any more/,
  );
});
