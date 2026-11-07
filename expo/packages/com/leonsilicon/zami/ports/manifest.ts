// `expo/zami-ports.lock.json` records, for every Expo file, the upstream commit it was
// last synced with. Keeping this out of the files themselves means an Expo version
// nobody has changed stays byte-identical to upstream (so git stores it once), and
// files that can't hold a comment (images, JSON) are tracked the same way.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST_PATH = "expo/zami-ports.lock.json";

export class Manifest {
  readonly #entries: Map<string, string>;

  constructor(entries: Iterable<[string, string]> = []) {
    this.#entries = new Map(entries);
  }

  static read(root: string): Manifest {
    try {
      const json = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8")) as Record<
        string,
        string
      >;
      return new Manifest(Object.entries(json));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Manifest();
      throw error;
    }
  }

  get(expoPath: string): string | undefined {
    return this.#entries.get(expoPath);
  }

  set(expoPath: string, sha: string): void {
    this.#entries.set(expoPath, sha);
  }

  delete(expoPath: string): void {
    this.#entries.delete(expoPath);
  }

  paths(): string[] {
    return [...this.#entries.keys()];
  }

  /** One entry per line, sorted, so concurrent branches rarely conflict. */
  write(root: string): void {
    const lines = [...this.#entries]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, sha]) => `  ${JSON.stringify(path)}: ${JSON.stringify(sha)}`);
    writeFileSync(
      join(root, MANIFEST_PATH),
      lines.length === 0 ? "{}\n" : `{\n${lines.join(",\n")}\n}\n`,
    );
  }
}
