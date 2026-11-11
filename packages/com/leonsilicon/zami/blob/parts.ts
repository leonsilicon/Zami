// Blobs and Files backed by files on disk, for what an in-memory blob is too costly for: a
// picked 100 MB video read into JS, copied by every slice and rebuild, and base64-encoded
// to upload. A parts blob is a list of segments, each a range of a file or bytes in
// memory; slicing, rebuilding (`new File([blob.slice(…), bytes, …])`) and renaming make
// new lists without reading anything. Reads go to the file asynchronously, so only what
// is asked for (Zam's MP4 code reads box headers and the index) ever reaches JS.
// Nothing here imports React Native or Expo: the reads go through `FileIo`, which
// `install.ts` sets up, so this runs (and is tested) in Node.
import {
  BaseBlob,
  isBufferSource,
  memoryBytes,
  normalizeType,
  partList,
  sliceRange,
} from "#memory";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A range of a file: `uri` is a `file://` (or Android `content://`) URI. */
export interface FileSegment {
  readonly uri: string;
  readonly offset: number;
  readonly length: number;
  /** The whole file's size, so a segment knows when it's all of it. */
  readonly fileSize: number;
}

/** Bytes in memory, never changed once in a segment. */
export interface ByteSegment {
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export type Segment = FileSegment | ByteSegment;

export function isFileSegment(segment: Segment): segment is FileSegment {
  return "uri" in segment;
}

/** What parts blobs need from the file system (expo-file-system and Zami's media module). */
export interface FileIo {
  /** `length` bytes of the file at `uri` from `offset`, read off the JS thread. */
  read(uri: string, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
  /** The same, blocking: only for `URL.createObjectURL`, which must answer at once. */
  readSync(uri: string, offset: number, length: number): Uint8Array<ArrayBuffer>;
  /** The size of the file at `uri`, or null if it can't be read. */
  size(uri: string): number | null;
  /** Writes `segments` end to end into a new temporary file, off the JS thread. */
  write(segments: readonly Segment[]): Promise<string>;
  /** Deletes a file `write` made. */
  remove(uri: string): void;
}

let io: FileIo | null = null;

/** Sets how parts blobs reach files (the app's `installBlobPolyfill`, or a test). */
export function setFileIo(next: FileIo | null): void {
  io = next;
}

export function fileIo(): FileIo {
  if (!io) throw new Error("No file access for file-backed Blobs: installBlobPolyfill() first");
  return io;
}

interface PartsState {
  segments: readonly Segment[];
  size: number;
  type: string;
}

interface FileState {
  name: string;
  lastModified: number;
}

const states = new WeakMap<object, PartsState>();
const files = new WeakMap<object, FileState>();

function stateOf(blob: object): PartsState {
  const state = states.get(blob);
  if (!state) throw new TypeError("Illegal invocation: not a Blob");
  return state;
}

/** The segments of a parts blob (shared, never changed), or `undefined` for anything else. */
export function partsSegments(value: unknown): readonly Segment[] | undefined {
  return typeof value === "object" && value !== null ? states.get(value)?.segments : undefined;
}

export function isPartsBlob(value: unknown): value is PartsBlob {
  return partsSegments(value) !== undefined;
}

export function isPartsFile(value: unknown): value is PartsFile {
  return typeof value === "object" && value !== null && files.has(value);
}

function isWhole(segment: Segment | undefined): segment is FileSegment {
  return (
    segment !== undefined &&
    isFileSegment(segment) &&
    segment.offset === 0 &&
    segment.length === segment.fileSize
  );
}

/**
 * A blob's bytes as segments: a file-backed blob's own, or an in-memory blob's bytes as
 * one; `undefined` for React Native's native blobs (and anything else).
 */
export function blobSegments(value: unknown): readonly Segment[] | undefined {
  const own = partsSegments(value);
  if (own) return own;
  const held = memoryBytes(value);
  return held ? [{ bytes: held }] : undefined;
}

/** The URI of the file a parts blob is all of (a picked file, renamed or not), if it is. */
export function wholeFileUri(value: unknown): string | undefined {
  const segments = partsSegments(value);
  return segments?.length === 1 && isWhole(segments[0]) ? segments[0].uri : undefined;
}

function sizeOf(segments: readonly Segment[]): number {
  let size = 0;
  for (const segment of segments) {
    size += isFileSegment(segment) ? segment.length : segment.bytes.byteLength;
  }
  return size;
}

/** Appends `segment`, merging it into the last one when it continues the same file. */
function push(out: Segment[], segment: Segment): void {
  if (isFileSegment(segment) ? segment.length === 0 : segment.bytes.byteLength === 0) return;
  const last = out.at(-1);
  if (
    last &&
    isFileSegment(last) &&
    isFileSegment(segment) &&
    last.uri === segment.uri &&
    last.offset + last.length === segment.offset
  ) {
    out[out.length - 1] = { ...last, length: last.length + segment.length };
    return;
  }
  out.push(segment);
}

/** The segments of `parts` as `new Blob(parts)` joins them; any may be a parts blob. */
export function segmentsOf(parts: readonly unknown[], endings = "transparent"): Segment[] {
  const out: Segment[] = [];
  for (const part of parts) {
    const own = partsSegments(part);
    if (own) {
      for (const segment of own) push(out, segment);
      continue;
    }
    const held = memoryBytes(part);
    if (held) {
      push(out, { bytes: held });
    } else if (isBufferSource(part)) {
      // Copied: the caller may change its buffer later.
      const view = ArrayBuffer.isView(part)
        ? new Uint8Array(part.buffer, part.byteOffset, part.byteLength)
        : new Uint8Array(part);
      push(out, { bytes: view.slice() });
    } else {
      // oxlint-disable-next-line typescript/no-base-to-string -- WebIDL stringifies any object this way
      let text = String(part);
      if (endings === "native") text = text.replace(/\r\n?/g, "\n");
      push(out, { bytes: encoder.encode(text) });
    }
  }
  return out;
}

/** The segments covering `[from, to)` of `segments`. */
function sliceSegments(segments: readonly Segment[], from: number, to: number): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const segment of segments) {
    const length = isFileSegment(segment) ? segment.length : segment.bytes.byteLength;
    const start = Math.max(from, at);
    const end = Math.min(to, at + length);
    if (start < end) {
      push(
        out,
        isFileSegment(segment)
          ? { ...segment, offset: segment.offset + start - at, length: end - start }
          : { bytes: segment.bytes.subarray(start - at, end - at) },
      );
    }
    at += length;
    if (at >= to) break;
  }
  return out;
}

