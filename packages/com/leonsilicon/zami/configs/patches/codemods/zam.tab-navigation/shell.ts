import type { Change } from "#codemod";

const spaceSwitcher = `                    <SpaceSidebar
                        onHomeClick={() => setActiveSpace(null)}
                        onOpenSpaceSettings={openRoomSettings}
                    />
`;

const tabPages = `        </div>
        {:else if interfaceState.zamiTab === "notifications"}
            <main class="zami-tab-page" dir={uiDir}>
                <NotificationsPanel recentMessages />
            </main>
        {:else if interfaceState.zamiTab === "servers"}
            <main class="zami-tab-page" dir={uiDir}>
                <header class="zami-tab-heading"><h2>{t("zami.servers")}</h2></header>
                <SpaceSidebar
                    onHomeClick={() => {
                        setActiveSpace(null);
                        selectZamiTab("home");
                    }}
                    onOpenSpaceSettings={openRoomSettings}
                    onNavigate={() => selectZamiTab("home")}
                />
            </main>
        {:else if interfaceState.zamiTab === "settings"}
            <main class="zami-tab-page" dir={uiDir}>
                {#if interfaceState.modal !== "app-settings"}
                    <AppSettings bind:this={settingsPage} embedded onLogout={handleLogout} />
                {/if}
            </main>
        {:else}
            <main class="zami-tab-page" dir={uiDir}>
                <header class="zami-tab-heading"><h2>{t("accountSettings.profile")}</h2></header>
                <div class="zami-tab-scroll">
                    <div class="zami-profile-editor">
                        <AccountSettings profileOnly onLogout={handleLogout} />
                    </div>
                </div>
            </main>
        {/if}

        <nav class="zami-tab-bar" dir={uiDir} aria-label={t("keybinds.category.navigation")}>
            <div class="zami-tab-buttons">
                {#each zamiTabs as { id, label, icon: Icon } (id)}
                    <button
                        type="button"
                        aria-current={interfaceState.zamiTab === id ? "page" : undefined}
                        onclick={() => selectZamiTab(id)}
                    >
                        <span class="zami-tab-icon"><Icon size={20} aria-hidden="true" /></span>
                        <span>{t(label)}</span>
                    </button>
                {/each}
            </div>
        </nav>

`;

