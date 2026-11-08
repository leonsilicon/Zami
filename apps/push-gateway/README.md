# @-apps/push-gateway

Zami's Matrix push gateway, at https://zami-push.leonsilicon.com: a Cloudflare Worker that
runs [`@-/com.leonsilicon.zami.push-gateway`](../../packages/com/leonsilicon/zami/push-gateway/README.md).

A homeserver can't wake a phone itself: only APNs and FCM can, and they take messages only
from whoever holds the app's credentials. So the app registers a pusher that names a push
gateway, the homeserver posts each push there, and the gateway forwards it. Zam runs Sygnal
with its own Firebase and APNs keys (`ANDROID_PUSH_SETUP.md`). Zami's gateway forwards to
Expo's push service instead, which holds Zami's APNs and FCM credentials in EAS, so the
gateway holds none and keeps no state.

```
homeserver ─▶ zami-push.leonsilicon.com ─▶ Expo's push service ─▶ APNs / FCM ─▶ the app
```

## How push is set up

Everything below is in place; this is what to check or redo.

- **The EAS project** is `@improvelabs/zami`: `apps/zami/app.json` names its owner and id
  (`extra.eas.projectId`), which the app needs for Expo push tokens. Both variants share it.
- **iOS:** EAS holds the APNs key `XRQ9U45732` (team `M76P5G9HXK`, which Haniverse also
  uses: one APNs key serves every app of the team) for `com.leonsilicon.zami` and
  `com.leonsilicon.zami.staging`. Both App IDs have the Push Notifications capability,
  which the entitlements expo-notifications adds need for signing; `_testflight` registers
  new bundle IDs with it. To change the key: `npx eas-cli credentials -p ios`.
- **Android:** the Firebase project `leonsilicon-zami` has an Android app for each
  package, and `apps/zami/google-services.json` (both apps, committed: Firebase's config
  isn't secret) is the app's `android.googleServicesFile`. EAS holds the FCM V1 key of
  its service account `expo-push@leonsilicon-zami.iam.gserviceaccount.com`, which has
  only `roles/firebasecloudmessaging.admin`. To replace it: create a key for that account
  and give it to `npx eas-cli credentials -p android` → Google Service Account → FCM V1.
- **The gateway** is deployed (below). Newly attached credentials can take about 15
  minutes before Expo stops answering `InvalidCredentials`.
- **Optional, not on: enhanced push security.** Turned on in the Expo project's settings,
  it makes Expo accept pushes only with an access token: `vpx wrangler secret put
  EXPO_ACCESS_TOKEN`. It stops pushes sent to Expo directly, but not through the gateway:
  the Matrix spec gives the notify endpoint no authentication, as with Sygnal.

In the app, Settings → Debug Info shows the provider `expo`, the push token, the pusher
the homeserver holds (pointing at this gateway), and the gateway's `/health`. The app's
pushers point here unless `EXPO_PUBLIC_PUSH_GATEWAY_URL` names another gateway
(`src/lib/push.zami.ts`).

A simulator's token is registered with Expo as a development (sandbox) one, since a
simulator build has no provisioning profile to say so.

## Deploying

```sh
cd apps/push-gateway
vpx wrangler deploy
```

`wrangler.jsonc` puts the Worker on the custom domain `zami-push.leonsilicon.com`;
Cloudflare creates its DNS record and certificate on the first deploy. It needs a Wrangler
login (`vpx wrangler login`) on the account that holds the `leonsilicon.com` zone.

## What it sends

The app registers this pusher (`src/lib/push.zami.ts`):

```
app_id  : com.leonsilicon.zami (the app's id: com.leonsilicon.zami.staging for staging)
pushkey : the Expo push token
data    : { url, format: "event_id_only",
            default_payload: { zam_account, expo: { body: "New message", sound, … } } }
```

For a push with an event, the gateway sends Expo an alert: the fields in
`default_payload.expo`, the room as Android's `tag` (a room's newer push replaces the
older one) and iOS's `threadId`, the unread count as iOS's badge, and high priority (normal
for a `low` push). Its `data`, which the app reads when the push is tapped, is the rest of
`default_payload` plus the event and room ids and the counts. A push without an event (the
room was read elsewhere) only sets the badge.

Pushes are `event_id_only`, so the gateway, Expo, Apple and Google see room and event ids
and the account's user id, never a message. Showing the sender and the message needs code
on the device: an iOS Notification Service Extension and an Android background task.

## What it answers

- **200 with `rejected`:** pushkeys the homeserver should delete the pushers of. They are
  tokens Expo says are dead (`DeviceNotRegistered`), pushkeys that aren't Expo push tokens,
  and app ids not in `APP_IDS` (`wrangler.jsonc`), as Sygnal rejects app ids it has no
  app for.
- **502:** Expo is unavailable, rate-limiting, or says its error is transient. The
  homeserver retries later.
- **200, nothing rejected:** Expo refused the message for good (too big, a bad field, bad
  credentials). The Worker's log shows the error code.

It doesn't check receipts, Expo's delivery reports, which are ready about 15 minutes after
sending. So when APNs or FCM drop a token after Expo accepted a message for it, that
doesn't reject the pusher. It also doesn't de-duplicate by event id (the spec suggests it,
for homeservers' retries), since it keeps no state.

## Developing

- `vp run test` runs the package's tests.
- `vpx wrangler dev` runs the Worker locally, sending to the real Expo service. A made-up
  token (`ExponentPushToken[…]`) comes back rejected.
- `vpx wrangler types --include-runtime=false` after changing `wrangler.jsonc`.
- `vpx wrangler tail` streams the deployed Worker's logs: one JSON line per notify, with
  counts and error codes, never pushkeys or ids.
