// The request a homeserver sends a push gateway: POST /_matrix/push/v1/notify
// (https://spec.matrix.org/latest/push-gateway-api/). Only the fields the gateway reads are
// typed; the rest of the notification (sender, room name, content: present only for pushers
// that didn't ask for `event_id_only`) is never forwarded.

export const NOTIFY_PATH = "/_matrix/push/v1/notify";

export interface MatrixDevice {
  app_id: string;
  pushkey: string;
  /** The pusher's `data`, as the client set it, without `url`. */
  data?: { format?: string; default_payload?: Record<string, unknown> };
}

export interface MatrixNotification {
  /** Absent for a push that only updates the unread count (the room was read elsewhere). */
  event_id?: string;
  room_id?: string;
  /** "low" for a push the user doesn't need to see at once. */
  prio?: string;
  counts?: { unread?: number; missed_calls?: number };
  devices: MatrixDevice[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseDevice(value: unknown): MatrixDevice | null {
  if (!isRecord(value)) return null;
  const { app_id: appId, pushkey, data } = value;
  if (typeof appId !== "string" || typeof pushkey !== "string") return null;
  if (!isRecord(data)) return { app_id: appId, pushkey };
  return {
    app_id: appId,
    pushkey,
    data: {
      format: optionalString(data.format),
      default_payload: isRecord(data.default_payload) ? data.default_payload : undefined,
    },
  };
}

/** The notification in a notify request's body, or null when it isn't one. */
export function parseNotifyRequest(body: unknown): MatrixNotification | null {
  if (!isRecord(body) || !isRecord(body.notification)) return null;
  const { notification } = body;
  if (!Array.isArray(notification.devices)) return null;
  const devices: MatrixDevice[] = [];
  for (const value of notification.devices) {
    const device = parseDevice(value);
    if (device === null) return null;
    devices.push(device);
  }
  const counts = isRecord(notification.counts)
    ? {
        unread: optionalCount(notification.counts.unread),
        missed_calls: optionalCount(notification.counts.missed_calls),
      }
    : undefined;
  return {
    event_id: optionalString(notification.event_id),
    room_id: optionalString(notification.room_id),
    prio: optionalString(notification.prio),
    counts,
    devices,
  };
}
