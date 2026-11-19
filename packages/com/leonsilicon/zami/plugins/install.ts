/// <reference types="expo/types" />
// oxlint-disable typescript/no-require-imports -- React's runtimes as the objects compiled JSX reads
// Turns Zami's additions to the plugin host on, when this module first runs: the app
// imports its entrypoint as it starts (apps/zami/index.ts), before anything renders and
// before Zam's settings apply the user's custom CSS.
import { setDomFrameRules } from "@-/com.leonsilicon.zami.rn";
import { reloadAppAsync } from "expo";
import { createZamiApi, toasts } from "#api";
import {
  installElementHooks,
  setLateSlotListener,
  setPatchErrorReporter,
  type ElementRuntimes,
} from "#elements";
import { bindingsOf } from "#bindings";
import { addFrameRule, frameRulesFor } from "#frames";
import { zamiHost } from "#host";
import { setLayerErrorReporter } from "#layers";
import { setHookErrorReporter, setModuleNames } from "#patcher";
import { pluginScope, unloadPluginWeb } from "#plugin-web";
import { installStyleSheets, setStyleSheet } from "#stylesheet";

/** Plugin names for messages, by id. */
const names = new Map<string, string>();
const nameOf = (pluginId: string): string => names.get(pluginId) ?? pluginId;

const told = new Set<string>();
/** One toast per problem: a patch that throws does so on every render. */
function tell(key: string, message: string, reload = false): void {
  if (told.has(key)) return;
  told.add(key);
  try {
    toasts().showToast(message, {
      tone: reload ? "accent" : "danger",
      sticky: reload,
      action: reload
        ? { label: "Reload", run: () => void reloadAppAsync("apply plugin patches") }
        : undefined,
    });
  } catch (error) {
    console.error("[zami] couldn't show a toast", error);
  }
}

let installed = false;

export function installZamiPlugins(): void {
  if (installed) return;
  installed = true;

  installElementHooks({
    react: require("react") as ElementRuntimes["react"],
    jsxRuntime: require("react/jsx-runtime") as ElementRuntimes["jsxRuntime"],
    jsxDevRuntime: __DEV__
      ? (require("react/jsx-dev-runtime") as ElementRuntimes["jsxDevRuntime"])
      : null,
  });
  setPatchErrorReporter((owner, what, error) => {
    console.error(`[plugin ${owner}] ${what} threw`, error);
    tell(`${owner} ${what}`, `${nameOf(owner)}: ${what} failed and was turned off.`);
  });
  setLayerErrorReporter((owner, error) => {
    console.error(`[plugin ${owner}] its layer threw`, error);
    tell(`${owner} layer`, `${nameOf(owner)}: its layer failed and was removed.`);
  });
  setHookErrorReporter((what, error) => console.error(`[zami] ${what} threw`, error));
  setModuleNames((exports) => bindingsOf(exports));
  // The patch reaches what's created from now on; what's on screen keeps its elements
  // until its parents render again. The plugin loads early from the next launch on.
  setLateSlotListener((owner, name) =>
    tell(
      `${owner} late`,
      `${nameOf(owner)} changes ${name}. Reload Zami to apply it to what's already on screen.`,
      true,
    ),
  );

  zamiHost.createApi = (context) => {
    if (context.manifest.name) names.set(context.pluginId, context.manifest.name);
    return createZamiApi(context);
  };
  // The stylesheet engine loads with the first stylesheet, not with the app: the settings
  // store clears the user's (empty) custom CSS on every launch.
  let styled = false;
  zamiHost.setStyleSheet = (id, css) => {
    if (!styled && css.trim() === "") return;
    styled = true;
    setStyleSheet(id, css);
  };
  zamiHost.pluginScope = (pluginId) => {
    // A plugin's code is about to run: the `<style>` elements it adds are stylesheets too.
    installStyleSheets();
    return pluginScope(pluginId);
  };
  zamiHost.unload = (pluginId) => unloadPluginWeb(pluginId);
  zamiHost.addFrameRule = (pluginId, rule) => {
    // With the first rule, not with the app: a plugin's own `<iframe>`s ask DomView.
    setDomFrameRules((url) => frameRulesFor(url));
    return { dispose: addFrameRule(pluginId, rule) };
  };
  zamiHost.frameRules = (url) => frameRulesFor(url);
}

installZamiPlugins();
