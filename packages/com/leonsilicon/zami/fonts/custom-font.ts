// A font the user uploads (Zam's custom font slot), loaded the way React Native can: on the
// web Zam registers its bytes as a FontFace; here they're saved as a TrueType or OpenType
// file in the app's documents (decoding WOFF2) and registered with expo-font.
import { Directory, File, Paths } from "expo-file-system";
import { loadAsync } from "expo-font";
import { setFontLoaded } from "#app-font";
import { toSfnt } from "#convert";

const FONT_DIRECTORY = "fonts";

/** FNV-1a over the bytes, in base 36: names a font file by its contents. */
function contentHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}${bytes.length.toString(36)}`;
}

/**
 * Loads the font file `data` (TrueType, OpenType or WOFF2) as the family Zam's font stacks
 * call `name`. The file is written to the app's documents under a name from its contents,
 * which is also the family it's registered as: expo-font loads a family name once, so a
 * different upload needs a different one. Resolves to false for a file that isn't a font
 * the platform can load.
 */
export async function registerCustomFont(
  name: string,
  data: ArrayBuffer | Uint8Array,
): Promise<boolean> {
  try {
    const font = toSfnt(data instanceof Uint8Array ? data : new Uint8Array(data));
    const alias = `${name}-${contentHash(font.data)}`;
    const directory = new Directory(Paths.document, FONT_DIRECTORY);
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, `${alias}.${font.extension}`);
    if (!file.exists || file.size !== font.data.length) {
      if (file.exists) file.delete();
      file.create();
      await file.write(font.data);
    }
    await loadAsync({ [alias]: file.uri });
    setFontLoaded(name, alias);
    // Earlier uploads to the slot.
    for (const entry of directory.list()) {
      if (entry instanceof File && entry.name.startsWith(`${name}-`) && entry.uri !== file.uri) {
        entry.delete();
      }
    }
    return true;
  } catch (error) {
    console.warn("[zami] couldn't load the custom font", error);
    return false;
  }
}

/** Stops rendering the family `name` (its text falls back to the system font). */
export function unregisterCustomFont(name: string): void {
  setFontLoaded(name, null);
}
