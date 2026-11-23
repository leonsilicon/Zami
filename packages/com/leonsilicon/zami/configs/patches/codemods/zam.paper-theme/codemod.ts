import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

export default function codemod(root: SgRoot): string | null {
  const file = root.filename();
  const kinds = [String(root.root().kind())];
  const edits = (changes: Array<[string, string, string]>) =>
    editNodes(
      root,
      changes.map(([from, to, marker]) => ({ kinds, contains: from, from, to, marker })),
    );
  const web = "@-/com.leonsilicon.zami.plugins/web";

  if (file.endsWith("/builtins/index.ts")) {
    return edits([
      [
        'import type { Manifest } from "../manifest";',
        `import { paperTheme } from "${web}";\nimport type { Manifest } from "../manifest";`,
        "import { paperTheme }",
      ],
      [
        "export const BUILTIN_PLUGINS: BuiltinPlugin[] = [",
        "export const BUILTIN_PLUGINS: BuiltinPlugin[] = [\n    paperTheme,",
        "    paperTheme,",
      ],
    ]);
  }

  if (file.endsWith("/pluginBoot.ts")) {
    return edits([
      [
        'import { BUILTIN_PLUGINS } from "./builtins/index";',
        `import { BUILTIN_PLUGINS } from "./builtins/index";\nimport { paperThemeId, preparePaperTheme } from "${web}";`,
        "import { paperThemeId, preparePaperTheme }",
      ],
      [
        "    setEnabledFlag(pluginId, false);\n}",
        "    setEnabledFlag(pluginId, false);\n    if (pluginId === paperThemeId) preparePaperTheme();\n}",
        "if (pluginId === paperThemeId) preparePaperTheme();",
      ],
    ]);
  }

  if (file.endsWith("/settings.svelte.ts")) {
    return edits([
      [
        '(legacyTheme ? migrateThemeToPresetName(legacyTheme) : "");',
        '(legacyTheme ? migrateThemeToPresetName(legacyTheme) : migrateThemeToPresetName("light"));',
        'migrateThemeToPresetName("light"));',
      ],
      [
        'readBool("rightAlignOwnBubbles", false)',
        'readBool("rightAlignOwnBubbles", true)',
        'readBool("rightAlignOwnBubbles", true)',
      ],
      [
        'readBool("bubbleAllMessages", false)',
        'readBool("bubbleAllMessages", true)',
        'readBool("bubbleAllMessages", true)',
      ],
    ]);
  }

  if (file.endsWith("/utils/theme.ts")) {
    return edits([
      [
        'export type Theme = "dark" | "light" | "amoled";',
        `import { paperThemeColor } from "${web}";\n\nexport type Theme = "dark" | "light" | "amoled";`,
        "import { paperThemeColor }",
      ],
      [
        '?.setAttribute("content", themeColor);',
        '?.setAttribute("content", paperThemeColor(theme) ?? themeColor);',
        "paperThemeColor(theme) ?? themeColor",
      ],
    ]);
  }

  if (file.endsWith("/AppShell.svelte")) {
    return edits([
      [
        '            : "Zam"}</title',
        '            : "Zami"}</title',
        '            : "Zami"}</title',
      ],
      [
        '<span class="text-5xl font-bold text-zam-textMuted"\n                            >#</span\n                        >',
        '<span class="zami-wordmark-mark" aria-hidden="true"></span>',
        '<span class="zami-wordmark-mark" aria-hidden="true"></span>',
      ],
      [
        'class="relative flex flex-col flex-shrink-0 min-h-0"',
        'class="zami-sidebar zami-sidebar-desktop relative flex flex-col flex-shrink-0 min-h-0"',
        "zami-sidebar-desktop",
      ],
      [
        'class="fixed inset-y-0 left-0 z-40 flex flex-col w-[19.5rem]"',
        'class="zami-sidebar fixed inset-y-0 left-0 z-40 flex flex-col w-[19.5rem]"',
        'class="zami-sidebar fixed',
      ],
      [
        'style="width: calc(4.5rem + {roomListWidth}px);"\n            >\n                <div class="flex flex-1 min-h-0 overflow-hidden">',
        'style:--zami-conversation-width={roomListWidth + "px"}\n            >\n                <div class="zami-sidebar-body flex flex-1 min-h-0 overflow-hidden">',
        "style:--zami-conversation-width",
      ],
      [
        'aria-hidden={leftDrawerClosed ? "true" : undefined}\n            >\n                <div class="flex flex-1 min-h-0 overflow-hidden">',
        'aria-hidden={leftDrawerClosed ? "true" : undefined}\n            >\n                <div class="zami-sidebar-body flex flex-1 min-h-0 overflow-hidden">',
        'aria-hidden={leftDrawerClosed ? "true" : undefined}\n            >\n                <div class="zami-sidebar-body',
      ],
      [
        "            !interfaceState.isMobile ||\n            isDragging ||",
        "            !interfaceState.isMobile ||\n            (e.target instanceof Element && e.target.closest('[data-zami-paper] [data-zam-region=\"space-sidebar\"]')) ||\n            isDragging ||",
        "e.target.closest('[data-zami-paper]",
      ],
    ]);
  }

  if (file.endsWith("/SpaceSidebar.svelte")) {
    return edits([
      [
        "        const rel = (e.clientY - rect.top) / rect.height;",
        "        const rel = spaceDropPosition(e.clientX, e.clientY, rect);",
        "spaceDropPosition(e.clientX",
      ],
      [
        "    function rootTargetAt(clientY: number): typeof dropTarget {",
        `    function spaceDropPosition(x: number, y: number, rect: DOMRect): number {
        return document.documentElement.hasAttribute("data-zami-paper")
            ? (x - rect.left) / rect.width
            : (y - rect.top) / rect.height;
    }

    function rootTargetAt(clientX: number, clientY: number): typeof dropTarget {`,
        "function spaceDropPosition",
      ],
      [
        "if (clientY < r.top + r.height / 2)",
        "if (spaceDropPosition(clientX, clientY, r) < 0.5)",
        "spaceDropPosition(clientX, clientY, r)",
      ],
      ["rootTargetAt(e.clientY)", "rootTargetAt(e.clientX, e.clientY)", "rootTargetAt(e.clientX"],
      ["rootTargetAt(t.clientY)", "rootTargetAt(t.clientX, t.clientY)", "rootTargetAt(t.clientX"],
      [
        "const rel = (t.clientY - rect.top) / rect.height;",
        "const rel = spaceDropPosition(t.clientX, t.clientY, rect);",
        "spaceDropPosition(t.clientX",
      ],
      [
        'aria-label={t("spaceSidebar.home")}',
        'aria-label={t("spaceSidebar.home")}\n        aria-current={roomsState.activeSpaceId === null ? "true" : undefined}',
        "aria-current={roomsState.activeSpaceId === null",
      ],
      [
        "aria-label={spaceName}",
        'aria-label={spaceName}\n                aria-current={isActive ? "true" : undefined}',
        "aria-current={isActive",
      ],
    ]);
  }

  if (file.endsWith("/LoginView.svelte")) {
    return edits([
      [
        'class="bg-zam-background rounded-lg shadow-2xl p-8"',
        'class="zami-login-card bg-zam-background rounded-lg shadow-2xl p-8"',
        "zami-login-card bg",
      ],
      [
        `            <div class="text-center mb-8">
                <div
                    class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-zam-accent mb-4"
                >
                    <span class="text-3xl font-bold text-white">#</span>
                </div>`,
        `            <div class="zami-login-heading text-center mb-8">
                <div class="zami-wordmark">
                    <span class="zami-wordmark-mark" aria-hidden="true"></span>
                    Zami
                </div>`,
        "zami-login-heading text-center",
      ],
    ]);
  }

  return null;
}
