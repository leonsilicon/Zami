import { useStableCallback } from "@-/com.leonsilicon.zami.incremental/react";
import { anchorElement, DomMount, SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useDeepRune, useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as Haptics from "expo-haptics";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
    Pressable,
    ScrollView,
    Text,
    View,
    type GestureResponderEvent,
} from "react-native";
import Animated, {
    Easing,
    Keyframe,
    LayoutAnimationConfig,
    LinearTransition,
} from "react-native-reanimated";
import type { Room } from "matrix-js-sdk";
import {
    MessageSquare,
    Mic,
    MicOff,
    Headphones,
    HeadphoneOff,
    PhoneOff,
    Phone,
    Volume2,
    VolumeX,
    Video,
    VideoOff,
    MonitorUp,
    EllipsisVertical,
    Smartphone,
    Settings,
    Ear,
    Bluetooth,
} from "lucide-svelte";
import { t } from "$lib/i18n";
import Avatar from "$lib/components/ui/Avatar.svelte";
import CallParticipantMenu from "$lib/components/layout/CallParticipantMenu.svelte";
import ScreenShareQualityPopover from "$lib/components/layout/ScreenShareQualityPopover.svelte";
import SoundboardButton from "$lib/components/layout/SoundboardButton.svelte";
import { pluginMount } from "$lib/plugins/pluginMount";
import {
    callControlItems,
    callPanelItems,
    callTileDecorationItems,
} from "$lib/plugins/pluginCall.svelte";
import CallEncryptionBadge from "$lib/components/layout/CallEncryptionBadge.svelte";
import UserProfileCard from "$lib/components/ui/UserProfileCard.svelte";
import VideoTile from "$lib/components/layout/VideoTile.svelte";
import { deviceCountByUser, callTileStatus } from "$lib/utils/callTileStatus";
import {
    getRoomCallMemberships,
    getRoomDisplayName,
    getMemberName,
    getMemberAvatar,
    resumeVoicePlayback,
    getDirectRoomIds,
} from "$lib/matrix/client";
import {
    voiceCallState,
    joinCall,
    leaveCall,
    toggleCallMute,
    toggleCallDeafen,
    toggleCamera,
    toggleScreenShare,
    focusTile,
    clearFocus,
    participantAudioFor,
    toggleSpeaker,
    resumeHeldCall,
} from "$lib/stores/voiceCall.svelte";
import {
    dedupeParticipants,
    callControlMode,
    isRecentlyLeftHere,
} from "$lib/utils/voiceCall";
import { screenShareSupportedHere } from "$lib/utils/videoTiles";
import {
    showChatView,
    openModal,
    clearModalIfOwner,
    interfaceState,
} from "$lib/stores/interface.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import { motionOK } from "$lib/utils/motionPreference";
import type { VideoTileDescriptor } from "$lib/utils/videoTiles";

// Subtle join/leave motion for call tiles. Durations collapse to 0 when the
// user (or their OS) asks for reduced motion — same gate ErrorToasts uses.
// flip repositions the surviving tiles; scale gives the entering/leaving
// tile a soft grow/shrink + fade. Kept short and understated (Discord-like),
// never flashy. Read live at directive-eval time so a mid-session preference
// change is honoured for free.
// Zami: `animate:flip` → a reanimated layout transition, and `scale` (with
// `start: 0.85, opacity: 0`, cubicOut) → keyframes; a 0 duration is none.
// The builders are made once, so a re-render (someone starts speaking)
// hands the tiles the same ones and doesn't reconfigure their animations.
const TILE_FLIP_MS = 200;
const TILE_IN_MS = 180;
const TILE_OUT_MS = 140;
const TILE_FLIP = LinearTransition.duration(TILE_FLIP_MS);
const TILE_IN = new Keyframe({
    0: { opacity: 0, transform: [{ scale: 0.85 }] },
    100: {
        opacity: 1,
        transform: [{ scale: 1 }],
        easing: Easing.out(Easing.cubic),
    },
}).duration(TILE_IN_MS);
const TILE_OUT = new Keyframe({
    0: { opacity: 1, transform: [{ scale: 1 }] },
    100: {
        opacity: 0,
        transform: [{ scale: 0.85 }],
        easing: Easing.in(Easing.cubic),
    },
}).duration(TILE_OUT_MS);
const tileFlip = () => (motionOK() ? TILE_FLIP : undefined);
const tileIn = () => (motionOK() ? TILE_IN : undefined);
const tileOut = () => (motionOK() ? TILE_OUT : undefined);

interface Props {
    room: Room;
    isMobile?: boolean;
    onMenuOpen?: () => void;
}

// A tile's primary action lives on its wrapper <div> (click, contextmenu,
// long-press). The keyboard/AT affordance is a real, empty <button>
// stretched over the tile — a real button so Enter *and* Space activate it
// natively (Space on a focused button never scrolls the page) and so we add
// no keydown handler that could shadow the window-level Escape that clears
// the spotlight.
//
// `pointer-events-none` is load-bearing, not decoration: VideoTile renders
// its own Fullscreen <button> at bottom-right (and a <video>), so an overlay
// that took part in hit-testing would sit on top of it and silently swallow
// fullscreen, click-to-spotlight, right-click and long-press. Keeping it out
// of hit-testing leaves every pointer gesture byte-identical to before;
// keyboard and assistive-tech activation dispatch the click straight at the
// button, which needs no hit-test. The ring is white (never the accent —
// that colour already means "speaking/spotlighted" on these tiles) over a
// 40% scrim so it still reads 3:1 against an all-white shared screen.
// Zami: the overlay is a screen-reader element that takes no touches
// (`pointerEvents="none"`), activated through `onAccessibilityTap`
// (VoiceOver's double-tap); the wrapper is `accessible={false}` so the
// overlay, the menu button and VideoTile's buttons stay reachable inside it.
// There's no keyboard focus, so no focus ring.
const TILE_OVERLAY_BTN = "absolute inset-0 z-10";
// The per-participant menu trigger: always visible (never hover-gated, or a
// keyboard user could never reach it) and never gated on pointer type — a
// visible affordance beats a long-press gesture nobody can discover. It
// passes `interfaceState.isTouchscreen` as the menu's `touch` flag, not a
// hardcoded false: the same device must not get a positioned popover (with
// an <input type="range"> in it) from a tap on this button and a BottomSheet
// from a long-press on the tile behind it. No
// aria-haspopup: CallParticipantMenu renders a focus-trapped <div> of
// buttons (a BottomSheet on touch) with neither role="menu" nor
// role="dialog", and a popup role we cannot honour is worse than none.
// Zami: the icon inside is `text-white` itself (colors don't inherit).
const TILE_MENU_BTN =
    "absolute z-20 rounded bg-black/60 opacity-70 hover:opacity-100 transition-opacity";

