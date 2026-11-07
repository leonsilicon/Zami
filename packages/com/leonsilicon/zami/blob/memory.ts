// Blobs and Files that hold their bytes in JS, as the File API describes them, for what
// React Native's Blob (a handle to bytes its native modules hold) can't do: be built from
// bytes, and be read. Nothing here touches React Native, so it runs (and is tested) in Node.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A Blob's bytes and type. A Blob's bytes never change, so slices and copies share them. */
interface BlobState {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
}

interface FileState {
  name: string;
  lastModified: number;
}

const blobs = new WeakMap<object, BlobState>();
const files = new WeakMap<object, FileState>();

export interface MemoryBlobOptions {
  type?: string;
  endings?: "transparent" | "native";
}

export interface MemoryFileOptions extends MemoryBlobOptions {
  lastModified?: number;
}

/** The bytes of a `MemoryBlob` (shared, not copied), or `undefined` for anything else. */
export function memoryBytes(value: unknown): Uint8Array<ArrayBuffer> | undefined {
  return typeof value === "object" && value !== null ? blobs.get(value)?.bytes : undefined;
}

export function isMemoryBlob(value: unknown): value is MemoryBlob {
  return memoryBytes(value) !== undefined;
}

export function isMemoryFile(value: unknown): value is MemoryFile {
  return typeof value === "object" && value !== null && files.has(value);
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return (
    value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]"
  );
}

export function isBufferSource(value: unknown): value is ArrayBuffer | ArrayBufferView {
  return ArrayBuffer.isView(value) || isArrayBuffer(value);
}

/** `value` as WebIDL converts it to a DOMString, which is what `String()` does. */
function domString(value: unknown): string {
  // oxlint-disable-next-line typescript/no-base-to-string -- WebIDL stringifies any object this way
  return String(value);
}

/**
 * A MIME type as a Blob keeps it: lowercased, or empty if it has a character outside
 * U+0020 to U+007E.
 */
export function normalizeType(type: unknown): string {
  const text = type === undefined ? "" : domString(type);
  return /^[ -~]*$/.test(text) ? text.toLowerCase() : "";
}

/** The parts `new Blob(parts)` takes, as WebIDL converts a `sequence<BlobPart>`. */
export function partList(parts: unknown, constructor: string): unknown[] {
  if (parts === undefined) return [];
  if (
    (typeof parts !== "object" && typeof parts !== "function") ||
    parts === null ||
    typeof (parts as Partial<Iterable<unknown>>)[Symbol.iterator] !== "function"
  ) {
    throw new TypeError(
      `Failed to construct '${constructor}': The provided value cannot be converted to a sequence.`,
    );
  }
  return Array.from(parts as Iterable<unknown>);
}

function readOptions(options: unknown, constructor: string): MemoryFileOptions {
  if (options === undefined || options === null) return {};
  if (typeof options !== "object" && typeof options !== "function") {
    throw new TypeError(
      `Failed to construct '${constructor}': The provided value is not of type '${constructor}PropertyBag'.`,
    );
  }
  return options as MemoryFileOptions;
}

/** The bytes of each part, and whether they can be kept as they are (nobody else can change them). */
function partBytes(part: unknown, endings: string): { bytes: Uint8Array; owned: boolean } {
  const held = memoryBytes(part);
  if (held) return { bytes: held, owned: true };
  if (ArrayBuffer.isView(part)) {
    return { bytes: new Uint8Array(part.buffer, part.byteOffset, part.byteLength), owned: false };
  }
  if (isArrayBuffer(part)) return { bytes: new Uint8Array(part), owned: false };
  let text = domString(part);
  if (endings === "native") text = text.replace(/\r\n?/g, "\n");
  return { bytes: encoder.encode(text), owned: true };
}

