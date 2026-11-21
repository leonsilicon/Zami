// Capacitor's App plugin (@capacitor/app): the app's state, deep links and Android's back
// button. Zam uses it for sign-in callbacks (`appUrlOpen`, `getLaunchUrl`) and the back
// button.
import * as Application from "expo-application";
import { AppState, BackHandler, Linking, Platform } from "react-native";
import type { PluginEvents, ShellPlugin } from "#bridge";

export interface AppPlugin {
  plugin: ShellPlugin;
  /**
   * Hands a URL the app was opened with to Zam (`appUrlOpen`), once: a sign-in callback can
   * arrive both from the browser session and as a deep link.
   */
  openUrl(url: string): void;
}

/** How long a URL counts as already handed over. */
const DUPLICATE_URL_MS = 10_000;

export function createAppPlugin(options: { canGoBack: () => boolean }): AppPlugin {
  let events: PluginEvents | null = null;
  let backButtonHandled = true;
  const recentUrls = new Map<string, number>();

  function openUrl(url: string): void {
    const now = Date.now();
    for (const [seen, at] of recentUrls) if (now - at > DUPLICATE_URL_MS) recentUrls.delete(seen);
    if (recentUrls.has(url)) return;
    recentUrls.set(url, now);
    events?.emit("appUrlOpen", { url }, { retain: true });
  }

  const plugin: ShellPlugin = {
    name: "App",
    methods: {
      getInfo: () => ({
        name: Application.applicationName ?? "Zami",
        id: Application.applicationId ?? "",
        build: Application.nativeBuildVersion ?? "",
        version: Application.nativeApplicationVersion ?? "",
      }),
      getState: () => ({ isActive: AppState.currentState === "active" }),
      getLaunchUrl: async () => {
        const url = await Linking.getInitialURL();
        return url ? { url } : undefined;
      },
      // iOS has no way for an app to quit or hide itself.
      exitApp: () => {
        if (Platform.OS === "android") BackHandler.exitApp();
      },
      minimizeApp: () => {
        if (Platform.OS === "android") BackHandler.exitApp();
      },
      toggleBackButtonHandler: ({ enabled }) => {
        backButtonHandled = enabled !== false;
      },
    },
    start(pluginEvents) {
      events = pluginEvents;
      let active = AppState.currentState === "active";
      const state = AppState.addEventListener("change", (next) => {
        const isActive = next === "active";
        if (isActive === active) return;
        active = isActive;
        pluginEvents.emit("appStateChange", { isActive });
        pluginEvents.emit(isActive ? "resume" : "pause");
      });
      const links = Linking.addEventListener("url", ({ url }) => openUrl(url));
      // With no listener (or with it turned off), the back button does what it does in
      // any app.
      const back = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!backButtonHandled || pluginEvents.listenerCount("backButton") === 0) return false;
        pluginEvents.emit("backButton", { canGoBack: options.canGoBack() });
        return true;
      });
      return () => {
        state.remove();
        links.remove();
        back.remove();
        events = null;
      };
    },
  };
  return { plugin, openUrl };
}
