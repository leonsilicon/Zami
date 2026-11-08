// The gateway's HTTP side: the Matrix notify endpoint, and a health check like Sygnal's (Zam's
// Settings → Debug Info probes `<gateway origin>/health`).
import {
  EXPO_PUSH_URL,
  expoMessageFor,
  isExpoPushToken,
  sendExpoMessage,
  type ExpoOutcome,
} from "#expo";
import { NOTIFY_PATH, parseNotifyRequest, type MatrixDevice } from "#matrix";

/** Notify requests are a few hundred bytes; Sygnal allows 512 KiB. */
const MAX_BODY_BYTES = 64 * 1024;

export interface GatewayOptions {
  /** The pushers' app ids to serve. Empty or absent serves any. */
  appIds?: readonly string[];
  /** Expo's access token, for a project with enhanced push security on. */
  expoAccessToken?: string;
  /** Expo's send endpoint (a test server's, in tests). */
  expoPushUrl?: string;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function matrixError(status: number, errcode: string, error: string): Response {
  return json(status, { errcode, error });
}

/** The body as text, or null when it's longer than MAX_BODY_BYTES. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

type DeviceOutcome = ExpoOutcome | { kind: "invalid" } | { kind: "skipped" };

async function notify(request: Request, options: GatewayOptions): Promise<Response> {
  const text = await readBody(request);
  if (text === null) return matrixError(413, "M_TOO_LARGE", "The request is too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return matrixError(400, "M_NOT_JSON", "The body isn't JSON");
  }
  const notification = parseNotifyRequest(body);
  if (notification === null) {
    return matrixError(400, "M_BAD_JSON", "The body isn't a Matrix notify request");
  }

  const appIds = options.appIds ?? [];
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const deliver = async (device: MatrixDevice): Promise<DeviceOutcome> => {
    // Pushkeys this gateway can never deliver to: the homeserver should drop their pushers,
    // as it does for the app ids Sygnal has no app for.
    if (appIds.length > 0 && !appIds.includes(device.app_id)) return { kind: "invalid" };
    if (!isExpoPushToken(device.pushkey)) return { kind: "invalid" };
    const message = expoMessageFor(notification, device);
    if (message === null) return { kind: "skipped" };
    return sendExpoMessage(message, {
      fetch: send,
      url: options.expoPushUrl ?? EXPO_PUSH_URL,
      accessToken: options.expoAccessToken,
    });
  };
  // One Expo request per device: tokens from different Expo projects can't share a request,
  // and a homeserver sends one device per request anyway.
  const results = await Promise.all(
    notification.devices.map(async (device) => ({ device, outcome: await deliver(device) })),
  );
  const outcomes = results.map(({ outcome }) => outcome);

  const rejected = results
    .filter(({ outcome }) => outcome.kind === "rejected" || outcome.kind === "invalid")
    .map(({ device }) => device.pushkey);
  const errors = outcomes.flatMap((outcome) =>
    outcome.kind === "dropped" || outcome.kind === "retry" ? [outcome.error] : [],
  );
  const retry = outcomes.some((outcome) => outcome.kind === "retry");
  // Counts and error codes only: a pushkey is enough to push to its device.
  console.log(
    JSON.stringify({
      message: "notify",
      devices: outcomes.length,
      sent: outcomes.filter((outcome) => outcome.kind === "sent").length,
      rejected: rejected.length,
      errors,
      retry,
    }),
  );
  // The homeserver retries the whole request later. Devices Expo already took get the push
  // twice; a homeserver sends one device per request, so there are none in practice.
  if (retry) {
    return matrixError(502, "M_UNKNOWN", "Expo's push service is unavailable; try again later");
  }
  return json(200, { rejected });
}

/** The gateway as a fetch handler. */
export function createGateway(
  options: GatewayOptions = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === NOTIFY_PATH) {
      if (request.method !== "POST") {
        return new Response(null, { status: 405, headers: { allow: "POST" } });
      }
      return notify(request, options);
    }
    if (pathname === "/health" && (request.method === "GET" || request.method === "HEAD")) {
      return new Response("OK", { headers: { "content-type": "text/plain" } });
    }
    return matrixError(404, "M_UNRECOGNIZED", "Not found");
  };
}
