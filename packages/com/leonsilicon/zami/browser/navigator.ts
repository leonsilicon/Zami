// `navigator` for Zam's code: React Native's, plus the language, online state, clipboard
// vibration and geolocation Zam reads from a browser's. What Zam feature-detects and
// React Native lacks (service workers, media devices, storage, locks) stays undefined.
import * as Clipboard from "expo-clipboard";
import { getLocales } from "expo-localization";
import { Platform, Vibration } from "react-native";
import { geolocation } from "#geolocation";

const languages = (): string[] => getLocales().map((locale) => locale.languageTag);

const extras: Record<PropertyKey, unknown> = {
  get language(): string {
    return languages()[0] ?? "en-US";
  },
  get languages(): string[] {
    return languages();
  },
  onLine: true,
  userAgent: `Zami (${Platform.OS} ${String(Platform.Version)}) ReactNative`,
  platform: Platform.OS === "ios" ? "iPhone" : "Linux armv8l",
  maxTouchPoints: 5,
  clipboard: {
    writeText: (text: string): Promise<boolean> => Clipboard.setStringAsync(text),
    readText: (): Promise<string> => Clipboard.getStringAsync(),
  },
  geolocation,
  vibrate: (pattern: number | number[]): boolean => {
    Vibration.vibrate(pattern);
    return true;
  },
};

// The proxy's target is a plain object that forwards to React Native's navigator, so
// none of that object's own property invariants apply to the extras.
const native = (globalThis.navigator ?? {}) as unknown as Record<PropertyKey, unknown>;
export const zamiNavigator: Navigator = new Proxy({} as Navigator, {
  get(_target, key) {
    if (key in extras) {
      const descriptor = Object.getOwnPropertyDescriptor(extras, key);
      return descriptor?.get ? descriptor.get.call(extras) : extras[key];
    }
    return native[key];
  },
  has: (_target, key) => key in extras || key in native,
});
