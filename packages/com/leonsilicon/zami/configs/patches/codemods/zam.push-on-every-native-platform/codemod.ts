import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

/**
 * Zam turns push on only when its push status says Firebase is there (`fcmAvailable`),
 * and only its Android app's UnifiedPush plugin says so: everywhere else
 * getUnifiedPushStatus() answers a status with `fcmAvailable: false` without asking, so
 * initPush() finds no push service. In the Zami app, the PushNotifications plugin (Zam's
 * "fcm" path) hands Zam an Expo push token on iOS too, so a native platform that isn't
 * Android has that path available. The web is unchanged.
 */
export default function codemod(root: SgRoot): string | null {
  return editNodes(root, [
    {
      kinds: ["function_declaration"],
      contains: "async function getUnifiedPushStatus()",
      from: "    if (!unifiedPushSupported()) return EMPTY_STATUS;",
      to:
        "    // Zami: push through the PushNotifications plugin on every native platform.\n" +
        "    if (!unifiedPushSupported())\n" +
        "        return { ...EMPTY_STATUS, fcmAvailable: Capacitor.isNativePlatform() };",
      marker: "fcmAvailable: Capacitor.isNativePlatform()",
    },
  ]);
}
