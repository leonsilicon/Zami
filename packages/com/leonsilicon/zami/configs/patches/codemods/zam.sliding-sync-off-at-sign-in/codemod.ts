import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

/**
 * Zam's sign-in form turns sliding sync on by default (a server without it falls back to
 * regular sync). Sliding sync breaks signing in to Beeper, so in the Zami app it starts
 * off; the form's advanced options and Debug settings still turn it on. The sign-in
 * form scrolls independently so its advanced options fit in short WebView windows.
 */
export default function codemod(root: SgRoot): string | null {
  const component = [String(root.root().kind())];
  return editNodes(root, [
    {
      kinds: component,
      contains: "let useSlidingSync = $state(true);",
      from: "    let useSlidingSync = $state(true);",
      to:
        "    // Zami: off instead, because sliding sync breaks signing in to Beeper. The\n" +
        "    // advanced options below and Debug settings still turn it on.\n" +
        "    let useSlidingSync = $state(false);",
      marker: "let useSlidingSync = $state(false);",
    },
    {
      kinds: component,
      contains: 'class="flex items-center justify-center bg-zam-backgroundTertiary p-4"',
      from:
        'class="flex items-center justify-center bg-zam-backgroundTertiary p-4"\n' +
        '    style="min-height: 100vh; min-height: 100dvh;"\n' +
        '>\n    <div class="w-full max-w-md">',
      to:
        'class="flex flex-col items-center overflow-y-auto bg-zam-backgroundTertiary p-4"\n' +
        '    style="height: 100vh; height: 100dvh;"\n' +
        '>\n    <div class="my-auto w-full max-w-md shrink-0">',
      marker: 'class="my-auto w-full max-w-md shrink-0"',
    },
  ]);
}
