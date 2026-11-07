import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import type { Track } from "livekit-client";
import { PictureInPicture2, X } from "lucide-svelte";
import { useEffect, useRef, useState } from "react";
import {
    Pressable,
    Text,
    View,
    useWindowDimensions,
    type GestureResponderEvent,
} from "react-native";
import Animated, { Easing, Keyframe } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "$lib/i18n";
import VideoTile from "$lib/components/layout/VideoTile.svelte";
import { getMemberName, getRoom } from "$lib/matrix/client";
import {
    voiceCallState,
    isCallViewShowing,
    leaveCall,
    toggleCallMute,
    toggleCamera,
} from "$lib/stores/voiceCall.svelte";
import {
    callPipState,
    pipWindowSupported,
    openPipWindow,
    showPipTrack,
    closePipWindow,
    bindPipCallActions,
    reportPipCallState,
    setPipPlacement,
} from "$lib/stores/callPip.svelte";
import { interfaceState, showCallView } from "$lib/stores/interface.svelte";
import { navigateToRoom, roomsState } from "$lib/stores/rooms.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { motionOK } from "$lib/utils/motionPreference";
import {
    pickPipTile,
    snapPipToEdge,
    type VideoTileDescriptor,
} from "$lib/utils/videoTiles";

const DRAG_THRESHOLD_PX = 5;
const EDGE_GAP_PX = 8;
// How far a resting video keeps from the window's sides: clear of the room
// header above and the composer below.
const REST_SIDE_REM = 1;
const REST_TOP_REM = 3.5;
const REST_BOTTOM_REM = 5.5;
// Zami: the root font size `getComputedStyle(document.documentElement)` reads;
// Uniwind's rem is 16px.
const REM_PX = 16;

// Svelte's `scale` transition with `start: 0.85, opacity: 0` (cubicOut), in and
// out.
function scaleIn(duration: number) {
    return new Keyframe({
        0: { opacity: 0, transform: [{ scale: 0.85 }] },
        100: {
            opacity: 1,
            transform: [{ scale: 1 }],
            easing: Easing.out(Easing.cubic),
        },
    }).duration(duration);
}
function scaleOut(duration: number) {
    return new Keyframe({
        0: { opacity: 1, transform: [{ scale: 1 }] },
        100: {
            opacity: 0,
            transform: [{ scale: 0.85 }],
            easing: Easing.in(Easing.cubic),
        },
    }).duration(duration);
}

