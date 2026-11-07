#!/usr/bin/env node
// Links `<repo>/node_modules` to this workspace's node_modules, so files in Zam's tree
// (the `.expo.` files) resolve packages the same way in TypeScript, Node, editors and
// Metro. The link is local state, excluded in `.git/info/exclude`: Zam's `.gitignore`
// only ignores a real `node_modules/` directory, and Zami never edits Zam's files.
import { appendFileSync, existsSync, lstatSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { Git } from "#git";

const git = new Git(process.cwd());
const link = join(git.root, "node_modules");
const exclude = join(git.run(["rev-parse", "--git-common-dir"]).trim(), "info", "exclude");
const absoluteExclude = exclude.startsWith("/") ? exclude : join(git.root, exclude);

if (
  !(
    existsSync(absoluteExclude) &&
    readFileSync(absoluteExclude, "utf8").split("\n").includes("/node_modules")
  )
) {
  appendFileSync(
    absoluteExclude,
    "\n# Zami: symlink to expo/node_modules (see expo/packages/com/leonsilicon/zami/ports/__postinstall.ts)\n/node_modules\n",
  );
}
if (!lstatSync(link, { throwIfNoEntry: false })) {
  symlinkSync("expo/node_modules", link, "dir");
} else if (!lstatSync(link).isSymbolicLink()) {
  console.warn(
    `${link} is a real directory (Zam's own install?), so Expo files resolve packages from it.`,
  );
}
