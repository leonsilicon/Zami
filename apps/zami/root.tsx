// The app's root until Zam's routes are ported. Once `src/routes/+layout.svelte.zami.tsx`
// and `src/routes/+page.svelte.zami.tsx` exist, this renders them instead.
//
// It exercises each layer the port depends on: shared logic (`$lib/i18n`), a rune store
// driving React (`$lib/stores/toasts.svelte` through useRune), translated components,
// Zam's Tailwind theme through Uniwind, and Matrix end-to-end encryption.
import "../../src/app.css";
import { PortalHost } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as matrixCrypto from "@matrix-org/matrix-sdk-crypto-wasm";
import { StatusBar } from "expo-status-bar";
import { ShieldCheck } from "lucide-svelte";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Splash from "$lib/components/layout/Splash.svelte";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import { storageReady } from "#storage";
import { initI18n, t } from "$lib/i18n";
import { getClient, login, startSync } from "$lib/matrix/client";
import { auth, saveSession } from "$lib/stores/auth.svelte";
import { showToast, toastsState } from "$lib/stores/toasts.svelte";

function Checks() {
  const toasts = useRune(() => toastsState.toasts);
  const [toggled, setToggled] = useState(false);
  const [crypto, setCrypto] = useState("loading…");

  useEffect(() => {
    matrixCrypto
      .initAsync()
      .then(() => {
        const versions = matrixCrypto.getVersions();
        setCrypto(
          `vodozemac ${versions.vodozemac}, matrix-sdk-crypto ${versions.matrix_sdk_crypto}`,
        );
      })
      .catch((error: unknown) => setCrypto(`failed: ${String(error)}`));
  }, []);

  return (
    <View className="gap-4 p-6">
      <View className="flex-row items-center gap-2">
        <ShieldCheck size={20} className="text-discord-accent" />
        <Text className="text-lg font-semibold text-discord-textPrimary">Zami preview</Text>
      </View>
      <Text className="text-discord-textMuted">i18n: {t("splash.restoringSession")}</Text>
      <Text className="text-discord-textMuted" testID="crypto-status">
        Encryption: {crypto}
      </Text>
      <View className="flex-row items-center gap-3">
        <ToggleSwitch checked={toggled} onChange={setToggled} label="Demo toggle" />
        <Text className="text-discord-textPrimary">Toggle is {toggled ? "on" : "off"}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        className="self-start rounded bg-discord-accent px-3 py-2"
        onPress={() => showToast(`Toast #${toasts.length + 1}`, { sticky: true })}
      >
        <Text className="text-white">Show a toast</Text>
      </Pressable>
      <Text className="text-discord-textMuted" testID="toast-count">
        Toasts in the Svelte store: {toasts.length}
      </Text>
      {__DEV__ ? <DevSignIn /> : null}
    </View>
  );
}

/**
 * Development only: signs in to a local Synapse (`docker run … matrixdotorg/synapse`
 * on :8008, user `alice`) through Zam's own sign-in and sync code, as the login page
 * does, to exercise Zam's logic on device before its pages are ported.
 */
// For the debugger (Argent's debugger-evaluate): the running Matrix client.
if (__DEV__) Object.assign(globalThis, { __zamiDebug: { getClient } });

function DevSignIn() {
  const [status, setStatus] = useState("signed out");
  const syncState = useRune(() => auth.syncState);
  // AppShell fills Zam's room lists; until it's ported, ask the client directly.
  const [rooms, setRooms] = useState<string[]>([]);
  useEffect(() => {
    const timer = setInterval(() => {
      try {
        setRooms(
          (getClient()?.getRooms() ?? []).map((room) => `${room.name} (${room.getMyMembership()})`),
        );
      } catch {
        // No client yet.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  async function signIn() {
    try {
      setStatus("signing in…");
      const result = await login("http://localhost:8008", "alice", "zami-test-password", true);
      saveSession({
        userId: result.userId,
        accessToken: result.accessToken,
        deviceId: result.deviceId,
        homeserverUrl: result.homeserverUrl,
      });
      setStatus(`signed in as ${result.userId}; starting sync…`);
      await startSync((state) => {
        auth.syncState = state;
      });
      setStatus(`signed in as ${result.userId}`);
    } catch (error) {
      setStatus(
        `failed: ${error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)}`,
      );
    }
  }

  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        className="self-start rounded bg-discord-backgroundSecondary px-3 py-2"
        onPress={() => void signIn()}
      >
        <Text className="text-discord-textPrimary">Dev: sign in as alice</Text>
      </Pressable>
      <Text className="text-discord-textMuted" testID="dev-sign-in-status">
        {status}
      </Text>
      <Text className="text-discord-textMuted" testID="dev-sync-state">
        Sync: {syncState ?? "none"}, rooms: {rooms.length}
      </Text>
      <Text className="text-discord-textMuted" testID="dev-rooms">
        {rooms.join(", ")}
      </Text>
    </View>
  );
}

export function Root() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void Promise.all([initI18n(), storageReady]).finally(() => setReady(true));
  }, []);

  return (
    <AppProviders>
      <StatusBar style="light" />
      {ready ? (
        <View className="flex-1 pt-16">
          <Checks />
          <View className="h-40">
            <Splash message={null} />
          </View>
        </View>
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
