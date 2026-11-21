import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

/**
 * Zam's native app signs in as Zam, a native OAuth client at https://matrix.crafty.moe that
 * returns to `moe.crafty.matrix:`. The Zami app signs in as itself: "Zami", at
 * https://zami.leonsilicon.com (apps/site, which the provider's consent screen links to),
 * returning to `com.leonsilicon.zami:`. A native client's redirect scheme must be its
 * `client_uri`'s host reversed, as the Matrix spec has it, and Matrix Authentication
 * Service refuses any other.
 *
 * - `src/lib/matrix/loginRedirect.ts`: the scheme sign-in returns to (legacy SSO's too).
 * - `src/lib/matrix/oauth.ts`: the `client_uri` and `client_name` it registers with. Only
 *   the app runs this build, so the other non-web targets that share `PROJECT_URI`
 *   (Electron's loopback, an http dev server) never do.
 */
export default function codemod(root: SgRoot): string | null {
  const filename = root.filename();

  if (filename.endsWith("/src/lib/matrix/loginRedirect.ts")) {
    return editNodes(root, [
      {
        kinds: ["export_statement"],
        contains: "export const NATIVE_SCHEME",
        from: 'export const NATIVE_SCHEME = "moe.crafty.matrix";',
        to:
          "// Zami: the Zami app's scheme, its `client_uri`'s host reversed (oauth.ts).\n" +
          'export const NATIVE_SCHEME = "com.leonsilicon.zami";',
        marker: 'export const NATIVE_SCHEME = "com.leonsilicon.zami";',
      },
    ]);
  }

  if (filename.endsWith("/src/lib/matrix/oauth.ts")) {
    return editNodes(root, [
      {
        kinds: ["lexical_declaration"],
        contains: "const PROJECT_URI",
        from: 'const PROJECT_URI = "https://matrix.crafty.moe";',
        to:
          "// Zami: the Zami app's site, which it registers as a native client of.\n" +
          'const PROJECT_URI = "https://zami.leonsilicon.com";',
        marker: 'const PROJECT_URI = "https://zami.leonsilicon.com";',
      },
      {
        kinds: ["object"],
        contains: "client_uri: target.clientUri,",
        from: 'client_name: "Zam",',
        to: 'client_name: "Zami",',
        marker: 'client_name: "Zami",',
      },
    ]);
  }

  return null;
}
