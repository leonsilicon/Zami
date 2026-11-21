// What the app shows while it starts. Zam restores a session behind a "Restoring session…"
// splash: the shell only mounts once the stores are open, encryption is up and sync has
// started. Here the app opens on the launch page instead (launch-page.ts): the app as it
// last looked, saved whenever it's left, on the home a plugin registered if one did
// (home.ts). It's drawn in Zam's `init` hook, before any of the app's own code has loaded,
// and comes off once the real shell has drawn the same thing underneath. Without a saved
// page (the first launch after signing in or after an update), the splash is a spinner
// with no text.
import { patchComponent, type Component } from "#components";
import { landOnHome, pruneHomes, readHome, type Home } from "#home";
import {
  captureDom,
  composerText,
  drawLaunchPage,
  launchPageFits,
  type DrawnLaunchPage,
  type LaunchPage,
} from "#launch-page";
import LaunchSplash from "#launch-splash";
import { keepLaunchPages, readLaunchPage, writeLaunchPage } from "#launch-store";
import { importModule, requireModule } from "#registry";

/** How long the launch page waits for a saved page before the app starts without one. */
const READ_TIMEOUT_MS = 400;
/** The real shell has drawn once nothing in it has changed for this long. */
const QUIET_MS = 250;
/** The same, when it shows no messages (an empty room, or no room). */
const QUIET_EMPTY_MS = 1500;
/** The launch page comes off this long after the shell mounted, settled or not. */
const SHELL_TIMEOUT_MS = 8000;
/** And this long after it was drawn, whatever happened to the restore. */
const LAUNCH_TIMEOUT_MS = 45_000;
/** A page is saved this long after the app last changed, and no more often than that. */
const SAVE_QUIET_MS = 1500;
const SAVE_INTERVAL_MS = 8000;

interface Account {
  userId: string;
}

interface AuthModule {
  auth: { userId: string | null };
  loadStoredSession(): Account | null;
}

interface RoomsState {
  activeRoomId: string | null;
  activeSpaceId: string | null;
  showInbox: boolean;
  draftDm: object | null;
}

function authModule(): AuthModule | null {
  try {
    return requireModule("$lib/stores/auth.svelte") as unknown as AuthModule;
  } catch {
    return null;
  }
}

/** The account that's signed in, or about to be restored. */
export function activeUserId(): string | null {
  const module = authModule();
  if (!module) return null;
  try {
    return module.auth.userId ?? module.loadStoredSession()?.userId ?? null;
  } catch {
    return null;
  }
}

/** This build of the web app: its entry chunks, whose names are hashes of their content. */
function buildKey(): string {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')]
    .map((link) => new URL(link.href, location.href).pathname)
    .filter((path) => path.includes("/entry/"))
    .toSorted()
    .join("|");
}

/** For looking at the launch page: `localStorage.zami_launch_hold` keeps it up that many ms. */
function holdMs(): number {
  try {
    return Math.min(Number(localStorage.getItem("zami_launch_hold")) || 0, 60_000);
  } catch {
    return 0;
  }
}

/** The app's shell, once it has mounted. */
function shell(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-zam-region="app"]');
}

let drawn: DrawnLaunchPage | null = null;
let launchTimer: ReturnType<typeof setTimeout> | undefined;

/** A step of the launch, on the performance timeline (`zami-launch:…`). */
function mark(step: string): void {
  try {
    performance.mark(`zami-launch:${step}`);
  } catch {
    // No performance timeline: nothing to measure with.
  }
}

function dismiss(fade: boolean): void {
  clearTimeout(launchTimer);
  if (drawn) mark("dismissed");
  drawn?.dismiss(fade);
  drawn = null;
}

