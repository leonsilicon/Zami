import { encode } from "jpeg-js";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { describe, expect, test } from "vite-plus/test";
import { jpegImageData } from "#image-data";

const WIDTH = 640;
const HEIGHT = 480;

/** A Matrix verification payload's shape: "MATRIX", version, mode, transaction, two keys, a secret. */
function verificationPayload(): Uint8Array {
  const transaction = new TextEncoder().encode("txn-0123456789");
  const head = [0x4d, 0x41, 0x54, 0x52, 0x49, 0x58, 0x02, 0x00, 0x00, transaction.length];
  // Every byte value turns up, so nothing in the pipeline can get away with text.
  const binary = Array.from({ length: 32 + 32 + 16 }, (_, i) => (i * 73 + 0xf1) % 256);
  return Uint8Array.from([...head, ...transaction, ...binary]);
}

/**
 * A camera frame showing `bytes` as a QR code: dark modules on a light card in the
 * middle of a mid-grey scene, `scale` pixels a module, as RGBA rows.
 */
function frameShowing(bytes: Uint8Array, scale: number): Uint8Array {
  const { modules } = QRCode.create([{ data: bytes, mode: "byte" }], {
    errorCorrectionLevel: "M",
  });
  const quiet = 4;
  const side = (modules.size + quiet * 2) * scale;
  const left = Math.floor((WIDTH - side) / 2);
  const top = Math.floor((HEIGHT - side) / 2);
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const cx = x - left;
      const cy = y - top;
      let value = 120 + ((x * 7 + y * 13) % 17);
      if (cx >= 0 && cy >= 0 && cx < side && cy < side) {
        const col = Math.floor(cx / scale) - quiet;
        const row = Math.floor(cy / scale) - quiet;
        const inSymbol = col >= 0 && row >= 0 && col < modules.size && row < modules.size;
        value = inSymbol && modules.get(row, col) ? 20 : 235;
      }
      const at = (y * WIDTH + x) * 4;
      rgba[at] = value;
      rgba[at + 1] = value;
      rgba[at + 2] = value;
      rgba[at + 3] = 255;
    }
  }
  return rgba;
}

function jpeg(rgba: Uint8Array, quality = 50): Uint8Array {
  return new Uint8Array(encode({ data: rgba, width: WIDTH, height: HEIGHT }, quality).data);
}

describe("jpegImageData", () => {
  test("gives RGBA ImageData of the JPEG's size", () => {
    const image = jpegImageData(jpeg(frameShowing(verificationPayload(), 4)));
    expect(image.width).toBe(WIDTH);
    expect(image.height).toBe(HEIGHT);
    expect(image.data).toBeInstanceOf(Uint8ClampedArray);
    expect(image.data.length).toBe(WIDTH * HEIGHT * 4);
    expect(image.data[3]).toBe(255);
  });

  test("lets jsQR read a binary verification code's exact bytes from a JPEG frame", () => {
    const payload = verificationPayload();
    // Not text in any encoding a native scanner might guess: invalid UTF-8.
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(payload)).toThrow();
    for (const scale of [3, 5]) {
      const image = jpegImageData(jpeg(frameShowing(payload, scale)));
      // As QrScanner calls it.
      const found = jsQR(image.data, image.width, image.height, {
        inversionAttempts: "dontInvert",
      });
      expect(found?.binaryData).toEqual(Array.from(payload));
    }
  });

  test("survives heavy JPEG compression", () => {
    const payload = verificationPayload();
    const image = jpegImageData(jpeg(frameShowing(payload, 4), 15));
    const found = jsQR(image.data, image.width, image.height, {
      inversionAttempts: "dontInvert",
    });
    expect(found?.binaryData).toEqual(Array.from(payload));
  });

  test("finds nothing in a frame without a code", () => {
    const rgba = new Uint8Array(WIDTH * HEIGHT * 4).map((_, i) => (i % 4 === 3 ? 255 : 128));
    const image = jpegImageData(jpeg(rgba));
    expect(
      jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" }),
    ).toBeNull();
  });

  test("refuses bytes that aren't a JPEG", () => {
    expect(() => jpegImageData(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
