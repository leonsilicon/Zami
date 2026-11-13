// The media module as the app uses it: one cache directory per signed-in account under
// the app's cache directory, and temporary files for uploads under another. Every
// function returns null when the app has no native module, so the caller keeps Zam's
// JS path. Nothing here imports React Native or Expo (the module is looked up where Expo
// puts it), so Zam's code that calls it still loads in its jsdom tests.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { type CacheProgress, createMediaCache, type MediaCache } from "#cache";
import { type EncryptedFileRef, nativeCipher } from "#encrypted-file";
import { type NativeMedia, nativeMedia } from "#native";
import {
  encryptBlob,
  type EncryptedUpload,
  type FileThumbnail,
  imageThumbnail,
  stripJpeg,
  type TempFiles,
  videoThumbnail,
} from "#upload";

/** The cache's directory under the app's cache directory; a directory per account in it. */
const CACHE_DIRECTORY = "media/";
/** Upload files (ciphertext, thumbnails); a directory per run in it. */
const TEMP_DIRECTORY = "media-temp/";
/** Each account's cache is pruned to this, oldest first. */
export const MEDIA_CACHE_MAX_BYTES = 512 * 1024 * 1024;
/** Downloads at once, across the app. */
const CONCURRENT_DOWNLOADS = 4;

function hash(text: string, length: number): string {
  return bytesToHex(sha256(utf8ToBytes(text))).slice(0, length);
}

function cacheRoot(native: NativeMedia): string {
  const root = native.cacheDirectory();
  return `${root.endsWith("/") ? root : `${root}/`}${CACHE_DIRECTORY}`;
}

const caches = new Map<string, MediaCache>();

/** The account's media cache, created on first use. */
function cacheFor(account: string): MediaCache | null {
  const native = nativeMedia();
  if (!native) return null;
  const known = caches.get(account);
  if (known) return known;
  const directory = `${cacheRoot(native)}${hash(account, 16)}/`;
  native.makeDirectory(directory);
  const cache = createMediaCache({
    native,
    directory,
    maxBytes: MEDIA_CACHE_MAX_BYTES,
    concurrency: CONCURRENT_DOWNLOADS,
    files: {
      exists: (uri) => native.exists(uri),
      move: (from, to) => native.move(from, to),
    },
  });
  caches.set(account, cache);
  return cache;
}

// Keys of received EncryptedFiles, which are the same object for as long as the event is.
const encryptedKeys = new WeakMap<object, string>();

/** The cache key of an encrypted attachment: its URL, ciphertext hash, key and IV. */
function encryptedKey(file: EncryptedFileRef): string {
  let key = encryptedKeys.get(file);
  if (key === undefined) {
    key = `e${hash(`${file.url}\n${file.hashes.sha256}\n${file.key.k}\n${file.iv}`, 32)}`;
    encryptedKeys.set(file, key);
  }
  return key;
}

export interface MediaDownload {
  /** The signed-in user whose cache it goes in. */
  account: string;
  url: string;
  headers: Record<string, string>;
  /** Size from the event, used when the response has no Content-Length. */
  expectedSize?: number | null;
  signal?: AbortSignal;
  onProgress?: (progress: CacheProgress) => void;
  /** The error for a response that isn't 2xx. */
  httpError(status: number): Error;
}

/**
 * The `file://` URI of an encrypted attachment, downloaded, checked against its SHA-256
 * and decrypted natively unless it is cached already (a hash mismatch rejects, and no
 * file is kept). Null without the native module.
 */
export function downloadEncryptedMedia(
  file: EncryptedFileRef,
  extension: string,
  request: MediaDownload,
): Promise<string> | null {
  const cache = cacheFor(request.account);
  if (!cache) return null;
  let cipher;
  try {
    cipher = nativeCipher(file);
  } catch (error) {
    return Promise.reject(error);
  }
  return cache.fetch({
    ...request,
    key: encryptedKey(file),
    cipher,
    extension: () => extension,
  });
}

/** The decrypted attachment's file if it is cached now, else null. */
export function cachedEncryptedMedia(account: string, file: EncryptedFileRef): string | null {
  if (!file?.url || !file.hashes?.sha256 || !file.key?.k || !file.iv) return null;
  return cacheFor(account)?.cached(encryptedKey(file)) ?? null;
}

