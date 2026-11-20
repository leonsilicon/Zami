// One picture-in-picture panel, drawn both in the Zam window (the floating
// video, mode "inline") and in the pop-out window (mode "window", mounted
// into that window's document by stores/callPip.svelte.ts). Both read the
// same stores, so they can't drift apart; the pop-out adds the call
// controls.
// Zami: there's no pop-out window (pipWindowSupported() is false), so only
// mode "inline" is drawn; "window" is kept as upstream has it.
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import {
    Headphones,
    HeadphoneOff,
    Mic,
    MicOff,
    Minimize2,
    PhoneOff,
    PictureInPicture2,
    Video,
    VideoOff,
    X,
} from "lucide-svelte";
import { useRef } from "react";
import { Pressable, View } from "react-native";
import { t } from "$lib/i18n";
import VideoTile from "$lib/components/layout/VideoTile.svelte";
import TileLabel from "$lib/components/layout/TileLabel.svelte";
import WatcherStack from "$lib/components/layout/WatcherStack.svelte";
import { getMemberName, getRoom } from "$lib/matrix/client";
import {
    voiceCallState,
    leaveCall,
    toggleCallDeafen,
    toggleCallMute,
    toggleCamera,
} from "$lib/stores/voiceCall.svelte";
import { callPipState } from "$lib/stores/callPip.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { pickPipTile, type VideoTileDescriptor } from "$lib/utils/videoTiles";
import { shareViewers } from "$lib/utils/shareWatchers";

interface Props {
    mode: "inline" | "window";
    /** Inline only: send the video to a pop-out window, when there is one. */
    onPopOut?: () => void;
    /** Inline only: hide the floating video until the call ends. */
    onHide?: () => void;
    /** Window only: bring the video back into the Zam window. */
    onReturn?: () => void;
    /** Window only: close the pop-out. */
    onClose?: () => void;
}

const CONTROL =
    "p-1.5 rounded bg-black/60 opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
const ROUND =
    "flex h-9 w-9 items-center justify-center rounded-full bg-black/60 hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
const ROUND_ALERT = "bg-red-600/90 hover:bg-red-600";

