/**
 * Push notification integration for Android. Two transports:
 *   - FCM via Capacitor, delivered through a Sygnal push gateway;
 *   - UnifiedPush via a distributor app the user picks (ntfy, NextPush, ...),
 *     delivered through a Matrix gateway paired with the distributor's
 *     endpoint (see unifiedPush.ts). No Google services needed.
 *
 * On startup (after login), call initPush(). It will:
 *   1. Request notification permission
 *   2. Pick the transport (Settings → Notifications → Push service)
 *   3. Get the FCM token / UnifiedPush endpoint
 *   4. Register a Matrix pusher with the homeserver pointing at the gateway
 */

import { Capacitor } from "@capacitor/core";
import { PushNotifications, type Token } from "@capacitor/push-notifications";
// Zami: iOS push is APNs through expo-notifications (initApns, at the end).
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { GENERIC_NOTIFICATION_BODY } from "$lib/utils/notificationPrivacy";
import {
    checkPusherGateway,
    mergeGatewayStatus,
    type PusherGatewayStatus,
} from "$lib/utils/pusherVerification";
import { WEBPUSH_APP_ID } from "$lib/webPush";
import { navigateToRoom } from "$lib/stores/rooms.svelte";
import {
    getPushProviderPref,
    getUnifiedPushStatus,
    onUnifiedPushEvents,
    registerUnifiedPush,
    resolvePushProvider,
    setPushProviderPref,
    unregisterUnifiedPush,
    type PushProviderPref,
    type UnifiedPushStatus,
} from "$lib/unifiedPush";

// URL of your Sygnal push gateway's notify endpoint, e.g.
//   https://sygnal.example.com/_matrix/push/v1/notify
// Set at build time via the VITE_PUSH_GATEWAY_URL env var, or edit the fallback
// below. The example placeholder counts as "not configured".
//
// Sygnal is the standard Matrix push gateway (https://github.com/matrix-org/sygnal);
// configure an `apps` entry with type `gcm`/`fcm_v1`, app_id `moe.crafty.matrix`,
// and your Firebase credentials there.
const PUSH_GATEWAY_URL =
    (import.meta.env as Record<string, string | undefined>)
        .VITE_PUSH_GATEWAY_URL ||
    "https://sygnal.crafty.moe/_matrix/push/v1/notify";

// Must match the app_id configured for this app in Sygnal. UnifiedPush pushers
// use it too: Matrix gateways for UnifiedPush ignore the app_id.
// Zami: on iOS, Zami's APNs app: Sygnal needs an `apns` app with this id (the
// bundle id, as its APNs topic) and Zami's APNs key.
const ZAMI_IOS = Platform.OS === "ios";
const APP_ID = ZAMI_IOS ? "com.leonsilicon.zami" : "moe.crafty.matrix";

// FCM push is only attempted when a real gateway is configured. Builds shipped
// WITHOUT a Firebase google-services.json are caught natively instead
// (UnifiedPushPlugin.fcmAvailable): calling into FCM with no Firebase config
// throws ("Default FirebaseApp is not initialized"). UnifiedPush needs neither
// and is gated on neither.
// Zami: and Zam's own gateway, for Zami's app: it has no app with Zami's id,
// so it would reject every push, and test users' event ids, room ids and APNs
// tokens would go to Zam's server. Zami registers no pusher until
// EXPO_PUBLIC_PUSH_GATEWAY_URL names a Sygnal with Zami's APNs app.
const PUSH_ENABLED =
    !PUSH_GATEWAY_URL.includes("sygnal.example.com") &&
    !(ZAMI_IOS && PUSH_GATEWAY_URL.includes("sygnal.crafty.moe"));

let pushInitialised = false;

// Which transport this session's pusher went through, so teardown undoes the
// right one. null until initPush picked one.
// Zami: "apns" on iOS.
let activeProvider: "fcm" | "unifiedpush" | "apns" | null = null;
let stopUnifiedPushEvents: (() => Promise<void>) | null = null;

// The pushkey (FCM token or UnifiedPush endpoint) we actually registered this
// run. Kept so unregister can delete the RIGHT pusher — deleting with an empty
// pushkey is a no-op (or, worse, matches nothing) and leaves a stale pusher
// pointing at the gateway.
let registeredPushkey: string | null = null;
// The gateway that pushkey was registered against, so an endpoint event that
// changes nothing doesn't re-register.
let registeredGateway: string | null = null;

