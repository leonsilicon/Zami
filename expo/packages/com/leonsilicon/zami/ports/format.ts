// Formats Expo files exactly the way Prettier formats their upstream originals: Zam's
// options, the parser Prettier infers from the upstream file name (package.json gets the
// json-stringify parser, package.expo.json would not), and Zam's ignore files. An Expo
// file nobody has changed therefore stays byte-identical to upstream.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as prettier from "prettier";
import { upstreamPathForExpoPath } from "#paths";

export async function formatExpoFiles(
  root: string,
  files: string[],
  options: { check: boolean },
): Promise<{ checked: number; unformatted: string[] }> {
  const config = (
    (await import(pathToFileURL(join(root, "expo/prettier.config.zam.js")).href)) as {
      default: prettier.Options;
    }
  ).default;
  const ignorePath = [join(root, ".gitignore"), join(root, ".prettierignore")];
  const unformatted: string[] = [];
  let checked = 0;
  for (const file of files) {
    const upstreamPath = upstreamPathForExpoPath(file);
    if (upstreamPath === null) continue;
    const filepath = join(root, upstreamPath);
    const info = await prettier.getFileInfo(filepath, { ignorePath, resolveConfig: false });
    if (info.ignored || info.inferredParser === null) continue;
    const source = readFileSync(join(root, file), "utf8");
    const formatted = await prettier.format(source, { ...config, filepath });
    checked++;
    if (formatted === source) continue;
    unformatted.push(file);
    if (!options.check) writeFileSync(join(root, file), formatted);
  }
  return { checked, unformatted };
}
