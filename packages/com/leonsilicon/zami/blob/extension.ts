// AVFoundation (expo-audio, expo-video) picks a file's format by its extension, and
// expo fetch types a file:// response by it, so an object URL's file is named for its type.
const EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["image/jxl", "jxl"],
  ["image/bmp", "bmp"],
  ["image/tiff", "tiff"],
  ["image/svg+xml", "svg"],
  ["image/x-icon", "ico"],
  ["image/vnd.microsoft.icon", "ico"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/aac", "aac"],
  ["audio/ogg", "ogg"],
  ["audio/opus", "opus"],
  ["audio/wav", "wav"],
  ["audio/wave", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/webm", "webm"],
  ["audio/flac", "flac"],
  ["audio/midi", "mid"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
  ["video/ogg", "ogv"],
  ["video/x-matroska", "mkv"],
  ["application/pdf", "pdf"],
  ["application/json", "json"],
  ["application/zip", "zip"],
  ["text/plain", "txt"],
  ["text/html", "html"],
  ["text/css", "css"],
  ["text/csv", "csv"],
  ["text/javascript", "js"],
]);

/**
 * The extension (with its dot) a file holding a blob of `type` gets: the type's, else
 * the extension of the File's `name`, else the type's subtype when it reads like one
 * (`audio/x-foo` gives `.foo`), else none.
 */
export function extensionFor(type: string, name?: string): string {
  const essence = (type.split(";")[0] ?? "").trim().toLowerCase();
  const known = EXTENSIONS.get(essence);
  if (known) return `.${known}`;
  const named = name === undefined ? undefined : /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
  if (named) return `.${named.toLowerCase()}`;
  const subtype = /^[a-z]+\/(?:x-)?([a-z0-9]{1,8})$/.exec(essence)?.[1];
  return subtype ? `.${subtype}` : "";
}
