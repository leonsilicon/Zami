const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;

// Set by the iOS Release build phase, including the production and staging TestFlight builds.
export const appStoreBuild = env?.VITE_ZAMI_APP_STORE === "true";
export const zamiVersion = env?.VITE_ZAMI_VERSION;
