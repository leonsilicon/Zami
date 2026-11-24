// The app: Zam's web app in one WebView, inside the safe area, with Capacitor's native side
// (bridge.ts) behind it. Zam's code runs unmodified; what makes it a native app is here and
// in the plugins.
import * as Application from "expo-application";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Linking,
  Platform,
  processColor,
  StyleSheet,
  Text,
  View,
  type KeyboardEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { createAppPlugin } from "#app-plugin";
import { bootstrapScript } from "#bootstrap";
import { Bridge, resultScript } from "#bridge";
import { createBrowserPlugin } from "#browser-plugin";
import { createShellDebug, receiveDebug } from "#debug";
import { readLaunchPage, saveLaunchPage } from "#launch-store";
import { ZamiShellNative } from "#native";
import { createPreferencesPlugin } from "#preferences-plugin";
import { parsePageMessage, type BottomInsetMessage } from "#protocol";
import { createPushNotificationsPlugin } from "#push-notifications-plugin";
import { createUnifiedPushPlugin } from "#unified-push-plugin";
import { createZamiPlugin } from "#zami-plugin";

/** Zami Paper’s initial color, until the page reports the saved appearance. */
const DEFAULT_THEME = "#f3ede0";

/**
 * No links made of phone numbers and addresses (Zam makes its own). An array, as Android
 * hands a string straight to a native prop that wants one; one array, as a new one each
 * render warns that the prop changed.
 */
const NO_DATA_DETECTORS: ["none"] = ["none"];

/**
 * Whether Safari's Web Inspector (iOS) or Chrome's DevTools (Android) can attach to the page:
 * in development, and in the staging app ("(S) Zami"), so a launch or a stall on a real
 * account can be profiled from TestFlight builds. Not in the production app.
 */
const INSPECTABLE = __DEV__ || (Application.applicationId?.endsWith(".staging") ?? false);

/**
 * Where the web app comes from: in a debug build, EXPO_PUBLIC_ZAMI_WEB_URL (`vpx _web serve`
 * on this machine) if set, so a new web build needs no native rebuild; otherwise the build
 * in the app's bundle.
 */
function webAppSource(): { url: string; bundled: boolean } | null {
  const devUrl = __DEV__ ? process.env.EXPO_PUBLIC_ZAMI_WEB_URL : undefined;
  if (devUrl) return { url: devUrl, bundled: false };
  const bundled = ZamiShellNative.webAppURL();
  return bundled === null ? null : { url: bundled, bundled: true };
}

/**
 * `scheme://host[:port]` of a URL. (`new URL(url).origin` is "null" for a scheme the URL
 * standard doesn't know, such as the bundled app's zami:.)
 */
export function originOf(url: string): string | null {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url)?.[0]?.toLowerCase() ?? null;
}

/** Whether a colour (#rgb or #rrggbb) is light, for the status bar's text. */
export function isLight(color: string): boolean {
  const hex = color.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 160;
}

