import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

/**
 * Zam's sign-in form turns sliding sync on by default (a server without it falls back to
 * regular sync). Sliding sync breaks signing in to Beeper, so in the Zami app it starts
 * off; the form's advanced options and Debug settings still turn it on. The file is a
 * Svelte component, parsed as HTML: the edit is in its `<script>`'s text.
 */
export default function codemod(root: SgRoot): string | null {
  return editNodes(root, [
    {
      kinds: ["raw_text"],
      contains: "let useSlidingSync = $state(true);",
      from: "    let useSlidingSync = $state(true);",
      to:
        "    // Zami: off instead, because sliding sync breaks signing in to Beeper. The\n" +
        "    // advanced options below and Debug settings still turn it on.\n" +
        "    let useSlidingSync = $state(false);",
      marker: "let useSlidingSync = $state(false);",
    },
  ]);
}
