import "#paper-css";
import { appStoreBuild } from "#store-build";

export const paperThemeId = "com.leonsilicon.zami.paper";

function activate(active: boolean): void {
  const root = document.documentElement;
  root.toggleAttribute("data-zami-paper", active);
  if (active) syncPaperThemeColor();
  else {
    const base = root.dataset.theme;
    const color = base === "light" ? "#f2f3f5" : base === "amoled" ? "#000000" : "#313338";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  }
}

export function paperThemeStyles(): CSSStyleDeclaration | undefined {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root.hasAttribute("data-zami-paper")) return;
  return getComputedStyle(root);
}

/** The native status bar and the web header share the resolved header surface. */
export function syncPaperThemeColor(): void {
  const color = paperThemeStyles()?.getPropertyValue("--zami-header").trim();
  if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}

// The sign-in screen renders before Zam starts its plugin loader. Read the same device
// preference here so login and session restore both start with the right theme.
export function preparePaperTheme(): void {
  let enabled = true;
  if (!appStoreBuild) {
    try {
      const state = JSON.parse(localStorage.getItem("zam_plugins") ?? "null");
      if (state?.version === 1 && state.plugins?.[paperThemeId]?.source === "builtin") {
        enabled = state.plugins[paperThemeId].enabled !== false;
      }
    } catch {
      // Use the bundled default if storage is unavailable.
    }
  }
  activate(enabled);
}

export const paperTheme = {
  manifest: {
    id: paperThemeId,
    name: "Zami Paper",
    version: "1.0.0",
    description:
      "Zami’s conversation layout with a compact sidebar and neutral light and dark palettes.",
    author: "Zami",
    entry: "builtin",
    capabilities: [],
  },
  module: {
    onload: () => activate(true),
  },
  defaultEnabled: true,
};
