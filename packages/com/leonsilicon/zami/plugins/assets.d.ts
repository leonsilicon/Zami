declare module "#paper-css";

// Zam's own copy (its Vite config resolves it, as it does `svelte`): install.ts starts
// loading it before the SDK asks for it.
declare module "@matrix-org/matrix-sdk-crypto-wasm" {
  export function initAsync(): Promise<void>;
}
