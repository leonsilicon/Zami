import "#paper-css";
import { appStoreBuild } from "#store-build";

export const paperThemeId = "com.leonsilicon.zami.paper";

function activate(active: boolean): void {
  const root = document.documentElement;
  root.toggleAttribute("data-zami-paper", active);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const base = root.dataset.theme;
  if (meta) {
    meta.content =
      paperThemeColor(base) ??
      (base === "light" ? "#f2f3f5" : base === "amoled" ? "#000000" : "#313338");
  }
}

export function paperThemeColor(base?: string): string | undefined {
  if (typeof document === "undefined") return;
  if (!document.documentElement.hasAttribute("data-zami-paper")) return;
  return base === "amoled" ? "#000000" : base === "dark" ? "#172624" : "#f3ede0";
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
    description: "Zami’s conversation layout with a horizontal space switcher and message bubbles.",
    author: "Zami",
    entry: "builtin",
    capabilities: [],
  },
  module: {
    onload: () => activate(true),
  },
  defaultEnabled: true,
};
