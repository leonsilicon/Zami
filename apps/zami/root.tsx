import { ZamiShell } from "@-/com.leonsilicon.zami.shell";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { expoPluginModules } from "#expo-sdk";

export function Root() {
  return (
    <SafeAreaProvider>
      <ZamiShell expoPluginModules={expoPluginModules} />
    </SafeAreaProvider>
  );
}
