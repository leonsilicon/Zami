import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import {
    Mic,
    MicOff,
    Headphones,
    HeadphoneOff,
    PhoneOff,
    Video,
    VideoOff,
    MonitorUp,
    Signal,
    Maximize2,
    Settings2,
} from "lucide-svelte";
import { useEffect, useRef, useState } from "react";
import { Pressable, type PressableInstance, Text, View } from "react-native";
import { t } from "$lib/i18n";
import {
    voiceCallState,
    isCallViewShowing,
    leaveCall,
    toggleCallMute,
    toggleCallDeafen,
    toggleCamera,
    toggleScreenShare,
} from "$lib/stores/voiceCall.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import { connStateLabel } from "$lib/utils/voiceCall";
import { screenShareSupportedHere } from "$lib/utils/videoTiles";
import { formatCallDuration } from "$lib/utils/callDuration";
import { showCallView, interfaceState } from "$lib/stores/interface.svelte";
import {
    getRoom,
    getRoomDisplayName,
    getParentSpaceIds,
    resumeVoicePlayback,
} from "$lib/matrix/client";
import { navigateToRoom, roomsState } from "$lib/stores/rooms.svelte";
import ScreenShareQualityPopover from "./ScreenShareQualityPopover.svelte";
import SoundboardButton from "./SoundboardButton.svelte";
import CallEncryptionBadge from "./CallEncryptionBadge.svelte";
import CallStatsPanel from "./CallStatsPanel.svelte";

