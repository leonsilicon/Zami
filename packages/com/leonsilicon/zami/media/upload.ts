// Uploads without the file in JS: encryption file to file, and thumbnails from the file.
import {
  blobSegments,
  fileFromUri,
  fileSegments,
  segmentsFile,
  wholeFileUri,
} from "@-/com.leonsilicon.zami.blob/files";
import { type EncryptedFileJson, encryptedFileJson } from "#encrypted-file";
import type { NativeMedia, NativeThumbnail } from "#native";

/** Where the native module writes, and how to clean up after it. */
export interface TempFiles {
  /** A new file URI in a temporary directory, named with `extension`. */
  next(extension?: string): string;
  remove(uri: string): void;
}

export interface EncryptedUpload {
  /** The EncryptedFile, without `url` (added once uploaded). */
  info: EncryptedFileJson;
  /** The ciphertext, as a file-backed File (sent from its file). */
  ciphertext: File;
  /** Deletes the ciphertext file: call it once the upload is over. */
  release(): void;
}

/**
 * `blob` encrypted for a Matrix room into a temporary file, natively: AES-256-CTR with a
 * fresh key and IV, and the SHA-256 of the ciphertext, as encryptAttachment does. Null for
 * a blob whose bytes the native module can't reach (React Native's own native blobs).
 */
export async function encryptBlob(
  native: NativeMedia,
  temp: TempFiles,
  blob: Blob,
): Promise<EncryptedUpload | null> {
  const segments = blobSegments(blob);
  if (!segments) return null;
  const inputs = await fileSegments(segments);
  const dest = temp.next();
  try {
    const result = await native.encrypt(
      inputs.segments.map(({ uri, offset, length }) => ({ uri, offset, length })),
      dest,
    );
    return {
      info: encryptedFileJson(result),
      ciphertext: fileFromUri(dest, {
        name: "",
        type: "application/octet-stream",
        size: result.size,
      }),
      release: () => temp.remove(dest),
    };
  } catch (error) {
    temp.remove(dest);
    throw error;
  } finally {
    inputs.release();
  }
}

/** A thumbnail written by the native module, as `sendFile` puts it in `info`. */
export interface FileThumbnail {
  file: File;
  /** The full picture's size, upright. */
  w: number;
  h: number;
  thumbW: number;
  thumbH: number;
}

/** `blob`'s file: its own if it's all of one, else a temporary copy (to `release`). */
async function sourceFile(blob: Blob): Promise<{ uri: string; release(): void } | null> {
  const whole = wholeFileUri(blob);
  if (whole !== undefined) return { uri: whole, release: () => {} };
  const segments = blobSegments(blob);
  if (!segments) return null;
  return segmentsFile(segments).catch(() => null);
}

/**
 * `file` with its JPEG metadata stripped natively, exactly as Zam's stripLocationMetadata
 * strips a JPEG: a file-backed copy, or `file` itself when there's nothing it can do. Null
 * when `file` isn't a JPEG (or can't be read), so Zam's own code handles it.
 */
export async function stripJpeg(
  native: NativeMedia,
  temp: TempFiles,
  file: File,
): Promise<File | null> {
  // The signature first, so a video isn't read for nothing.
  const head = blobSegments(file) && new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (!head || head[0] !== 0xff || head[1] !== 0xd8) return null;
  const source = await sourceFile(file);
  if (!source) return null;
  const dest = temp.next(".jpg");
  try {
    const result = await native.stripJpeg(source.uri, dest);
    if (result === "notJpeg") return null;
    if (result === "unchanged") return file;
    return fileFromUri(dest, { name: file.name, type: file.type, lastModified: file.lastModified });
  } catch {
    temp.remove(dest);
    return null;
  } finally {
    source.release();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export interface ThumbnailOptions {
  maxEdge: number;
  quality: number;
  timeoutMs: number;
}

type Generate = (
  uri: string,
  dest: string,
  maxEdge: number,
  quality: number,
) => Promise<NativeThumbnail>;

async function thumbnail(
  generate: Generate,
  temp: TempFiles,
  blob: Blob,
  options: ThumbnailOptions,
): Promise<FileThumbnail | null> {
  const source = await sourceFile(blob);
  if (!source) return null;
  const dest = temp.next(".jpg");
  try {
    const made = await withTimeout(
      generate(source.uri, dest, options.maxEdge, options.quality),
      options.timeoutMs,
    );
    if (!made || !made.width || !made.height) return null;
    return {
      file: fileFromUri(dest, { name: "thumbnail.jpg", type: "image/jpeg", size: made.size }),
      w: made.width,
      h: made.height,
      thumbW: made.thumbWidth,
      thumbH: made.thumbHeight,
    };
  } catch {
    return null;
  } finally {
    source.release();
  }
}

/**
 * A JPEG frame of the video in `blob` for `info.thumbnail_*` and its size for `info.w`/`h`,
 * read from its file natively, or null when the video can't be read (or takes longer than
 * `timeoutMs`: a send never waits on it for good).
 */
export function videoThumbnail(
  native: NativeMedia,
  temp: TempFiles,
  blob: Blob,
  options: ThumbnailOptions,
): Promise<FileThumbnail | null> {
  return thumbnail(native.videoThumbnail.bind(native), temp, blob, options);
}

/** The same for an image: decoded upright, scaled to fit `maxEdge` and encoded as JPEG. */
export function imageThumbnail(
  native: NativeMedia,
  temp: TempFiles,
  blob: Blob,
  options: ThumbnailOptions,
): Promise<FileThumbnail | null> {
  return thumbnail(native.imageThumbnail.bind(native), temp, blob, options);
}
