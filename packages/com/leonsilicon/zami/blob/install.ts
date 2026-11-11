import { Directory, File, FileMode, Paths } from "expo-file-system";
import { cacheFileUrls } from "#object-urls";
import { type FileIo, type FileSegment, isFileSegment, type Segment, setFileIo } from "#parts";
import { type BlobHost, patchBlobs } from "#patch";

/** Where object URLs' files go, under the app's cache directory. */
const OBJECT_URL_DIRECTORY = "object-urls";
/** Where request bodies and native inputs are written, under the app's cache directory. */
const TEMP_DIRECTORY = "blob-temp";
/** The chunk the JS fallback copies files in. */
const COPY_CHUNK_BYTES = 1024 * 1024;

/**
 * The part of Zami's media module (@-/com.leonsilicon.zami.media) file-backed blobs use:
 * file I/O off the JS thread. It's looked up on each call, where Expo puts native modules.
 */
interface NativeFiles {
  readRange(uri: string, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
  writeFile(uri: string, bytes: Uint8Array): Promise<void>;
  concat(
    segments: { uri: string; offset: number; length: number }[],
    dest: string,
  ): Promise<number>;
}

function nativeFiles(): NativeFiles | null {
  const host = globalThis as { expo?: { modules?: { ZamiMedia?: NativeFiles } } };
  return host.expo?.modules?.ZamiMedia ?? null;
}

/** File access for file-backed blobs: Zami's media module, else expo-file-system's handles. */
function fileIo(): FileIo {
  let temp: Directory | undefined;
  let count = 0;
  function tempFile(): File {
    if (!temp) {
      const fresh = new Directory(Paths.cache, TEMP_DIRECTORY);
      try {
        // A previous run's leftovers (an upload cut off by the app closing).
        if (fresh.exists) fresh.delete();
      } catch {
        // They stay until the system clears the cache.
      }
      fresh.create({ intermediates: true, idempotent: true });
      temp = fresh;
    }
    return new File(temp, `${Date.now().toString(36)}-${(count++).toString(36)}`);
  }
  function remove(uri: string): void {
    try {
      new File(uri).delete();
    } catch {
      // Already gone.
    }
  }

  // Without the media module: async handles, a chunk at a time through JS.
  async function copyWithHandles(segments: readonly Segment[], dest: File): Promise<void> {
    dest.create({ overwrite: true });
    const out = dest.open(FileMode.WriteOnly);
    try {
      for (const segment of segments) {
        if (!isFileSegment(segment)) {
          await out.writeBytes(segment.bytes);
          continue;
        }
        const input = new File(segment.uri).open(FileMode.ReadOnly);
        try {
          input.offset = segment.offset;
          for (let left = segment.length; left > 0;) {
            const chunk = await input.readBytes(Math.min(left, COPY_CHUNK_BYTES));
            if (chunk.byteLength === 0) throw new Error(`${segment.uri} is shorter than expected`);
            await out.writeBytes(chunk);
            left -= chunk.byteLength;
          }
        } finally {
          input.close();
        }
      }
    } finally {
      out.close();
    }
  }

  async function writeNatively(
    native: NativeFiles,
    segments: readonly Segment[],
    dest: File,
  ): Promise<void> {
    const [only] = segments;
    if (segments.length === 1 && only && !isFileSegment(only)) {
      await native.writeFile(dest.uri, only.bytes);
      return;
    }
    const ranges: FileSegment[] = [];
    const temps: string[] = [];
    try {
      for (const segment of segments) {
        if (isFileSegment(segment)) {
          ranges.push(segment);
          continue;
        }
        const part = tempFile();
        temps.push(part.uri);
        await native.writeFile(part.uri, segment.bytes);
        const length = segment.bytes.byteLength;
        ranges.push({ uri: part.uri, offset: 0, length, fileSize: length });
      }
      await native.concat(
        ranges.map(({ uri, offset, length }) => ({ uri, offset, length })),
        dest.uri,
      );
    } finally {
      for (const uri of temps) remove(uri);
    }
  }

  return {
    async read(uri, offset, length) {
      const native = nativeFiles();
      if (native) return native.readRange(uri, offset, length);
      const handle = new File(uri).open(FileMode.ReadOnly);
      try {
        handle.offset = offset;
        return await handle.readBytes(length);
      } finally {
        handle.close();
      }
    },
    readSync(uri, offset, length) {
      const handle = new File(uri).open(FileMode.ReadOnly);
      try {
        handle.offset = offset;
        return handle.readBytesSync(length);
      } finally {
        handle.close();
      }
    },
    size(uri) {
      try {
        const file = new File(uri);
        return file.exists ? file.size : null;
      } catch {
        return null;
      }
    },
    async write(segments) {
      const dest = tempFile();
      try {
        const native = nativeFiles();
        if (native) await writeNatively(native, segments, dest);
        else await copyWithHandles(segments, dest);
      } catch (error) {
        remove(dest.uri);
        throw error;
      }
      return dest.uri;
    },
    remove,
  };
}

/**
 * Gives React Native the Blobs Zam's code and matrix-js-sdk use: `new Blob(bytes)` and
 * `new File(bytes, name)` make in-memory blobs; every Blob (React Native's too) reads with
 * `arrayBuffer()`, `bytes()` and `text()`; XMLHttpRequest (so matrix-js-sdk's uploads)
 * and fetch send them; FileReader reads them; and `URL.createObjectURL` gives a `file://`
 * URL of a cache file, which images, audio and video load. Files on disk can be Blobs too
 * (`fileFromUri`), read and sent from the file. Call it before any of Zam's modules load,
 * after React Native's and Expo's globals are set up.
 */
export function installBlobPolyfill(): void {
  setFileIo(fileIo());
  patchBlobs(
    globalThis as unknown as BlobHost,
    cacheFileUrls({
      directory: () => new Directory(Paths.cache, OBJECT_URL_DIRECTORY),
      file: (directory, name) => {
        const file = new File(directory, name);
        return {
          uri: file.uri,
          writeSync: (bytes) => file.writeSync(bytes),
          writeAsync: (bytes) => nativeFiles()?.writeFile(file.uri, bytes) ?? file.write(bytes),
          delete: () => file.delete(),
        };
      },
    }),
  );
}