export default function VoiceCallPanel() {
    // Fixed for the session, same as CallView — hides share where unsupported.
    const screenShareSupported = screenShareSupportedHere();

    const roomId = useRune(() => voiceCallState.roomId);
    const connState = useRune(() => voiceCallState.connState);
    const connectedAt = useRune(() => voiceCallState.connectedAt);
    const playbackBlocked = useRune(() => voiceCallState.playbackBlocked);
    const screenSharing = useRune(() => voiceCallState.screenSharing);
    const micMuted = useRune(() => voiceCallState.micMuted);
    const deafened = useRune(() => voiceCallState.deafened);
    const cameraOn = useRune(() => voiceCallState.cameraOn);
    const videoTiles = useRune(() => voiceCallState.videoTiles);
    const cameraDisabled = useRune(() => settingsState.cameraDisabled);
    const touch = useRune(() => interfaceState.isTouchscreen);

    // Ticks only while the panel is on screen; the anchor itself lives in the
    // store so a reconnect doesn't restart the clock.
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (connectedAt === null) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [connectedAt]);
    const elapsed =
        connectedAt === null ? null : formatCallDuration(now - connectedAt);

    const locationLabel = useRune(() => {
        void voiceCallState.voiceTick;
        void roomsState.roomsTick;
        if (!voiceCallState.roomId) return "";
        const room = getRoom(voiceCallState.roomId);
        if (!room) return "";
        const name = getRoomDisplayName(room);
        const parentId = getParentSpaceIds(voiceCallState.roomId)[0];
        const parent = parentId ? getRoom(parentId) : null;
        return parent ? `${name} / ${getRoomDisplayName(parent)}` : name;
    });

    const callViewShowing = useRune(() => isCallViewShowing());

    // The call can live in a room outside the selected space, so switch space +
    // active room (navigateToRoom) before flipping to the call view — the shell
    // only renders CallView when callViewRoomId matches the active room.
    function openCallView(): void {
        const roomId = voiceCallState.roomId;
        if (!roomId) return;
        navigateToRoom(roomId);
        showCallView(roomId);
    }

    // Sharing starts straight away (the picker asks what to share; quality is
    // changed live from the "Sharing your screen" row below).
    // Zami: the button's window position stands in for getBoundingClientRect().
    const [sharePopover, setSharePopover] = useState<{
        x: number;
        y: number;
    } | null>(null);
    const shareQualityButton = useRef<PressableInstance>(null);
    function openShareQuality(): void {
        shareQualityButton.current?.measureInWindow((x, y) =>
            setSharePopover({ x, y }),
        );
    }
    // A share ended from the browser's own "Stop sharing" bar must not
    // strand the quality popover.
    useEffect(() => {
        if (!screenSharing) setSharePopover(null);
    }, [screenSharing]);

    const soundboardRoom = useRune(() => {
        void roomsState.roomsTick;
        return voiceCallState.roomId ? getRoom(voiceCallState.roomId) : null;
    });

    const [statsOpen, setStatsOpen] = useState(false);

    if (!roomId) return null;
    return (
        <>
            <View className="px-2 py-2 border-t border-discord-divider bg-discord-backgroundSecondary">
                {playbackBlocked && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void resumeVoicePlayback()}
                        className="w-full mb-1.5 px-2 py-1.5 rounded bg-discord-warning"
                    >
                        <Text className="text-center text-black text-xs font-semibold">
                            {t("voiceCallPanel.enableAudio")}
                        </Text>
                    </Pressable>
                )}
                <View className="flex-row items-start gap-1">
                    {/* Zami: `title` has no React Native equivalent. The status line is
                        a row of texts, so the inline badge can sit in it; `block` and
                        `text-start` are already how a column lays out. */}
                    <Pressable
                        accessibilityRole="button"
                        className="flex-1 min-w-0"
                        onPress={openCallView}
                    >
                        <View className="flex-row flex-wrap items-center">
                            <Text
                                className={`text-xs font-semibold ${
                                    connState === "connected"
                                        ? "text-discord-accent"
                                        : "text-discord-warning"
                                }`}
                            >
                                {connStateLabel(connState)}
                            </Text>
                            {!!roomId && (
                                <CallEncryptionBadge roomId={roomId} inline />
                            )}
                            {!!elapsed && (
                                <Text className="ms-1 text-xs font-normal text-discord-textMuted">
                                    {elapsed}
                                </Text>
                            )}
                        </View>
                        <Text
                            numberOfLines={1}
                            className="text-xs text-discord-textMuted truncate"
                        >
                            {locationLabel}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => setStatsOpen(true)}
                        className="p-1 rounded hover:bg-discord-messageHover flex-shrink-0"
                        accessibilityLabel={t("voiceCallPanel.connectionStats")}
                    >
                        <Signal size={16} className="text-discord-textMuted" />
                    </Pressable>
                </View>
                {/* The full call view (video grid, screen shares) used to open only
                    from the status text above, which nobody found. */}
                {!callViewShowing && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={openCallView}
                        className="mt-1.5 w-full flex-row items-center justify-center gap-1.5 px-2 py-1 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover"
                    >
                        <Maximize2
                            size={14}
                            className="text-discord-textPrimary"
                        />
                        <Text className="text-xs font-medium text-discord-textPrimary">
                            {videoTiles.some((t) => !t.isLocal)
                                ? t("voiceCallPanel.openCallWithVideo", {
                                      n: videoTiles.filter((t) => !t.isLocal)
                                          .length,
                                  })
                                : t("voiceCallPanel.openCall")}
                        </Text>
                    </Pressable>
                )}
                {screenSharing && (
                    <View className="mt-1.5 flex-row items-center gap-1 px-2 py-1 rounded bg-discord-accent/15">
                        <MonitorUp
                            size={14}
                            className="text-discord-accent flex-shrink-0"
                        />
                        <Text
                            numberOfLines={1}
                            className="flex-1 min-w-0 truncate text-xs text-discord-textPrimary"
                        >
                            {t("voiceCallPanel.sharingYourScreen")}
                        </Text>
                        <Pressable
                            ref={shareQualityButton}
                            accessibilityRole="button"
                            onPress={openShareQuality}
                            className="p-0.5 rounded"
                            accessibilityLabel={t(
                                "voiceCallPanel.shareQuality",
                            )}
                        >
                            <Settings2
                                size={14}
                                className="text-discord-textMuted"
                            />
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void toggleScreenShare()}
                            className="px-1.5 py-0.5 rounded bg-discord-danger hover:bg-discord-dangerHover"
                        >
                            <Text className="text-xs text-white font-medium">
                                {t("voiceCallPanel.stop")}
                            </Text>
                        </Pressable>
                    </View>
                )}
                {/* Own row, not beside the status text: five 32px controls plus gaps
                    leave ~60px of a 240px sidebar, which truncates "Connected" to an
                    ellipsis. Discord splits the same way. */}
                <View className="mt-1.5 flex-row items-center gap-1">
                    <Pressable
                        accessibilityRole="button"
                        onPress={toggleCallMute}
                        className="p-1.5 rounded hover:bg-discord-messageHover"
                        accessibilityLabel={
                            micMuted
                                ? t("voiceCallPanel.unmute")
                                : t("common.mute")
                        }
                    >
                        {micMuted ? (
                            <MicOff size={20} className="text-discord-danger" />
                        ) : (
                            <Mic size={20} className="text-discord-textMuted" />
                        )}
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={toggleCallDeafen}
                        className="p-1.5 rounded hover:bg-discord-messageHover"
                        accessibilityLabel={
                            deafened
                                ? t("voiceCallPanel.undeafen")
                                : t("voiceCallPanel.deafen")
                        }
                    >
                        {deafened ? (
                            <HeadphoneOff
                                size={20}
                                className="text-discord-danger"
                            />
                        ) : (
                            <Headphones
                                size={20}
                                className="text-discord-textMuted"
                            />
                        )}
                    </Pressable>
                    {!cameraDisabled && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void toggleCamera()}
                            className="p-1.5 rounded hover:bg-discord-messageHover"
                            accessibilityLabel={
                                cameraOn
                                    ? t("common.turnOffCamera")
                                    : t("common.turnOnCamera")
                            }
                        >
                            {cameraOn ? (
                                <Video
                                    size={20}
                                    className="text-discord-accent"
                                />
                            ) : (
                                <VideoOff
                                    size={20}
                                    className="text-discord-textMuted"
                                />
                            )}
                        </Pressable>
                    )}
                    {screenShareSupported && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void toggleScreenShare()}
                            className="p-1.5 rounded hover:bg-discord-messageHover"
                            accessibilityLabel={
                                screenSharing
                                    ? t("common.stopSharing")
                                    : t("common.shareYourScreen")
                            }
                        >
                            <MonitorUp
                                size={20}
                                className={
                                    screenSharing
                                        ? "text-discord-accent"
                                        : "text-discord-textMuted"
                                }
                            />
                        </Pressable>
                    )}
                    {soundboardRoom && (
                        <SoundboardButton
                            room={soundboardRoom}
                            buttonClass="p-1.5 rounded hover:bg-discord-messageHover"
                            idleClass="text-discord-textMuted hover:text-discord-textPrimary"
                        />
                    )}
                    <Pressable
                        accessibilityRole="button"
                        onPress={leaveCall}
                        className="ms-auto p-1.5 rounded hover:bg-discord-messageHover"
                        accessibilityLabel={t("voiceCallPanel.disconnect")}
                    >
                        <PhoneOff size={20} className="text-discord-danger" />
                    </Pressable>
                </View>
            </View>
            {sharePopover && (
                <ScreenShareQualityPopover
                    x={sharePopover.x}
                    y={sharePopover.y}
                    touch={touch}
                    onClose={() => setSharePopover(null)}
                />
            )}
            {statsOpen && (
                <CallStatsPanel onClose={() => setStatsOpen(false)} />
            )}
        </>
    );
}
