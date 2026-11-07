#!/usr/bin/env node
// Zami replaces two upstream files at the repository root, package.json and vite.config.ts
// (Zam's versions live on as package.expo.json and vite.config.expo.ts). .gitattributes
// gives them `merge=ours`, so merging upstream keeps Zami's; that merge driver only exists
// once git is told about it, per clone.
import { Git } from "#git";

new Git(process.cwd()).run(["config", "merge.ours.driver", "true"]);
