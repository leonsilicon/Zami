import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, test } from "vite-plus/test";
import { check } from "#check";
import { Manifest } from "#manifest";
import { mapUpstreamPath, upstreamPathForZamiPath } from "#paths";
import { Project } from "#project";
import { markDone, sync } from "#sync";

Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
});

const dir = mkdtempSync(join(tmpdir(), "zami-ports-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (root: string, path: string, content: string | Buffer) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const get = (root: string, path: string) => readFileSync(join(root, path), "utf8");
const lines = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => `${prefix} line ${index + 1}`).join("\n") + "\n";
const png = (byte: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, byte]);
const sorted = (items: string[][]) => items.toSorted((a, b) => a.join().localeCompare(b.join()));

test("paths map both ways, for every kind of file", () => {
  const cases: [string, string, string][] = [
    ["src/lib/foo.ts", "src/lib/foo.zami.ts", "copy"],
    ["src/lib/x.svelte.ts", "src/lib/x.svelte.zami.ts", "copy"],
    ["src/lib/x.test.ts", "src/lib/x.test.zami.ts", "copy"],
    ["src/app.d.ts", "src/app.zami.d.ts", "copy"],
    ["src/app.css", "src/app.zami.css", "copy"],
    ["src/app.html", "src/app.zami.html", "copy"],
    ["static/favicon.png", "static/favicon.zami.png", "copy"],
    ["README.md", "README.zami.md", "copy"],
    ["LICENSE", "LICENSE.zami", "copy"],
    [".gitignore", ".gitignore.zami", "copy"],
    [".env.example", ".env.zami.example", "copy"],
    ["android/gradlew", "android/gradlew.zami", "copy"],
    ["src/lib/Foo.svelte", "src/lib/Foo.svelte.zami.tsx", "translate"],
  ];
  for (const [upstream, zami, kind] of cases) {
    assert.deepEqual(mapUpstreamPath(upstream), { upstreamPath: upstream, zamiPath: zami, kind });
    assert.equal(upstreamPathForZamiPath(zami), upstream);
  }
  assert.equal(upstreamPathForZamiPath("src/lib/foo.ts"), null);
  assert.equal(upstreamPathForZamiPath("src/lib/foo.ts.zami"), null);
});

