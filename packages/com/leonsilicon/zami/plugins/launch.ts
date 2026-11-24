// What the app shows while it starts. The shell draws the launch frame first, before any of
// this code has loaded: the app as it last looked (launch-page.ts), with a composer that
// takes typing. Here the account's registered home is applied before Zam restores its last
// room, the frame comes off once the app's own shell has drawn the same thing underneath
// (what was typed goes to the real composer, and is sent if its send button was pressed),
// and the page for the next launch is saved as the app is left. Without a frame (the first
// launch after signing in or after an update), Zam's splash is a spinner with no text.
import { patchComponent, type Component } from "#components";
import { homeKey, landOnHome, pruneHomes, readHome } from "#home";
import { captureDom, type LaunchPage } from "#launch-page";
import LaunchSplash from "#launch-splash";
import { importModule, requireModule } from "#registry";

/** The app's shell has drawn what the frame shows once nothing in it has changed for this long, */
const QUIET_MS = 50;
/** or this long after its composer came up: sync goes on changing the app long after. */
const SETTLE_MS = 160;
/** The frame comes off this long after the shell mounted, whatever it shows. */
const SHELL_TIMEOUT_MS = 6000;
/** Longer when something was typed into it and there's no composer yet to take it. */
const TYPED_TIMEOUT_MS = 45_000;
/**
 * A page is saved this long after the app last changed, and no more often than the second:
 * copying the app's DOM takes a moment, and the save that matters is the one as it's left.
 */
const SAVE_QUIET_MS = 1500;
const SAVE_INTERVAL_MS = 60_000;
/** The largest page the shell keeps (launch-frame.ts in @-/com.leonsilicon.zami.shell). */
const MAX_PAGE_LENGTH = 2_800_000;
/** A plugin marks the app with it while it shows what a launch doesn't open on. */
const SKIP = "data-zami-launch-skip";

/** The launch frame the shell drew (launch-frame.ts in @-/com.leonsilicon.zami.shell). */
interface LaunchFrame {
  element: HTMLElement;
  composer: HTMLElement | null;
  /** What the composer held when the frame was drawn. */
  composerText: string;
  roomId: string | null;
  sendRequested: boolean;
  text(): string;
  dismiss(fade?: boolean): void;
}

declare global {
  var __zamiLaunch: LaunchFrame | null | undefined;
  var ReactNativeWebView: { postMessage(message: string): void } | undefined;
}

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

/** A step of the launch, on the performance timeline (`zami-launch:…`). */
function mark(step: string): void {
  try {
    performance.mark(`zami-launch:${step}`);
  } catch {
    // No performance timeline: nothing to measure with.
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

/** The app's shell, once it has mounted. */
function shell(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-zam-region="app"]');
}

/** The composer the app shows, if it shows one. */
function liveComposer(app: HTMLElement): HTMLElement | null {
  const composer = app.querySelector<HTMLElement>(
    '[data-zam-region="composer"] [contenteditable="true"]',
  );
  // (No boxes: it, or something around it, is `display: none`.)
  return composer?.getClientRects().length ? composer : null;
}

function roomsState(): RoomsState | null {
  try {
    return requireModule("$lib/stores/rooms.svelte").roomsState as RoomsState;
  } catch {
    return null;
  }
}

/** Tells the shell which page the next launch opens on (null: none). */
function postLaunchPage(page: string | null): void {
  try {
    globalThis.ReactNativeWebView?.postMessage(
      JSON.stringify({ type: "zami", event: "launchPage", page }),
    );
  } catch (error) {
    console.warn("[zami] couldn't save the launch page", error);
  }
}

let sendTitle = "";

/**
 * Puts what was typed into the frame's composer into the app's own, with the keyboard if it
 * was up, and presses send if the frame's send button was.
 */
function carryComposer(frame: LaunchFrame, app: HTMLElement): void {
  const from = frame.composer;
  if (!from) return;
  const typed = frame.text();
  const focused = document.activeElement === from;
  if (typed === frame.composerText && !focused) return;
  // What was typed is for the room the frame showed.
  if (roomsState()?.activeRoomId !== frame.roomId) return;
  const to = liveComposer(app);
  if (!to) return;
  // Before the frame goes: taking the focused element away would close the keyboard.
  to.focus();
  const selection = getSelection();
  if (!selection) return;
  selection.selectAllChildren(to);
  if (typed === frame.composerText) {
    selection.collapseToEnd();
    return;
  }
  // As typing does it, so the composer's own handlers see it. (Deprecated, but the one way
  // to insert into an editable as the user would.)
  document.execCommand("insertText", false, typed);
  if (!frame.sendRequested || !sendTitle) return;
  const press = (): boolean => {
    for (const button of app.querySelectorAll<HTMLButtonElement>(
      '[data-zam-region="composer"] button[title]',
    )) {
      if (button.title !== sendTitle || button.disabled) continue;
      button.click();
      return true;
    }
    return false;
  };
  // Once the composer has enabled its button for the text it now holds: in microtasks, so
  // the message is queued before sync starts replaying (which holds the main thread).
  void Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => {
      if (!press()) setTimeout(press, 50);
    });
}

