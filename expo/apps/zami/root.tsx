// The app's root until Zam's routes are ported. Once `src/routes/+layout.svelte.expo.tsx`
// and `src/routes/+page.svelte.expo.tsx` exist, this renders them instead.
//
// It exercises each layer the port depends on: shared logic (`$lib/i18n`), a rune store
// driving React (`$lib/stores/toasts.svelte` through useRune), translated components,
// Zam's Tailwind theme through Uniwind, and Matrix end-to-end encryption.
import "../../../src/app.css";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as matrixCrypto from "@matrix-org/matrix-sdk-crypto-wasm";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Splash from "$lib/components/layout/Splash.svelte";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import { initI18n, t } from "$lib/i18n";
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
      <Text className="text-lg font-semibold text-discord-textPrimary">Zami preview</Text>
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
    </View>
  );
}

export function Root() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void initI18n().finally(() => setReady(true));
  }, []);

  return (
    <View className="flex-1 bg-discord-backgroundTertiary">
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
    </View>
  );
}
