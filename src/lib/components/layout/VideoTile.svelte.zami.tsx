import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { VideoView } from "@livekit/react-native";
import type { Track, VideoTrack } from "livekit-client";
import { Eye, EyeOff, Maximize2, PictureInPicture2 } from "lucide-svelte";
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
import { stopWatchingShare, watchShare } from "$lib/stores/voiceCall.svelte";

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
    // Zami: the video view's `objectFit` takes the fit.
    const fit = tile.source === "camera" ? "cover" : "contain";

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

    // Someone else's screen share can be left and picked up again.
    // Zami: a press on a tile's button doesn't reach the tile's own handler,
    // so there's no stopPropagation.
    const canLeave = tile.source === "screenshare" && !tile.isLocal;
    function leave(): void {
        stopWatchingShare(tile);
    }
    function watch(): void {
        watchShare(tile);
    }

    const contents = (
        <View className="group relative w-full h-full bg-black">
            {tile.unwatched ? (
                <View className="absolute inset-0 flex-col items-center justify-center gap-2 p-2">
                    <EyeOff
                        size={compact ? 16 : 28}
                        className="text-zam-textMuted"
                    />
                    {!compact && (
                        <>
                            <Text className="text-sm text-white text-center">
                                {label}
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                onPress={watch}
                                className="relative z-20 flex-row items-center gap-1.5 px-3 py-1.5 rounded bg-zam-accent hover:opacity-90"
                            >
                                <Eye size={16} className="text-white" />
                                <Text className="text-white text-sm">
                                    {t("videoTile.watchStream")}
                                </Text>
                            </Pressable>
                        </>
                    )}
                </View>
            ) : (
                /* Zami: the <video> with `use:videoTrack` → LiveKit's VideoView,
                   which renders the track natively (a local one is never heard:
                   video tracks carry no audio). A new track gets a new view, as
                   the action re-attached. */
                <VideoView
                    key={(tile.track as VideoTrack).sid ?? tile.key}
                    videoTrack={tile.track as VideoTrack}
                    objectFit={fit}
                    mirror={mirror}
                    style={{ width: "100%", height: "100%" }}
                />
            )}
            {!compact && !tile.unwatched && (
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
                    <View className="absolute bottom-2 end-2 flex-row gap-1">
                        {canLeave && (
                            <Pressable
                                accessibilityRole="button"
                                onPress={leave}
                                className="p-1.5 rounded bg-black/60 opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                                accessibilityLabel={t("videoTile.stopWatching")}
                            >
                                <EyeOff size={16} className="text-white" />
                            </Pressable>
                        )}
                        {pipSupported && (
                            <Pressable
                                accessibilityRole="button"
                                onPress={togglePip}
                                className="p-1.5 rounded bg-black/60 opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                                accessibilityLabel={
                                    inPip
                                        ? t("videoTile.exitPictureInPicture")
                                        : t("videoTile.pictureInPicture")
                                }
                            >
                                <PictureInPicture2
                                    size={16}
                                    className={
                                        inPip ? "text-zam-accent" : "text-white"
                                    }
                                />
                            </Pressable>
                        )}
                        <Pressable
                            accessibilityRole="button"
                            onPress={toggleFullscreen}
                            className="p-1.5 rounded bg-black/60 opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                            accessibilityLabel={t("videoTile.fullscreen")}
                        >
                            <Maximize2 size={16} className="text-white" />
                        </Pressable>
                    </View>
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
