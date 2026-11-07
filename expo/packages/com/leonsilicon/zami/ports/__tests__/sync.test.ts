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
import { mapUpstreamPath, upstreamPathForExpoPath } from "#paths";
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
    ["src/lib/foo.ts", "src/lib/foo.expo.ts", "copy"],
    ["src/lib/x.svelte.ts", "src/lib/x.svelte.expo.ts", "copy"],
    ["src/lib/x.test.ts", "src/lib/x.test.expo.ts", "copy"],
    ["src/app.d.ts", "src/app.expo.d.ts", "copy"],
    ["src/app.css", "src/app.expo.css", "copy"],
    ["src/app.html", "src/app.expo.html", "copy"],
    ["static/favicon.png", "static/favicon.expo.png", "copy"],
    ["README.md", "README.expo.md", "copy"],
    ["LICENSE", "LICENSE.expo", "copy"],
    [".gitignore", ".gitignore.expo", "copy"],
    [".env.example", ".env.expo.example", "copy"],
    ["android/gradlew", "android/gradlew.expo", "copy"],
    ["src/lib/Foo.svelte", "src/lib/Foo.svelte.expo.tsx", "translate"],
  ];
  for (const [upstream, expo, kind] of cases) {
    assert.deepEqual(mapUpstreamPath(upstream), { upstreamPath: upstream, expoPath: expo, kind });
    assert.equal(upstreamPathForExpoPath(expo), upstream);
  }
  assert.equal(upstreamPathForExpoPath("src/lib/foo.ts"), null);
  assert.equal(upstreamPathForExpoPath("src/lib/foo.ts.expo"), null);
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
  put(zami, "expo/zami-ports.json", JSON.stringify({ include: ["**"] }));
  git(zami, "add", "-A");
  git(zami, "commit", "-q", "-m", "zami setup");

  // First sync: every file gets an Expo version; the Svelte component is left as work.
  let result = sync(new Project(zami));
  assert.deepEqual(result.created.toSorted(), [
    ".gitignore.expo",
    "LICENSE.expo",
    "gradlew.expo",
    "secret/keep.expo.txt",
    "src/a.expo.ts",
    "src/c.svelte.expo.ts",
    "src/gone.expo.ts",
    "src/old.expo.ts",
    "static/icon.expo.png",
    "static/logo.expo.png",
  ]);
  assert.deepEqual(result.work, [
    { kind: "port", expoPath: "src/B.svelte.expo.tsx", upstreamPath: "src/B.svelte" },
  ]);
  // Copies are byte-identical, keep the executable bit, and ignored names are force-added.
  assert.equal(get(zami, "src/a.expo.ts"), lines(20, "a"));
  assert.ok(readFileSync(join(zami, "static/logo.expo.png")).equals(png(1)));
  assert.equal(statSync(join(zami, "gradlew.expo")).mode & 0o111, 0o111);
  assert.match(git(zami, "ls-files", "--", "secret/keep.expo.txt"), /secret\/keep.expo.txt/);
  const upstream1 = git(upstream, "rev-parse", "HEAD").trim();
  assert.equal(Manifest.read(zami).get("src/a.expo.ts"), upstream1);

  // Zami's own edits: tweak two copies and a binary, and translate the component.
  put(zami, "src/a.expo.ts", get(zami, "src/a.expo.ts").replace("a line 2\n", "a line 2 (expo)\n"));
  put(
    zami,
    "src/c.svelte.expo.ts",
    get(zami, "src/c.svelte.expo.ts").replace("c line 3\n", "c line 3 (expo)\n"),
  );
  put(zami, "static/icon.expo.png", png(9));
  put(zami, "src/B.svelte.expo.tsx", "export default function B() { return null; }\n");
  markDone(new Project(zami), ["src/B.svelte.expo.tsx"]);
  git(zami, "add", "-A");
  git(zami, "commit", "-q", "-m", "expo versions");
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
  assert.ok(checked.failures.some((failure) => failure.startsWith("src/a.expo.ts: stale")));
  assert.ok(checked.failures.some((failure) => failure.startsWith("src/new.expo.ts: missing")));
  assert.ok(checked.failures.some((failure) => failure.startsWith("src/gone.expo.ts: orphan")));

  put(upstream, "src/D.svelte", "<p>new component</p>\n");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-q", "-m", "upstream 3");
  const upstream3 = git(upstream, "rev-parse", "HEAD").trim();
  git(zami, "fetch", "-q", "upstream");
  git(zami, "merge", "-q", "--no-edit", "upstream/master");

  result = sync(new Project(zami), { since: upstream1 });
  assert.equal(result.upstreamSha, upstream3);
  assert.deepEqual(result.merged.toSorted(), [
    "src/a.expo.ts",
    "src/renamed.expo.ts",
    "static/logo.expo.png",
  ]);
  assert.deepEqual(result.created, ["src/new.expo.ts"]);
  assert.deepEqual(result.deleted, ["src/gone.expo.ts"]);
  assert.deepEqual(result.moved, [{ from: "src/old.expo.ts", to: "src/renamed.expo.ts" }]);
  assert.deepEqual(
    sorted(
      result.work.map((item) => [
        item.kind,
        item.expoPath,
        item.binary ? "binary" : "",
        item.new ? "new" : "",
      ]),
    ),
    sorted([
      ["conflict", "src/c.svelte.expo.ts", "", ""],
      ["conflict", "static/icon.expo.png", "binary", ""],
      ["migrate", "src/B.svelte.expo.tsx", "", ""],
      ["port", "src/D.svelte.expo.tsx", "", "new"],
    ]),
  );

  // The clean merges kept Zami's edit and took upstream's; untouched binaries follow upstream.
  assert.match(get(zami, "src/a.expo.ts"), /a line 2 \(expo\)\n/);
  assert.match(get(zami, "src/a.expo.ts"), /a line 15 changed\n/);
  assert.match(get(zami, "src/renamed.expo.ts"), /old line 9 changed/);
  assert.ok(readFileSync(join(zami, "static/logo.expo.png")).equals(png(2)));
  assert.ok(readFileSync(join(zami, "static/icon.expo.png")).equals(png(9)));
  assert.equal(existsSync(join(zami, "src/gone.expo.ts")), false);
  const manifest = Manifest.read(zami);
  assert.equal(manifest.get("src/a.expo.ts"), upstream3);
  assert.equal(manifest.get("src/c.svelte.expo.ts"), upstream1);
  assert.equal(manifest.get("src/gone.expo.ts"), undefined);

  // Unresolved work keeps check failing; resolving it and marking it done passes.
  checked = check(new Project(zami));
  assert.ok(
    checked.failures.some((failure) =>
      failure.includes("src/c.svelte.expo.ts: unresolved conflict"),
    ),
  );
  assert.ok(checked.failures.some((failure) => failure.startsWith("src/B.svelte.expo.tsx: stale")));
  assert.ok(checked.failures.some((failure) => failure.startsWith("static/icon.expo.png: stale")));
  assert.throws(() => markDone(new Project(zami), ["src/c.svelte.expo.ts"]), /conflict markers/);
  put(
    zami,
    "src/c.svelte.expo.ts",
    get(zami, "src/c.svelte.expo.ts").replace(
      /<<<<<<< expo\n[\s\S]*?>>>>>>> upstream\n/,
      "c line 3 upstream (expo)\n",
    ),
  );
  put(zami, "src/D.svelte.expo.tsx", "export default function D() { return null; }\n");
  markDone(new Project(zami), [
    "src/c.svelte.expo.ts",
    "src/B.svelte.expo.tsx",
    "src/D.svelte.expo.tsx",
    "static/icon.expo.png",
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
