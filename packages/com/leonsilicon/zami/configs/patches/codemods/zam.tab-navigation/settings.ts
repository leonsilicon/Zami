import type { Change } from "#codemod";

export const settingsChanges: Change[] = [
  [
    "        onClose: () => void;\n        onLogout: () => void;\n    }\n\n    let { onClose, onLogout }: Props = $props();",
    `        onClose?: () => void;
        onLogout: () => void;
        embedded?: boolean;
    }

    let { onClose, onLogout, embedded = false }: Props = $props();`,
    "embedded?: boolean",
  ],
  [
    "        interfaceState.settingsInitialTab,",
    "        untrack(() => embedded ? null : interfaceState.settingsInitialTab),",
    "untrack(() => embedded ? null : interfaceState.settingsInitialTab),",
  ],
  [
    "    let dialogEl: HTMLDivElement | null = null;",
    "    let dialogEl = $state<HTMLDivElement | null>(null);",
    "let dialogEl = $state<HTMLDivElement",
  ],
  [
    "    // A search result was chosen:",
    `    export function backToCategories(): boolean {
        if (view.mode !== "detail") return false;
        goBackToList();
        return true;
    }

    // A search result was chosen:`,
    "export function backToCategories()",
  ],
  [
    '        if (view.mode !== "detail") return;\n        untrack(() => openSubPage',
    '        if (embedded || view.mode !== "detail") return;\n        untrack(() => openSubPage',
    'if (embedded || view.mode !== "detail")',
  ],
  [
    '<div class="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4">',
    `{#if embedded}
    <div class="zami-settings-page" bind:this={dialogEl}>
        {@render settingsContent()}
    </div>
{:else}
<div class="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4">`,
    'class="zami-settings-page"',
  ],
  [
    "        use:focusTrap\n    >\n        <!-- Header.",
    `        use:focusTrap
    >
        {@render settingsContent()}
    </div>
</div>
{/if}

{#snippet settingsContent()}
        <!-- Header.`,
    "{#snippet settingsContent()}",
  ],
  [
    '            <button\n                onclick={onClose}\n                aria-label={t("appSettings.closeSettings")}',
    '            {#if !embedded}\n            <button\n                onclick={onClose}\n                aria-label={t("appSettings.closeSettings")}',
    "{#if !embedded}\n            <button",
  ],
  [
    '            </button>\n        </div>\n\n        {#if view.mode !== "detail"}',
    '            </button>\n            {/if}\n        </div>\n\n        {#if view.mode !== "detail"}',
    '            </button>\n            {/if}\n        </div>\n\n        {#if view.mode !== "detail"}',
  ],
  [
    "        {/if}\n    </div>\n</div>\n\n{#snippet panel(tab: SettingsTab)}",
    "        {/if}\n{/snippet}\n\n{#snippet panel(tab: SettingsTab)}",
    "{/snippet}\n\n{#snippet panel(tab: SettingsTab)}",
  ],
];

