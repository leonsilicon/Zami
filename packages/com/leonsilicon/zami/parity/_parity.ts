#!/usr/bin/env node
// Compare the Zami app's views with upstream Zam's: `vpx _parity` from anywhere in the repo.
//
//   vpx _parity                       every view in views.ts
//   vpx _parity room settings-*       only these views (a trailing * matches a prefix)
//
//   --build                           build the app from this checkout first
//   --app <path>                      install this simulator build of the app
//   --update-baseline                 record this run's differences as the known ones
//   --strict                          fail on any difference, not only new ones
//   --keep                            leave Metro and the homeserver running afterwards
//   --metro-port, --runner-port, --reference-port, --homeserver-port
import { parseArgs } from "node:util";
import { runParity } from "#run";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    build: { type: "boolean", default: false },
    app: { type: "string" },
    "update-baseline": { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
    "metro-port": { type: "string", default: "8092" },
    "runner-port": { type: "string", default: "8093" },
    "reference-port": { type: "string", default: "8094" },
    "homeserver-port": { type: "string", default: "8018" },
  },
});

function port(name: keyof typeof values): number {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`error: --${name} must be a port number, not ${String(values[name])}`);
    process.exit(2);
  }
  return value;
}

try {
  process.exitCode = await runParity({
    views: positionals,
    metroPort: port("metro-port"),
    runnerPort: port("runner-port"),
    referencePort: port("reference-port"),
    homeserverPort: port("homeserver-port"),
    build: values.build,
    app: values.app,
    updateBaseline: values["update-baseline"],
    strict: values.strict,
    keep: values.keep,
    cwd: process.cwd(),
  });
} catch (error) {
  console.error(`error: ${(error as Error).stack ?? (error as Error).message}`);
  process.exitCode = 1;
}
