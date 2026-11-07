// Media setup. Authenticated Matrix media: images on the active account's homeserver need
// its token, which Zam's service worker adds on the web. Audio: a browser plays sound
// with the iPhone's silent switch on, so voice messages and call audio do here too.
import { setMediaHeaders } from "@-/com.leonsilicon.zami.rn";
import { setAudioModeAsync } from "expo-audio";
import { AudioManager } from "react-native-audio-api";
import { getActiveAccount } from "$lib/stores/accounts.svelte";
import { isAuthedMediaUrl } from "$lib/stores/mediaAuth.svelte";

setMediaHeaders((url) => {
  if (!isAuthedMediaUrl(url)) return undefined;
  const token = getActiveAccount()?.accessToken;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
});

void setAudioModeAsync({ playsInSilentMode: true });
// Zam's Web Audio and <audio> (react-native-audio-api) play in whatever audio session is
// set up: this one, the recorder's or a call's. Left to manage it, react-native-audio-api
// would switch it to plain playback whenever a sound starts, cutting off the microphone
// mid-call or mid-recording.
AudioManager.disableSessionManagement();
