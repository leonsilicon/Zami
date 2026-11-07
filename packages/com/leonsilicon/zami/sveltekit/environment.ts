// `$app/environment`. The app always runs "in the browser" as far as Zam's code is concerned.
declare const __APP_VERSION__: string;

export const browser = true;
export const building = false;
export const dev: boolean = __DEV__;
/** SvelteKit's app version; Zam's is its package.json version (inlined by the Zami transformer). */
export const version: string = __APP_VERSION__;
