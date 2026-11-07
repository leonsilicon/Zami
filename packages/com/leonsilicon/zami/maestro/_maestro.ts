#!/usr/bin/env node
// Run the Zami app's Maestro flows (apps/zami/.maestro): `vpx _maestro` from anywhere in
// the repo.
//
//   vpx _maestro [ios]                the suite in config.yaml, on the zami-maestro simulator
//   vpx _maestro android              the same on the connected Android emulator or device
//   vpx _maestro ios smoke toasts     only these flows
//
//   --device <udid|name|serial>       another simulator or device
//   --port <port>                     the Metro port (default 8091; started if not running)
//   --build                           build and install the app first
//   --keep-metro                      leave the Metro the run started running
import { parseArgs } from "node:util";
import { DEFAULT_METRO_PORT } from "#metro";
import { runMaestro, type Platform } from "#run";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    device: { type: "string" },
    port: { type: "string" },
    build: { type: "boolean", default: false },
    "keep-metro": { type: "boolean", default: false },
  },
});

const platforms: Platform[] = ["ios", "android"];
const [first, ...rest] = positionals;
const platform = platforms.includes(first as Platform) ? (first as Platform) : "ios";
const flows = platform === first ? rest : positionals;
const metroPort = values.port === undefined ? DEFAULT_METRO_PORT : Number(values.port);
if (!Number.isInteger(metroPort) || metroPort <= 0) {
  console.error(`error: --port must be a port number, not ${values.port}`);
  process.exit(2);
}

try {
  process.exitCode = await runMaestro({
    platform,
    flows,
    device: values.device,
    metroPort,
    build: values.build,
    keepMetro: values["keep-metro"],
    cwd: process.cwd(),
  });
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  process.exitCode = 1;
}