// ── Diagnostics ────────────────────────────────────────────────────────────
// Live snapshot of what push setup did this session, surfaced in Settings →
// Debug Info so push can be diagnosed on devices with no dev console.

export interface PushDebugState {
    native: boolean;
    gatewayUrl: string;
    pushEnabled: boolean;
    permission: string; // "granted" | "denied" | "prompt" | "unknown"
    fcmToken: string | null;
    pusherRegistered: boolean;
    lastError: string | null;
    // Set when the homeserver reports our pusher routing to a gateway other
    // than the one we asked for (SEC-L4). Not a registration failure, so kept
    // separate from lastError.
    gatewayWarning: string | null;
    /** The transport initPush picked: "fcm" | "unifiedpush" | "none". */
    provider: string | null;
    upDistributor: string | null;
    upEndpoint: string | null;
    /** The Matrix gateway paired with upEndpoint. */
    upGateway: string | null;
}

export const pushDebug: PushDebugState = {
    // Zami: the iOS app is native too.
    native: Capacitor.isNativePlatform() || ZAMI_IOS,
    gatewayUrl: PUSH_GATEWAY_URL,
    pushEnabled: PUSH_ENABLED,
    permission: "unknown",
    fcmToken: null,
    pusherRegistered: false,
    lastError: null,
    gatewayWarning: null,
    provider: null,
    upDistributor: null,
    upEndpoint: null,
    upGateway: null,
};

export async function initPush(
    matrixClient: import("matrix-js-sdk").MatrixClient,
): Promise<void> {
    // Zami: iOS registers with APNs.
    if (ZAMI_IOS) return initApns(matrixClient);
    if (!Capacitor.isNativePlatform()) return;
    if (pushInitialised) return;
    pushInitialised = true;

    // Everything below touches native push stacks; guard the whole thing so a
    // missing/broken config can never crash the app — it just disables push.
    try {
        // Request permission. These calls only touch POST_NOTIFICATIONS, not
        // Firebase, so they are safe whichever transport ends up in use.
        let permission = await PushNotifications.checkPermissions();
        if (permission.receive === "prompt") {
            permission = await PushNotifications.requestPermissions();
        }
        pushDebug.permission = permission.receive;
        if (permission.receive !== "granted") {
            // Not latched: granting later from Settings re-runs this.
            pushInitialised = false;
            pushDebug.lastError = "Notification permission not granted";
            console.warn("[push] Notification permission denied");
            return;
        }

        const status = await getUnifiedPushStatus();
        const provider = resolvePushProvider(
            getPushProviderPref(),
            status,
            PUSH_ENABLED,
        );
        pushDebug.provider = provider.kind;
        if (provider.kind === "unifiedpush") {
            await initUnifiedPush(matrixClient, provider.distributor, status);
        } else if (provider.kind === "fcm") {
            await initFcm(matrixClient);
        } else {
            // Not latched either: after installing a distributor, picking it
            // in Settings retries.
            pushInitialised = false;
            pushDebug.lastError =
                "No push service available: FCM can't run on this device/build and no UnifiedPush distributor is selected";
            console.info("[push] No push transport available - push disabled.");
        }
    } catch (err) {
        pushInitialised = false;
        activeProvider = null;
        pushDebug.lastError = "Push init failed: " + String(err);
        console.warn("[push] Push init failed - continuing without push.", err);
    }
}

