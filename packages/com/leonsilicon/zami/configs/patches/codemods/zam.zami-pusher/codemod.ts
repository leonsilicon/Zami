import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

const DEVICE_NAME = '`${Capacitor.getPlatform() === "ios" ? "iOS" : "Android"} (${deviceId})`';

/**
 * Zam's native pusher is Zam's Android app's: app id `moe.crafty.matrix` (what Zam's Sygnal
 * serves), "Zam" on "Android (<device id>)", and a `default_payload` its Android service
 * reads to write the notification itself. In the Zami app it goes to Zami's push gateway,
 * which sends it through Expo's push service, so it's the gateway's:
 *
 * - the app's own id (com.leonsilicon.zami, or .staging for the staging app), which the
 *   gateway serves (its APP_IDS), from the shell's bootstrap (`__zamiShell.appId`);
 * - "Zami", on the platform it runs on (how a homeserver lists it, and how Zam finds its own
 *   stale pushers, so that search uses the same name);
 * - the alert the OS shows (`default_payload.expo`, the Expo message's own fields): Zam's
 *   generic text, as pushes are event_id_only and carry no message content.
 */
export default function codemod(root: SgRoot): string | null {
  return editNodes(root, [
    {
      kinds: ["import_statement"],
      contains: 'import { WEBPUSH_APP_ID } from "$lib/webPush";',
      from: 'import { WEBPUSH_APP_ID } from "$lib/webPush";',
      to:
        'import { WEBPUSH_APP_ID } from "$lib/webPush";\n' +
        "// Zami: the alert Zami's push gateway shows.\n" +
        'import { GENERIC_NOTIFICATION_BODY } from "$lib/utils/notificationPrivacy";',
      marker: 'import { GENERIC_NOTIFICATION_BODY } from "$lib/utils/notificationPrivacy";',
    },
    {
      kinds: ["lexical_declaration"],
      contains: "const APP_ID =",
      from: 'const APP_ID = "moe.crafty.matrix";',
      to:
        "// Zami: the app's own id (com.leonsilicon.zami, or .staging for the staging app),\n" +
        "// which Zami's push gateway serves (its APP_IDS).\n" +
        "const APP_ID: string =\n" +
        "    (globalThis as { __zamiShell?: { appId?: string | null } }).__zamiShell\n" +
        '        ?.appId ?? "com.leonsilicon.zami";',
      marker: "__zamiShell?: { appId?: string | null }",
    },
    {
      kinds: ["object"],
      contains: 'app_display_name: "Zam",',
      from: 'app_display_name: "Zam",\n            device_display_name: `Android (${deviceId})`,',
      to:
        "// Zami: the Zami app, on the platform it runs on.\n" +
        '            app_display_name: "Zami",\n' +
        `            device_display_name: ${DEVICE_NAME},`,
      marker: 'app_display_name: "Zami",',
    },
    {
      // The same object as the edit above (an edit can't be inside another's node).
      kinds: ["object"],
      contains: 'app_display_name: "Zam",',
      from: "default_payload: { zam_account: userId },",
      to:
        "// Zami: plus the alert the OS shows, which Zami's push gateway\n" +
        "                // hands Expo (mutable-content would let an iOS extension rewrite it).\n" +
        "                default_payload: {\n" +
        "                    zam_account: userId,\n" +
        "                    expo: {\n" +
        "                        body: GENERIC_NOTIFICATION_BODY,\n" +
        '                        sound: "default",\n' +
        '                        ...(Capacitor.getPlatform() === "ios"\n' +
        "                            ? { mutableContent: true }\n" +
        "                            : {}),\n" +
        "                    },\n" +
        "                },",
      marker: "body: GENERIC_NOTIFICATION_BODY,",
    },
    {
      kinds: ["parenthesized_expression"],
      contains: "p.app_id === APP_ID &&",
      from: "p.device_display_name === `Android (${deviceId})` &&",
      to: `p.device_display_name === ${DEVICE_NAME} &&`,
      marker: `p.device_display_name === ${DEVICE_NAME}`,
    },
  ]);
}