export const shellChanges: Change[] = [
  [
    '    import SpaceSidebar from "$lib/components/layout/SpaceSidebar.svelte";',
    `    import { Bell, House, Layers3, Settings, UserRound } from "lucide-svelte";
    import type { MessageKey } from "$lib/i18n";
    import NotificationsPanel from "$lib/components/layout/NotificationsPanel.svelte";
    import AccountSettings from "$lib/components/settings/AccountSettings.svelte";
    import SpaceSidebar from "$lib/components/layout/SpaceSidebar.svelte";`,
    "import { Bell, House, Layers3, Settings, UserRound }",
  ],
  [
    `    function openAppSettings() {
        openModal("app-settings", () => {});
    }`,
    `    const zamiTabs = [
        { id: "home", label: "spaceSidebar.home", icon: House },
        { id: "notifications", label: "common.notifications", icon: Bell },
        { id: "servers", label: "zami.servers", icon: Layers3 },
        { id: "settings", label: "common.settings", icon: Settings },
        { id: "profile", label: "accountSettings.profile", icon: UserRound },
    ] satisfies { id: typeof interfaceState.zamiTab; label: MessageKey; icon: typeof House }[];
    let settingsPage: { backToCategories: () => boolean } | undefined = $state();

    function selectZamiTab(tab: typeof interfaceState.zamiTab) {
        if (tab === interfaceState.zamiTab) return;
        closeModal();
        closeSidebar();
        interfaceState.leftOpen = false;
        interfaceState.zamiTab = tab;
    }`,
    "const zamiTabs = [",
  ],
  [
    `                if (interfaceState.modal === "app-settings") closeModal();
                else openAppSettings();`,
    `                if (interfaceState.modal === "app-settings") closeModal();
                else selectZamiTab(interfaceState.zamiTab === "settings" ? "home" : "settings");`,
    "else selectZamiTab(interfaceState.zamiTab",
  ],
  [
    "            !interfaceState.isMobile ||\n            isDragging ||",
    '            !interfaceState.isMobile ||\n            interfaceState.zamiTab !== "home" ||\n            isDragging ||',
    'interfaceState.zamiTab !== "home" ||\n            isDragging',
  ],
  [
    '        if (e.key === "Escape" && !e.shiftKey && dismissTopmost()) {',
    `        if (e.key === "Escape" && !e.shiftKey &&
            (dismissTopmost() || settingsPage?.backToCategories())) {`,
    "(dismissTopmost() || settingsPage?.backToCategories())",
  ],
  [
    "            /^[a-zA-Z0-9]$/.test(e.key) &&",
    '            interfaceState.zamiTab === "home" &&\n            /^[a-zA-Z0-9]$/.test(e.key) &&',
    'interfaceState.zamiTab === "home" &&\n            /^[a-zA-Z0-9]$/.test',
  ],
  [
    "                !interfaceState.leftOpen)\n        ) {\n            ensureBackGuard();",
    '                interfaceState.zamiTab !== "home" ||\n                !interfaceState.leftOpen)\n        ) {\n            ensureBackGuard();',
    'interfaceState.zamiTab !== "home" ||\n                !interfaceState.leftOpen)',
  ],
  [
    "        if (dismissTopmost()) return true;\n        if (!interfaceState.leftOpen)",
    `        if (dismissTopmost() || settingsPage?.backToCategories()) return true;
        if (interfaceState.zamiTab !== "home") {
            selectZamiTab("home");
            return true;
        }
        if (!interfaceState.leftOpen)`,
    '            selectZamiTab("home");\n            return true;',
  ],
  [
    "        reloadAccountSettings();",
    '        interfaceState.zamiTab = "home";\n        reloadAccountSettings();',
    '        interfaceState.zamiTab = "home";\n        reloadAccountSettings();',
  ],
  [
    "            document.hasFocus() &&\n            !roomsState.showInbox",
    '            document.hasFocus() &&\n            interfaceState.zamiTab === "home" &&\n            !roomsState.showInbox',
    'interfaceState.zamiTab === "home" &&\n            !roomsState.showInbox',
  ],
  [
    "        const openRoomId = roomsState.activeRoomId;\n        if (!openRoomId) return;",
    '        const openRoomId = roomsState.activeRoomId;\n        if (!openRoomId || interfaceState.zamiTab !== "home") return;',
    'if (!openRoomId || interfaceState.zamiTab !== "home") return;',
  ],
  [
    '        class="flex overflow-hidden bg-zam-background"\n        style="position: fixed; inset: 0;"',
    '        class="flex flex-col overflow-hidden bg-zam-background"\n        style="position: fixed; inset: 0;"\n        data-zami-launch-skip={interfaceState.zamiTab === "home" ? undefined : ""}',
    "data-zami-launch-skip={interfaceState.zamiTab",
  ],
  [
    "        {#if !interfaceState.isMobile}\n            <!-- Desktop: permanent sidebars + full-width profile footer -->",
    '        {#if interfaceState.zamiTab === "home"}\n        <div class="relative flex flex-1 min-h-0 min-w-0">\n        {#if !interfaceState.isMobile}',
    '{#if interfaceState.zamiTab === "home"}\n        <div',
  ],
  [
    `${spaceSwitcher}                    <div class="contents" dir={uiDir}>
                        <RoomList
                            onOpenSpaceSettings={openRoomSettings}
                            onOpenRoomSettings={openRoomSettings}
                        />
                    </div>
                </div>
                <div class="contents" dir={uiDir}>
                    <UpdateBanner />`,
    `                    <div class="contents" dir={uiDir}>
                        <RoomList
                            onOpenSpaceSettings={openRoomSettings}
                            onOpenRoomSettings={openRoomSettings}
                        />
                    </div>
                </div>
                <div class="contents" dir={uiDir}>
                    <!-- Desktop account switcher -->
                    <UpdateBanner />`,
    "<!-- Desktop account switcher -->",
  ],
  [
    `${spaceSwitcher}                    <div class="contents" dir={uiDir}>
                        <RoomList
                            onOpenSpaceSettings={openRoomSettings}
                            onOpenRoomSettings={openRoomSettings}
                        />
                    </div>
                </div>
                <div class="contents" dir={uiDir}>
                    <ProfileFooter`,
    `                    <div class="contents" dir={uiDir}>
                        <RoomList
                            onOpenSpaceSettings={openRoomSettings}
                            onOpenRoomSettings={openRoomSettings}
                        />
                    </div>
                </div>
                <div class="contents" dir={uiDir}>
                    <!-- Drawer account switcher -->
                    <ProfileFooter`,
    "<!-- Drawer account switcher -->",
  ],
  [
    `                    <ProfileFooter
                        onLogout={handleLogout}
                        onSettings={openAppSettings}
                    />`,
    "                    <ProfileFooter onLogout={handleLogout} />",
    "                    <ProfileFooter onLogout={handleLogout} />",
  ],
  [
    `                    <ProfileFooter
                        onLogout={handleLogout}
                        onSettings={() => {
                            openAppSettings();
                            interfaceState.leftOpen = false;
                        }}
                    />`,
    "                    <ProfileFooter onLogout={handleLogout} />",
    "<!-- Drawer account switcher -->\n                    <ProfileFooter onLogout={handleLogout}",
  ],
  [
    'class="fixed inset-0 z-30"\n                style="background: rgba(0,0,0,{backdropOpacity});',
    'class="absolute inset-0 z-30"\n                style="background: rgba(0,0,0,{backdropOpacity});',
    'class="absolute inset-0 z-30"\n                style="background: rgba(0,0,0,{backdropOpacity});',
  ],
  [
    "        </main>\n\n        <!-- Settings overlay -->",
    `        </main>
${tabPages}        <!-- Settings overlay -->`,
    '<nav class="zami-tab-bar"',
  ],
];
