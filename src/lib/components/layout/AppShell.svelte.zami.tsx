import { addCaptureKeyListener } from "@-/com.leonsilicon.zami.browser";
import { Portal, Spin } from "@-/com.leonsilicon.zami.rn";
import { markStartup } from "@-/com.leonsilicon.zami.startup";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { setBadgeCountAsync } from "expo-notifications";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    BackHandler,
    Keyboard,
    Pressable,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import {
    GestureDetector,
    useCompetingGestures,
    usePanGesture,
    useTapGesture,
    type PanGestureConfig,
} from "react-native-gesture-handler";
import Animated, {
    Easing,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { replaceState } from "$app/navigation";
import { page } from "$app/state";
import { localeInfo, t } from "$lib/i18n";
import { motionOK } from "$lib/utils/motionPreference";

import SpaceSidebar from "$lib/components/layout/SpaceSidebar.svelte";
import RoomList from "$lib/components/layout/RoomList.svelte";
import ProfileFooter from "$lib/components/layout/ProfileFooter.svelte";
import ReconnectPill from "$lib/components/layout/ReconnectPill.svelte";
import MessageArea from "$lib/components/layout/MessageArea.svelte";
import DraftDmView from "$lib/components/layout/DraftDmView.svelte";
import CallView from "$lib/components/layout/CallView.svelte";
import RoomSettings from "$lib/components/layout/RoomSettings.svelte";
import InviteModal from "$lib/components/layout/InviteModal.svelte";
import CreatePollDialog from "$lib/components/messages/CreatePollDialog.svelte";
import ShareLocationDialog from "$lib/components/messages/ShareLocationDialog.svelte";
import ShareTargetSheet from "$lib/components/messages/ShareTargetSheet.svelte";
import AppSettings from "$lib/components/layout/AppSettings.svelte";
import InboxPanel from "$lib/components/layout/InboxPanel.svelte";
import SpaceLandingPanel from "./SpaceLandingPanel.svelte";
import IncomingCallCard from "$lib/components/layout/IncomingCallCard.svelte";
import CallPipOverlay from "$lib/components/layout/CallPipOverlay.svelte";
import VerificationModal from "$lib/components/layout/VerificationModal.svelte";
import EncryptionSetupDialog from "$lib/components/layout/EncryptionSetupDialog.svelte";
import {
    onboardingState,
    openEncryptionSetup,
    takeFreshSignIn,
} from "$lib/stores/onboarding.svelte";
import WhatsNewModal from "$lib/components/layout/WhatsNewModal.svelte";
import VerificationRequestCard from "$lib/components/layout/VerificationRequestCard.svelte";
import ErrorToasts from "$lib/components/ui/ErrorToasts.svelte";
import ScreenSharePicker from "$lib/components/layout/ScreenSharePicker.svelte";
import JoinConsentDialog from "$lib/components/layout/JoinConsentDialog.svelte";
import PluginPopoverHost from "$lib/components/plugins/PluginPopoverHost.svelte";
import PluginOverlayHost from "$lib/components/plugins/PluginOverlayHost.svelte";
import QuickSwitcher from "$lib/components/layout/QuickSwitcher.svelte";
import QuickActions, {
    type QuickActionsHandle,
} from "$lib/components/layout/QuickActions.svelte";
import KeyboardShortcutsDialog from "$lib/components/keybinds/KeyboardShortcutsDialog.svelte";
import {
    handleHoldKey,
    handleKeybindDown,
    recordRoomVisit,
    releaseAllHolds,
    setKeybindHost,
} from "$lib/keybinds/runner";
import {
    connectGlobalHotkeys,
    holdsOutliveBlur,
    syncGlobalHotkeys,
} from "$lib/keybinds/desktopHotkeys.svelte";

import { auth, clearSession, loadStoredSession } from "$lib/stores/auth.svelte";
import {
    roomsState,
    setActiveSpace,
    navigateToRoom,
    bumpUnreadTick,
    reloadLastLocationFromStorage,
    resolvePendingSurface,
    resolveLandingSurface,
} from "$lib/stores/rooms.svelte";
import {
    interfaceState,
    openModal,
    closeModal,
    closeSidebar,
    closeSubPage,
    openAppSettingsTab,
} from "$lib/stores/interface.svelte";
import { inviteDialogState } from "$lib/stores/inviteDialog.svelte";
import { pollDialogState } from "$lib/stores/pollDialog.svelte";
import { locationDialogState } from "$lib/stores/locationDialog.svelte";
import { shareInboxState, receiveShare } from "$lib/stores/shareInbox.svelte";
import { consumeWebShareStash, base64ToFile } from "$lib/utils/webShareStash";
import {
    takeQuickReplyStashes,
    deleteQuickReplyStash,
} from "$lib/utils/notifReplyStash";
import { composerInsertText } from "$lib/utils/composerInsert";
import {
    savePendingRoute,
    takePendingRoute,
} from "$lib/utils/pendingNotificationRoute";
import { switchToAccount } from "$lib/stores/accountSwitch";
import { syncServiceWorkerAccounts } from "$lib/swAccounts";
import {
    startInactiveAccountNotifier,
    type AccountNotice,
} from "$lib/inactiveAccountNotifier";
import {
    getDraft,
    setDraft,
    deliverToLiveComposer,
} from "$lib/stores/composerDrafts.svelte";
import { composerThreadKey } from "$lib/utils/threadContent";
import { initFavourites } from "$lib/stores/favourites.svelte";
import { initCustomizationSync } from "$lib/stores/customizationSync.svelte";
import { initIgnoredUsers } from "$lib/stores/ignoredUsers.svelte";
import { initPresence } from "$lib/stores/presence.svelte";
import { initLiveLocation } from "$lib/stores/liveLocation.svelte";
import { initOutbox } from "$lib/stores/outbox.svelte";
import { initBackgroundRelease } from "$lib/backgroundRelease";
import { initHistoryTrim, noteOpenRoom } from "$lib/historyTrim";
import { initPlugins, emitPluginNotification } from "$lib/plugins/pluginBoot";
import { pluginRegistry } from "$lib/stores/plugins.svelte";
import { resolveShortcut, eventToChord } from "$lib/plugins/pluginShortcuts";
import {
    initVoiceCall,
    leaveCall,
    joinCall,
} from "$lib/stores/voiceCall.svelte";
import {
    incomingCallsState,
    initIncomingCalls,
    declineIncomingCall,
    silenceIncomingCall,
} from "$lib/stores/incomingCalls.svelte";
import {
    verificationState,
    initVerification,
} from "$lib/stores/verification.svelte";
import {
    reloadAccountSettings,
    setActiveSessionGraceMs,
    settingsState,
    getLastSeenVersion,
    setLastSeenVersion,
} from "$lib/stores/settings.svelte";
import {
    isDesktopUpdater,
    desktopSetAutoDownload,
    desktopBundleReady,
} from "$lib/desktopUpdater";
import { APP_VERSION } from "$lib/update";
import { webBundleReady, webBundleSetAuto } from "$lib/androidWebBundle";
import { isDesktopTray, setMinimizeToTray } from "$lib/desktopTray";
import { startRichPresence } from "$lib/stores/richPresence.svelte";
import { installDesktopSaveImage } from "$lib/desktopContextMenu";
import { watchVideoPlayback } from "$lib/utils/videoPlaybackWatch";
import { initUpdateWatch } from "$lib/stores/updateBanner.svelte";
import UpdateBanner from "$lib/components/layout/UpdateBanner.svelte";
import UpdateToastWatch from "$lib/components/layout/UpdateToastWatch.svelte";
import IdentityChangeBanner from "$lib/components/layout/IdentityChangeBanner.svelte";
import { checkRoomIdentities } from "$lib/matrix/crypto";
import {
    markNotification,
    clearReadNotifications,
    reloadNotificationsFromStorage,
    getNotificationCount,
} from "$lib/stores/notifications.svelte";
import {
    accountsState,
    updateAccountProfile,
} from "$lib/stores/accounts.svelte";
import {
    sessionHealthState,
    resetSyncStoreFallback,
} from "$lib/stores/sessionHealth.svelte";
import { showErrorToast, showToast } from "$lib/stores/toasts.svelte";
import {
    getRoomClassification,
    getRoomsInSpace,
    getSpaceLayout,
    getSpaceChildSignature,
    fetchSpaceHierarchy,
    scheduleJoinedRoomsReconcile,
    setSlidingSyncActiveRoom,
    getRoom,
    getLiveRoom,
    getRoomDisplayName,
    getMemberName,
    getDMPartnerId,
    logout,
    onRoomUpdate,
    onAccountData,
    onLocalEchoUpdated,
    onThreadNameChange,
    onThreadSummaryChange,
    clearReadThreadCounts,
    onTimelineEvent,
    onAnyReceiptEvent,
    getClient,
    getOwnUserId,
    isInitialSyncComplete,
    clearServiceWorkerAuth,
    fetchOwnProfile,
    mxcToHttp,
    onThreadReplyEvent,
    onDecryptedTimelineEvent,
    onMissedLiveEvent,
    isThreadParticipant,
    getEventThreadRootId,
    getOwnDeviceId,
    publishActiveSession,
    getActiveSessionHeartbeat,
    updateServiceWorkerNotificationPrivacy,
    updateServiceWorkerReceiptPrivacy,
    updateServiceWorkerRingEnabled,
    clearServiceWorkerNotifications,
    ensureCallNotifyPushRule,
    ensureThreadNamePushRule,
    sendNotificationQuickReply,
    resolveQuickReplyThreadRoot,
    markRoomAsRead,
    onReadReceiptConfirmed,
    startEventIndex,
    type ActiveSessionHeartbeat,
    noteChatsOnScreen,
} from "$lib/matrix/client";
import {
    shouldNotifyDecrypted,
    isAlreadyReadEvent,
    createBoundedIdSet,
} from "$lib/utils/notifyDecrypted";
import {
    ACTIVE_SESSION_KEY,
    IDLE_LIMIT_MS,
    heartbeatIntervalFor,
    isDeviceInUse,
    normalizeGraceMs,
    shouldSuppressForActiveDevice,
    shouldWriteHeartbeat,
} from "$lib/utils/activeSession";
import { sameOrder } from "$lib/utils/roomClassification";
import {
    HIERARCHY_TTL_MS,
    HIERARCHY_FAILURE_BACKOFF_MS,
    hierarchyKey,
    shouldFetchHierarchy,
    hierarchyResultAction,
} from "$lib/utils/hierarchyRefresh";
import { restoreAppWindow } from "$lib/utils/restoreWindow";
import {
    isUndecryptedEvent,
    previewForEvent,
} from "$lib/utils/encryptionState";
import { notificationBody } from "$lib/utils/notificationPrivacy";
import { playPing } from "$lib/audio/soundEffects";
import {
    type NativeNotificationHandle,
    flashTaskbar,
    setTrayUnread,
    shouldAlertDesktop,
    showNativeNotification,
} from "$lib/utils/desktopAlert";
import { shouldNotifyThreadEvent } from "$lib/utils/threadNotify";
import { isOffCanvasClosed } from "$lib/utils/drawerInert";
import { decideDrawerSnap, MAX_SNAP_MS } from "$lib/utils/drawerSnap";
import {
    notificationsToClose,
    appendPostedEventId,
    type PostedNotificationEntry,
} from "$lib/utils/notificationDismiss";
import { decideNotificationRoute } from "$lib/utils/notificationRouting";
import { parseDeepLinkHash } from "$lib/utils/deepLinkHash";
import { shouldShowWhatsNew } from "$lib/utils/changelog";
import {
    registerNotificationSurface,
    clearAllNotificationSurfaces,
} from "$lib/utils/notificationSurfaces";
import type { Room, MatrixEvent } from "matrix-js-sdk";
import {
    initPush,
    unregisterPush,
    clearDeliveredNativeNotifications,
} from "$lib/push";
import {
    initWebPush,
    readWebPushState,
    teardownWebPush,
    webPushDelivers,
    isIosHomeScreenApp,
} from "$lib/webPush";
import {
    syncNativeAccounts,
    syncNativeSession,
    clearNativeSession,
    syncNativeNotificationPrivacy,
    syncNativeRingEnabled,
    syncNativeReceiptPrivacy,
} from "$lib/nativeSession";
import { onNativeCallEvent } from "$lib/nativeCall";
import { startPushDecryptResponder } from "$lib/pushDecrypt";
import { Capacitor } from "@capacitor/core";

// Zami: Uniwind's rem, for the widths upstream gives in rem (React Native has
// no root font size, so there's no text scale to follow).
const REM_PX = 16;

// Zami: the drawer settle's `cubic-bezier(0.2, 0, 0, 1)`.
const SNAP_EASING = Easing.bezier(0.2, 0, 0, 1);

// Zami: how far a touch travels before the drawer drag decides, along either
// axis: upstream's 6 px, raised past the platforms' own scroll slop (about
// 10 pt for a UIScrollView, 8 dp on Android). A horizontal scroller under the
// finger (a code block, a table, the attachment strip, the call filmstrip)
// then claims the touch first and scrolls, which is what upstream's
// `targetCanScrollHoriz(dragTarget, rawDx)` check is for; anywhere else a
// mostly-horizontal drag engages the drawer, and a mostly-vertical one is left
// to the list under it.
const DRAG_ENGAGE_PX = 16;
// Zami: the far end of the pan's offset ranges, for "never".
const OFFSET_NEVER = 100_000;

// Zami: upstream's `backdropOpacity` derived, as a worklet: the backdrop's
// color reads it on the UI thread as the drawer is dragged, and its touches
// (`pointer-events`) read it from React.
function backdropOpacityOf(
    drawerTranslate: number,
    drawerWidth: number,
    isMobile: boolean,
): number {
    "worklet";
    return isMobile && drawerWidth > 0
        ? ((drawerTranslate + drawerWidth) / drawerWidth) * 0.5
        : 0;
}

// Zami: a number per Room object, for `activeRoom` below. useRune re-renders
// whenever its getter returns an object, and the active Room is the same
// object sync after sync: reading which object it is (a number) re-renders
// the shell only when it changes, as upstream's `$derived` only notifies then.
const roomObjectIds = new WeakMap<Room, number>();
let nextRoomObjectId = 0;
function roomObjectId(room: Room | null): number | null {
    if (!room) return null;
    let id = roomObjectIds.get(room);
    if (id === undefined) roomObjectIds.set(room, (id = ++nextRoomObjectId));
    return id;
}
function resolveActiveRoom(): Room | null {
    const id = roomsState.activeRoomId;
    if (!id) return null;
    // A cached stand-in opens too. When the app boots with no network the
    // saved room list is the only source, and its cached timeline is what
    // MessageArea shows (read-only) until sync delivers the live room.
    return getLiveRoom(id) ?? getRoom(id);
}

type RoomBucket =
    | "spaces"
    | "orphanRooms"
    | "directRooms"
    | "invitedRooms"
    | "knockedRooms"
    | "roomsInSpace";

// Zami: not ported: the document <title> (the unread count in the tab's
// title); an app has none. The app icon's badge shows the count instead (see
// the favicon effect below).
//
// Zami: a hardware keyboard's presses reach `window` through
// @-/com.leonsilicon.zami.browser, so the window's keydown handling below
// (onWindowKeydown, the push-to-talk holds) is upstream's. VoiceOver's escape
// gesture also dismisses the topmost layer, on the shell below.
// Zami: not ported: push to talk / push to mute on a mouse side button
// (`handleHoldMouse`; React Native reports no mouse buttons), and the
// room-list resize grip's arrow keys (VoiceOver's increment and decrement
// adjust it instead).
export default function AppShell() {
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    // Zami: the layout flags upstream's onMount sets from media queries (see
    // the layout effects further down, which follow their changes), set
    // before the shell first renders so it mounts the right layout once
    // rather than the desktop one first.
    const isMobileWindow = windowWidth < 768;
    useState(() => {
        interfaceState.isMobile = isMobileWindow;
        interfaceState.isTouchscreen = true;
    });

    const isAuthenticated = useRune(() => auth.isAuthenticated);
    const syncState = useRune(() => auth.syncState);
    const isMobile = useRune(() => interfaceState.isMobile);
    const leftOpen = useRune(() => interfaceState.leftOpen);
    const sidebar = useRune(() => interfaceState.sidebar);
    const lightboxOpen = useRune(() => interfaceState.lightboxOpen);
    const modal = useRune(() => interfaceState.modal);
    const callViewRoomId = useRune(() => interfaceState.callViewRoomId);
    const showInbox = useRune(() => roomsState.showInbox);
    const draftDm = useRune(() => roomsState.draftDm);
    const activeRoomId = useRune(() => roomsState.activeRoomId);
    const activeSpaceId = useRune(() => roomsState.activeSpaceId);
    const noSpaces = useRune(() => roomsState.spaces.length === 0);
    const inviteRoomId = useRune(() => inviteDialogState.roomId);
    const pollRoomId = useRune(() => pollDialogState.roomId);
    const locationRoomId = useRune(() => locationDialogState.roomId);
    const hasSharePayload = useRune(() => !!shareInboxState.payload);
    const ringing = useRune(() => incomingCallsState.ringing);
    const verificationIncoming = useRune(() => verificationState.incoming);
    const encryptionSetupOpen = useRune(
        () => onboardingState.encryptionSetupOpen,
    );

    // Room shown in the RoomSettings modal (covers both room and space settings).
    const [settingsRoom, setSettingsRoom] = useState<Room | null>(null);

    // One-time "What's New" popup on version change
    const [showWhatsNew, setShowWhatsNew] = useState(false);
    // The version recorded before this update, where the popup's notes start.
    const [whatsNewSince, setWhatsNewSince] = useState<string | null>(null);

    function dismissWhatsNew() {
        setShowWhatsNew(false);
        setLastSeenVersion(APP_VERSION);
    }

    function openAppSettings() {
        openModal("app-settings", () => {});
    }
    function openRoomSettings(r: Room) {
        // Claim first — a same-id handover runs the outgoing close, which nulls settingsRoom.
        openModal("room-settings", () => setSettingsRoom(null));
        setSettingsRoom(r);
    }

    // Desktop room-list width (px), user-resizable from its right edge and
    // persisted per browser. The space rail beside it stays a fixed 4.5rem.
    const ROOM_LIST_WIDTH_KEY = "layout.roomListWidth";
    const ROOM_LIST_MIN_W = 200;
    const roomListMaxW = () =>
        Math.max(ROOM_LIST_MIN_W, Math.min(640, window.innerWidth * 0.5));
    const clampRoomListWidth = (w: number) =>
        Math.round(Math.min(roomListMaxW(), Math.max(ROOM_LIST_MIN_W, w)));
    const [roomListWidth, setRoomListWidth] = useState(() => {
        try {
            const v = Number(localStorage.getItem(ROOM_LIST_WIDTH_KEY));
            return v > 0 ? clampRoomListWidth(v) : 240;
        } catch {
            return 240;
        }
    });
    // Zami: the width to save is passed in: the grip's gesture ends before
    // React has rendered the width it last set.
    function saveRoomListWidth(width: number = roomListWidth) {
        try {
            localStorage.setItem(ROOM_LIST_WIDTH_KEY, String(width));
        } catch {
            // Private-mode localStorage can throw; the width still applies.
        }
    }
    // Zami: the grip's pointer drag (`startRoomListResize`, with pointer
    // capture) is a pan on the grip, and its double-click a double tap. A
    // touch drags it too: upstream's grip is `touch-none`.
    const resizeStartW = useRef(roomListWidth);
    const roomListResizePan = usePanGesture({
        runOnJS: true,
        hitSlop: { horizontal: 8 },
        onActivate: () => {
            resizeStartW.current = roomListWidth;
        },
        onUpdate: (e) => {
            setRoomListWidth(
                clampRoomListWidth(resizeStartW.current + e.translationX),
            );
        },
        onDeactivate: (e) => {
            const width = clampRoomListWidth(
                resizeStartW.current + e.translationX,
            );
            setRoomListWidth(width);
            saveRoomListWidth(width);
        },
    });
    const roomListResizeReset = useTapGesture({
        runOnJS: true,
        hitSlop: { horizontal: 8 },
        numberOfTaps: 2,
        onActivate: () => {
            const width = clampRoomListWidth(240);
            setRoomListWidth(width);
            saveRoomListWidth(width);
        },
    });
    const roomListResizeGrip = useCompetingGestures(
        roomListResizePan,
        roomListResizeReset,
    );
    // Zami: `onRoomListResizeKey`'s arrow keys, as VoiceOver's and
    // TalkBack's adjustable actions (a swipe up or down), 24 px a step.
    function onRoomListResizeAction(action: string) {
        const step = 24;
        let width: number;
        if (action === "decrement")
            width = clampRoomListWidth(roomListWidth - step);
        else if (action === "increment")
            width = clampRoomListWidth(roomListWidth + step);
        else return;
        setRoomListWidth(width);
        saveRoomListWidth(width);
    }

    // Animated drawer drag (mobile)
    // The drawer is 19.5rem (4.5rem SpaceSidebar + 15rem RoomList), so its pixel
    // width follows the app text scale (audit UX-05). Seed it from the root font
    // size so the first closed park is already off screen; `bind:offsetWidth` on
    // the drawer keeps it current when the text scale changes.
    // Zami: the root font size is Uniwind's rem; the drawer's `onLayout` is
    // `bind:offsetWidth`.
    const initialDrawerWidth = 19.5 * REM_PX;
    const [drawerWidth, setDrawerWidth] = useState(initialDrawerWidth);
    // The panel arrangement is pinned left-to-right in every language (see
    // the `dir="ltr"` shell below), so the drawer always slides in from the
    // left; only panel *contents* follow the UI direction.
    const DIR = 1;
    const uiDir = localeInfo().dir;
    // Zami: the drag runs on the UI thread, so what it moves is shared values
    // rather than `$state`: the drawer's style and the backdrop's color read
    // them there. What React renders from `drawerTranslate` (the inert gate,
    // the shadow and the backdrop's touches) follows it below. `isDragging`
    // is a ref for the JS side and `dragActive` its copy on the UI thread,
    // which the pan sets the moment it engages.
    const drawerTranslate = useSharedValue(
        interfaceState.leftOpen ? 0 : -initialDrawerWidth,
    );
    const isDragging = useRef(false);
    const dragActive = useSharedValue(false);
    const dragBaseTranslate = useSharedValue(0);

    // Duration of the current settle animation. A drag release computes a
    // momentum-scaled value; every programmatic change falls back to the default.
    const snapDurationMs = useSharedValue(MAX_SNAP_MS);
    // One-shot: the drag-release path sets this so the sync effect below does not
    // clobber the momentum-scaled duration when it re-runs from the same change.
    const keepSnapDuration = useRef(false);
    // Zami: upstream samples the release velocity from the touch moves
    // (`lastMoveX`, `lastMoveT`, `dragVelocity`); the pan reports it, and it
    // drops toward zero on a pause before release just the same.

    // Zami: the launch timeline (@-/com.leonsilicon.zami.startup) notes when the
    // chats first render, which is later than when the session was ready if the JS
    // thread is busy.
    useEffect(() => {
        markStartup("Chats shown");
        // The first frame drawn after that: later still if the JS thread is
        // busy. Restoring a session waits for it before replaying the saved
        // sync (noteChatsOnScreen in client.ts).
        const frame = requestAnimationFrame(() => {
            markStartup("Chats on screen");
            noteChatsOnScreen(true);
        });
        return () => {
            cancelAnimationFrame(frame);
            noteChatsOnScreen(false);
        };
    }, []);

    // Keep translate in sync when state changes programmatically (hamburger, etc.)
    // Zami: it re-runs when `leftOpen` or the width changes; `isDragging` is a
    // ref, which an effect doesn't track (see drawerDragEnd).
    useEffect(() => {
        const open = leftOpen;
        if (!isDragging.current) {
            drawerTranslate.value = open ? 0 : -drawerWidth;
            if (keepSnapDuration.current) keepSnapDuration.current = false;
            else snapDurationMs.value = MAX_SNAP_MS;
        }
    }, [leftOpen, drawerWidth, drawerTranslate, snapDurationMs]);

    // The mobile drawer stays mounted when closed — it is only translated off
    // screen — so without this a hardware keyboard tabs straight into invisible
    // controls (audit A11Y-02). `inert` also removes the subtree from the
    // accessibility tree; `aria-hidden` is belt-and-braces for webviews that
    // predate `inert`. Same notion as the box-shadow gate below it
    // (`drawerTranslate <= -drawerWidth`), expressed once.
    // Zami: computed on the JS thread whenever the drag or a settle moves
    // `drawerTranslate`, and kept as state only when it flips; the backdrop's
    // `pointer-events` (`backdropOpacity > 0.01`) with it.
    const [leftDrawerClosed, setLeftDrawerClosed] = useState(
        () => !interfaceState.leftOpen,
    );
    const [backdropTouchable, setBackdropTouchable] = useState(
        () => interfaceState.leftOpen && interfaceState.isMobile,
    );
    function onDrawerTranslate(drawerTranslate: number) {
        setLeftDrawerClosed(isOffCanvasClosed(drawerTranslate, -drawerWidth));
        setBackdropTouchable(
            backdropOpacityOf(drawerTranslate, drawerWidth, isMobile) > 0.01,
        );
    }
    useAnimatedReaction(
        () => drawerTranslate.value,
        (translate, previous) => {
            if (translate !== previous)
                scheduleOnRN(onDrawerTranslate, translate);
        },
        [drawerWidth, isMobile],
    );

    const backdropStyle = useAnimatedStyle(() => ({
        backgroundColor: `rgba(0,0,0,${backdropOpacityOf(
            drawerTranslate.value,
            drawerWidth,
            isMobile,
        )})`,
    }));
    const drawerStyle = useAnimatedStyle(() => {
        const x = drawerTranslate.value * DIR;
        return {
            transform: [
                {
                    translateX: dragActive.value
                        ? x
                        : withTiming(x, {
                              duration: snapDurationMs.value,
                              easing: SNAP_EASING,
                          }),
                },
            ],
        };
    });

    // Zami: upstream's touch handlers (drawerDragStart / drawerDragMove /
    // drawerDragEnd, the `dragPending` direction check and the document
    // listeners) are a pan on the whole shell, as upstream listens on the
    // shell and the backdrop. It starts where upstream's touchstart would
    // (`enabled`), engages for a mostly-horizontal drag in the direction that
    // opens a closed drawer or closes an open one (`activeOffsetX`, failing
    // the other way and on a vertical drag), and follows the finger 1:1 on
    // the UI thread; the release goes to `decideDrawerSnap` as upstream's does.
    // An engaged drag cancels the press of whatever is under the finger, as
    // upstream's `preventDefault()` on the moves does.
    const dragEnabled =
        isMobile && sidebar === null && !lightboxOpen && modal === null;

    // Primarily horizontal and in the drawer's direction: the drag has begun.
    function drawerDragBegan() {
        isDragging.current = true;
        // Zami: upstream's `(document.activeElement as HTMLElement)?.blur()`.
        Keyboard.dismiss();
    }

    function drawerDragEnd(dragVelocity: number, translate: number) {
        if (!isDragging.current) return;
        isDragging.current = false;
        dragActive.value = false;
        const { open, durationMs } = decideDrawerSnap(
            translate,
            drawerWidth,
            dragVelocity,
        );
        snapDurationMs.value = durationMs;
        // survive the sync effect's re-run
        // Zami: which only happens when `leftOpen` changes; otherwise the
        // one-shot would wait for, and slow, the next programmatic change.
        keepSnapDuration.current = open !== interfaceState.leftOpen;
        interfaceState.leftOpen = open;
        drawerTranslate.value = open ? 0 : -drawerWidth;
    }

    const drawerPan = usePanGesture(
        useMemo(
            (): PanGestureConfig => ({
                enabled: dragEnabled,
                activeOffsetX: leftOpen
                    ? [-DRAG_ENGAGE_PX, OFFSET_NEVER]
                    : [-OFFSET_NEVER, DRAG_ENGAGE_PX],
                failOffsetX: leftOpen
                    ? [-OFFSET_NEVER, DRAG_ENGAGE_PX]
                    : [-DRAG_ENGAGE_PX, OFFSET_NEVER],
                failOffsetY: [-DRAG_ENGAGE_PX, DRAG_ENGAGE_PX],
                onActivate: (e) => {
                    "worklet";
                    dragBaseTranslate.value = leftOpen ? 0 : -drawerWidth;
                    dragActive.value = true;
                    drawerTranslate.value = Math.min(
                        0,
                        Math.max(
                            -drawerWidth,
                            dragBaseTranslate.value + e.translationX * DIR,
                        ),
                    );
                    scheduleOnRN(drawerDragBegan);
                },
                onUpdate: (e) => {
                    "worklet";
                    drawerTranslate.value = Math.min(
                        0,
                        Math.max(
                            -drawerWidth,
                            dragBaseTranslate.value + e.translationX * DIR,
                        ),
                    );
                },
                onDeactivate: (e) => {
                    "worklet";
                    // px/s here, px/ms in decideDrawerSnap; + = opening.
                    scheduleOnRN(
                        drawerDragEnd,
                        (e.velocityX / 1000) * DIR,
                        drawerTranslate.value,
                    );
                },
            }),
            // Zami: drawerDragEnd and drawerDragBegan read only these, refs and stores.
            [dragEnabled, leftOpen, drawerWidth],
        ),
    );

    // ── Central Escape-key + mobile back-button handling ───────────────────────
    // Priority: pop a sub-page inside the open modal → dismiss open modal →
    // dismiss open sidebar → (back only) open the left drawer → real back. All
    // driven by the interfaceState slots; no component manages its own
    // Escape/back shortcuts.
    function dismissTopmost(): boolean {
        // A sub-page (mobile settings drill-down) sits INSIDE the modal, so it
        // must pop first — one back press returns to the category list rather
        // than throwing the user out of Settings entirely.
        if (interfaceState.subPageClose) {
            closeSubPage();
            return true;
        }
        if (interfaceState.modal) {
            closeModal();
            return true;
        }
        if (interfaceState.sidebar) {
            closeSidebar();
            return true;
        }
        return false;
    }

    function onWindowKeydown(e: KeyboardEvent) {
        // Escape → dismiss the topmost popup/sidebar. Only when there was
        // nothing to dismiss does it reach the shortcuts (decline a ringing
        // call, mark the channel read).
        if (e.key === "Escape" && !e.shiftKey && dismissTopmost()) {
            e.preventDefault();
            return;
        }
        // Keyboard shortcuts (Settings > Keybinds). They run before plugin
        // shortcuts, so a plugin can never take a core key combination.
        if (handleKeybindDown(e)) {
            e.preventDefault();
            return;
        }
        // Plugin-registered global shortcuts (spec §7). resolveShortcut skips
        // any chord that lacks a modifier or collides with the reserved core
        // chords. Plain handler (not $derived): reads the registry array live.
        const shortcut = resolveShortcut(
            eventToChord(e),
            pluginRegistry.shortcuts.map((s) => s.value),
        );
        if (shortcut) {
            e.preventDefault();
            try {
                const r = shortcut.run();
                if (r && typeof (r as { then?: unknown }).then === "function") {
                    (r as Promise<void>).catch((err) =>
                        console.error("[zam] plugin shortcut threw", err),
                    );
                }
            } catch (err) {
                console.error("[zam] plugin shortcut threw", err);
            }
            return;
        }
        // Type-to-focus: a plain alphanumeric key focuses the composer, unless a
        // modal is open (or, on mobile, a sidebar/drawer). We don't
        // preventDefault, so the keystroke lands in the now-focused input.
        if (
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            /^[a-zA-Z0-9]$/.test(e.key) &&
            !interfaceState.modal &&
            !(
                interfaceState.isMobile &&
                (interfaceState.sidebar !== null || interfaceState.leftOpen)
            ) &&
            interfaceState.focusComposer
        ) {
            // Zami: the event's target is the focused TextInput's stand-in
            // `<textarea>`, or `document.body` (there's no activeElement).
            const ae = e.target as HTMLElement | null;
            const editable =
                !!ae &&
                (ae.tagName === "INPUT" ||
                    ae.tagName === "TEXTAREA" ||
                    ae.isContentEditable);
            // Zami: the key was observed, not intercepted: with nothing focused
            // it typed nothing, so the composer types it as it takes focus
            // (MessageInput's focusComposer takes the text).
            if (!editable)
                (interfaceState.focusComposer as (typed?: string) => void)(
                    e.key,
                );
        }
    }

    // <svelte:window onkeydown={onWindowKeydown} />
    useEffect(() => {
        window.addEventListener("keydown", onWindowKeydown);
        return () => window.removeEventListener("keydown", onWindowKeydown);
        // Zami: once: onWindowKeydown reads only stores and functions that do.
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- see above.
    }, []);

    // Zami: not ported: the web history guard (ensureBackGuard and its
    // effect). Upstream needs it only in the browser; Android's back button
    // is the native branch's `backButton` event, here BackHandler (see
    // onMount below).

    /** Shared back action: dismiss modal → sidebar → open drawer.
     *  Returns false when nothing was handled (caller decides: navigate / exit). */
    function handleBack(): boolean {
        if (dismissTopmost()) return true;
        if (!interfaceState.leftOpen) {
            interfaceState.leftOpen = true;
            return true;
        }
        return false;
    }

    // ── Active-session heartbeat ──────────────────────────────────────────
    // While this window is focused we publish "this device is in use" to
    // account data; the user's OTHER devices read it and stay quiet for
    // `graceMs`. Deliberately NOT an $effect — this is an SDK write, and SDK
    // writes inside tracked effects have deadlocked this app before.
    const lastHeartbeatWriteTs = useRef<number | null>(null);

    // When the user last actually did something here. Plain `let`, like the
    // write stamp above: it feeds an SDK write, and making an SDK call's
    // inputs reactive is exactly the pattern that has deadlocked this app.
    // Seeded at mount (opening the app is an interaction) and bumped by the
    // passive input listeners registered there.
    const lastInputTs = useRef<number | null>(null);

    // The account's newest heartbeat, refreshed from sync. Plain `let`: it is
    // read from notification callbacks, never from a tracked scope, and
    // nothing in the markup renders it.
    const activeSessionHeartbeat = useRef<ActiveSessionHeartbeat | null>(null);

    function maybeWriteHeartbeat() {
        // publishActiveSession() silently no-ops before login (no client / no
        // device id). Bail here instead, so we don't stamp a write that never
        // happened and then sit out a whole interval.
        if (!getOwnDeviceId()) return;
        const grace = normalizeGraceMs(settingsState.activeSessionGraceMs);
        // Off: nothing to claim, and the blob's own persisted graceMs: 0 is
        // what tells the other devices the feature is off — so a periodic
        // re-PUT buys nothing. Task 6 publishes explicitly when the setting
        // changes, which is what actually propagates a change.
        if (grace <= 0) return;
        if (
            !shouldWriteHeartbeat({
                lastWriteTs: lastHeartbeatWriteTs.current,
                now: Date.now(),
                // Focus alone is not enough to claim the account: a focused
                // window whose owner walked away (or whose screen locked
                // without blurring, as on macOS and some Windows paths) would
                // keep republishing for hours and silence the phone — which
                // has no inbox to fall back on. Require recent input too.
                hasFocus: isDeviceInUse({
                    hasFocus: document.hasFocus(),
                    lastInputTs: lastInputTs.current,
                    now: Date.now(),
                    idleLimitMs: IDLE_LIMIT_MS,
                }),
                // NOT the bare HEARTBEAT_INTERVAL_MS constant: a 15s grace
                // needs a faster refresh than 30s or the blob expires while
                // the device is still in use and suppression flaps.
                intervalMs: heartbeatIntervalFor(grace),
            })
        )
            return;
        lastHeartbeatWriteTs.current = Date.now();
        // Fire-and-forget: a failed heartbeat just means other devices keep
        // notifying, which is the safe direction. The `false` return (write
        // skipped) is likewise nothing to act on here — the getOwnDeviceId()
        // guard above already covers it, and Settings is where a skipped write
        // actually needs reporting.
        void publishActiveSession(grace).catch(() => {});
    }

    // roomId → the live OS notification for that room, plus the events it has
    // covered. Message notifications are tagged per ROOM (not per event, as
    // they were), so a room shows one collapsing notification and closing it
    // when the user reads elsewhere is a single lookup. Same shape as
    // `notifiedCalls` below. A plain Map on purpose: it is read from
    // notification callbacks and from an $effect, and making it reactive
    // would turn a close() into a dependency of the effect that triggers it.
    const [postedRoomNotifications] = useState(
        () =>
            new Map<
                string,
                { notification: { close: () => void }; eventIds: string[] }
            >(),
    );

    // Latched by closeAllPostedNotifications(): once this session's popups have
    // been taken down, this page must never post another one. Clearing is
    // one-shot but the exits are not instantaneous — an account switch clears,
    // then awaits up to 3s for leaveVoiceCall, and a message arriving in that
    // window would post a fresh popup for the OUTGOING account that survives
    // the reload, which is exactly the leak the clear exists to close. Never
    // reset: every path that clears is on the way out of this session.
    //
    // A plain `let`, not `$state`, for the same reason as the Maps above: it is
    // read by notifyIncomingCall(), which an $effect calls.
    const notificationsShutDown = useRef(false);

    /** Snapshot for the pure rule — the Map itself never leaves this file. */
    function postedEntries(): PostedNotificationEntry[] {
        return [...postedRoomNotifications.entries()].map(
            ([roomId, entry]) => ({ roomId, eventIds: entry.eventIds }),
        );
    }

    function closeRoomNotifications(roomIds: readonly string[]) {
        for (const roomId of roomIds) {
            const entry = postedRoomNotifications.get(roomId);
            if (!entry) continue;
            postedRoomNotifications.delete(roomId);
            try {
                entry.notification.close();
            } catch {
                /* already gone — nothing to do */
            }
        }
    }

    /**
     * Route a notification tap, but only into the session that posted it.
     *
     * A notification outlives its session: it survives an explicit logout's
     * reload, an account switch's reload, and — worst — a session expiry,
     * which swaps to the login view IN PLACE, so this closure is still alive
     * when the user signs in as somebody else. Audit finding PRIV-02.
     *
     * Surfacing the app is NOT gated on the decision, only the navigation is.
     * A tap is a tap: in Electron with the window hidden to the tray, a
     * dropped tap that did nothing at all would look like the app had frozen,
     * and the service worker's own click handler already calls client.focus()
     * before it decides anything — gating here would make the two surfaces
     * behave differently for the same stale notification.
     */
    function routeNotificationTap(
        roomId: string,
        postedBy?: string | null,
        eventId?: string | null,
    ) {
        // window.focus() alone cannot un-hide a tray-hidden Electron window;
        // restoreAppWindow() prefers the preload bridge.
        restoreAppWindow();
        const decision = decideNotificationRoute(
            { roomId, userId: postedBy, eventId },
            { userId: auth.userId },
        );
        if (decision.action !== "navigate") {
            if (decision.reason === "other-account" && postedBy)
                switchAccountForNotification(postedBy, roomId, eventId);
            return;
        }
        // decision.eventId is only present once the poster/session gates passed,
        // so we never jump into a room the route check just refused.
        navigateToRoom(decision.roomId, decision.eventId);
    }

    /**
     * A notification for another account signed in on this device: switch to
     * it, and open the room once it has booted (see the pending route consumed
     * on mount). An account no longer on the device stays a dropped tap.
     */
    function switchAccountForNotification(
        userId: string,
        roomId: string,
        eventId?: string | null,
    ) {
        if (!accountsState.registry.accounts.some((a) => a.userId === userId))
            return;
        savePendingRoute(localStorage, {
            userId,
            roomId,
            ...(eventId ? { eventId } : {}),
        });
        void switchToAccount(userId);
    }

    // Show an OS desktop notification via the Web Notification API. Works in the
    // browser and in Electron (which maps it to a native notification) with no
    // push service. Suppressed when the user is already viewing that room in a
    // focused window.
    function showDesktopNotification(
        event: MatrixEvent,
        room: Room,
        body: string,
        loud: boolean,
    ) {
        // This session's notifications have already been taken down; posting
        // another one now would strand it above the next account's session.
        if (notificationsShutDown.current) return;
        if (!shouldAlertDesktop(settingsState.desktopAlertMode, loud)) return;
        if (
            document.hasFocus() &&
            !roomsState.showInbox &&
            roomsState.activeRoomId === room.roomId
        )
            return;
        // Taskbar flash / dock bounce needs no notification permission.
        flashTaskbar();
        const sender = getMemberName(room, event.getSender() ?? "");
        const eventId = event.getId();
        // The account this popup belongs to, captured at POST time: the click
        // can land in a completely different session.
        const postedBy = auth.userId;
        const title = getRoomDisplayName(room);
        const text = notificationBody({
            sender,
            body,
            hideBody: settingsState.hideNotificationBody,
        });
        try {
            emitPluginNotification({
                roomId: room.roomId,
                eventId: eventId ?? "",
                title,
                body: text,
            });
        } catch {
            // A plugin listener must never break posting the notification.
        }
        try {
            // The desktop shell posts through the main process (no web
            // permission involved); the browser uses the Web Notification API.
            const native = showNativeNotification({
                title,
                body: text,
                tag: room.roomId,
                silent: !loud,
            });
            if (
                !native &&
                (typeof Notification === "undefined" ||
                    Notification.permission !== "granted")
            )
                return;
            // An iOS Home Screen app gets every message as a web push too, and
            // iOS does not let the page's popup and the worker's replace each
            // other by tag, so both showed. The worker's one stays.
            if (!native && isIosHomeScreenApp() && webPushDelivers()) return;
            const n: NativeNotificationHandle =
                native ??
                (new Notification(title, {
                    body: text,
                    icon: "/favicon.png",
                    badge: "/favicon_foreground.png",
                    // Per ROOM, not per event: a room shows one collapsing
                    // notification instead of a growing stack, and "close what
                    // they've now read" becomes one lookup. The tag is the bare
                    // room id, the same one static/sw.js gives its pushed
                    // notifications, so the page and the worker collapse into
                    // one notification per room rather than stacking two. `renotify` keeps the
                    // OS alerting on each replacement, which is what a per-event
                    // tag used to give for free. It is a persistent-notification
                    // option, so TypeScript's NotificationOptions omits it —
                    // browsers that don't honour it simply replace silently. The
                    // cast spells out the one extra key instead of asserting to
                    // the bare type, so what we are adding stays visible here
                    // rather than looking like an unexplained cast.
                    tag: room.roomId,
                    renotify: true,
                    // Silent-tier notifications must not make the OS chime.
                    silent: !loud,
                } as NotificationOptions & {
                    renotify?: boolean;
                }) as unknown as NativeNotificationHandle);
            n.onclick = () => {
                routeNotificationTap(room.roomId, postedBy, eventId);
            };
            // The user dismissing it themselves must drop it from the map, or
            // a later close() would target a dead notification forever.
            n.onclose = () => {
                if (
                    postedRoomNotifications.get(room.roomId)?.notification === n
                )
                    postedRoomNotifications.delete(room.roomId);
            };
            const previous = postedRoomNotifications.get(room.roomId);
            postedRoomNotifications.set(room.roomId, {
                notification: n,
                eventIds: eventId
                    ? appendPostedEventId(previous?.eventIds ?? [], eventId)
                    : (previous?.eventIds ?? []),
            });
        } catch {
            /* notifications unsupported / blocked — ignore */
        }
    }

    // Other accounts' notifications while the app is open. Not on Android
    // (native push covers every account) and not in a browser with web push
    // (the service worker does, and both would double up).
    const stopAccountPoller = useRef<(() => void) | null>(null);
    async function startAccountPollerIfNeeded() {
        if (stopAccountPoller.current || Capacitor.isNativePlatform()) return;
        if (!window.desktop?.notify) {
            const push = await Promise.race([
                readWebPushState().catch(() => null),
                new Promise<null>((resolve) => setTimeout(resolve, 3000, null)),
            ]);
            if (push?.subscribed) return;
        }
        if (stopAccountPoller.current) return;
        stopAccountPoller.current = startInactiveAccountNotifier({
            accounts: () => accountsState.registry.accounts,
            activeUserId: () => auth.userId,
            post: postAccountNotification,
        });
    }

    /**
     * A notification for another account signed in here, from the
     * inactive-account poller: same posting path and desktop alert rules as
     * showDesktopNotification, stamped with that account so a tap switches
     * to it. Not tracked for read-closing, which only sees the active account.
     */
    function postAccountNotification(notice: AccountNotice) {
        if (notificationsShutDown.current) return;
        if (!shouldAlertDesktop(settingsState.desktopAlertMode, notice.loud))
            return;
        flashTaskbar();
        const text = notificationBody({
            sender: notice.sender,
            body: notice.body,
            hideBody: settingsState.hideNotificationBody,
        });
        try {
            const native = showNativeNotification({
                title: notice.title,
                body: text,
                tag: notice.roomId,
                silent: !notice.loud,
            });
            if (
                !native &&
                (typeof Notification === "undefined" ||
                    Notification.permission !== "granted")
            )
                return;
            const n: NativeNotificationHandle =
                native ??
                (new Notification(notice.title, {
                    body: text,
                    icon: "/favicon.png",
                    badge: "/favicon_foreground.png",
                    tag: notice.roomId,
                    renotify: true,
                    silent: !notice.loud,
                } as NotificationOptions & {
                    renotify?: boolean;
                }) as unknown as NativeNotificationHandle);
            n.onclick = () => {
                restoreAppWindow();
                switchAccountForNotification(
                    notice.userId,
                    notice.roomId,
                    notice.eventId,
                );
            };
        } catch {
            /* notifications unsupported / blocked — ignore */
        }
    }

    // Event ids this shell has already put through the notification path.
    // Encrypted messages notify from a second subscription (on decryption), and
    // this is what stops one message notifying twice when both paths see it —
    // e.g. with the showAllEvents debug setting on, where the ciphertext is
    // forwarded to the main path before it decrypts. Bounded so a long session
    // cannot leak.
    const [notifiedEventIds] = useState(() => createBoundedIdSet());

    // Shared notification emission for both the main-timeline and thread-reply
    // paths (one rule set, not two). Assumes the caller already applied its
    // own gate (push actions + own-event + participant/mention). `loud` drives
    // the ping + red-dot badge; silent notifications still populate the inbox.
    // `live` drives the sound + desktop popup; it defaults to "the initial sync
    // has finished", and the decrypted path overrides it because decryption of
    // the page-load backlog routinely resolves *after* sync PREPARED.
    //
    // Deferred by one macrotask, because the read check below cannot be
    // answered yet at call time. `RoomEvent.Timeline` is emitted from the
    // SDK's injectRoomEvents(), and a /sync response applies its ephemeral
    // events — the read receipts — only AFTER that, in
    // `room.addEphemeralEvents()` (matrix-js-sdk sync.ts). Asked inside the
    // handler, or on a microtask, `hasUserReadEvent` still answers from the
    // pre-response receipt and says "unread"; asked on the next macrotask, it
    // has the receipt from the very same response. Measured on the live repro:
    // handler false, microtask false, setTimeout(0) true, next sync tick
    // (+14ms) true.
    const [pendingNotifyTimers] = useState(() => new Set<number>());

    function emitNotification(
        event: MatrixEvent,
        room: Room,
        loud: boolean,
        live: boolean = isInitialSyncComplete(),
    ) {
        // Recorded up front rather than at emission: this is the dedupe key
        // for an event both the main and the decrypted path can see, and with
        // the emission deferred they would otherwise both pass the check.
        const notifiedId = event.getId();
        if (notifiedId) notifiedEventIds.add(notifiedId);
        const timer = window.setTimeout(() => {
            pendingNotifyTimers.delete(timer);
            // Already-read messages must never notify, however live they look.
            // On reload the client resumes from the persisted `since` token,
            // which lags the newest events, so the server re-delivers messages
            // the user already read as genuinely fresh live events AFTER
            // PREPARED — a ping, a popup and an inbox row each, for things they
            // just finished reading. Liveness cannot tell those apart from new
            // traffic; the read receipt can. Checked here so it covers every
            // producer (plaintext timeline, decrypted, thread reply) instead of
            // once per path. Fails OPEN: an unknown room/user/event, or a
            // throwing lookup, still notifies.
            if (
                isAlreadyReadEvent({
                    eventId: event.getId(),
                    myUserId: getOwnUserId(),
                    hasUserReadEvent: (userId, eventId) =>
                        room.hasUserReadEvent(userId, eventId),
                })
            )
                return;
            emitNotificationNow(event, room, loud, live);
        }, 0);
        pendingNotifyTimers.add(timer);
    }

    function emitNotificationNow(
        event: MatrixEvent,
        room: Room,
        loud: boolean,
        live: boolean,
    ) {
        const content = event.getContent() as any;
        // Extensible events (e.g. polls) carry their text fallback in the
        // MSC1767 key instead of body.
        const rawBody =
            typeof content?.body === "string"
                ? content.body
                : typeof content?.["org.matrix.msc1767.text"] === "string"
                  ? content["org.matrix.msc1767.text"]
                  : "";
        // A still-encrypted (undecryptable) event has no cleartext body →
        // show a generic "🔒 Encrypted message" line instead of an empty one.
        const body = previewForEvent(event.getType(), rawBody);

        // Another device of this account is demonstrably in use right now →
        // stay quiet here. The local setting is checked FIRST and is
        // authoritative: whatever the blob says, a user who turned this off
        // on THIS device must never be silenced by it. The inbox row below
        // is still recorded either way — the message IS unread here, we
        // simply don't interrupt.
        const localGrace = normalizeGraceMs(settingsState.activeSessionGraceMs);
        // ...unless THIS device published its own heartbeat inside the same
        // window. Whoever wrote last owns the blob, so with two devices in use
        // the one you are typing on would otherwise go quiet until its next
        // write — roughly half the time. "The device I'm using never goes
        // quiet" should hold structurally, not by luck of timing.
        const iAmAlsoActive =
            lastHeartbeatWriteTs.current !== null &&
            Date.now() - lastHeartbeatWriteTs.current < localGrace;
        const quietForOtherDevice =
            localGrace > 0 &&
            !iAmAlsoActive &&
            shouldSuppressForActiveDevice({
                heartbeat: activeSessionHeartbeat.current,
                myDeviceId: getOwnDeviceId(),
                now: Date.now(),
            });

        if (loud) {
            const soundEnabled =
                localStorage.getItem("notifSoundEnabled") !== "false";
            if (live && soundEnabled && !quietForOtherDevice) {
                playPing();
            }
        }

        // Record both loud and silent notifications so the inbox panel can show
        // them when the server can't fetch past notifications.
        markNotification({
            roomId: room.roomId,
            eventId: event.getId()!,
            ts: event.getTs(),
            sender: event.getSender() ?? "",
            body,
            loud,
        });

        // Any notifying event also pops a desktop notification.
        if (live && !quietForOtherDevice)
            showDesktopNotification(event, room, body, loud);
    }

    // Incoming DM calls get their own notification and suppression rule: the
    // message rule at showDesktopNotification() is about whether you are
    // reading that room, which is not the question here. The only reason to
    // stay quiet is that the card is already on screen in front of you.
    // roomId → its live OS notification (null when we chose not to post one,
    // e.g. the window was focused), so we can close a stale notification when
    // the call stops ringing.
    const [notifiedCalls] = useState(
        () => new Map<string, { close: () => void } | null>(),
    );

    /**
     * Close every notification this page posted. The way out of a session —
     * logout, expiry, account switch — must not leave a signed-out user's
     * message text on screen with a live deep link under it.
     *
     * Delete from the map BEFORE close(), the same order closeRoomNotifications
     * uses: close() fires onclose, which mutates the map we are walking. The
     * key snapshots are what make that safe; do not iterate the live Maps.
     *
     * Declared below both Maps on purpose: the function declaration hoists but
     * the `const` Maps do not, and this only ever runs at teardown time.
     */
    function closeAllPostedNotifications() {
        // Latch first: clearing is one-shot, and the exits that call it keep
        // running (an account switch waits up to 3s on leaveVoiceCall) with a
        // live sync underneath. A message landing in that window must not post
        // a new popup for the account we are leaving.
        notificationsShutDown.current = true;
        for (const roomId of [...postedRoomNotifications.keys()]) {
            const entry = postedRoomNotifications.get(roomId);
            if (!entry) continue;
            postedRoomNotifications.delete(roomId);
            try {
                entry.notification.close();
            } catch {
                /* already gone — nothing to do */
            }
        }
        for (const roomId of [...notifiedCalls.keys()]) {
            const notification = notifiedCalls.get(roomId);
            notifiedCalls.delete(roomId);
            try {
                notification?.close();
            } catch {
                /* already gone */
            }
        }
    }

    function notifyIncomingCall(
        roomId: string,
    ): { close: () => void } | undefined {
        // Same latch as showDesktopNotification: after a clear, this page is on
        // its way out of the session and must post nothing further.
        if (notificationsShutDown.current) return;
        if (document.hasFocus()) return;
        flashTaskbar();
        const room = getRoom(roomId);
        if (!room) return;
        const partnerId = getDMPartnerId(room);
        const name = partnerId
            ? getMemberName(room, partnerId)
            : t("appShell.someone");
        const postedBy = auth.userId;
        try {
            const native = showNativeNotification({
                title: t("appShell.isCalling", { name }),
                body: t("appShell.incomingCall"),
                tag: `call:${roomId}`,
            });
            if (native) {
                native.onclick = () => {
                    routeNotificationTap(roomId, postedBy);
                };
                return native;
            }
            if (
                typeof Notification === "undefined" ||
                Notification.permission !== "granted"
            )
                return;
            const n = new Notification(t("appShell.isCalling", { name }), {
                body: t("appShell.incomingCall"),
                icon: "/favicon.png",
                badge: "/favicon_foreground.png",
                tag: `call:${roomId}`,
            });
            n.onclick = () => {
                routeNotificationTap(roomId, postedBy);
            };
            return n;
        } catch {
            /* notifications unsupported / blocked — the card still shows */
            return undefined;
        }
    }

    // ── Keyboard shortcuts (Settings > Keybinds; $lib/keybinds/runner) ──
    const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
    const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
    const shortcutActions = useRef<QuickActionsHandle | null>(null);

    function openQuickSwitcher() {
        if (interfaceState.modal === "quick-switcher") {
            closeModal();
            return;
        }
        openModal("quick-switcher", () => setQuickSwitcherOpen(false));
        setQuickSwitcherOpen(true);
    }

    function toggleShortcutsHelp() {
        if (interfaceState.modal === "keyboard-shortcuts") {
            closeModal();
            return;
        }
        openModal("keyboard-shortcuts", () => setShortcutsHelpOpen(false));
        setShortcutsHelpOpen(true);
    }

    useEffect(() => {
        setKeybindHost({
            openSettings: () => {
                if (interfaceState.modal === "app-settings") closeModal();
                else openAppSettings();
            },
            openQuickSwitcher,
            openQuickAction: (mode) => shortcutActions.current?.openMode(mode),
            acceptIncomingCall,
            toggleShortcutsHelp,
        });
        return () => setKeybindHost(null);
        // Zami: once, as upstream's effect reads no runes; the host's functions read only stores and setters.
    }, []);

    // Back / forward and "previous channel" follow the rooms opened.
    useEffect(() => {
        recordRoomVisit(activeRoomId);
    }, [activeRoomId]);

    // Rooms left a while ago have their older history let go (historyTrim).
    useEffect(() => {
        noteOpenRoom(activeRoomId);
    }, [activeRoomId]);

    // Push to talk / push to mute: key and mouse-button holds. Capture
    // phase so a composer or dialog handling the key doesn't hide it.
    // Zami: not ported: the mouse buttons (see the note above the component).
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (!e.repeat) handleHoldKey(e, true);
        };
        const up = (e: KeyboardEvent) => handleHoldKey(e, false);
        // Keyups won't reach the window now, unless the desktop's input
        // hook is watching (Settings > Keybinds, "Work when Zam isn't
        // focused").
        const blur = () => {
            if (!holdsOutliveBlur()) releaseAllHolds();
        };
        // Zami: `window.addEventListener(type, listener, true)`.
        const removeDown = addCaptureKeyListener("keydown", down);
        const removeUp = addCaptureKeyListener("keyup", up);
        window.addEventListener("blur", blur);
        return () => {
            removeDown();
            removeUp();
            window.removeEventListener("blur", blur);
            releaseAllHolds();
        };
    }, []);

    // Voice keybinds while Zam isn't focused (desktop app only).
    // Zami: both are no-ops without Electron's input hook; syncGlobalHotkeys
    // runs once, as there's no hook for it to follow the keybinds into.
    useEffect(() => connectGlobalHotkeys(), []);
    useEffect(() => {
        syncGlobalHotkeys();
    }, []);

    function acceptIncomingCall(roomId: string) {
        // Silence FIRST. joinCall's mic probe (getUserMedia) can block on a
        // browser permission prompt, and the ring would otherwise sound until a
        // sweep sees our own membership echo back — the whole prompt long.
        silenceIncomingCall(roomId);
        navigateToRoom(roomId);
        void joinCall(roomId);
    }

    useEffect(() => {
        const current = new Set(ringing);
        for (const roomId of current)
            if (!notifiedCalls.has(roomId)) {
                notifiedCalls.set(roomId, notifyIncomingCall(roomId) ?? null);
            }
        // A room that stopped ringing: close its now-stale OS notification (the
        // caller gave up, or the ring timed out) and forget it so a re-call
        // notifies again.
        for (const roomId of notifiedCalls.keys())
            if (!current.has(roomId)) {
                notifiedCalls.get(roomId)?.close();
                notifiedCalls.delete(roomId);
            }
    }, [ringing]);

    // Opening a room is reading it: drop its notification without waiting for
    // the read receipt to round-trip.
    //
    // This is the ONE branch that closes a notification with no read proof, so
    // it has to be at least as strict as the branch that decides not to POST
    // one (see showDesktopNotification) — closing an unread popup hides a
    // message, while failing to close one is merely untidy. Hence the guards:
    //
    //   - activeRoomId is NOT "the room on screen". setActiveSpace() assigns it
    //     from getLastRoom(spaceId), i.e. a value read back out of localStorage,
    //     so merely clicking a space in the sidebar restores that space's
    //     last-opened room id without ever rendering its timeline.
    //   - showInbox renders InboxPanel *instead of* the active room, and
    //     setActiveSpace() does not clear it — so the two can be true at once.
    //   - callViewRoomId renders CallView over the same slot; the messages are
    //     not on screen there either.
    //
    // Both guards mirror the {#if} chain in the markup below. Do not "simplify"
    // them away: without them, a space switch from the Inbox silently dismisses
    // a notification for a room the user never looked at.
    //
    // Deliberately NOT gated on document.hasFocus(): clicking a notification
    // calls navigateToRoom, and this effect can run before focus lands.
    //
    // Safe in a tracked effect — every read is a plain reactive store field,
    // and closeRoomNotifications touches a plain Map and the Notification API,
    // never the SDK.
    // Sliding sync only carries a windowed room list; the room being viewed
    // needs its own subscription for full state and a deeper timeline. A no-op
    // on classic /sync.
    useEffect(() => {
        setSlidingSyncActiveRoom(activeRoomId);
    }, [activeRoomId]);

    // MSC4153: surface changed cross-signing identities among the open room's
    // members.
    useEffect(() => {
        const id = activeRoomId;
        if (id) void checkRoomIdentities(id);
    }, [activeRoomId]);

    useEffect(() => {
        const openRoomId = activeRoomId;
        if (!openRoomId) return;
        if (showInbox) return;
        if (callViewRoomId === openRoomId) return;
        closeRoomNotifications(
            notificationsToClose({
                posted: postedEntries(),
                readEventIds: new Set<string>(),
                openRoomId,
            }),
        );
    }, [activeRoomId, showInbox, callViewRoomId]);

    const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    function scheduleRefreshRooms() {
        if (refreshTimer.current) return;
        refreshTimer.current = setTimeout(() => {
            refreshTimer.current = null;
            refreshRooms();
        }, 50);
    }

    // Hierarchy refresh: invalidate on real local state change + a TTL floor,
    // with in-flight coalescing, request generations and a failure backoff.
    // Master re-armed a 2 s timer from every sync, so an open space fetched
    // (paginated) /hierarchy roughly every two seconds for as long as it
    // stayed open.
    const hierarchyGeneration = useRef(0);
    const hierarchyInFlightKey = useRef<string | null>(null);
    const hierarchyLastAppliedKey = useRef<string | null>(null);
    const hierarchyLastAppliedAt = useRef<number | null>(null);
    const hierarchyLastFailedKey = useRef<string | null>(null);
    const hierarchyLastFailedAt = useRef<number | null>(null);
    // Zami: the space of the request in flight, and whether a background
    // refresh asked for another fetch while it ran (see below).
    const hierarchyInFlightSpaceId = useRef<string | null>(null);
    const hierarchyRefetchWanted = useRef(false);

    function requestHierarchy(spaceId: string, force: boolean) {
        const parentSpaceId = roomsState.spaceDrillParentId ?? null;
        const key = hierarchyKey({
            spaceId,
            parentSpaceId,
            drillDepth: roomsState.spaceDrillDepth || 1,
            childSignature: getSpaceChildSignature(spaceId),
            parentSignature: parentSpaceId
                ? getSpaceChildSignature(parentSpaceId)
                : "",
            // Cheap: the child list behind this is memoized by signature.
            joinedChildCount: getRoomsInSpace(spaceId).length,
        });
        // Zami: a background refresh doesn't cut off a fetch of the same space;
        // it fetches again once that one has landed. Every room-list rebuild
        // asks, and while an account loads, each one counts more of the space's
        // rooms (the saved room list, then the saved sync, then live sync), so
        // each started over a fetch of up to ten pages and threw the last one
        // away: a large space's "Loading rooms…" lasted until a fetch outran the
        // rebuilds. An open (`force`) still replaces it.
        if (
            !force &&
            hierarchyInFlightKey.current !== null &&
            hierarchyInFlightKey.current !== key &&
            hierarchyInFlightSpaceId.current === spaceId
        ) {
            hierarchyRefetchWanted.current = true;
            return;
        }
        if (
            !shouldFetchHierarchy({
                key,
                inFlightKey: hierarchyInFlightKey.current,
                lastAppliedKey: hierarchyLastAppliedKey.current,
                lastAppliedAt: hierarchyLastAppliedAt.current,
                lastFailedKey: hierarchyLastFailedKey.current,
                lastFailedAt: hierarchyLastFailedAt.current,
                failureBackoffMs: HIERARCHY_FAILURE_BACKOFF_MS,
                now: Date.now(),
                ttlMs: HIERARCHY_TTL_MS,
                force,
            })
        ) {
            // A forced open that coalesced onto a live request for the same key
            // still owns the spinner. Boot hits this every time: onMount's
            // refreshRooms() registers its effect first and starts a SILENT
            // background fetch, so without this the restored space shows no
            // spinner and RoomList's "No rooms yet" flashes over the wait.
            // Cannot strand — the request holding this key settles into apply
            // or keep-previous, both of which clear the flag, and leaving for
            // Home clears it too.
            if (force && hierarchyInFlightKey.current === key)
                roomsState.hierarchyLoading = true;
            return;
        }

        const generation = ++hierarchyGeneration.current;
        hierarchyInFlightKey.current = key;
        hierarchyInFlightSpaceId.current = spaceId;
        // Zami: this fetch reflects everything up to now.
        hierarchyRefetchWanted.current = false;
        // Only a user-driven open shows the spinner; a background TTL refresh
        // must not flash one over data that is already on screen.
        if (force) roomsState.hierarchyLoading = true;

        fetchSpaceHierarchy(
            spaceId,
            parentSpaceId ?? undefined,
            roomsState.spaceDrillDepth || 1,
        )
            .catch(() => null)
            .then((hierarchy) => {
                if (hierarchyInFlightKey.current === key) {
                    hierarchyInFlightKey.current = null;
                    hierarchyInFlightSpaceId.current = null;
                }
                const action = hierarchyResultAction({
                    requestGeneration: generation,
                    latestGeneration: hierarchyGeneration.current,
                    requestSpaceId: spaceId,
                    activeSpaceId: roomsState.activeSpaceId,
                    failed: hierarchy === null,
                });
                // "drop": a newer request owns the loading flag — touch nothing.
                if (action === "drop") return;
                if (action === "apply") {
                    roomsState.spaceHierarchy = hierarchy ?? [];
                    hierarchyLastAppliedKey.current = key;
                    hierarchyLastAppliedAt.current = Date.now();
                    hierarchyLastFailedKey.current = null;
                    hierarchyLastFailedAt.current = null;
                } else {
                    // "keep-previous": leave spaceHierarchy alone, arm the
                    // failure backoff, and FORGET the applied key. Forgetting
                    // is what makes the retry real: after an earlier successful
                    // load of this same space the applied key is this very key,
                    // so leaving it in place would block every later sync on
                    // the TTL — a failed re-open (which starts from a blanked
                    // spaceHierarchy) would show an empty browse list for five
                    // minutes with no spinner and no error.
                    hierarchyLastFailedKey.current = key;
                    hierarchyLastFailedAt.current = Date.now();
                    hierarchyLastAppliedKey.current = null;
                    hierarchyLastAppliedAt.current = null;
                }
                roomsState.hierarchyLoading = false;
                // Zami: the refresh that waited for this fetch (see above).
                if (
                    hierarchyRefetchWanted.current &&
                    hierarchyInFlightKey.current === null &&
                    roomsState.activeSpaceId === spaceId
                ) {
                    hierarchyRefetchWanted.current = false;
                    requestHierarchy(spaceId, false);
                }
            });
    }

    /**
     * Republish a bucket only when its contents actually changed. An
     * element-wise identical array would invalidate every dependent for
     * nothing — and `roomsState.roomsTick` still fires unconditionally at the
     * end of `refreshRooms()`, so anything rendering in-place-mutated Room
     * data still refreshes (this repo's reactivity contract, see CLAUDE.md).
     *
     * Compare against the STORE, never a private "last published" cache: four
     * of the six buckets are also written from outside `refreshRooms()`
     * (RoomList's optimistic leave filter and its space-change effect, the
     * space-change `$effect` below, RoomSettings' `onUpdate`). A private cache
     * would let a later identical computation be skipped against a store that
     * had since diverged. Reading the store creates no dependency:
     * `refreshRooms()` runs from a timeout, from `onMount`, or from an SDK
     * account-data listener — never from inside a tracked effect.
     */
    function publishBucket(bucket: RoomBucket, next: Room[]): void {
        if (!sameOrder(next, roomsState[bucket])) roomsState[bucket] = next;
    }

    function refreshRooms() {
        const layout = getSpaceLayout();
        // Deliberately unconditional: SpaceSidebar's `rootItems` derived reads
        // spaceLayout and leans on this reassignment to pick up renamed or
        // re-avatared spaces. Do not dedupe it.
        roomsState.spaceLayout = layout;
        const classification = getRoomClassification(roomsState.activeSpaceId);
        const spaces = classification.spaces;
        if (layout.order.length) {
            // Build a flat ordered list of all space IDs (including those inside folders)
            const idIndex = new Map<string, number>();
            let idx = 0;
            for (const id of layout.order) {
                if (layout.folders[id]) {
                    for (const sid of layout.folders[id].spaceIds)
                        idIndex.set(sid, idx++);
                } else {
                    idIndex.set(id, idx++);
                }
            }
            spaces.sort((a, b) => {
                const ai = idIndex.get(a.roomId) ?? Infinity;
                const bi = idIndex.get(b.roomId) ?? Infinity;
                return ai - bi;
            });
        }
        publishBucket("spaces", spaces);
        publishBucket("orphanRooms", classification.orphanRooms);
        publishBucket("directRooms", classification.directRooms);
        publishBucket("invitedRooms", classification.invitedRooms);
        publishBucket("knockedRooms", classification.knockedRooms);
        if (roomsState.activeSpaceId) {
            publishBucket("roomsInSpace", classification.roomsInSpace);
            requestHierarchy(roomsState.activeSpaceId, false);
        }
        // The room list has just been rebuilt from the SDK, so this is the
        // earliest honest moment to settle a surface choice boot had to defer.
        resolvePendingSurface();
        // Same reasoning as the line above: the room list is real now, so this
        // is the first honest moment to replace an empty or stale main pane.
        // Bumping the tick afterwards lets the new selection render in the
        // same pass.
        resolveLandingSurface();
        roomsState.roomsTick++;
    }

    // Electron right-click "Save image as" (fetches with auth; see module).
    // Zami: a no-op without Electron's bridge.
    useEffect(installDesktopSaveImage, []);

    // Tell the main process when video plays (it weighs GPU crashes by it).
    // Zami: a no-op without Electron's bridge.
    useEffect(() => {
        const report = window.desktop?.gpu?.setVideoPlaying;
        return report ? watchVideoPlayback(report) : undefined;
    }, []);

    // A sign-in just landed on this device: walk through encryption setup.
    // The dialog stays hidden (and closes itself) when nothing is needed.
    useEffect(() => {
        if (takeFreshSignIn(auth.userId)) openEncryptionSetup(true);
    }, []);
    // Device verification started from that dialog: come back to it once the
    // verification modal closes, so recovery setup (if still missing) follows.
    const resumeEncryptionSetup = useRune(
        () =>
            onboardingState.resumeAfterVerification &&
            !verificationState.active,
    );
    useEffect(() => {
        if (resumeEncryptionSetup) {
            onboardingState.resumeAfterVerification = false;
            openEncryptionSetup(false);
        }
    }, [resumeEncryptionSetup]);

    // Zami: upstream sets the layout flags from media queries on mount and
    // follows their changes: `(max-width: 767px)` for isMobile, `(hover:
    // none)` / `(pointer: coarse)` for isTouchscreen. Here they come from the
    // window (set first at the top of the component): isMobile follows its
    // width (a resize, a rotation, a foldable unfolding), before the next
    // paint, and a phone or tablet is a touchscreen.
    const mqMatched = useRef<boolean | null>(null);
    useLayoutEffect(() => {
        const changed = mqMatched.current !== null;
        mqMatched.current = isMobileWindow;
        interfaceState.isMobile = isMobileWindow;
        if (changed && !isMobileWindow) interfaceState.leftOpen = false;
    }, [isMobileWindow]);
    useLayoutEffect(() => {
        interfaceState.isTouchscreen = true;
    }, []);

    useEffect(() => {
        reloadAccountSettings();

        // One-time "What's New": pop up once on the first launch after the version
        // changes. A first-ever launch (no recorded version) shows nothing and just
        // records the current build. Runs once per shell mount; after dismiss the
        // recorded version equals the current build so it never re-fires.
        const lastSeenVersion = getLastSeenVersion();
        if (shouldShowWhatsNew(lastSeenVersion, APP_VERSION)) {
            setWhatsNewSince(lastSeenVersion);
            setShowWhatsNew(true);
        } else if (lastSeenVersion === null) {
            setLastSeenVersion(APP_VERSION);
        }

        // Sync store fell back to memory this session (audit SEC-M6): warn once
        // that offline history won't persist. The flag is reset per session in
        // createAuthenticatedClient, so this fires only on a real fallback.
        if (sessionHealthState.syncStoreFallback) {
            showErrorToast(
                t("appShell.offlineMessageStorageIsUnavailableThis"),
            );
            // Consume the flag so an SPA remount (e.g. "add account" → cancel →
            // goto("/")) does not re-fire the toast without a new fallback.
            resetSyncStoreFallback();
        }

        // Desktop (Electron) auto-updater: tell the main process the persisted
        // auto-update preference at boot, so the ~10s launch update-check
        // honours a previously-set OFF before it fires. No-op off Electron.
        if (isDesktopUpdater()) {
            desktopSetAutoDownload(settingsState.autoUpdateEnabled);
            // This page loaded, so a web bundle that was just applied is good.
            desktopBundleReady();
        }

        // Android web bundles: native applies a staged one as the app goes to
        // the background, so it needs the persisted choice, and the page
        // confirms it loaded. No-ops off Android.
        webBundleSetAuto(settingsState.autoUpdateEnabled);
        webBundleReady();

        // Desktop (Electron): tell the main process the persisted minimise-to-
        // tray preference at boot, so a previously-set OFF takes effect on the
        // first window close even before the user opens Settings. No-op off
        // Electron. Default ON matches main.cjs's own default.
        if (isDesktopTray())
            setMinimizeToTray(settingsState.minimizeToTrayOnClose);

        // Rich presence from local apps (MSC4544, arRPC): off unless the user
        // turned it on in Settings > General. No-op off Electron.
        const stopRichPresence = startRichPresence();

        // App-wide update watch: mirror the desktop launch-check status into the
        // in-app banner, and run the Android launch check + download here
        // (Android has no background process). No-op on web.
        const unsubUpdateWatch = initUpdateWatch();

        refreshRooms();
        const client = getClient();
        if (client) initPush(client).catch(console.error);
        // PWA / browser web push (no-op on native or when no VAPID key set).
        if (client) initWebPush(client).catch(console.error);
        // Ring on a closed device: register the m.call.notify push rule once.
        // Idempotent + best-effort — never blocks or breaks the session.
        if (client) ensureCallNotifyPushRule().catch(() => {});
        // Keep encrypted thread renames from notifying. Best-effort too.
        if (client) ensureThreadNamePushRule().catch(() => {});

        // Mirror the session natively so the push service can enrich
        // notifications and read the active-session blob (off-native this is a
        // no-op). The device id is passed but NOT part of the guard: without it
        // the native service simply never suppresses, whereas dropping the
        // whole mirror would also break notification enrichment.
        // Every signed-in account, so a push for one that isn't active can
        // still be read; kept current by the registry from here on.
        syncNativeAccounts(accountsState.registry.accounts).catch(() => {});
        syncServiceWorkerAccounts(accountsState.registry.accounts);
        void startAccountPollerIfNeeded();
        if (auth.homeserverUrl && auth.accessToken && auth.userId) {
            syncNativeSession({
                homeserverUrl: auth.homeserverUrl,
                accessToken: auth.accessToken,
                userId: auth.userId,
                deviceId: auth.deviceId,
                oauth: loadStoredSession()?.oauth ?? null,
                accessTokenExpiresAt:
                    loadStoredSession()?.accessTokenExpiresAt ?? null,
            }).catch(() => {});
        }

        // Seed the reader from whatever already synced: the blob usually
        // arrives before this shell mounts, and onAccountData only fires on
        // the NEXT change — without this seed the first minutes of a session
        // would notify loudly for a device that is plainly in use. Also
        // adopts the grace, since the blob carries the account-wide setting.
        activeSessionHeartbeat.current = getActiveSessionHeartbeat();
        if (activeSessionHeartbeat.current)
            setActiveSessionGraceMs(
                normalizeGraceMs(activeSessionHeartbeat.current.graceMs),
            );

        // Publish the heartbeat now (if focused), on every focus gain, on the
        // first input after an idle spell, and on a timer that sleeps until
        // the grace-derived interval since the last write is up. Re-read each
        // round, so the write rate follows the user's current setting.
        // Opening the app is itself an interaction — without this seed the
        // first heartbeat could never be written (isDeviceInUse treats a null
        // stamp as "idle").
        lastInputTs.current = Date.now();
        // Passive listeners: they only stamp a number, so they must never
        // block scrolling or typing.
        // Coming back from idle should not wait out the timer.
        // Zami: the window stand-in gets touches from the shell (its
        // onTouchStart below); focus is the app becoming active.
        const onUserInput = () => {
            const now = Date.now();
            const wasIdle =
                lastInputTs.current === null ||
                now - lastInputTs.current >= IDLE_LIMIT_MS;
            lastInputTs.current = now;
            if (wasIdle) maybeWriteHeartbeat();
        };
        const inputEvents = [
            "pointerdown",
            "keydown",
            "wheel",
            "touchstart",
        ] as const;
        for (const type of inputEvents)
            window.addEventListener(type, onUserInput, { passive: true });

        const onWindowFocus = () => maybeWriteHeartbeat();
        window.addEventListener("focus", onWindowFocus);
        let heartbeatTimer: number | undefined;
        const heartbeatTick = () => {
            maybeWriteHeartbeat();
            const interval = heartbeatIntervalFor(
                normalizeGraceMs(settingsState.activeSessionGraceMs),
            );
            // Measured from the last write, wherever it came from: a write on
            // focus must not push the next one a whole extra interval out.
            const due =
                lastHeartbeatWriteTs.current === null
                    ? interval
                    : lastHeartbeatWriteTs.current + interval - Date.now();
            heartbeatTimer = window.setTimeout(
                heartbeatTick,
                due > 0 ? Math.min(due, interval) : interval,
            );
        };
        heartbeatTick();

        // Push the device-global notification-privacy flag to the two
        // background notification producers. They run without a page (SW
        // wake-up / FCM service) and keep their own copies, so a boot is the
        // one guaranteed chance to correct a stale one. Deliberately OUTSIDE
        // the session guard above: logout clears the native key and the SW
        // auth, so a logout -> login cycle must re-arm both mirrors.
        syncNativeNotificationPrivacy(settingsState.hideNotificationBody).catch(
            () => {},
        );
        updateServiceWorkerNotificationPrivacy(
            settingsState.hideNotificationBody,
        );
        if (auth.userId) {
            updateServiceWorkerReceiptPrivacy(
                auth.userId,
                settingsState.privateReadReceipts,
            );
            syncNativeReceiptPrivacy(
                auth.userId,
                settingsState.privateReadReceipts,
            ).catch(() => {});
        }
        // The DM ring setting, for the native push service and the SW.
        syncNativeRingEnabled(settingsState.ringEnabled).catch(() => {});
        updateServiceWorkerRingEnabled(settingsState.ringEnabled);

        // Native Android notification taps (MainActivity) call this to deep-link
        // to a room. Pushers posted by MatrixMessagingService open via here.
        // The second argument is the account MatrixMessagingService posted
        // under; decideNotificationRoute now fails CLOSED when it is missing
        // (audit SEC-M4), so an unstamped tap — an old pre-stamp notification or
        // a forged intent from another app — surfaces the app but does not
        // navigate. Current builds always stamp it alongside the room id.
        // Shared by web-push (service worker) and native (MainActivity) taps.
        // A plain tap opens the room; Accept on a call notification passes
        // joinCall to open the room AND join, under the same account guard.
        const openRoomFromNotification = (
            roomId: string,
            userId?: string | null,
            joinCall = false,
            eventId?: string | null,
        ) => {
            if (!roomId) return;
            if (joinCall) {
                restoreAppWindow();
                const decision = decideNotificationRoute(
                    { roomId, userId },
                    { userId: auth.userId },
                );
                if (decision.action === "navigate")
                    acceptIncomingCall(decision.roomId);
                // Another account's call: switch to it and open the room. The
                // call has to be joined from there; it may be over by then.
                else if (decision.reason === "other-account" && userId)
                    switchAccountForNotification(userId, roomId, eventId);
            } else {
                // A plain tap opens the room AND jumps to the notified message.
                routeNotificationTap(roomId, userId, eventId);
            }
        };

        // Put a notification reply that could not be sent back where the user
        // can see it. The composer open for that draft key (main or thread)
        // takes it; otherwise it merges into the draft the composer restores
        // on mount.
        const restoreQuickReplyDraft = (
            roomId: string,
            threadRootId: string | null,
            text: string,
        ) => {
            const key = threadRootId
                ? composerThreadKey(roomId, threadRootId)
                : roomId;
            if (deliverToLiveComposer(key, text)) return;
            const existing = getDraft(key);
            setDraft(
                key,
                composerInsertText(existing?.text ?? "", text),
                new Map(existing?.mentions ?? []),
            );
        };

        const quickReplyFromNotification = async (
            roomId: string,
            userId?: string | null,
            text?: string,
            eventId?: string | null,
            stashId?: string,
        ) => {
            if (!roomId || !text || !text.trim()) return;
            const decision = decideNotificationRoute(
                { roomId, userId },
                { userId: auth.userId },
            );
            // Route refused (other account) → return WITHOUT deleting the stash
            // so that account can consume it at boot.
            if (decision.action !== "navigate") return;

            try {
                await sendNotificationQuickReply(
                    decision.roomId,
                    text.trim(),
                    eventId,
                );
                // Success → delete the stash
                if (stashId) await deleteQuickReplyStash(stashId);
            } catch (err) {
                console.error("Quick reply failed", err);
                // Failure → restore the text as a draft so nothing is lost.
                try {
                    const threadRootId = eventId
                        ? await resolveQuickReplyThreadRoot(
                              decision.roomId,
                              eventId,
                          )
                        : null;
                    restoreQuickReplyDraft(
                        decision.roomId,
                        threadRootId,
                        text.trim(),
                    );
                } catch (restoreErr) {
                    console.error(
                        "Quick reply draft restore failed",
                        restoreErr,
                    );
                }
                showErrorToast(t("appShell.couldnTSendYourReplyIt"));
                // Always delete the stash on failure (already consumed)
                if (stashId) await deleteQuickReplyStash(stashId);
            }
        };

        const quickMarkReadFromNotification = async (
            roomId: string,
            userId?: string | null,
        ) => {
            if (!roomId) return;
            const decision = decideNotificationRoute(
                { roomId, userId },
                { userId: auth.userId },
            );
            if (decision.action !== "navigate") return;
            try {
                await markRoomAsRead(decision.roomId);
            } catch {
                /* swallow — a failed background mark-read must not crash the shell */
            }
        };

        (window as any).__matrixOpenRoom = (
            roomId: string,
            userId?: string,
            joinCall = false,
            eventId?: string,
        ) => {
            openRoomFromNotification(roomId, userId, joinCall, eventId);
        };

        // Android: a ringing DM call answered from a headset, the car or a
        // watch. Same path, and same account guard, as Accept on the
        // notification.
        const unsubNativeAnswer = onNativeCallEvent(
            "answer",
            ({ roomId, userId }) =>
                openRoomFromNotification(roomId, userId, true),
        );

        // Android share-sheet bridge (MainActivity forwards ACTION_SEND extras
        // here). The JSON is UNTRUSTED — receiveShare only STAGES it into the
        // picker, never sends. Mirrors __matrixOpenRoom.
        (window as any).__matrixShare = (json: string) => {
            try {
                const raw = JSON.parse(json) as {
                    text?: string;
                    subject?: string;
                    files?: {
                        name?: string;
                        mimeType?: string;
                        dataBase64?: string;
                    }[];
                };
                const files = (raw.files ?? [])
                    .map((f) => base64ToFile(f))
                    .filter((f): f is File => f != null);
                receiveShare({
                    source: "android",
                    text: raw.text,
                    subject: raw.subject,
                    files,
                });
            } catch {
                /* malformed bridge payload — ignore */
            }
        };

        // Android keyboard image insertion (Gboard stickers / Emoji Kitchen,
        // via ComposerWebView). The focused composer picks it up and queues it
        // as an attachment, like a pasted image.
        (window as any).__matrixKeyboardContent = (json: string) => {
            try {
                const file = base64ToFile(JSON.parse(json));
                if (file) {
                    window.dispatchEvent(
                        new CustomEvent("matrix-keyboard-content", {
                            detail: file,
                        }),
                    );
                }
            } catch {
                /* malformed bridge payload — ignore */
            }
        };

        // Android notification-action bridges: must forward the poster userId from
        // the intent so the guard can verify it matches the active account — the
        // guard fails closed when userId is missing (audit SEC-M4 / PRIV-02).
        (window as any).__matrixReplyFromNotification = (
            roomId: string,
            eventId?: string,
            text?: string,
            userId?: string,
        ) => quickReplyFromNotification(roomId, userId, text, eventId);

        (window as any).__matrixMarkAsRead = (
            roomId: string,
            eventId?: string,
            userId?: string,
        ) => quickMarkReadFromNotification(roomId, userId);

        // Web push notification taps (service worker) deep-link via postMessage.
        const onSwMessage = (e: MessageEvent) => {
            if (e.data?.type === "OPEN_ROOM" && e.data.roomId) {
                openRoomFromNotification(
                    e.data.roomId,
                    e.data.userId,
                    !!e.data.joinCall,
                    e.data.eventId,
                );
            } else if (e.data?.type === "NOTIF_REPLY" && e.data.roomId) {
                quickReplyFromNotification(
                    e.data.roomId,
                    e.data.userId,
                    e.data.text,
                    e.data.eventId,
                    e.data.stashId,
                );
            } else if (e.data?.type === "NOTIF_MARK_READ" && e.data.roomId) {
                quickMarkReadFromNotification(e.data.roomId, e.data.userId);
            }
        };
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.addEventListener("message", onSwMessage);
        }

        // One call from logout / expiry / account switch has to take all three
        // notification surfaces down; the page's handles are private to this
        // component, so it registers its own closer rather than exporting them.
        const unregisterPageSurface = registerNotificationSurface(
            closeAllPostedNotifications,
        );
        const unregisterSwSurface = registerNotificationSurface(
            clearServiceWorkerNotifications,
        );
        // Let the service worker / Android push service ask this page to
        // decrypt an encrypted message for its notification.
        const stopPushDecrypt = startPushDecryptResponder();
        // Android's notifications are posted by native Java, so nothing the
        // page closes can reach them — this is the only path that can.
        const unregisterNativeSurface = registerNotificationSurface(
            clearDeliveredNativeNotifications,
        );

        // Zami: the media queries (isMobile, isTouchscreen) are the layout
        // effects above.

        const unsubRooms = onRoomUpdate(() => scheduleRefreshRooms());
        // Room updates that resolved between the first refreshRooms() and
        // this subscription (e.g. state seeding right after PREPARED) would
        // otherwise never re-derive the lists — catch up once.
        scheduleRefreshRooms();
        const unsubTimeline = onTimelineEvent((event, room, isLiveAppend) => {
            bumpUnreadTick();
            // Mid-timeline insertions (out-of-order/threaded events the SDK
            // slots into the middle of the timeline) are forwarded so the view
            // stays complete, but they must not fire sounds/notifications the
            // way a fresh tail message does — skip the alert path for them.
            if (!isLiveAppend) return;
            if (event.getSender() === getOwnUserId()) return;

            // Still encrypted: the decrypted path below notifies once it has
            // the text. Only "Show all events" lets ciphertext this far, and
            // notifying it here would pop "🔒 Encrypted message" and, sharing
            // the event id, suppress the decrypted notification for good.
            if (isUndecryptedEvent(event.getType())) return;

            // Thread replies are participant/mention-gated elsewhere: plaintext
            // ones by onThreadReplyEvent below, encrypted ones by the decrypted
            // path. Skip them here so we don't double-notify.
            if (getEventThreadRootId(event)) return;

            const actions = getClient()?.getPushActionsForEvent(event);
            if (!actions?.notify) return;

            const loud = !!(actions.tweaks as any)?.sound;
            emitNotification(event, room, loud);
        });

        // Encrypted messages arrive as m.room.encrypted, which onTimelineEvent
        // filters out — so they only become notifiable once they decrypt. Same
        // gate chain as above, re-run at that point. Thread replies come
        // through here too (NOTIF-02): the plaintext thread path below cannot
        // see them, because it gates on the cleartext type.
        const unsubDecryptedNotify = onDecryptedTimelineEvent(
            (event, room, meta) => {
                bumpUnreadTick();
                const eventId = event.getId();
                // The SDK caches push actions against the ciphertext envelope
                // during sync, so they MUST be recalculated now that the
                // cleartext body and mentions are readable — otherwise a
                // mention never highlights and the room's mute rule is applied
                // to the wrong content. This is also what makes the thread
                // policy's `isMentioned` meaningful at all.
                const actions = getClient()?.getPushActionsForEvent(
                    event,
                    true,
                );
                if (
                    !shouldNotifyDecrypted({
                        eventId,
                        alreadyNotified:
                            !!eventId && notifiedEventIds.has(eventId),
                        isLiveAppend: meta.isLiveAppend,
                        isOwnEvent: event.getSender() === getOwnUserId(),
                        // From the wrapper, not getEventThreadRootId: for an
                        // encrypted event the relation may live only in the
                        // wire content, which that helper does not read.
                        threadRootId: meta.threadRootId,
                        pushNotify: !!actions?.notify,
                        isThreadParticipant: meta.threadRootId
                            ? isThreadParticipant(room, meta.threadRootId)
                            : false,
                        isMentioned: !!(actions?.tweaks as any)?.highlight,
                    })
                )
                    return;

                const loud = !!(actions?.tweaks as any)?.sound;
                emitNotification(
                    event,
                    room,
                    loud,
                    !meta.arrivedDuringInitialSync,
                );
            },
        );

        // Thread replies are diverted off the main timeline (onTimelineEvent
        // filters them), so they need their own path into the notification
        // machinery. Gate: notify (push/mute rules) AND participant-or-mentioned
        // — not every reply in the room. Reuses the shared emitNotification.
        const unsubThreadNotify = onThreadReplyEvent(
            (event, room, isLiveAppend) => {
                if (!isLiveAppend) return;
                if (event.getSender() === getOwnUserId()) return;

                // Both this path and the decrypted one can now admit a thread
                // reply, so the shared id set — not a structural accident — is
                // what guarantees exactly one notification per event. A
                // plaintext reply can never have been notified before reaching
                // here, so this only ever fires on an overlap.
                const threadEventId = event.getId();
                if (threadEventId && notifiedEventIds.has(threadEventId))
                    return;

                const actions = getClient()?.getPushActionsForEvent(event);
                const notify = !!actions?.notify;
                const loud = !!(actions?.tweaks as any)?.sound;
                const isMentioned = !!(actions?.tweaks as any)?.highlight;

                const rootId = getEventThreadRootId(event);
                const isParticipant = rootId
                    ? isThreadParticipant(room, rootId)
                    : false;

                if (
                    !shouldNotifyThreadEvent({
                        isOwnEvent: false,
                        notify,
                        isParticipant,
                        isMentioned,
                    })
                )
                    return;

                emitNotification(event, room, loud);
            },
        );
        // Messages a sliding-sync gap skipped (only the newest event of a list
        // room arrives per update) that may deserve an alert: fetched back
        // and handed over here, already decrypted. They never were live
        // appends, so they get the decrypted path's gate, which covers main
        // timeline and thread replies alike.
        const unsubMissedNotify = onMissedLiveEvent((event, room, meta) => {
            bumpUnreadTick();
            const eventId = event.getId();
            const actions = getClient()?.getPushActionsForEvent(event, true);
            if (
                !shouldNotifyDecrypted({
                    eventId,
                    alreadyNotified: !!eventId && notifiedEventIds.has(eventId),
                    isLiveAppend: true,
                    isOwnEvent: event.getSender() === getOwnUserId(),
                    threadRootId: meta.threadRootId,
                    pushNotify: !!actions?.notify,
                    isThreadParticipant: meta.threadRootId
                        ? isThreadParticipant(room, meta.threadRootId)
                        : false,
                    isMentioned: !!(actions?.tweaks as any)?.highlight,
                })
            )
                return;
            emitNotification(event, room, !!(actions?.tweaks as any)?.sound);
        });
        // Zami: once per turn of the event loop, not per receipt. Each pass
        // walks every room twice, and a saved sync replays a receipt per room
        // in one chain of microtasks: per receipt, that was quadratic in the
        // number of rooms (see bumpUnreadTick).
        let receiptsTimer: ReturnType<typeof setTimeout> | null = null;
        const unsubReceiptEvents = onAnyReceiptEvent(() => {
            receiptsTimer ??= setTimeout(() => {
                receiptsTimer = null;
                onReceipts();
            }, 0);
        });
        const unsubReceipts = () => {
            unsubReceiptEvents();
            if (receiptsTimer) clearTimeout(receiptsTimer);
            receiptsTimer = null;
        };
        function onReceipts(): void {
            const userId = getOwnUserId();
            const client = getClient();
            // Before the bump: thread counts a receipt now covers drop to zero
            // (sliding sync never sends fresh per-thread counts).
            for (const room of client?.getRooms() ?? [])
                clearReadThreadCounts(room);
            bumpUnreadTick();
            if (!userId || !client) return;
            for (const room of client.getRooms()) {
                clearReadNotifications(room, userId);
            }
            // …and take the OS notifications down too. A receipt from ANY of
            // the user's devices lands here, which is the whole point: read it
            // on your phone, the desktop popup goes away.
            const readEventIds = new Set<string>();
            for (const [roomId, entry] of postedRoomNotifications) {
                const room = getRoom(roomId);
                if (!room) continue;
                for (const id of entry.eventIds) {
                    try {
                        if (room.hasUserReadEvent(userId, id))
                            readEventIds.add(id);
                    } catch {
                        /* event unknown to the room → treat as unread */
                    }
                }
            }
            closeRoomNotifications(
                notificationsToClose({
                    posted: postedEntries(),
                    readEventIds,
                }),
            );
        }
        // Fires once the server confirms a read receipt (or it already is
        // confirmed), so the room's loud dot clears without waiting for a
        // receipt event.
        const unsubReadConfirmed = onReadReceiptConfirmed((roomId) => {
            const userId = getOwnUserId();
            const room = getRoom(roomId);
            if (userId && room) clearReadNotifications(room, userId);
        });
        reloadLastLocationFromStorage();
        // Zami: settle the main pane for the space and room just restored, from
        // the saved room list. The rebuild above ran before they were known, and
        // the next one may not come until the saved sync has been replayed.
        resolveLandingSurface();
        reloadNotificationsFromStorage();
        // PWA cold-start deep-link. When a notification is tapped with no
        // focused client, the service worker opens `/#room=<id>&event=<id>`
        // (static/sw.js). The in-app SW postMessage path only reaches an
        // already-open client, so on a cold start nothing routes it — parse the
        // boot hash here. This runs AFTER reloadLastLocationFromStorage() on
        // purpose: the deep-link must override the restored last room.
        // navigateToRoom → markRoomPendingArrival protects the target across the
        // per-sync rebuild and queues roomsState.pendingJump for MessageArea,
        // exactly like a notification tap. Strip the fragment afterwards so an
        // in-session remount (session expiry → re-auth) can't re-fire the jump.
        // Zami: `history.replaceState` is `$app/navigation`'s replaceState,
        // which changes the `page.url` the location stand-in reads.
        const deepLink = parseDeepLinkHash(window.location.hash);
        if (deepLink) {
            // Posted under another account signed in here: switch to it,
            // and the room opens once it has booted.
            if (deepLink.userId && deepLink.userId !== auth.userId)
                switchAccountForNotification(
                    deepLink.userId,
                    deepLink.roomId,
                    deepLink.eventId,
                );
            else navigateToRoom(deepLink.roomId, deepLink.eventId);
            replaceState(
                window.location.pathname + window.location.search,
                page.state,
            );
        }
        // Web Share Target cold/warm start: the service worker stashed the
        // shared payload in IndexedDB and redirected to /?share_target=1.
        // Consume it and open the picker. Strip the param FIRST so a remount
        // can't re-open, then read the stash (async, fire-and-forget).
        if (new URLSearchParams(window.location.search).has("share_target")) {
            replaceState(
                window.location.pathname + window.location.hash,
                page.state,
            );
            (async () => {
                try {
                    const stash = await consumeWebShareStash();
                    if (stash) {
                        receiveShare({
                            source: "web",
                            title: stash.title,
                            text: stash.text,
                            url: stash.url,
                            files: stash.files ?? [],
                            droppedFiles: stash.droppedFiles,
                        });
                    }
                } catch {
                    /* no stash / IDB unavailable — ignore */
                }
            })();
        }
        // Quick-reply stashes (notification actions when the page was closed):
        // consume all stashes for this account and restore them as drafts.
        // Never auto-send. Fire-and-forget.
        // A notification tapped for this account while another was active:
        // the switch reloaded into this account, so open the room now.
        const pendingRoute = takePendingRoute(localStorage, auth.userId);
        if (pendingRoute)
            navigateToRoom(pendingRoute.roomId, pendingRoute.eventId);

        if (auth.userId) {
            (async () => {
                try {
                    const stashes = await takeQuickReplyStashes(auth.userId!);
                    if (stashes.length === 0) return;

                    for (const stash of stashes) {
                        let threadRootId: string | null = null;
                        if (stash.eventId) {
                            try {
                                threadRootId =
                                    await resolveQuickReplyThreadRoot(
                                        stash.roomId,
                                        stash.eventId,
                                    );
                            } catch {
                                // Best effort — treat as main timeline
                            }
                        }

                        restoreQuickReplyDraft(
                            stash.roomId,
                            threadRootId,
                            stash.text,
                        );
                    }

                    showToast(t("appShell.yourNotificationReplyWasSavedAs"), {
                        tone: "accent",
                    });
                } catch (err) {
                    console.error("Failed to restore quick-reply stashes", err);
                }
            })();
        }
        // Refresh the registry's cached profile for this account so the
        // account switcher shows a current name/avatar even when this
        // account is later inactive. Fire-and-forget.
        (async () => {
            try {
                const profile = await fetchOwnProfile();
                if (!profile.userId) return;
                // File it under the account that was fetched, not whoever is
                // active after the await (audit CORE-02). mxcToHttp resolves
                // against the ACTIVE homeserver, so a superseded fetch keeps
                // its cached avatar URL instead.
                const stillActive = profile.userId === auth.userId;
                const cachedAvatar =
                    accountsState.registry.accounts.find(
                        (a) => a.userId === profile.userId,
                    )?.avatarUrl ?? null;
                updateAccountProfile(profile.userId, {
                    displayName: profile.displayName,
                    avatarUrl: stillActive
                        ? mxcToHttp(profile.avatarMxc, 64, 64)
                        : cachedAvatar,
                });
            } catch {
                // offline boot — cached values stay
            }
        })();
        const unsubFavourites = initFavourites();
        const unsubCustomization = initCustomizationSync();
        const unsubIgnored = initIgnoredUsers();
        const unsubPresence = initPresence();
        const unsubVoice = initVoiceCall();
        const unsubIncoming = initIncomingCalls();
        const unsubLiveLocation = initLiveLocation();
        const unsubOutbox = initOutbox();
        const unsubEventIndex = settingsState.indexEncryptedRooms
            ? startEventIndex()
            : () => {};
        // Android: free the crypto store for push decryption while the app
        // sits in the background (reloads on return).
        const unsubBackgroundRelease = initBackgroundRelease();
        const unsubHistoryTrim = initHistoryTrim();
        const unsubVerification = initVerification();
        const unsubPlugins = initPlugins();
        // Reply-count chips: a new thread settles its count after the sync.
        const unsubThreadSummaries = onThreadSummaryChange(
            () => roomsState.roomsTick++,
        );
        // Thread names live in a client.ts cache; anything showing one reads
        // roomsTick.
        const unsubThreadNames = onThreadNameChange(
            () => roomsState.roomsTick++,
        );
        // A message you just sent is a local echo until the server accepts it;
        // the DM preview shows it from the moment it is sent.
        const unsubLocalEcho = onLocalEchoUpdated(() => bumpUnreadTick());
        const unsubAccountData = onAccountData((type) => {
            // Pack changes made on another device (or by us) reach pickers.
            if (
                type === "im.ponies.user_emotes" ||
                type === "im.ponies.emote_rooms" ||
                type === "m.image_pack.rooms"
            )
                roomsState.roomsTick++;
            if (
                type === "im.client.space_layout" ||
                type === "im.client.space_order"
            )
                refreshRooms();
            if (type === ACTIVE_SESSION_KEY) {
                activeSessionHeartbeat.current = getActiveSessionHeartbeat();
                // The blob is the source of truth for the setting too, so a
                // change made on another device lands here. Only write when
                // the value actually differs: a focused peer republishes the
                // same grace every 30s, and each of those would otherwise be
                // a pointless localStorage write, forever.
                if (activeSessionHeartbeat.current) {
                    const remoteGrace = normalizeGraceMs(
                        activeSessionHeartbeat.current.graceMs,
                    );
                    if (remoteGrace !== settingsState.activeSessionGraceMs)
                        setActiveSessionGraceMs(remoteGrace);
                }
            }
        });

        // ── Back button ───────────────────────────────────────────────────
        // Native (Capacitor): the hardware back button fires the App plugin's
        // backButton event. Run the shared dismiss logic; exit the app only
        // when there's nothing left to dismiss.
        // Web: intercept popstate against a pushed history "guard" entry.
        // Zami: Android's back button is the native branch, through
        // BackHandler. Returning false leaves the press to Android, which
        // leaves the app (`App.exitApp()`). Dialogs that register later run
        // first (RoomSettings and AppSettings pop their own drill-downs).
        const nativeBackHandle = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                if (handleBack()) return true;
                return false;
            },
        );

        return () => {
            // Deferred notifications must not land after teardown/logout.
            for (const t of pendingNotifyTimers) window.clearTimeout(t);
            pendingNotifyTimers.clear();
            // Close what we posted before dropping the handles: an expiry
            // unmounts this component in place and the popups would otherwise
            // outlive the session with a live onclick closure attached.
            closeAllPostedNotifications();
            // The service worker's popups outlive this component too, and not
            // every unmount comes through a clearAllNotificationSurfaces()
            // caller: "Add account" just routes to /?add, which flips the view
            // to login and unmounts us with account A's SW notifications still
            // up. Clear before dropping the registration — after it, nobody can.
            clearServiceWorkerNotifications();
            // Android's tray survives the unmount the same way, and it is the
            // surface that shows a sender name and message text — leaving it up
            // would sit account A's content above account B's session.
            clearDeliveredNativeNotifications();
            unregisterPageSurface();
            unregisterSwSurface();
            unregisterNativeSurface();
            stopPushDecrypt();
            unsubRooms();
            unsubTimeline();
            unsubDecryptedNotify();
            unsubThreadNotify();
            unsubMissedNotify();
            unsubReceipts();
            unsubReadConfirmed();
            unsubFavourites();
            unsubCustomization();
            unsubIgnored();
            unsubPresence();
            unsubVoice();
            unsubIncoming();
            unsubLiveLocation();
            unsubOutbox();
            unsubEventIndex();
            unsubBackgroundRelease();
            unsubHistoryTrim();
            unsubVerification();
            unsubPlugins();
            unsubAccountData();
            unsubLocalEcho();
            unsubThreadNames();
            unsubThreadSummaries();
            unsubUpdateWatch();
            stopRichPresence();
            window.removeEventListener("focus", onWindowFocus);
            for (const type of inputEvents)
                window.removeEventListener(type, onUserInput);
            window.clearTimeout(heartbeatTimer);
            nativeBackHandle.remove();
            delete (window as any).__matrixOpenRoom;
            delete (window as any).__matrixKeyboardContent;
            stopAccountPoller.current?.();
            stopAccountPoller.current = null;
            unsubNativeAnswer();
            if ("serviceWorker" in navigator) {
                navigator.serviceWorker.removeEventListener(
                    "message",
                    onSwMessage,
                );
            }
        };
        // Zami: once per mount, as onMount; what it calls reads refs and stores.
    }, []);

    // Update rooms list and fetch full hierarchy when selected space changes
    useEffect(() => {
        const spaceId = activeSpaceId; // only dependency we want
        const rooms = spaceId ? getRoomsInSpace(spaceId) : [];
        roomsState.roomsInSpace = rooms;

        if (spaceId) {
            // Opening a space is a natural moment to catch a joined child room
            // that incremental sync dropped (heals in place, no reload).
            scheduleJoinedRoomsReconcile();
            // The spinner is set inside requestHierarchy's force branch: a
            // coalesced request returns early and must leave the flag exactly
            // as it found it, or it would strand.
            requestHierarchy(spaceId, true);
        } else {
            // Home requests no hierarchy, so no live request can own the flag
            // here. Without this, leaving a space while its fetch is in flight
            // strands the spinner (the result drops on the space check) and
            // suppresses RoomList's "No rooms yet" hint.
            roomsState.hierarchyLoading = false;
        }
    }, [activeSpaceId]);

    // Re-entrancy guard: handleLogout awaits for up to 4s, and a second run
    // in that window would remove the successor account from the registry.
    const loggingOut = useRef(false);

    async function handleLogout() {
        if (loggingOut.current) return;
        loggingOut.current = true;
        // A live call must not survive logout.
        leaveCall();
        // Take the notifications down FIRST: everything below is bounded by a
        // 4s race and then a reload, and a notification left up outlives all
        // of it — with the previous account's sender and message text on it.
        clearAllNotificationSurfaces();
        const client = getClient();
        // Fire the network teardown in the background — don't let a slow/hung
        // request (common on mobile) block the UI from logging out locally.
        if (client) unregisterPush(client).catch(() => {});
        if (client) teardownWebPush(client).catch(() => {});
        clearNativeSession().catch(() => {});
        clearServiceWorkerAuth();
        // Give the server-side token invalidation and the local store wipe a
        // bounded window to finish, then leave via a full reload so no store
        // state survives into the successor account's boot.
        await Promise.race([
            logout(),
            new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
        // Clear local session and leave.
        clearSession();
        window.location.assign("/");
    }

    // Derive directly from activeRoomId (a stable string) rather than the room arrays,
    // so sync-triggered array refreshes don't invalidate this derived and remount MessageArea.
    // Zami: see roomObjectId above.
    const activeRoomObjectId = useRune(() => {
        void roomsState.roomsTick; // re-derive when rooms refresh (e.g. after joining)
        return roomObjectId(resolveActiveRoom());
    });
    const activeRoom = useMemo(
        () => resolveActiveRoom(),
        // Zami: the object id is what changes with it.
        [activeRoomObjectId],
    );

    // Subtle room-switch fade. A WAAPI opacity animation on the (stable) room-pane
    // wrapper — NOT a {#key} remount, which would tear down and rebuild MessageArea
    // on every switch (see the activeRoom-derived comment above). WAAPI is not
    // suppressed by the app.css reduce-motion rule, so motionOK() is the real gate;
    // it is read inside untrack() so toggling reduce-motion never fires a fade, and
    // .animate() is a DOM call (not an SDK send) so it is safe inside the effect.
    // Zami: an opacity shared value on the room pane, which is rendered (as
    // upstream's `roomPaneEl` is bound) when neither the inbox nor a draft DM
    // takes the main pane.
    const ROOM_FADE_MS = 120;
    const roomPaneOpacity = useSharedValue(1);
    const roomPaneShown = !showInbox && !draftDm && !!activeRoom;
    useEffect(() => {
        const rid = activeRoom?.roomId;
        if (!rid || !roomPaneShown) return;
        if (!motionOK()) return;
        roomPaneOpacity.value = 0;
        roomPaneOpacity.value = withTiming(1, {
            duration: ROOM_FADE_MS,
            // ease-out
            easing: Easing.bezier(0, 0, 0.58, 1),
        });
    }, [activeRoom?.roomId, roomPaneShown, roomPaneOpacity]);
    const roomPaneStyle = useAnimatedStyle(() => ({
        opacity: roomPaneOpacity.value,
    }));
    const notificationCount = useRune(() => {
        return getNotificationCount();
    });

    // Zami: not ported: the favicon badge (updateFaviconBadge draws it on a
    // canvas over the page's icon links). The app icon's badge is the
    // closest equivalent; iOS shows it once notifications are allowed.
    useEffect(() => {
        setBadgeCountAsync(notificationCount).catch(() => {});
    }, [notificationCount]);
    // Zami: cleared once, on unmount. Clearing on every change raced the new
    // count (both calls are asynchronous) and could leave the badge at 0.
    useEffect(
        () => () => {
            setBadgeCountAsync(0).catch(() => {});
        },
        [],
    );

    // Desktop tray icon: red dot while there are unread pings.
    // Zami: a no-op without Electron's bridge.
    useEffect(() => {
        setTrayUnread(notificationCount > 0);
        return () => setTrayUnread(false);
    }, [notificationCount]);

    // Zami: React Native touches reach no `window` listener, so the shell
    // hands each touch that starts on it to the window stand-in, for the
    // heartbeat's and presence's input stamps (upstream's passive
    // `touchstart` listeners).
    function onShellTouchStart() {
        window.dispatchEvent({ type: "touchstart" } as Event);
    }

    return (
        <>
            {!isAuthenticated ? (
                <View
                    accessibilityLiveRegion="polite"
                    className="flex-1 flex-row items-center justify-center bg-discord-backgroundTertiary"
                >
                    <View className="flex-row items-center gap-3">
                        <Spin
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            className="w-6 h-6 border-2 border-discord-textMuted border-t-transparent rounded-full"
                        />
                        <Text className="text-discord-textMuted">
                            {t("appShell.redirecting")}
                        </Text>
                    </View>
                </View>
            ) : (
                // The panel arrangement (servers, rooms, chat, member list) keeps the
                // same left-to-right order in every language; each panel's contents
                // get the UI direction back via `dir={uiDir}` wrappers below.
                // Zami: `position: fixed; inset: 0` is the page here (flex-1),
                // padded for the status bar, the notch and the home indicator,
                // which upstream's browser keeps it out of. The bottom inset
                // pads what's at the bottom of each column (below).
                // VoiceOver's escape gesture is upstream's Escape key.
                <GestureDetector gesture={drawerPan}>
                    <View
                        onTouchStart={onShellTouchStart}
                        onAccessibilityEscape={() => {
                            dismissTopmost();
                        }}
                        className="flex-1 flex-row overflow-hidden bg-discord-background"
                        style={{
                            direction: "ltr",
                            paddingTop: insets.top,
                            paddingLeft: insets.left,
                            paddingRight: insets.right,
                        }}
                    >
                        {/* Sync-state indicator: an unobtrusive, non-blocking floating pill (see
                            ReconnectPill) instead of a full-width bar that overlaid the header
                            and read as "the app is frozen". Offline never locks the app. */}
                        <ReconnectPill syncState={syncState} />

                        {!isMobile ? (
                            // Desktop: permanent sidebars + full-width profile footer
                            // Zami: on the footer's color, which shows under it
                            // in the home indicator's inset.
                            <View
                                className="relative flex-col flex-shrink-0 min-h-0 bg-discord-backgroundTertiary"
                                style={{
                                    width: 4.5 * REM_PX + roomListWidth,
                                    paddingBottom: insets.bottom,
                                }}
                            >
                                <View className="flex-row flex-1 min-h-0 overflow-hidden">
                                    <SpaceSidebar
                                        onHomeClick={() => setActiveSpace(null)}
                                        onOpenSpaceSettings={openRoomSettings}
                                    />
                                    {/* Zami: `display: contents` with `dir` is a
                                        flex-1 box with the UI direction. */}
                                    <View
                                        className="flex-1 min-w-0"
                                        style={{ direction: uiDir }}
                                    >
                                        <RoomList
                                            onOpenSpaceSettings={
                                                openRoomSettings
                                            }
                                            onOpenRoomSettings={
                                                openRoomSettings
                                            }
                                        />
                                    </View>
                                </View>
                                <View style={{ direction: uiDir }}>
                                    <UpdateBanner />
                                    <ProfileFooter
                                        onLogout={handleLogout}
                                        onSettings={openAppSettings}
                                    />
                                </View>
                                {/* Room-list resize grip (right edge) */}
                                {/* A focusable separator is the ARIA window-splitter pattern. */}
                                {/* Zami: an adjustable element for VoiceOver and
                                    TalkBack, with the separator's value. */}
                                <GestureDetector gesture={roomListResizeGrip}>
                                    <View
                                        accessible
                                        accessibilityRole="adjustable"
                                        accessibilityLabel={t(
                                            "appShell.resizeRoomList",
                                        )}
                                        accessibilityValue={{
                                            now: roomListWidth,
                                            min: ROOM_LIST_MIN_W,
                                        }}
                                        accessibilityActions={[
                                            { name: "increment" },
                                            { name: "decrement" },
                                        ]}
                                        onAccessibilityAction={(e) =>
                                            onRoomListResizeAction(
                                                e.nativeEvent.actionName,
                                            )
                                        }
                                        className="absolute inset-y-0 -right-1 w-2 z-20 cursor-col-resize touch-none hover:bg-discord-accent/40 focus-visible:bg-discord-accent/40 transition-colors"
                                    />
                                </GestureDetector>
                            </View>
                        ) : (
                            // Mobile: animated drawer + backdrop
                            <>
                                <Animated.View
                                    pointerEvents={
                                        backdropTouchable ? "auto" : "none"
                                    }
                                    accessibilityElementsHidden={
                                        !backdropTouchable
                                    }
                                    importantForAccessibility={
                                        backdropTouchable
                                            ? "auto"
                                            : "no-hide-descendants"
                                    }
                                    className="absolute inset-0 z-30"
                                    style={backdropStyle}
                                >
                                    {/* Zami: the backdrop's click, as a
                                        button for screen readers too. */}
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={t("common.close")}
                                        style={StyleSheet.absoluteFill}
                                        onPress={() => {
                                            if (!isDragging.current)
                                                interfaceState.leftOpen = false;
                                        }}
                                    />
                                </Animated.View>
                                {/* Zami: `inert` → hidden from VoiceOver and
                                    TalkBack and from touches; `aria-hidden` with it.
                                    The drawer pads for the status bar, the home
                                    indicator and a left notch itself: it covers
                                    the shell's padding. */}
                                <Animated.View
                                    onLayout={(e) =>
                                        setDrawerWidth(
                                            e.nativeEvent.layout.width,
                                        )
                                    }
                                    className={`absolute top-0 bottom-0 left-0 z-40 flex-col w-[19.5rem] bg-discord-backgroundTertiary ${
                                        leftDrawerClosed ? "" : "shadow-2xl"
                                    }`}
                                    style={[
                                        {
                                            paddingTop: insets.top,
                                            paddingBottom: insets.bottom,
                                            paddingLeft: insets.left,
                                        },
                                        drawerStyle,
                                    ]}
                                    pointerEvents={
                                        leftDrawerClosed ? "none" : "auto"
                                    }
                                    accessibilityElementsHidden={
                                        leftDrawerClosed
                                    }
                                    importantForAccessibility={
                                        leftDrawerClosed
                                            ? "no-hide-descendants"
                                            : "auto"
                                    }
                                >
                                    <View className="flex-row flex-1 min-h-0 overflow-hidden">
                                        <SpaceSidebar
                                            onHomeClick={() =>
                                                setActiveSpace(null)
                                            }
                                            onOpenSpaceSettings={
                                                openRoomSettings
                                            }
                                        />
                                        <View
                                            className="flex-1 min-w-0"
                                            style={{ direction: uiDir }}
                                        >
                                            <RoomList
                                                onOpenSpaceSettings={
                                                    openRoomSettings
                                                }
                                                onOpenRoomSettings={
                                                    openRoomSettings
                                                }
                                            />
                                        </View>
                                    </View>
                                    <View style={{ direction: uiDir }}>
                                        <ProfileFooter
                                            onLogout={handleLogout}
                                            onSettings={() => {
                                                openAppSettings();
                                                interfaceState.leftOpen = false;
                                            }}
                                        />
                                    </View>
                                </Animated.View>
                            </>
                        )}

                        {/* Zami: the composer pads for the home indicator itself
                            (upstream's `env(safe-area-inset-bottom)` in
                            MessageInput), so the room pane's chat doesn't. */}
                        <View
                            className="flex-row flex-1 min-w-0 overflow-hidden bg-discord-background"
                            style={{
                                direction: uiDir,
                                paddingBottom:
                                    roomPaneShown &&
                                    callViewRoomId !== activeRoom?.roomId
                                        ? 0
                                        : insets.bottom,
                            }}
                        >
                            {showInbox ? (
                                <InboxPanel
                                    isMobile={isMobile}
                                    onMenuOpen={() =>
                                        (interfaceState.leftOpen = true)
                                    }
                                />
                            ) : draftDm ? (
                                <DraftDmView
                                    userId={draftDm.userId}
                                    encrypt={draftDm.encrypt}
                                    isMobile={isMobile}
                                    onMenuOpen={() =>
                                        (interfaceState.leftOpen = true)
                                    }
                                />
                            ) : activeRoom ? (
                                <Animated.View
                                    className="flex-row flex-1 min-w-0 overflow-hidden"
                                    style={roomPaneStyle}
                                >
                                    {callViewRoomId === activeRoom.roomId ? (
                                        <CallView
                                            room={activeRoom}
                                            isMobile={isMobile}
                                            onMenuOpen={() =>
                                                (interfaceState.leftOpen = true)
                                            }
                                        />
                                    ) : (
                                        <MessageArea
                                            room={activeRoom}
                                            isMobile={isMobile}
                                            onMenuOpen={() =>
                                                (interfaceState.leftOpen = true)
                                            }
                                        />
                                    )}
                                </Animated.View>
                            ) : activeSpaceId !== null ? (
                                <SpaceLandingPanel
                                    isMobile={isMobile}
                                    onMenuOpen={() =>
                                        (interfaceState.leftOpen = true)
                                    }
                                />
                            ) : (
                                <View className="flex-1 flex-col items-center justify-center p-8">
                                    <View className="w-24 h-24 rounded-full bg-discord-backgroundSecondary flex-row items-center justify-center mb-6">
                                        <Text className="text-5xl font-bold text-discord-textMuted">
                                            #
                                        </Text>
                                    </View>
                                    {/* Only a spaceless account is genuinely empty. With
                                        spaces joined, Home being empty just means every room
                                        lives in one — saying "no rooms yet" would be a lie. */}
                                    {noSpaces ? (
                                        <>
                                            <Text
                                                accessibilityRole="header"
                                                className="text-2xl font-bold text-discord-textPrimary mb-2 text-center"
                                            >
                                                {t("appShell.noRoomsYet")}
                                            </Text>
                                            <Text className="text-base text-discord-textMuted max-w-sm text-center">
                                                {t(
                                                    "appShell.createARoomOrStartA",
                                                )}
                                            </Text>
                                        </>
                                    ) : (
                                        <>
                                            <Text
                                                accessibilityRole="header"
                                                className="text-2xl font-bold text-discord-textPrimary mb-2 text-center"
                                            >
                                                {t("appShell.nothingInHome")}
                                            </Text>
                                            <Text className="text-base text-discord-textMuted max-w-sm text-center">
                                                {t(
                                                    "appShell.allOfYourRoomsLiveIn",
                                                )}
                                            </Text>
                                        </>
                                    )}
                                    {isMobile && (
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() =>
                                                (interfaceState.leftOpen = true)
                                            }
                                            className="mt-6 px-5 py-2.5 bg-discord-accent hover:bg-discord-accentHover active:bg-discord-accentHover rounded-lg transition-colors"
                                        >
                                            <Text className="text-white text-sm font-semibold">
                                                {t("appShell.openRoomList")}
                                            </Text>
                                        </Pressable>
                                    )}
                                </View>
                            )}
                        </View>

                        {/* Settings overlay */}
                        {/* Zami: it renders through a Portal, which no `dir`
                            reaches; it follows the UI direction itself. */}
                        {modal === "app-settings" && (
                            <AppSettings
                                onClose={closeModal}
                                onLogout={handleLogout}
                            />
                        )}
                    </View>
                </GestureDetector>
            )}

            {modal === "room-settings" && settingsRoom && (
                <RoomSettings
                    room={settingsRoom}
                    onClose={closeModal}
                    onUpdate={() => {
                        if (roomsState.activeSpaceId)
                            roomsState.roomsInSpace = getRoomsInSpace(
                                roomsState.activeSpaceId,
                            );
                    }}
                />
            )}

            {modal === "invite" && inviteRoomId && (
                <InviteModal roomId={inviteRoomId} />
            )}

            {modal === "create-poll" && pollRoomId && <CreatePollDialog />}

            {modal === "share-location" && locationRoomId && (
                <ShareLocationDialog />
            )}

            {modal === "plugin-popover" && <PluginPopoverHost />}

            <PluginOverlayHost />

            {modal === "share-target" && hasSharePayload && (
                <ShareTargetSheet />
            )}

            <CallPipOverlay />

            {/* Zami: `fixed top-4 right-4` → a Portal at the app root, below
                the status bar and clear of a notch. */}
            {(ringing.length > 0 || verificationIncoming.length > 0) && (
                <Portal>
                    <View
                        pointerEvents="box-none"
                        className="absolute z-50 flex-col gap-2"
                        style={{
                            top: 16 + insets.top,
                            right: 16 + insets.right,
                        }}
                    >
                        {ringing.map((roomId) => (
                            <IncomingCallCard
                                key={roomId}
                                roomId={roomId}
                                onAccept={acceptIncomingCall}
                                onDecline={declineIncomingCall}
                            />
                        ))}
                        {verificationIncoming.map((controller) => (
                            <VerificationRequestCard
                                key={controller.id}
                                controller={controller}
                            />
                        ))}
                    </View>
                </Portal>
            )}

            <VerificationModal />
            {encryptionSetupOpen && <EncryptionSetupDialog />}

            {/* Opened by the Ctrl+Shift+T / Ctrl+Shift+N shortcuts. */}
            <QuickActions headless ref={shortcutActions} />
            {quickSwitcherOpen && modal === "quick-switcher" && (
                <QuickSwitcher onClose={closeModal} />
            )}
            {shortcutsHelpOpen && modal === "keyboard-shortcuts" && (
                <KeyboardShortcutsDialog
                    onClose={closeModal}
                    onCustomize={() => openAppSettingsTab("keybinds")}
                />
            )}

            {showWhatsNew && (
                <WhatsNewModal
                    onClose={dismissWhatsNew}
                    lastSeen={whatsNewSince}
                />
            )}

            <ErrorToasts />
            <ScreenSharePicker />

            <UpdateToastWatch />
            <IdentityChangeBanner />
            <JoinConsentDialog />
        </>
    );
}
