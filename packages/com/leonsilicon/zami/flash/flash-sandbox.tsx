import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { isSandboxPage, parseFrameMessage } from "#messages";
import { prepareSandbox, type SandboxPage } from "#sandbox";

/** The frame's side of Zam's MessagePort: what the app posts to the page. */
export interface FlashSandboxHandle {
  /**
   * Posts `message` to the page, as JSON. An ArrayBuffer in it (the SWF) travels as
   * base64, which the page turns back into bytes.
   */
  postMessage(message: Record<string, unknown>): void;
}

export interface FlashSandboxProps {
  ref?: Ref<FlashSandboxHandle>;
  /** The page has loaded (the iframe's `load`): it's ready for "init". */
  onLoad?: () => void;
  /** A message the page posted (its MessagePort's), as an object to check. */
  onMessage?: (message: Record<string, unknown>) => void;
  /** Something in the page tried to navigate it away (blocked). */
  onNavigate?: (url: string) => void;
  /** The frame's classes (its box); the page fills it. */
  className?: string;
  /** The iframe's `title`. */
  accessibilityLabel?: string;
}

/** `btoa` over the bytes, a chunk at a time (a call can't take millions of arguments). */
function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/**
 * Zam's Flash sandbox (an iframe of static/flash-sandbox/ with sandbox="allow-scripts")
 * as a WebView playing Ruffle from local files: a page that can read only its own
 * directory (the page, its script, Ruffle), loads nothing from the network (its CSP),
 * keeps no storage (a non-persistent data store), opens no windows, and never navigates:
 * every other load is refused, and reported as `onNavigate` when it would have replaced
 * the page. The app's only channel to it is `postMessage` and `onMessage`.
 */
export function FlashSandbox({
  ref,
  onLoad,
  onMessage,
  onNavigate,
  className,
  accessibilityLabel,
}: FlashSandboxProps) {
  // (WebView's props are `WebViewProps & P`, and P defaults to undefined.)
  const webView = useRef<WebView<object>>(null);
  const [page, setPage] = useState<SandboxPage | null>(null);

  useEffect(() => {
    let live = true;
    prepareSandbox().then(
      (prepared) => {
        if (live) setPage(prepared);
      },
      (error: unknown) => console.error("[flash] could not set up Flash's sandbox", error),
    );
    return () => {
      live = false;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      postMessage(message) {
        webView.current?.postMessage(
          JSON.stringify(message, (_key, value: unknown) =>
            value instanceof ArrayBuffer ? base64Of(value) : value,
          ),
        );
      },
    }),
    [],
  );

  const shouldStart = (request: ShouldStartLoadRequest): boolean => {
    if (page !== null && isSandboxPage(request.url, page.uri)) return true;
    // Downloads and blank frames are only refused; leaving the page is reported.
    if (request.isTopFrame !== false && !/^(about|blob|data):/.test(request.url)) {
      onNavigate?.(request.url);
    }
    return false;
  };

  const message = (event: WebViewMessageEvent) => {
    const parsed = parseFrameMessage(event.nativeEvent.data);
    if (parsed !== null) onMessage?.(parsed);
  };

  return (
    <View
      className={className}
      accessibilityLabel={accessibilityLabel}
      // Touches on the movie are the page's (as in an iframe), not an enclosing
      // Pressable's; the WebView gets them natively either way.
      onStartShouldSetResponder={() => true}
    >
      {page === null ? null : (
        <WebView<object>
          ref={webView}
          source={{ uri: page.uri }}
          allowingReadAccessToURL={page.directory}
          allowFileAccess
          allowFileAccessFromFileURLs
          // Every URL reaches shouldStart, which refuses all but the page: a URL outside
          // the whitelist would be handed to the system to open.
          originWhitelist={["*"]}
          onShouldStartLoadWithRequest={shouldStart}
          onMessage={message}
          onLoad={() => onLoad?.()}
          incognito
          cacheEnabled={false}
          // `allow="autoplay"`: the SWF's sound starts without another tap.
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
          style={{ flex: 1, backgroundColor: "#000" }}
        />
      )}
    </View>
  );
}
