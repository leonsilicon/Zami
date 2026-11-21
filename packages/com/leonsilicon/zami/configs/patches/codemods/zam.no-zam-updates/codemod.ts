import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

/**
 * Zam's Android app updates itself: it downloads Zam's APK from Zam's GitHub releases
 * (ApkUpdater), or a new web bundle (WebBundle). The Zami app is native on Android too, so
 * Zam would offer it Zam's own releases, and a web bundle would replace Zami's (built with
 * its codemods) with Zam's. Zami's builds come from the App Store, Google Play and
 * TestFlight, so in the Zami app neither updater runs; the About page's check still says
 * which release of Zam is the latest.
 */
export default function codemod(root: SgRoot): string | null {
  const filename = root.filename();
  const name = filename.endsWith("/src/lib/androidUpdater.ts")
    ? "isAndroidUpdater"
    : filename.endsWith("/src/lib/androidWebBundle.ts")
      ? "isAndroidWebBundle"
      : null;
  if (name === null) return null;
  return editNodes(root, [
    {
      kinds: ["function_declaration"],
      contains: `function ${name}(): boolean`,
      from:
        "    return (\n" +
        '        Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"\n' +
        "    );",
      to:
        "    // Zami: never. Zami's builds come from the App Store, Google Play and TestFlight.\n" +
        "    return false;",
      marker: "// Zami: never.",
    },
  ]);
}