/** Puts what was typed into the launch page's composer into the app's own. */
function carryComposer(page: DrawnLaunchPage, app: HTMLElement): void {
  const from = page.composer;
  if (!from) return;
  const typed = composerText(from);
  const focused = document.activeElement === from;
  if (typed === page.composerText && !focused) return;
  const to = app.querySelector<HTMLElement>(
    '[data-zam-region="composer"] [contenteditable="true"]',
  );
  if (!to) return;
  to.focus();
  const selection = getSelection();
  if (!selection) return;
  selection.selectAllChildren(to);
  if (typed === page.composerText) {
    selection.collapseToEnd();
    return;
  }
  // As typing does it, so the composer's own handlers see it. (Deprecated, but the one way
  // to insert into an editable as the user would.)
  document.execCommand("insertText", false, typed);
}

/**
 * Calls `done` once the shell has drawn what the launch page shows: a timeline with
 * messages in it, on screen, that has stopped changing. A shell that shows no messages (an
 * empty room, or none) has drawn once it's been still for longer, unless the launch page is
 * a plugin's home: then the plugin may still be getting there (its own placeholder is up
 * meanwhile), and the launch page stays for it.
 */
function whenShellSettles(done: (app: HTMLElement | null) => void): void {
  const started = performance.now();
  let changed = started;
  const observer = new MutationObserver((records) => {
    if (records.some((record) => !drawn?.element.contains(record.target))) {
      changed = performance.now();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  const userId = activeUserId();
  const home = userId ? readHome(localStorage, userId) : null;
  const check = () => {
    const now = performance.now();
    const app = shell();
    const timeline = app?.querySelector('[data-zam-region="timeline"]');
    // (No boxes: it, or something around it, is `display: none`.)
    const messages = Boolean(timeline?.getClientRects().length && timeline.textContent?.trim());
    const quiet = now - changed;
    const settled = messages ? quiet >= QUIET_MS : !home && quiet >= QUIET_EMPTY_MS;
    if ((app && settled) || now - started >= SHELL_TIMEOUT_MS) {
      observer.disconnect();
      done(app);
    } else setTimeout(check, 50);
  };
  setTimeout(check, 50);
}

let saving = false;

/** Saves the app as it is now, if it's showing what the next launch opens on. */
function save(): void {
  if (drawn) return;
  const app = shell();
  const userId = authModule()?.auth.userId;
  if (!app || !userId) return;
  let rooms: RoomsState;
  let mobileDrawerOpen: boolean;
  try {
    rooms = requireModule("$lib/stores/rooms.svelte").roomsState as RoomsState;
    const ui = requireModule("$lib/stores/interface.svelte").interfaceState as {
      isMobile: boolean;
      leftOpen: boolean;
    };
    mobileDrawerOpen = ui.isMobile && ui.leftOpen;
  } catch {
    return;
  }
  // A launch opens with the drawer shut.
  if (mobileDrawerOpen) return;
  const home = readHome(localStorage, userId);
  if (
    home &&
    (rooms.activeRoomId !== home.roomId ||
      (rooms.activeSpaceId ?? null) !== home.spaceId ||
      rooms.showInbox ||
      rooms.draftDm)
  ) {
    // Somewhere else for now: the last page of the home stays.
    return;
  }
  const dom = captureDom(app);
  if (!dom) return;
  const page: LaunchPage = {
    ...dom,
    userId,
    build: buildKey(),
    roomId: rooms.activeRoomId,
    home: home !== null,
    until: home?.until ?? null,
    width: innerWidth,
    height: innerHeight,
    savedAt: Date.now(),
  };
  void writeLaunchPage(page).catch((error: unknown) => {
    console.warn("[zami] couldn't save the launch page", error);
  });
}

/** Keeps the saved page current: when the app is left, and a moment after it changes. */
function startSaving(): void {
  if (saving) return;
  saving = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saved = 0;
  const saveNow = () => {
    clearTimeout(timer);
    timer = undefined;
    saved = performance.now();
    try {
      save();
    } catch (error) {
      console.warn("[zami] couldn't save the launch page", error);
    }
  };
  const schedule = () => {
    if (timer !== undefined || document.visibilityState === "hidden") return;
    const wait = Math.max(SAVE_QUIET_MS, SAVE_INTERVAL_MS - (performance.now() - saved));
    timer = setTimeout(saveNow, wait);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
  });
  addEventListener("pagehide", saveNow);
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  schedule();
}

/** A component that tells `signal` when the app draws it. */
function signalling(signal: () => void) {
  return (Original: Component): Component =>
    (anchor, props) => {
      try {
        signal();
      } catch (error) {
        console.error("[zami] the launch page failed", error);
      }
      return Original(anchor, props);
    };
}

function onShell(): void {
  mark("shell");
  whenShellSettles((app) => {
    setTimeout(
      () => {
        if (drawn && app?.isConnected) carryComposer(drawn, app);
        dismiss(true);
        startSaving();
      },
      drawn ? holdMs() : 0,
    );
  });
}

function onLogin(): void {
  // Not restoring after all (signed out, or the session is gone).
  dismiss(false);
  void accounts().then((userIds) => {
    // An empty registry may be one Zam is about to recover (its registry backup).
    if (userIds.length > 0 || !activeUserId()) {
      pruneHomes(localStorage, userIds);
      return keepLaunchPages(userIds);
    }
  });
}

async function accounts(): Promise<string[]> {
  const module = await importModule("$lib/stores/accounts.svelte");
  const state = module.accountsState as { registry: { accounts: Account[] } };
  return state.registry.accounts.map((account) => account.userId);
}

async function savedPage(userId: string, home: Home | null): Promise<LaunchPage | null> {
  const page = await Promise.race([
    readLaunchPage(userId),
    new Promise<null>((resolve) => setTimeout(resolve, READ_TIMEOUT_MS, null)),
  ]);
  if (!page) return null;
  const launch = { userId, build: buildKey(), width: innerWidth, home, now: Date.now() };
  return launchPageFits(page, launch) ? page : null;
}

/** Whether this load restores the stored session (as Zam's root page decides it). */
function restoresSession(): boolean {
  const parameters = new URLSearchParams(location.search);
  // Adding an account, or coming back from an OAuth sign-in: the login view.
  return !parameters.has("add") && !parameters.has("state");
}

async function draw(): Promise<void> {
  await importModule("$lib/stores/auth.svelte");
  const userId = activeUserId();
  if (!userId || !restoresSession()) return;
  const home = readHome(localStorage, userId);
  if (home) landOnHome(localStorage, userId, home);
  const page = await savedPage(userId, home);
  if (!page) return;
  drawn = drawLaunchPage(page);
  mark("drawn");
  launchTimer = setTimeout(() => dismiss(true), LAUNCH_TIMEOUT_MS);
}

/**
 * Draws the launch page and takes the text off Zam's splash. Resolves once the components
 * it follows are patched, which is before the app's first render (Zam's `init` hook).
 */
export async function startLaunch(): Promise<void> {
  try {
    await draw();
  } catch (error) {
    console.error("[zami] the launch page failed", error);
    dismiss(false);
  }
  try {
    const { t } = (await importModule("$lib/i18n/index")) as {
      t(this: void, key: string): string;
    };
    // The app's root page chooses between these three. They're loaded here so that each is
    // patched before the page draws one.
    await Promise.all([
      importModule("$lib/components/layout/Splash.svelte"),
      importModule("$lib/components/layout/LoginView.svelte"),
      importModule("$lib/components/layout/AppShell.svelte"),
    ]);
    patchComponent(
      "$lib/components/layout/Splash.svelte",
      (Original) => (anchor, props) =>
        LaunchSplash(anchor, { Original, label: t("common.loading"), props }),
    );
    patchComponent("$lib/components/layout/LoginView.svelte", signalling(onLogin));
    patchComponent("$lib/components/layout/AppShell.svelte", signalling(onShell));
  } catch (error) {
    // The app starts as Zam does, splash and all.
    console.error("[zami] the launch page failed", error);
    dismiss(false);
  }
}
