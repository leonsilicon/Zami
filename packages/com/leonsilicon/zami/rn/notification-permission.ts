import * as Notifications from "expo-notifications";

/** The Notification API's `NotificationPermission`. */
export type NotificationPermissionState = "granted" | "default" | "denied";

/**
 * expo-notifications' permission in the Notification API's terms: one the system will
 * still prompt for is "default".
 */
function toNotificationPermission(
  status: Notifications.NotificationPermissionsStatus,
): NotificationPermissionState {
  if (status.granted) return "granted";
  return status.canAskAgain ? "default" : "denied";
}

/**
 * `Notification.permission`, which is asynchronous here: "unsupported" when the system
 * can't say (as where Zam finds no `Notification`).
 */
export async function notificationPermission(): Promise<
  NotificationPermissionState | "unsupported"
> {
  try {
    return toNotificationPermission(await Notifications.getPermissionsAsync());
  } catch {
    return "unsupported";
  }
}

/**
 * `Notification.requestPermission()`: the system's prompt, if it will still show one, and
 * the permission after it. "denied" if asking fails, as Zam's `requestNotificationPermission`
 * (`$lib/utils/notifyPermission`) has it.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  try {
    return toNotificationPermission(await Notifications.requestPermissionsAsync());
  } catch {
    return "denied";
  }
}
