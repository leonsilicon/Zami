import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { Git } from "@-/com.leonsilicon.zami.ports";

/** An App Store Connect API key: what xcodebuild signs and uploads with. */
export interface AscKey {
  id: string;
  issuer: string;
  /** The key's .p8 file. */
  path: string;
}

/** The key in ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH. */
export function ascKeyFromEnv(env: Record<string, string | undefined> = process.env): AscKey {
  const { ASC_KEY_ID: id, ASC_ISSUER_ID: issuer, ASC_KEY_PATH: path } = env;
  if (!id || !issuer || !path) {
    throw new Error("Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (the key's .p8 file)");
  }
  return { id, issuer, path: resolve(path) };
}

/** A build number that only grows: the time, as YYYYMMDD.HHMM (UTC). */
export function buildNumber(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  return `${date}.${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
}

/** The plist xcodebuild exports and uploads with. */
export function exportOptions(teamId: string, upload: boolean): string {
  const entries: Record<string, string | boolean> = {
    method: "app-store-connect",
    destination: upload ? "upload" : "export",
    teamID: teamId,
    signingStyle: "automatic",
    manageAppVersionAndBuildNumber: false,
    uploadSymbols: true,
  };
  const body = Object.entries(entries)
    .map(([key, value]) =>
      typeof value === "boolean"
        ? `  <key>${key}</key>\n  <${value}/>`
        : `  <key>${key}</key>\n  <string>${value}</string>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
}

function run(command: string, args: string[], cwd: string): void {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

/**
 * Builds the app for the App Store and uploads it to TestFlight. Signing is automatic:
 * xcodebuild uses the API key to create the provisioning profiles it needs, with the
 * team's distribution certificate from this Mac's keychain.
 */
export function runTestflight(options: { key: AscKey; upload: boolean; cwd?: string }): void {
  const appDir = join(new Git(options.cwd ?? process.cwd()).root, "apps/zami");
  const iosDir = join(appDir, "ios");
  const outDir = join(appDir, ".build", "testflight");
  const archive = join(outDir, "Zami.xcarchive");
  const app = createRequire(join(appDir, "package.json"))("./app.json") as {
    expo: { ios: { appleTeamId: string } };
  };
  const teamId = app.expo.ios.appleTeamId;
  const auth = [
    "-allowProvisioningUpdates",
    "-authenticationKeyPath",
    options.key.path,
    "-authenticationKeyID",
    options.key.id,
    "-authenticationKeyIssuerID",
    options.key.issuer,
  ];

  const expoCli = createRequire(join(appDir, "package.json")).resolve("expo/bin/cli");
  run(process.execPath, [expoCli, "prebuild", "--platform", "ios"], appDir);

  const version = buildNumber();
  run(
    "/usr/libexec/PlistBuddy",
    ["-c", `Set :CFBundleVersion ${version}`, join(iosDir, "Zami", "Info.plist")],
    appDir,
  );

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  run(
    "xcrun",
    [
      "xcodebuild",
      "-workspace",
      "Zami.xcworkspace",
      "-scheme",
      "Zami",
      "-configuration",
      "Release",
      "-destination",
      "generic/platform=iOS",
      "-archivePath",
      archive,
      ...auth,
      "archive",
    ],
    iosDir,
  );

  const plist = join(outDir, "ExportOptions.plist");
  writeFileSync(plist, exportOptions(teamId, options.upload));
  run(
    "xcrun",
    [
      "xcodebuild",
      "-exportArchive",
      "-archivePath",
      archive,
      "-exportPath",
      join(outDir, "export"),
      "-exportOptionsPlist",
      plist,
      ...auth,
    ],
    iosDir,
  );
  console.log(
    options.upload
      ? `\nUploaded build ${version}. It appears in TestFlight once App Store Connect has processed it.`
      : `\nExported build ${version} to ${join(outDir, "export")}.`,
  );
}
