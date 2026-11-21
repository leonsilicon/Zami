// A static server for the built web app, for debug builds of the Zami app that load it
// from this machine instead of their bundle (EXPO_PUBLIC_ZAMI_WEB_URL): no native rebuild
// to try a new build. Paths that aren't files get index.html, as SvelteKit's static
// adapter expects (`fallback: "index.html"`).
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
};

export function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Serves `dir` on `host:port` until the returned server is closed. */
export function serveWeb(dir: string, port: number, host = "127.0.0.1"): Promise<Server> {
  const root = resolve(dir);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    let file = join(root, relative);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      const index = join(file, "index.html");
      file =
        file.startsWith(root) && existsSync(index) && statSync(index).isFile()
          ? index
          : join(root, "index.html");
    }
    response.writeHead(200, {
      "Content-Type": contentType(file),
      "Cache-Control": "no-cache",
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolvePromise(server));
  });
}
