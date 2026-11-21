// Exact edits inside syntax nodes that jssg selects, as Haniverse's codemods make them:
// parsing picks the node (the tightest of the given kinds that contains an anchor), and the
// edit replaces exact text within it. An edit whose marker is already in the file is skipped,
// so a codemod can run again on a file it changed (`bun patch` hands back the patched
// package); an anchor that isn't found, or is found twice, throws, so upstream drift fails
// loudly instead of leaving the file unpatched.
//
// No runtime imports from npm: this runs inside `codemod jssg run`'s sandbox.
import type { Edit, SgNode, SgRoot } from "@codemod.com/jssg-types/main";

export interface NodeEdit {
  /** Tree-sitter node kinds to look in (in the language patch.json gives). */
  kinds: readonly string[];
  /** Text the node contains, before the edit and after it. */
  contains: string;
  /** The exact text within the node to replace: found once. */
  from: string;
  to: string;
  /** Text only the edited file has. */
  marker: string;
}

function tightestNode(root: SgRoot, edit: NodeEdit): SgNode {
  const top = root.root();
  // findAll looks below the root, never at it.
  const candidates = [
    ...(edit.kinds.includes(String(top.kind())) ? [top] : []),
    ...edit.kinds.flatMap((kind) => top.findAll({ rule: { kind } })),
  ]
    .filter((node) => node.text().includes(edit.contains))
    .sort((a, b) => a.text().length - b.text().length);
  const node = candidates[0];
  if (node === undefined) {
    throw new Error(
      `${root.filename()}: no ${edit.kinds.join("/")} contains ${JSON.stringify(edit.contains.slice(0, 120))}`,
    );
  }
  return node;
}

/** The file with `edits` made, or null when every one is already there. */
export function editNodes(root: SgRoot, edits: readonly NodeEdit[]): string | null {
  const source = root.root().text();
  const pending = new Map<SgNode, string>();
  for (const edit of edits) {
    if (source.includes(edit.marker)) continue;
    const node = tightestNode(root, edit);
    const known = [...pending.keys()].find((other) => other.id() === node.id());
    const target = known ?? node;
    const text = pending.get(target) ?? target.text();
    const first = text.indexOf(edit.from);
    if (first === -1) {
      throw new Error(
        `${root.filename()}: anchor drifted: ${JSON.stringify(edit.from.slice(0, 160))}`,
      );
    }
    if (text.indexOf(edit.from, first + edit.from.length) !== -1) {
      throw new Error(
        `${root.filename()}: anchor is ambiguous: ${JSON.stringify(edit.from.slice(0, 160))}`,
      );
    }
    pending.set(target, text.slice(0, first) + edit.to + text.slice(first + edit.from.length));
  }
  if (pending.size === 0) return null;
  const replacements: Edit[] = [...pending].map(([node, text]) => node.replace(text));
  return root.root().commitEdits(replacements);
}