/** The parts' bytes, end to end, copied unless a single part's bytes can be kept. */
export function joinParts(
  parts: readonly unknown[],
  endings = "transparent",
): Uint8Array<ArrayBuffer> {
  const chunks = parts.map((part) => partBytes(part, endings));
  const [only] = chunks;
  if (chunks.length === 1 && only?.owned) return only.bytes as Uint8Array<ArrayBuffer>;
  let length = 0;
  for (const { bytes } of chunks) length += bytes.byteLength;
  const joined = new Uint8Array(length);
  let at = 0;
  for (const { bytes } of chunks) {
    joined.set(bytes, at);
    at += bytes.byteLength;
  }
  return joined;
}

/** A `slice()` index as WebIDL's `[Clamp] long long` converts it: rounded, ties to even. */
function clampIndex(value: unknown): number {
  const number = Number(value);
  if (Number.isNaN(number)) return 0;
  if (!Number.isFinite(number)) return number;
  const floor = Math.floor(number);
  const fraction = number - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** `slice(start, end)`'s range of a blob of `size` bytes, as the File API resolves it. */
export function sliceRange(size: number, start?: unknown, end?: unknown): [number, number] {
  const resolve = (index: unknown, fallback: number) => {
    if (index === undefined) return fallback;
    const clamped = clampIndex(index);
    return clamped < 0 ? Math.max(size + clamped, 0) : Math.min(clamped, size);
  };
  const from = resolve(start, 0);
  return [from, Math.max(resolve(end, size), from)];
}

/** What every Blob shares, in memory or React Native's: the global `Blob.prototype`. */
export class BaseBlob {
  get [Symbol.toStringTag](): string {
    return "Blob";
  }
}

function stateOf(blob: object): BlobState {
  const state = blobs.get(blob);
  if (!state) throw new TypeError("Illegal invocation: not a Blob");
  return state;
}

/** A Blob whose bytes are in JS memory. */
export class MemoryBlob extends BaseBlob {
  constructor(parts?: unknown, options?: unknown) {
    super();
    const { type, endings = "transparent" } = readOptions(options, "Blob");
    if (endings !== "transparent" && endings !== "native") {
      throw new TypeError(
        `Failed to construct 'Blob': The provided value '${String(endings)}' is not a valid enum value of type EndingType.`,
      );
    }
    blobs.set(this, {
      bytes: joinParts(partList(parts, "Blob"), endings),
      type: normalizeType(type),
    });
  }

  get size(): number {
    return stateOf(this).bytes.byteLength;
  }

  get type(): string {
    return stateOf(this).type;
  }

  slice(start?: number, end?: number, contentType?: string): MemoryBlob {
    const { bytes } = stateOf(this);
    const [from, to] = sliceRange(bytes.byteLength, start, end);
    return fromBytes(bytes.subarray(from, to), normalizeType(contentType));
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return read(this, (bytes) => bytes.slice().buffer);
  }

  bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return read(this, (bytes) => bytes.slice());
  }

  text(): Promise<string> {
    return read(this, (bytes) => decoder.decode(bytes));
  }
}

/** A read of `blob`'s bytes, which rejects (never throws) if `blob` isn't one. */
function read<T>(blob: object, as: (bytes: Uint8Array<ArrayBuffer>) => T): Promise<T> {
  return new Promise((resolve) => resolve(as(stateOf(blob).bytes)));
}

/** A blob of `bytes` (kept, not copied: the caller must not change them). */
export function fromBytes(bytes: Uint8Array<ArrayBuffer>, type = ""): MemoryBlob {
  const blob = new MemoryBlob();
  blobs.set(blob, { bytes, type: normalizeType(type) });
  return blob;
}

function fileOf(file: object): FileState {
  const state = files.get(file);
  if (!state) throw new TypeError("Illegal invocation: not a File");
  return state;
}

/** A File whose bytes are in JS memory. */
export class MemoryFile extends MemoryBlob {
  constructor(parts: unknown, name: unknown, options?: unknown) {
    if (name === undefined) {
      throw new TypeError("Failed to construct 'File': 2 arguments required.");
    }
    super(partList(parts, "File"), options);
    const { lastModified } = readOptions(options, "File");
    files.set(this, {
      name: domString(name),
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
}
