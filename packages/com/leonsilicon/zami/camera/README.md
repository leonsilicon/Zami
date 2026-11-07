# @-/com.leonsilicon.zami.camera

Camera frames for Zam's QR scanning. Zam draws its `<video>`'s frames on a canvas and
hands `getImageData()` to jsQR, which reads a code's raw bytes (`binaryData`). Matrix
verification and QR sign-in codes are binary, and expo-camera's own barcode scanner
reports only text (on iOS, none or lossy text for bytes that aren't valid in the
encoding it guesses), so the scanner reads frames itself:

- `captureJpeg(camera)`: one frame of a running `CameraView`, as JPEG bytes.
  expo-camera gives JavaScript no preview frames, so it's a still (no shutter sound)
  read from its file as bytes; the file is then deleted. Give the view
  `pictureSize={FRAME_PICTURE_SIZE}` (640x480, the width Zam asks `getUserMedia` for)
  and `animateShutter={false}`.
- `jpegImageData(bytes)`: a JPEG's pixels as `getImageData` gives them (`{ data,
  width, height }`, RGBA), decoded in JavaScript (jpeg-js).

```ts
const image = jpegImageData(await captureJpeg(camera));
const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
```
