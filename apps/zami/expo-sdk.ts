import type { ExpoPluginModules } from "@-/com.leonsilicon.zami.shell";
import * as Battery from "expo-battery";
import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as KeepAwake from "expo-keep-awake";
import * as Linking from "expo-linking";
import * as Localization from "expo-localization";
import * as Location from "expo-location";
import * as MailComposer from "expo-mail-composer";
import * as Network from "expo-network";
import * as Print from "expo-print";
import * as ScreenOrientation from "expo-screen-orientation";
import { Accelerometer, DeviceMotion, Gyroscope } from "expo-sensors";
import * as Sharing from "expo-sharing";
import * as Speech from "expo-speech";

const motionSensors = new Map<
  string,
  typeof Accelerometer | typeof DeviceMotion | typeof Gyroscope
>([
  ["accelerometer", Accelerometer],
  ["deviceMotion", DeviceMotion],
  ["gyroscope", Gyroscope],
]);

function motionSensor(name: string) {
  const sensor = motionSensors.get(name);
  if (!sensor) throw new Error(`Unknown motion sensor: ${name}`);
  return sensor;
}

async function readMotionSensorAsync(name: string): Promise<unknown> {
  const sensor = motionSensor(name);
  if (!(await sensor.isAvailableAsync())) throw new Error(`${name} is unavailable on this device`);
  let subscription: { remove(): void } | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<unknown>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`No reading received from ${name}`)), 3_000);
      subscription = sensor.addListener(resolve);
    });
  } finally {
    clearTimeout(timeout);
    subscription?.remove();
  }
}

// The WebView calls these by npm package name. Keep the bridge arguments and results
// serializable. Callbacks, React views, and native object handles stay in the host.
export const expoPluginModules = {
  "expo-battery": {
    isAvailableAsync: Battery.isAvailableAsync,
    getBatteryLevelAsync: Battery.getBatteryLevelAsync,
    getBatteryStateAsync: Battery.getBatteryStateAsync,
    getPowerStateAsync: Battery.getPowerStateAsync,
    isLowPowerModeEnabledAsync: Battery.isLowPowerModeEnabledAsync,
  },
  "expo-clipboard": {
    getStringAsync: Clipboard.getStringAsync,
    hasStringAsync: Clipboard.hasStringAsync,
    setStringAsync: Clipboard.setStringAsync,
    getImageAsync: Clipboard.getImageAsync,
    hasImageAsync: Clipboard.hasImageAsync,
    setImageAsync: Clipboard.setImageAsync,
  },
  "expo-crypto": {
    digestStringAsync: Crypto.digestStringAsync,
    randomUUID: Crypto.randomUUID,
  },
  "expo-document-picker": {
    getDocumentAsync: DocumentPicker.getDocumentAsync,
  },
  "expo-haptics": {
    impactAsync: Haptics.impactAsync,
    notificationAsync: Haptics.notificationAsync,
    selectionAsync: Haptics.selectionAsync,
  },
  "expo-image-manipulator": {
    manipulateAsync: ImageManipulator.manipulateAsync,
  },
  "expo-image-picker": {
    getCameraPermissionsAsync: ImagePicker.getCameraPermissionsAsync,
    getMediaLibraryPermissionsAsync: ImagePicker.getMediaLibraryPermissionsAsync,
    requestCameraPermissionsAsync: ImagePicker.requestCameraPermissionsAsync,
    requestMediaLibraryPermissionsAsync: ImagePicker.requestMediaLibraryPermissionsAsync,
    launchCameraAsync: ImagePicker.launchCameraAsync,
    launchImageLibraryAsync: ImagePicker.launchImageLibraryAsync,
  },
  "expo-keep-awake": {
    activateKeepAwakeAsync: KeepAwake.activateKeepAwakeAsync,
    deactivateKeepAwake: KeepAwake.deactivateKeepAwake,
    isAvailableAsync: KeepAwake.isAvailableAsync,
  },
  "expo-linking": {
    canOpenURL: Linking.canOpenURL,
    createURL: Linking.createURL,
    getInitialURL: Linking.getInitialURL,
    openURL: Linking.openURL,
    parse: Linking.parse,
  },
  "expo-localization": {
    getCalendars: Localization.getCalendars,
    getLocales: Localization.getLocales,
  },
  "expo-location": {
    getCurrentPositionAsync: Location.getCurrentPositionAsync,
    getForegroundPermissionsAsync: Location.getForegroundPermissionsAsync,
    getLastKnownPositionAsync: Location.getLastKnownPositionAsync,
    hasServicesEnabledAsync: Location.hasServicesEnabledAsync,
    requestForegroundPermissionsAsync: Location.requestForegroundPermissionsAsync,
  },
  "expo-mail-composer": {
    composeAsync: MailComposer.composeAsync,
    isAvailableAsync: MailComposer.isAvailableAsync,
  },
  "expo-network": {
    getIpAddressAsync: Network.getIpAddressAsync,
    getNetworkStateAsync: Network.getNetworkStateAsync,
  },
  "expo-print": {
    printAsync: Print.printAsync,
    printToFileAsync: Print.printToFileAsync,
  },
  "expo-screen-orientation": {
    getOrientationAsync: ScreenOrientation.getOrientationAsync,
    getOrientationLockAsync: ScreenOrientation.getOrientationLockAsync,
    lockAsync: ScreenOrientation.lockAsync,
    supportsOrientationLockAsync: ScreenOrientation.supportsOrientationLockAsync,
    unlockAsync: ScreenOrientation.unlockAsync,
  },
  "expo-sensors": {
    isAvailableAsync: (name: string) => motionSensor(name).isAvailableAsync(),
    requestPermissionsAsync: (name: string) => motionSensor(name).requestPermissionsAsync(),
    readAsync: readMotionSensorAsync,
  },
  "expo-sharing": {
    shareAsync: Sharing.shareAsync,
    isAvailableAsync: Sharing.isAvailableAsync,
  },
  "expo-speech": {
    getAvailableVoicesAsync: Speech.getAvailableVoicesAsync,
    isSpeakingAsync: Speech.isSpeakingAsync,
    speak: Speech.speak,
    stop: Speech.stop,
  },
} satisfies ExpoPluginModules;