export default function CallPipOverlay() {
    const insets = useSafeAreaInsets();
    const viewport = useWindowDimensions();

    const windowSupported = pipWindowSupported();

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

    const visible = useRune(
        () =>
            tile !== null &&
            !isCallViewShowing() &&
            !callPipState.windowOpen &&
            !callPipState.dismissed,
        [tile],
    );

    const label = useRune(() => {
        void roomsState.roomsTick;
        if (!tile) return "";
        const room = voiceCallState.roomId && getRoom(voiceCallState.roomId);
        const name =
            tile.userId === auth.userId
                ? t("callView.you")
                : room
                  ? getMemberName(room, tile.userId)
                  : tile.userId;
        return tile.source === "screenshare"
            ? t("callView.sScreen", { name })
            : name;
    }, [tile]);

    const windowOpen = useRune(() => callPipState.windowOpen);
    const cameraDisabled = useRune(() => settingsState.cameraDisabled);
    const micMuted = useRune(() => voiceCallState.micMuted);
    const cameraOn = useRune(() => voiceCallState.cameraOn);
    const mirrorCamera = useRune(() => settingsState.mirrorCamera);

    // The system window follows the same pick, and ends with the last stream.
    // Zami: `pipWindowSupported()` is false here (there's no DOM
    // picture-in-picture), so the window never opens and these stay idle.
    useEffect(() => {
        if (!windowOpen) return;
        if (tile) showPipTrack(tile.track as Track);
        else closePipWindow();
    }, [windowOpen, tile]);
    useEffect(() => {
        if (!windowOpen) return;
        return bindPipCallActions({
            toggleMic: toggleCallMute,
            toggleCamera: cameraDisabled ? null : () => void toggleCamera(),
            hangUp: leaveCall,
        });
    }, [windowOpen, cameraDisabled]);
    useEffect(() => {
        if (!windowOpen) return;
        reportPipCallState(!micMuted, cameraOn);
    }, [windowOpen, micMuted, cameraOn]);

    function openCall(): void {
        const roomId = voiceCallState.roomId;
        if (!roomId) return;
        navigateToRoom(roomId);
        showCallView(roomId);
    }

    // Physical sides: the panels are pinned left-to-right in every language,
    // and this spot is picked by dragging, not by reading direction. In CSS
    // rather than measured so it follows window resizes and the safe areas.
    // Zami: computed from the window size and the safe-area insets, which
    // re-render on resize, in place of CSS calc(). `max-w-[calc(100vw-2rem)]`
    // caps the width, and `aspect-video` sets the height from it.
    const widthRem = useRune(() => (interfaceState.isMobile ? 11 : 18));
    const width = Math.min(widthRem * REM_PX, viewport.width - 2 * REM_PX);
    const height = (width * 9) / 16;
    const placement = useRune(() => callPipState.placement);
    const restStyle = (() => {
        const { side, at } = placement;
        const minLeft = REST_SIDE_REM * REM_PX;
        const maxLeft = viewport.width - (widthRem + REST_SIDE_REM) * REM_PX;
        const minTop = REST_TOP_REM * REM_PX + insets.top;
        const maxTop =
            viewport.height -
            ((widthRem * 9) / 16 + REST_BOTTOM_REM) * REM_PX -
            insets.bottom;
        const along = (min: number, max: number) => min + (max - min) * at;
        const left =
            side === "left"
                ? minLeft
                : side === "right"
                  ? maxLeft
                  : along(minLeft, maxLeft);
        const top =
            side === "top"
                ? minTop
                : side === "bottom"
                  ? maxTop
                  : along(minTop, maxTop);
        return { left, top };
    })();

    // A press on the video is a click until it moves; then it's a drag, and
    // letting go settles against the nearest side.
    // Zami: pointer events → the responder system. The wrapper's box is the
    // one it's drawn at (`getBoundingClientRect()`), and the latest drag
    // position is also kept in a ref for the release.
    const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(
        null,
    );
    const dragPosRef = useRef<{ x: number; y: number } | null>(null);
    const press = useRef<{
        x: number;
        y: number;
        left: number;
        top: number;
        width: number;
        height: number;
    } | null>(null);
    const dragged = useRef(false);

    function onPointerDown(e: GestureResponderEvent): void {
        const r = dragPos
            ? { left: dragPos.x, top: dragPos.y }
            : { left: restStyle.left, top: restStyle.top };
        press.current = {
            x: e.nativeEvent.pageX,
            y: e.nativeEvent.pageY,
            left: r.left,
            top: r.top,
            width,
            height,
        };
        dragged.current = false;
    }
    function onPointerMove(e: GestureResponderEvent): void {
        const p = press.current;
        if (!p) return;
        const dx = e.nativeEvent.pageX - p.x;
        const dy = e.nativeEvent.pageY - p.y;
        if (!dragged.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragged.current = true;
        const maxX = viewport.width - p.width - EDGE_GAP_PX;
        const maxY = viewport.height - p.height - EDGE_GAP_PX;
        const next = {
            x: Math.min(Math.max(p.left + dx, EDGE_GAP_PX), maxX),
            y: Math.min(Math.max(p.top + dy, EDGE_GAP_PX), maxY),
        };
        dragPosRef.current = next;
        setDragPos(next);
    }
    function onPointerUp(): void {
        const p = press.current;
        const pos = dragPosRef.current;
        if (p && pos) {
            const rem = REM_PX;
            setPipPlacement(
                snapPipToEdge(pos.x, pos.y, {
                    minX: REST_SIDE_REM * rem,
                    maxX: viewport.width - p.width - REST_SIDE_REM * rem,
                    minY: REST_TOP_REM * rem,
                    maxY: viewport.height - p.height - REST_BOTTOM_REM * rem,
                }),
            );
        }
        press.current = null;
        dragPosRef.current = null;
        setDragPos(null);
    }
    function onClick(): void {
        if (!dragged.current) openCall();
        dragged.current = false;
    }

    const OVERLAY_CONTROL =
        "p-1.5 rounded bg-black/60 opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

    const duration = motionOK() ? 140 : 0;

    // Zami: `fixed` → a Portal at the app root. The Portal stays mounted so
    // the overlay's exit transition can run when it hides.
    return (
        <Portal>
            {visible && tile && (
                // The wrapper owns the pointer (click to open, drag to move); the
                // keyboard path is the stretched button, as on CallView's tiles.
                // Zami: `transition-[left,top]` is a Reanimated CSS transition on
                // the Animated.View.
                <Animated.View
                    className={`absolute z-40 aspect-video rounded-lg overflow-hidden bg-black shadow-2xl border border-discord-divider touch-none select-none ${
                        dragPos ? "cursor-grabbing" : "cursor-pointer"
                    } ${
                        !dragPos && motionOK()
                            ? "transition-[left,top] duration-150 ease-out"
                            : ""
                    }`}
                    style={{
                        width,
                        height,
                        ...(dragPos
                            ? { left: dragPos.x, top: dragPos.y }
                            : restStyle),
                    }}
                    onStartShouldSetResponder={() => true}
                    onMoveShouldSetResponder={() => true}
                    onResponderTerminationRequest={() => false}
                    onResponderGrant={onPointerDown}
                    onResponderMove={onPointerMove}
                    onResponderRelease={() => {
                        onPointerUp();
                        onClick();
                    }}
                    onResponderTerminate={() => {
                        onPointerUp();
                        dragged.current = false;
                    }}
                    testID="call-pip"
                    entering={duration ? scaleIn(duration) : undefined}
                    exiting={duration ? scaleOut(duration) : undefined}
                >
                    <VideoTile
                        tile={tile}
                        label={label}
                        compact
                        mirror={
                            tile.source === "camera" &&
                            tile.isLocal &&
                            mirrorCamera
                        }
                    />
                    {/* Zami: `pointer-events-none` keeps touches on the wrapper;
                        VoiceOver still finds and activates it. */}
                    <Pressable
                        accessibilityRole="button"
                        pointerEvents="none"
                        className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white focus-visible:bg-black/40"
                        accessibilityLabel={t("voiceCallPanel.openCallView")}
                        onPress={openCall}
                    />
                    {/* Zami: `max-w-[calc(100%-0.75rem)]` → the end inset. */}
                    <View
                        pointerEvents="none"
                        className="absolute bottom-1.5 start-1.5 end-1.5 flex-row"
                    >
                        <View className="flex-shrink px-1.5 py-0.5 rounded bg-black/60">
                            <Text
                                numberOfLines={1}
                                className="text-xs text-white truncate"
                            >
                                {label}
                            </Text>
                        </View>
                    </View>
                    {/* Zami: a press on a control is that control's alone (the
                        responder goes to the innermost Pressable), as the
                        stopPropagation calls make it. */}
                    <View className="absolute top-1.5 end-1.5 z-20 flex-row gap-1">
                        {windowSupported && (
                            <Pressable
                                accessibilityRole="button"
                                className={OVERLAY_CONTROL}
                                accessibilityLabel={t(
                                    "videoTile.pictureInPicture",
                                )}
                                onPress={() => {
                                    void openPipWindow(
                                        null,
                                        tile.track as Track,
                                    );
                                }}
                            >
                                <PictureInPicture2
                                    size={14}
                                    className="text-white"
                                />
                            </Pressable>
                        )}
                        <Pressable
                            accessibilityRole="button"
                            className={OVERLAY_CONTROL}
                            accessibilityLabel={t(
                                "callParticipantMenu.hideVideo",
                            )}
                            onPress={() => {
                                callPipState.dismissed = true;
                            }}
                        >
                            <X size={14} className="text-white" />
                        </Pressable>
                    </View>
                </Animated.View>
            )}
        </Portal>
    );
}