test("sync copies, merges, flags work, and check enforces the invariants", () => {
  const upstream = join(dir, "upstream");
  const zami = join(dir, "zami");
  mkdirSync(upstream);
  git(upstream, "init", "-q", "-b", "master");
  put(upstream, "src/a.ts", lines(20, "a"));
  put(upstream, "src/c.svelte.ts", lines(5, "c"));
  put(upstream, "src/B.svelte", "<p>hello</p>\n");
  put(upstream, "src/gone.ts", "export const gone = 1;\n");
  put(upstream, "src/old.ts", lines(10, "old"));
  put(upstream, "static/logo.png", png(1));
  put(upstream, "static/icon.png", png(1));
  put(upstream, "LICENSE", "GPL\n");
  put(upstream, ".gitignore", "secret/*\n!secret/keep.txt\n");
  put(upstream, "secret/keep.txt", "tracked despite the ignore rule\n");
  put(upstream, "gradlew", "#!/bin/sh\necho hi\n");
  execFileSync("chmod", ["+x", join(upstream, "gradlew")]);
  git(upstream, "add", "-A");
  git(upstream, "commit", "-q", "-m", "upstream 1");

  git(dir, "init", "-q", "-b", "main", zami);
  git(zami, "remote", "add", "upstream", upstream);
  git(zami, "fetch", "-q", "upstream");
  git(zami, "checkout", "-q", "-B", "main", "upstream/master");
  put(zami, "zami-ports.json", JSON.stringify({ include: ["**"] }));
  git(zami, "add", "-A");
  git(zami, "commit", "-q", "-m", "zami setup");

  // First sync: every file gets a Zami version; the Svelte component is left as work.
  let result = sync(new Project(zami));
  assert.deepEqual(result.created.toSorted(), [
    ".gitignore.zami",
    "LICENSE.zami",
    "gradlew.zami",
    "secret/keep.zami.txt",
    "src/a.zami.ts",
    "src/c.svelte.zami.ts",
    "src/gone.zami.ts",
    "src/old.zami.ts",
    "static/icon.zami.png",
    "static/logo.zami.png",
  ]);
  assert.deepEqual(result.work, [
    { kind: "port", zamiPath: "src/B.svelte.zami.tsx", upstreamPath: "src/B.svelte" },
  ]);
  // Copies are byte-identical, keep the executable bit, and ignored names are force-added.
  assert.equal(get(zami, "src/a.zami.ts"), lines(20, "a"));
  assert.ok(readFileSync(join(zami, "static/logo.zami.png")).equals(png(1)));
  assert.equal(statSync(join(zami, "gradlew.zami")).mode & 0o111, 0o111);
  assert.match(git(zami, "ls-files", "--", "secret/keep.zami.txt"), /secret\/keep.zami.txt/);
  // Editor settings hide upstream files that have a Zami version, and nothing else.
  const zed = JSON.parse(get(zami, ".zed/settings.json")) as { file_scan_exclusions: string[] };
  assert.ok(zed.file_scan_exclusions.includes("src/a.ts"));
  assert.ok(zed.file_scan_exclusions.includes("static/logo.png"));
  assert.ok(!zed.file_scan_exclusions.includes("src/B.svelte"), "not ported yet: stays visible");
  assert.ok(!zed.file_scan_exclusions.includes("src/a.zami.ts"));
  const vscode = JSON.parse(get(zami, "zami.code-workspace")) as {
    settings: { "files.exclude": Record<string, unknown> };
  };
  assert.deepEqual(vscode.settings["files.exclude"]["*/**/*.ts"], { when: "$(basename).zami.ts" });
  assert.equal(vscode.settings["files.exclude"]["LICENSE"], true);
  const upstream1 = git(upstream, "rev-parse", "HEAD").trim();
  assert.equal(Manifest.read(zami).get("src/a.zami.ts"), upstream1);

  // Zami's own edits: tweak two copies and a binary, and translate the component.
  put(zami, "src/a.zami.ts", get(zami, "src/a.zami.ts").replace("a line 2\n", "a line 2 (zami)\n"));
  put(
    zami,
    "src/c.svelte.zami.ts",
    get(zami, "src/c.svelte.zami.ts").replace("c line 3\n", "c line 3 (zami)\n"),
  );
  put(zami, "static/icon.zami.png", png(9));
  put(zami, "src/B.svelte.zami.tsx", "export default function B() { return null; }\n");
  markDone(new Project(zami), ["src/B.svelte.zami.tsx"]);
  git(zami, "add", "-A");
  git(zami, "commit", "-q", "-m", "zami versions");
  assert.deepEqual(check(new Project(zami), { strict: true }).failures, []);

  // Upstream moves on.
  put(upstream, "src/a.ts", lines(20, "a").replace("a line 15\n", "a line 15 changed\n"));
  put(upstream, "src/c.svelte.ts", lines(5, "c").replace("c line 3\n", "c line 3 upstream\n"));
  put(upstream, "src/B.svelte", "<p>hello world</p>\n");
  put(upstream, "static/logo.png", png(2));
  put(upstream, "static/icon.png", png(3));
  rmSync(join(upstream, "src/gone.ts"));
  renameSync(join(upstream, "src/old.ts"), join(upstream, "src/renamed.ts"));
  put(upstream, "src/renamed.ts", lines(10, "old").replace("old line 9\n", "old line 9 changed\n"));
  put(upstream, "src/new.ts", "export const fresh = true;\n");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-q", "-m", "upstream 2");
  git(zami, "fetch", "-q", "upstream");
  git(zami, "merge", "-q", "--no-edit", "upstream/master");

  let checked = check(new Project(zami));
  assert.ok(checked.failures.some((failure) => failure.startsWith("src/a.zami.ts: stale")));
  assert.ok(checked.failures.some((failure) => failure.startsWith("src/new.zami.ts: missing")));
  assert.ok(checked.failures.some((failure) => failure.startsWith("src/gone.zami.ts: orphan")));

  put(upstream, "src/D.svelte", "<p>new component</p>\n");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-q", "-m", "upstream 3");
  const upstream3 = git(upstream, "rev-parse", "HEAD").trim();
  git(zami, "fetch", "-q", "upstream");
  git(zami, "merge", "-q", "--no-edit", "upstream/master");

  result = sync(new Project(zami), { since: upstream1 });
  assert.equal(result.upstreamSha, upstream3);
  assert.deepEqual(result.merged.toSorted(), [
    "src/a.zami.ts",
    "src/renamed.zami.ts",
    "static/logo.zami.png",
  ]);
  assert.deepEqual(result.created, ["src/new.zami.ts"]);
  assert.deepEqual(result.deleted, ["src/gone.zami.ts"]);
  assert.deepEqual(result.moved, [{ from: "src/old.zami.ts", to: "src/renamed.zami.ts" }]);
  assert.deepEqual(
    sorted(
      result.work.map((item) => [
        item.kind,
        item.zamiPath,
        item.binary ? "binary" : "",
        item.new ? "new" : "",
      ]),
    ),
    sorted([
      ["conflict", "src/c.svelte.zami.ts", "", ""],
      ["conflict", "static/icon.zami.png", "binary", ""],
      ["migrate", "src/B.svelte.zami.tsx", "", ""],
      ["port", "src/D.svelte.zami.tsx", "", "new"],
    ]),
  );

  // The clean merges kept Zami's edit and took upstream's; untouched binaries follow upstream.
  assert.match(get(zami, "src/a.zami.ts"), /a line 2 \(zami\)\n/);
  assert.match(get(zami, "src/a.zami.ts"), /a line 15 changed\n/);
  assert.match(get(zami, "src/renamed.zami.ts"), /old line 9 changed/);
  assert.ok(readFileSync(join(zami, "static/logo.zami.png")).equals(png(2)));
  assert.ok(readFileSync(join(zami, "static/icon.zami.png")).equals(png(9)));
  assert.equal(existsSync(join(zami, "src/gone.zami.ts")), false);
  const manifest = Manifest.read(zami);
  assert.equal(manifest.get("src/a.zami.ts"), upstream3);
  assert.equal(manifest.get("src/c.svelte.zami.ts"), upstream1);
  assert.equal(manifest.get("src/gone.zami.ts"), undefined);

  // Unresolved work keeps check failing; resolving it and marking it done passes.
  checked = check(new Project(zami));
  assert.ok(
    checked.failures.some((failure) =>
      failure.includes("src/c.svelte.zami.ts: unresolved conflict"),
    ),
  );
  assert.ok(checked.failures.some((failure) => failure.startsWith("src/B.svelte.zami.tsx: stale")));
  assert.ok(checked.failures.some((failure) => failure.startsWith("static/icon.zami.png: stale")));
  assert.throws(() => markDone(new Project(zami), ["src/c.svelte.zami.ts"]), /conflict markers/);
  put(
    zami,
    "src/c.svelte.zami.ts",
    get(zami, "src/c.svelte.zami.ts").replace(
      /<<<<<<< zami\n[\s\S]*?>>>>>>> upstream\n/,
      "c line 3 upstream (zami)\n",
    ),
  );
  put(zami, "src/D.svelte.zami.tsx", "export default function D() { return null; }\n");
  markDone(new Project(zami), [
    "src/c.svelte.zami.ts",
    "src/B.svelte.zami.tsx",
    "src/D.svelte.zami.tsx",
    "static/icon.zami.png",
  ]);
  git(zami, "add", "-A");
  git(zami, "commit", "-q", "-m", "migrate");
  assert.deepEqual(check(new Project(zami), { strict: true }).failures, []);

  // Touching an upstream file is never allowed.
  put(zami, "src/a.ts", "tampered\n");
  git(zami, "commit", "-q", "-am", "oops");
  checked = check(new Project(zami));
  assert.ok(
    checked.failures.some((failure) => failure.startsWith("src/a.ts: upstream file modified")),
  );
});