async function initFcm(
    matrixClient: import("matrix-js-sdk").MatrixClient,
): Promise<void> {
    activeProvider = "fcm";

    PushNotifications.addListener("registration", async (token: Token) => {
        // Never log the token itself: it's a long-lived device-correlating
        // credential, and anything on the console is reachable through adb,
        // remote debugging and crash reporters. Settings → Debug Info shows
        // a truncated form when a human actually needs to compare it.
        console.log("[push] FCM registration received");
        pushDebug.fcmToken = token.value;
        await registerPusher(matrixClient, token.value, PUSH_GATEWAY_URL);
    });

    PushNotifications.addListener("registrationError", (err) => {
        pushDebug.lastError = "FCM registration error: " + JSON.stringify(err);
        console.error("[push] Registration error:", err);
    });

    // Foreground notifications: the OS won't show them automatically, so we
    // could show an in-app toast here if desired. For now just note that one
    // arrived — the payload carries room/sender/message metadata and must
    // not reach the console.
    PushNotifications.addListener("pushNotificationReceived", () => {
        console.log("[push] Foreground notification received");
    });

    // User tapped a notification
    PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
            const roomId = action.notification.data?.room_id;
            // event_id_only FCM data carries the event; thread it so the tap
            // jumps to the exact message, not just the room.
            const eventId = action.notification.data?.event_id;
            if (roomId) {
                // Navigate to the room (switching space if needed).
                navigateToRoom(roomId, eventId);
            }
        },
    );

    // Register with FCM last — triggers the 'registration' event with the
    // token. Throws if Firebase isn't configured (caught in initPush).
    await PushNotifications.register();
}

/**
 * UnifiedPush: the distributor hands us an endpoint URL, which becomes the
 * pushkey, and the homeserver POSTs to the Matrix gateway paired with it
 * (discovered natively, see UnifiedPushService.discoverGateway). The
 * notifications are posted by the same native code as FCM ones, so taps,
 * replies and mark-as-read go through MainActivity as before.
 */
async function initUnifiedPush(
    matrixClient: import("matrix-js-sdk").MatrixClient,
    distributor: string,
    status: UnifiedPushStatus,
): Promise<void> {
    activeProvider = "unifiedpush";
    pushDebug.upDistributor = distributor;

    stopUnifiedPushEvents = await onUnifiedPushEvents({
        onEndpoint: ({ endpoint, gateway }) => {
            console.log("[push] UnifiedPush endpoint received");
            pushDebug.upEndpoint = endpoint;
            pushDebug.upGateway = gateway;
            void registerPusher(matrixClient, endpoint, gateway);
        },
        onUnregistered: () => {
            pushDebug.upEndpoint = null;
            pushDebug.upGateway = null;
            pushDebug.lastError =
                "The UnifiedPush distributor dropped this app's registration";
            void deleteRegisteredPusher(matrixClient);
        },
        onFailed: (reason) => {
            pushDebug.lastError = "UnifiedPush registration failed: " + reason;
            console.warn("[push] UnifiedPush registration failed:", reason);
        },
    });

    // An endpoint we already hold (possibly delivered while the app was not
    // running): register it now rather than waiting on the distributor.
    if (
        status.endpoint &&
        status.gateway &&
        status.savedDistributor === distributor
    ) {
        pushDebug.upEndpoint = status.endpoint;
        pushDebug.upGateway = status.gateway;
        await registerPusher(matrixClient, status.endpoint, status.gateway);
    }

    // Re-register on every start, as the UnifiedPush spec asks: it is how a
    // distributor that lost its state gets us back. An unchanged endpoint
    // makes registerPusher a no-op.
    await registerUnifiedPush(distributor);
}

async function registerPusher(
    matrixClient: import("matrix-js-sdk").MatrixClient,
    pushkey: string,
    gatewayUrl: string,
): Promise<void> {
    const deviceId = matrixClient.getDeviceId();
    const userId = matrixClient.getUserId();
    if (!deviceId || !userId) return;
    if (pushkey === registeredPushkey && gatewayUrl === registeredGateway)
        return;

    try {
        await (matrixClient as any).setPusher({
            kind: "http",
            app_id: APP_ID,
            app_display_name: "Zam",
            // Zami: "iOS (…)" on iOS.
            device_display_name: devicePusherName(deviceId),
            pushkey,
            lang: navigator.language || "en",
            data: {
                url: gatewayUrl,
                format: "event_id_only",
                // Names the account in every push: several accounts on this
                // device share the pushkey, and the native service picks the
                // matching session by this (MatrixMessagingService.ACCOUNT_KEY).
                // Zami: on iOS, plus the alert APNs shows (ZAMI_APNS_PAYLOAD).
                default_payload: { zam_account: userId, ...ZAMI_APNS_PAYLOAD },
            },
            // multi-account: false would delete other users' pushers for this token
            append: true,
        });
        registeredPushkey = pushkey;
        registeredGateway = gatewayUrl;
        pushDebug.pusherRegistered = true;
        console.log("[push] Pusher registered");
        await removeStaleDevicePushers(matrixClient, deviceId, pushkey);
        // Re-read the pushers the homeserver actually kept and warn if it
        // routed us somewhere other than our gateway (SEC-L4). Best-effort:
        // a verification failure must never undo a successful registration.
        try {
            const status = await verifyPushGateways(matrixClient);
            if (status.status === "mismatch") {
                const warning = `Push gateway mismatch: the homeserver routes this device's pushes to ${status.mismatchedUrls.join(
                    ", ",
                )} instead of ${gatewayUrl}`;
                pushDebug.gatewayWarning = warning;
                console.warn("[push] " + warning);
            } else {
                pushDebug.gatewayWarning = null;
            }
        } catch {
            /* verification is best-effort */
        }
    } catch (err) {
        pushDebug.pusherRegistered = false;
        pushDebug.lastError = "Failed to register pusher: " + String(err);
        console.error("[push] Failed to register pusher:", err);
    }
}

