import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";
import { FRAME_JS, PAGE_HTML } from "#page";
import { RUFFLE_WASM, ruffleFileName } from "#messages";

// Ruffle as Zam vendors it (static/ruffle/), in its Zami versions: the scripts as their
// text (Zami's Metro transformer makes them strings) and the two wasm builds as assets.
const ruffle = require.context("../../../../../static/ruffle", false, /\.zami\.(js|wasm)$/);
const RUFFLE_FILES = new Map(ruffle.keys().map((key) => [ruffleFileName(key), key]));

/** Where the sandbox's page is, and the directory the WebView may read. */
export interface SandboxPage {
  /** The page's `file://` URI. */
  uri: string;
  /** The sandbox's directory (`file://`, with a trailing slash): the page, its script and Ruffle. */
  directory: string;
}

// Under the cache directory: everything in it is rebuilt from the app's bundle on demand.
const sandbox = () => new Directory(Paths.cache, "zami-flash");
const ruffleDirectory = () => new Directory(sandbox(), "ruffle");

let prepared: Promise<SandboxPage> | undefined;
const wasmInPlace = new Map<string, Promise<void>>();

/**
 * Writes the sandbox's directory (once a run: the page, its script and Ruffle's scripts,
 * which change with the app) and gives the page to load. Ruffle's wasm is put in place
 * when the page asks for it (`provideRuffleWasm`); builds no longer bundled are deleted.
 */
export function prepareSandbox(): Promise<SandboxPage> {
  prepared ??= writeSandbox().catch((error: unknown) => {
    prepared = undefined;
    throw error;
  });
  return prepared;
}

async function writeSandbox(): Promise<SandboxPage> {
  const root = sandbox();
  const scripts = ruffleDirectory();
  scripts.create({ intermediates: true, idempotent: true });
  for (const entry of scripts.list()) {
    if (entry instanceof File && !RUFFLE_FILES.has(entry.name)) entry.delete();
  }
  const writes: Promise<void>[] = [
    new File(root, "frame.js").write(FRAME_JS),
    new File(root, "index.html").write(PAGE_HTML),
  ];
  for (const [name, key] of RUFFLE_FILES) {
    if (name.endsWith(".js")) writes.push(new File(scripts, name).write(ruffle(key) as string));
  }
  await Promise.all(writes);
  return { uri: new File(root, "index.html").uri, directory: root.uri };
}

/**
 * Puts the Ruffle wasm build `name` in the sandbox's directory, from the app's assets
 * (downloaded from the dev server in development). False for a name that isn't one of
 * the bundled builds.
 */
export async function provideRuffleWasm(name: string): Promise<boolean> {
  const key = RUFFLE_WASM.test(name) ? RUFFLE_FILES.get(name) : undefined;
  if (key === undefined) return false;
  await prepareSandbox();
  let inPlace = wasmInPlace.get(name);
  if (inPlace === undefined) {
    inPlace = copyAsset(ruffle(key) as number, new File(ruffleDirectory(), name));
    wasmInPlace.set(name, inPlace);
    inPlace.catch(() => wasmInPlace.delete(name));
  }
  await inPlace;
  return true;
}

async function copyAsset(module: number, destination: File): Promise<void> {
  if (destination.exists) return;
  // Written beside it, then renamed: a half-written file is never taken for the build.
  const partial = new File(destination.parentDirectory, `${destination.name}.partial`);
  if (partial.exists) partial.delete();
  const asset = Asset.fromModule(module);
  if (/^https?:/.test(asset.uri)) {
    await File.downloadFileAsync(asset.uri, partial);
  } else {
    await asset.downloadAsync();
    await new File(asset.localUri ?? asset.uri).copy(partial);
  }
  await partial.move(destination);
}
