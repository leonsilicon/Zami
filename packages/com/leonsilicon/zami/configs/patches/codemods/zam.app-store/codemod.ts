import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";
import { safetyMessages } from "#messages";

const web = "@-/com.leonsilicon.zami.plugins/web";
const policy = "https://zami.leonsilicon.com";
const links = `<a href="${policy}/privacy.html" target="_blank" rel="noopener noreferrer">{t("zami.privacy")}</a>
            <a href="${policy}/support.html" target="_blank" rel="noopener noreferrer">{t("zami.support")}</a>`;

export default function codemod(root: SgRoot): string | null {
  const file = root.filename();
  const kinds = [String(root.root().kind())];
  const edits = (changes: Array<[string, string, string]>) =>
    editNodes(
      root,
      changes.map(([from, to, marker]) => ({ kinds, contains: from, from, to, marker })),
    );

  const imports = (names: string): [string, string, string] => {
    const from = '<script lang="ts">';
    const declaration = `import { ${names} } from "${web}";`;
    return [from, `${from}\n    ${declaration}`, declaration];
  };

  const hideSetting = (key: string): [string, string, string] => {
    const text = root.root().text();
    const keyIndex = text.indexOf(`t("${key}")`);
    const start = text.lastIndexOf("\n        <div\n", keyIndex);
    const end = text.indexOf("\n        </div>", keyIndex) + "\n        </div>".length;
    if (keyIndex < 0 || start < 0 || end <= start) throw new Error(`Setting moved: ${key}`);
    const from = text.slice(start, end);
    const marker = `{#if !appStoreBuild}<!-- ${key} -->`;
    return [from, `\n        ${marker}${from}\n        {/if}`, marker];
  };

  const locale = file.match(/\/i18n\/(?:locales\/)?([a-z]+)\.ts$/)?.[1];
  if (locale && locale in safetyMessages) {
    const text = root.root().text();
    const anchor = text.match(/^(?:export )?const (?:en|messages)[:\w <>,]* = \{$/m)?.[0];
    if (!anchor) throw new Error(`Cannot find the message catalogue in ${file}`);
    const declarations = Object.entries(safetyMessages[locale]!)
      .map(([key, value]) => `    "${key}": ${JSON.stringify(value)},`)
      .join("\n");
    const rebrand = [
      ...text.matchAll(
        /"(?:appShell\.zam|loginView\.(?:zam|oauthRegistrationRefused(?:Fallback)?|oauth(?:Login|Register)Explainer))":\s*"[^"\n]*\bZam\b[^"\n]*"/g,
      ),
    ].map(([from]): [string, string, string] => {
      const to = from.replace(/\bZam\b/g, "Zami");
      return [from, to, to];
    });
    return edits([[anchor, `${anchor}\n${declarations}`, '"zami.privacy":'], ...rebrand]);
  }

  if (file.endsWith("/svelte.config.js")) {
    return edits([
      [
        'const production = process.env.NODE_ENV === "production";',
        'const production = process.env.NODE_ENV === "production";\nconst appStore = process.env.VITE_ZAMI_APP_STORE === "true";',
        "const appStore = process.env.VITE_ZAMI_APP_STORE",
      ],
      [
        '"script-src": ["self", "wasm-unsafe-eval", "blob:"],',
        '"script-src": ["self", "wasm-unsafe-eval", ...(appStore ? [] : ["blob:"])],',
        '...(appStore ? [] : ["blob:"])',
      ],
      ['"frame-src": ["*"],', '"frame-src": appStore ? ["none"] : ["*"],', '"frame-src": appStore'],
    ]);
  }

  if (file.endsWith("/pluginBoot.ts")) {
    return edits([
      [
        'const STORAGE_KEY = "zam_plugins";',
        `import { appStoreBuild } from "${web}";\n\nconst STORAGE_KEY = "zam_plugins";`,
        "import { appStoreBuild }",
      ],
      [
        "const enabled = persisted ? persisted.enabled : b.defaultEnabled;",
        'const enabled = appStoreBuild && b.manifest.id === "com.leonsilicon.zami.paper"\n            ? true : persisted ? persisted.enabled : b.defaultEnabled;',
        "const enabled = appStoreBuild",
      ],
      [
        "    if (builtinIds.includes(id)) continue;",
        "    if (appStoreBuild || builtinIds.includes(id)) continue;",
        "if (appStoreBuild || builtinIds.includes(id))",
      ],
      [
        "    const stopRepoWatch = startLocalRepoWatch();",
        "    const stopRepoWatch = appStoreBuild ? () => {} : startLocalRepoWatch();",
        "const stopRepoWatch = appStoreBuild",
      ],
      [
        "export async function disablePlugin(pluginId: string): Promise<void> {",
        'export async function disablePlugin(pluginId: string): Promise<void> {\n    if (appStoreBuild && pluginId === "com.leonsilicon.zami.paper") return;',
        'if (appStoreBuild && pluginId === "com.leonsilicon.zami.paper") return;',
      ],
      [
        "async function blobImport(code: string): Promise<PluginModule> {",
        'async function blobImport(code: string): Promise<PluginModule> {\n    if (appStoreBuild) throw new Error("This build only runs bundled plugins.");',
        "This build only runs bundled plugins.",
      ],
    ]);
  }

  if (file.endsWith("/PluginsSettings.svelte")) {
    return edits([
      imports("appStoreBuild, paperThemeId"),
      [
        "    // Initial Browse fetch on mount\n    onMount(() => {",
        "    // Initial Browse fetch on mount\n    onMount(() => {\n        if (appStoreBuild) return;",
        "if (appStoreBuild) return;",
      ],
      [
        "        <!-- Browse -->",
        "        {#if !appStoreBuild}\n        <!-- Browse -->",
        "{#if !appStoreBuild}\n        <!-- Browse -->",
      ],
      [
        "        </section>\n    </div>\n{/if}",
        "        </section>\n        {/if}\n    </div>\n{/if}",
        "        </section>\n        {/if}\n    </div>\n{/if}",
      ],
      [
        "                                <ToggleSwitch\n                                    checked={p.enabled}",
        "                                {#if !appStoreBuild || p.id !== paperThemeId}\n                                <ToggleSwitch\n                                    checked={p.enabled}",
        "{#if !appStoreBuild || p.id !== paperThemeId}",
      ],
      [
        '                                {#if p.source === "local"}\n                                    <button',
        '                                {/if}\n                                {#if p.source === "local"}\n                                    <button',
        '                                {/if}\n                                {#if p.source === "local"}\n                                    <button',
      ],
    ]);
  }

  if (file.endsWith("/links.ts")) {
    return edits([
      [
        'import { GITHUB_OWNER, GITHUB_REPO } from "$lib/utils/androidUpdate";',
        'const GITHUB_OWNER = "leonsilicon";\nconst GITHUB_REPO = "Zami";',
        'const GITHUB_REPO = "Zami";',
      ],
      ['"https://zam.crafty.moe"', `"${policy}"`, `"${policy}"`],
    ]);
  }

  if (file.endsWith("/AboutSettings.svelte")) {
    return edits([
      imports("appStoreBuild, zamiVersion"),
      [
        'class="text-sm text-zam-textPrimary">Zam</p>',
        'class="text-sm text-zam-textPrimary">Zami</p>',
        ">Zami</p>",
      ],
      [
        "{ APP_VERSION })}",
        "{ APP_VERSION: zamiVersion ?? APP_VERSION })}",
        "APP_VERSION: zamiVersion",
      ],
      [
        "{#if !CAN_INSTALL_UPDATE}",
        "{#if !appStoreBuild && !CAN_INSTALL_UPDATE}",
        "{#if !appStoreBuild && !CAN_INSTALL_UPDATE}",
      ],
      [
        "            {:else}\n                <button\n                    onclick={check}",
        "            {:else if !appStoreBuild}\n                <button\n                    onclick={check}",
        "{:else if !appStoreBuild}",
      ],
    ]);
  }

  if (file.endsWith("/GifPicker.svelte")) {
    return edits([
      imports("appStoreBuild"),
      [
        'settingsState.gifDefaultTab === "favourites" ? "favourites" : "gifs"',
        'appStoreBuild || settingsState.gifDefaultTab === "favourites" ? "favourites" : "gifs"',
        "appStoreBuild || settingsState.gifDefaultTab",
      ],
      [
        "    <!-- Inner content tabs -->",
        "    {#if !appStoreBuild}\n    <!-- Inner content tabs -->",
        "{#if !appStoreBuild}\n    <!-- Inner content tabs -->",
      ],
      [
        "    <!-- Search -->",
        "    {/if}\n\n    <!-- Search -->",
        "    {/if}\n\n    <!-- Search -->",
      ],
    ]);
  }

  if (file.endsWith("/MessagesMediaSettings.svelte")) {
    return edits([
      imports("appStoreBuild"),
      hideSetting("messagesMediaSettings.linkPreviews"),
      hideSetting("messagesMediaSettings.defaultTab"),
      [
        "{#if discordImportAvailable}",
        "{#if !appStoreBuild && discordImportAvailable}",
        "{#if !appStoreBuild && discordImportAvailable}",
      ],
    ]);
  }

  if (file.endsWith("/settingsSearch.ts")) {
    const text = root.root().text();
    const hiddenKeys = ["linkPreviews", "linkPreviewMedia"];
    return edits([
      [
        'import { t } from "$lib/i18n";',
        `import { t } from "$lib/i18n";\nimport { appStoreBuild } from "${web}";`,
        "import { appStoreBuild }",
      ],
      ...hiddenKeys.map((key): [string, string, string] => {
        const start = text.lastIndexOf("    {\n", text.indexOf(`t("settingsSearch.${key}")`));
        const end = text.indexOf("    },\n", start) + "    },\n".length;
        if (start < 0 || end <= start) throw new Error(`Search entry moved: ${key}`);
        const from = text.slice(start, end);
        const marker = `    ...(appStoreBuild ? [] : [/* ${key} */`;
        return [from, `${marker}\n${from}    ]),\n`, marker];
      }),
    ]);
  }

  if (file.endsWith("/LoginView.svelte")) {
    return edits([
      imports("appStoreBuild"),
      [
        "            {#if !CAN_INSTALL_UPDATE}",
        `            <nav class="mt-4 flex flex-wrap justify-center gap-4 text-sm text-zam-accentText underline">
                ${links}
                <a href="${policy}/support.html#community" target="_blank" rel="noopener noreferrer">{t("zami.community")}</a>
            </nav>

            {#if !appStoreBuild && !CAN_INSTALL_UPDATE}`,
        `href="${policy}/privacy.html"`,
      ],
    ]);
  }

  if (file.endsWith("/PrivacySafetySettings.svelte")) {
    return edits([
      imports("appStoreBuild, contentFilter, setMutedPhrases"),
      hideSetting("privacySafetySettings.linkPreviewMedia"),
      [
        '<div class="space-y-6">\n    <section data-setting-anchor="notif-privacy">',
        `<div class="space-y-6">
    <section class="space-y-3">
        <nav class="flex flex-wrap gap-4 text-sm text-zam-accentText underline">
            ${links}
        </nav>
        {#if appStoreBuild}
            <label for="zami-muted-phrases" class="block text-sm font-semibold text-zam-textPrimary">{t("zami.mutedPhrases")}</label>
            <p id="zami-muted-phrases-help" class="text-sm text-zam-textMuted">{t("zami.mutedPhrasesHelp")}</p>
            <textarea
                id="zami-muted-phrases"
                aria-describedby="zami-muted-phrases-help"
                value={contentFilter.phrases}
                oninput={(event) => setMutedPhrases(event.currentTarget.value)}
                rows="3"
                maxlength="2000"
                class="w-full rounded-lg border border-zam-divider bg-zam-background px-3 py-2 text-sm text-zam-textPrimary"
            ></textarea>
        {/if}
    </section>
    <section data-setting-anchor="notif-privacy">`,
        'id="zami-muted-phrases"',
      ],
    ]);
  }

  if (file.endsWith("/AccountSettings.svelte")) {
    return edits([
      [
        "let deactivateErase = $state(false);",
        "let deactivateErase = $state(true);",
        "let deactivateErase = $state(true);",
      ],
      ["deactivateErase = false;", "deactivateErase = true;", "deactivateErase = true;"],
      [
        "{#if !oauthSession || deactivateUrl || accountUrl}",
        "{#if !oauthSession || securityLoaded}",
        "{#if !oauthSession || securityLoaded}",
      ],
      [
        '>{t("accountSettings.deactivateAccount")}</a\n                    >\n                {/if}',
        `>{t("zami.deleteAccount")}</a
                    >
                {:else}
                    <p class="text-sm text-zam-textMuted">{t("zami.deleteAccountProvider")}</p>
                    <a href="${policy}/support.html#account-deletion" target="_blank" rel="noopener noreferrer" class="text-sm text-zam-accentText underline">{t("zami.deleteAccount")}</a>
                {/if}`,
        't("zami.deleteAccountProvider")',
      ],
      [
        '>{t("accountSettings.deactivateAccount")}</button',
        '>{t("zami.deleteAccount")}</button',
        '>{t("zami.deleteAccount")}</button',
      ],
      ['"accountSettings.deactivateAccount2",', '"zami.deleteAccount",', '"zami.deleteAccount",'],
    ]);
  }

  if (file.endsWith("/MessageItem.svelte")) {
    return edits([
      imports("appStoreBuild, matchesMutedPhrase"),
      [
        "    const mediaFilename = $derived(",
        '    const matchesFilter = $derived(appStoreBuild && !isOwnMessage &&\n        (matchesMutedPhrase(body()) || matchesMutedPhrase(typeof content?.body === "string" ? content.body : "")));\n    const mediaFilename = $derived(',
        "const matchesFilter = $derived",
      ],
      [
        "                {#if isCallEvent}\n                    {#if callSummary}",
        '                {#if matchesFilter}\n                    <p class="text-sm italic text-zam-textMuted">{t("zami.messageFiltered")}</p>\n                {:else if isCallEvent}\n                    {#if callSummary}',
        't("zami.messageFiltered")',
      ],
      [
        "{replyTargetBody}",
        '{appStoreBuild && matchesMutedPhrase(replyTargetBody ?? "") ? t("zami.messageFiltered") : replyTargetBody}',
        "matchesMutedPhrase(replyTargetBody",
      ],
      [
        '{fallbackLine.text || "…"}',
        '{appStoreBuild && matchesMutedPhrase(fallbackLine.text ?? "") ? t("zami.messageFiltered") : fallbackLine.text || "…"}',
        "matchesMutedPhrase(fallbackLine.text",
      ],
      [
        "{:else if gameInvite}",
        "{:else if gameInvite && !appStoreBuild}",
        "gameInvite && !appStoreBuild",
      ],
      [
        "{#if isSwf && (file || fileUrl)}",
        "{#if !appStoreBuild && isSwf && (file || fileUrl)}",
        "!appStoreBuild && isSwf",
      ],
      [
        "    function previewableUrls(text: string): string[] {",
        "    function previewableUrls(text: string): string[] {\n        if (appStoreBuild) return [];",
        "if (appStoreBuild) return [];",
      ],
    ]);
  }

  if (file.endsWith("/MessageInput.svelte")) {
    // The same callback is passed to the phone sheet and desktop composer menu.
    return edits([
      [
        '    import { openGameInviteDialog } from "$lib/stores/gameInviteDialog.svelte";',
        `    import { appStoreBuild } from "${web}";
    import { openGameInviteDialog } from "$lib/stores/gameInviteDialog.svelte";
    const inviteToGame = appStoreBuild ? undefined : openGameInviteDialog;`,
        "const inviteToGame",
      ],
      [
        "                                onInviteToGame={() =>\n                                    openGameInviteDialog(roomId)}\n                                onInsertTimestamp={openTimestampPicker}\n                            />\n                        </div>\n                    {:else}",
        "                                onInviteToGame={inviteToGame ? () => inviteToGame(roomId) : undefined}\n                                onInsertTimestamp={openTimestampPicker}\n                            />\n                        </div>\n                    {:else}",
        "onInviteToGame={inviteToGame ? () => inviteToGame(roomId) : undefined}\n                                onInsertTimestamp={openTimestampPicker}\n                            />\n                        </div>\n                    {:else}",
      ],
      [
        "                                onInviteToGame={() =>\n                                    openGameInviteDialog(roomId)}\n                                onInsertTimestamp={openTimestampPicker}\n                            />\n                        </div>\n                    {/if}",
        "                                onInviteToGame={inviteToGame ? () => inviteToGame(roomId) : undefined}\n                                onInsertTimestamp={openTimestampPicker}\n                            />\n                        </div>\n                    {/if}",
        "onInviteToGame={inviteToGame ? () => inviteToGame(roomId) : undefined}\n                                onInsertTimestamp={openTimestampPicker}\n                            />\n                        </div>\n                    {/if}",
      ],
    ]);
  }

  if (file.endsWith("/MessageReportAction.svelte")) {
    return edits([
      [
        '{t("messageReportAction.reportMessage")}\n                </p>',
        `{t("messageReportAction.reportMessage")}
                </p>
                <a href="${policy}/support.html#abuse" target="_blank" rel="noopener noreferrer" class="text-sm text-zam-accentText underline">{t("zami.safetyContact")}</a>`,
        't("zami.safetyContact")',
      ],
    ]);
  }
  return null;
}
