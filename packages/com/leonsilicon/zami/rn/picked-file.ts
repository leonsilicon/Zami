import { fileFromUri } from "@-/com.leonsilicon.zami.blob/files";
import type { DocumentPickerAsset } from "expo-document-picker";
import type { ImagePickerAsset } from "expo-image-picker";

/** A picked file as a `File`, with the URI of the file it was read from. */
export type PickedFile = File & { readonly uri: string };

/**
 * An expo-image-picker or expo-document-picker asset as the `File` an
 * `<input type="file">` gives: named, typed and dated like the picked file.
 *
 * Its bytes stay in the file (@-/com.leonsilicon.zami.blob's file-backed `File`): `size`,
 * `type` and `name` are known at once, `slice()` and rebuilding it (Zam's metadata
 * stripping and MP4 faststart) read nothing, reads (`arrayBuffer()`, `text()`) go to the
 * file off the JS thread, `URL.createObjectURL` gives the file's own URI, and
 * XMLHttpRequest (so matrix-js-sdk's uploads) sends it from the file. A 100 MB video
 * never becomes a JS buffer. `uri` is the asset's, for APIs that take a URI (expo-audio,
 * expo-image).
 */
export async function pickedFile(
  asset: ImagePickerAsset | DocumentPickerAsset,
): Promise<PickedFile> {
  const { uri } = asset;
  const name = ("name" in asset ? asset.name : asset.fileName) || uri.split("/").pop() || "file";
  return fileFromUri(uri, {
    name,
    type: asset.mimeType ?? typeForName(name),
    lastModified: "lastModified" in asset ? asset.lastModified : undefined,
    // expo-document-picker's `size`, expo-image-picker's `fileSize`.
    size: (asset as { size?: number }).size ?? (asset as { fileSize?: number }).fileSize,
  });
}

// What a picker that gives no MIME type most often hands over, by extension.
const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/opus",
  wav: "audio/wav",
  flac: "audio/flac",
  mid: "audio/midi",
  midi: "audio/midi",
  pdf: "application/pdf",
  json: "application/json",
  zip: "application/zip",
  txt: "text/plain",
};

/** The type a file named `name` most likely has, or "" (as a browser gives for unknown files). */
function typeForName(name: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return (extension && TYPES[extension]) || "";
}
