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