/**
 * Delete this device's OTHER pushers: the one a rotated FCM token or
 * UnifiedPush endpoint left behind, or the old transport's after a switch.
 * They are recognisable by the display name registerPusher gives them, which
 * carries the Matrix device id. Best-effort.
 */
async function removeStaleDevicePushers(
    matrixClient: import("matrix-js-sdk").MatrixClient,
    deviceId: string,
    keep: string,
): Promise<void> {
    try {
        const res = await (matrixClient as any).getPushers();
        for (const p of (res?.pushers ?? []) as any[]) {
            if (
                p.app_id === APP_ID &&
                // Zami: "iOS (…)" on iOS.
                p.device_display_name === devicePusherName(deviceId) &&
                typeof p.pushkey === "string" &&
                p.pushkey &&
                p.pushkey !== keep
            ) {
                await deletePusher(matrixClient, p.pushkey).catch(() => {});
            }
        }
    } catch {
        /* best-effort */
    }
}

function deletePusher(
    matrixClient: import("matrix-js-sdk").MatrixClient,
    pushkey: string,
): Promise<unknown> {
    // Delete the pusher by setting kind to null. Must use the REAL pushkey we
    // registered — an empty one deletes nothing.
    return (matrixClient as any).setPusher({
        kind: null,
        app_id: APP_ID,
        pushkey,
        app_display_name: "",
        device_display_name: "",
        lang: "en",
        data: {},
    });
}

async function deleteRegisteredPusher(
    matrixClient: import("matrix-js-sdk").MatrixClient,
): Promise<void> {
    if (!registeredPushkey) return;
    try {
        await deletePusher(matrixClient, registeredPushkey);
        registeredPushkey = null;
        registeredGateway = null;
        pushDebug.pusherRegistered = false;
    } catch {
        /* ignore */
    }
}

/** Stop whichever transport is running; the homeserver is left alone. */
async function stopTransport(): Promise<void> {
    if (activeProvider === "fcm") {
        await PushNotifications.removeAllListeners().catch(() => {});
    }
    // Zami: APNs token changes stop re-registering (taps still open rooms).
    if (activeProvider === "apns") stopApnsTokenListener();
    if (stopUnifiedPushEvents) {
        await stopUnifiedPushEvents().catch(() => {});
        stopUnifiedPushEvents = null;
    }
    activeProvider = null;
    pushInitialised = false;
}

/**
 * Settings → Notifications → Push service. Removes this device's pusher,
 * drops the old transport (including the UnifiedPush registration, unless the
 * same distributor stays in use) and sets push up again with the new choice.
 */
export async function switchPushProvider(
    matrixClient: import("matrix-js-sdk").MatrixClient | null,
    pref: PushProviderPref,
): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    const keepUnifiedPush =
        activeProvider === "unifiedpush" &&
        pref === `up:${pushDebug.upDistributor}`;
    setPushProviderPref(pref);
    if (matrixClient) await deleteRegisteredPusher(matrixClient);
    await stopTransport();
    if (!keepUnifiedPush) {
        await unregisterUnifiedPush();
        pushDebug.upDistributor = null;
        pushDebug.upEndpoint = null;
        pushDebug.upGateway = null;
    }
    pushDebug.provider = null;
    pushDebug.lastError = null;
    pushDebug.gatewayWarning = null;
    if (matrixClient) await initPush(matrixClient);
}

