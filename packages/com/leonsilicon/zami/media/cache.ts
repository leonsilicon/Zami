// The media cache: attachments downloaded (and, when encrypted, verified and decrypted)
// natively into files of their own, which images, video, audio and the share sheet load
// by URI. Nothing of the file passes through JS. A file stays for later rows, rooms and
// launches, so a row scrolled away and back shows it at once: the cache file is the
// memory. One download serves everyone asking for the same file, a few run at a time
// (newest first), and one stops when nobody wants it any more.
import { createLimiter, type Limiter } from "#limiter";
import type { NativeCipher, NativeMedia, NativeProgress } from "#native";

/** Download progress, as Zam's readBodyWithProgress reports it. */
export interface CacheProgress {
  loaded: number;
  /** Expected size, or null when neither the server nor the event said. */
  total: number | null;
}

export interface CacheRequest {
  /** Names the file: the same key is the same file. */
  key: string;
  url: string;
  headers: Record<string, string>;
  /** Verify and decrypt (an encrypted attachment). */
  cipher?: NativeCipher;
  /** The file's extension (with its dot), from the response's Content-Type. */
  extension(contentType: string | null): string;
  /** Size from the event, used when the response has no Content-Length. */
  expectedSize?: number | null;
  signal?: AbortSignal;
  onProgress?: (progress: CacheProgress) => void;
  /** The error for a response that isn't 2xx. */
  httpError(status: number): Error;
}

/** The file system calls the cache makes from JS: cheap ones (a stat, a rename). */
export interface CacheFiles {
  exists(uri: string): boolean;
  move(from: string, to: string): Promise<void>;
}

export interface MediaCacheOptions {
  native: NativeMedia;
  files: CacheFiles;
  /** The cache's directory, as a `file://` URI ending in `/`. */
  directory: string;
  /** What `prune` keeps the directory under. */
  maxBytes: number;
  /** Downloads at once. */
  concurrency: number;
}

export interface MediaCache {
  /** The cached file for `key`, if there is one now. */
  cached(key: string): string | null;
  /** The file for `request.key`, downloaded if it isn't cached. */
  fetch(request: CacheRequest): Promise<string>;
  /** Drops what's known about the files (after the directory was deleted). */
  forget(): void;
}

// (Progress is reported by the native module at most every 100 ms.)
// Prune again after this much has been downloaded in one run.
const PRUNE_EVERY_BYTES = 128 * 1024 * 1024;

export function abortError(): Error {
  return new DOMException("Aborted", "AbortError");
}

