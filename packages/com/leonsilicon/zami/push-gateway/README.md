# @-/com.leonsilicon.zami.push-gateway

A [Matrix push gateway](https://spec.matrix.org/latest/push-gateway-api/) in front of
[Expo's push service](https://docs.expo.dev/push-notifications/sending-notifications/), in
place of Sygnal. Homeservers post `POST /_matrix/push/v1/notify` requests; for each device
whose pushkey is an Expo push token, it sends Expo one message. Zami deploys it as
[`apps/push-gateway`](../../../../../apps/push-gateway/README.md), which explains the setup
and the pusher the app registers.

```ts
import { createGateway } from "@-/com.leonsilicon.zami.push-gateway";

const handle = createGateway({
  appIds: ["com.leonsilicon.zami"], // empty or absent: any app id
  expoAccessToken, // for enhanced push security
});
const response = await handle(request); // a fetch handler: Request in, Response out
```

- `GET /health` answers 200 `OK`, like Sygnal's, for Zam's Settings → Debug Info.
- A pusher's `default_payload.expo` holds the Expo message fields the app sets (`title`,
  `body`, `sound`, `channelId`, `mutableContent`, …: `APP_FIELDS` in `expo.ts`). The rest
  of `default_payload`, plus the push's event and room ids and counts, becomes the
  message's `data`. `to` and `data` are always the gateway's.
- It forwards no message content, so it suits `event_id_only` pushers. Sender, room name
  and content are never read.
- `expoMessageFor` builds a device's message, `parseNotifyRequest` reads a notify request,
  and `isExpoPushToken` is expo-server-sdk's check.
