import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import type { Track } from "livekit-client";
import { Maximize2, MonitorUp, PictureInPicture2, Video } from "lucide-svelte";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "$lib/i18n";
import type { VideoTileDescriptor } from "$lib/utils/videoTiles";
import {
    callPipState,
    closePipWindow,
    openPipWindow,
    pipWindowSupported,
} from "$lib/stores/callPip.svelte";

interface Props {
    tile: VideoTileDescriptor;
    label: string;
    mirror?: boolean;
    /** Small filmstrip mode: hide the label + fullscreen chrome. */
    compact?: boolean;
}

export default function VideoTile({
    tile,
    label,
    mirror = false,
    compact = false,
}: Props) {
    const insets = useSafeAreaInsets();

    // Camera fills the tile (cover); a shared screen must never be cropped
    // (contain). Mirror only ever applies to a local camera self-view.
    const fit = tile.source === "camera" ? "object-cover" : "object-contain";

    // Fullscreen the whole tile (video + label).
    // Zami: the Fullscreen API → the tile drawn over the whole app through a
    // Portal. A press doesn't bubble to CallView's tile handler, so there's no
    // stopPropagation.
    const [fullscreen, setFullscreen] = useState(false);
    function toggleFullscreen(): void {
        setFullscreen((on) => !on);
    }

    // Zami: false here, as on Android's WebView: there's no DOM
    // picture-in-picture, so the button stays hidden.
    const pipSupported = pipWindowSupported();
    const inPip = useRune(
        () => callPipState.windowOpen && callPipState.pinnedKey === tile.key,
        [tile.key],
    );
    function togglePip(): void {
        if (inPip) closePipWindow();
        else void openPipWindow(tile.key, tile.track as Track);
    }

    const contents = (
        <View className="group relative w-full h-full bg-black">
            {/* Zami: not ported: LiveKit video. LiveKit's React Native SDK isn't
                installed, so `tile.track` has nowhere to play; this placeholder
                stands where its video goes, with the same fit and mirroring
                (muted when `tile.isLocal`). */}
            <View
                className={`w-full h-full items-center justify-center ${fit} ${
                    mirror ? "scale-x-[-1]" : ""
                }`}
            >
                {tile.source === "camera" ? (
                    <Video size={32} className="text-discord-textMuted" />
                ) : (
                    <MonitorUp size={32} className="text-discord-textMuted" />
                )}
            </View>
            {!compact && (
                <>
                    {/* Zami: `max-w-[calc(100%-1rem)]` → the end inset. */}
                    <View
                        pointerEvents="none"
                        className="absolute bottom-2 start-2 end-2 flex-row"
                    >
                        <View className="flex-shrink px-2 py-0.5 rounded bg-black/60">
                            <Text
                                numberOfLines={1}
                                className="text-xs text-white truncate"
                            >
                                {label}
                            </Text>
                        </View>
                    </View>
                    {pipSupported && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={togglePip}
                            className="absolute bottom-2 end-11 p-1.5 rounded bg-black/60 opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                            accessibilityLabel={
                                inPip
                                    ? t("videoTile.exitPictureInPicture")
                                    : t("videoTile.pictureInPicture")
                            }
                        >
                            <PictureInPicture2
                                size={16}
                                className={
                                    inPip ? "text-discord-accent" : "text-white"
                                }
                            />
                        </Pressable>
                    )}
                    <Pressable
                        accessibilityRole="button"
                        onPress={toggleFullscreen}
                        className="absolute bottom-2 end-2 p-1.5 rounded bg-black/60 opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        accessibilityLabel={t("videoTile.fullscreen")}
                    >
                        <Maximize2 size={16} className="text-white" />
                    </Pressable>
                </>
            )}
        </View>
    );

    if (!fullscreen) return contents;
    return (
        <>
            <View className="w-full h-full bg-black" />
            <Portal>
                <View className="absolute inset-0 bg-black">
                    <View
                        className="flex-1"
                        style={{
                            marginTop: insets.top,
                            marginBottom: insets.bottom,
                        }}
                    >
                        {contents}
                    </View>
                </View>
            </Portal>
        </>
    );
}
