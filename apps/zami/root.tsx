// The app's root: Zam's own routes, the way SvelteKit renders them (the root layout
// around the main page), inside what every screen relies on. Zam is one page; its
// navigation lives in `page.url` (@-/com.leonsilicon.zami.sveltekit).
import { PortalHost } from "@-/com.leonsilicon.zami.rn";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { storageReady } from "#storage";
import Splash from "$lib/components/layout/Splash.svelte";
import { initI18n } from "$lib/i18n";
import { getClient } from "$lib/matrix/client";
import Layout from "../../src/routes/+layout.svelte";
import Page from "../../src/routes/+page.svelte";

// For the debugger (Argent's debugger-evaluate): the running Matrix client.
if (__DEV__) Object.assign(globalThis, { __zamiDebug: { getClient } });

export function Root() {
  // Zam's code starts once its translations are loaded and IndexedDB (the crypto store)
  // is ready; until then, the same splash Zam shows while it restores a session.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void Promise.all([initI18n(), storageReady]).finally(() => setReady(true));
  }, []);

  return (
    <AppProviders>
      <StatusBar style="light" />
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
 * What every screen relies on: gestures, safe-area insets and keyboard tracking, on Zam's
 * background. The PortalHost goes last inside it, so overlays get all of them too.
 */
function AppProviders({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <View className="flex-1 bg-discord-backgroundTertiary">{children}</View>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
