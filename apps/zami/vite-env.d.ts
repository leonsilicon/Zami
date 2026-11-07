// The Vite build-time features Zam's code uses, which the Zami Metro transformer
// provides (see @-/com.leonsilicon.zami.metro/vite-babel-plugin.cjs).
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly SSR: boolean;
  readonly [key: `VITE_${string}`]: string | undefined;
  // Vite's own ImportMetaEnv has this too, so Zam's casts of `import.meta.env` type-check.
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly [key: string]: any;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  glob<Module = unknown>(
    pattern: string,
    options?: { eager?: false },
  ): Record<string, () => Promise<Module>>;
  glob<Module = unknown>(pattern: string, options: { eager: true }): Record<string, Module>;
}

/** Stylesheets are compiled by Uniwind; importing one only registers its styles. */
declare module "*.css";

/**
 * A Vite asset URL import. Metro turns it into a `zami-unavailable:` URL: Zam's feed Web
 * Audio worklets and wasm, which React Native doesn't have.
 */
declare module "*?url" {
  const url: string;
  export default url;
}
declare module "*?url&no-inline" {
  const url: string;
  export default url;
}
/** A Vite worker import; in Zami a dynamic one rejects (there are no Web Workers). */
declare module "*?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

/** Zam's JPEG XL decoder worker's wasm, which Zami doesn't install (iOS decodes JPEG XL itself). */
declare module "jxl-rs-polyfill/wasm" {
  export default function init(options: { module_or_path: string }): Promise<unknown>;
  export function decode_jxl_to_png(jxl: Uint8Array): Uint8Array;
}
