# @-apps/site

Zami's home page, at https://zami.leonsilicon.com: static files in `public/`, served by
Cloudflare Workers.

The app signs in as upstream Zam does (Zam's `client_uri` and its
`moe.crafty.matrix:/oauth` redirect), so this site isn't part of signing in.

`public/favicon.svg` is a copy of Zam's `static/favicon.svg`, the app's icon.

## Deploy

```sh
cd apps/site
vpx wrangler deploy
```

`wrangler.jsonc` puts the Worker on the custom domain `zami.leonsilicon.com`; Cloudflare
creates its DNS record and certificate on the first deploy. It needs a Wrangler login
(`vpx wrangler login`) on the account that holds the `leonsilicon.com` zone.
