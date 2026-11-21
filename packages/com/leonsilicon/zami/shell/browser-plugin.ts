// Capacitor's Browser plugin (@capacitor/browser). Zam opens it only for sign-in: legacy
// SSO, OAuth, and sign-in approval pages (`openInAppBrowser`), which all end by redirecting
// to its own scheme. So it opens an authentication session (ASWebAuthenticationSession,
// Custom Tabs), which hands the redirect back as the App plugin's `appUrlOpen`, the way the
// deep link does in Zam's Android app.
import * as WebBrowser from "expo-web-browser";
import { PluginError, type PluginEvents, type ShellPlugin } from "#bridge";

/**
 * The scheme Zam's sign-in redirects to: `NATIVE_SCHEME` in its loginRedirect.ts, which the
 * zam.zami-oauth-client codemod makes Zami's own.
 */
export const LOGIN_SCHEME = "com.leonsilicon.zami";

export function createBrowserPlugin(options: { onRedirect: (url: string) => void }): ShellPlugin {
  let events: PluginEvents | null = null;
  let open = false;

  async function close(): Promise<void> {
    WebBrowser.dismissAuthSession();
    await WebBrowser.dismissBrowser().catch(() => {});
  }

  return {
    name: "Browser",
    methods: {
      open: async ({ url, toolbarColor }) => {
        if (typeof url !== "string" || url === "")
          throw new PluginError("Must provide a URL to open");
        if (open) await close();
        open = true;
        // Resolves when the page is up, as Capacitor's does; the session runs on.
        void WebBrowser.openAuthSessionAsync(
          url,
          `${LOGIN_SCHEME}:/`,
          typeof toolbarColor === "string" ? { toolbarColor } : {},
        )
          .then((result) => {
            if (result.type === "success") options.onRedirect(result.url);
          })
          .catch((error: unknown) => {
            console.warn("[zami] the sign-in browser failed", error);
          })
          .finally(() => {
            open = false;
            events?.emit("browserFinished");
          });
      },
      close: async () => {
        await close();
      },
    },
    start(pluginEvents) {
      events = pluginEvents;
      return () => {
        events = null;
      };
    },
  };
}
