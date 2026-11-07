// Media setup. Authenticated Matrix media: images on the active account's homeserver need
// its token, which Zam's service worker adds on the web. Audio: a browser plays sound
// with the iPhone's silent switch on, so voice messages and call audio do here too.
import { setMediaHeaders } from "@-/com.leonsilicon.zami.rn";
import { setAudioModeAsync } from "expo-audio";
import { getActiveAccount } from "$lib/stores/accounts.svelte";
import { isAuthedMediaUrl } from "$lib/stores/mediaAuth.svelte";

setMediaHeaders((url) => {
  if (!isAuthedMediaUrl(url)) return undefined;
  const token = getActiveAccount()?.accessToken;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
});

void setAudioModeAsync({ playsInSilentMode: true });
