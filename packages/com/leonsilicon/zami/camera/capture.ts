import type { CameraView } from "expo-camera";
import { File } from "expo-file-system";

/**
 * The capture size to give the `CameraView` (`pictureSize`) whose frames are scanned:
 * 640 wide, as Zam asks `getUserMedia` for, is plenty for a code held up to the lens
 * and keeps each frame's decode short.
 */
export const FRAME_PICTURE_SIZE = "640x480";

/**
 * One frame from a running `CameraView`, as a quiet still in a file (`file://` URI):
 * expo-camera doesn't hand JavaScript its preview frames. No shutter sound; give the view
 * `animateShutter={false}` so the preview doesn't flash. Delete the file with
 * `discardStill` when done.
 *
 * Rejects when the camera can't take a picture (it isn't ready, or one is already being
 * taken).
 */
export async function captureStill(camera: CameraView): Promise<string> {
  const picture = await camera.takePictureAsync({
    quality: 0.5,
    shutterSound: false,
    exif: false,
  });
  return picture.uri;
}

/** Deletes a still `captureStill` took. */
export function discardStill(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // Already gone; the cache directory is the system's to clear anyway.
  }
}

/**
 * One frame from a running `CameraView`, as JPEG bytes (`jpegImageData` makes them the
 * ImageData a canvas would give after drawing the video's current frame): a still
 * (`captureStill`) read as bytes, its file then deleted.
 *
 * Rejects when the camera can't take a picture (it isn't ready, or one is already being
 * taken).
 */
export async function captureJpeg(camera: CameraView): Promise<Uint8Array> {
  const uri = await captureStill(camera);
  try {
    return await new File(uri).bytes();
  } finally {
    discardStill(uri);
  }
}
