import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Git } from "@-/com.leonsilicon.zami.ports";

/** An App Store Connect API key: what the script and xcodebuild authenticate with. */
export interface AscKey {
  id: string;
  issuer: string;
  /** The key's .p8 file. */
  path: string;
}

/**
 * The key in ASC_KEY_ID and ASC_ISSUER_ID, with the .p8 file in ASC_KEY_PATH or its
 * contents in ASC_KEY_P8 (as CI passes it; it's written to a private temporary file).
 */
export function ascKeyFromEnv(env: Record<string, string | undefined> = process.env): AscKey {
  const { ASC_KEY_ID: id, ASC_ISSUER_ID: issuer, ASC_KEY_PATH: path, ASC_KEY_P8: p8 } = env;
  if (!id || !issuer || !(path || p8)) {
    throw new Error(
      "Set ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_PATH (the key's .p8 file) or ASC_KEY_P8 (its contents)",
    );
  }
  if (path) return { id, issuer, path: resolve(path) };
  const dir = mkdtempSync(join(tmpdir(), "asc-key-"));
  const keyPath = join(dir, `AuthKey_${id}.p8`);
  writeFileSync(keyPath, p8!, { mode: 0o600 });
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return { id, issuer, path: keyPath };
}

/** A build number that only grows: the time, as YYYYMMDD.HHMM (UTC). */
export function buildNumber(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  return `${date}.${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
}

type PlistValue = string | boolean | { [key: string]: PlistValue };

function plistValue(value: PlistValue, indent: string): string {
  if (typeof value === "boolean") return `${indent}<${value}/>`;
  if (typeof value === "string") return `${indent}<string>${value}</string>`;
  const entries = Object.entries(value)
    .map(([key, inner]) => `${indent}  <key>${key}</key>\n${plistValue(inner, `${indent}  `)}`)
    .join("\n");
  return `${indent}<dict>\n${entries}\n${indent}</dict>`;
}

/** What xcodebuild exports (and uploads) with: the App Store profile, signed by hand. */
export interface ExportSigning {
  teamId: string;
  bundleId: string;
  profileName: string;
  /** The signing identity's SHA-1. */
  identity: string;
}

/** The plist xcodebuild exports and uploads with. */
export function exportOptions(signing: ExportSigning, upload: boolean): string {
  const options: PlistValue = {
    method: "app-store-connect",
    destination: upload ? "upload" : "export",
    teamID: signing.teamId,
    signingStyle: "manual",
    signingCertificate: signing.identity,
    provisioningProfiles: { [signing.bundleId]: signing.profileName },
    manageAppVersionAndBuildNumber: false,
    uploadSymbols: true,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${plistValue(options, "")}
</plist>
`;
}

function quote(value: string): string {
  return /^[A-Za-z0-9_./$]+$/.test(value) ? value : `"${value}"`;
}

/**
 * The Xcode project with the app target's Release configuration signed by hand: the
 * given identity and App Store profile. Only that target: the Pods targets don't sign,
 * and a profile named for every target fails their build.
 */
