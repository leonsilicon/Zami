// How a browser-based sign-in (legacy SSO or native OAuth) leaves the app and
// comes back, per runtime. Shared so both flows ride the same three channels:
//   - web:      this origin (full page load)
//   - Electron: the system browser hits the app's local server at
//               `/sso-callback`, which forwards it over IPC (electron/main.cjs)
//   - Android:  an in-app browser (Custom Tab) over the app, which the
//               `moe.crafty.matrix:` deep link (AndroidManifest.xml) closes
//               by bringing the singleTask activity back to the front

import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

/** Custom URL scheme the Android app owns (AndroidManifest.xml). */
export const NATIVE_SCHEME = "moe.crafty.matrix";

// Zami: the Expo app's own URL scheme (apps/zami/app.json), which its sign-in
// pages return to.
export const ZAMI_SCHEME = "zami";

// Zami: the scheme OAuth sign-in returns to: the Expo app's bundle id, the
// reverse of its `client_uri`'s host (zami.leonsilicon.com), as the Matrix
// Authentication Service requires of a native client (oauth.ts).
export const ZAMI_OAUTH_SCHEME = "com.leonsilicon.zami";

/**
 * Zami: whether this is the Expo app. Capacitor is a stand-in there
 * (`isNativePlatform()` is false), but sign-in still opens over the app and
 * returns to its scheme, as on Android, instead of navigating a page away.
 */
export function isZamiNative(): boolean {
    return (
        typeof navigator !== "undefined" && navigator.product === "ReactNative"
    );
}

// Zami: the callbacks listenForLoginCallbacks registered, which the Expo
// app's auth sessions hand their result to.
const zamiCallbacks = new Set<(rawUrl: string) => void>();

/**
 * Zami: open the provider's page in an auth session over the Expo app
 * (ASWebAuthenticationSession on iOS, a Custom Tab on Android). It closes
 * once the page redirects to `redirectUri`'s scheme, and the URL it closed on
 * goes to the callback listeners. A cancelled session delivers nothing: the
 * attempt stays pending, as an abandoned Custom Tab leaves it on Android.
 * Modules load on first use, so Zam's tests (jsdom) never import them.
 */
function openZamiAuthSession(url: string, redirectUri: string): void {
    void import("expo-web-browser")
        .then((WebBrowser) => WebBrowser.openAuthSessionAsync(url, redirectUri))
        .then((result) => {
            if (result.type === "success")
                zamiCallbacks.forEach((cb) => cb(result.url));
        })
        .catch((err) => {
            // The system browser returns through the `zami:` link instead.
            console.warn("[login] auth session failed", err);
            window.open(url, "_blank", "noopener");
        });
}

export function isElectronWithSso(): boolean {
    return typeof window !== "undefined" && !!window.desktop?.sso;
}

/**
 * Open a sign-in or approval page in the in-app browser on Android, so the
 * user never leaves the app for another one. False elsewhere.
 */
export function openInAppBrowser(url: string): boolean {
    if (!Capacitor.isNativePlatform()) return false;
    void Browser.open({ url }).catch((err) => {
        console.warn("[login] in-app browser failed", err);
        window.open(url, "_blank", "noopener");
    });
    return true;
}

/** Leave for the provider's page: in-app browser on Android, system browser on desktop, navigation elsewhere. */
export function openLoginUrl(
    url: string,
    // Zami: where the page returns to, which the Expo app's auth session waits for.
    redirectUri = `${ZAMI_SCHEME}:`,
): void {
    // Zami: an auth session over the Expo app, in place of Android's in-app browser.
    if (isZamiNative()) {
        openZamiAuthSession(url, redirectUri);
        return;
    }
    if (openInAppBrowser(url)) return;
    if (isElectronWithSso()) {
        // The window-open handler hands this to the system browser.
        window.open(url, "_blank", "noopener");
    } else {
        // Web: a plain navigation.
        window.location.assign(url);
    }
}

/** Whether opening the provider's page navigates this document away. */
export function loginLeavesPage(): boolean {
    // Zami: the Expo app's auth session opens over it.
    if (isZamiNative()) return false;
    return !isElectronWithSso() && !Capacitor.isNativePlatform();
}

/**
 * Deliver callback URLs as they arrive: the current page (web), the Electron
 * local-server relay, or the Android deep link (including the one that
 * cold-started the app). `isCallbackUrl` says whether the page URL carries
 * callback parameters worth handing over. Returns a disposer.
 */
export function listenForLoginCallbacks(
    cb: (rawUrl: string) => void,
    isCallbackUrl: (url: URL) => boolean,
): () => void {
    const disposers: Array<() => void> = [];

    if (isCallbackUrl(new URL(window.location.href))) cb(window.location.href);

    if (window.desktop?.sso) {
        disposers.push(window.desktop.sso.onCallback(cb));
    }

    if (Capacitor.isNativePlatform()) {
        let disposed = false;
        const isOurs = (u: string) => u.startsWith(`${NATIVE_SCHEME}:`);
        App.getLaunchUrl()
            .then((launch) => {
                if (!disposed && launch?.url && isOurs(launch.url))
                    cb(launch.url);
            })
            .catch(() => {});
        const handle = App.addListener("appUrlOpen", (e) => {
            if (isOurs(e.url)) cb(e.url);
        });
        disposers.push(() => {
            disposed = true;
            void handle.then((h) => h.remove()).catch(() => {});
        });
    }

    // Zami: the Expo app's auth sessions, plus `zami:` (and OAuth's
    // `com.leonsilicon.zami:`) links that open the app, including the one that cold-started it, as on Android: a session
    // that fell back to the system browser returns that way, and Android may
    // restart the app behind its Custom Tab.
    if (isZamiNative()) {
        let disposed = false;
        let subscription: { remove: () => void } | undefined;
        const isOurs = (u: string) =>
            u.startsWith(`${ZAMI_SCHEME}:`) ||
            u.startsWith(`${ZAMI_OAUTH_SCHEME}:`);
        zamiCallbacks.add(cb);
        void import("expo-linking")
            .then(async (Linking) => {
                if (disposed) return;
                subscription = Linking.addEventListener("url", (e) => {
                    if (isOurs(e.url)) cb(e.url);
                });
                const launch = await Linking.getInitialURL();
                if (!disposed && launch && isOurs(launch)) cb(launch);
            })
            .catch(() => {});
        disposers.push(() => {
            disposed = true;
            zamiCallbacks.delete(cb);
            subscription?.remove();
        });
    }

    return () => disposers.forEach((d) => d());
}
