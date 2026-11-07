// OS notifications while the app is open, set up before Zam's code loads. Zam decides
// which messages notify and posts them itself (the `Notification` stand-in in
// @-/com.leonsilicon.zami.browser), so those show as banners in the foreground too. A
// push that arrives while the app is open is the same message Zam's running client is
// about to notify about, so it isn't shown: in the background, iOS shows pushes itself.
// Push registration and push taps are Zam's push logic (`src/lib/push.zami.ts`).
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const trigger = notification.request.trigger as { type?: string } | null;
    const show = trigger?.type !== "push";
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: show,
      // The app sets its icon's badge from Zam's unread count (AppShell).
      shouldSetBadge: false,
    };
  },
});
