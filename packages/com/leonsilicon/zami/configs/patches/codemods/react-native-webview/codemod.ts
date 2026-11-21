import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

/**
 * Hooks for @-/com.leonsilicon.zami.shell, which serves Zam's web app from the app's bundle
 * at an origin of its own (zami://localhost on iOS, https://localhost on Android): a secure
 * context with its own storage, which a file:// URL isn't. react-native-webview has no way
 * to serve one, so it gets a hook on each platform, and the shell's native module does the
 * serving:
 *
 * - iOS: it posts `RNCWebViewWillCreateWebView` with each WKWebViewConfiguration before
 *   the WKWebView is created; the shell registers its URL scheme handler on it.
 * - Android: its WebViewClient asks `RNCWebViewClient.requestInterceptor` about each request
 *   before the network; the shell answers the ones for its origin.
 */
export default function codemod(root: SgRoot): string | null {
  const filename = root.filename();

  if (filename.endsWith("/RNCWebViewImpl.m")) {
    return editNodes(root, [
      {
        // tree-sitter-cpp reads Objective-C as one ERROR node at the root.
        kinds: ["translation_unit", "ERROR"],
        contains: "- (WKWebViewConfiguration *)setUpWkWebViewConfig",
        from: "\n  return wkWebViewConfig;\n}\n\n- (void)didMoveToWindow",
        to:
          "\n  // Zami (patches/react-native-webview): lets the app register URL scheme handlers.\n" +
          '  [[NSNotificationCenter defaultCenter] postNotificationName:@"RNCWebViewWillCreateWebView"\n' +
          "                                                      object:wkWebViewConfig];\n" +
          "\n  return wkWebViewConfig;\n}\n\n- (void)didMoveToWindow",
        marker: "RNCWebViewWillCreateWebView",
      },
      {
        kinds: ["translation_unit", "ERROR"],
        contains: "didReceiveScriptMessage:(WKScriptMessage *)message",
        from: "if ([message.name isEqualToString:MessageHandlerName]) {\n    if (_onMessage) {",
        to: "if ([message.name isEqualToString:MessageHandlerName]) {\n    if (_onMessage && message.frameInfo.isMainFrame) {",
        marker: "if (_onMessage && message.frameInfo.isMainFrame)",
      },
    ]);
  }

  if (filename.endsWith("/RNCWebView.java")) {
    return editNodes(root, [
      {
        kinds: ["method_declaration"],
        contains: "public void onPostMessage(",
        from: "onMessage(message.getData(), sourceOrigin.toString());",
        to: "onMessage(message.getData(), sourceOrigin.toString(), isMainFrame);",
        marker: "onMessage(message.getData(), sourceOrigin.toString(), isMainFrame);",
      },
      {
        kinds: ["method_declaration"],
        contains: "public void onMessage(String message, String sourceUrl",
        from: "public void onMessage(String message, String sourceUrl)",
        to: "public void onMessage(String message, String sourceUrl, boolean isMainFrame)",
        marker: "public void onMessage(String message, String sourceUrl, boolean isMainFrame)",
      },
      {
        kinds: ["method_declaration"],
        contains: "public void onMessage(String message, String sourceUrl",
        from: 'data.putString("data", message);',
        to: 'data.putString("data", message);\n                    data.putBoolean("isMainFrame", isMainFrame);',
        marker: 'data.putBoolean("isMainFrame", isMainFrame);',
      },
      {
        kinds: ["method_declaration"],
        contains: "public void postMessage(String message)",
        from: "onMessage(message, mWebView.getUrl())",
        to: "onMessage(message, mWebView.getUrl(), false)",
        marker: "onMessage(message, mWebView.getUrl(), false)",
      },
    ]);
  }

  if (filename.endsWith("/RNCWebViewClient.java")) {
    return editNodes(root, [
      {
        kinds: ["class_declaration"],
        contains: "public class RNCWebViewClient extends WebViewClient {",
        from: "public class RNCWebViewClient extends WebViewClient {\n",
        to: `public class RNCWebViewClient extends WebViewClient {
    /**
     * Zami (patches/react-native-webview): answers a request before the network does, such
     * as one for the app's own web app, which it serves from its assets. Null when nothing
     * did. Set by @-/com.leonsilicon.zami.shell.
     */
    public interface RequestInterceptor {
        @Nullable
        WebResourceResponse intercept(WebView view, WebResourceRequest request);
    }

    public static volatile @Nullable RequestInterceptor requestInterceptor = null;

    @Override
    public @Nullable WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        RequestInterceptor interceptor = requestInterceptor;
        if (interceptor != null) {
            WebResourceResponse response = interceptor.intercept(view, request);
            if (response != null) return response;
        }
        return super.shouldInterceptRequest(view, request);
    }

`,
        marker: "RequestInterceptor requestInterceptor",
      },
    ]);
  }

  throw new Error(`react-native-webview codemod: unexpected file ${filename}`);
}
