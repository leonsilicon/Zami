import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

/** Keep replies whose m.thread relation only exists on the encrypted event. */
export default function codemod(root: SgRoot): string | null {
  return editNodes(root, [
    {
      kinds: ["function_declaration"],
      contains: "function getThreadMessages(",
      from: 'relatesTo: e.getOriginalContent()?.["m.relates_to"],',
      to:
        "// Decrypted content can omit the wire relation the SDK counted.\n" +
        '            relatesTo: e.getRelation() ?? e.getOriginalContent()?.["m.relates_to"],',
      marker: 'relatesTo: e.getRelation() ?? e.getOriginalContent()?.["m.relates_to"],',
    },
    {
      kinds: ["function_declaration"],
      contains: "function onThreadEvent(",
      from: "const isThread = eventThreadRoot(event) !== null;",
      to:
        "const isThread =\n" +
        '            event.isRelation("m.thread") || eventThreadRoot(event) !== null;',
      marker: 'event.isRelation("m.thread") || eventThreadRoot(event) !== null;',
    },
  ]);
}
