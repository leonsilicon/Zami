import { describe, expect, test } from "vite-plus/test";
import { staticFileKey, staticPath, staticType } from "#static-paths";

describe("staticPath", () => {
  test("resolves root-relative and relative paths against the page's origin", () => {
    expect(staticPath("/soundfonts/default.sf3")).toBe("/soundfonts/default.sf3");
    expect(staticPath("sounds/ping.mp3")).toBe("/sounds/ping.mp3");
    expect(staticPath("./sounds/ping.mp3")).toBe("/sounds/ping.mp3");
    expect(staticPath("/sounds/../fonts/inter.woff2?v=2#x")).toBe("/fonts/inter.woff2");
    expect(staticPath("/twemoji/1f600%20x.svg")).toBe("/twemoji/1f600 x.svg");
  });

  test("takes absolute URLs on the page's origin only", () => {
    expect(staticPath("https://zami.invalid/favicon.png")).toBe("/favicon.png");
    expect(staticPath("HTTPS://ZAMI.INVALID/favicon.png")).toBe("/favicon.png");
    expect(staticPath("https://matrix.org/favicon.png")).toBeUndefined();
    expect(staticPath("https://zami.invalid.example/favicon.png")).toBeUndefined();
    expect(staticPath("//cdn.example/favicon.png")).toBeUndefined();
    expect(staticPath("file:///var/mobile/x.ogg")).toBeUndefined();
    expect(staticPath("blob:abc")).toBeUndefined();
    expect(staticPath("data:audio/ogg;base64,AAAA")).toBeUndefined();
  });

  test("isn't the page itself", () => {
    expect(staticPath("/")).toBeUndefined();
    expect(staticPath("https://zami.invalid/")).toBeUndefined();
  });
});

describe("staticFileKey", () => {
  test("names the Zami version as require.context keys it", () => {
    expect(staticFileKey("/sounds/ping.mp3")).toBe("./sounds/ping.zami.mp3");
    expect(staticFileKey("/soundfonts/default.sf3")).toBe("./soundfonts/default.zami.sf3");
    expect(staticFileKey("/ruffle/core.ruffle.16d6.js")).toBe("./ruffle/core.ruffle.16d6.zami.js");
    expect(staticFileKey("/fonts/LICENSE")).toBe("./fonts/LICENSE.zami");
    expect(staticFileKey("/.well-known/x.json")).toBe("./.well-known/x.zami.json");
  });
});

describe("staticType", () => {
  test("types a file by its extension", () => {
    expect(staticType("/sounds/ping.mp3")).toBe("audio/mpeg");
    expect(staticType("/fonts/inter.woff2?v=1")).toBe("font/woff2");
    expect(staticType("/favicon.svg")).toBe("image/svg+xml");
    expect(staticType("/soundfonts/default.sf3")).toBe("application/octet-stream");
  });
});
