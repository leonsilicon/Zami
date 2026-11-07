#!/usr/bin/env node
// Per-clone setup that git and Zam's own tooling leave to each checkout.
import { mkdirSync, writeFileSync } from "node:fs";
import { Git } from "#git";

// Zami replaces one upstream file, the root package.json (Zam's version lives on as
// package.zami.json). .gitattributes gives it `merge=ours`, so merging upstream keeps
// Zami's; that merge driver only exists once git is told about it, per clone.
const git = new Git(process.cwd());
git.run(["config", "merge.ours.driver", "true"]);

// Zam's tsconfig.json extends `.svelte-kit/tsconfig.json`, which only `svelte-kit sync`
// generates (and Zam's .gitignore ignores). Zami writes its own stand-in there, so
// type-aware lint (`vp check`) and editors can read the `.zami.` files in Zam's tree.
mkdirSync(`${git.root}/.svelte-kit`, { recursive: true });
writeFileSync(
  `${git.root}/.svelte-kit/tsconfig.json`,
  `${JSON.stringify({ extends: "../packages/com/leonsilicon/zami/sveltekit/tsconfig.svelte-kit.json" }, null, 2)}\n`,
);