/** `auto-fit` columns of at least `min` px sharing `width`, as CSS grid lays
 *  out `repeat(auto-fit, minmax(min, 1fr))`: empty tracks collapse, so fewer
 *  tiles than columns stretch to fill the row. */
function autoFitColumns(
    width: number,
    min: number,
    gap: number,
    count: number,
): number {
    const fit = Math.max(1, Math.floor((width + gap) / (min + gap)));
    return Math.max(1, Math.min(fit, count));
}

export default function CallView({
    room,
    isMobile = false,
    onMenuOpen,
}: Props) {
    // Capture support is fixed for the session (no runtime change), so a plain
    // const is enough — used to hide the share-screen button where unsupported.
    // Zami: false on iOS (screenShareSupportedHere): a share needs a Broadcast
    // Upload Extension the app doesn't have, so the button stays hidden.
    const screenShareSupported = screenShareSupportedHere();

    // Live SDK objects mutate in place, so every read of call/room state hangs
    // off a tick: voiceTick for the roster, roomsTick for names and avatars.
    // Pre-dedupe roster: dedupeParticipants collapses a user's devices to one
    // tile; deviceCountByUser reads the raw list so we can badge multi-device.
    const rawCallMemberships = useRune(() => {
        void voiceCallState.voiceTick;
        return getRoomCallMemberships(room);
    }, [room]);
    const participants = useMemo(
        () => dedupeParticipants(rawCallMemberships),
        [rawCallMemberships],
    );
    const deviceCounts = useMemo(
        () => deviceCountByUser(rawCallMemberships),
        [rawCallMemberships],
    );
    const inThisCall = useRune(
        () => voiceCallState.roomId === room.roomId,
        [room],
    );
    const controlMode = useRune(
        () =>
            callControlMode({
                inThisCall,
                participantUserIds: participants.map((p) => p.userId),
                selfUserId: auth.userId,
                recentlyLeftHere: isRecentlyLeftHere(
                    voiceCallState.lastLeftCall,
                    room.roomId,
                    Date.now(),
                ),
            }),
        [inThisCall, participants, room],
    );
    // Zami: speaking and muted are read per tile (ParticipantTile, below).

    // Video tiles for THIS call. `voiceCallState.videoTiles` is global — it
    // holds the tiles of whichever call we are connected to, whatever room that
    // is — so every read is gated on `inThisCall`. Without that, viewing another
    // room's call surface mid-call renders the connected room's cameras and
    // screenshares under this room's header (and the screenTiles term below
    // suppresses this room's "No one is in this call"). Reachable before by
    // peeking at a call mid-call; routine now that clicking a video room lands
    // here. Split so a camera can replace a participant's avatar while their
    // screenshare gets its own tile. Gated on voiceTick like every other
    // live-object read.
    const cameraByIdentity = useRune(() => {
        void voiceCallState.voiceTick;
        return new Map(
            inThisCall
                ? voiceCallState.videoTiles
                      .filter((t) => t.source === "camera")
                      .map((t): [string, VideoTileDescriptor] => [
                          t.identity,
                          t,
                      ])
                : [],
        );
    }, [inThisCall]);
    const screenTiles = useRune(() => {
        void voiceCallState.voiceTick;
        return inThisCall
            ? voiceCallState.videoTiles.filter(
                  (t) => t.source === "screenshare",
              )
            : [];
    }, [inThisCall]);
    const focusedTile = useRune(() => {
        void voiceCallState.voiceTick;
        return (
            (inThisCall
                ? voiceCallState.videoTiles.find(
                      (t) => t.key === voiceCallState.focusedTileKey,
                  )
                : undefined) ?? null
        );
    }, [inThisCall]);

    // Zami: the rune reads the markup below makes.
    const selfUserId = useRune(() => auth.userId);
    const focusedTileKey = useRune(() => voiceCallState.focusedTileKey);
    const micMuted = useRune(() => voiceCallState.micMuted);
    const deafened = useRune(() => voiceCallState.deafened);
    const playbackBlocked = useRune(() => voiceCallState.playbackBlocked);
    const onHold = useRune(() => voiceCallState.onHold);
    const audioRoute = useRune(() => voiceCallState.audioRoute);
    const availableAudioRoutes = useDeepRune(
        () => voiceCallState.availableAudioRoutes,
    );
    const cameraOn = useRune(() => voiceCallState.cameraOn);
    const screenSharing = useRune(() => voiceCallState.screenSharing);
    const joinPendingRoomId = useRune(() => voiceCallState.joinPendingRoomId);
    const mirrorCamera = useRune(() => settingsState.mirrorCamera);
    const cameraDisabled = useRune(() => settingsState.cameraDisabled);
    const isTouchscreen = useRune(() => interfaceState.isTouchscreen);
    const pluginPanels = useRune(() => callPanelItems(room.roomId), [room]);
    const pluginControls = useRune(() => callControlItems(room.roomId), [room]);
    // Zami: participantAudioFor() is read per tile (ParticipantTile, below).
    // Names and avatars hang off roomsTick: the participants' are read per
    // tile; the screen shares' and spotlight's labels here re-render only
    // when one of their names changes.
    useRune(() => {
        void roomsState.roomsTick;
        return [...screenTiles, ...(focusedTile ? [focusedTile] : [])]
            .map((tile) =>
                getMemberName(
                    room,
                    tile.identity.slice(0, tile.identity.lastIndexOf(":")),
                ),
            )
            .join("\u0000");
    }, [room, screenTiles, focusedTile]);

    function tileLabel(
        identity: string,
        source: "camera" | "screenshare",
    ): string {
        const userId = identity.slice(0, identity.lastIndexOf(":"));
        const name =
            userId === selfUserId
                ? t("callView.you")
                : getMemberName(room, userId);
        return source === "screenshare"
            ? t("callView.sScreen", { name })
            : name;
    }
    function isLocalIdentity(identity: string): boolean {
        return identity.slice(0, identity.lastIndexOf(":")) === selfUserId;
    }

    // focusTile() is a toggle, so the label has to say which way it goes.
    function spotlightLabel(key: string, label: string): string {
        return focusedTileKey === key
            ? t("callView.exitSpotlightFor", { label })
            : t("callView.spotlight", { label });
    }

    // Spotlighting and un-spotlighting both flip `{#if focusedTile}`, which
    // tears down the entire tile subtree — including whichever overlay button
    // was just activated. Focus would fall back to <body>, dumping a keyboard
    // user at the top of the document and making them Tab through the whole
    // sidebar to get back into the call. Land them on the tiles container
    // instead: `tabindex="-1"` keeps it out of the tab order (it is a landing
    // spot, not a stop) while still accepting focus, and Tab from there
    // continues into the freshly rendered tiles.
    //
    // Both paths funnel through here so the five call sites cannot drift.
    // Only the overlay buttons call these: the wrapper <div>s own the pointer
    // (the overlays are `pointer-events-none`), so a mouse click never takes
    // this path and never moves focus.
    // Zami: there's no keyboard focus to land; VoiceOver moves its cursor to
    // the new tiles itself when the element it was on goes away.
    function spotlightTile(key: string): void {
        focusTile(key);
    }
    function backToGrid(): void {
        clearFocus();
    }

    // Zami: not ported: the window's Escape key. VoiceOver's escape gesture
    // on the tiles clears the spotlight instead (onAccessibilityEscape below).
    function onEscape(): void {
        if (voiceCallState.focusedTileKey) clearFocus();
    }

    const roomName = useRune(() => {
        void roomsState.roomsTick;
        return getRoomDisplayName(room);
    }, [room]);
    const joining = joinPendingRoomId === room.roomId;
    // roomsTick, not voiceTick: m.direct is account data that lands on a sync,
    // and the roster is frozen for the whole ring — see the tick split above
    // and ActiveCallBanner.svelte.
    const isDm = useRune(() => {
        void roomsState.roomsTick;
        return getDirectRoomIds().has(room.roomId);
    }, [room]);
    // A DM call with nobody else in it yet: we are ringing them. Derived, not
    // stored — it stays until they join or we hang up, because a decline is
    // invisible to the caller without MSC4310. The `=== auth.userId` check
    // keeps "Ringing…" off the screen of a peer whose own membership has not
    // propagated yet.
    const ringingOut =
        inThisCall &&
        participants.length === 1 &&
        participants[0].userId === selfUserId &&
        isDm;

    const [participantMenu, setParticipantMenu] = useState<{
        userId: string;
        x: number;
        y: number;
        touch: boolean;
    } | null>(null);
    // Plain let: read only from event handlers, never from markup or an effect.
    const participantMenuToken = useRef(0);

    // Release the shared modal slot if this row is destroyed while still
    // owning it (e.g. the room changes under an open picker) — otherwise the
    // slot strands and swallows the next Escape.
    useEffect(
        () => () => {
            clearModalIfOwner(participantMenuToken.current);
        },
        [],
    );

    // Sharing starts straight away: the picker asks what to share, and the
    // quality is changed live (the gear on your share tile). A quality step
    // before the picker was a second dialog in a row for every share.
    const [sharePopover, setSharePopover] = useState<{
        x: number;
        y: number;
    } | null>(null);
    function onShareBtnClick(): void {
        void toggleScreenShare();
    }
    // Zami: a press doesn't bubble to the tile's Pressable, so there's no
    // stopPropagation; the gear's measured box stands in for
    // getBoundingClientRect().
    function openLiveQuality(e: GestureResponderEvent): void {
        const target = e.currentTarget;
        void anchorElement(typeof target === "number" ? null : target).then(
            (el) => {
                const r = el.getBoundingClientRect();
                setSharePopover({ x: r.left, y: r.top });
            },
        );
    }

    // The browser's own "Stop sharing" control ends the share without touching
    // our popover, so it would strand open. Close it when the share goes away.
    // untrack() keeps the effect's only dependency the screenSharing flag —
    // writing sharePopover here never retriggers it.
    // Zami: the dependency list does what untrack() does.
    useEffect(() => {
        if (screenSharing) return;
        setSharePopover(null);
    }, [screenSharing]);

    function openParticipantMenu(
        userId: string,
        x: number,
        y: number,
        touch: boolean,
    ) {
        participantMenuToken.current = openModal("call-participant-menu", () =>
            setParticipantMenu(null),
        );
        setParticipantMenu({ userId, x, y, touch });
    }

    // Zami: the `longPress` action (500 ms, a 50 ms vibrate) → the tile's long
    // press, at the touch's window position. Not ported: right-click
    // (`oncontextmenu`), which a touchscreen doesn't have.
    function onTileLongPress(userId: string) {
        return (e: GestureResponderEvent) => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            openParticipantMenu(
                userId,
                e.nativeEvent.pageX,
                e.nativeEvent.pageY,
                true,
            );
        };
    }
    // Zami: the menu button's measured box stands in for
    // getBoundingClientRect(), and a press doesn't bubble to the tile, so
    // there's no stopPropagation.
    function onTileMenuPress(userId: string) {
        return (e: GestureResponderEvent) => {
            const target = e.currentTarget;
            void anchorElement(typeof target === "number" ? null : target).then(
                (el) => {
                    const r = el.getBoundingClientRect();
                    openParticipantMenu(
                        userId,
                        r.right,
                        r.bottom,
                        interfaceState.isTouchscreen,
                    );
                },
            );
        };
    }

    // Zami: `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))` with
    // `gap-3` → widths from the grid's measured width.
    const [gridWidth, setGridWidth] = useState(0);
    const gridCount = screenTiles.length + participants.length;
    const gridColumns = autoFitColumns(gridWidth, 220, 12, gridCount);
    // Zami: the same object while the width holds, for the memoized tiles.
    const gridCellStyle = useMemo(
        () =>
            gridWidth
                ? {
                      // Floored, so rounding never pushes the last column to wrap.
                      width: Math.floor(
                          (gridWidth - 12 * (gridColumns - 1)) / gridColumns,
                      ),
                  }
                : { width: "100%" as const },
        [gridWidth, gridColumns],
    );
    // Zami: the tiles' actions, the same functions across renders.
    const tileLongPress = useStableCallback(onTileLongPress);
    const tileMenuPress = useStableCallback(onTileMenuPress);
    const spotlightTileStable = useStableCallback(spotlightTile);

    return (
        <>
            {/* Zami: not ported: `data-zam-region="call"` (plugins' DOM
                region hook; there's no DOM here). */}
            <View className="flex-1 flex-col min-w-0 bg-discord-backgroundTertiary">
                {/* Header */}
                <View className="h-12 px-4 flex-row items-center gap-2 flex-shrink-0 border-b border-discord-divider bg-discord-background">
                    {isMobile && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={onMenuOpen}
                            className="p-1.5 -ms-1 rounded hover:bg-discord-messageHover transition-colors flex-shrink-0"
                            accessibilityLabel={t("common.openRoomList")}
                        >
                            <SvgIcon
                                className="w-5 h-5 text-discord-textMuted"
                                d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"
                            />
                        </Pressable>
                    )}
                    <Volume2
                        size={20}
                        className="text-discord-textMuted flex-shrink-0"
                    />
                    <Text
                        accessibilityRole="header"
                        numberOfLines={1}
                        className="flex-shrink font-semibold text-discord-textPrimary truncate"
                    >
                        {roomName}
                    </Text>
                    {inThisCall && (
                        <CallEncryptionBadge
                            roomId={room.roomId}
                            showLabel={!isMobile}
                        />
                    )}
                    {ringingOut && (
                        <Text className="text-sm text-discord-textMuted flex-shrink-0">
                            {t("callView.ringing")}
                        </Text>
                    )}
                    <View className="flex-1" />
                    <Pressable
                        accessibilityRole="button"
                        onPress={showChatView}
                        className="p-1.5 rounded transition-colors hover:bg-discord-messageHover"
                        accessibilityLabel={t("callView.showChat")}
                    >
                        <MessageSquare
                            size={20}
                            className="text-discord-textMuted"
                        />
                    </Pressable>
                </View>

                {/* Tiles */}
                {/* `tabindex="-1"`, not "0": this is the focus landing spot for a
                    spotlight toggle that unmounts the button doing the toggling (see
                    keepFocusInTiles above), NOT a new tab stop — it adds nothing to the
                    tab order and traps nothing. */}
                <View
                    onAccessibilityEscape={onEscape}
                    className="flex-1 min-h-0 p-4 flex-col gap-3"
                >
                    {participants.length === 0 && screenTiles.length === 0 ? (
                        <View className="flex-1 flex-col items-center justify-center gap-3">
                            <Volume2
                                size={40}
                                className="text-discord-textMuted"
                            />
                            <Text className="text-sm text-discord-textMuted">
                                {t("callView.noOneIsInThisCall")}
                            </Text>
                        </View>
                    ) : focusedTile ? (
                        <>
                            {/* Spotlight: the focused stream fills the view */}
                            {/* The wrapper keeps click-anywhere-to-go-back for the pointer, so
                                both ignores below stay live; the keyboard path is the overlay
                                button (and Escape, handled on <svelte:window> above). */}
                            {/* Zami: `title` has no React Native equivalent. */}
                            <Pressable
                                accessible={false}
                                className="relative flex-1 min-h-0 rounded-lg overflow-hidden"
                                onPress={clearFocus}
                                delayLongPress={500}
                                onLongPress={onTileLongPress(
                                    focusedTile.userId,
                                )}
                            >
                                <VideoTile
                                    tile={focusedTile}
                                    label={tileLabel(
                                        focusedTile.identity,
                                        focusedTile.source,
                                    )}
                                    mirror={
                                        focusedTile.source === "camera" &&
                                        isLocalIdentity(focusedTile.identity) &&
                                        mirrorCamera
                                    }
                                />
                                <View
                                    accessible
                                    accessibilityRole="button"
                                    pointerEvents="none"
                                    className={TILE_OVERLAY_BTN}
                                    accessibilityLabel={t(
                                        "callView.backToGrid",
                                    )}
                                    onAccessibilityTap={backToGrid}
                                />
                            </Pressable>
                            {/* Filmstrip: everyone else, small, along the bottom */}
                            {/* Zami: tiles animate only as they join and leave, not
                                when the filmstrip appears or goes (Svelte's
                                transitions are local). */}
                            <LayoutAnimationConfig skipEntering skipExiting>
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    className="flex-shrink-0 flex-grow-0"
                                    contentContainerClassName="flex-grow flex-row gap-2 justify-center py-1"
                                >
                                    {screenTiles.map((tile) => (
                                        <Animated.View
                                            key={tile.key}
                                            layout={tileFlip()}
                                            entering={tileIn()}
                                            exiting={tileOut()}
                                            className={`relative h-20 aspect-video flex-shrink-0 rounded-md overflow-hidden bg-black border-2 ${
                                                tile.key === focusedTileKey
                                                    ? "border-discord-accent"
                                                    : "border-transparent"
                                            }`}
                                        >
                                            {/* Zami: `title` has no React Native
                                                equivalent. */}
                                            <Pressable
                                                accessible={false}
                                                className="w-full h-full"
                                                onPress={() =>
                                                    focusTile(tile.key)
                                                }
                                                delayLongPress={500}
                                                onLongPress={onTileLongPress(
                                                    tile.userId,
                                                )}
                                            >
                                                <VideoTile
                                                    tile={tile}
                                                    label={tileLabel(
                                                        tile.identity,
                                                        tile.source,
                                                    )}
                                                    compact
                                                />
                                                {isLocalIdentity(
                                                    tile.identity,
                                                ) && (
                                                    <Pressable
                                                        accessibilityRole="button"
                                                        className={`${TILE_MENU_BTN} top-0.5 start-0.5 p-1`}
                                                        accessibilityLabel={t(
                                                            "callView.screenShareQuality",
                                                        )}
                                                        onPress={
                                                            openLiveQuality
                                                        }
                                                    >
                                                        <Settings
                                                            size={14}
                                                            className="text-white"
                                                        />
                                                    </Pressable>
                                                )}
                                                <View
                                                    accessible
                                                    accessibilityRole="button"
                                                    pointerEvents="none"
                                                    className={TILE_OVERLAY_BTN}
                                                    accessibilityLabel={spotlightLabel(
                                                        tile.key,
                                                        tileLabel(
                                                            tile.identity,
                                                            tile.source,
                                                        ),
                                                    )}
                                                    onAccessibilityTap={() =>
                                                        spotlightTile(tile.key)
                                                    }
                                                />
                                            </Pressable>
                                        </Animated.View>
                                    ))}
                                    {/* Zami: each tile its own memoized component
                                        (ParticipantTile, below), reading its own
                                        name, avatar, speaking and mute state, so
                                        someone starting to speak re-renders their
                                        tile, not the call. */}
                                    {participants.map((p) => (
                                        <ParticipantTile
                                            key={p.userId}
                                            variant="filmstrip"
                                            room={room}
                                            userId={p.userId}
                                            deviceId={p.deviceId}
                                            cam={cameraByIdentity.get(
                                                `${p.userId}:${p.deviceId}`,
                                            )}
                                            focusedTileKey={focusedTileKey}
                                            selfUserId={selfUserId}
                                            mirrorCamera={mirrorCamera}
                                            micMuted={micMuted}
                                            deafened={deafened}
                                            deviceCount={
                                                deviceCounts.get(p.userId) ?? 1
                                            }
                                            gridCellStyle={gridCellStyle}
                                            onTileLongPress={tileLongPress}
                                            onTileMenuPress={tileMenuPress}
                                            spotlightTile={spotlightTileStable}
                                        />
                                    ))}
                                </ScrollView>
                            </LayoutAnimationConfig>
                        </>
                    ) : (
                        <LayoutAnimationConfig skipEntering skipExiting>
                            <ScrollView
                                onLayout={(e) =>
                                    setGridWidth(e.nativeEvent.layout.width)
                                }
                                contentContainerClassName="flex-row flex-wrap gap-3"
                            >
                                {screenTiles.map((tile) => (
                                    <Animated.View
                                        key={tile.key}
                                        layout={tileFlip()}
                                        entering={tileIn()}
                                        exiting={tileOut()}
                                        style={gridCellStyle}
                                        className={`relative aspect-video rounded-lg overflow-hidden bg-black border-2 ${
                                            tile.key === focusedTileKey
                                                ? "border-discord-accent"
                                                : "border-transparent"
                                        }`}
                                    >
                                        <Pressable
                                            accessible={false}
                                            className="w-full h-full"
                                            onPress={() => focusTile(tile.key)}
                                            delayLongPress={500}
                                            onLongPress={onTileLongPress(
                                                tile.userId,
                                            )}
                                        >
                                            <VideoTile
                                                tile={tile}
                                                label={tileLabel(
                                                    tile.identity,
                                                    tile.source,
                                                )}
                                            />
                                            {isLocalIdentity(tile.identity) && (
                                                <Pressable
                                                    accessibilityRole="button"
                                                    className={`${TILE_MENU_BTN} top-0.5 start-0.5 p-1`}
                                                    accessibilityLabel={t(
                                                        "callView.screenShareQuality",
                                                    )}
                                                    onPress={openLiveQuality}
                                                >
                                                    <Settings
                                                        size={14}
                                                        className="text-white"
                                                    />
                                                </Pressable>
                                            )}
                                            <View
                                                accessible
                                                accessibilityRole="button"
                                                pointerEvents="none"
                                                className={TILE_OVERLAY_BTN}
                                                accessibilityLabel={spotlightLabel(
                                                    tile.key,
                                                    tileLabel(
                                                        tile.identity,
                                                        tile.source,
                                                    ),
                                                )}
                                                onAccessibilityTap={() =>
                                                    spotlightTile(tile.key)
                                                }
                                            />
                                        </Pressable>
                                    </Animated.View>
                                ))}

                                {participants.map((p) => (
                                    <ParticipantTile
                                        key={p.userId}
                                        variant="grid"
                                        room={room}
                                        userId={p.userId}
                                        deviceId={p.deviceId}
                                        cam={cameraByIdentity.get(
                                            `${p.userId}:${p.deviceId}`,
                                        )}
                                        focusedTileKey={focusedTileKey}
                                        selfUserId={selfUserId}
                                        mirrorCamera={mirrorCamera}
                                        micMuted={micMuted}
                                        deafened={deafened}
                                        deviceCount={
                                            deviceCounts.get(p.userId) ?? 1
                                        }
                                        gridCellStyle={gridCellStyle}
                                        onTileLongPress={tileLongPress}
                                        onTileMenuPress={tileMenuPress}
                                        spotlightTile={spotlightTileStable}
                                    />
                                ))}
                            </ScrollView>
                        </LayoutAnimationConfig>
                    )}
                </View>

                {/* Plugin panels (open ones only; each scrolls within its own cap) */}
                {/* Zami: the plugin builds DOM into the element (pluginMount),
                    which DomView shows. */}
                {pluginPanels.map((panel) => (
                    <ScrollView
                        key={panel.key}
                        className="flex-shrink-0 grow-0 border-t border-discord-divider bg-discord-background max-h-[60%]"
                        accessibilityLabel={panel.title}
                        keyboardShouldPersistTaps="handled"
                    >
                        <DomMount
                            document={document}
                            className="w-full"
                            mount={(el) =>
                                pluginMount(el, panel.render).destroy
                            }
                        />
                    </ScrollView>
                ))}

                {/* Controls */}
                <View className="flex-shrink-0 p-4 flex-col items-center gap-2">
                    {playbackBlocked && inThisCall && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void resumeVoicePlayback()}
                            className="px-3 py-1.5 rounded bg-discord-warning"
                        >
                            <Text className="text-black text-xs font-semibold">
                                {t("callView.enableAudio")}
                            </Text>
                        </Pressable>
                    )}
                    {onHold && inThisCall && (
                        <View className="flex-row items-center gap-2 px-3 py-1.5 rounded bg-discord-backgroundSecondary">
                            <Text className="text-xs text-discord-textMuted">
                                {t("callView.onHold")}
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                onPress={resumeHeldCall}
                                className="px-2 py-0.5 rounded bg-discord-accent"
                            >
                                <Text className="text-xs text-white font-semibold">
                                    {t("callView.resume")}
                                </Text>
                            </Pressable>
                        </View>
                    )}
                    {controlMode === "controls" ? (
                        <View className="flex-row items-center gap-2 px-2 py-2 rounded-full bg-discord-backgroundSecondary">
                            <Pressable
                                accessibilityRole="button"
                                onPress={toggleCallMute}
                                className="p-3 rounded-full hover:bg-discord-messageHover"
                                accessibilityLabel={
                                    micMuted
                                        ? t("callView.unmute")
                                        : t("common.mute")
                                }
                            >
                                {micMuted ? (
                                    <MicOff
                                        size={20}
                                        className="text-discord-danger"
                                    />
                                ) : (
                                    <Mic
                                        size={20}
                                        className="text-discord-textPrimary"
                                    />
                                )}
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                onPress={toggleCallDeafen}
                                className="p-3 rounded-full hover:bg-discord-messageHover"
                                accessibilityLabel={
                                    deafened
                                        ? t("callView.undeafen")
                                        : t("callView.deafen")
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
                                        className="text-discord-textPrimary"
                                    />
                                )}
                            </Pressable>
                            {!!audioRoute &&
                                availableAudioRoutes.includes("speaker") && (
                                    // Android: speaker vs. the private route (earpiece or
                                    // headset), through the system call stack.
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={toggleSpeaker}
                                        className="p-3 rounded-full hover:bg-discord-messageHover"
                                        accessibilityLabel={
                                            audioRoute === "speaker"
                                                ? t("callView.speakerOff")
                                                : t("callView.speakerOn")
                                        }
                                        // Zami: `aria-pressed` → selected.
                                        accessibilityState={{
                                            selected: audioRoute === "speaker",
                                        }}
                                    >
                                        {audioRoute === "speaker" ? (
                                            <Volume2
                                                size={20}
                                                className="text-discord-accent"
                                            />
                                        ) : audioRoute === "bluetooth" ? (
                                            <Bluetooth
                                                size={20}
                                                className="text-discord-textPrimary"
                                            />
                                        ) : audioRoute === "wired" ? (
                                            <Headphones
                                                size={20}
                                                className="text-discord-textPrimary"
                                            />
                                        ) : (
                                            <Ear
                                                size={20}
                                                className="text-discord-textPrimary"
                                            />
                                        )}
                                    </Pressable>
                                )}
                            {!cameraDisabled && (
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => void toggleCamera()}
                                    className="p-3 rounded-full hover:bg-discord-messageHover"
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
                                            className="text-discord-textPrimary"
                                        />
                                    )}
                                </Pressable>
                            )}
                            {screenShareSupported && (
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={onShareBtnClick}
                                    className="p-3 rounded-full hover:bg-discord-messageHover"
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
                                                : "text-discord-textPrimary"
                                        }
                                    />
                                </Pressable>
                            )}
                            <SoundboardButton
                                room={room}
                                buttonClass="p-3 rounded-full hover:bg-discord-messageHover"
                                idleClass="text-discord-textPrimary"
                            />
                            {pluginControls.map((c) => (
                                // Zami: `e.currentTarget`, the anchor a plugin
                                // places its popover by, as anchorElement
                                // measures the button.
                                <Pressable
                                    key={c.key}
                                    accessibilityRole="button"
                                    onPress={(e) => {
                                        const target = e.currentTarget;
                                        void anchorElement(
                                            typeof target === "number"
                                                ? null
                                                : target,
                                        ).then((anchor) => c.click(anchor));
                                    }}
                                    className="p-3 rounded-full hover:bg-discord-messageHover"
                                    accessibilityLabel={c.label}
                                >
                                    {c.icon ? (
                                        <SvgIcon
                                            className={`w-5 h-5 ${
                                                c.active
                                                    ? "text-discord-accent"
                                                    : "text-discord-textPrimary"
                                            }`}
                                            d={c.icon}
                                        />
                                    ) : (
                                        <View
                                            accessible={false}
                                            className="w-5 h-5 flex-row items-center justify-center"
                                        >
                                            <Text
                                                className={`text-sm font-semibold leading-none ${
                                                    c.active
                                                        ? "text-discord-accent"
                                                        : "text-discord-textPrimary"
                                                }`}
                                            >
                                                {c.label.slice(0, 1)}
                                            </Text>
                                        </View>
                                    )}
                                </Pressable>
                            ))}
                            <Pressable
                                accessibilityRole="button"
                                onPress={leaveCall}
                                className="p-3 rounded-full bg-discord-danger hover:bg-discord-dangerHover transition-colors"
                                accessibilityLabel={t("callView.disconnect")}
                            >
                                <PhoneOff size={20} className="text-white" />
                            </Pressable>
                        </View>
                    ) : controlMode === "join" ? (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void joinCall(room.roomId)}
                            disabled={joinPendingRoomId !== null}
                            accessibilityState={{
                                disabled: joinPendingRoomId !== null,
                            }}
                            className={`flex-row items-center gap-2 px-6 py-2.5 rounded-full bg-discord-accent hover:bg-discord-accentHover transition-colors ${
                                joinPendingRoomId !== null ? "opacity-60" : ""
                            }`}
                        >
                            <Phone size={20} className="text-white" />
                            <Text className="text-white font-medium">
                                {joining
                                    ? t("common.joining")
                                    : t("callView.joinCall")}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>

            {/* CallParticipantMenu brings its own Portal + backdrop — don't wrap it. */}
            {participantMenu && (
                <CallParticipantMenu
                    room={room}
                    userId={participantMenu.userId}
                    x={participantMenu.x}
                    y={participantMenu.y}
                    touch={participantMenu.touch}
                    onClose={() => {
                        setParticipantMenu(null);
                        clearModalIfOwner(participantMenuToken.current);
                    }}
                />
            )}
            {sharePopover && (
                <ScreenShareQualityPopover
                    x={sharePopover.x}
                    y={sharePopover.y}
                    touch={isTouchscreen}
                    onClose={() => setSharePopover(null)}
                />
            )}

            {/* The profile card lives in MessageArea too, but AppShell renders CallView
                INSTEAD of MessageArea during a call (mutually exclusive), so without this
                mount the "Profile" entry in a call-tile menu opens a card nothing renders.
                Only one of the two is ever mounted, so there is never a double instance. */}
            <UserProfileCard room={room} />
        </>
    );
}

