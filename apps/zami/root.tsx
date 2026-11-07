// The app's root: Zam's own routes, the way SvelteKit renders them (the root layout
// around the main page), inside what every screen relies on. Zam is one page; its
// navigation lives in `page.url` (@-/com.leonsilicon.zami.sveltekit).
import { AppFontProvider } from "@-/com.leonsilicon.zami.fonts";
import { PortalHost } from "@-/com.leonsilicon.zami.rn";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { fontsReady } from "#fonts";
import { storageReady } from "#storage";
import Splash from "$lib/components/layout/Splash.svelte";
import { initI18n } from "$lib/i18n";
import { getClient } from "$lib/matrix/client";
import Layout from "../../src/routes/+layout.svelte";
import Page from "../../src/routes/+page.svelte";

// For the debugger (Argent's debugger-evaluate): the running Matrix client.
if (__DEV__) Object.assign(globalThis, { __zamiDebug: { getClient } });

export function Root() {
  // Zam's code starts once its translations are loaded, IndexedDB (the crypto store) is
  // ready and its bundled fonts are loaded; until then, the same splash Zam shows while
  // it restores a session.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void Promise.all([initI18n(), storageReady, fontsReady]).finally(() => setReady(true));
  }, []);

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
 * them too, and every touch inside it counts as input (reportTouch).
 */
function AppProviders({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <AppFontProvider>
            <View
              className="flex-1 bg-discord-backgroundTertiary"
              onTouchStartCapture={reportTouch}
            >
              {children}
            </View>
          </AppFontProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
