# @-/com.leonsilicon.zami.media

Attachments without their bytes in JS. Zam's media code reads a file into memory, copies
it, encrypts it in WebCrypto, and on the web hands the result to the browser; in React
Native that meant a 100 MB video base64-encoded in JS, several full copies, and a
synchronous file write, all on the JS thread. This package does that work in Swift
(`ios/`) and Kotlin (`android/`) instead, an Expo module named `ZamiMedia`, file to file:

- **Downloads** (`downloadEncryptedMedia`, `downloadPlainMedia`): the HTTP request, with
  the account's token, streams into a file natively. An encrypted attachment's SHA-256 is
  checked and its AES-256-CTR decrypted (WebCrypto's 64-bit counter) as it arrives, into a
  `.part` file that only becomes the cache file once the hash matches. The result is a
  `file://` URI that expo-image, expo-video, expo-audio and the share sheet load. Progress
  arrives as events, at most every 100 ms.
- **The cache**: each signed-in account has a directory under the app's cache directory,
  pruned to 512 MB (least recently used first) once per launch and after every 128 MB.
  A file is named for its attachment (URL, hash, key and IV), so a row scrolled away and
  back, another room, or the next launch shows it at once. One download serves everyone
  asking for the same file; four run at a time, the newest first; a download nobody waits
  for any more is cancelled. `forgetSignedOutMedia` deletes signed-out accounts' files.
- **Uploads** (`encryptForUpload`): a picked file stays a file
  (@-/com.leonsilicon.zami.blob's file-backed `File`), and Zam's metadata stripping and MP4
  faststart rebuild it from slices of the file plus the few bytes they change. This
  encrypts that list of file ranges into a temporary file (a fresh key, an IV whose low 64
  bits are zero, the SHA-256 of the ciphertext) and returns the EncryptedFile exactly as
  Zam's `encryptAttachment` writes it, and the ciphertext as a file-backed `File`, which
  XMLHttpRequest (so matrix-js-sdk's `uploadContent`, with its progress and cancellation)
  sends from the file.
- **JPEG metadata** (`stripJpegMetadata`): Zam's `stripJpeg` (utils/stripMetadata.ts) in
  Swift and Java, byte for byte (checked against Zam's code on 611 generated JPEGs,
  damaged ones included), file to file. Zam's version scans every byte of the image data
  for the next marker, which blocks Hermes for a big photo. Other formats keep Zam's code:
  it walks them box by box, or (MP4, MOV, HEIC) reads only their headers and index.
- **Thumbnails** (`videoThumbnailFor`, `imageThumbnailFor`): a JPEG of a video's frame a
  tenth of the way in (at most 1 s), or of an image (upright), with the picture's size,
  from AVFoundation and ImageIO on iOS and MediaMetadataRetriever and BitmapFactory on
  Android. They give up after a timeout, so a send never waits on one for good.

Without the native module (Node, where the tests run; an app binary built before it was
added) every function returns null and the caller keeps Zam's JS path.
