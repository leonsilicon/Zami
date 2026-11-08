// The Worker: @-/com.leonsilicon.zami.push-gateway, configured from wrangler.jsonc.
import { createGateway } from "@-/com.leonsilicon.zami.push-gateway";

/**
 * Secrets, set with `vpx wrangler secret put`. Optional, so wrangler.jsonc doesn't list them
 * as required and `wrangler types` doesn't know them.
 */
interface Secrets {
  /** Expo's access token, needed once the Expo project turns enhanced push security on. */
  EXPO_ACCESS_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env & Secrets): Promise<Response> {
    const appIds = env.APP_IDS.split(",")
      .map((appId) => appId.trim())
      .filter(Boolean);
    return createGateway({ appIds, expoAccessToken: env.EXPO_ACCESS_TOKEN })(request);
  },
};
