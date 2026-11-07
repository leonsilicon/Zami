// What an `<a download>` click does in Zam's code: a browser saves the file. iOS has no
// Downloads folder for apps, so the file goes to the share sheet under its name (Save to
// Files, Save Image or Video, AirDrop, …).
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Keeps a suggested name to one safe path segment. */
function safeName(name: string): string {
  return name.replace(/[\\/:]/g, "_").replace(/^\.+/, "_") || "download";
}

/**
 * The name, with the extension of a `file:` source when it has none. Zam adds one from
 * the type of the blob it reads back from an object URL, which expo's `fetch` of a file
 * doesn't always give (on iOS a `file:` response has no headers); the Blob polyfill names
 * an object URL's file for its type, and the share sheet offers Save Image or Video by it.
 */
function withSourceExtension(name: string, href: string): string {
  if (/\.[a-z0-9]{2,5}$/i.test(name) || !href.startsWith("file:")) return name;
  const extension = /\.[a-z0-9]{2,5}$/i.exec(href.split(/[?#]/)[0])?.[0];
  return extension ? `${name}${extension}` : name;
}

/** Saves what `href` points at (a `file:`, `data:`, `blob:` or `http(s):` URL) as `name`. */
export async function shareDownload(href: string, suggested: string): Promise<void> {
  const name = withSourceExtension(suggested, href);
  const saved = new File(Paths.cache, safeName(name));
  if (saved.exists) saved.delete();
  if (href.startsWith("file:")) {
    await new File(href).copy(saved);
  } else if (/^https?:/.test(href)) {
    await File.downloadFileAsync(href, saved);
  } else {
    // data: and React Native's own blob: URLs.
    const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
    saved.create();
    await saved.write(bytes);
  }
  try {
    await Sharing.shareAsync(saved.uri, { dialogTitle: name });
  } finally {
    if (saved.exists) saved.delete();
  }
}