/** All of `segments`' bytes, read from their files off the JS thread. */
export async function readSegments(segments: readonly Segment[]): Promise<Uint8Array<ArrayBuffer>> {
  const [only] = segments;
  if (segments.length === 1 && only && !isFileSegment(only)) return only.bytes.slice();
  const out = new Uint8Array(sizeOf(segments));
  let at = 0;
  for (const segment of segments) {
    if (isFileSegment(segment)) {
      const bytes = await fileIo().read(segment.uri, segment.offset, segment.length);
      if (bytes.byteLength !== segment.length) {
        throw new DOMException(
          `The file changed after it was read: ${segment.uri}`,
          "NotReadableError",
        );
      }
      out.set(bytes, at);
      at += segment.length;
    } else {
      out.set(segment.bytes, at);
      at += segment.bytes.byteLength;
    }
  }
  return out;
}

/** The same, blocking: for the rare synchronous read (`URL.createObjectURL` of a rebuilt blob). */
export function readSegmentsSync(segments: readonly Segment[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(sizeOf(segments));
  let at = 0;
  for (const segment of segments) {
    const bytes = isFileSegment(segment)
      ? fileIo().readSync(segment.uri, segment.offset, segment.length)
      : segment.bytes;
    out.set(bytes, at);
    at += bytes.byteLength;
  }
  return out;
}

function readOptions(options: unknown): {
  type?: unknown;
  endings?: unknown;
  lastModified?: unknown;
} {
  return typeof options === "object" && options !== null ? options : {};
}

/** A Blob whose bytes are ranges of files and bytes in memory. */
export class PartsBlob extends BaseBlob {
  constructor(parts?: unknown, options?: unknown) {
    super();
    const { type, endings = "transparent" } = readOptions(options);
    const segments = segmentsOf(partList(parts, "Blob"), String(endings));
    states.set(this, { segments, size: sizeOf(segments), type: normalizeType(type) });
  }

  get size(): number {
    return stateOf(this).size;
  }

  get type(): string {
    return stateOf(this).type;
  }

  slice(start?: number, end?: number, contentType?: string): PartsBlob {
    const { segments, size } = stateOf(this);
    const [from, to] = sliceRange(size, start, end);
    return fromSegments(sliceSegments(segments, from, to), normalizeType(contentType));
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return read(this).then((bytes) => bytes.buffer);
  }

  bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return read(this);
  }

  text(): Promise<string> {
    return read(this).then((bytes) => decoder.decode(bytes));
  }
}

