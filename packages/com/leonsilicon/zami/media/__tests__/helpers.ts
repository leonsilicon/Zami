// A stand-in for the native module: downloads finish when a test says so, files are a map.
import type {
  DownloadRequest,
  DownloadResult,
  NativeMedia,
  NativeProgress,
  NativeRange,
} from "#native";

interface PendingDownload {
  request: DownloadRequest;
  progress(loaded: number, total: number): void;
  finish(result?: Partial<DownloadResult>): void;
  fail(error: Error): void;
}

export function fakeNative() {
  const files = new Map<string, Uint8Array>();
  const pending: PendingDownload[] = [];
  const cancelled: string[] = [];
  const listeners = new Set<(progress: NativeProgress) => void>();
  const encrypted: { ranges: NativeRange[]; dest: string }[] = [];
  let pruneResult: string[] = [];
  let thumbnail: ((uri: string, dest: string) => Promise<void>) | null = null;

  const native: NativeMedia = {
    cacheDirectory: () => "file:///cache/",
    exists: (uri) => files.has(uri),
    makeDirectory: () => {},
    list: async (uri) =>
      [...files.keys()]
        .filter((name) => name.startsWith(uri))
        .map((name) => name.slice(uri.length).split("/")[0] ?? ""),
    async move(from, to) {
      const bytes = files.get(from);
      if (!bytes) throw new Error(`No such file: ${from}`);
      files.delete(from);
      files.set(to, bytes);
    },
    async readRange(uri, offset, length) {
      return (files.get(uri) ?? new Uint8Array()).slice(offset, offset + length);
    },
    async writeFile(uri, bytes) {
      files.set(uri, bytes.slice());
    },
    // Drops everything after the SOI marker's next byte, standing in for the real thing;
    // a JPEG whose third byte is 0 is one "left as it is".
    async stripJpeg(src, dest) {
      const bytes = files.get(src) ?? new Uint8Array();
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return "notJpeg";
      if (bytes[2] === 0) return "unchanged";
      files.set(dest, bytes.slice(0, 3));
      return "stripped";
    },
    async concat(ranges, dest) {
      const parts = ranges.map(({ uri, offset, length }) =>
        (files.get(uri) ?? new Uint8Array()).slice(offset, offset + length),
      );
      files.set(dest, Uint8Array.from(parts.flatMap((part) => [...part])));
      return parts.reduce((sum, part) => sum + part.length, 0);
    },
    async encrypt(ranges, dest) {
      encrypted.push({ ranges, dest });
      const size = await native.concat(ranges, dest);
      return {
        key: Buffer.alloc(32, 1).toString("base64"),
        iv: Buffer.concat([Buffer.alloc(8, 2), Buffer.alloc(8)]).toString("base64"),
        sha256: Buffer.alloc(32, 3).toString("base64"),
        size,
      };
    },
    download(request) {
      return new Promise((resolve, reject) => {
        pending.push({
          request,
          progress(loaded, total) {
            for (const listener of listeners) listener({ id: request.id, loaded, total });
          },
          finish(result = {}) {
            const status = result.status ?? 200;
            const size = result.size ?? 4;
            if (status >= 200 && status < 300) files.set(request.dest, new Uint8Array(size));
            resolve({ status, size, contentType: result.contentType ?? null });
          },
          fail: reject,
        });
      });
    },
    cancel(id) {
      cancelled.push(id);
      const index = pending.findIndex((download) => download.request.id === id);
      const [download] = index >= 0 ? pending.splice(index, 1) : [];
      download?.fail(new Error("The download was cancelled"));
    },
    async videoThumbnail(uri, dest) {
      await thumbnail?.(uri, dest);
      files.set(dest, new Uint8Array(7));
      return { width: 1920, height: 1080, thumbWidth: 800, thumbHeight: 450, size: 7 };
    },
    async imageThumbnail(uri, dest, maxEdge) {
      files.set(dest, new Uint8Array(maxEdge));
      return {
        width: 4000,
        height: 3000,
        thumbWidth: maxEdge,
        thumbHeight: (maxEdge * 3) / 4,
        size: maxEdge,
      };
    },
    async prune() {
      return pruneResult;
    },
    async remove(uris) {
      for (const uri of uris) files.delete(uri);
    },
    addListener(_event, listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  return {
    native,
    files,
    pending,
    cancelled,
    encrypted,
    setPruneResult(names: string[]) {
      pruneResult = names;
    },
    setThumbnail(fn: typeof thumbnail) {
      thumbnail = fn;
    },
  };
}

/** Lets pending promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
