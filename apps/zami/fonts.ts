// Fonts: every Text and TextInput takes the font Zam's settings choose (Settings ›
// Appearance), and Zam's bundled fonts load before Zam's code starts, as its stylesheet's
// @font-face rules make them available on the web. assets/fonts holds them as TrueType,
// written from Zam's WOFF2 files by `vpx _fonts` (@-/com.leonsilicon.zami.fonts).
import {
  installAppFont,
  IOS_INSTALLED_FONTS,
  loadFontFamilies,
  setFontsInstalled,
} from "@-/com.leonsilicon.zami.fonts";
import { Platform } from "react-native";

installAppFont();
// The families iOS ships that Zam's stacks fall back to, as Safari finds them: with no
// font picked, Zam draws in Helvetica Neue there.
if (Platform.OS === "ios") setFontsInstalled(IOS_INSTALLED_FONTS);

/**
 * Resolves once Zam's bundled fonts are loaded (or failed to), or after five seconds:
 * a load that hangs mustn't keep the app on its splash. A family that loads later still
 * applies when it does.
 */
export const fontsReady: Promise<void> = Promise.race([
  loadBundledFonts(),
  new Promise<void>((resolve) => setTimeout(resolve, 5000)),
]);

function loadBundledFonts(): Promise<void> {
  return loadFontFamilies([
    // A variable font (weights 100–900), whose named instances fontWeight picks from.
    { fontFamily: "Inter", fontDefinitions: [{ path: require("./assets/fonts/inter.ttf") }] },
    {
      fontFamily: "Atkinson Hyperlegible",
      fontDefinitions: [
        { path: require("./assets/fonts/atkinson-400.ttf"), weight: 400 },
        { path: require("./assets/fonts/atkinson-700.ttf"), weight: 700 },
      ],
    },
  ]);
}
