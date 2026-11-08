// The views `_parity` compares, as recipes both apps run: each step runs in Zam's web
// build and in the Zami app at the same time, then the runner waits for both screens to
// settle and compares them. A view starts from a fresh load of the app (signed in or not,
// with no remembered room), so its steps say everything that leads to it.
//
// Recipes act the way a person would where they can (`app.press` by visible text or
// accessibility label), and through Zam's stores (`scope`) where a press would only add
// flakiness, such as opening a room. Both apps run the same store code, so a store change
// is the same navigation in both.
import { MESSAGES } from "#fixtures";
import type { Driver, SeedData, ViewInfo } from "#protocol";
import * as scope from "#scope";

export interface ViewContext {
  app: Driver;
  scope: typeof scope;
  data: SeedData;
}

export type Step = (context: ViewContext) => Promise<void> | void;

export interface View {
  name: string;
  /** Signed-out views run before the runner signs the apps in. */
  signedIn: boolean;
  steps: Step[];
}

function view(name: string, ...steps: Step[]): View {
  return { name, signedIn: true, steps };
}

function signedOut(name: string, ...steps: Step[]): View {
  return { name, signedIn: false, steps };
}

/** Opens a seeded room (see seed.ts) and waits for its timeline. */
function openRoom(room: string): Step {
  return async ({ scope, data, app }) => {
    const roomId = data.rooms[room];
    if (roomId === undefined) throw new Error(`No seeded room "${room}"`);
    scope.navigateToRoom(roomId);
    // Long enough for the room's own effects (which close stray menus) to have run.
    await app.sleep(1000);
  };
}

const SETTINGS_TABS = [
  "account",
  "security",
  "privacy",
  "rich-presence",
  "appearance",
  "messages-media",
  "notifications",
  "voice",
  "keybinds",
  "emotes",
  "general",
  "plugins",
  "server",
  "about",
] as const;

const ROOM_SETTINGS_TABS = [
  "general",
  "access",
  "notifications",
  "security",
  "permissions",
  "members",
  "emotes",
] as const;

const SIDEBARS = ["members", "pinned", "notifications", "search", "threads", "media"] as const;

function seeded(data: SeedData, key: "rooms" | "users" | "events", name: string): string {
  const id = data[key][name];
  if (id === undefined) throw new Error(`Nothing seeded as ${key}.${name}`);
  return id;
}

const openDrawer: Step = async ({ scope, app }) => {
  scope.interfaceState.leftOpen = true;
  // Until it has slid in.
  await app.sleep(500);
};

/** The room list's context menu for #Announcements (a held touch on its row). */
const roomMenu: Step[] = [
  openDrawer,
  async ({ app }) => {
    await app.waitFor({ text: "Announcements" });
    await app.longPress({ text: "Announcements" });
  },
];

/**
 * A message's actions in #general. Zam opens them with a tap by default
 * (`holdToOpenMessageMenu` is off).
 */
function messageActions(text: string): Step[] {
  return [
    openRoom("general"),
    async ({ app }) => {
      await app.press({ text });
    },
  ];
}