test("review lists every upstream change that isn't already work, on a resumed sync too", () => {
  const upstream = join(dir, "review-upstream");
  const zami = join(dir, "review-zami");
  mkdirSync(upstream);
  git(upstream, "init", "-q", "-b", "master");
  put(upstream, "static/sw.js", "self.version = 1;\n");
  put(upstream, "src/B.svelte", "<p>hello</p>\n");
  put(upstream, "src/Gone.svelte", "<p>gone</p>\n");
  put(upstream, "electron/main.cjs", "module.exports = 1;\n");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-q", "-m", "upstream 1");
  const from = git(upstream, "rev-parse", "HEAD").trim();

  git(dir, "init", "-q", "-b", "main", zami);
  git(zami, "remote", "add", "upstream", upstream);
  git(zami, "fetch", "-q", "upstream");
  git(zami, "checkout", "-q", "-B", "main", "upstream/master");
  put(zami, "zami-ports.json", JSON.stringify({ include: ["**"], exclude: ["electron/**"] }));
  sync(new Project(zami));
  put(zami, "src/B.svelte.zami.tsx", "export default function B() { return null; }\n");
  put(zami, "src/Gone.svelte.zami.tsx", "export default function Gone() { return null; }\n");
  markDone(new Project(zami), ["src/B.svelte.zami.tsx", "src/Gone.svelte.zami.tsx"]);
  git(zami, "add", "-A");
  git(zami, "commit", "-q", "-m", "zami versions");

  put(upstream, "static/sw.js", "self.version = 2;\n");
  put(upstream, "src/B.svelte", "<p>hello world</p>\n");
  rmSync(join(upstream, "src/Gone.svelte"));
  put(upstream, "src/added.ts", "export const added = 1;\n");
  put(upstream, "electron/main.cjs", "module.exports = 2;\n");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-q", "-m", "upstream 2");
  git(zami, "fetch", "-q", "upstream");
  git(zami, "merge", "-q", "--no-edit", "upstream/master");

  const expected = [
    { upstreamPath: "electron/main.cjs", status: "M" },
    { upstreamPath: "src/Gone.svelte", status: "D" },
    { upstreamPath: "src/added.ts", status: "A", zamiPath: "src/added.zami.ts" },
    { upstreamPath: "static/sw.js", status: "M", zamiPath: "static/sw.zami.js" },
  ];
  const first = sync(new Project(zami), { since: from });
  assert.equal(first.since, from);
  assert.deepEqual(first.review, expected);
  assert.deepEqual(
    first.work.map((item) => item.zamiPath),
    ["src/B.svelte.zami.tsx"],
    "a translated component is work, not review",
  );

  // A later run still sees what the first one merged, though the manifest has moved on.
  git(zami, "add", "-A");
  git(zami, "commit", "-q", "-m", "partial sync");
  assert.deepEqual(sync(new Project(zami), { since: from }).review, expected);
  assert.deepEqual(sync(new Project(zami)).review, []);
});

