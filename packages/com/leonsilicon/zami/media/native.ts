// The native half (ios/ZamiMediaModule.swift, android/…/ZamiMediaModule.kt): file I/O,
// AES-CTR and SHA-256, HTTP downloads and video frames, off the JS thread. It isn't there
// in Node (the tests), on the web, or in an app binary built before it was added; every
// caller then keeps Zam's own JS path.

/** A range of a file (`file://`, or `content://` on Android). */
export interface NativeRange {
  uri: string;
  offset: number;
  length: number;
}

/** AES-256-CTR key, initial counter block and SHA-256 of the ciphertext, in padded base64. */
export interface NativeCipher {
  key: string;
  iv: string;
  sha256: string;
}

export interface DownloadRequest {
  /** Names the transfer in progress events and `cancel`. */
  id: string;
  url: string;
  headers: Record<string, string>;
  /** Where the file goes once complete (and verified): it's written to `dest + ".part"` until then. */
  dest: string;
  /** Verify the SHA-256 of what arrives and decrypt it (a Matrix EncryptedFile). */
  key?: string;
  iv?: string;
  sha256?: string;
}

export interface DownloadResult {
  /** The HTTP status. On anything but 2xx no file is written. */
  status: number;
  size: number;
  contentType: string | null;
}

export interface EncryptResult extends NativeCipher {
  size: number;
}

export interface NativeThumbnail {
  /** The picture's size as shown (rotation applied). */
  width: number;
  height: number;
  /** The thumbnail's size. */
  thumbWidth: number;
  thumbHeight: number;
  /** The thumbnail file's size in bytes. */
  size: number;
}

/** A transfer's progress; `total` is -1 when the server didn't say. */
export interface NativeProgress {
  id: string;
  loaded: number;
  total: number;
}

/** The native module's functions. Their arguments are already checked; they only do the work. */
export interface NativeMedia {
  /** The app's cache directory, as a `file://` URI ending in `/`. */
  cacheDirectory(): string;
  /** Whether there is a file or directory at `uri` (a stat, synchronous). */
  exists(uri: string): boolean;
  /** Creates the directory at `uri` and its parents (synchronous). */
  makeDirectory(uri: string): void;
  /** The names in the directory at `uri` (none if it isn't one). */
  list(uri: string): Promise<string[]>;
  /** Moves a file, replacing what's at `to`. */
  move(from: string, to: string): Promise<void>;
  readRange(uri: string, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
  writeFile(uri: string, bytes: Uint8Array): Promise<void>;
  /** Writes the ranges end to end into `dest`, returning its size. */
  concat(ranges: NativeRange[], dest: string): Promise<number>;
  /** Encrypts the ranges into `dest` with a fresh key and IV (low 64 bits zero), hashing the ciphertext. */
  encrypt(ranges: NativeRange[], dest: string): Promise<EncryptResult>;
  /**
   * Zam's JPEG metadata stripping (stripMetadata.ts's `stripJpeg`), byte for byte, file to
   * file: "stripped" with the result in `dest`, "unchanged" for a JPEG it leaves as it is.
   */
  stripJpeg(src: string, dest: string): Promise<"stripped" | "unchanged" | "notJpeg">;
  download(request: DownloadRequest): Promise<DownloadResult>;
  /** Stops a download; its promise rejects. */
  cancel(id: string): void;
  /** A JPEG frame from about a tenth of the way in (at most 1 s), fitted in `maxEdge`. */
  videoThumbnail(
    uri: string,
    dest: string,
    maxEdge: number,
    quality: number,
  ): Promise<NativeThumbnail>;
  /** A JPEG of the image, upright, fitted in `maxEdge`. */
  imageThumbnail(
    uri: string,
    dest: string,
    maxEdge: number,
    quality: number,
  ): Promise<NativeThumbnail>;
  /** Deletes `.part` files and the least recently used files past `maxBytes`; the names left. */
  prune(directory: string, maxBytes: number): Promise<string[]>;
  /** Deletes files and directories, ignoring any that are gone. */
  remove(uris: string[]): Promise<void>;
  addListener(
    event: "onProgress",
    listener: (progress: NativeProgress) => void,
  ): { remove(): void };
}

/**
 * The native module, if the app has it. It's looked up on each call, where Expo puts
 * native modules (`globalThis.expo.modules`), so it needs no React Native import.
 */
export function nativeMedia(): NativeMedia | null {
  const host = globalThis as { expo?: { modules?: { ZamiMedia?: NativeMedia } } };
  return host.expo?.modules?.ZamiMedia ?? null;
}
