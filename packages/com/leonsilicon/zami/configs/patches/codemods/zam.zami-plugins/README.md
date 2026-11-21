# @-/com.leonsilicon.zami.configs.patches.codemods.zam.zami-plugins

A codemod for upstream Zam, applied when its web app is built, that wires in `zam.zami`
(`@-/com.leonsilicon.zami.plugins`):

- `src/hooks.client.ts`: imports the runtime, and Zam's `init` hook (which SvelteKit awaits
  before it starts the app) loads the plugins that patch components, before the first
  render.
- `src/lib/plugins/hostApi.ts`: each plugin's `zam` gets `zami`, built from
  `globalThis.__zamiHost` when the plugin first reads it, and the host tells it when the
  plugin unloads.
