/// <reference types="expo/types" />
// `fetch` for Zam's code. On the web, Zam fetches its own static files by path
// (`fetch("/soundfonts/default.sf3")`), which resolve against the page's origin. Here the
// page's origin is https://zami.invalid, and those paths come from the app's bundled
// copies of Zam's static folder: the Zami versions (`static/sounds/ping.zami.mp3` for
// `/sounds/ping.mp3`), bundled as assets. Anything else is React Native's fetch.
import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { staticFileKey, staticPath, staticType } from "#static-paths";

/**
 * Zam's static files, as asset modules keyed `./sounds/ping.zami.mp3`. Left out: the
 * Twemoji images (iOS draws emoji itself; 4,000 files), and Ruffle and its sandbox (Flash
 * needs WebAssembly). The extensions must be Metro asset extensions (`sf3` is added in
 * @-/com.leonsilicon.zami.metro).
 */
const STATIC_FILES = require.context(
  "../../../../../static",
  true,
  /^\.\/(?!twemoji\/|ruffle\/|flash-sandbox\/).*\.zami\.(?:mp3|ogg|wav|png|svg|woff2|sf3)$/,
);

const localUris = new Map<string, Promise<string>>();

/**
 * The local `file://` URI of Zam's static file at `url` (a path, or a URL on the page's
 * origin): undefined when `url` isn't one of Zam's static paths, null when the app has no
 * such file.
 */
export function staticFileUri(url: string): Promise<string | null> | undefined {
  const path = staticPath(url);
  if (path === undefined) return undefined;
  const key = staticFileKey(path);
  if (!STATIC_FILES.keys().includes(key)) return Promise.resolve(null);
  let uri = localUris.get(key);
  if (uri === undefined) {
    uri = Asset.fromModule(STATIC_FILES(key) as number)
      .downloadAsync()
      .then((asset) => {
        if (!asset.localUri) throw new Error(`Zami: couldn't load ${path}`);
        return asset.localUri;
      });
    // A failed load (Metro unreachable in development) is tried again next time.
    uri.catch(() => localUris.delete(key));
    localUris.set(key, uri);
  }
  return uri;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** A static file as the web server would answer: its bytes, typed, or a 404. */
async function staticResponse(url: string, uri: string | null, method: string): Promise<Response> {
  if (uri === null) {
    return new Response(null, { status: 404, statusText: "Not Found" });
  }
  const bytes = method === "HEAD" ? null : await new File(uri).arrayBuffer();
  const headers: Record<string, string> = {
    "Content-Type": staticType(url),
  };
  if (bytes) headers["Content-Length"] = String(bytes.byteLength);
  return new Response(bytes, { status: 200, statusText: "OK", headers });
}

export const zamiFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input);
  const uri = staticFileUri(url);
  if (uri === undefined) return fetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  return staticResponse(url, await uri, method);
};
