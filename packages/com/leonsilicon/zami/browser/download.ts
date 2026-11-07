// What an `<a download>` click does in Zam's code: a browser saves the file. iOS has no
// Downloads folder for apps, so the file goes to the share sheet under its name (Save to
// Files, Save Image or Video, AirDrop, …).
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Keeps a suggested name to one safe path segment. */
function safeName(name: string): string {
  return name.replace(/[\\/:]/g, "_").replace(/^\.+/, "_") || "download";
}

/** Saves what `href` points at (a `file:`, `data:`, `blob:` or `http(s):` URL) as `name`. */
export async function shareDownload(href: string, name: string): Promise<void> {
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