/**
 * The `file://` URI of a homeserver media download, cached natively, named with
 * `extension(contentType)`. Null without the native module.
 */
export function downloadPlainMedia(
  request: MediaDownload & { extension(contentType: string | null): string },
): Promise<string> | null {
  const cache = cacheFor(request.account);
  if (!cache) return null;
  return cache.fetch({ ...request, key: `p${hash(request.url, 32)}` });
}

let tempDirectory: string | undefined;
let tempCount = 0;

function tempFiles(native: NativeMedia): TempFiles {
  return {
    next(extension = "") {
      if (tempDirectory === undefined) {
        const root = native.cacheDirectory();
        const temps = `${root.endsWith("/") ? root : `${root}/`}${TEMP_DIRECTORY}`;
        const run = Date.now().toString(36);
        tempDirectory = `${temps}${run}/`;
        native.makeDirectory(tempDirectory);
        // Earlier runs' leftovers (an upload cut off by the app closing).
        void native
          .list(temps)
          .then((names) => {
            const stale = names.filter((name) => name !== run).map((name) => `${temps}${name}`);
            return stale.length > 0 ? native.remove(stale) : undefined;
          })
          .catch(() => {});
      }
      return `${tempDirectory}${(tempCount++).toString(36)}${extension}`;
    },
    remove(uri) {
      void native.remove([uri]).catch(() => {});
    },
  };
}

/**
 * `blob` encrypted natively into a temporary file, with its EncryptedFile (as
 * encryptAttachment makes it). Null without the native module, or for a blob whose bytes
 * it can't reach; then encrypt in JS as before.
 */
export function encryptForUpload(blob: Blob): Promise<EncryptedUpload | null> | null {
  const native = nativeMedia();
  return native ? encryptBlob(native, tempFiles(native), blob) : null;
}

/**
 * A JPEG with its metadata stripped natively, byte for byte as Zam's stripLocationMetadata
 * strips one (its scan of the image data would block the JS thread for a big photo): the
 * stripped file, or `file` itself when it's left as is. Null without the native module,
 * or for anything but a JPEG, so Zam's own code handles it.
 */
export function stripJpegMetadata(file: File): Promise<File | null> | null {
  const native = nativeMedia();
  return native ? stripJpeg(native, tempFiles(native), file).catch(() => null) : null;
}

/**
 * A video's thumbnail and size, read from its file natively, or null if it can't be had
 * within `timeoutMs`. Null (not a promise) without the native module.
 */
export function videoThumbnailFor(
  blob: Blob,
  { maxEdge = 800, quality = 0.85, timeoutMs = 10_000 } = {},
): Promise<FileThumbnail | null> | null {
  const native = nativeMedia();
  if (!native) return null;
  return videoThumbnail(native, tempFiles(native), blob, { maxEdge, quality, timeoutMs });
}

/** An image's upright thumbnail and size, natively, as `videoThumbnailFor`. */
export function imageThumbnailFor(
  blob: Blob,
  { maxEdge = 640, quality = 0.8, timeoutMs = 10_000 } = {},
): Promise<FileThumbnail | null> | null {
  const native = nativeMedia();
  if (!native) return null;
  return imageThumbnail(native, tempFiles(native), blob, { maxEdge, quality, timeoutMs });
}

/**
 * Deletes the media cached for accounts no longer signed in, so a signed-out account's
 * decrypted attachments don't stay on the device.
 */
export function forgetSignedOutMedia(signedIn: readonly string[]): void {
  const native = nativeMedia();
  if (!native) return;
  const keep = new Set(signedIn.map((account) => hash(account, 16)));
  for (const [account, cache] of caches) {
    if (!keep.has(hash(account, 16))) {
      cache.forget();
      caches.delete(account);
    }
  }
  const root = cacheRoot(native);
  void native
    .list(root)
    .then((names) => {
      const stale = names.filter((name) => !keep.has(name)).map((name) => `${root}${name}`);
      return stale.length > 0 ? native.remove(stale) : undefined;
    })
    .catch(() => {});
}
