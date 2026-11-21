// Capacitor's PushNotifications plugin (@capacitor/push-notifications), on expo-notifications.
// Zam registers its pusher with the token `registration` hands it (push.ts `initFcm`); here
// that's an Expo push token, which Zami's own gateway (apps/push-gateway, Zam's
// VITE_PUSH_GATEWAY_URL in the web build) delivers through Expo's push service.
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { PluginError, type PluginEvents, type ShellPlugin } from "#bridge";

// Shown while the app is open too, as Capacitor's presentationOptions (Zam's
// capacitor.config.ts: badge, sound, alert) ask: the WebView has no Notification API, so
// nothing else alerts.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** The Expo project the app's push tokens belong to (`eas init` sets it). */
function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = Constants.easConfig?.projectId ?? extra?.eas?.projectId;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * Java's String.hashCode(). Zam takes a room's notifications down by this hash of its room
 * id, which is how its Android service ids them (push.ts `dismissNativeRoomNotifications`),
 * so delivered notifications are listed under it.
 */
export function javaStringHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  return hash;
}

function permission(status: Notifications.NotificationPermissionsStatus): {
  receive: "granted" | "denied" | "prompt";
} {
  if (status.granted) return { receive: "granted" };
  return { receive: status.canAskAgain ? "prompt" : "denied" };
}

interface DeliveredNotification {
  id: string;
  title?: string;
  subtitle?: string;
  body?: string;
  data: Record<string, unknown>;
}

/** A notification as Capacitor describes one. */
function describe(notification: Notifications.Notification): DeliveredNotification {
  const { content, identifier } = notification.request;
  const data = (content.data ?? {}) as Record<string, unknown>;
  const roomId = typeof data.room_id === "string" ? data.room_id : undefined;
  return {
    id: roomId === undefined ? identifier : String(javaStringHash(roomId)),
    ...(content.title ? { title: content.title } : {}),
    ...(content.subtitle ? { subtitle: content.subtitle } : {}),
    ...(content.body ? { body: content.body } : {}),
    data,
  };
}

export function createPushNotificationsPlugin(): ShellPlugin {
  let events: PluginEvents | null = null;
  let tokenListener: Notifications.EventSubscription | null = null;
  let lastDeviceToken: string | null = null;

  async function sendToken(devicePushToken: Notifications.DevicePushToken): Promise<void> {
    const projectId = easProjectId();
    if (projectId === undefined) throw new Error("The app config has no EAS project id");
    lastDeviceToken = String(devicePushToken.data);
    const token = await Notifications.getExpoPushTokenAsync({
      projectId,
      devicePushToken,
      // A simulator's APNs token is a sandbox one.
      ...(Platform.OS === "ios" && !Device.isDevice ? { development: true } : {}),
    });
    events?.emit("registration", { value: token.data }, { retain: true });
  }

  async function register(): Promise<void> {
    try {
      await sendToken(await Notifications.getDevicePushTokenAsync());
      tokenListener ??= Notifications.addPushTokenListener((devicePushToken) => {
        if (String(devicePushToken.data) === lastDeviceToken) return;
        sendToken(devicePushToken).catch((error: unknown) => {
          events?.emit("registrationError", { error: String(error) }, { retain: true });
        });
      });
    } catch (error) {
      console.warn("[zami-shell] push registration failed", error);
      events?.emit(
        "registrationError",
        { error: error instanceof Error ? error.message : String(error) },
        { retain: true },
      );
    }
  }

  /** The delivered notifications behind the ids Capacitor listed them under. */
  async function identifiersFor(ids: Set<string>): Promise<string[]> {
    const presented = await Notifications.getPresentedNotificationsAsync();
    return presented
      .filter((notification) => {
        const described = describe(notification);
        return ids.has(described.id) || ids.has(notification.request.identifier);
      })
      .map((notification) => notification.request.identifier);
  }

  return {
    name: "PushNotifications",
    methods: {
      checkPermissions: async () => permission(await Notifications.getPermissionsAsync()),
      requestPermissions: async () =>
        permission(
          await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: true, allowSound: true },
          }),
        ),
      // Resolves at once, as Capacitor's does: the token comes as `registration`.
      register: () => {
        void register();
      },
      unregister: async () => {
        tokenListener?.remove();
        tokenListener = null;
        await Notifications.unregisterForNotificationsAsync();
      },
      getDeliveredNotifications: async () => ({
        notifications: (await Notifications.getPresentedNotificationsAsync()).map(describe),
      }),
      removeDeliveredNotifications: async ({ notifications }) => {
        if (!Array.isArray(notifications)) throw new PluginError("Must provide notifications");
        const ids = new Set(
          notifications
            .map((notification) => (notification as { id?: unknown }).id)
            .filter((id): id is string | number => typeof id === "string" || typeof id === "number")
            .map(String),
        );
        for (const identifier of await identifiersFor(ids)) {
          await Notifications.dismissNotificationAsync(identifier);
        }
      },
      removeAllDeliveredNotifications: async () => {
        await Notifications.dismissAllNotificationsAsync();
      },
      // Android's notification channels.
      createChannel: async (channel) => {
        if (Platform.OS !== "android") return;
        if (typeof channel.id !== "string") throw new PluginError("Must provide a channel id");
        await Notifications.setNotificationChannelAsync(channel.id, {
          name: typeof channel.name === "string" ? channel.name : channel.id,
          importance:
            typeof channel.importance === "number"
              ? (channel.importance as Notifications.AndroidImportance)
              : Notifications.AndroidImportance.HIGH,
          ...(typeof channel.description === "string" ? { description: channel.description } : {}),
        });
      },
      deleteChannel: async ({ id }) => {
        if (Platform.OS === "android" && typeof id === "string") {
          await Notifications.deleteNotificationChannelAsync(id);
        }
      },
      listChannels: async () => ({
        channels:
          Platform.OS === "android"
            ? (await Notifications.getNotificationChannelsAsync()).map((channel) => ({
                id: channel.id,
                name: channel.name ?? channel.id,
                importance: channel.importance,
              }))
            : [],
      }),
    },
    start(pluginEvents) {
      events = pluginEvents;
      const received = Notifications.addNotificationReceivedListener((notification) => {
        pluginEvents.emit("pushNotificationReceived", describe(notification));
      });
      const tapped = (response: Notifications.NotificationResponse) => {
        pluginEvents.emit(
          "pushNotificationActionPerformed",
          {
            actionId:
              response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER
                ? "tap"
                : response.actionIdentifier,
            notification: describe(response.notification),
          },
          // A tap that launched the app comes before Zam's listener does.
          { retain: true },
        );
      };
      const responses = Notifications.addNotificationResponseReceivedListener(tapped);
      const launch = Notifications.getLastNotificationResponse();
      if (launch) {
        tapped(launch);
        Notifications.clearLastNotificationResponse();
      }
      return () => {
        received.remove();
        responses.remove();
        tokenListener?.remove();
        tokenListener = null;
        events = null;
      };
    },
  };
}
