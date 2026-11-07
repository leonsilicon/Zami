import { decode } from "jpeg-js";

/** What a canvas's `getImageData` gives: RGBA pixels, row by row, and the size. */
export interface FrameImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * A JPEG's pixels as `getImageData` would return them after drawing it on a canvas,
 * decoded in JavaScript (jpeg-js): React Native has no canvas. A scanner frame is
 * 640x480 (0.3 MP); the limits only refuse a file far bigger than any camera's.
 */
export function jpegImageData(jpeg: Uint8Array): FrameImageData {
  const image = decode(jpeg, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: 50,
    maxMemoryUsageInMB: 256,
  });
  const { buffer, byteOffset, length } = image.data;
  return {
    data: new Uint8ClampedArray(buffer, byteOffset, length),
    width: image.width,
    height: image.height,
  };
}
