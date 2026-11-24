import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";
import { matrixChanges, notificationsChanges } from "#recent";
import { messageAreaChanges, roomsChanges, threadChanges } from "#rooms";
import { footerChanges, profileChanges, settingsChanges } from "#settings";
import { shellChanges } from "#shell";
import { spaceChanges } from "#spaces";

export type Change = [from: string, to: string, marker: string];

const changes: Record<string, Change[]> = {
  "AppShell.svelte": shellChanges,
  "AppSettings.svelte": settingsChanges,
  "AccountSettings.svelte": profileChanges,
  "ProfileFooter.svelte": footerChanges,
  "MessageArea.svelte": messageAreaChanges,
  "NotificationsPanel.svelte": notificationsChanges,
  "SpaceSidebar.svelte": spaceChanges,
  "ThreadPanel.svelte": threadChanges,
  "client.ts": matrixChanges,
  "rooms.svelte.ts": roomsChanges,
  "interface.svelte.ts": [
    [
      "    sidebar: null as SidebarId | null,",
      '    sidebar: null as SidebarId | null,\n    zamiTab: "home" as "home" | "notifications" | "servers" | "settings" | "profile",',
      'zamiTab: "home" as',
    ],
  ],
};

const strings: Record<string, [servers: string, empty: string]> = {
  en: ["Servers", "No recent messages"],
  de: ["Server", "Keine aktuellen Nachrichten"],
  es: ["Servidores", "No hay mensajes recientes"],
  fr: ["Serveurs", "Aucun message récent"],
  ja: ["サーバー", "最近のメッセージはありません"],
  pt: ["Servidores", "Não há mensagens recentes"],
  ru: ["Серверы", "Нет недавних сообщений"],
  uk: ["Сервери", "Немає нещодавніх повідомлень"],
  zh: ["服务器", "没有最近的消息"],
};

export default function codemod(root: SgRoot): string | null {
  const file = root.filename().split("/").at(-1) ?? "";
  const kinds = [String(root.root().kind())];
  const locale = strings[file.replace(/\.ts$/, "")];
  const edits: Change[] = locale
    ? [
        [
          '    "common.settings":',
          `    "zami.servers": ${JSON.stringify(locale[0])},\n    "zami.noRecentMessages": ${JSON.stringify(locale[1])},\n    "common.settings":`,
          '"zami.servers":',
        ],
      ]
    : (changes[file] ?? []);
  return editNodes(
    root,
    edits.map(([from, to, marker]) => ({ kinds, contains: from, from, to, marker })),
  );
}
