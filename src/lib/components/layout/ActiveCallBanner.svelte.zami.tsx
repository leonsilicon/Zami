import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import {
    Phone,
    PhoneOff,
    Video,
    VideoOff,
    MonitorUp,
    Maximize2,
} from "lucide-svelte";
import type { Room } from "matrix-js-sdk";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import Avatar from "$lib/components/ui/Avatar.svelte";
import SoundboardButton from "./SoundboardButton.svelte";
import {
    getRoomCallMemberships,
    getMemberName,
    getMemberAvatar,
    getDirectRoomIds,
} from "$lib/matrix/client";
import {
    voiceCallState,
    joinCall,
    leaveCall,
    toggleCamera,
    toggleScreenShare,
} from "$lib/stores/voiceCall.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import {
    dedupeParticipants,
    callBannerDecision,
    isRecentlyLeftHere,
} from "$lib/utils/voiceCall";
import { screenShareSupportedHere } from "$lib/utils/videoTiles";
import { auth } from "$lib/stores/auth.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { showCallView } from "$lib/stores/interface.svelte";

interface Props {
    room: Room;
}

// Zami: `title` (a hover tooltip) has no React Native equivalent: the icon-only
// buttons carry it as their label.
export default function ActiveCallBanner({ room }: Props) {
    // Fixed for the session, same as CallView and VoiceCallPanel.
    const [screenShareSupported] = useState(screenShareSupportedHere);

    const participants = useRune(() => {
        void voiceCallState.voiceTick;
        return dedupeParticipants(getRoomCallMemberships(room));
    }, [room]);
    const inThisCall = useRune(
        () => voiceCallState.roomId === room.roomId,
        [room],
    );
    const speaking = useRune(() => voiceCallState.speakingUserIds);
    // m.direct is account data: it lands on a sync, never on a matrixRTC
    // session event, so this hangs off roomsTick (onRoomUpdate bumps it on
    // every sync) and NOT voiceTick — see CallView.svelte:44. Ringing is
    // precisely the state in which the roster is frozen, so a voiceTick-gated
    // read would never re-run: a late m.direct would strand "1 in call" for
    // the whole ring. Same reasoning as IncomingCallCard.svelte:20.
    const isDm = useRune(() => {
        void roomsState.roomsTick;
        return getDirectRoomIds().has(room.roomId);
    }, [room]);
    const selfUserId = useRune(() => auth.userId);
    const lastLeftCall = useRune(() => voiceCallState.lastLeftCall);
    const cameraDisabled = useRune(() => settingsState.cameraDisabled);
    const cameraOn = useRune(() => voiceCallState.cameraOn);
    const screenSharing = useRune(() => voiceCallState.screenSharing);
    const joinPendingRoomId = useRune(() => voiceCallState.joinPendingRoomId);
    // A DM call with nobody else in it yet: we are ringing them. Derived, not
    // stored — and it stays until they join or we hang up, because a decline
    // is invisible to the caller without MSC4310. The `=== auth.userId` check
    // is load-bearing: during join our own membership may not have propagated,
    // so a bare length===1 could mean "only THEY are here" and would show
    // "Ringing…" to the wrong side.
    const ringingOut =
        inThisCall &&
        participants.length === 1 &&
        participants[0].userId === selfUserId &&
        isDm;
    // Show + Leave/Join decision. Visibility requires a NON-self participant
    // when we are not in the call, so leaving a call we were alone in never
    // flashes a "Join" banner during the beat between inThisCall flipping
    // false and our own stale membership leaving the roster.
    const decision = callBannerDecision({
        inThisCall,
        participantUserIds: participants.map((p) => p.userId),
        selfUserId,
        recentlyLeftHere: isRecentlyLeftHere(
            lastLeftCall,
            room.roomId,
            Date.now(),
        ),
    });

    if (!decision.visible) return null;
    const joining = joinPendingRoomId === room.roomId;
    return (
        <View className="flex-row items-center gap-3 px-4 py-2 bg-discord-backgroundSecondary border-b border-discord-divider">
            {/* Body opens the call view (peek without joining); Leave/Join stays
                a separate action on the right. Same target as the roster rows and
                the VoiceCallPanel — the banner is rendered only for the active
                room, so showCallView alone suffices (no navigateToRoom). */}
            <Pressable
                accessibilityRole="button"
                accessibilityHint={t("activeCallBanner.openCall")}
                onPress={() => showCallView(room.roomId)}
                className="flex-row items-center gap-3 min-w-0 flex-1 overflow-hidden -mx-1 px-1 py-1 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
            >
                {/* Zami: `-space-x-1.5` → a negative start margin on every
                    avatar after the first. */}
                <View className="flex-row">
                    {participants.map((p, i) => (
                        <View
                            key={p.userId}
                            className={`rounded-full ring-2 ${
                                speaking.has(p.userId)
                                    ? "ring-discord-accent"
                                    : "ring-transparent"
                            } ${i > 0 ? "-ms-1.5" : ""}`}
                        >
                            <Avatar
                                src={getMemberAvatar(room, p.userId)}
                                name={getMemberName(room, p.userId)}
                                id={p.userId}
                                size={24}
                            />
                        </View>
                    ))}
                </View>
                <Text
                    numberOfLines={1}
                    className="shrink text-sm text-discord-textSecondary min-w-0"
                >
                    {ringingOut
                        ? t("activeCallBanner.ringing")
                        : t("activeCallBanner.voiceCallInCall", {
                              length: participants.length,
                          })}
                </Text>
            </Pressable>
            {decision.action === "leave" ? (
                <>
                    {/* Camera/share sit here as well as in CallView so a user who
                        stayed on the timeline never has to open the call view to
                        start video. Same store toggles, same support gate. */}
                    <View className="flex-row items-center gap-1 flex-shrink-0">
                        {!cameraDisabled && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={
                                    cameraOn
                                        ? t("common.turnOffCamera")
                                        : t("common.turnOnCamera")
                                }
                                onPress={() => void toggleCamera()}
                                className="p-1.5 rounded hover:bg-discord-messageHover active:bg-discord-messageHover"
                            >
                                {cameraOn ? (
                                    <Video
                                        size={16}
                                        className="text-discord-accent"
                                    />
                                ) : (
                                    <VideoOff
                                        size={16}
                                        className="text-discord-textMuted hover:text-discord-textPrimary"
                                    />
                                )}
                            </Pressable>
                        )}
                        {screenShareSupported && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={
                                    screenSharing
                                        ? t("common.stopSharing")
                                        : t("common.shareYourScreen")
                                }
                                onPress={() => void toggleScreenShare()}
                                className="p-1.5 rounded hover:bg-discord-messageHover active:bg-discord-messageHover"
                            >
                                <MonitorUp
                                    size={16}
                                    className={
                                        screenSharing
                                            ? "text-discord-accent"
                                            : "text-discord-textMuted hover:text-discord-textPrimary"
                                    }
                                />
                            </Pressable>
                        )}
                        <SoundboardButton
                            room={room}
                            size={16}
                            buttonClass="p-1.5 rounded hover:bg-discord-messageHover"
                            idleClass="text-discord-textMuted hover:text-discord-textPrimary"
                        />
                    </View>
                    {/* The body above opens the call too, but nothing said so: users
                        couldn't find the call view. */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("activeCallBanner.openCall")}
                        onPress={() => showCallView(room.roomId)}
                        className="flex-row items-center gap-1.5 px-2.5 py-1 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors flex-shrink-0"
                    >
                        <Maximize2
                            size={14}
                            className="text-discord-textPrimary"
                        />
                        <Text className="hidden sm:flex text-discord-textPrimary text-sm font-medium">
                            {t("activeCallBanner.open")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={leaveCall}
                        className="flex-row items-center gap-1.5 px-3 py-1 rounded bg-discord-danger hover:bg-discord-dangerHover active:bg-discord-dangerHover transition-colors flex-shrink-0"
                    >
                        <PhoneOff size={14} className="text-white" />
                        <Text className="text-white text-sm font-medium">
                            {t("activeCallBanner.leave")}
                        </Text>
                    </Pressable>
                </>
            ) : (
                <>
                    {/* The body above opens the call too, but nothing said so: users
                        couldn't find the call view. */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("activeCallBanner.openCall")}
                        onPress={() => showCallView(room.roomId)}
                        className="flex-row items-center gap-1.5 px-2.5 py-1 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors flex-shrink-0"
                    >
                        <Maximize2
                            size={14}
                            className="text-discord-textPrimary"
                        />
                        <Text className="hidden sm:flex text-discord-textPrimary text-sm font-medium">
                            {t("activeCallBanner.open")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void joinCall(room.roomId)}
                        disabled={joinPendingRoomId !== null}
                        accessibilityState={{
                            disabled: joinPendingRoomId !== null,
                        }}
                        className={`flex-row items-center gap-1.5 px-3 py-1 rounded bg-discord-accent hover:bg-discord-accentHover active:bg-discord-accentHover transition-colors ${
                            joinPendingRoomId !== null ? "opacity-60" : ""
                        }`}
                    >
                        <Phone size={14} className="text-white" />
                        <Text className="text-white text-sm font-medium">
                            {joining ? t("common.joining") : t("common.join")}
                        </Text>
                    </Pressable>
                </>
            )}
        </View>
    );
}
