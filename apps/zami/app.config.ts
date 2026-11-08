// app.json, for the variant in ZAMI_VARIANT: "production" (the default), the app "Zami", or
// "staging", "(S) Zami", a separate app that installs next to it (built nightly from
// trunk; see .github/workflows/zami-staging.yml).
import type { ConfigContext, ExpoConfig } from "expo/config";

export type Variant = "production" | "staging";

export function variantFrom(value: string | undefined): Variant {
  if (value === undefined || value === "" || value === "production") return "production";
  if (value === "staging") return "staging";
  throw new Error(`ZAMI_VARIANT must be "production" or "staging", not "${value}"`);
}

export function configFor(config: ExpoConfig, variant: Variant): ExpoConfig {
  if (variant === "production") return config;
  return {
    ...config,
    name: "(S) Zami",
    // Its own deep-link scheme. The OAuth redirect scheme stays: Matrix Authentication
    // Service only accepts the reverse of the client_uri's host, and the sign-in
    // session takes the redirect itself, so it never reaches the other app.
    scheme: ["zami-staging", "com.leonsilicon.zami"],
    ios: { ...config.ios, bundleIdentifier: "com.leonsilicon.zami.staging" },
    android: { ...config.android, package: "com.leonsilicon.zami.staging" },
  };
}

export default ({ config }: ConfigContext): ExpoConfig =>
  configFor(config as ExpoConfig, variantFrom(process.env.ZAMI_VARIANT));
