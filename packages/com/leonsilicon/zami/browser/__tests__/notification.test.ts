import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const native = vi.hoisted(() => ({
  permission: { granted: false, canAskAgain: true },
  scheduled: [] as { identifier: string; content: Record<string, unknown> }[],
  dismissed: [] as string[],
  respond: null as ((response: unknown) => void) | null,
  onAppState: null as ((state: string) => void) | null,
}));

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => native.permission,
  requestPermissionsAsync: async () => {
    native.permission = { granted: true, canAskAgain: true };
    return native.permission;
  },
  setNotificationCategoryAsync: async () => null,
  scheduleNotificationAsync: async (request: {
    identifier: string;
    content: Record<string, unknown>;
  }) => {
    native.scheduled.push(request);
    return request.identifier;
  },
  dismissNotificationAsync: async (identifier: string) => {
    native.dismissed.push(identifier);
  },
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    native.respond = listener;
    return { remove() {} };
  },
}));

vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_type: string, listener: (state: string) => void) => {
      native.onAppState = listener;
      return { remove() {} };
    },
  },
}));

const { notificationGlobals } = await import("#notification");

interface TestNotification {
  title: string;
  tag: string;
  onclick: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onshow: ((event: Event) => void) | null;
  close(): void;
}
interface TestNotificationClass {
  new (title: string, options?: Record<string, unknown>): TestNotification;
  readonly permission: string;
  requestPermission(callback?: (permission: string) => void): Promise<string>;
}
const Notification = notificationGlobals.Notification as TestNotificationClass;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function tap(identifier: string, action = "expo.modules.notifications.actions.DEFAULT") {
  native.respond?.({ actionIdentifier: action, notification: { request: { identifier } } });
}

beforeEach(async () => {
  native.permission = { granted: true, canAskAgain: true };
  native.onAppState?.("active");
  await settle();
  native.scheduled.length = 0;
  native.dismissed.length = 0;
});

describe("Notification.permission", () => {
  test("is the system's permission, with one it will still ask for as default", async () => {
    native.permission = { granted: false, canAskAgain: true };
    native.onAppState?.("active");
    await settle();
    expect(Notification.permission).toBe("default");
    native.permission = { granted: false, canAskAgain: false };
    native.onAppState?.("active");
    await settle();
    expect(Notification.permission).toBe("denied");
  });

  test("requestPermission asks the system and reports the answer", async () => {
    native.permission = { granted: false, canAskAgain: true };
    native.onAppState?.("active");
    await settle();
    const callback = vi.fn();
    await expect(Notification.requestPermission(callback)).resolves.toBe("granted");
    expect(callback).toHaveBeenCalledWith("granted");
    expect(Notification.permission).toBe("granted");
  });
});

describe("new Notification()", () => {
  test("without permission fires error and posts nothing", async () => {
    native.permission = { granted: false, canAskAgain: false };
    native.onAppState?.("active");
    await settle();
    const n = new Notification("Hi", { body: "there" });
    const onerror = vi.fn();
    n.onerror = onerror;
    await settle();
    expect(onerror).toHaveBeenCalledOnce();
    expect(native.scheduled).toHaveLength(0);
  });

  test("posts a local notification now, identified by its tag, and fires show", async () => {
    const n = new Notification("Room", { body: "alice: hi", tag: "room:!a", silent: true });
    const onshow = vi.fn();
    n.onshow = onshow;
    await settle();
    expect(native.scheduled).toEqual([
      expect.objectContaining({
        identifier: "zam-notification:room:!a",
        content: expect.objectContaining({ title: "Room", body: "alice: hi", sound: false }),
        trigger: null,
      }),
    ]);
    expect(onshow).toHaveBeenCalledOnce();
  });

  test("a tapped notification fires click, then close", async () => {
    const n = new Notification("Room", { tag: "room:!b" });
    const events: string[] = [];
    n.onclick = () => events.push("click");
    n.onclose = () => events.push("close");
    await settle();
    tap("zam-notification:room:!b");
    expect(events).toEqual(["click", "close"]);
    // It's gone: closing it now does nothing.
    n.close();
    await settle();
    expect(native.dismissed).toEqual([]);
  });

  test("a dismissed notification fires only close", async () => {
    const n = new Notification("Room", { tag: "room:!c" });
    const onclick = vi.fn();
    const onclose = vi.fn();
    n.onclick = onclick;
    n.onclose = onclose;
    await settle();
    tap("zam-notification:room:!c", "com.apple.UNNotificationDismissActionIdentifier");
    expect(onclick).not.toHaveBeenCalled();
    expect(onclose).toHaveBeenCalledOnce();
  });

  test("a newer notification with the same tag replaces it", async () => {
    const older = new Notification("Room", { tag: "room:!d" });
    const newer = new Notification("Room", { tag: "room:!d" });
    const olderClick = vi.fn();
    const newerClick = vi.fn();
    older.onclick = olderClick;
    newer.onclick = newerClick;
    await settle();
    older.close();
    await settle();
    expect(native.dismissed).toEqual([]);
    tap("zam-notification:room:!d");
    expect(olderClick).not.toHaveBeenCalled();
    expect(newerClick).toHaveBeenCalledOnce();
  });

  test("close() takes it down and fires close", async () => {
    const n = new Notification("Room", { tag: "room:!e" });
    const onclose = vi.fn();
    n.onclose = onclose;
    n.close();
    await settle();
    expect(native.dismissed).toEqual(["zam-notification:room:!e"]);
    expect(onclose).toHaveBeenCalledOnce();
  });

  test("responses to other notifications (pushes) are left alone", () => {
    expect(() => tap("8C1F-push-identifier")).not.toThrow();
  });
});