export const profileChanges: Change[] = [
  [
    '    import { t } from "$lib/i18n";',
    '    import { untrack } from "svelte";\n    import { t } from "$lib/i18n";',
    'import { untrack } from "svelte";',
  ],
  [
    "        onLogout: () => void;\n    }\n    let { onLogout }: Props = $props();",
    "        onLogout: () => void;\n        profileOnly?: boolean;\n    }\n    let { onLogout, profileOnly = false }: Props = $props();",
    "profileOnly?: boolean",
  ],
  [
    "    if (oauthSession) {\n        const client = getClient();",
    "    if (oauthSession && !untrack(() => profileOnly)) {\n        const client = getClient();",
    "if (oauthSession && !untrack(() => profileOnly)) {\n        const client",
  ],
  [
    "        if (oauthSession) {\n            void getAccountManagementUrl()",
    "        if (!profileOnly && oauthSession) {\n            void getAccountManagementUrl()",
    "if (!profileOnly && oauthSession) {\n            void getAccountManagementUrl()",
  ],
  [
    "            threePids = await getOwnThreePids().catch(() => []);",
    "            if (!profileOnly) threePids = await getOwnThreePids().catch(() => []);",
    "if (!profileOnly) threePids",
  ],
  [
    '    let displayName = $state(getOwnDisplayName() ?? "");',
    '    const initialDisplayName = getOwnDisplayName() ?? "";\n    let displayName = $state(initialDisplayName);\n    let savedDisplayName = $state(initialDisplayName);',
    "let savedDisplayName = $state",
  ],
  [
    '        displayName.trim() !== (getOwnDisplayName() ?? ""),',
    "        displayName.trim() !== savedDisplayName.trim(),",
    "displayName.trim() !== savedDisplayName.trim()",
  ],
  [
    `            const profile = await fetchOwnProfile();
            displayName = profile.displayName ?? "";`,
    `            const nameAtRequest = savedDisplayName;
            const profile = await fetchOwnProfile();
            if (savedDisplayName === nameAtRequest && !savingName) {
                savedDisplayName = profile.displayName ?? "";
                if (displayName === nameAtRequest) displayName = savedDisplayName;
            }`,
    "const nameAtRequest = savedDisplayName;",
  ],
  [
    "            await setOwnDisplayName(displayName.trim());",
    "            const name = displayName.trim();\n            await setOwnDisplayName(name);\n            savedDisplayName = name;",
    "savedDisplayName = name;",
  ],
  [
    "{#if canLinkDevice}",
    "{#if !profileOnly && canLinkDevice}",
    "{#if !profileOnly && canLinkDevice}",
  ],
  [
    `    <section>
        <p
            class="text-xs font-semibold text-zam-textMuted uppercase tracking-wide mb-3"
        >
            {t("accountSettings.profile")}
        </p>`,
    `    <section>
        {#if !profileOnly}
            <p class="text-xs font-semibold text-zam-textMuted uppercase tracking-wide mb-3">
                {t("accountSettings.profile")}
            </p>
        {/if}`,
    "{#if !profileOnly}\n            <p class=",
  ],
  [
    '        <div class="flex items-center gap-4">\n            {#if avatarUrl}',
    '        <div class="flex flex-wrap items-center gap-4">\n            {#if avatarUrl}',
    'class="flex flex-wrap items-center gap-4">\n            {#if avatarUrl}',
  ],
  [
    '                placeholder={t("accountSettings.yourDisplayName")}\n                class="flex-1',
    '                aria-label={t("accountSettings.yourDisplayName")}\n                placeholder={t("accountSettings.yourDisplayName")}\n                class="min-w-0 flex-1',
    'aria-label={t("accountSettings.yourDisplayName")}',
  ],
  [
    "    <ProfileFieldsEditor {capabilities} {displayName} />\n\n    <section",
    "    <ProfileFieldsEditor {capabilities} {displayName} />\n\n    {#if !profileOnly}\n    <section",
    "<ProfileFieldsEditor {capabilities} {displayName} />\n\n    {#if !profileOnly}",
  ],
  [
    "</div>\n\n{#if linkMode}",
    "    {/if}\n</div>\n\n{#if linkMode}",
    "    {/if}\n    {/if}\n</div>\n\n{#if linkMode}",
  ],
];

export const footerChanges: Change[] = [
  [
    "        onSettings: () => void;\n    }\n    let { onLogout, onSettings }: Props = $props();",
    "    }\n    let { onLogout }: Props = $props();",
    "let { onLogout }: Props",
  ],
  [
    `    <button
        onclick={onSettings}
        class="p-1.5 rounded text-zam-textMuted hover:text-zam-textPrimary hover:bg-zam-messageHover transition-colors"
        title={t("common.settings")}
        aria-label={t("common.settings")}
    >
        <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
        >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
        </svg>
    </button>`,
    "    <!-- Bottom navigation owns Settings. -->",
    "<!-- Bottom navigation owns Settings. -->",
  ],
];
