import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

/** Let the native shell continue the mobile drawer's background into the bottom inset. */
export default function codemod(root: SgRoot): string | null {
  const kinds = [String(root.root().kind())];
  const action = "function mirrorDrawerInset(drawer: HTMLElement)";
  const anchor = "    function drawerDragMove(e: TouchEvent) {";
  const binding = "bind:offsetWidth={drawerWidth}";
  return editNodes(root, [
    {
      kinds,
      contains: anchor,
      from: anchor,
      to: `    ${action} {
        const shell = (window as Window & {
            __zamiShell?: { watchDrawer?: (element: HTMLElement) => () => void };
        }).__zamiShell;
        const stop = shell?.watchDrawer?.(drawer);
        if (stop) return { destroy: stop };
    }

${anchor}`,
      marker: action,
    },
    {
      kinds,
      contains: binding,
      from: binding,
      to: `use:mirrorDrawerInset\n                ${binding}`,
      marker: "use:mirrorDrawerInset",
    },
  ]);
}
