import type { ReactNode } from "react";
import "../app.css";

// Zami: not ported: applyDocumentLocale(). It sets `<html lang dir>` for the
// active language, and React Native has no document; a right-to-left layout is
// I18nManager's.
//
// Zami: not ported: the document-wide link handling, all of it for a page in a
// browser or WebView:
//   - opening external links outside the app instead of navigating the
//     window. Links in message HTML open through the rn `Html` component
//     (`openLink` from `@-/com.leonsilicon.zami.rn`); the sign-in pages that
//     stay inside the app (`a[data-in-app]` in SecuritySettings and
//     LinkDeviceDialog) open from those components, with openInAppBrowser;
//   - Android's long-press on a link to copy its URL, the toast it shows and
//     the click it swallows, and suppressing the WebView's own long-press
//     menu: a long-press on a link in message HTML belongs to the `Html`
//     component;
//   - the `cap-native` class on `<html>`, which marks a Capacitor build.
export default function Layout({ children }: { children?: ReactNode }) {
    return <>{children}</>;
}
