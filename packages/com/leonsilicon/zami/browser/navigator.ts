// `navigator` for Zam's code: React Native's, plus the language, online state, clipboard
// and vibration Zam reads from a browser's. What Zam feature-detects and React Native
// lacks (service workers, media devices, storage, locks, geolocation) stays undefined.
import * as Clipboard from "expo-clipboard";
import { getLocales } from "expo-localization";
import { Platform, Vibration } from "react-native";

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
  vibrate: (pattern: number | number[]): boolean => {
    Vibration.vibrate(pattern);
    return true;
  },
};

export const zamiNavigator: Navigator = new Proxy(globalThis.navigator ?? {}, {
  get(target, key) {
    if (key in extras) {
      const descriptor = Object.getOwnPropertyDescriptor(extras, key);
      return descriptor?.get ? descriptor.get.call(extras) : extras[key];
    }
    return Reflect.get(target, key);
  },
  has: (target, key) => key in extras || Reflect.has(target, key),
}) as Navigator;
