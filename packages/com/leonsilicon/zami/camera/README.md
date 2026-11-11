# @-/com.leonsilicon.zami.camera

QR scanning for Zam's scanner. Zam draws its `<video>`'s frames on a canvas and hands
`getImageData()` to jsQR, which reads a code's raw bytes (`binaryData`). Matrix
verification and QR sign-in codes are binary, and expo-camera's own barcode scanner
reports only text (on iOS, none or lossy text for bytes that aren't valid in the
encoding it guesses; expo-camera then drops a code with no text), so the scanner reads
frames itself, off the JS thread:

- `scanQrFrame(camera)`: the QR codes in one frame of a running `CameraView`, as
  `{ payloads, busyMs }`: each code's exact bytes, as jsQR's `binaryData`, and how long
  reading them held the JS thread. expo-camera gives JavaScript no preview frames, so a
  frame is a still (no shutter sound) taken to a file. A native module (`ZamiQr`) reads
  the file's codes off the JS thread, with Vision (and Core Image's detector) on iOS and
  ZXing on Android, and hands over each code's error-corrected data codewords and
  version; `qrPayload` parses those into the payload here, which takes a fraction of a
  millisecond. Give the view `pictureSize={FRAME_PICTURE_SIZE}` (640x480, the width Zam
  asks `getUserMedia` for) and `animateShutter={false}`.
- In an app built without the native module, `scanQrFrame` falls back to what it did
  before: the still's JPEG decoded in JavaScript (`jpegImageData`, jpeg-js) and read by
  jsQR, which holds the JS thread for about as long as taking the still does.
- `qrPayload(codewords, version)`: a QR code's payload from its data codewords (ISO/IEC
  18004's bitstream): byte segments as they are, numeric, alphanumeric and kanji
  segments as their characters' bytes, as jsQR gives them. `__tests__/qr-payload.test.ts`
  holds it up against jsQR on symbols qrcode encodes, in every mode and version range.

```ts
const { payloads } = await scanQrFrame(camera);
const payload = payloads.find(isMatrixQrPayload);
```

The still, its file and the native decode cost the device some work each frame, but none
of it runs on the JS thread; the scanner waits 100 ms after each frame.
