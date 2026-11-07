# @-/com.leonsilicon.zami.sveltekit

React Native stand-ins for the SvelteKit runtime modules Zam imports:

- `$app/environment`;
- `$app/navigation`: `goto` and `replaceState` change `page.url`;
- `$app/state`: a reactive `page` and `updated`.

Metro and the app's tsconfig map `$app/*` here.
