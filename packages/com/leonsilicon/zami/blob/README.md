# @-/com.leonsilicon.zami.blob

Blobs for Zam's code and matrix-js-sdk in React Native. React Native's `Blob` is a handle
to bytes its native modules hold: `new Blob([bytes])` throws, and it has no
`arrayBuffer()`, `bytes()` or `text()`. `installBlobPolyfill()` (the app calls it after
React Native's and Expo's globals are set up, before Zam's modules load) fixes both:

- **`Blob` and `File`** build an in-memory blob from any mix of ArrayBuffers, typed arrays,
  DataViews, strings and in-memory blobs, as the File API describes (`size`, `type`,
  `slice`, `name`, `lastModified`). Parts that are all React Native blobs (or strings) still
  make React Native's own blob, as before. A React Native blob mixed with bytes throws
  (nothing does it: responses now come back in memory); read it first.
- **Reading:** in-memory blobs read with `arrayBuffer()`, `bytes()` and `text()`, and so do
  React Native's, through its `FileReader`. `FileReader` reads in-memory blobs too.
  `stream()` isn't provided: Zam only calls it for WebCodecs' `ImageDecoder`, which React
  Native lacks.
- **Sending:** `XMLHttpRequest.send(blob)` sends an in-memory blob's bytes, typed by the
  blob unless a Content-Type was set (matrix-js-sdk uploads this way). Expo's `fetch` reads
  a body Blob with `arrayBuffer()`, and its `response.blob()` builds an in-memory blob
  (it checks that `globalThis.Blob` is no longer React Native's).
- **`URL.createObjectURL(blob)`** writes an in-memory blob to a file under the cache
  directory and returns its `file://` URI, which React Native's Image, expo-image,
  expo-audio, expo-video and `fetch` all load. The file is named for the blob's type
  (AVFoundation picks a format by extension), deleted on `URL.revokeObjectURL`, and the
  directory is emptied the first time in each run. React Native's blobs keep their `blob:`
  URLs, which iOS's expo-image (SDWebImage) can't load.

`instanceof Blob` and `Blob.prototype.isPrototypeOf(blob)` hold for both kinds (React
Native's `Blob.prototype` is given the global one as its prototype); React Native's own
checks still see only its blobs. The patches take the classes from the global scope they
patch, so `patch.ts` and the in-memory blob (`memory.ts`) are tested in Node.
