// Zam's UnifiedPush plugin (its Android app's), as far as Zam's push needs it on Android:
// Zam asks it whether push can go through Firebase (`fcmAvailable`) before it uses the
// PushNotifications plugin, and turns push off when it can't (push.ts `initPush`). Here
// PushNotifications always can (Expo push tokens), and there are no UnifiedPush
// distributors to offer.
import { PluginError, type ShellPlugin } from "#bridge";

export function createUnifiedPushPlugin(): ShellPlugin {
  return {
    name: "UnifiedPush",
    methods: {
      getStatus: () => ({
        distributors: [],
        savedDistributor: null,
        ackDistributor: null,
        endpoint: null,
        gateway: null,
        fcmAvailable: true,
      }),
      register: () => {
        throw new PluginError("UnifiedPush distributors aren't supported", "UNAVAILABLE");
      },
      unregister: () => undefined,
    },
  };
}