function positiveInt(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

interface Requester {
  onProgress?: (progress: CacheProgress) => void;
  expectedSize: number | null;
  resolve(uri: string): void;
  reject(error: unknown): void;
}

interface Job {
  id: string;
  requesters: Set<Requester>;
  started: boolean;
  cancelled: boolean;
  loaded: number;
  total: number;
}

let jobIds = 0;

export function createMediaCache(options: MediaCacheOptions): MediaCache {
  const { native, files, directory } = options;
  const limiter: Limiter = createLimiter(options.concurrency);
  /** Key → file name, for files known to be in the directory. */
  const names = new Map<string, string>();
  const jobs = new Map<string, Job>();
  const byId = new Map<string, Job>();
  let downloaded = 0;
  let pruning: Promise<void> | null = null;
  let listening = false;

  // The directory as last pruned: what's in it from earlier runs.
  function prune(): Promise<void> {
    pruning ??= native
      .prune(directory, options.maxBytes)
      .then((left) => {
        const present = new Set(left);
        for (const [key, name] of names) if (!present.has(name)) names.delete(key);
        for (const name of left) {
          const key = name.split(".")[0];
          if (key && !names.has(key)) names.set(key, name);
        }
      })
      .catch(() => {})
      .finally(() => {
        pruning = null;
      });
    return pruning;
  }
  const ready = prune();

  function listen(): void {
    if (listening) return;
    listening = true;
    native.addListener("onProgress", (event: NativeProgress) => {
      const job = byId.get(event.id);
      if (!job) return;
      job.loaded = event.loaded;
      job.total = event.total;
      for (const requester of job.requesters) report(requester, job, false);
    });
  }

  function report(requester: Requester, job: Job, final: boolean): void {
    if (!requester.onProgress) return;
    let total: number | null = job.total > 0 ? job.total : requester.expectedSize;
    // An estimate that turned out low is worse than none.
    if (total !== null && job.loaded > total) total = null;
    requester.onProgress({ loaded: job.loaded, total: final ? (total ?? job.loaded) : total });
  }

  function cached(key: string): string | null {
    const name = names.get(key);
    if (name === undefined) return null;
    const uri = `${directory}${name}`;
    if (files.exists(uri)) return uri;
    // The system cleared it.
    names.delete(key);
    return null;
  }

  async function download(request: CacheRequest, job: Job): Promise<string> {
    const dest = `${directory}${request.key}`;
    const { cipher } = request;
    const result = await native.download({
      id: job.id,
      url: request.url,
      headers: request.headers,
      dest,
      ...(cipher && { key: cipher.key, iv: cipher.iv, sha256: cipher.sha256 }),
    });
    if (result.status < 200 || result.status > 299) throw request.httpError(result.status);
    job.loaded = result.size;
    const extension = request.extension(result.contentType);
    let uri = dest;
    if (extension !== "") {
      uri = `${dest}${extension}`;
      await files.move(dest, uri);
    }
    names.set(request.key, `${request.key}${extension}`);
    downloaded += result.size;
    if (downloaded >= PRUNE_EVERY_BYTES) {
      downloaded = 0;
      void prune();
    }
    return uri;
  }

  function start(request: CacheRequest, job: Job): void {
    listen();
    const settle = (fn: (requester: Requester) => void) => {
      // A cancelled job may have been replaced by a new one for the same file.
      if (jobs.get(request.key) === job) jobs.delete(request.key);
      byId.delete(job.id);
      for (const requester of job.requesters) fn(requester);
      job.requesters.clear();
    };
    limiter
      .run(
        async () => {
          job.started = true;
          await ready;
          // Fetched meanwhile, or by an earlier run.
          return cached(request.key) ?? (await download(request, job));
        },
        () => (job.cancelled ? abortError() : null),
      )
      .then(
        (uri) =>
          settle((requester) => {
            report(requester, job, true);
            requester.resolve(uri);
          }),
        (error: unknown) =>
          settle((requester) => requester.reject(job.cancelled ? abortError() : error)),
      );
  }

  function fetch(request: CacheRequest): Promise<string> {
    if (request.signal?.aborted) return Promise.reject(abortError());
    const hit = cached(request.key);
    if (hit !== null) return Promise.resolve(hit);
    return new Promise<string>((resolve, reject) => {
      let job = jobs.get(request.key);
      if (!job) {
        job = {
          id: `zami-media-${++jobIds}`,
          requesters: new Set(),
          started: false,
          cancelled: false,
          loaded: 0,
          total: -1,
        };
        jobs.set(request.key, job);
        byId.set(job.id, job);
        start(request, job);
      }
      const requester: Requester = {
        onProgress: request.onProgress,
        expectedSize: positiveInt(request.expectedSize),
        resolve,
        reject,
      };
      job.requesters.add(requester);
      report(requester, job, false);
      const owner = job;
      request.signal?.addEventListener(
        "abort",
        () => {
          if (!owner.requesters.delete(requester)) return;
          reject(abortError());
          // Nobody else wants it: stop the download, or never start it.
          if (owner.requesters.size > 0) return;
          owner.cancelled = true;
          jobs.delete(request.key);
          if (owner.started) native.cancel(owner.id);
        },
        { once: true },
      );
    });
  }

  return {
    cached,
    fetch,
    forget() {
      names.clear();
    },
  };
}