// The Android WebView has no Notification API, so the Settings permission row
// reads and requests the OS permission through the native plugin instead.
function toNotificationPermission(receive: string): NotificationPermission {
    if (receive === "granted" || receive === "denied") return receive;
    return "default";
}

export async function checkNativeNotificationPermission(): Promise<NotificationPermission> {
    try {
        const p = await PushNotifications.checkPermissions();
        return toNotificationPermission(p.receive);
    } catch {
        return "default";
    }
}

/** Ask for the OS permission, then (if granted) finish push setup that
 *  initPush skipped while it was missing. */
export async function requestNativeNotificationPermission(
    matrixClient: import("matrix-js-sdk").MatrixClient | null,
): Promise<NotificationPermission> {
    let receive: string;
    try {
        receive = (await PushNotifications.requestPermissions()).receive;
    } catch {
        return checkNativeNotificationPermission();
    }
    pushDebug.permission = receive;
    if (receive === "granted" && matrixClient) await initPush(matrixClient);
    return toNotificationPermission(receive);
}

export async function unregisterPush(
    matrixClient: import("matrix-js-sdk").MatrixClient,
): Promise<void> {
    // Zami: and on iOS.
    if (!Capacitor.isNativePlatform() && !ZAMI_IOS) return;
    const deviceId = matrixClient.getDeviceId();
    if (!deviceId) return;

    // The UnifiedPush registration itself is kept: its endpoint is not tied
    // to an account, and the next login reuses it.
    await deleteRegisteredPusher(matrixClient);
    await stopTransport();
}

/**
 * Take every delivered Android notification down.
 *
 * On Android the notifications the user actually sees are posted by
 * MatrixMessagingService (native Java), so none of the page's own close
 * machinery can reach them — nothing in src/ could take a native notification
 * down before this. Capacitor's implementation is NotificationManager
 * .cancelAll(), which covers exactly those.
 *
 * Deliberately separate from unregisterPush: that one returns early when the
 * device id is missing, which has nothing to do with whether there are
 * notifications on screen.
 *
 * Synchronous and fire-and-forget on purpose: this is registered as a
 * notification surface, and the registry's try/catch cannot catch a rejected
 * promise — hence the .catch() here — while an awaited teardown call could
 * hang the way out of a session.
 */
export function clearDeliveredNativeNotifications(): void {
    // Zami: on iOS, everything in Notification Center: pushes, and the
    // page's own notifications (the Notification stand-in's).
    if (ZAMI_IOS) {
        Notifications.dismissAllNotificationsAsync().catch(() => {});
        return;
    }
    if (!Capacitor.isNativePlatform()) return;
    PushNotifications.removeAllDeliveredNotifications().catch(() => {});
}

// ── Diagnostics queries (used by Settings → Debug Info) ─────────────────────

export interface RegisteredPusher {
    app_id: string;
    app_display_name?: string;
    device_display_name?: string;
    /** The gateway URL the homeserver will POST to (data.url). */
    url?: string;
    /** First/last few chars of the pushkey (FCM token) for identification. */
    pushkeyPreview: string;
}

/**
 * Ask the homeserver which pushers it has registered for this account. This is
 * the source of truth for "did we tell the homeserver about our gateway URL?".
 */
export async function fetchRegisteredPushers(
    matrixClient: import("matrix-js-sdk").MatrixClient,
): Promise<RegisteredPusher[]> {
    const res = await (matrixClient as any).getPushers();
    const pushers = (res?.pushers ?? []) as any[];
    return pushers.map((p) => {
        const key: string = p.pushkey ?? "";
        const preview =
            key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key;
        return {
            app_id: p.app_id,
            app_display_name: p.app_display_name,
            device_display_name: p.device_display_name,
            url: p.data?.url,
            pushkeyPreview: preview,
        };
    });
}

/**
 * Re-fetch this account's pushers and verify they route to our configured
 * gateway, covering both the FCM (Android) and webpush (browser) app ids
 * (SEC-L4). Used by Settings to show whether the homeserver honoured the
 * gateway URL we asked for. Never throws: a read failure yields a "none"
 * verdict so the caller can treat it as "nothing to report".
 *
 * UnifiedPush pushers (pushkey = the endpoint URL; an FCM token or webpush
 * key never is one) each route to the gateway paired with THEIR device's
 * distributor, which only that device knows. So this device's own is checked
 * against the gateway it registered, and other devices' are left out rather
 * than flagged as reroutes.
 */
