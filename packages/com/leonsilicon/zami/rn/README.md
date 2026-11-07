# @-/com.leonsilicon.zami.rn

React Native building blocks that Zami's translated components share in place of web
features Zam relies on.

- `Portal` / `PortalHost`: Zam's `Portal` moves its content to the end of
  `document.body`. Here the app root renders `<PortalHost />` last, and each `<Portal>`
  renders its children there. Portal content doesn't see React context from where the
  `<Portal>` is, so read stores (`useRune`) rather than context inside it.
