import type { CameraView } from "expo-camera";
import jsQR from "jsqr";
import { captureJpeg, captureStill, discardStill } from "#capture";
import { jpegImageData } from "#image-data";
import { qrPayloads, type QrCodewords } from "#qr-payload";

/** The native module (ios/ZamiQrModule.swift, android/…/ZamiQrModule.kt). */
export interface NativeQr {
  /** The QR codes in the image at a `file://` URI, read off the JS thread. */
  decodeQrCodes(uri: string): Promise<QrCodewords[]>;
}

/**
 * The native module, if the app has it. It's looked up where Expo puts native modules
 * (`globalThis.expo.modules`), so it needs no React Native import.
 */
export function nativeQr(): NativeQr | null {
  const host = globalThis as { expo?: { modules?: { ZamiQr?: NativeQr } } };
  return host.expo?.modules?.ZamiQr ?? null;
}

/** What one camera frame held. */
export interface QrFrame {
  /** Each QR code's payload (jsQR's `binaryData`: its exact bytes); none, without one. */
  payloads: Uint8Array[];
  /** How long reading it held the JS thread, in milliseconds. */
  busyMs: number;
}

/**
 * The QR codes in one frame of a running `CameraView`. Give the view
 * `pictureSize={FRAME_PICTURE_SIZE}` and `animateShutter={false}`.
 *
 * The frame is a still (`captureStill`) the native module reads off the JS thread, so
 * scanning costs the JS thread next to nothing. In an app built without the module it's
 * decoded in JavaScript as before (jpeg-js and jsQR), which holds the thread about as
 * long again as taking the still does.
 *
 * Rejects when the camera can't take a picture (it isn't ready, or one is already being
 * taken).
 */
export async function scanQrFrame(camera: CameraView): Promise<QrFrame> {
  const native = nativeQr();
  if (!native) {
    const jpeg = await captureJpeg(camera);
    const start = Date.now();
    const image = jpegImageData(jpeg);
    const found = jsQR(image.data, image.width, image.height, {
      inversionAttempts: "dontInvert",
    });
    return {
      payloads: found ? [Uint8Array.from(found.binaryData)] : [],
      busyMs: Date.now() - start,
    };
  }
  const uri = await captureStill(camera);
  try {
    const codes = await native.decodeQrCodes(uri);
    const start = Date.now();
    return { payloads: qrPayloads(codes), busyMs: Date.now() - start };
  } finally {
    discardStill(uri);
  }
}
