import { describe, expect, test } from "vite-plus/test";
import { isSandboxPage, parseFrameMessage, RUFFLE_WASM, ruffleFileName } from "#messages";
import { PAGE_HTML, SANDBOX_CSP } from "#page";

describe("ruffleFileName", () => {
  test("names a Zami version in static/ruffle/ as the file Ruffle loads", () => {
    expect(ruffleFileName("./ruffle.zami.js")).toBe("ruffle.js");
    expect(ruffleFileName("./core.ruffle.16d61072ac7fdc4d5013.zami.js")).toBe(
      "core.ruffle.16d61072ac7fdc4d5013.js",
    );
    expect(ruffleFileName("./172de42e6619eac8f371.zami.wasm")).toBe("172de42e6619eac8f371.wasm");
  });

  test("gives wasm names the sandbox may ask for", () => {
    expect(RUFFLE_WASM.test(ruffleFileName("./172de42e6619eac8f371.zami.wasm"))).toBe(true);
    expect(RUFFLE_WASM.test("../172de42e6619eac8f371.wasm")).toBe(false);
    expect(RUFFLE_WASM.test("ruffle.js")).toBe(false);
  });
});

describe("parseFrameMessage", () => {
  test("reads the page's JSON objects", () => {
    expect(parseFrameMessage('{"type":"wasm","id":0,"name":"x.wasm"}')).toEqual({
      type: "wasm",
      id: 0,
      name: "x.wasm",
    });
  });

  test("refuses anything else", () => {
    for (const data of ["", "nope", "null", "[1]", '"ready"', "3"]) {
      expect(parseFrameMessage(data)).toBeNull();
    }
  });
});

describe("isSandboxPage", () => {
  const page = "file:///data/Library/Caches/zami-flash/index.html";

  test("lets the page itself load, however WebKit spells it", () => {
    expect(isSandboxPage(page, page)).toBe(true);
    expect(isSandboxPage(`${page}#x`, page)).toBe(true);
    expect(
      isSandboxPage(
        "file:///data/Library/Caches/zami%20flash/index.html",
        page.replace("zami-flash", "zami flash"),
      ),
    ).toBe(true);
  });

  test("refuses everything else", () => {
    expect(isSandboxPage("https://example.com/", page)).toBe(false);
    expect(isSandboxPage("file:///data/Library/Caches/zami-flash/ruffle/ruffle.js", page)).toBe(
      false,
    );
    expect(isSandboxPage("about:blank", page)).toBe(false);
  });
});

describe("the sandbox page", () => {
  test("takes the network away and loads scripts only from files", () => {
    expect(SANDBOX_CSP).toContain("default-src 'none'");
    expect(SANDBOX_CSP).toContain("connect-src file:;");
    expect(SANDBOX_CSP).toContain("script-src file: 'wasm-unsafe-eval';");
    expect(PAGE_HTML).toContain(`content="${SANDBOX_CSP}"`);
    expect(PAGE_HTML).toContain('<script src="frame.js"></script>');
  });
});
