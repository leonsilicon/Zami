// Stylesheets for the app: the user's custom CSS and plugins' (`zam.ui.addStyles`,
// `zam.zami.styles`), which Zam hands to a `<style>` element and Zami to `setStyleSheet`.
// #css-rules holds them and #css-native applies them; this is what the plugin host calls.
import { installStyleSheets } from "#css-native";
import { setStyleSheet as set } from "#css-rules";

export { installStyleSheets, StyleSheetScope } from "#css-native";
export { styleSheetVersion, subscribeStyleSheets } from "#css-rules";

/**
 * Sets the stylesheet `id` owns, or with empty `css` removes it. Sheets apply in the
 * order their ids were first set, so of two equal rules the later sheet's wins.
 */
export function setStyleSheet(id: string, css: string): void {
  installStyleSheets();
  set(id, css);
}

/**
 * Sets theme variables (`{ "--zam-bg": "#101014" }`) as the sheet `id` owns: the same
 * as a `:root` rule declaring them. An empty map removes the sheet.
 */
export function setVariables(id: string, variables: Readonly<Record<string, string>>): void {
  const declarations = Object.entries(variables)
    // A value that would end the rule isn't a value.
    .filter(([name, value]) => name.startsWith("--") && !/[{};]/.test(String(value)))
    .map(([name, value]) => `${name}:${value};`);
  setStyleSheet(id, declarations.length > 0 ? `:root{${declarations.join("")}}` : "");
}