interface ParticipantTileProps {
    variant: "filmstrip" | "grid";
    room: Room;
    userId: string;
    deviceId: string;
    cam: VideoTileDescriptor | undefined;
    focusedTileKey: string | null;
    selfUserId: string | null;
    mirrorCamera: boolean;
    micMuted: boolean;
    deafened: boolean;
    deviceCount: number;
    gridCellStyle: { width: number | "100%" };
    onTileLongPress: (userId: string) => (e: GestureResponderEvent) => void;
    onTileMenuPress: (userId: string) => (e: GestureResponderEvent) => void;
    spotlightTile: (key: string) => void;
}

// Zami: a participant's tile, in the filmstrip under a spotlight or in the
// grid: upstream's two `{#each participants}` bodies. Memoized, and it reads
// the runes only it shows (its name, avatar, speaking and mute state), so a
// change re-renders this tile rather than the whole call view.
const ParticipantTile = memo(function ParticipantTile({
    variant,
    room,
    userId,
    deviceId,
    cam,
    focusedTileKey,
    selfUserId,
    mirrorCamera,
    micMuted,
    deafened,
    deviceCount,
    gridCellStyle,
    onTileLongPress,
    onTileMenuPress,
    spotlightTile,
}: ParticipantTileProps) {
    const p = { userId, deviceId };
    const identity = `${p.userId}:${p.deviceId}`;
    const name = useRune(() => {
        void roomsState.roomsTick;
        return getMemberName(room, p.userId);
    }, [room, userId]);
    const avatar = useRune(() => {
        void roomsState.roomsTick;
        return getMemberAvatar(room, p.userId);
    }, [room, userId]);
    const isSpeaking = useRune(
        () => voiceCallState.speakingUserIds.has(p.userId),
        [userId],
    );
    // Contract: a user absent from this set is unmuted, never "unknown".
    const isMuted = useRune(
        () => voiceCallState.mutedUserIds.has(p.userId),
        [userId],
    );
    const locallyMuted = useRune(
        () => participantAudioFor(p.userId).muted,
        [userId],
    );
    const tileDecorations = useRune(
        () => callTileDecorationItems(room.roomId, p.userId),
        [room, userId],
    );
    // Zami: the plugin builds DOM into the element (pluginMount), which
    // DomView shows; `pointer-events-none` → pointerEvents="none".
    const decorations = tileDecorations.map((d) => (
        <View key={d.key} pointerEvents="none" className="absolute inset-0">
            <DomMount
                document={document}
                mount={(el) => pluginMount(el, d.render).destroy}
            />
        </View>
    ));

    function isLocalIdentity(identity: string): boolean {
        return identity.slice(0, identity.lastIndexOf(":")) === selfUserId;
    }

    // focusTile() is a toggle, so the label has to say which way it goes.
    function spotlightLabel(key: string, label: string): string {
        return focusedTileKey === key
            ? t("callView.exitSpotlightFor", { label })
            : t("callView.spotlight", { label });
    }

    // Zami: the `sr-only` texts of a tile's status icons, as the label of the
    // row they sit in.
    function statusLabel(
        status: ReturnType<typeof callTileStatus>,
        _userId: string,
    ): string {
        return [
            status.micOff && t("callView.muted"),
            status.deafened && t("callView.deafened"),
            status.locallyMuted && t("callView.mutedForYou"),
            status.multiDevice &&
                t("callView.devices", {
                    value: deviceCount,
                }),
        ]
            .filter(Boolean)
            .join(", ");
    }

    if (variant === "filmstrip")
        return (
            <Animated.View
                layout={tileFlip()}
                entering={tileIn()}
                exiting={tileOut()}
                className={`relative h-20 aspect-video flex-shrink-0 rounded-md overflow-hidden bg-discord-backgroundSecondary border-2 ${
                    isSpeaking || (cam && cam.key === focusedTileKey)
                        ? "border-discord-accent"
                        : "border-transparent"
                }`}
            >
                {/* Zami: `title` has no React
                        Native equivalent. */}
                <Pressable
                    accessible={false}
                    className="w-full h-full flex-row items-center justify-center"
                    onPress={cam ? () => focusTile(cam.key) : undefined}
                    delayLongPress={500}
                    onLongPress={onTileLongPress(p.userId)}
                >
                    {cam ? (
                        <>
                            <VideoTile
                                tile={cam}
                                label={name}
                                compact
                                mirror={
                                    isLocalIdentity(identity) && mirrorCamera
                                }
                            />
                            <View
                                accessible
                                accessibilityRole="button"
                                pointerEvents="none"
                                className={TILE_OVERLAY_BTN}
                                accessibilityLabel={spotlightLabel(
                                    cam.key,
                                    name,
                                )}
                                onAccessibilityTap={() =>
                                    spotlightTile(cam.key)
                                }
                            />
                        </>
                    ) : (
                        <Avatar
                            src={avatar}
                            name={name}
                            id={p.userId}
                            size={36}
                        />
                    )}
                    <Pressable
                        accessibilityRole="button"
                        className={`${TILE_MENU_BTN} top-0.5 end-0.5 p-1`}
                        accessibilityLabel={t("callView.optionsFor", { name })}
                        onPress={onTileMenuPress(p.userId)}
                    >
                        <EllipsisVertical size={14} className="text-white" />
                    </Pressable>
                    {decorations}
                </Pressable>
            </Animated.View>
        );

    const status = callTileStatus({
        isOwn: isLocalIdentity(identity),
        remoteMuted: isMuted,
        speaking: isSpeaking,
        locallyMuted: locallyMuted,
        selfMicMuted: micMuted,
        selfDeafened: deafened,
        deviceCount: deviceCount,
    });
    const statusIcons = (
        <>
            {status.micOff && (
                <MicOff
                    size={14}
                    className="text-discord-danger flex-shrink-0"
                />
            )}
            {status.deafened && (
                <HeadphoneOff
                    size={14}
                    className="text-discord-danger flex-shrink-0"
                />
            )}
            {status.locallyMuted && (
                <VolumeX
                    size={14}
                    className="text-discord-textMuted flex-shrink-0"
                />
            )}
            {status.multiDevice && (
                // Zami: `title` has no React
                // Native equivalent.
                <View className="flex-row items-center gap-0.5 flex-shrink-0">
                    <Smartphone size={12} className="text-white" />
                    <Text className="text-[10px] leading-none text-white">
                        {deviceCount}
                    </Text>
                </View>
            )}
        </>
    );
    return (
        <Animated.View
            layout={tileFlip()}
            entering={tileIn()}
            exiting={tileOut()}
            style={gridCellStyle}
            className={`relative aspect-video rounded-lg overflow-hidden bg-discord-backgroundSecondary border-2 ${
                isSpeaking || (cam && cam.key === focusedTileKey)
                    ? "border-discord-accent"
                    : "border-transparent"
            }`}
        >
            <Pressable
                accessible={false}
                className="w-full h-full flex-row items-center justify-center"
                onPress={cam ? () => focusTile(cam.key) : undefined}
                delayLongPress={500}
                onLongPress={onTileLongPress(p.userId)}
            >
                {cam ? (
                    <>
                        <VideoTile
                            tile={cam}
                            label={name}
                            mirror={isLocalIdentity(identity) && mirrorCamera}
                        />
                        <View
                            accessible
                            accessibilityRole="button"
                            pointerEvents="none"
                            className={TILE_OVERLAY_BTN}
                            accessibilityLabel={spotlightLabel(cam.key, name)}
                            onAccessibilityTap={() => spotlightTile(cam.key)}
                        />
                        {(status.micOff ||
                            status.deafened ||
                            status.locallyMuted ||
                            status.multiDevice) && (
                            <View
                                accessible
                                accessibilityLabel={statusLabel(
                                    status,
                                    p.userId,
                                )}
                                className="absolute top-2 start-2 flex-row items-center gap-1 px-1.5 py-0.5 rounded bg-black/60"
                            >
                                {statusIcons}
                            </View>
                        )}
                    </>
                ) : (
                    <>
                        <Avatar
                            src={avatar}
                            name={name}
                            id={p.userId}
                            size={80}
                        />
                        {/* Zami: `max-w-[calc(100%-1rem)]`
                                → the end inset. */}
                        <View
                            pointerEvents="box-none"
                            className="absolute bottom-2 start-2 end-2 flex-row"
                        >
                            <View
                                accessible
                                accessibilityLabel={[
                                    statusLabel(status, p.userId),
                                    name,
                                ]
                                    .filter(Boolean)
                                    .join(", ")}
                                className="flex-shrink flex-row items-center gap-1.5 px-2 py-0.5 rounded bg-black/60"
                            >
                                {statusIcons}
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-xs text-white truncate"
                                >
                                    {name}
                                </Text>
                            </View>
                        </View>
                    </>
                )}
                <Pressable
                    accessibilityRole="button"
                    className={`${TILE_MENU_BTN} top-2 end-2 p-1.5`}
                    accessibilityLabel={t("callView.optionsFor", { name })}
                    onPress={onTileMenuPress(p.userId)}
                >
                    <EllipsisVertical size={16} className="text-white" />
                </Pressable>
                {decorations}
            </Pressable>
        </Animated.View>
    );
});
