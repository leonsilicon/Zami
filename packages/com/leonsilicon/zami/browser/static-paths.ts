// Which URLs name Zam's static files, and where their Zami versions are. On the web, Zam's
// static folder is served at the page's origin; here that origin is
// @-/com.leonsilicon.zami.sveltekit's https://zami.invalid, and a relative URL (Zam's are
// root-relative, such as `/sounds/ping.mp3`) resolves against it.

export const ORIGIN = "https://zami.invalid";

/**
 * The path in Zam's static folder that `url` names (`/sounds/ping.mp3`), or undefined
 * when it names something else: another origin, or another scheme (`file:`, `blob:`).
 */
export function staticPath(url: string): string | undefined {
  let path: string;
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) {
    if (!url.toLowerCase().startsWith(`${ORIGIN}/`)) return undefined;
    path = url.slice(ORIGIN.length);
  } else if (url.startsWith("//")) {
    return undefined;
  } else {
    path = `/${url}`;
  }
  path = path.replace(/[?#].*$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  // The origin's root is the page, not a file.
  return segments.length === 0 ? undefined : `/${segments.join("/")}`;
}

/**
 * The Zami version of the static file at `path`, relative to the static folder, as
 * `require.context` keys it: `/sounds/ping.mp3` → `./sounds/ping.zami.mp3`.
 */
export function staticFileKey(path: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  // A leading dot (`.nojekyll`) starts a name, not an extension.
  const zami = dot > slash + 1 ? `${path.slice(0, dot)}.zami${path.slice(dot)}` : `${path}.zami`;
  return `.${zami}`;
}

const TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  png: "image/png",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  json: "application/json",
  webmanifest: "application/manifest+json",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

/** The Content-Type a web server gives the static file at `url`. */
export function staticType(url: string): string {
  const extension = /\.([a-z\d]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? "";
  return TYPES[extension] ?? "application/octet-stream";
}
