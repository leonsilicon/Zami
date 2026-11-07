import type { DocumentPickerAsset } from "expo-document-picker";
import { File as FsFile } from "expo-file-system";
import type { ImagePickerAsset } from "expo-image-picker";

/** A picked file as a `File`, with the URI of the file it was read from. */
export type PickedFile = File & { readonly uri: string };

/**
 * An expo-image-picker or expo-document-picker asset as the `File` an
 * `<input type="file">` gives: named, typed and dated like the picked file.
 *
 * It's read into React Native's `File`, which keeps the bytes natively: that's what its
 * XMLHttpRequest uploads, as matrix-js-sdk does. React Native's Blob has no
 * `arrayBuffer()`, so that reads the file through expo-file-system. (`slice()` still
 * gives a Blob that can't be read, so helpers that read part of a file fall back as they
 * do on failure.) `uri` is the asset's, for APIs that take a URI (expo-audio, expo-image).
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
  return Object.assign(file, {
    uri,
    arrayBuffer: () => new FsFile(uri).arrayBuffer(),
  });
}