export async function verifyPushGateways(
    matrixClient: import("matrix-js-sdk").MatrixClient,
): Promise<PusherGatewayStatus> {
    try {
        const res = await (matrixClient as any).getPushers();
        const pushers = ((res?.pushers ?? []) as any[]).map((p) => ({
            app_id: p.app_id as string,
            url: p.data?.url as string | undefined,
            pushkey: typeof p.pushkey === "string" ? p.pushkey : "",
        }));
        const isUnifiedPush = (p: { app_id: string; pushkey: string }) =>
            p.app_id === APP_ID && /^https?:\/\//.test(p.pushkey);
        const sygnal = checkPusherGateway(
            PUSH_GATEWAY_URL,
            [APP_ID, WEBPUSH_APP_ID],
            pushers.filter((p) => !isUnifiedPush(p)),
        );
        const ownUp = pushers.filter(
            (p) => isUnifiedPush(p) && p.pushkey === pushDebug.upEndpoint,
        );
        if (!ownUp.length || !pushDebug.upGateway) return sygnal;
        return mergeGatewayStatus(
            sygnal,
            checkPusherGateway(pushDebug.upGateway, [APP_ID], ownUp),
        );
    } catch {
        return {
            status: "none",
            ours: 0,
            expectedUrl: PUSH_GATEWAY_URL,
            mismatchedUrls: [],
        };
    }
}

export interface GatewayHealth {
    reachable: boolean;
    status: number | null;
    detail: string;
}

/**
 * Probe the Sygnal gateway. Sygnal exposes GET /health (200 when the app/FCM
 * config loaded). We derive the base URL from the configured notify endpoint.
 */
export async function checkGatewayHealth(): Promise<GatewayHealth> {
    let healthUrl: string;
    try {
        const u = new URL(PUSH_GATEWAY_URL);
        healthUrl = `${u.origin}/health`;
    } catch {
        return {
            reachable: false,
            status: null,
            detail: "Invalid gateway URL",
        };
    }
    try {
        const res = await fetch(healthUrl, { method: "GET" });
        let body = "";
        try {
            body = (await res.text()).slice(0, 200);
        } catch {
            /* ignore */
        }
        return {
            reachable: res.ok,
            status: res.status,
            detail: res.ok
                ? body || "OK"
                : `HTTP ${res.status}${body ? `: ${body}` : ""}`,
        };
    } catch (err) {
        return {
            reachable: false,
            status: null,
            detail:
                "Unreachable: " +
                (err instanceof Error ? err.message : String(err)),
        };
    }
}

/** The configured gateway notify endpoint (for display). */
export const PUSH_GATEWAY_NOTIFY_URL = PUSH_GATEWAY_URL;
export const PUSH_APP_ID = APP_ID;

// ── Zami: iOS (APNs) ────────────────────────────────────────────────────────
// expo-notifications registers the app with APNs and hands over its device
// token, which becomes the pushkey of a pusher in the format Sygnal's `apns`
// pushkin expects (base64: Sygnal hex-encodes it back for APNs). Pushes are
// event_id_only, as on Android, so the gateway and Apple see no message
// content. Decrypting and naming the sender would need a Notification Service
// Extension (mutable-content asks for one); without it, iOS shows the alert
// below. A tap opens the room the push names, through the shell's
// __matrixOpenRoom, as MainActivity's taps do on Android.

/** The alert iOS shows for a push, merged into the pusher's default_payload. */
const ZAMI_APNS_PAYLOAD: Record<string, unknown> = ZAMI_IOS
    ? {
          aps: {
              alert: { body: GENERIC_NOTIFICATION_BODY },
              sound: "default",
              "mutable-content": 1,
          },
      }
    : {};

function devicePusherName(deviceId: string): string {
    return `${ZAMI_IOS ? "iOS" : "Android"} (${deviceId})`;
}

/** The APNs device token (hex, as expo-notifications gives it) as Sygnal's pushkey. */
function apnsPushkey(hexToken: string): string {
    const bytes = hexToken.match(/[0-9a-f]{2}/gi) ?? [];
    return btoa(
        bytes.map((b) => String.fromCharCode(parseInt(b, 16))).join(""),
    );
}

