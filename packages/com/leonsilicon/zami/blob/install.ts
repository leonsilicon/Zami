import { Directory, File, Paths } from "expo-file-system";
import { cacheFileUrls } from "#object-urls";
import { type BlobHost, patchBlobs } from "#patch";

/** Where object URLs' files go, under the app's cache directory. */
const OBJECT_URL_DIRECTORY = "object-urls";

/**
 * Gives React Native the Blobs Zam's code and matrix-js-sdk use: `new Blob(bytes)` and
 * `new File(bytes, name)` make in-memory blobs; every Blob (React Native's too) reads with
 * `arrayBuffer()`, `bytes()` and `text()`; XMLHttpRequest (so matrix-js-sdk's uploads)
 * and fetch send them; FileReader reads them; and `URL.createObjectURL` gives a `file://`
 * URL of a cache file, which images, audio and video load. Call it before any of Zam's
 * modules load, after React Native's and Expo's globals are set up.
 */
export function installBlobPolyfill(): void {
  patchBlobs(
    globalThis as unknown as BlobHost,
    cacheFileUrls({
      directory: () => new Directory(Paths.cache, OBJECT_URL_DIRECTORY),
      file: (directory, name) => new File(directory, name),
    }),
  );
}