export default function CallPipPanel({
    mode,
    onPopOut,
    onHide,
    onReturn,
    onClose,
}: Props) {
    // Plain let: pickPipTile only wants last time's answer, and $state here
    // would make the derived depend on what it writes.
    const lastKey = useRef<string | null>(null);
    const tile = useRune((): VideoTileDescriptor | null => {
        void voiceCallState.voiceTick;
        const picked = pickPipTile(voiceCallState.videoTiles, {
            pinned: callPipState.pinnedKey,
            focused: voiceCallState.focusedTileKey,
            current: lastKey.current,
            speakingUserIds: voiceCallState.speakingUserIds,
        });
        lastKey.current = picked?.key ?? null;
        return picked;
    });

    const label = useRune(() => {
        void roomsState.roomsTick;
        if (!tile) return "";
        const room = voiceCallState.roomId && getRoom(voiceCallState.roomId);
        if (tile.userId === auth.userId)
            return tile.source === "screenshare"
                ? t("callView.yourScreen")
                : t("callView.you");
        const name = room ? getMemberName(room, tile.userId) : tile.userId;
        return tile.source === "screenshare"
            ? t("callView.sScreen", { name })
            : name;
    }, [tile]);

    const isShare = tile?.source === "screenshare" && !tile.unwatched;
    const shareWatchers = useRune(() => voiceCallState.shareWatchers);
    const viewers = tile ? shareViewers(shareWatchers, tile.identity) : [];

    const mirrorCamera = useRune(() => settingsState.mirrorCamera);
    const cameraDisabled = useRune(() => settingsState.cameraDisabled);
    const micMuted = useRune(() => voiceCallState.micMuted);
    const deafened = useRune(() => voiceCallState.deafened);
    const cameraOn = useRune(() => voiceCallState.cameraOn);

    if (!tile) return null;
    // Zami: a press on a control is that control's alone (the responder goes
    // to the innermost Pressable), as upstream's stopPropagation makes it.
    // `pip-root`/`pip-chrome` style the pop-out window's document only.
    return (
        <View
            className="relative w-full h-full bg-black"
            testID="call-pip-panel"
        >
            <VideoTile
                tile={tile}
                label={label}
                compact
                showWatchers={false}
                mirror={
                    tile.source === "camera" && tile.isLocal && mirrorCamera
                }
            />

            {/* Top bar: the name on the left, the window's buttons on the right.
                A flex row, so the two never overlap at any size. */}
            <View
                pointerEvents="box-none"
                className="absolute top-1.5 inset-x-1.5 z-20 flex-row items-start justify-between gap-1"
            >
                <View pointerEvents="none" className="min-w-0 flex-1">
                    <TileLabel userId={tile.userId} label={label} />
                </View>
                <View className="flex-row shrink-0 gap-1">
                    {mode === "inline" ? (
                        <>
                            {onPopOut && (
                                <Pressable
                                    accessibilityRole="button"
                                    className={CONTROL}
                                    accessibilityLabel={t(
                                        "videoTile.pictureInPicture",
                                    )}
                                    onPress={() => onPopOut?.()}
                                >
                                    <PictureInPicture2
                                        size={14}
                                        className="text-white"
                                    />
                                </Pressable>
                            )}
                            {onHide && (
                                <Pressable
                                    accessibilityRole="button"
                                    className={CONTROL}
                                    accessibilityLabel={t(
                                        "callParticipantMenu.hideVideo",
                                    )}
                                    onPress={() => onHide?.()}
                                >
                                    <X size={14} className="text-white" />
                                </Pressable>
                            )}
                        </>
                    ) : (
                        <>
                            <Pressable
                                accessibilityRole="button"
                                className={CONTROL}
                                accessibilityLabel={t(
                                    "videoTile.exitPictureInPicture",
                                )}
                                onPress={() => onReturn?.()}
                            >
                                <Minimize2 size={14} className="text-white" />
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                className={CONTROL}
                                accessibilityLabel={t("common.close")}
                                onPress={() => onClose?.()}
                            >
                                <X size={14} className="text-white" />
                            </Pressable>
                        </>
                    )}
                </View>
            </View>

            {/* Bottom bar: who is watching a share on the left, the call's
                controls on the right (pop-out window only). */}
            <View
                pointerEvents="box-none"
                className="absolute bottom-1.5 inset-x-1.5 z-20 flex-row items-end justify-between gap-1"
            >
                <View className="min-w-0">
                    {isShare && <WatcherStack viewers={viewers} max={3} />}
                </View>
                {mode === "window" && (
                    <View className="flex-row shrink-0 gap-1.5">
                        <Pressable
                            accessibilityRole="button"
                            className={`${ROUND} ${micMuted ? ROUND_ALERT : ""}`}
                            accessibilityLabel={
                                micMuted
                                    ? t("callView.unmute")
                                    : t("common.mute")
                            }
                            onPress={() => toggleCallMute()}
                        >
                            {micMuted ? (
                                <MicOff size={18} className="text-white" />
                            ) : (
                                <Mic size={18} className="text-white" />
                            )}
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            className={`${ROUND} ${deafened ? ROUND_ALERT : ""}`}
                            accessibilityLabel={
                                deafened
                                    ? t("callView.undeafen")
                                    : t("callView.deafen")
                            }
                            onPress={() => toggleCallDeafen()}
                        >
                            {deafened ? (
                                <HeadphoneOff
                                    size={18}
                                    className="text-white"
                                />
                            ) : (
                                <Headphones size={18} className="text-white" />
                            )}
                        </Pressable>
                        {!cameraDisabled && (
                            <Pressable
                                accessibilityRole="button"
                                className={ROUND}
                                accessibilityLabel={
                                    cameraOn
                                        ? t("common.turnOffCamera")
                                        : t("common.turnOnCamera")
                                }
                                onPress={() => void toggleCamera()}
                            >
                                {cameraOn ? (
                                    <Video size={18} className="text-white" />
                                ) : (
                                    <VideoOff
                                        size={18}
                                        className="text-white"
                                    />
                                )}
                            </Pressable>
                        )}
                        <Pressable
                            accessibilityRole="button"
                            className={`${ROUND} ${ROUND_ALERT}`}
                            accessibilityLabel={t("callView.disconnect")}
                            onPress={() => leaveCall()}
                        >
                            <PhoneOff size={18} className="text-white" />
                        </Pressable>
                    </View>
                )}
            </View>
        </View>
    );
}
