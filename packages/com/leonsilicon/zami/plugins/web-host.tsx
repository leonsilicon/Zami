// The WebViews behind the open web contexts (#web-context), rendered once at the app's
// root. Each is a real page in the view hierarchy, one point square and fully transparent:
// a WebView that is detached, hidden or of no size is one both platforms may stop running
// scripts in, and this one has to keep running them while nobody sees it.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import {
  subscribeWebContexts,
  webContexts,
  type WebContextPage,
  type WebContextRecord,
} from "#web-context";

const styles = StyleSheet.create({
  // Under everything the app draws after it, and no touch reaches it.
  host: { position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0 },
  page: { position: "absolute", left: 0, top: 0, width: 1, height: 1 },
  webView: { flex: 1, backgroundColor: "transparent" },
});

function ContextView({ record }: { record: WebContextRecord }): ReactNode {
  // (WebView's props are `WebViewProps & P`, and P defaults to undefined.)
  const webView = useRef<WebView<object>>(null);
  const page = useRef<WebContextPage | null>(null);
  // This WebView's identity, for the context: an effect that runs again (Fast Refresh)
  // attaches the same WebView, and a remount attaches another one.
  const mount = useRef({}).current;

  useEffect(() => {
    const attached = record.attach(
      { inject: (script) => webView.current?.injectJavaScript(script) },
      mount,
    );
    page.current = attached;
    return () => {
      page.current = null;
      // If this is the unmount, the WebView goes with this component, and the page with it.
      attached.detach();
    };
  }, [record, mount]);

  return (
    <View style={styles.page}>
      <WebView<object>
        ref={webView}
        source={record.source}
        // The bridge goes in before the page's own scripts (for a page loaded from a URL;
        // one given as HTML also carries it as its first script), and the context's
        // script runs once the page has loaded.
        injectedJavaScriptBeforeContentLoaded={record.install}
        injectedJavaScript={record.start}
        onMessage={(event) => page.current?.message(event.nativeEvent.data)}
        onLoadStart={() => page.current?.loading()}
        onError={(event) =>
          page.current?.terminated(`its page failed to load (${event.nativeEvent.description})`)
        }
        // iOS ends a page's process under memory pressure (often while the app is in the
        // background); Android's renderer can crash or be killed. Either way the page and
        // everything in it are gone.
        onContentProcessDidTerminate={() =>
          page.current?.terminated("the system ended its page's process")
        }
        onRenderProcessGone={(event) =>
          page.current?.terminated(
            event.nativeEvent.didCrash
              ? "its page's process crashed"
              : "the system ended its page's process",
          )
        }
        // The page stays in the WebView wherever it goes: a URL outside the whitelist
        // would be handed to the system to open.
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        // Sound and video without a tap: nobody can tap a page that's out of sight.
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowsLinkPreview={false}
        allowsBackForwardNavigationGestures={false}
        dataDetectorTypes="none"
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        // Safari's and Chrome's inspectors can open the page of a development build.
        webviewDebuggingEnabled={__DEV__}
        style={styles.webView}
      />
    </View>
  );
}

/**
 * Renders the open web contexts' pages, out of sight. Render it once, anywhere that stays
 * mounted for the app's lifetime: a context's page lives exactly as long as its WebView
 * here does. It renders nothing while no context is open.
 */
export function PluginWebHost(): ReactNode {
  const records = useSyncExternalStore(subscribeWebContexts, webContexts, webContexts);
  if (records.length === 0) return null;
  return (
    <View
      style={styles.host}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {records.map((record) => (
        <ContextView key={record.id} record={record} />
      ))}
    </View>
  );
}
