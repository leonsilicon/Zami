# @-/com.leonsilicon.zami.sveltekit

React Native stand-ins for the SvelteKit runtime modules Zam imports:

- `$app/environment`;
- `$app/navigation`: `goto` and `replaceState` change `page.url`;
- `$app/state`: a reactive `page` and `updated`;
- `window.location` for Zam's code (`installLocation()`, which the app calls first; Metro
  rewrites `location` in Zam's tree to it, leaving libraries without a global `location`):
  reads `page.url`; assigning it (`href`, `assign`, `replace`) reloads the app with
  expo's `reloadAppAsync`, in development and release builds alike, and the new run starts
  at the new URL, as a browser's full navigation boots Zam afresh. `reload()` starts it
  again at the current URL.

Metro and the app's tsconfig map `$app/*` here.

`tsconfig.svelte-kit.json` stands in for the tsconfig `svelte-kit sync` generates. Zam's
`tsconfig.json` extends `.svelte-kit/tsconfig.json`, and Zami's postinstall writes one
there that extends this file. Type-aware lint (`vp check`) and editors then resolve the
`.zami.` files in Zam's tree as the app does. It gives type information without
type-checking Zam's code (`noCheck`).
