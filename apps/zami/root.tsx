// The app's root: Zam's own routes, the way SvelteKit renders them (the root layout
// around the main page), inside what every screen relies on. Zam is one page; its
// navigation lives in `page.url` (@-/com.leonsilicon.zami.sveltekit).
import { AppFontProvider } from "@-/com.leonsilicon.zami.fonts";
import {
  createZamiApi,
  earlyPluginIds,
  markAppRendered,
  PluginLayers,
  PluginWebHost,
  StyleSheetScope,
} from "@-/com.leonsilicon.zami.plugins";
import { PortalHost } from "@-/com.leonsilicon.zami.rn";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { markStartup } from "@-/com.leonsilicon.zami.startup";
import { fontsReady } from "#fonts";
import { storageReady } from "#storage";
// Loaded before anything draws, whatever reads it first: with inline requires
// (@-/com.leonsilicon.zami.metro) a module imported for a name loads when the name is first
// used, and the settings store applies the theme, text scale and fonts when it loads, so the
// splash would draw in the default theme. (A bare import of a module this file also imports
// names from is merged into that import: see index.ts for storage.)
import "$lib/stores/settings.svelte";
import Splash from "$lib/components/layout/Splash.svelte";
import { initI18n } from "$lib/i18n";
import { getClient } from "$lib/matrix/client";
import { bootEarlyPlugins } from "$lib/plugins/pluginBoot";
import Layout from "../../src/routes/+layout.svelte";
import Page from "../../src/routes/+page.svelte";

// For the debugger (Argent's debugger-evaluate): the running Matrix client, and what a
// plugin gets as `zam.zami` (every module, component patches, …).
if (__DEV__) {
  let zami: ReturnType<typeof createZamiApi> | undefined;
  Object.assign(globalThis, {
    __zamiDebug: {
      getClient,
      get zami() {
        return (zami ??= createZamiApi({
          pluginId: "debugger",
          manifest: { name: "Debugger" },
          track: (disposable) => disposable,
        }));
      },
    },
  });
}

/** How long the first render waits for the plugins that load before it. */
const EARLY_PLUGINS_TIMEOUT_MS = 4000;

/**
 * Loads the plugins that patch components before Zam's page renders: a patch only reaches
 * the elements created after it. Most accounts have none, and then this doesn't even load
 * the plugin host. One that hangs (a repo plugin fetching its bundle) doesn't hold the app:
 * it finishes loading late, and says what that means.
 */
async function loadEarlyPlugins(): Promise<void> {
  if (earlyPluginIds().length === 0) return;
  markStartup("Loading plugins");
  await Promise.race([
    bootEarlyPlugins().catch((error: unknown) => {
      console.error("[zami] loading plugins before the first render failed", error);
    }),
    new Promise<void>((resolve) => setTimeout(resolve, EARLY_PLUGINS_TIMEOUT_MS)),
  ]);
}

export function Root() {
  // Zam's code starts once its translations are loaded, IndexedDB (the crypto store) is
  // ready and its bundled fonts are loaded; until then, the same splash Zam shows while
  // it restores a session.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    markStartup("Loading storage, translations and fonts");
    void Promise.all([initI18n(), storageReady, fontsReady])
      .then(loadEarlyPlugins)
      .finally(() => setReady(true));
  }, []);
  // From here on, a component patched for the first time has elements on screen that the
  // patch didn't reach.
  useEffect(() => {
    if (ready) markAppRendered();
  }, [ready]);

  return (
    <AppProviders>
      <ThemedStatusBar />
      {ready ? (
        <Layout>
          <Page />
        </Layout>
      ) : (
        <Splash message={null} />
      )}
      <PortalHost />
      <PluginLayers />
      <PluginWebHost />
    </AppProviders>
  );
}

/**
 * The status bar's text in the colour that reads on Zam's theme: dark on the light theme
 * (custom presets are based on one of Zam's themes, so they follow theirs).
 */
function ThemedStatusBar() {
  const { theme } = useUniwind();
  return <StatusBar style={theme === "light" ? "dark" : "light"} />;
}

/**
 * Zam stamps user input from `window` listeners (presence's idle detection, the sync
 * heartbeat), which React Native touches never reach: the root hands Zam's window stand-in
 * (@-/com.leonsilicon.zami.browser) a `touchstart` for every touch anywhere in the app,
 * overlays included.
 */
function reportTouch(): void {
  (globalThis as { __ZAMI_WINDOW__?: Window }).__ZAMI_WINDOW__?.dispatchEvent({
    type: "touchstart",
  } as Event);
}

/**
 * What every screen relies on: gestures, safe-area insets, keyboard tracking and the app's
 * font, on Zam's background. The PortalHost goes last inside it, so overlays get all of
 * them too, and every touch inside it counts as input (reportTouch). The StyleSheetScope
 * is what lets a stylesheet (custom CSS, a plugin's) restyle the views already on screen.
 */
function AppProviders({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <AppFontProvider>
            <StyleSheetScope>
              <View className="flex-1 bg-zam-backgroundTertiary" onTouchStartCapture={reportTouch}>
                {children}
              </View>
            </StyleSheetScope>
          </AppFontProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