/**
 * Calls `done` once the shell shows what the frame does: a composer, if the frame has one,
 * in an app that has stopped changing (a plugin may still be laying its own view over it).
 */
function whenShellReady(frame: LaunchFrame, done: (app: HTMLElement | null) => void): void {
  const started = performance.now();
  let changed = started;
  let readyAt: number | undefined;
  const observer = new MutationObserver((records) => {
    if (records.some((record) => !frame.element.contains(record.target))) {
      changed = performance.now();
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  const check = () => {
    const now = performance.now();
    const app = shell();
    const ready = app !== null && (frame.composer === null || liveComposer(app) !== null);
    if (!ready) readyAt = undefined;
    else if (readyAt === undefined) {
      readyAt = now;
      mark("ready");
    }
    const settled =
      readyAt !== undefined && (now - changed >= QUIET_MS || now - readyAt >= SETTLE_MS);
    const typed = frame.sendRequested || frame.text() !== frame.composerText;
    const timeout = typed ? TYPED_TIMEOUT_MS : SHELL_TIMEOUT_MS;
    if (settled || now - started >= timeout) {
      observer.disconnect();
      done(app);
    } else setTimeout(check, 20);
  };
  setTimeout(check, 20);
}

let lastSaved: string | undefined;

/** Saves the app as it is now, if it's showing what the next launch opens on. */
function save(): void {
  // (Only the Zami app's shell keeps a page.)
  if (globalThis.__zamiLaunch || !globalThis.ReactNativeWebView) return;
  const app = shell();
  const userId = authModule()?.auth.userId;
  if (!app || !userId || document.querySelector(`[${SKIP}]`)) return;
  const rooms = roomsState();
  let ui: { isMobile: boolean; leftOpen: boolean; modal: unknown };
  try {
    ui = requireModule("$lib/stores/interface.svelte").interfaceState as typeof ui;
  } catch {
    return;
  }
  // A launch opens with the drawer shut and nothing over the app.
  if (!rooms || (ui.isMobile && ui.leftOpen) || ui.modal) return;
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
  const dom = captureDom(app, sendTitle);
  if (!dom) return;
  const shown = JSON.stringify([userId, rooms.activeRoomId, innerWidth, dom]);
  if (shown === lastSaved) return;
  const page: LaunchPage = {
    ...dom,
    userId,
    build: buildKey(),
    roomId: rooms.activeRoomId,
    home: home !== null,
    homeKey: homeKey(localStorage, userId),
    until: home?.until ?? null,
    width: innerWidth,
    height: innerHeight,
    savedAt: Date.now(),
  };
  const json = JSON.stringify(page);
  if (json.length > MAX_PAGE_LENGTH) return;
  lastSaved = shown;
  postLaunchPage(json);
  mark("saved");
}

let saving = false;

/** Keeps the saved page current: when the app is left, and a moment after it changes. */
function startSaving(): void {
  if (saving) return;
  saving = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saved = -SAVE_INTERVAL_MS;
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
        console.error("[zami] the launch frame failed", error);
      }
      return Original(anchor, props);
    };
}

function onShell(): void {
  mark("shell");
  const frame = globalThis.__zamiLaunch;
  if (!frame) {
    startSaving();
    return;
  }
  whenShellReady(frame, (app) => {
    try {
      if (app?.isConnected) carryComposer(frame, app);
    } finally {
      mark("handoff");
      // Nothing to fade to when both show the same thing, and a fade would dim the keyboard's
      // composer for a moment.
      frame.dismiss(false);
      startSaving();
    }
  });
}

async function onLogin(): Promise<void> {
  // Not restoring after all (signed out, or the session is gone).
  globalThis.__zamiLaunch?.dismiss(false);
  const module = await importModule("$lib/stores/accounts.svelte");
  const { registry } = module.accountsState as { registry: { accounts: Account[] } };
  const userIds = registry.accounts.map((account) => account.userId);
  // An empty registry may be one Zam is about to recover (its registry backup).
  if (userIds.length > 0 || !activeUserId()) {
    pruneHomes(localStorage, userIds);
    pruneOutboxes(userIds);
  }
  // An account that signs out leaves no page behind.
  if (!activeUserId()) postLaunchPage(null);
}

/** Removes the unsent messages of accounts that aren't signed in here any more. */
function pruneOutboxes(userIds: readonly string[]): void {
  // (`zam.send-before-sync` keeps Zam's outbox under this key, per account.)
  const prefix = "zami_outbox:";
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix) && !userIds.includes(key.slice(prefix.length))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage is off: there's nothing kept in it.
  }
}

