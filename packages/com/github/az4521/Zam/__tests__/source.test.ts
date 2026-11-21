import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZAM_PATH } from "@-/com.leonsilicon.zami.paths";
import { expect, test } from "vite-plus/test";
import { readZamBlobs, readZamFile, zamTree } from "../+.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("reads the staged gitlink even when the submodule checkout has moved", () => {
  const root = mkdtempSync(join(tmpdir(), "zami-source-"));
  const submodule = join(root, ZAM_PATH);
  try {
    git(root, "init", "-q");
    mkdirSync(submodule, { recursive: true });
    git(submodule, "init", "-q");
    git(submodule, "config", "user.name", "Zami test");
    git(submodule, "config", "user.email", "test@example.com");
    git(submodule, "config", "commit.gpgsign", "false");

    const first = '{"version":"1.0.0"}';
    writeFileSync(join(submodule, "package.json"), first);
    git(submodule, "add", "package.json");
    git(submodule, "commit", "-qm", "First release");
    git(
      root,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${git(submodule, "rev-parse", "HEAD")},${ZAM_PATH}`,
    );

    const second = '{"version":"2.0.0"}';
    writeFileSync(join(submodule, "package.json"), second);
    git(submodule, "commit", "-qam", "Second release");

    const entries = zamTree(root);
    expect(entries.map(({ path }) => path)).toEqual(["package.json"]);
    const [entry] = entries;
    expect(entry).toBeDefined();
    expect(readZamBlobs(root, [entry!.sha]).get(entry!.sha)?.toString()).toBe(first);
    expect(readZamFile(root, "package.json").toString()).toBe(first);

    git(
      root,
      "update-index",
      "--cacheinfo",
      `160000,${git(submodule, "rev-parse", "HEAD")},${ZAM_PATH}`,
    );
    expect(readZamFile(root, "package.json").toString()).toBe(second);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
