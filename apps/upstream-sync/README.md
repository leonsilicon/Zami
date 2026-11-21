# Zami upstream sync webhook

Pull syncs the `master` branch of `leonsilicon/Zam` with upstream Zam. GitHub sends the
fork's push webhook to `https://zami-upstream-sync.leonsilicon.com/github`. The Worker
verifies the signature and dispatches `zami-upstream-sync.yml` on Zami's `trunk`. The
workflow checks the official Zam remote, runs the codemods and builds the web app
before advancing the submodule pin.

The Worker uses a private GitHub App installed only on `leonsilicon/Zami` with Actions
write permission. It requests an installation token for each dispatch.

Deploy with `vpx wrangler deploy` from this directory after configuring these Worker
secrets:

- `GITHUB_WEBHOOK_SECRET` matches the secret on the fork's JSON `push` webhook.
- `GITHUB_APP_CLIENT_ID` identifies the GitHub App.
- `GITHUB_APP_PRIVATE_KEY` contains the PEM key from the app settings.
- `GITHUB_INSTALLATION_ID` identifies the app's installation on Zami.
