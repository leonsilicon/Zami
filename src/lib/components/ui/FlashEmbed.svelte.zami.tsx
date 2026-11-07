import { View } from "react-native";

interface Props {
    src: string; // URL of the SWF (a blob: URL of the fetched attachment)
}

// Zami: not ported: Flash. Upstream plays the SWF with Ruffle inside a sandboxed
// iframe (static/flash-sandbox/), which loads /ruffle/ruffle.js from the app's origin
// and gets Ruffle's wasm and the SWF over a MessagePort. The app serves none of
// static/ to a WebView, so this renders the frame's dead state (upstream's
// `navigatedAway` box) and never the player or its suspend button.
export default function FlashEmbed(_props: Props) {
    return (
        <View className="relative w-full max-w-sm mt-1 group/flash">
            <View className="w-full aspect-video rounded-lg bg-black" />
        </View>
    );
}
