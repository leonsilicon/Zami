# @-apps/site

Zami's home page, at https://zami.leonsilicon.com: static files in `public/`, served by
Cloudflare Workers.

It is also the app's OAuth `client_uri` (`src/lib/matrix/oauth.zami.ts`). Matrix
Authentication Service requires a native app's redirect scheme to be that host reversed,
so the app signs in through `com.leonsilicon.zami:/oauth-callback`, and the server's
consent screen links here.

`public/favicon.svg` is a copy of `static/favicon.zami.svg`, the app's icon.

## Deploy

```sh
cd apps/site
vpx wrangler deploy
```

`wrangler.jsonc` puts the Worker on the custom domain `zami.leonsilicon.com`; Cloudflare
creates its DNS record and certificate on the first deploy. It needs a Wrangler login
(`vpx wrangler login`) on the account that holds the `leonsilicon.com` zone.
