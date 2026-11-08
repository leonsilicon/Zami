// The run's own homeserver: a fresh Synapse in Docker, so both apps see exactly the seeded
// content and nothing a developer's own test server has accumulated.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const CONTAINER = "zami-parity-synapse";
const IMAGE = "matrixdotorg/synapse:latest";

/** No rate limits (seeding sends fast), no presence or URL previews (they'd vary between runs). */
const CONFIG = `
# Added by @-/com.leonsilicon.zami.parity.
enable_registration: true
enable_registration_without_verification: true
presence:
  enabled: false
url_preview_enabled: false
rc_message: { per_second: 10000, burst_count: 10000 }
rc_registration: { per_second: 10000, burst_count: 10000 }
rc_login:
  address: { per_second: 10000, burst_count: 10000 }
  account: { per_second: 10000, burst_count: 10000 }
  failed_attempts: { per_second: 10000, burst_count: 10000 }
rc_joins:
  local: { per_second: 10000, burst_count: 10000 }
  remote: { per_second: 10000, burst_count: 10000 }
rc_invites:
  per_room: { per_second: 10000, burst_count: 10000 }
  per_user: { per_second: 10000, burst_count: 10000 }
  per_issuer: { per_second: 10000, burst_count: 10000 }
rc_room_creation: { per_second: 10000, burst_count: 10000 }
rc_3pid_validation: { per_second: 10000, burst_count: 10000 }
`;

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function stopSynapse(): void {
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
}

/** Starts a new homeserver (`server_name` localhost) on `port`; resolves with its URL. */
export async function startSynapse(port: number, dataDir: string): Promise<string> {
  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    throw new Error("Docker isn't running: the parity run needs it for its homeserver");
  }
  stopSynapse();
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const owner = [
    "-e",
    `UID=${process.getuid?.() ?? 991}`,
    "-e",
    `GID=${process.getgid?.() ?? 991}`,
  ];
  docker([
    "run",
    "--rm",
    "-v",
    `${dataDir}:/data`,
    ...owner,
    "-e",
    "SYNAPSE_SERVER_NAME=localhost",
    "-e",
    "SYNAPSE_REPORT_STATS=no",
    IMAGE,
    "generate",
  ]);
  appendFileSync(
    join(dataDir, "homeserver.yaml"),
    `${CONFIG}public_baseurl: http://localhost:${port}/\n`,
  );
  docker([
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-v",
    `${dataDir}:/data`,
    ...owner,
    "-p",
    `${port}:8008`,
    IMAGE,
  ]);

  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return url;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  const logs = spawnSync("docker", ["logs", "--tail", "40", CONTAINER], { encoding: "utf8" });
  throw new Error(`Synapse didn't start within 90 s:\n${logs.stdout}${logs.stderr}`);
}
