#!/usr/bin/env node
// Zami's changes to code it doesn't own, as jssg codemods (see README.md).
//
//   _patches generate [<codemod>...]   regenerate the bun patches of the npm codemods
//   _patches check                     every codemod still applies: the source ones to a
//                                      copy of their tree, the npm ones as current patches
//   _patches apply <source> <dir>      apply the codemods for <source> (a tree in the
//                                      repository, e.g. repos/com/github/az4521/Zam) to
//                                      the copy of it in <dir>
//
// Run from anywhere in the repository.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
// Flatcap resolves names to case-sensitive paths, but npm names use lowercase.
// oxlint-disable-next-line flatcap/no-unresolved-imports
import { readZamFile } from "@-/com.github.az4521.zam";
import { repoRoot, ZAM_PATH } from "@-/com.leonsilicon.zami.paths";
import { applyCodemod, applySourceCodemods, discoverCodemods } from "#codemods";
import { checkNpmPatch, generateNpmPatch, npmCodemods } from "#npm";

const [command, ...args] = process.argv.slice(2);
const root = repoRoot();

function check(): number {
  let failures = 0;
  for (const codemod of discoverCodemods()) {
    const target = codemod.config.target;
    try {
      if (target.kind === "source") {
        // Copy only the files it changes, using the pin for Zam.
        const copy = mkdtempSync(join(tmpdir(), `zami-patches-${codemod.name}-`));
        try {
          for (const bundle of codemod.config.bundles) {
            const file = join(copy, bundle.path);
            mkdirSync(dirname(file), { recursive: true });
            if (target.source === ZAM_PATH) writeFileSync(file, readZamFile(root, bundle.path));
            else cpSync(join(root, target.source, bundle.path), file);
          }
          applyCodemod(codemod, copy);
        } finally {
          rmSync(copy, { recursive: true, force: true });
        }
      } else {
        const problems = checkNpmPatch(root, codemod);
        if (problems.length > 0) throw new Error(problems.join("\n"));
      }
      console.log(`ok    ${codemod.name}`);
    } catch (error) {
      failures++;
      console.log(`FAIL  ${codemod.name}\n${(error as Error).message.replace(/^/gm, "      ")}`);
    }
  }
  return failures === 0 ? 0 : 1;
}

switch (command) {
  case "generate": {
    const codemods = npmCodemods().filter(
      (codemod) => args.length === 0 || args.includes(codemod.name),
    );
    for (const codemod of codemods) console.log(`Wrote ${generateNpmPatch(root, codemod)}`);
    break;
  }
  case "check":
    process.exit(check());
    break;
  case "apply": {
    const [source, dir] = args;
    if (source === undefined || dir === undefined) {
      console.error("Usage: _patches apply <source> <dir>");
      process.exit(1);
    }
    const applied = applySourceCodemods(source, resolve(dir));
    console.log(`Applied ${applied.length} codemod(s) to ${dir}`);
    break;
  }
  default:
    console.error(`Unknown command "${command ?? ""}". Commands: generate, check, apply`);
    process.exit(1);
}
