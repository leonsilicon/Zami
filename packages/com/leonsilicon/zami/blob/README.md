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
- **Files on disk** are Blobs too, without being read: `fileFromUri(uri, { name, type })`
  (what `pickedFile` gives) is a `File` of segments, each a range of a file or bytes in
  memory. `slice()` and rebuilding (`new File([file.slice(0, n), bytes, file.slice(m)])`,
  as Zam's metadata stripping and MP4 faststart do) make new lists without reading, and
  reads go to the files off the JS thread, so a 100 MB video's box headers and index are
  all that ever reach JS. `fileSegments`/`segmentsFile` hand them to native code as files.
- **Reading:** in-memory blobs read with `arrayBuffer()`, `bytes()` and `text()`, and so do
  React Native's, through its `FileReader`, and file-backed ones, from their files.
  `FileReader` reads all three. `stream()` isn't provided: Zam only calls it for WebCodecs'
  `ImageDecoder`, which React Native lacks.
- **Sending:** `XMLHttpRequest.send(blob)` sends an in-memory blob's bytes, typed by the
  blob unless a Content-Type was set (matrix-js-sdk uploads this way). A file-backed blob
  that is all of one file goes as `{ uri }`, which React Native's networking reads
  natively; a rebuilt one, or an in-memory one of 256 KB or more (which React Native
  would base64-encode in JS), is first written to a temporary file off the JS thread.
  Expo's `fetch` reads a body Blob with `arrayBuffer()`, and its `response.blob()` builds
  an in-memory blob (it checks that `globalThis.Blob` is no longer React Native's).
- **`URL.createObjectURL(blob)`** writes an in-memory blob to a file under the cache
  directory and returns its `file://` URI, which React Native's Image, expo-image,
  expo-audio, expo-video and `fetch` all load. The file is named for the blob's type
  (AVFoundation picks a format by extension), deleted on `URL.revokeObjectURL`, and the
  directory is emptied the first time in each run. A file-backed blob that is all of one
  file gives that file's own URI (revoking it does nothing). `createObjectURLAsync(blob)`
  writes a big in-memory blob off the JS thread instead. React Native's blobs keep their
  `blob:` URLs, which iOS's expo-image (SDWebImage) can't load.

File I/O goes through Zami's media module (@-/com.leonsilicon.zami.media) when the app
has it, and expo-file-system's handles otherwise. `+files.ts` (`/files`) exports the
file-backed blobs without the installer, so Zam's code can use them in its jsdom tests.

`instanceof Blob` and `Blob.prototype.isPrototypeOf(blob)` hold for all kinds (React
Native's `Blob.prototype` is given the global one as its prototype); React Native's own
checks still see only its blobs. The patches take the classes from the global scope they
patch, and file access is set with `setFileIo`, so `patch.ts`, the in-memory blob
(`memory.ts`) and the file-backed one (`parts.ts`) are tested in Node.