function read(blob: object): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise<readonly Segment[]>((resolve) => resolve(stateOf(blob).segments)).then(
    readSegments,
  );
}

/** A parts blob of `segments` (kept, not copied). */
export function fromSegments(segments: readonly Segment[], type = ""): PartsBlob {
  const blob = new PartsBlob();
  states.set(blob, { segments, size: sizeOf(segments), type: normalizeType(type) });
  return blob;
}

function fileOf(file: object): FileState {
  const state = files.get(file);
  if (!state) throw new TypeError("Illegal invocation: not a File");
  return state;
}

/** A File whose bytes are ranges of files and bytes in memory: a picked file, for one. */
export class PartsFile extends PartsBlob {
  constructor(parts: unknown, name: unknown, options?: unknown) {
    if (name === undefined) {
      throw new TypeError("Failed to construct 'File': 2 arguments required.");
    }
    super(partList(parts, "File"), options);
    const { lastModified } = readOptions(options);
    files.set(this, {
      // oxlint-disable-next-line typescript/no-base-to-string -- WebIDL stringifies any object this way
      name: String(name),
      lastModified: lastModified === undefined ? Date.now() : Math.trunc(Number(lastModified)) || 0,
    });
  }

  override get [Symbol.toStringTag](): string {
    return "File";
  }

  get name(): string {
    return fileOf(this).name;
  }

  get lastModified(): number {
    return fileOf(this).lastModified;
  }

  get webkitRelativePath(): string {
    return "";
  }

  /** The file this is all of, for APIs that take a URI (expo-video, expo-audio, expo-image). */
  get uri(): string | undefined {
    return wholeFileUri(this);
  }
}

export interface FileFromUriOptions {
  name?: string;
  type?: string;
  lastModified?: number;
  /** The file's size if already known (a picker's); otherwise it is read from the file. */
  size?: number | null;
}

/**
 * The file at `uri` as a `File`, without reading it: `size`, `type` and `name` are
 * known, `slice()` and rebuilding are free, reads go to the file, and
 * `URL.createObjectURL` and uploads use the file itself. (`stream()` isn't provided, as
 * for in-memory blobs: Zam only calls it for WebCodecs, which React Native lacks.)
 */
export function fileFromUri(
  uri: string,
  options: FileFromUriOptions = {},
): File & { readonly uri: string } {
  const stat = io?.size(uri);
  const size = stat ?? options.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    throw new DOMException(`Can't read the file at ${uri}`, "NotFoundError");
  }
  const name = options.name ?? decodeURIComponent(uri.split(/[?#]/)[0]?.split("/").pop() ?? "");
  const file = new PartsFile([], name || "file", {
    type: options.type,
    lastModified: options.lastModified,
  });
  states.set(file, {
    segments: [{ uri, offset: 0, length: size, fileSize: size }],
    size,
    type: normalizeType(options.type),
  });
  return file as unknown as File & { readonly uri: string };
}

/** `segments` written end to end into one temporary file, off the JS thread. */
export async function segmentsFile(
  segments: readonly Segment[],
): Promise<{ uri: string; release(): void }> {
  const uri = await fileIo().write(segments);
  return {
    uri,
    release() {
      try {
        fileIo().remove(uri);
      } catch {
        // Gone already.
      }
    },
  };
}

/**
 * `blob`'s segments with every in-memory one written to a temporary file, for native
 * code that reads only files. `release()` deletes those temporary files.
 */
export async function fileSegments(
  segments: readonly Segment[],
): Promise<{ segments: FileSegment[]; release(): void }> {
  const temps: string[] = [];
  const release = () => {
    for (const uri of temps.splice(0)) {
      try {
        fileIo().remove(uri);
      } catch {
        // Gone already: the cache is cleared at the next launch anyway.
      }
    }
  };
  try {
    const out: FileSegment[] = [];
    for (const segment of segments) {
      if (isFileSegment(segment)) {
        out.push(segment);
        continue;
      }
      const uri = await fileIo().write([segment]);
      temps.push(uri);
      const length = segment.bytes.byteLength;
      out.push({ uri, offset: 0, length, fileSize: length });
    }
    return { segments: out, release };
  } catch (error) {
    release();
    throw error;
  }
}
