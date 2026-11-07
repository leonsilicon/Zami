# @-/com.leonsilicon.zami.sveltekit

React Native stand-ins for the SvelteKit runtime modules Zam imports:

- `$app/environment`;
- `$app/navigation`: `goto` and `replaceState` change `page.url`;
- `$app/state`: a reactive `page` and `updated`;
- `window.location` for Zam's code (`installLocation()`, which the app calls first; Metro
  rewrites `location` in Zam's tree to it, leaving libraries without a global `location`):
  reads `page.url`; assigning it reloads the JS bundle at the new URL, as a browser's full
  navigation boots Zam afresh.

Metro and the app's tsconfig map `$app/*` here.

`tsconfig.svelte-kit.json` stands in for the tsconfig `svelte-kit sync` generates. Zam's
`tsconfig.json` extends `.svelte-kit/tsconfig.json`, and Zami's postinstall writes one
there that extends this file. Type-aware lint (`vp check`) and editors then resolve the
`.zami.` files in Zam's tree as the app does. It gives type information without
type-checking Zam's code (`noCheck`).