test("excluding an upstream file drops its Zami version, unless Zami changed it", () => {
  const upstream = join(dir, "exclude-upstream");
  const zami = join(dir, "exclude-zami");
  mkdirSync(upstream);
  git(upstream, "init", "-q", "-b", "master");
  put(upstream, "src/a.ts", "export const a = 1;\n");
  put(upstream, "capacitor.config.ts", "export default {};\n");
  put(upstream, "svelte.config.js", "export default {};\n");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-q", "-m", "upstream");
  git(dir, "init", "-q", "-b", "main", zami);
  git(zami, "remote", "add", "upstream", upstream);
  git(zami, "fetch", "-q", "upstream");
  git(zami, "checkout", "-q", "-B", "main", "upstream/master");
  put(zami, "zami-ports.json", JSON.stringify({ include: ["**"] }));
  sync(new Project(zami));
  put(zami, "svelte.config.zami.js", "export default { zami: true };\n");
  markDone(new Project(zami), ["svelte.config.zami.js"]);

  put(
    zami,
    "zami-ports.json",
    JSON.stringify({ include: ["**"], exclude: ["capacitor.config.ts", "svelte.config.js"] }),
  );
  const result = sync(new Project(zami));
  assert.deepEqual(result.deleted, ["capacitor.config.zami.ts"]);
  assert.deepEqual(
    result.orphans,
    ["svelte.config.zami.js"],
    "changed by Zami: kept for a person to decide",
  );
  assert.equal(existsSync(join(zami, "capacitor.config.zami.ts")), false);
  assert.equal(Manifest.read(zami).get("capacitor.config.zami.ts"), undefined);
  const zed = JSON.parse(get(zami, ".zed/settings.json")) as { file_scan_exclusions: string[] };
  assert.ok(zed.file_scan_exclusions.includes("capacitor.config.ts"));
});
