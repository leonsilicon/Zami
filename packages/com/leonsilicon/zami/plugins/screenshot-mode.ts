import { importModule } from "#registry";
import { installScreenshotHomeserver, screenshotAccount } from "#screenshot-fixture";
import {
  conversationId,
  screenshotSceneFromLink,
  SCREENSHOT_APP_ID,
  studioId,
  type ScreenshotScene,
} from "#screenshot-scenes";

interface ScreenshotBridge {
  nativeCallback(
    plugin: "App",
    method: "addListener",
    options: { eventName: "appUrlOpen" },
    receive: (event: { url?: string } | null) => void,
  ): string;
  nativePromise(plugin: "App", method: "getLaunchUrl"): Promise<{ url?: string } | undefined>;
}

interface ScreenshotRooms {
  roomsState: { spaces: Array<{ roomId: string }> };
  setActiveSpace(id: string): void;
  setActiveRoom(id: string): void;
  showSpaceHome(): void;
}

interface ScreenshotInterface {
  interfaceState: { leftOpen: boolean };
  closeModal(): void;
  openAppSettingsTab(tab: "privacy"): void;
}

async function navigateWhenReady(scene: ScreenshotScene, isCurrent: () => boolean): Promise<void> {
  const [roomModule, interfaceModule] = await Promise.all([
    importModule("$lib/stores/rooms.svelte"),
    importModule("$lib/stores/interface.svelte"),
  ]);
  const rooms = roomModule as unknown as ScreenshotRooms;
  const ui = interfaceModule as unknown as ScreenshotInterface;
  const deadline = performance.now() + 25_000;

  while (isCurrent() && performance.now() < deadline) {
    if (
      document.querySelector('[data-zam-region="app"]') &&
      rooms.roomsState.spaces.some((room) => room.roomId === studioId)
    ) {
      ui.closeModal();
      rooms.setActiveSpace(studioId);
      ui.interfaceState.leftOpen = false;
      if (scene === "spaces") rooms.showSpaceHome();
      else rooms.setActiveRoom(conversationId);
      if (scene === "privacy") ui.openAppSettingsTab("privacy");
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}

/** Only the cloned simulator app can enter the screenshot presentation session. */
export async function startScreenshotMode(): Promise<void> {
  const shell = globalThis as typeof globalThis & {
    __zamiShell?: { appId: string | null };
    Capacitor?: ScreenshotBridge;
  };
  if (shell.__zamiShell?.appId !== SCREENSHOT_APP_ID || !shell.Capacitor)
    throw new Error("Screenshot assets must run in the isolated iOS screenshot app");

  installScreenshotHomeserver();
  const [accounts, settings, i18n] = await Promise.all([
    importModule("$lib/stores/accounts.svelte"),
    importModule("$lib/stores/settings.svelte"),
    importModule("$lib/i18n/index"),
  ]);
  (i18n.setLocale as (locale: "en") => void)("en");
  (settings.setDeviceNotifications as (value: boolean) => void)(false);
  (accounts.upsertAndActivate as (account: typeof screenshotAccount) => void)(screenshotAccount);

  let request = 0;
  function accept(url?: string) {
    const scene = url && screenshotSceneFromLink(url);
    if (!scene) return;
    const current = ++request;
    void navigateWhenReady(scene, () => current === request).catch((error: unknown) => {
      console.error("[zami screenshots] could not open scene", error);
    });
  }
  shell.Capacitor.nativeCallback("App", "addListener", { eventName: "appUrlOpen" }, (event) => {
    accept(event?.url);
  });
  const launch = await shell.Capacitor.nativePromise("App", "getLaunchUrl");
  accept(launch?.url);
}
