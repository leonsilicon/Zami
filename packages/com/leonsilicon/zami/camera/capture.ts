import type { CameraView } from "expo-camera";
import { File } from "expo-file-system";

/**
 * The capture size to give the `CameraView` (`pictureSize`) whose frames are scanned:
 * 640 wide, as Zam asks `getUserMedia` for, is plenty for a code held up to the lens
 * and keeps each frame's decode short.
 */
export const FRAME_PICTURE_SIZE = "640x480";

/**
 * One frame from a running `CameraView`, as JPEG bytes (`jpegImageData` makes them the
 * ImageData a canvas would give after drawing the video's current frame). expo-camera
 * doesn't hand JavaScript its preview frames, so this takes a quiet still (no shutter
 * sound; give the view `animateShutter={false}` so the preview doesn't flash), reads its
 * file as bytes, and deletes the file.
 *
 * Rejects when the camera can't take a picture (it isn't ready, or one is already being
 * taken).
 */
export async function captureJpeg(camera: CameraView): Promise<Uint8Array> {
  const picture = await camera.takePictureAsync({
    quality: 0.5,
    shutterSound: false,
    exif: false,
  });
  const file = new File(picture.uri);
  try {
    return await file.bytes();
  } finally {
    try {
      file.delete();
    } catch {
      // Already gone; the cache directory is the system's to clear anyway.
    }
  }
}
