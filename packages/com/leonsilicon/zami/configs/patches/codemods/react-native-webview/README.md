# @-/com.leonsilicon.zami.configs.patches.codemods.react-native-webview

The codemod behind `patches/react-native-webview@<version>.patch`: hooks for
`@-/com.leonsilicon.zami.shell`, which serves Zam's web app from the app's bundle at an
origin of its own.

- **iOS** (`apple/RNCWebViewImpl.m`): posts `RNCWebViewWillCreateWebView` with each
  WKWebViewConfiguration before the web view is created, and the shell registers its
  `zami` URL scheme handler on it.
- **Android** (`RNCWebViewClient.java`): asks `RNCWebViewClient.requestInterceptor` about
  each request before the network, and the shell answers the ones for `https://localhost`.

Regenerate the patch with `vpx _patches generate react-native-webview`.
