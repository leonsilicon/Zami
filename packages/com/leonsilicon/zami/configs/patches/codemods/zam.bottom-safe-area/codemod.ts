import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

/** Let the shell continue the drawer and shared bottom sheet backgrounds into the bottom inset. */
export default function codemod(root: SgRoot): string | null {
  const kinds = [String(root.root().kind())];
  const drawer = root.filename().endsWith("/AppShell.svelte");
  const kind = drawer ? "drawer" : "sheet";
  const action = "function mirrorBottomInset(element: HTMLElement)";
  const anchor = drawer
    ? "    function drawerDragMove(e: TouchEvent) {"
    : "    function fadeBackdrop(progress: number) {";
  const binding = drawer ? "bind:offsetWidth={drawerWidth}" : "bind:this={sheetEl}";
  const indent = drawer ? "                " : "    ";
  return editNodes(root, [
    {
      kinds,
      contains: anchor,
      from: anchor,
      to: `    ${action} {
        const shell = (window as Window & {
            __zamiShell?: {
                watchBottomInset?: (element: HTMLElement, kind: "drawer" | "sheet") => () => void;
            };
        }).__zamiShell;
        const stop = shell?.watchBottomInset?.(element, "${kind}");
        if (stop) return { destroy: stop };
    }

${anchor}`,
      marker: action,
    },
    {
      kinds,
      contains: binding,
      from: binding,
      to: `use:mirrorBottomInset\n${indent}${binding}`,
      marker: "use:mirrorBottomInset",
    },
  ]);
}
