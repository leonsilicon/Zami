import type { DocumentPickerAsset } from "expo-document-picker";
import type { ImagePickerAsset } from "expo-image-picker";

/** A picked file as a `File`, with the URI of the file it was read from. */
export type PickedFile = File & { readonly uri: string };

/**
 * An expo-image-picker or expo-document-picker asset as the `File` an
 * `<input type="file">` gives: named, typed and dated like the picked file.
 *
 * Its bytes are read into memory: with Zami's Blob polyfill
 * (@-/com.leonsilicon.zami.blob), `fetch(uri).blob()` gives an in-memory Blob, so the
 * File reads (`arrayBuffer()`, `slice()`, `text()`) as on the web, and XMLHttpRequest
 * uploads it, as matrix-js-sdk does. `uri` is the asset's, for APIs that take a URI
 * (expo-audio, expo-image).
 */
export async function pickedFile(
  asset: ImagePickerAsset | DocumentPickerAsset,
): Promise<PickedFile> {
  const { uri } = asset;
  const name = ("name" in asset ? asset.name : asset.fileName) || uri.split("/").pop() || "file";
  const blob = await (await fetch(uri)).blob();
  const file = new File([blob], name, {
    type: asset.mimeType ?? blob.type,
    lastModified: "lastModified" in asset ? asset.lastModified : undefined,
  });
  return Object.assign(file, { uri });
}
