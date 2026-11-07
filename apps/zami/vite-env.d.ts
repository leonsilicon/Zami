// The Vite build-time features Zam's code uses, which the Zami Metro transformer
// provides (see @-/com.leonsilicon.zami.metro/vite-babel-plugin.cjs).
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly SSR: boolean;
  readonly [key: `VITE_${string}`]: string | undefined;
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
