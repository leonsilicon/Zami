import type { Change } from "#codemod";

export const spaceChanges: Change[] = [
  [
    "    let { onHomeClick, onOpenSpaceSettings }: Props = $props();",
    "    let { onHomeClick, onOpenSpaceSettings, onNavigate }: Props = $props();",
    "onOpenSpaceSettings, onNavigate }: Props",
  ],
  [
    "        onHomeClick: () => void;",
    "        onHomeClick: () => void;\n        onNavigate: () => void;",
    "onNavigate: () => void;",
  ],
  [
    'class="space-rail w-[4.5rem] bg-zam-backgroundTertiary flex flex-col items-center py-3 gap-2 overflow-y-auto scrollbar-hide flex-shrink-0"',
    'class="zami-server-list" aria-label={t("zami.servers")}',
    'class="zami-server-list"',
  ],
  [
    '        onclick={onHomeClick}\n        data-nav-space=""',
    '        onclick={onHomeClick}\n        aria-current={roomsState.activeSpaceId === null ? "true" : undefined}\n        data-nav-space=""',
    "aria-current={roomsState.activeSpaceId === null",
  ],
  [
    "        {#each [getHomeNotifs()] as n}",
    '        <span class="zami-server-name">{t("spaceSidebar.home")}</span>\n        {#each [getHomeNotifs()] as n}',
    'class="zami-server-name">{t("spaceSidebar.home")}',
  ],
  [
    `                onclick={() =>
                    roomsState.activeSpaceId === item.space.roomId &&
                    roomsState.spaceDrillParentId === null
                        ? roomsState.showSpaceHome
                            ? restoreLastRoom()
                            : showSpaceHome()
                        : setActiveSpace(item.space.roomId)}`,
    `                onclick={() => {
                    if (roomsState.activeSpaceId === item.space.roomId &&
                        roomsState.spaceDrillParentId === null) {
                        if (roomsState.showSpaceHome) restoreLastRoom();
                        else showSpaceHome();
                    } else {
                        setActiveSpace(item.space.roomId);
                    }
                    onNavigate();
                }}
                aria-current={isActive ? "true" : undefined}`,
    "setActiveSpace(item.space.roomId);",
  ],
  [
    "                {@render voiceBadge(spaceVoice, false)}",
    '                <span class="zami-server-name">{spaceName}</span>\n                {@render voiceBadge(spaceVoice, false)}',
    'class="zami-server-name">{spaceName}',
  ],
  [
    "                    {#if folderHasActive && !isExpanded}",
    '                    <span class="zami-server-name">{folderName}</span>\n                    {#if folderHasActive && !isExpanded}',
    'class="zami-server-name">{folderName}',
  ],
  [
    "                                onclick={() => setActiveSpace(space.roomId)}",
    `                                onclick={() => {
                                    setActiveSpace(space.roomId);
                                    onNavigate();
                                }}
                                aria-current={isActive ? "true" : undefined}`,
    "setActiveSpace(space.roomId);\n                                    onNavigate();",
  ],
  [
    "                                {@render voiceBadge(childVoice, true)}",
    '                                <span class="zami-server-name">{childName}</span>\n                                {@render voiceBadge(childVoice, true)}',
    'class="zami-server-name">{childName}',
  ],
  [
    "    </button>\n\n    <!-- Explore public rooms -->",
    '        <span class="zami-server-name">{t("spaceSidebar.addASpace")}</span>\n    </button>\n\n    <!-- Explore public rooms -->',
    'class="zami-server-name">{t("spaceSidebar.addASpace")}',
  ],
  [
    "    </button>\n\n    <!-- Touch drag ghost -->",
    '        <span class="zami-server-name">{t("spaceSidebar.exploreRooms")}</span>\n    </button>\n\n    <!-- Touch drag ghost -->',
    'class="zami-server-name">{t("spaceSidebar.exploreRooms")}',
  ],
];
