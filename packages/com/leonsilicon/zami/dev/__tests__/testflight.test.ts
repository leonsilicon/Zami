import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  ascKeyFromEnv,
  ascToken,
  buildNumber,
  exportOptions,
  signReleaseManually,
  variantFromArgs,
  type ExportSigning,
} from "#testflight";

const signing: ExportSigning = {
  teamId: "TEAM123",
  bundleId: "com.example.app",
  profileName: "com.example.app App Store (_testflight)",
  identity: "0123456789ABCDEF0123456789ABCDEF01234567",
};

describe("buildNumber", () => {
  test("is the UTC time as YYYYMMDD.HHMM", () => {
    expect(buildNumber(new Date("2026-11-08T03:07:00Z"))).toBe("20261108.0307");
  });

  test("grows with time, as App Store Connect requires", () => {
    const earlier = buildNumber(new Date("2026-11-08T09:59:00Z"));
    const later = buildNumber(new Date("2026-11-08T10:00:00Z"));
    const [a, b] = [earlier, later].map((n) => n.split(".").map(Number));
    expect(a![0] < b![0] || (a![0] === b![0] && a![1]! < b![1]!)).toBe(true);
  });
});

describe("exportOptions", () => {
  test("uploads to App Store Connect with the profile, signed by hand", () => {
    const plist = exportOptions(signing, true);
    expect(plist).toContain("<key>method</key>\n  <string>app-store-connect</string>");
    expect(plist).toContain("<key>destination</key>\n  <string>upload</string>");
    expect(plist).toContain("<key>signingStyle</key>\n  <string>manual</string>");
    expect(plist).toContain(
      `<key>signingCertificate</key>\n  <string>${signing.identity}</string>`,
    );
    expect(plist).toContain(
      "<key>provisioningProfiles</key>\n  <dict>\n    <key>com.example.app</key>\n    <string>com.example.app App Store (_testflight)</string>\n  </dict>",
    );
    expect(plist).toContain("<key>manageAppVersionAndBuildNumber</key>\n  <false/>");
  });

  test("only exports when not uploading", () => {
    expect(exportOptions(signing, false)).toContain(
      "<key>destination</key>\n  <string>export</string>",
    );
  });
});

describe("signReleaseManually", () => {
  const config = (id: string, name: string, bundleId: string, extra = "") =>
    `\t\t${id} /* ${name} */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbaseConfigurationReference = 831DAF395A70C9730BCDAEB9 /* Pods.xcconfig */;\n\t\t\tbuildSettings = {\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n${extra}\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${bundleId};\n\t\t\t\tPRODUCT_NAME = App;\n\t\t\t};\n\t\t\tname = ${name};\n\t\t};\n`;
  const project =
    config("13B07F941A680F5B00A75B9A", "Debug", "com.example.app") +
    config(
      "13B07F951A680F5B00A75B9A",
      "Release",
      "com.example.app",
      '\t\t\t\tDEVELOPMENT_TEAM = OLDTEAM;\n\t\t\t\t"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "iPhone Developer";\n',
    ) +
    config("83CBBA211A601CBA00E9B192", "Release", "com.example.other");

  test("signs only the app's Release configuration", () => {
    const signed = signReleaseManually(project, signing);
    const debug = signed.slice(0, signed.indexOf("13B07F951A680F5B00A75B9A"));
    const release = signed.slice(
      signed.indexOf("13B07F951A680F5B00A75B9A"),
      signed.indexOf("83CBBA21"),
    );
    const other = signed.slice(signed.indexOf("83CBBA21"));
    expect(release).toContain("\t\t\t\tCODE_SIGN_STYLE = Manual;");
    expect(release).toContain("\t\t\t\tDEVELOPMENT_TEAM = TEAM123;");
    expect(release).toContain(`\t\t\t\tCODE_SIGN_IDENTITY = ${signing.identity};`);
    expect(release).toContain(
      '\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "com.example.app App Store (_testflight)";',
    );
    expect(release).not.toContain("OLDTEAM");
    expect(release).not.toContain("iPhone Developer");
    expect(release).toContain("PRODUCT_NAME = App;");
    expect(debug).not.toContain("CODE_SIGN_STYLE");
    expect(other).not.toContain("CODE_SIGN_STYLE");
  });

  test("fails when the app has no Release configuration", () => {
    expect(() =>
      signReleaseManually(project, { ...signing, bundleId: "com.example.none" }),
    ).toThrow(/found 0/);
  });
});

describe("App Store Connect key", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

  test("needs an id, an issuer and the key", () => {
    expect(() => ascKeyFromEnv({ ASC_KEY_ID: "K", ASC_ISSUER_ID: "I" })).toThrow(/ASC_KEY_P8/);
    expect(
      ascKeyFromEnv({ ASC_KEY_ID: "K", ASC_ISSUER_ID: "I", ASC_KEY_PATH: "/keys/AuthKey_K.p8" }),
    ).toEqual({ id: "K", issuer: "I", path: "/keys/AuthKey_K.p8" });
  });

  test("takes the key's contents, as CI passes it, into a private file", () => {
    const key = ascKeyFromEnv({ ASC_KEY_ID: "K", ASC_ISSUER_ID: "I", ASC_KEY_P8: pem });
    expect(key.path).toMatch(/AuthKey_K\.p8$/);
    expect(readFileSync(key.path, "utf8")).toBe(pem);
  });

  test("signs ES256 tokens App Store Connect accepts", () => {
    const path = join(mkdtempSync(join(tmpdir(), "asc-test-")), "AuthKey_K.p8");
    writeFileSync(path, pem);
    const token = ascToken({ id: "K", issuer: "I", path }, Date.UTC(2026, 10, 8));
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "K",
      typ: "JWT",
    });
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    expect(claims).toMatchObject({ iss: "I", aud: "appstoreconnect-v1" });
    expect(claims.exp - claims.iat).toBe(1200);
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });
});

describe("variantFromArgs", () => {
  test("builds the app Zami unless asked for another variant", () => {
    expect(variantFromArgs([])).toBe("production");
    expect(variantFromArgs(["--export-only"])).toBe("production");
    expect(variantFromArgs(["--variant", "staging"])).toBe("staging");
  });

  test("refuses a variant the app doesn't have", () => {
    expect(() => variantFromArgs(["--variant", "beta"])).toThrow(/production, staging/);
    expect(() => variantFromArgs(["--variant"])).toThrow(/not undefined/);
  });
});
