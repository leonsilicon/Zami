// Loading the app's own font files (Zam's bundled fonts, as TrueType) at startup.
import { loadAsync, type FontFamilyDefinition } from "expo-font";
import { setFontLoaded } from "#app-font";

/**
 * Loads each family's faces with expo-font under the name Zam's font stacks use for it,
 * then makes them available to the app's font (setFontLoaded). A family that fails to
 * load is left out, so its text falls back as a browser's would.
 */
export async function loadFontFamilies(families: readonly FontFamilyDefinition[]): Promise<void> {
  await Promise.all(
    families.map(async (family) => {
      try {
        await loadAsync([family]);
        setFontLoaded(family.fontFamily);
      } catch (error) {
        console.warn(`[zami] couldn't load the ${family.fontFamily} font`, error);
      }
    }),
  );
}
