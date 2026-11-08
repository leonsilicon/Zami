// Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/):
// one message per Matrix device, and what Expo's answer means for the homeserver.
import type { MatrixDevice, MatrixNotification } from "#matrix";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** The key in a pusher's `default_payload` whose fields become the Expo message's own. */
export const EXPO_FIELDS_KEY = "expo";

const EXPO_TIMEOUT_MS = 10_000;

export interface ExpoMessage {
  to: string;
  /** Delivered to the app as the notification's `request.content.data`. */
  data: Record<string, unknown>;
  title?: string;
  subtitle?: string;
  body?: string;
  sound?: string | null;
  badge?: number;
  priority?: "default" | "normal" | "high";
  ttl?: number;
  expiration?: number;
  channelId?: string;
  categoryId?: string;
  icon?: string;
  mutableContent?: boolean;
  contentAvailable?: boolean;
  _contentAvailable?: boolean;
  interruptionLevel?: "active" | "critical" | "passive" | "time-sensitive";
  tag?: string;
  threadId?: string;
  collapseId?: string;
}

/** The Expo message fields an app may set through its pusher's `default_payload.expo`. */
const APP_FIELDS: Record<string, "string" | "number" | "boolean" | "sound"> = {
  title: "string",
  subtitle: "string",
  body: "string",
  sound: "sound",
  priority: "string",
  ttl: "number",
  expiration: "number",
  channelId: "string",
  categoryId: "string",
  icon: "string",
  mutableContent: "boolean",
  contentAvailable: "boolean",
  _contentAvailable: "boolean",
  interruptionLevel: "string",
  tag: "string",
  threadId: "string",
  collapseId: "string",
};

function appFields(value: unknown): Partial<ExpoMessage> {
  if (typeof value !== "object" || value === null) return {};
  const fields: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    const type = APP_FIELDS[key];
    if (type === undefined) continue;
    const ok =
      type === "sound" ? typeof field === "string" || field === null : typeof field === type;
    if (ok) fields[key] = field;
  }
  return fields;
}

/** Expo's own check (expo-server-sdk's `isExpoPushToken`). */
export function isExpoPushToken(token: string): boolean {
  return (
    ((token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")) &&
      token.endsWith("]")) ||
    /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i.test(token)
  );
}

/**
 * The Expo message for one device, or null when there's nothing to send.
 *
 * A push for an event is an alert: the app's fields from `default_payload.expo` (its title
 * and body), the room as Android's tag (a room's newer message replaces its older one) and
 * iOS's thread, and the unread count as iOS's badge. A push without an event only updates
 * the badge. Either way `data` is the rest of `default_payload` plus the push's ids and
 * counts: never the message, which an `event_id_only` pusher doesn't send anyway.
 */
export function expoMessageFor(
  notification: MatrixNotification,
  device: MatrixDevice,
): ExpoMessage | null {
  const { [EXPO_FIELDS_KEY]: expo, ...payload } = device.data?.default_payload ?? {};
  const { event_id: eventId, room_id: roomId, counts } = notification;
  const data: Record<string, unknown> = { ...payload };
  if (eventId !== undefined) data.event_id = eventId;
  if (roomId !== undefined) data.room_id = roomId;
  if (counts?.unread !== undefined) data.unread = counts.unread;
  if (counts?.missed_calls !== undefined) data.missed_calls = counts.missed_calls;

  const badge = counts?.unread;
  if (eventId === undefined) {
    if (badge === undefined) return null;
    return { to: device.pushkey, data, badge, priority: "normal" };
  }
  return {
    priority: notification.prio === "low" ? "normal" : "high",
    ...(badge === undefined ? {} : { badge }),
    ...(roomId === undefined ? {} : { tag: roomId, threadId: roomId }),
    ...appFields(expo),
    to: device.pushkey,
    data,
  };
}

/**
 * What Expo's answer means for a device:
 * - `sent`: Expo took the message;
 * - `rejected`: the token is dead (`DeviceNotRegistered`), so the homeserver should delete
 *   the pusher;
 * - `dropped`: Expo refused the message for good (too big, bad credentials, a malformed
 *   request), so retrying won't help;
 * - `retry`: Expo is unavailable or rate-limiting, so the homeserver should try again.
 */
export type ExpoOutcome =
  | { kind: "sent" }
  | { kind: "rejected" }
  | { kind: "dropped"; error: string }
  | { kind: "retry"; error: string };

export interface ExpoSendOptions {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  url: string;
  /** Needed when the Expo project has enhanced push security on. */
  accessToken?: string;
}

function ticketOutcome(body: unknown): ExpoOutcome {
  const tickets =
    typeof body === "object" && body !== null && "data" in body ? body.data : undefined;
  const ticket: unknown = Array.isArray(tickets) ? tickets[0] : undefined;
  if (typeof ticket !== "object" || ticket === null || !("status" in ticket)) {
    return { kind: "dropped", error: "NoTicket" };
  }
  if (ticket.status === "ok") return { kind: "sent" };
  const details = "details" in ticket ? ticket.details : undefined;
  const error =
    typeof details === "object" && details !== null && "error" in details
      ? String(details.error)
      : "Unknown";
  return error === "DeviceNotRegistered" ? { kind: "rejected" } : { kind: "dropped", error };
}

/** A failed request's error codes, and whether Expo says trying again may work. */
function requestErrors(body: unknown): { codes: string; transient: boolean } {
  const errors: unknown[] =
    typeof body === "object" && body !== null && "errors" in body && Array.isArray(body.errors)
      ? body.errors
      : [];
  const records = errors.filter(
    (error): error is Record<string, unknown> => typeof error === "object" && error !== null,
  );
  return {
    codes: records
      .map((error) => (typeof error.code === "string" ? error.code : ""))
      .filter(Boolean)
      .join(","),
    transient: records.some((error) => error.isTransient === true),
  };
}

/** Sends one message (as a batch of one, so the answer is always a list of tickets). */
export async function sendExpoMessage(
  message: ExpoMessage,
  options: ExpoSendOptions,
): Promise<ExpoOutcome> {
  let response: Response;
  try {
    response = await options.fetch(options.url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
      },
      body: JSON.stringify([message]),
      signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: "retry", error: error instanceof Error ? error.name : "FetchFailed" };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return ticketOutcome(body);
  const { codes, transient } = requestErrors(body);
  const error = codes || `HTTP ${response.status}`;
  if (response.status === 429 || response.status >= 500 || transient) {
    return { kind: "retry", error };
  }
  return { kind: "dropped", error };
}
