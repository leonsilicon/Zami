// The shell's native module (ios/, android/): it serves Zam's web app from the app's bundle
// at an origin of its own, through react-native-webview's hooks
// (configs/patches/codemods/react-native-webview).
import { requireNativeModule } from "expo";

interface ZamiShellModule {
  /** Where the bundled web app is served (zami://localhost/, https://localhost/); null without one. */
  webAppURL(): string | null;
  /**
   * The script the web app's pages run before their own: served as /__zami/start.js, which
   * the served HTML loads first (Zam's CSP allows same-origin scripts, not inline ones).
   */
  setStartScript(script: string): void;
}

export const ZamiShellNative = requireNativeModule<ZamiShellModule>("ZamiShell");
