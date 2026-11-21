# @-/com.leonsilicon.zami.configs.patches.codemods.zam.zami-oauth-client

A codemod for upstream Zam, applied when its web app is built, that has the Zami app sign
in as itself. Zam's native app signs in as "Zam", a native OAuth client at
https://matrix.crafty.moe returning to `moe.crafty.matrix:`; the Zami app signs in as
"Zami", at https://zami.leonsilicon.com (`apps/site`, which the provider's consent screen
links to), returning to `com.leonsilicon.zami:`, its `client_uri`'s host reversed as the
Matrix spec and Matrix Authentication Service require of a native client.

- `src/lib/matrix/loginRedirect.ts`: `NATIVE_SCHEME`, the scheme sign-in returns to (OAuth
  and legacy SSO).
- `src/lib/matrix/oauth.ts`: the `client_uri` (`PROJECT_URI`) and `client_name` it
  registers with.

The shell's Browser plugin (`@-/com.leonsilicon.zami.shell`) waits for the same scheme.