async function applyRegisteredHome(): Promise<void> {
  await importModule("$lib/stores/auth.svelte");
  const userId = activeUserId();
  // Adding an account or returning from OAuth shows the sign-in form.
  const parameters = new URLSearchParams(location.search);
  if (!userId || parameters.has("add") || parameters.has("state")) return;
  const home = readHome(localStorage, userId);
  if (home) landOnHome(localStorage, userId, home);
}

/**
 * Applies the registered home and follows which of its three views the root page draws.
 * Resolves once the components are patched, which is before the app's first render (Zam's
 * `init` hook).
 */
export async function startLaunch(): Promise<void> {
  // Remove the obsolete HTML snapshot cache. An older tab can hold the database
  // open, so its deletion runs independently of startup.
  try {
    indexedDB.deleteDatabase("zami-launch");
  } catch {
    // Storage may be unavailable.
  }

  try {
    await applyRegisteredHome();
  } catch (error) {
    console.error("[zami] couldn't restore the registered home", error);
  }

  try {
    const { t } = (await importModule("$lib/i18n/index")) as {
      t(this: void, key: string): string;
    };
    sendTitle = t("messageInput.sendMessage");
    // The app's root page chooses between these three. They're loaded here so that each is
    // patched before the page draws one.
    const splash = "$lib/components/layout/Splash.svelte";
    const login = "$lib/components/layout/LoginView.svelte";
    const appShell = "$lib/components/layout/AppShell.svelte";
    await Promise.all([importModule(splash), importModule(login), importModule(appShell)]);
    patchComponent(
      splash,
      (Original) => (anchor, props) =>
        LaunchSplash(anchor, { Original, label: t("common.loading"), props }),
    );
    patchComponent(
      login,
      signalling(() => {
        void onLogin().catch((error: unknown) => {
          console.error("[zami] couldn't clean up after signed-out accounts", error);
        });
      }),
    );
    patchComponent(appShell, signalling(onShell));
  } catch (error) {
    // The app starts as Zam does, splash and all.
    console.error("[zami] couldn't prepare the startup views", error);
    globalThis.__zamiLaunch?.dismiss(false);
  }
}
