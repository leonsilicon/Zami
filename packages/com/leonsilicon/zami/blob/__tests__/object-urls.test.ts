import { expect, test } from "vite-plus/test";
import { type CacheDirectory, type CacheFile, cacheFileUrls } from "#object-urls";

/** expo-file-system's Directory and File over a map of paths to contents. */
function fakeFileSystem(stale: string[] = []) {
  const disk = new Map<string, Uint8Array>(stale.map((path) => [path, new Uint8Array()]));
  const root = "file:///cache/object-urls/";
  const log: string[] = [];
  const directory: CacheDirectory = {
    get exists() {
      return [...disk.keys()].some((path) => path.startsWith(root));
    },
    create: () => {
      log.push("create");
    },
    delete: () => {
      log.push("delete");
      for (const path of disk.keys()) if (path.startsWith(root)) disk.delete(path);
    },
  };
  const file = (_: CacheDirectory, name: string): CacheFile => {
    const uri = `${root}${name}`;
    return {
      uri,
      writeSync: (content) => {
        disk.set(uri, content.slice());
      },
      delete: () => {
        if (!disk.delete(uri)) throw new Error("No such file");
      },
    };
  };
  return { disk, log, urls: cacheFileUrls({ directory: () => directory, file }) };
}

test("writes each blob to its own cache file, named for its type", () => {
  const { disk, urls } = fakeFileSystem();
  const png = urls.create(new Uint8Array([1, 2, 3]).subarray(1), "image/png");
  const named = urls.create(new Uint8Array([4]), "", "voice.ogg");
  const again = urls.create(new Uint8Array([1, 2, 3]).subarray(1), "image/png");
  expect(png).toMatch(/^file:\/\/\/cache\/object-urls\/[\w-]+\.png$/);
  expect(named).toMatch(/\.ogg$/);
  expect(again).not.toBe(png);
  expect([...(disk.get(png) ?? [])]).toEqual([2, 3]);
  expect([...(disk.get(named) ?? [])]).toEqual([4]);
});

test("empties the directory of a previous run's files before the first one", () => {
  const { disk, log, urls } = fakeFileSystem(["file:///cache/object-urls/old.png"]);
  const url = urls.create(new Uint8Array(), "");
  urls.create(new Uint8Array(), "");
  expect(log).toEqual(["delete", "create"]);
  expect(disk.has("file:///cache/object-urls/old.png")).toBe(false);
  expect(disk.has(url)).toBe(true);
});

test("deletes a file when its URL is revoked, and only knows its own URLs", () => {
  const { disk, urls } = fakeFileSystem();
  const url = urls.create(new Uint8Array([1]), "audio/wav");
  expect(urls.revoke(url)).toBe(true);
  expect(disk.has(url)).toBe(false);
  expect(urls.revoke(url)).toBe(false);
  expect(urls.revoke("blob:native-id")).toBe(false);
});

test("revoking a URL whose file is already gone succeeds", () => {
  const { disk, urls } = fakeFileSystem();
  const url = urls.create(new Uint8Array([1]), "");
  disk.clear();
  expect(urls.revoke(url)).toBe(true);
});
