import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

/** Tuck the connection badge against the top of the safe area. */
export default function codemod(root: SgRoot): string | null {
  const component = [String(root.root().kind())];
  const top = "top: calc(env(safe-area-inset-top, 0px) + 0.0625rem);";
  return editNodes(root, [
    {
      kinds: component,
      contains: 'aria-live="polite"',
      from: `<!-- Top centre, just under the room header (the same 3.5rem + safe-area
         clearance CallPipOverlay uses). A bottom corner sat on the profile
         footer on desktop and on the composer on mobile. -->
    <div
        role="status"
        aria-live="polite"
        class="pointer-events-none fixed left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-zam-backgroundTertiary/95 px-3 py-1.5 text-xs font-medium text-zam-textSecondary shadow-lg ring-1 ring-black/20"
        style="top: calc(3.5rem + env(safe-area-inset-top, 0px));"
    >
        <span
            class="h-2 w-2 flex-shrink-0 rounded-full {offline`,
      to: `<!-- The native shell already insets the WebView for the status bar. -->
    <div
        role="status"
        aria-live="polite"
        class="pointer-events-none fixed left-1/2 z-50 flex w-max max-w-[calc(100%_-_1rem)] -translate-x-1/2 items-center gap-1 rounded-full bg-zam-backgroundTertiary px-1.5 text-[0.625rem] font-medium leading-[0.875rem] text-zam-textSecondary ring-1 ring-inset ring-zam-divider"
        style="${top}"
    >
        <span
            aria-hidden="true"
            class="h-1 w-1 flex-shrink-0 rounded-full {offline`,
      marker: top,
    },
  ]);
}
