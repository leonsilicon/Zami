import { describe, expect, test } from "vite-plus/test";
import { ascKeyFromEnv, buildNumber, exportOptions } from "#testflight";

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
  test("uploads to App Store Connect, signed automatically for the team", () => {
    const plist = exportOptions("TEAM123", true);
    expect(plist).toContain("<key>method</key>\n  <string>app-store-connect</string>");
    expect(plist).toContain("<key>destination</key>\n  <string>upload</string>");
    expect(plist).toContain("<key>teamID</key>\n  <string>TEAM123</string>");
    expect(plist).toContain("<key>manageAppVersionAndBuildNumber</key>\n  <false/>");
  });

  test("only exports when not uploading", () => {
    expect(exportOptions("TEAM123", false)).toContain(
      "<key>destination</key>\n  <string>export</string>",
    );
  });
});

describe("ascKeyFromEnv", () => {
  test("needs all three variables", () => {
    expect(() => ascKeyFromEnv({ ASC_KEY_ID: "K", ASC_ISSUER_ID: "I" })).toThrow(/ASC_KEY_PATH/);
    expect(
      ascKeyFromEnv({ ASC_KEY_ID: "K", ASC_ISSUER_ID: "I", ASC_KEY_PATH: "/keys/AuthKey_K.p8" }),
    ).toEqual({ id: "K", issuer: "I", path: "/keys/AuthKey_K.p8" });
  });
});
