import { extensionFor } from "#extension";

/** Where `URL.createObjectURL` puts an in-memory blob's bytes. */
export interface ObjectUrls {
  /** A URL that loads `bytes`, available as soon as this returns. */
  create(bytes: Uint8Array, type: string, name?: string): string;
  /** The same, written off the JS thread: the URL loads once the promise resolves. */
  createAsync?(bytes: Uint8Array, type: string, name?: string): Promise<string>;
  /** Releases a URL `create` gave, returning false for any other URL. */
  revoke(url: string): boolean;
}

/** The part of expo-file-system's `Directory` this uses. */
export interface CacheDirectory {
  readonly exists: boolean;
  create(options: { intermediates: boolean; idempotent: boolean }): void;
  delete(): void;
}

/** The part of expo-file-system's `File` this uses. */
export interface CacheFile {
  readonly uri: string;
  writeSync(content: Uint8Array): void;
  /** Writes off the JS thread, where the file system can. */
  writeAsync?(content: Uint8Array): Promise<void>;
  delete(): void;
}

export interface CacheFileSystem<Directory extends CacheDirectory> {
  /** The directory the files go in, which this empties first: object URLs die with the JS runtime. */
  directory(): Directory;
  file(directory: Directory, name: string): CacheFile;
}

/**
 * Object URLs as `file://` URIs of cache files, which React Native's Image, expo-image,
 * expo-audio and expo-video load like any local file (iOS's expo-image, on SDWebImage,
 * can't load React Native's `blob:` URLs). Each URL is its own file, deleted when it's
 * revoked.
 */
export function cacheFileUrls<Directory extends CacheDirectory>(
  fs: CacheFileSystem<Directory>,
): ObjectUrls {
  let directory: Directory | undefined;
  const created = new Map<string, CacheFile>();
  let count = 0;

  function ready(): Directory {
    if (directory) return directory;
    const fresh = fs.directory();
    try {
      if (fresh.exists) fresh.delete();
    } catch {
      // Stale files stay until the system clears the cache.
    }
    fresh.create({ intermediates: true, idempotent: true });
    directory = fresh;
    return fresh;
  }

  function next(type: string, name?: string): CacheFile {
    const id = `${Date.now().toString(36)}-${(count++).toString(36)}`;
    return fs.file(ready(), `${id}${extensionFor(type, name)}`);
  }

  return {
    create(bytes, type, name) {
      const file = next(type, name);
      file.writeSync(bytes);
      created.set(file.uri, file);
      return file.uri;
    },
    async createAsync(bytes, type, name) {
      const file = next(type, name);
      if (file.writeAsync) await file.writeAsync(bytes);
      else file.writeSync(bytes);
      created.set(file.uri, file);
      return file.uri;
    },
    revoke(url) {
      const file = created.get(url);
      if (!file) return false;
      created.delete(url);
      try {
        file.delete();
      } catch {
        // Already gone (the system clears caches): what revoking wanted.
      }
      return true;
    },
  };
}