export const views: View[] = [
  // Signed out: the sign-in screen as the app opens, and registration.
  signedOut("sign-in"),
  signedOut("register", async ({ app, scope }) => {
    await app.press({ text: scope.t("loginView.register") });
  }),

  // Where the app lands after restoring a session, with no room remembered.
  view("landing"),
  view("drawer", openDrawer),
  view(
    "drawer-space",
    ({ scope, data }) => {
      scope.setActiveSpace(seeded(data, "rooms", "space"));
    },
    openDrawer,
  ),
  view("space-home", ({ scope, data }) => {
    scope.setActiveSpace(seeded(data, "rooms", "space"));
    scope.showSpaceHome();
  }),
  view("inbox", openDrawer, async ({ app, scope }) => {
    await app.press({ text: scope.t("roomList.pendingInvites") });
  }),
  view("draft-dm", ({ scope, data }) => {
    scope.openDraftDm(seeded(data, "users", "carol"), false);
  }),

  // Rooms and their timelines.
  view("room", openRoom("general")),
  view(
    "room-random",
    ({ scope, data }) => {
      scope.setActiveSpace(seeded(data, "rooms", "space"));
    },
    openRoom("random"),
  ),
  view("room-dm", openRoom("dm")),
  view("room-announcements", openRoom("announcements")),
  view("room-invite", openRoom("invite")),
  view("room-header-overflow", openRoom("general"), ({ scope }) => {
    scope.openModal("room-header-overflow", () => {});
  }),
  view("room-topic", openRoom("general"), ({ scope }) => {
    scope.openModal("room-topic", () => {});
  }),
  ...SIDEBARS.map((sidebar) =>
    view(
      `panel-${sidebar}`,
      openRoom(sidebar === "pinned" ? "announcements" : "general"),
      ({ scope }) => {
        scope.openSidebar(sidebar, () => {});
      },
    ),
  ),
  view("message-actions", ...messageActions(MESSAGES.lunch)),
  view("message-actions-own", ...messageActions(MESSAGES.long)),

  // The composer's pickers and menus.
  // A room's composer is keyed by the room's ID.
  view("emoji-picker", openRoom("general"), ({ scope, data }) => {
    scope.openComposerPicker("emoji", seeded(data, "rooms", "general"));
  }),
  view("sticker-picker", openRoom("general"), ({ scope, data }) => {
    scope.openComposerPicker("sticker", seeded(data, "rooms", "general"));
  }),
  view("gif-picker", openRoom("general"), ({ scope, data }) => {
    scope.openComposerPicker("gif", seeded(data, "rooms", "general"));
  }),
  view("composer-actions", openRoom("general"), ({ scope, data }) => {
    scope.openComposerActions(seeded(data, "rooms", "general"));
  }),
  view("create-poll", openRoom("general"), ({ scope, data }) => {
    scope.openCreatePollDialog(seeded(data, "rooms", "general"));
  }),
  view("invite-dialog", openRoom("general"), ({ scope, data }) => {
    scope.openInviteDialog(seeded(data, "rooms", "general"));
  }),

  // Dialogs the app shell opens.
  view("encryption-setup", ({ scope }) => {
    scope.openEncryptionSetup();
  }),
  view("quick-switcher", ({ scope }) => {
    scope.openModal("quick-switcher", () => {});
  }),
  view("room-directory", openDrawer, async ({ app, scope }) => {
    await app.press({ label: scope.t("spaceSidebar.exploreRooms") });
  }),
  view("space-add-menu", openDrawer, async ({ app, scope }) => {
    await app.press({ label: scope.t("spaceSidebar.addASpace") });
  }),
  view("room-menu", ...roomMenu),
  view("room-settings", ...roomMenu, async ({ app, scope }) => {
    await app.press({ text: scope.t("common.settings") });
  }),
  ...ROOM_SETTINGS_TABS.map((tab) =>
    view(
      `room-settings-${tab}`,
      ...roomMenu,
      async ({ app, scope }) => {
        await app.press({ text: scope.t("common.settings") });
      },
      async ({ app, scope }) => {
        const label = scope.roomSettingsTabLabel(tab);
        await app.waitFor({ text: label });
        await app.press({ text: label });
      },
    ),
  ),

  // App settings: the list, then each page.
  view("settings", ({ scope }) => {
    scope.openModal("app-settings", () => {});
  }),
  ...SETTINGS_TABS.map((tab) =>
    view(`settings-${tab}`, ({ scope }) => {
      scope.openAppSettingsTab(tab);
    }),
  ),
];

/** The catalog as an agent reports it to the runner. */
export function viewInfos(): ViewInfo[] {
  return views.map(({ name, signedIn, steps }) => ({ name, signedIn, steps: steps.length }));
}

export async function runStep(
  name: string,
  index: number,
  app: Driver,
  data: SeedData,
): Promise<void> {
  const found = views.find((candidate) => candidate.name === name);
  const step = found?.steps[index];
  if (step === undefined) throw new Error(`No step ${index} in view "${name}"`);
  await step({ app, scope, data });
}

/** The location the apps remember between loads, cleared before each view. */
export const FORGOTTEN_STORAGE_PREFIXES = ["matrix_last_room_by_space", "matrix_last_space"];
