import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vite-plus/test";
import { readConfigFlows, resolveFlows } from "#flows";

const dir = mkdtempSync(join(tmpdir(), "zami-maestro-"));
const suite = join(dir, ".maestro");
mkdirSync(join(suite, "subflows"), { recursive: true });
for (const file of ["smoke.yaml", "toasts.yaml", "other.yml", "subflows/launch-app.yaml"]) {
  writeFileSync(join(suite, file), "appId: com.leonsilicon.zami\n---\n");
}
writeFileSync(
  join(suite, "config.yaml"),
  [
    "# The default suite.",
    "flows:",
    "  - smoke.yaml",
    "# A comment at column 0 doesn't end the list.",
    '  - "toasts.yaml" # quoted, with a trailing comment',
    "executionOrder:",
    "  - not-a-flow.yaml",
    "",
  ].join("\n"),
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("readConfigFlows lists the entries under flows: only", () => {
  assert.deepEqual(readConfigFlows(suite), ["smoke.yaml", "toasts.yaml"]);
});

test("readConfigFlows fails on a config without flows", () => {
  const empty = join(dir, "empty");
  mkdirSync(empty);
  writeFileSync(join(empty, "config.yaml"), "appId: x\n");
  assert.throws(() => readConfigFlows(empty), /No flows are listed/);
});

test("resolveFlows defaults to the suite in config.yaml", () => {
  assert.deepEqual(
    resolveFlows(suite, [], dir).map((flow) => flow.name),
    ["smoke", "toasts"],
  );
});

test("resolveFlows accepts names, file names, nested names and paths", () => {
  const flows = resolveFlows(
    suite,
    ["smoke", "toasts.yaml", "other.yml", "subflows/launch-app", ".maestro/smoke.yaml"],
    dir,
  );
  assert.deepEqual(
    flows.map((flow) => flow.name),
    ["smoke", "toasts", "other", "subflows/launch-app", "smoke"],
  );
  assert.equal(flows[0]?.path, join(suite, "smoke.yaml"));
  assert.equal(flows[4]?.path, join(suite, "smoke.yaml"));
});

test("resolveFlows fails on a flow that doesn't exist", () => {
  assert.throws(() => resolveFlows(suite, ["missing"], dir), /No Maestro flow missing/);
});