let apnsTokenListener: { remove(): void } | null = null;
let apnsTapListener: { remove(): void } | null = null;
// A response can arrive both as the launch response and through the
// listener; each push opens its room once.
const openedApnsPushes = new Set<string>();

function stopApnsTokenListener(): void {
    apnsTokenListener?.remove();
    apnsTokenListener = null;
}

async function initApns(
    matrixClient: import("matrix-js-sdk").MatrixClient,
): Promise<void> {
    if (pushInitialised) return;
    pushInitialised = true;
    try {
        // Taps first: a push that launched the app opens its room even if
        // registering below fails.
        if (!apnsTapListener) {
            apnsTapListener =
                Notifications.addNotificationResponseReceivedListener(
                    openRoomFromApnsTap,
                );
            const launch = Notifications.getLastNotificationResponse();
            if (launch) openRoomFromApnsTap(launch);
        }

        let permission = await Notifications.getPermissionsAsync();
        if (!permission.granted && permission.canAskAgain) {
            // The prompt through the Notification API, so the page's
            // Notification.permission follows it.
            await Notification.requestPermission();
            permission = await Notifications.getPermissionsAsync();
        }
        pushDebug.permission = permission.granted
            ? "granted"
            : permission.canAskAgain
              ? "prompt"
              : "denied";
        if (!permission.granted) {
            // Not latched: granting later from Settings re-runs this.
            pushInitialised = false;
            pushDebug.lastError = "Notification permission not granted";
            console.warn("[push] Notification permission denied");
            return;
        }
        if (!PUSH_ENABLED) {
            pushInitialised = false;
            pushDebug.provider = "none";
            pushDebug.lastError = "No push gateway configured";
            return;
        }

        activeProvider = "apns";
        pushDebug.provider = "apns";
        apnsTokenListener ??= Notifications.addPushTokenListener((token) => {
            console.log("[push] APNs token changed");
            const pushkey = apnsPushkey(String(token.data));
            pushDebug.fcmToken = pushkey;
            void registerPusher(matrixClient, pushkey, PUSH_GATEWAY_URL);
        });
        // Never log the token: see initFcm.
        const token = await Notifications.getDevicePushTokenAsync();
        console.log("[push] APNs registration received");
        const pushkey = apnsPushkey(String(token.data));
        pushDebug.fcmToken = pushkey;
        await registerPusher(matrixClient, pushkey, PUSH_GATEWAY_URL);
    } catch (err) {
        pushInitialised = false;
        activeProvider = null;
        stopApnsTokenListener();
        pushDebug.lastError = "APNs registration failed: " + String(err);
        console.warn("[push] Push init failed - continuing without push.", err);
    }
}

/** A tapped push: open the room (and event) it names, for the account it names. */
function openRoomFromApnsTap(response: Notifications.NotificationResponse) {
    const { request } = response.notification;
    // (expo-notifications' trigger type also covers the scheduling inputs.)
    const trigger = request.trigger as {
        type?: string;
        payload?: Record<string, unknown>;
    } | null;
    if (trigger?.type !== "push") return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER)
        return;
    if (openedApnsPushes.has(request.identifier)) return;
    openedApnsPushes.add(request.identifier);
    const payload = trigger.payload ?? {};
    const text = (value: unknown) =>
        typeof value === "string" && value ? value : undefined;
    const roomId = text(payload.room_id);
    if (!roomId) return;
    openRoomWhenShellReady(
        roomId,
        text(payload.zam_account),
        text(payload.event_id),
    );
}

/**
 * The shell defines __matrixOpenRoom once it's mounted (and it checks the push
 * is for an account signed in here); a push that launched the app is waited
 * for, up to half a minute.
 */
function openRoomWhenShellReady(
    roomId: string,
    userId: string | undefined,
    eventId: string | undefined,
    attempt = 0,
): void {
    const open = (window as any).__matrixOpenRoom;
    if (typeof open === "function") {
        open(roomId, userId, false, eventId);
        return;
    }
    if (attempt < 120)
        setTimeout(
            () => openRoomWhenShellReady(roomId, userId, eventId, attempt + 1),
            250,
        );
}
