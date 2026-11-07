// `Notification` for Zam's code: the Web Notification API on expo-notifications. The
// globals this module exports become `window` members, and Metro points Zam's references
// to them here.
//
// Constructing one presents a local notification now (a notification with the same tag
// replaces it, as on the web), `onclick` fires when the user taps it, `onclose` when it's
// dismissed or closed, and `close()` takes it down. `Notification.permission` is
// synchronous on the web, so it's the system's permission as last read: at startup, on
// every return to the app (iOS changes it in the Settings app), after
// `requestPermission()`, and again whenever it's read while not granted (a prompt shown
// through expo-notifications directly changes it without telling this module).
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import { createEventHub, type EventHub } from "#events";

type Permission = "default" | "granted" | "denied";

let permission: Permission = "default";

/** The system's permission in the Notification API's terms: one it will still ask for is "default". */
function toPermission(status: Notifications.NotificationPermissionsStatus): Permission {
  if (status.granted) return "granted";
  return status.canAskAgain ? "default" : "denied";
}

async function readPermission(): Promise<Permission> {
  try {
    permission = toPermission(await Notifications.getPermissionsAsync());
  } catch {
    /* the native module is unavailable: keep the last answer */
  }
  return permission;
}

let lastRead = 0;
function rereadPermission(): void {
  if (Date.now() - lastRead < 1000) return;
  lastRead = Date.now();
  void readPermission();
}

void readPermission();
AppState.addEventListener("change", (state) => {
  if (state === "active") void readPermission();
});

/** Identifies Zam's notifications among the app's (pushes have the system's identifiers). */
const ID_PREFIX = "zam-notification:";
/**
 * The category every one of them has: it asks iOS to report a dismissal, which fires
 * `close` as the web does when the user clears a notification.
 */
const CATEGORY = "zam-notification";
void Notifications.setNotificationCategoryAsync(CATEGORY, [], {
  customDismissAction: true,
}).catch(() => {});

/** The notification each identifier shows now. A tag's newest replaces its older ones. */
const shown = new Map<string, ZamiNotification>();
let untagged = 0;

const DISMISS_ACTION = "com.apple.UNNotificationDismissActionIdentifier";

Notifications.addNotificationResponseReceivedListener((response) => {
  const { identifier } = response.notification.request;
  const notification = shown.get(identifier);
  if (notification === undefined) return;
  // Tapped or dismissed, iOS has taken it down.
  shown.delete(identifier);
  if (response.actionIdentifier !== DISMISS_ACTION) notification.dispatch("click");
  notification.dispatch("close");
});

type Handler = ((this: ZamiNotification, event: Event) => unknown) | null;

interface ZamiNotificationOptions {
  body?: string;
  tag?: string;
  data?: unknown;
  icon?: string;
  badge?: string;
  image?: string;
  lang?: string;
  dir?: string;
  silent?: boolean | null;
  renotify?: boolean;
  requireInteraction?: boolean;
  timestamp?: number;
}

class ZamiNotification {
  static get permission(): Permission {
    if (permission !== "granted") rereadPermission();
    return permission;
  }

  /** The system's prompt (if it will still show one), then the permission after it. */
  static async requestPermission(callback?: (permission: Permission) => void): Promise<Permission> {
    try {
      permission = toPermission(await Notifications.requestPermissionsAsync());
    } catch {
      await readPermission();
    }
    callback?.(permission);
    return permission;
  }

  /** Action buttons aren't offered. */
  static readonly maxActions = 0;

  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly data: unknown;
  readonly icon: string;
  readonly badge: string;
  readonly image: string;
  readonly lang: string;
  readonly dir: string;
  readonly silent: boolean | null;
  readonly renotify: boolean;
  readonly requireInteraction: boolean;
  readonly timestamp: number;
  readonly actions: readonly never[] = [];

  onclick: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;
  onshow: Handler = null;

  readonly #events: EventHub = createEventHub();
  readonly #identifier: string;
  /** Settles once the system has the notification (or refused it). */
  readonly #presented: Promise<unknown>;

  constructor(title: string, options: ZamiNotificationOptions = {}) {
    this.title = String(title);
    this.body = options.body ?? "";
    this.tag = options.tag ?? "";
    this.data = options.data ?? null;
    this.icon = options.icon ?? "";
    this.badge = options.badge ?? "";
    this.image = options.image ?? "";
    this.lang = options.lang ?? "";
    this.dir = options.dir ?? "auto";
    this.silent = options.silent ?? null;
    this.renotify = options.renotify ?? false;
    this.requireInteraction = options.requireInteraction ?? false;
    this.timestamp = options.timestamp ?? Date.now();
    this.#identifier = ID_PREFIX + (this.tag || `untagged-${++untagged}-${Date.now()}`);

    if (permission !== "granted") {
      // As on the web: a notification without permission only fires `error`.
      this.#presented = Promise.resolve();
      queueMicrotask(() => this.dispatch("error"));
      return;
    }
    // Same identifier, same tag: iOS replaces the one it shows, and alerts again.
    shown.set(this.#identifier, this);
    this.#presented = Notifications.scheduleNotificationAsync({
      identifier: this.#identifier,
      content: {
        title: this.title,
        body: this.body || null,
        // Plain data only: it's stored with the notification.
        data: { zamNotification: true, tag: this.tag },
        sound: this.silent === true ? false : "default",
        categoryIdentifier: CATEGORY,
      },
      trigger: null,
    }).then(
      () => this.dispatch("show"),
      (error: unknown) => {
        if (shown.get(this.#identifier) === this) shown.delete(this.#identifier);
        console.warn("[zami] couldn't post a notification", error);
        this.dispatch("error");
      },
    );
  }

  /** Takes it down, unless a newer notification with the same tag has replaced it. */
  close(): void {
    if (shown.get(this.#identifier) !== this) return;
    shown.delete(this.#identifier);
    const identifier = this.#identifier;
    void this.#presented.then(() =>
      Notifications.dismissNotificationAsync(identifier).catch(() => {}),
    );
    queueMicrotask(() => this.dispatch("close"));
  }

  addEventListener(type: string, listener: unknown): void {
    this.#events.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: unknown): void {
    this.#events.removeEventListener(type, listener);
  }

  /** Fires `type` at the `on…` handler, then at the listeners. */
  dispatch(type: "click" | "close" | "error" | "show"): void {
    const handler = this[`on${type}`];
    const event = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
    } as unknown as Event;
    if (typeof handler === "function") {
      try {
        handler.call(this, event);
      } catch (error) {
        console.error(`[zami] Notification "${type}" handler failed`, error);
      }
    }
    this.#events.dispatch(type, { target: this, currentTarget: this });
  }
}

export const notificationGlobals: Record<string, unknown> = { Notification: ZamiNotification };
