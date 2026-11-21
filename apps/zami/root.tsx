import { ZamiShell } from "@-/com.leonsilicon.zami.shell";
import { SafeAreaProvider } from "react-native-safe-area-context";

export function Root() {
  return (
    <SafeAreaProvider>
      <ZamiShell />
    </SafeAreaProvider>
  );
}
