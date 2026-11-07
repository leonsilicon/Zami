// `fetch` for Zam's code (filled in by the audio and static-asset work). Zam fetches its
// own static files by path (`/sounds/…`), which on the web resolve against the page's
// origin; here those resolve against https://zami.invalid and must come from the app's
// bundled copies. Anything else is React Native's fetch.
export const zamiFetch: typeof fetch = (input, init) => fetch(input, init);
