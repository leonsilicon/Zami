// Calls: LiveKit's React Native SDK gives livekit-client, which Zam's call code
// (src/lib/matrix/livekitCall.zami.ts) runs on, WebRTC: RTCPeerConnection, MediaStream and
// `navigator.mediaDevices` from @livekit/react-native-webrtc, plus the shims livekit-client
// needs on Hermes. Set up before Zam's modules load.
import {
  type AppleAudioConfiguration,
  registerGlobals,
  setupIOSAudioManagement,
} from "@livekit/react-native";

// registerGlobals replaces URL with react-native-url-polyfill's (livekit-client sets a
// URL's `pathname`, which React Native's URL can't). Keep the object URLs Zami's Blob
// polyfill gave the old one (`@-/com.leonsilicon.zami.blob`).
const BlobURL = URL;
registerGlobals({ autoConfigureAudioSession: false });
URL.createObjectURL = (object) => BlobURL.createObjectURL(object);
URL.revokeObjectURL = (url) => BlobURL.revokeObjectURL(url);

// The iOS audio session follows WebRTC's audio engine: active while a call plays or
// records, on the speaker, and deactivated after it so other apps' audio comes back.
// LiveKit's default puts a call that only plays (someone else talking before our mic
// is up, as on every join) in the playback category and switches to play-and-record
// when the mic starts; the engine restarted then without its input, so the mic sent
// nothing. Play-and-record throughout keeps the input there, in the media-loudness
// mode while voice processing is off, as LiveKit's own recording default does.
const call: AppleAudioConfiguration = {
  audioCategory: "playAndRecord",
  audioCategoryOptions: [
    "mixWithOthers",
    "allowBluetooth",
    "allowBluetoothA2DP",
    "allowAirPlay",
    "defaultToSpeaker",
  ],
  audioMode: "default",
};
setupIOSAudioManagement(true, {
  recording: { ...call, audioMode: "videoChat" },
  recordingWithoutVoiceProcessing: call,
  playout: call,
});
