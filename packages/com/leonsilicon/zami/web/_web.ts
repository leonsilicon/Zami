#!/usr/bin/env node
// Builds Zam's web app for the Zami app (@-/com.leonsilicon.zami.shell shows it).
//
//   _web build [--force]          build it into apps/zami/.build/web/zami-web (only if
//                                 the upstream files or settings changed)
//   _web serve [--port <port>]    build it, then serve it on localhost for a debug build
//                                 started with EXPO_PUBLIC_ZAMI_WEB_URL=http://localhost:<port>
//   _web path                     print where the built app is
//
// Run from anywhere in the repository.
import { parseArgs } from "node:util";
import { repoRoot } from "@-/com.leonsilicon.zami.paths";
import { buildWeb, defaultOutDir, WEB_DIR_NAME } from "#build";
import { serveWeb } from "#serve";
import { join } from "node:path";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    force: { type: "boolean", default: false },
    port: { type: "string", default: "4173" },
  },
});

const command = positionals[0] ?? "build";
const root = repoRoot();

switch (command) {
  case "build": {
    const result = buildWeb({ root, force: values.force });
    console.log(result.dir);
    break;
  }
  case "serve": {
    const result = buildWeb({ root, force: values.force });
    const port = Number(values.port);
    await serveWeb(result.dir, port);
    console.error(`Serving ${result.dir} on http://localhost:${port}`);
    console.error(
      `Start the app's dev server with EXPO_PUBLIC_ZAMI_WEB_URL=http://localhost:${port}`,
    );
    break;
  }
  case "path":
    console.log(join(defaultOutDir(root), WEB_DIR_NAME));
    break;
  default:
    console.error(`Unknown command "${command}". Commands: build, serve, path`);
    process.exit(1);
}