export function signReleaseManually(pbxproj: string, signing: ExportSigning): string {
  const settings: Record<string, string> = {
    CODE_SIGN_STYLE: "Manual",
    DEVELOPMENT_TEAM: signing.teamId,
    CODE_SIGN_IDENTITY: signing.identity,
    PROVISIONING_PROFILE_SPECIFIER: signing.profileName,
  };
  let signed = 0;
  const result = pbxproj.replace(
    /(\/\* Release \*\/ = \{\n\t+isa = XCBuildConfiguration;\n(?:\t+[^\n]*\n)*?(\t+)buildSettings = \{\n)([\s\S]*?)(\n\t+\};\n\t+name = Release;)/g,
    (block, head: string, indent: string, body: string, tail: string) => {
      if (!body.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${signing.bundleId};`)) return block;
      signed++;
      const lines = body
        .split("\n")
        .filter(
          (line) =>
            !Object.keys(settings).some((key) =>
              new RegExp(`^\\t+"?${key}(\\[[^\\]]*\\])?"? = `).test(line),
            ),
        );
      for (const [key, value] of Object.entries(settings)) {
        lines.push(`${indent}\t${key} = ${quote(value)};`);
      }
      return head + lines.join("\n") + tail;
    },
  );
  if (signed !== 1) {
    throw new Error(`Expected one Release configuration for ${signing.bundleId}, found ${signed}`);
  }
  return result;
}

function base64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

/** A token for the App Store Connect API, valid for 20 minutes. */
export function ascToken(key: AscKey, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: key.id, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: key.issuer, iat, exp: iat + 1200, aud: "appstoreconnect-v1" }),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(readFileSync(key.path)),
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${base64url(signature)}`;
}

interface Resource<A> {
  id: string;
  attributes: A;
}

async function asc<T>(key: AscKey, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { authorization: `Bearer ${ascToken(key)}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`App Store Connect: ${method} ${path}: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

type Certificate = Resource<{ certificateContent: string; displayName: string }>;
type Profile = Resource<{
  name: string;
  uuid: string;
  profileState: string;
  profileContent: string;
}>;

/** The SHA-1 of every valid code-signing identity in the keychain search list. */
function keychainIdentities(): Set<string> {
  const output = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
  return new Set([...output.matchAll(/^\s*\d+\) ([0-9A-F]{40}) /gm)].map((match) => match[1]!));
}

/**
 * The bundle ID's resource, registered (with push notifications, which the app's
 * entitlements ask for) if the team doesn't have it yet, as for a new variant.
 */
async function registeredBundleId(
  key: AscKey,
  bundleId: string,
  appName: string,
): Promise<Resource<unknown>> {
  const bundleIds = await asc<{ data: Resource<{ identifier: string }>[] }>(
    key,
    "GET",
    `/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundleId)}&limit=50`,
  );
  const existing = bundleIds.data.find((candidate) => candidate.attributes.identifier === bundleId);
  if (existing) return existing;
  const created = (
    await asc<{ data: Resource<unknown> }>(key, "POST", "/v1/bundleIds", {
      data: {
        type: "bundleIds",
        // Apple takes only letters, digits and spaces in the name.
        attributes: {
          identifier: bundleId,
          name: appName.replace(/[^A-Za-z0-9 ]/g, "").trim() || "App",
          platform: "IOS",
        },
      },
    })
  ).data;
  await asc(key, "POST", "/v1/bundleIdCapabilities", {
    data: {
      type: "bundleIdCapabilities",
      attributes: { capabilityType: "PUSH_NOTIFICATIONS" },
      relationships: { bundleId: { data: { type: "bundleIds", id: created.id } } },
    },
  });
  console.log(`Registered the bundle ID ${bundleId}`);
  return created;
}

/** The App Store Connect app for the bundle ID, which Apple's API can't create. */
async function appRecord(key: AscKey, bundleId: string): Promise<Resource<{ name: string }>> {
  const apps = await asc<{ data: Resource<{ name: string; bundleId: string }>[] }>(
    key,
    "GET",
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name,bundleId`,
  );
  const app = apps.data.find((candidate) => candidate.attributes.bundleId === bundleId);
  if (!app) {
    throw new Error(
      `App Store Connect has no app for ${bundleId}, and its API can't create one. Create it ` +
        "in App Store Connect, or let Xcode do it: open an archive of the app (" +
        "`vpx _testflight --export-only`) in Xcode's Organizer and choose Distribute App.",
    );
  }
  return app;
}

/**
 * The team's App Store profile for the app, created or renewed when it's missing,
 * invalid or lacks one of the team's distribution certificates, and installed where
 * Xcode looks. Returns it with a distribution identity this Mac can sign with.
 */
export async function appStoreSigning(
  key: AscKey,
  teamId: string,
  bundleId: string,
  appName = bundleId,
): Promise<ExportSigning> {
  const profileName = `${bundleId} App Store (_testflight)`;
  const certificates = (
    await asc<{ data: Certificate[] }>(
      key,
      "GET",
      "/v1/certificates?filter[certificateType]=IOS_DISTRIBUTION,DISTRIBUTION&limit=200",
    )
  ).data;
  const sha1 = (certificate: Certificate) =>
    createHash("sha1")
      .update(Buffer.from(certificate.attributes.certificateContent, "base64"))
      .digest("hex")
      .toUpperCase();
  const local = keychainIdentities();
  const identity = certificates.map(sha1).find((hash) => local.has(hash));
  if (!identity) {
    throw new Error(
      `No distribution certificate of team ${teamId} is in the keychain (the team has ${certificates.length})`,
    );
  }

  const existing = await asc<{ data: Profile[]; included?: Certificate[] }>(
    key,
    "GET",
    `/v1/profiles?filter[name]=${encodeURIComponent(profileName)}&include=certificates&limit=10`,
  );
  let profile = existing.data.find((candidate) => candidate.attributes.name === profileName);
  const covered = new Set(existing.included?.map((certificate) => certificate.id));
  if (
    profile &&
    (profile.attributes.profileState !== "ACTIVE" ||
      certificates.some((certificate) => !covered.has(certificate.id)))
  ) {
    await asc(key, "DELETE", `/v1/profiles/${profile.id}`);
    profile = undefined;
  }
  if (!profile) {
    const bundle = await registeredBundleId(key, bundleId, appName);
    profile = (
      await asc<{ data: Profile }>(key, "POST", "/v1/profiles", {
        data: {
          type: "profiles",
          attributes: { name: profileName, profileType: "IOS_APP_STORE" },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: bundle.id } },
            certificates: {
              data: certificates.map((certificate) => ({
                type: "certificates",
                id: certificate.id,
              })),
            },
          },
        },
      })
    ).data;
  }

  const content = Buffer.from(profile.attributes.profileContent, "base64");
  for (const dir of [
    join(homedir(), "Library/MobileDevice/Provisioning Profiles"),
    join(homedir(), "Library/Developer/Xcode/UserData/Provisioning Profiles"),
  ]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${profile.attributes.uuid}.mobileprovision`), content);
  }
  return { teamId, bundleId, profileName, identity };
}

function run(command: string, args: string[], cwd: string, env = process.env): void {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

/** The app's variants (apps/zami/app.config.ts): the app "Zami", and "(S) Zami". */
export const VARIANTS = ["production", "staging"] as const;
export type Variant = (typeof VARIANTS)[number];

export function variantFromArgs(args: string[]): Variant {
  const index = args.indexOf("--variant");
  if (index === -1) return "production";
  const value = args[index + 1];
  if (!VARIANTS.includes(value as Variant)) {
    throw new Error(`--variant must be one of ${VARIANTS.join(", ")}, not ${value}`);
  }
  return value as Variant;
}

/**
 * Builds the variant for the App Store and uploads it to TestFlight, signed by hand
 * with a distribution certificate from the keychain and the App Store profile the API
 * key keeps current, so it needs no Xcode account or development certificate (as on CI).
 * Returns the build number.
 */
export async function runTestflight(options: {
  key: AscKey;
  upload: boolean;
  variant?: Variant;
  cwd?: string;
}): Promise<string> {
  const appDir = join(new Git(options.cwd ?? process.cwd()).root, "apps/zami");
  const iosDir = join(appDir, "ios");
  const outDir = join(appDir, ".build", "testflight");
  const archive = join(outDir, "Zami.xcarchive");
  const env = {
    ...process.env,
    ZAMI_VARIANT: options.variant ?? "production",
    EXPO_NO_GIT_STATUS: "1",
  };
  const expoCli = createRequire(join(appDir, "package.json")).resolve("expo/bin/cli");
  const config = JSON.parse(
    execFileSync(process.execPath, [expoCli, "config", "--json", "--type", "public"], {
      cwd: appDir,
      env,
      encoding: "utf8",
    }),
  ) as { name: string; ios: { appleTeamId: string; bundleIdentifier: string } };
  const { appleTeamId: teamId, bundleIdentifier: bundleId } = config.ios;
  console.log(`Building ${config.name} (${bundleId})`);
  if (options.upload) await appRecord(options.key, bundleId);

  try {
    const signing = await appStoreSigning(options.key, teamId, bundleId, config.name);
    console.log(`Signing with ${signing.identity} and the profile "${signing.profileName}"`);

    // --clean: the generated project is the variant's alone (its bundle ID, name, schemes).
    run(process.execPath, [expoCli, "prebuild", "--platform", "ios", "--clean"], appDir, env);
    // Expo names the project after the app: "Zami", or "SZami" for "(S) Zami".
    const workspace = readdirSync(iosDir).find((file) => file.endsWith(".xcworkspace"));
    if (!workspace) throw new Error(`expo prebuild made no Xcode workspace in ${iosDir}`);
    const project = workspace.slice(0, -".xcworkspace".length);
    const pbxproj = join(iosDir, `${project}.xcodeproj`, "project.pbxproj");
    writeFileSync(pbxproj, signReleaseManually(readFileSync(pbxproj, "utf8"), signing));

    const version = buildNumber();
    run(
      "/usr/libexec/PlistBuddy",
      ["-c", `Set :CFBundleVersion ${version}`, join(iosDir, project, "Info.plist")],
      appDir,
    );

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    run(
      "xcrun",
      [
        "xcodebuild",
        "-workspace",
        workspace,
        "-scheme",
        project,
        "-configuration",
        "Release",
        "-destination",
        "generic/platform=iOS",
        "-archivePath",
        archive,
        "archive",
      ],
      iosDir,
      env,
    );

    const plist = join(outDir, "ExportOptions.plist");
    writeFileSync(plist, exportOptions(signing, options.upload));
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
        "-authenticationKeyPath",
        options.key.path,
        "-authenticationKeyID",
        options.key.id,
        "-authenticationKeyIssuerID",
        options.key.issuer,
      ],
      iosDir,
    );
    console.log(
      options.upload
        ? `\nUploaded build ${version}. It appears in TestFlight once App Store Connect has processed it.`
        : `\nExported build ${version} to ${join(outDir, "export")}.`,
    );
    return version;
  } finally {
    // Leave the generated project as the app "Zami", which `vpx _dev` and the Maestro
    // flows build; its pods install on their next build.
    if (env.ZAMI_VARIANT !== "production") {
      run(
        process.execPath,
        [expoCli, "prebuild", "--platform", "ios", "--clean", "--no-install"],
        appDir,
        { ...process.env, ZAMI_VARIANT: "production", EXPO_NO_GIT_STATUS: "1" },
      );
    }
  }
}
