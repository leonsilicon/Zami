// The Metro dev server a run loads the app's JS from: this checkout's own, on its own port.
import { spawn, type ChildProcess } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Not 8081, so a run never shares the dev server `vpx _dev` starts, which may be serving
 * another checkout or code that's mid-edit.
 */
export const DEFAULT_METRO_PORT = 8091;

export interface MetroStatus {
  running: boolean;
  /** The project Metro serves (its `X-React-Native-Project-Root` header). */
  projectRoot?: string;
}

export async function metroStatus(port: number): Promise<MetroStatus> {
  try {
    const response = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(2000),
    });
    const body = await response.text();
    if (body !== "packager-status:running") return { running: false };
    return {
      running: true,
      projectRoot: response.headers.get("x-react-native-project-root") ?? undefined,
    };
  } catch {
    return { running: false };
  }
}

export class Metro {
  readonly port: number;
  private readonly child: ChildProcess | undefined;

  private constructor(port: number, child: ChildProcess | undefined) {
    this.port = port;
    this.child = child;
  }

  /** Whether this run started the server (and so stops it). */
  get owned(): boolean {
    return this.child !== undefined;
  }

  /**
   * Uses the Metro on `port` if it serves `appDir`, or starts one (`expo start`) that logs to
   * `logPath`. Fails if the port serves another project.
   */
  static async ensure(appDir: string, port: number, logPath: string): Promise<Metro> {
    const status = await metroStatus(port);
    if (status.running) {
      if (status.projectRoot !== appDir) {
        throw new Error(
          `Port ${port} serves ${status.projectRoot ?? "another project"}, not ${appDir}. Pass --port with a free port.`,
        );
      }
      return new Metro(port, undefined);
    }

    const expoCli = createRequire(join(appDir, "package.json")).resolve("expo/bin/cli");
    const log = openSync(logPath, "a");
    // Its own process group, so stopping it also stops the workers it forks.
    const child = spawn(process.execPath, [expoCli, "start", "--port", String(port)], {
      cwd: appDir,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", log, log],
      detached: true,
    });
    const metro = new Metro(port, child);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Metro exited with code ${child.exitCode}:\n${tail(logPath)}`);
      }
      const started = await metroStatus(port);
      if (started.running && started.projectRoot === appDir) return metro;
      await sleep(500);
    }
    metro.stop();
    throw new Error(`Metro didn't start on port ${port} within 2 minutes:\n${tail(logPath)}`);
  }

  /**
   * Bundles the app's JS for `platform` the way the app requests it, so a bundling error
   * fails the run up front with Metro's message, and the first flow doesn't wait for it.
   */
  async prewarm(platform: "ios" | "android", appId: string): Promise<void> {
    const query = new URLSearchParams({
      platform,
      dev: "true",
      lazy: "true",
      minify: "false",
      inlineSourceMap: "false",
      modulesOnly: "false",
      runModule: "true",
      excludeSource: "true",
      sourcePaths: "url-server",
      app: appId,
    });
    const response = await fetch(
      `http://localhost:${this.port}/.expo/.virtual-metro-entry.bundle?${query.toString()}`,
      { signal: AbortSignal.timeout(600_000) },
    );
    const body = await response.text();
    if (!response.ok) {
      let message = body;
      try {
        message = (JSON.parse(body) as { message?: string }).message ?? body;
      } catch {
        // Not Metro's JSON error format: report the body as it is.
      }
      throw new Error(`Metro couldn't bundle the app for ${platform}:\n${message}`);
    }
  }

  stop(): void {
    if (this.child?.pid !== undefined && this.child.exitCode === null) {
      try {
        process.kill(-this.child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }
}

function tail(path: string, lines = 30): string {
  try {
    return readFileSync(path, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "(no output)";
  }
}
