#!/usr/bin/env node
// Zami replaces one upstream file, the root package.json (Zam's version lives on as
// package.zami.json). .gitattributes gives it `merge=ours`, so merging upstream keeps Zami's; that merge driver only exists
// once git is told about it, per clone.
import { Git } from "#git";

new Git(process.cwd()).run(["config", "merge.ours.driver", "true"]);