/** The keyboard's height over the window, as it changes. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = (event: KeyboardEvent) => setHeight(event.endCoordinates.height);
    const hide = () => setHeight(0);
    const subscriptions =
      Platform.OS === "ios"
        ? [
            Keyboard.addListener("keyboardWillChangeFrame", show),
            Keyboard.addListener("keyboardWillHide", hide),
          ]
        : [
            Keyboard.addListener("keyboardDidShow", show),
            Keyboard.addListener("keyboardDidHide", hide),
          ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);
  return height;
}

export function ZamiShell() {
  // WebView's props are `WebViewProps & P`, and P defaults to undefined (so: never).
  const webView = useRef<WebView<object>>(null);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [bottomInsetSurfaces, setBottomInsetSurfaces] = useState<BottomInsetMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const canGoBack = useRef(false);
  const source = useMemo(webAppSource, []);

  const { bridge, script, config } = useMemo(() => {
    const app = createAppPlugin({ canGoBack: () => canGoBack.current });
    const bridge = new Bridge(
      [
        app.plugin,
        createBrowserPlugin({ onRedirect: (url) => app.openUrl(url) }),
        createPreferencesPlugin(),
        createPushNotificationsPlugin(),
        // Public iOS builds load only built-ins and have no general-purpose native bridge.
        ...(Platform.OS === "ios" && !__DEV__ ? [] : [createZamiPlugin()]),
        // Only Zam's Android code asks it (where Capacitor's platform is "android").
        ...(Platform.OS === "android" ? [createUnifiedPushPlugin()] : []),
      ],
      (result) => webView.current?.injectJavaScript(resultScript(result)),
    );
    const config = {
      platform: Platform.OS,
      appId: Application.applicationId,
      headers: bridge.headers,
    };
    // With the app as it last looked, which the page draws before its own code has loaded.
    const script = bootstrapScript({ ...config, launchPage: readLaunchPage() });
    // Served to the bundled web app's pages before anything else they run.
    ZamiShellNative.setStartScript(script);
    return { bridge, script, config };
  }, []);

  useEffect(() => bridge.start(), [bridge]);

  const debug = useMemo(
    () =>
      __DEV__ ? createShellDebug((script) => webView.current?.injectJavaScript(script)) : null,
    [],
  );
  useEffect(() => {
    if (debug === null) return;
    Object.assign(globalThis, { __zamiShell: debug });
  }, [debug]);

  const origin = source === null ? null : originOf(source.url);

  function onMessage(event: WebViewMessageEvent): void {
    const message = parsePageMessage(event.nativeEvent.data);
    if (message === null) return;
    if (message.type === "capacitor") void bridge.call(message);
    else if (message.event === "theme") setTheme(message.color);
    else if (message.event === "launchPage") {
      saveLaunchPage(message.page);
      // A page that loads again in this run (a reload, a new web process) opens on it too.
      ZamiShellNative.setStartScript(bootstrapScript({ ...config, launchPage: message.page }));
    }
    // The launch frame is on screen: show it, without waiting for the page to finish loading.
    else if (message.event === "launchDrawn") setLoaded(true);
    else if (message.event === "bottomInset") {
      const visible =
        message.width > 0 && message.opacity > 0 && processColor(message.color) != null;
      setBottomInsetSurfaces((surfaces) => {
        const remaining = surfaces.filter((surface) => surface.id !== message.id);
        return visible ? [...remaining, message] : remaining;
      });
    } else if (debug !== null) receiveDebug(debug, message);
  }

  // The app's own pages and what they embed load here; any other page opens in its app.
  function onShouldStartLoad(request: ShouldStartLoadRequest): boolean {
    const { url } = request;
    if (!request.isTopFrame) return true;
    if (url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:")) return true;
    if (origin !== null && (url === origin || url.startsWith(`${origin}/`))) return true;
    void Linking.openURL(url).catch(() => {});
    return false;
  }

  if (source === null) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: DEFAULT_THEME }]}>
        <Text style={styles.message}>
          This build has no web app in it. Build it with `vpx _web build` and rebuild the app.
        </Text>
      </View>
    );
  }

  // The web view sits in the safe area (Zam's layout doesn't pad for a notch), and its
  // bottom edge follows the keyboard, so Zam's layout shrinks instead of scrolling away.
  const bottom = Math.max(insets.bottom, keyboardHeight);
  return (
    <View style={[styles.fill, { backgroundColor: theme }]}>
      <StatusBar style={isLight(theme) ? "dark" : "light"} />
      <View
        style={[
          styles.fill,
          {
            marginTop: insets.top,
            marginBottom: bottom,
            marginLeft: insets.left,
            marginRight: insets.right,
          },
        ]}
      >
        <WebView<object>
          ref={webView}
          source={{ uri: source.url }}
          style={styles.web}
          containerStyle={styles.web}
          originWhitelist={["*"]}
          // The bundled app gets the bootstrap from its own origin (native.ts); a dev URL
          // gets it as a document-start script.
          {...(source.bundled ? {} : { injectedJavaScriptBeforeContentLoaded: script })}
          onMessage={onMessage}
          onLoadStart={(event) => {
            if (origin !== null && event.nativeEvent.url.startsWith(origin)) {
              bridge.reset();
              setBottomInsetSurfaces([]);
            }
          }}
          onLoadEnd={() => setLoaded(true)}
          onError={(event) => {
            console.warn(
              "[zami-shell] the web app didn't load",
              event.nativeEvent.url,
              event.nativeEvent.description,
            );
          }}
          onHttpError={(event) => {
            console.warn(
              "[zami-shell] HTTP error",
              event.nativeEvent.url,
              event.nativeEvent.statusCode,
            );
          }}
          onNavigationStateChange={(state) => {
            canGoBack.current = state.canGoBack;
          }}
          onShouldStartLoadWithRequest={onShouldStartLoad}
          onOpenWindow={(event) => {
            void Linking.openURL(event.nativeEvent.targetUrl).catch(() => {});
          }}
          setSupportMultipleWindows
          javaScriptCanOpenWindowsAutomatically
          // The web content process can be killed in the background: start it again.
          onContentProcessDidTerminate={() => webView.current?.reload()}
          onRenderProcessGone={() => webView.current?.reload()}
          // Zam scrolls its own panes; the page itself never moves.
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          allowsBackForwardNavigationGestures={false}
          allowsLinkPreview={false}
          pullToRefreshEnabled={false}
          hideKeyboardAccessoryView
          keyboardDisplayRequiresUserAction={false}
          dataDetectorTypes={NO_DATA_DETECTORS}
          textZoom={100}
          // Calls, voice messages and media.
          allowsInlineMediaPlayback
          allowsPictureInPictureMediaPlayback
          allowsAirPlayForMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="prompt"
          allowsProtectedMedia
          geolocationEnabled
          webviewDebuggingEnabled={INSPECTABLE}
          applicationNameForUserAgent="Zami"
        />
      </View>
      {bottomInsetSurfaces.length > 0 && insets.bottom > 0 && keyboardHeight <= insets.bottom ? (
        <View
          pointerEvents="none"
          style={[
            styles.bottomInset,
            { left: insets.left, right: insets.right, height: insets.bottom },
          ]}
        >
          {bottomInsetSurfaces.map((surface) => (
            <View
              key={surface.id}
              style={[
                styles.bottomInsetSurface,
                {
                  width: surface.width,
                  backgroundColor: surface.color,
                  opacity: surface.opacity,
                  zIndex: surface.kind === "drawer" ? 0 : surface.id,
                },
              ]}
            />
          ))}
        </View>
      ) : null}
      {loaded ? null : <View style={[StyleSheet.absoluteFill, { backgroundColor: theme }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: 24 },
  web: { flex: 1, backgroundColor: "transparent" },
  bottomInset: { position: "absolute", bottom: 0, overflow: "hidden" },
  bottomInsetSurface: { position: "absolute", top: 0, bottom: 0, left: 0 },
  message: { color: "#dbdee1", fontSize: 16, textAlign: "center" },
});
