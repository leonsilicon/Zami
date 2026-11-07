import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
    memo,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactNode,
    type RefObject,
} from "react";
import {
    Easing,
    Keyboard,
    Platform,
    Pressable,
    Text,
    View,
    type DimensionValue,
    type GestureResponderEvent,
    type HostInstance,
    type LayoutChangeEvent,
    type TextInputInstance,
} from "react-native";
import {
    GestureDetector,
    usePanGesture,
    type PanGestureConfig,
} from "react-native-gesture-handler";
import Svg, { Circle, G, Line, Path } from "react-native-svg";
import { useResolveClassNames } from "uniwind";
import {
    Html,
    Image,
    Portal,
    Pulse,
    Spin,
    SvgIcon,
    anchorElement,
    mediaSource,
    openLink,
    type HtmlElement,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { createLruMemo } from "$lib/utils/lruMemo";

// Module scope is deliberate: a room switch unmounts every MessageItem and
// re-mounts them, so an instance-scoped cache would die before it could
// ever hit. Bounded LRU (~500) because message bodies are stable per event
// id. Each key carries the FULL render inputs (see the wrappers below) so a
// cache hit can never return output computed under different conditions.
const sanitizeCache = createLruMemo<string>(500);
const twemojiCache = createLruMemo<string>(500);

import { t } from "$lib/i18n";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import Avatar from "$lib/components/ui/Avatar.svelte";
import EmojiPicker from "$lib/components/ui/EmojiPicker.svelte";
import PollBody from "$lib/components/messages/PollBody.svelte";
import FileOfferCard from "$lib/components/messages/FileOfferCard.svelte";
import MessageVideo from "$lib/components/messages/MessageVideo.svelte";
import MediaProgress from "$lib/components/ui/MediaProgress.svelte";
import { STREAM_ENCRYPTED_MIN_BYTES } from "$lib/matrix/videoStream";
import {
    canPreviewImage,
    loadImageProgressively,
    PROGRESSIVE_IMAGE_MIN_BYTES,
} from "$lib/matrix/progressiveImage";
import { createFrameRelay } from "$lib/utils/frameRelay";
import { createTileImage } from "$lib/utils/tileImage";
import {
    cacheDecryptedImage,
    cachedDecryptedImage,
    DECRYPTED_IMAGE_ORIGINAL_MAX,
} from "$lib/utils/decryptedImageCache";
import type { DownloadProgress } from "$lib/utils/downloadProgress";
import LocationBody from "$lib/components/messages/LocationBody.svelte";
import VerificationRequestMessage from "$lib/components/messages/VerificationRequestMessage.svelte";
import CallEventCard from "$lib/components/messages/CallEventCard.svelte";
import VoiceMessagePlayer from "$lib/components/messages/VoiceMessagePlayer.svelte";
import ForwardMessageDialog from "$lib/components/messages/ForwardMessageDialog.svelte";
import MessageReportAction, {
    type MessageReportActionHandle,
} from "$lib/components/messages/MessageReportAction.svelte";
import MessageRedactAction, {
    type MessageRedactActionHandle,
} from "$lib/components/messages/MessageRedactAction.svelte";
import MessageActionsSheet from "$lib/components/messages/MessageActionsSheet.svelte";
import {
    messageActionsMenu,
    type MessageActionKey,
} from "$lib/utils/messageActionsMenu";
import EventShield from "./EventShield.svelte";
import MessageDecorations from "$lib/components/messages/MessageDecorations.svelte";
import { Check, Forward, Link, Lock, Reply, Pencil } from "lucide-svelte";
import Reactions from "$lib/components/messages/Reactions.svelte";
import ReactorPopover from "./ReactorPopover.svelte";
import LinkPreview from "$lib/components/messages/LinkPreview.svelte";
import MessageEmbed from "$lib/components/messages/MessageEmbed.svelte";
import { orderReadReceipts } from "$lib/utils/readReceipts";
import { eventFavouriteKey } from "$lib/matrix/favouriteFile";
import Lightbox from "$lib/components/ui/Lightbox.svelte";
import SwfEmbed from "$lib/components/ui/SwfEmbed.svelte";
import {
    getMemberName,
    getMemberAvatar,
    mxcToHttp,
    fetchAttachmentBlob,
    fetchDecryptedAttachmentBlob,
    findEventById,
    fetchSingleEvent,
    sendReaction,
    deleteMessage,
    getMyPowerLevel,
    getRoomPowerLevels,
    getPinnedEventIds,
    pinMessage,
    unpinMessage,
    resendMessage,
    deleteFailedMessage,
    getRoom,
    getMessageShareLink,
    joinRoom,
    seedRoomStateIfMissing,
    getRoomIdForAlias,
    getThreadSummary,
    getThreadName,
    getHomeserverBaseUrl,
    EventStatus,
} from "$lib/matrix/client";
import MessageEditBox from "$lib/components/messages/MessageEditBox.svelte";
import { emoticonsFromHtml } from "$lib/utils/messageBody";
import { saveObjectUrl, revokeLater } from "$lib/utils/saveFile";
import {
    editableBody,
    isEmptyEdit,
    sendMessageEdit,
} from "$lib/matrix/editMessage";
import { resolveBubbleLayout } from "$lib/utils/bubbleLayout";
import {
    parseMatrixLink,
    mergeViaServers,
    linkifyPlainText,
    highlightRoomMention,
    extractEventPermalinks,
    type MatrixLinkTarget,
} from "$lib/utils/matrixLinks";
import { eventPreviewText } from "$lib/utils/eventPreviewText";
import { describeJoinTarget, needsJoinConsent } from "$lib/utils/joinConsent";
import { requestJoinConsent } from "$lib/stores/joinConsent.svelte";
import { isPollStartEventType } from "$lib/utils/pollContent";
import { isFileOfferEventType } from "$lib/utils/fileTransfer";
import { isCallEventType, type CallSummary } from "$lib/utils/callSummary";
import { mayRedactEvent } from "$lib/utils/redaction";
import { isVerificationRequestMessage } from "$lib/utils/verificationMessage";
import { stripFormattedFallback } from "$lib/utils/replyFallback";
import { parseVoiceContent } from "$lib/utils/voiceMessage";
import { isMidiAttachment, midiUrlToWavUrl } from "$lib/utils/midi";
import { isTrackerAttachment, trackerUrlToWavUrl } from "$lib/utils/tracker";
import { reservedMediaBox } from "$lib/utils/mediaDimensions";
import { learnMediaSize, learnedMediaSize } from "$lib/utils/learnedMediaSize";
import { videoPoster } from "$lib/utils/roomMedia";
import { utdPlaceholderText } from "$lib/utils/encryptionState";
import { canRequestRoomKeys, requestRoomKeys } from "$lib/matrix/keyBackfill";
import { matrixErrorMessage } from "$lib/utils/knock";
import { getEventShield, isRoomEncrypted } from "$lib/matrix/crypto";
import {
    sameShield,
    shieldRefreshKey,
    shieldViewForEvent,
    type ShieldView,
} from "$lib/utils/eventShield";
import { sameThreadSummary, type ThreadSummary } from "$lib/utils/threadModel";
import {
    shouldRescanReplyTarget,
    type CachedReplyTarget,
} from "$lib/utils/replyTargetLookup";
import { dispatchDoubleTap, dispatchSwipe } from "$lib/plugins/pluginDispatch";
import {
    pluginMessageActions,
    collectDecorations,
    collectAnnotation,
    type MessageDecoration,
    type PluginMessageActionView,
} from "$lib/utils/pluginMessageActions";
import { pluginRegistry } from "$lib/stores/plugins.svelte";

import { messagesState } from "$lib/stores/messages.svelte";
import {
    roomsState,
    navigateToRoom,
    setActiveSpace,
} from "$lib/stores/rooms.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { securityState } from "$lib/stores/security.svelte";
import { messageTimestamp, timeOnly } from "$lib/utils/timeFormat";
import { renderHtml } from "$lib/utils/twemoji";
import { sanitizeMatrixHtml } from "$lib/utils/sanitizeHtml";
import { renderMessageTimestamps } from "$lib/utils/timestampMarkup";
import {
    isFavouriteGif,
    addFavouriteGif,
    removeFavouriteGif,
    favouritesState,
} from "$lib/stores/favourites.svelte";
import {
    interfaceState,
    openModal,
    closeModal,
    clearModalIfOwner,
    type SlotToken,
} from "$lib/stores/interface.svelte";
import { openProfileCard } from "$lib/stores/profileCard.svelte";
import { nameColourFor } from "$lib/stores/profileFields.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import { isDoubleTap, type TapPoint } from "$lib/utils/doubleTap";
import {
    clampSwipeTranslate,
    resolveSwipeAction,
    swipeRevealStyle,
    swipeStage,
    SWIPE_ENGAGE_PX,
    type SwipeStage,
} from "$lib/utils/swipeGesture";
import { hasMediaCaption, isEditableContent } from "$lib/utils/editableMessage";
import {
    shouldOpenMessageMenu,
    menuModeFromSetting,
} from "$lib/utils/messageGesture";
import { shouldMountActionBar } from "$lib/utils/actionBarMount";
import {
    collectBodyGalleryImages,
    galleryNav,
    isGalleryImage,
    type BodyImageInput,
    type GalleryImage,
} from "$lib/utils/messageBodyGallery";
import { galleryPositionLabel } from "$lib/utils/mediaGallery";
import { siblingUploadIndices } from "$lib/utils/uploadSiblings";
import { motionOK } from "$lib/utils/motionPreference";
import { audioPlaybackMode, audioStatusLabel } from "$lib/utils/audioPlayback";
import { formatCallDuration } from "$lib/utils/callDuration";

import type { ReadReceiptInfo } from "$lib/matrix/client";

// Zami: not ported, as DOM-only actions: `use:spoilers` (Html reveals spoilers
// itself), `use:rovingToolbar` and the row's keyboard focus (no hardware-keyboard
// navigation), `use:authedVideoSrc` and `use:rememberVolume` on the `<audio>`, and
// `use:frameSink` (no canvas). `use:longPress`, `use:swipePan`,
// `use:matrixLinks` and `use:bodyImageGallery` (on Html's image presses) are
// translated below.

type EncryptedFile = {
    url: string;
    key: {
        k: string;
        alg?: string;
        kty?: string;
        ext?: boolean;
        key_ops?: string[];
    };
    iv: string;
    hashes: { sha256: string };
    v?: string;
};

interface Props {
    event: MatrixEvent;
    room: Room;
    showHeader: boolean;
    onReply: (event: MatrixEvent) => void;
    jumpToReply: (eventId: string) => void;
    onOpenThread?: (rootEventId: string) => void;
    editRequested?: boolean;
    onEditDone?: () => void;
    receipts?: ReadReceiptInfo[];
    mentionHighlight?: boolean;
    callSummary?: CallSummary | null;
    /** The chronological event list this row lives in (main timeline or
     *  thread), and this event's index in it. Supplied by the parent so an
     *  image upload can page across its same-burst sibling uploads. When
     *  absent (e.g. a context with no list), the upload opens single-image. */
    timelineEvents?: MatrixEvent[];
    timelineIndex?: number;
}

// Zami: the default `receipts`, one array for every row, so it doesn't change
// on every render.
const NO_RECEIPTS: ReadReceiptInfo[] = [];

// Zami: Zam's inline `<svg fill="currentColor">` icons, drawn by SvgIcon.
const PLAY_PATH = "M8 5v14l11-7z";
const PAUSE_PATH = "M6 19h4V5H6v14zm8-14v14h4V5h-4z";
const MUSIC_PATH = "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z";
const DOWNLOAD_PATH = "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z";
const ERROR_PATH =
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z";
const STAR_PATH =
    "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";
const FILE_PATH =
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z";
const THREAD_CHIP_PATH =
    "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z";
const EDIT_PATH =
    "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z";
const PIN_PATH = "M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z";
const REACTION_PATH =
    "M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM8.5 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM15.5 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM6.89 13.5h10.22c-.8 2.04-2.78 3.5-5.11 3.5s-4.31-1.46-5.11-3.5z";
const REPLY_PATH = "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z";
const THREAD_PATH =
    "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM8 14H6v-2h2v2zm0-3H6V9h2v2zm0-3H6V6h2v2zm7 6h-5v-2h5v2zm3-3h-8V9h8v2zm0-3h-8V6h8v2z";
const MORE_PATH =
    "M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z";
const DELETE_PATH =
    "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z";

// Zami: HTML that Html lays out as blocks (its BLOCK_TAGS).
const BLOCK_HTML =
    /<(?:p|div|blockquote|pre|ul|ol|li|h[1-6]|hr|table|details|summary)[\s/>]/i;

// Zami: swipePan's vertical lock, the movement that hands a drag back to the
// scroller.
const VERTICAL_LOCK_PX = 8;

// Zami: `.own-bubble` in src/app.zami.css, as utilities (Uniwind has no
// component classes). Not ported: its `::after` tail.
const OWN_BUBBLE =
    "self-end max-w-[80%] px-3 py-2 rounded-2xl bg-discord-accent";

function MessageItem({
    event,
    room,
    showHeader,
    onReply,
    jumpToReply,
    onOpenThread,
    editRequested = false,
    onEditDone,
    receipts = NO_RECEIPTS,
    mentionHighlight = false,
    callSummary = null,
    timelineEvents,
    timelineIndex,
}: Props) {
    // Zami: what the deriveds below read, first, as React computes in order.
    // Each rune read is scoped to this row's own values (see useRune).
    const isTouchscreen = useRune(() => interfaceState.isTouchscreen);
    const myUserId = useRune(() => auth.userId);
    // Own messages swap their local `~` id for the real `$id` on the same event
    // object, and the row is keyed by transaction id so it survives that swap
    // (see timelineKey). Re-read on timelineTick, which the local-echo update
    // bumps, so actions gated on a real id light up once the send lands.
    const eventId = useRune(
        () => (void messagesState.timelineTick, event.getId() ?? ""),
        [event],
    );
    const isOwnMessage = event.getSender() === myUserId;

    const canPin = useRune(() => {
        void roomsState.roomsTick;
        const myPl = getMyPowerLevel(room);
        const pl = getRoomPowerLevels(room);
        const pinPl = pl.events?.["m.room.pinned_events"] ?? pl.state_default;
        return myPl >= pinPl;
    }, [room]);
    const isPinned = useRune(() => {
        void roomsState.roomsTick;
        return getPinnedEventIds(room).includes(eventId);
    }, [room, eventId]);
    const canRedact = useRune(() => {
        void roomsState.roomsTick;
        return mayRedactEvent({
            isOwnEvent: isOwnMessage,
            myPowerLevel: getMyPowerLevel(room),
            redactLevel: getRoomPowerLevels(room).redact,
        });
    }, [room, isOwnMessage]);

    // Reaction emoji picker. Local boolean drives this instance's render; the
    // shared modal slot ("reaction-picker") provides mutual exclusion across
    // messages plus central Escape/back dismissal.
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);

    // Our claim on the shared modal slot (reaction picker OR forward dialog —
    // one holder is enough, since only the latest claim can still own it).
    // Plain let: read only from teardown, never from markup or a tracked read.
    const slotToken = useRef<SlotToken>(0);
    // Zami: the event id as of the latest render, for the close handlers the
    // slot runs later.
    const eventIdRef = useRef(eventId);
    eventIdRef.current = eventId;

    // Release the shared modal slot if this row is destroyed while still
    // owning it (e.g. the room changes under an open picker) — otherwise the
    // slot strands and swallows the next Escape.
    useEffect(
        () => () => {
            clearModalIfOwner(slotToken.current);
        },
        [],
    );

    function openReactionPicker() {
        // Claim first — a same-id handover runs the outgoing close.
        slotToken.current = openModal("reaction-picker", () => {
            setShowEmojiPicker(false);
            // Only release the selection if it is still ours: a handover to
            // another message row must not clear that row's selection.
            if (interfaceState.selectedMessageId === eventIdRef.current)
                interfaceState.selectedMessageId = null;
        });
        setShowEmojiPicker(true);
    }

    // Zami: not ported: closing the desktop picker on a mousedown outside it
    // (a document listener). Escape, the button and a pick close it.
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [pinning, setPinning] = useState(false);
    const [showForwardDialog, setShowForwardDialog] = useState(false);

    // Zami: no INTERACTIVE_TARGET_SELECTOR: a touch on a link, button or other
    // pressable inside the row is that element's (the responder system gives it
    // to the innermost one), so the row's press and hold never see it.

    const previousTap = useRef<TapPoint | null>(null);

    // Set by a fired long-press so onMessageTouchEnd does not also record the
    // hold-release as a tap (which could make the next tap read as a double-tap).
    // Zami: no heldJustFired: Pressable never presses after a hold, so the
    // release can't read as a tap (and there's no touchcancel to clear it on).

    // Swipe-to-reply (item 6). swipeTranslate drives the row slide; swipeStageNow
    // drives the reveal button's icon; swipeAnimating enables the snap-back
    // transition; swipedThisTouch suppresses the tap/double-tap that would else
    // fire on the same touch release (set during the engaged move, before touchend).
    // Zami: swipeTranslate and swipeDx live in a small store that only the
    // sliding view and the reveal read, so a drag doesn't re-render the row;
    // the store runs the snap-back too.
    const [swipe] = useState(createSwipeStore);
    const [swipeStageNow, setSwipeStageNow] = useState<SwipeStage>("none");
    const swipeStageRef = useRef<SwipeStage>("none");
    const swipedThisTouch = useRef(false);
    // Zami: when the swipe ended (0 while it's under way), so only its own
    // release counts as "this touch": the pan usually cancels the row's press,
    // leaving none, and the next real tap mustn't be taken for it.
    const swipeEndedAt = useRef(0);

    // Zami: `swipeEnabledHere` is SwipePan's (below), so a modal opening
    // re-renders each row's pan, not the row. Whether this device swipes at
    // all decides if the row creates a pan handler.
    const swipeOffered = useRune(
        () => (
            void pluginRegistry.tick,
            interfaceState.isTouchscreen &&
                pluginRegistry.swipeHandlers.length > 0
        ),
    );

    // Read-receipt reader-list popover (click/tap the avatar cluster).
    const [readerOpen, setReaderOpen] = useState(false);
    const [readerTouch, setReaderTouch] = useState(false);
    const [readerX, setReaderX] = useState(0);
    const [readerY, setReaderY] = useState(0);
    const receiptBtnEl = useRef<HostInstance>(null);

    const receiptCap = isTouchscreen ? 2 : 3;
    const receiptCluster = useMemo(
        () => orderReadReceipts(receipts, myUserId, receiptCap),
        [receipts, myUserId, receiptCap],
    );
    const receiptReaderList = useMemo(
        () => orderReadReceipts(receipts, myUserId, 20),
        [receipts, myUserId],
    );

    function openReaderList() {
        // Zami: the cluster's box, measured, for the popover's anchor.
        const el = receiptBtnEl.current;
        const touch = interfaceState.isTouchscreen;
        const open = (x: number, y: number, width: number) => {
            setReaderX(x + width / 2);
            setReaderY(y);
            setReaderTouch(touch);
            setReaderOpen(true);
        };
        if (el) el.measureInWindow((x, y, width) => open(x, y, width));
        else open(0, 0, 0);
    }
    function closeReaderList() {
        setReaderOpen(false);
    }

    // Close the reader list if this message's receipts empty out while it is
    // open (a receipt can advance to a newer event), so it can never linger
    // stale and spuriously reopen when receipts later return to this row.
    useEffect(() => {
        if (receipts.length === 0) setReaderOpen(false);
    }, [receipts.length]);

    function openForwardDialog() {
        // Claim first — a same-id handover runs the outgoing close.
        slotToken.current = openModal("forward-message", () => {
            setShowForwardDialog(false);
            // Only release the selection if it is still ours.
            if (interfaceState.selectedMessageId === eventIdRef.current)
                interfaceState.selectedMessageId = null;
        });
        setShowForwardDialog(true);
    }

    function runDoubleTapAction() {
        if (isFailed) return;
        // Double-tap behavior lives in the double-tap-reply built-in plugin
        // (item 16). Core only detects the gesture and dispatches; the isFailed
        // guard keeps it off unsent local echoes.
        dispatchDoubleTap(
            pluginRegistry.doubleTapHandlers.map((e) => e.value),
            { roomId: room.roomId, eventId, isOwn: isOwnMessage },
        );
        interfaceState.selectedMessageId = null;
    }

    function handleRowGesture(kind: "tap" | "hold") {
        if (!interfaceState.isTouchscreen) return;
        if (!shouldOpenMessageMenu(menuMode, kind)) return;
        interfaceState.selectedMessageId =
            interfaceState.selectedMessageId === eventId ? null : eventId;
    }

    function onSwipeEngage() {
        swipedThisTouch.current = true;
        swipeEndedAt.current = 0;
        swipe.stop();
    }
    function onSwipeMove(translateX: number, stage: SwipeStage, dx: number) {
        swipe.set(translateX, dx);
        // Haptic tick when a new threshold is first crossed (not on the way back).
        // Zami: expo-haptics for navigator.vibrate(10).
        if (stage === swipeStageRef.current) return;
        if (stage === "far" ? canEditMessage : stage === "short") {
            void Haptics.selectionAsync();
        }
        swipeStageRef.current = stage;
        setSwipeStageNow(stage);
    }
    function onSwipeRelease(stage: SwipeStage) {
        if (stage !== "none" && !isFailed) {
            dispatchSwipe(
                pluginRegistry.swipeHandlers.map((e) => e.value),
                {
                    roomId: room.roomId,
                    eventId,
                    isOwn: isOwnMessage,
                    canEdit: canEditMessage,
                    threshold: stage, // "short" | "far" (never "none" here)
                },
            );
        }
        // Snap back.
        swipeEndedAt.current = Date.now();
        swipe.snapBack(motionOK());
        swipeStageRef.current = "none";
        setSwipeStageNow("none");
    }
    function onSwipeCancel() {
        swipeEndedAt.current = Date.now();
        swipe.snapBack(motionOK());
        swipeStageRef.current = "none";
        setSwipeStageNow("none");
    }
    // Zami: what the pan's callbacks (created once per enable) call.
    const swipeHandlers = useRef<SwipeHandlers>({
        onEngage: onSwipeEngage,
        onMove: onSwipeMove,
        onRelease: onSwipeRelease,
        onCancel: onSwipeCancel,
    });
    swipeHandlers.current = {
        onEngage: onSwipeEngage,
        onMove: onSwipeMove,
        onRelease: onSwipeRelease,
        onCancel: onSwipeCancel,
    };

    // Zami: the row's `touchend`, from its press. Returns whether it consumed
    // the tap (upstream's `preventDefault()`, which also cancels the click).
    function onMessageTouchEnd(e: GestureResponderEvent): boolean {
        if (!interfaceState.isTouchscreen) return false;

        if (swipedThisTouch.current) {
            swipedThisTouch.current = false;
            previousTap.current = null;
            if (
                swipeEndedAt.current === 0 ||
                Date.now() - swipeEndedAt.current < 300
            )
                return true;
        }

        // Zami: no text selection to defer to: message text isn't selectable.
        const current = {
            at: Date.now(),
            x: e.nativeEvent.pageX,
            y: e.nativeEvent.pageY,
        };
        if (isDoubleTap(previousTap.current, current)) {
            previousTap.current = null;
            runDoubleTapAction();
            return true;
        } else {
            previousTap.current = current;
        }
        return false;
    }

    // Mouse equivalent of the touch double-tap. A desktop dblclick would
    // normally select a word; only steal it when a double-tap plugin handler
    // is registered (the double-tap-reply plugin registers one only while an
    // action is configured). No handler → leave native word-select.
    // Zami: a second press within the double-tap window stands in for dblclick.
    function onMessageDblClick(e: GestureResponderEvent) {
        if (interfaceState.isTouchscreen) return;
        const current = {
            at: Date.now(),
            x: e.nativeEvent.pageX,
            y: e.nativeEvent.pageY,
        };
        const double = isDoubleTap(previousTap.current, current);
        previousTap.current = double ? null : current;
        if (!double) return;
        if (pluginRegistry.doubleTapHandlers.length === 0) return;
        runDoubleTapAction();
    }

    // Zami: the row's press: its `touchend` runs first, as in the browser, and
    // the click only when the touch end didn't consume it.
    function onRowPress(e: GestureResponderEvent) {
        if (onMessageTouchEnd(e)) return;
        onMessageDblClick(e);
        handleRowGesture("tap");
    }

    // Zami: `use:longPress` (500 ms, 50 ms vibrate), offered only in hold mode,
    // as its `shouldStart` gate. Pressable's own hold timer cancels on a move.
    function onRowLongPress() {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        previousTap.current = null;
        handleRowGesture("hold");
    }

    const [showReportDialog, setShowReportDialog] = useState(false);
    const [showRedactDialog, setShowRedactDialog] = useState(false);

    const [keyboardOffset, setKeyboardOffset] = useState(0);
    // Only track the on-screen keyboard while THIS row actually has a
    // sheet open. These are two GLOBAL listeners per instance, and this
    // component is instantiated once per timeline row — ungated on a
    // touchscreen (which Chrome's device emulation reports) a few hundred rows
    // meant a few hundred pairs of visualViewport listeners, all firing on
    // every scroll and resize. keyboardOffset is consumed by exactly three
    // things: the touch emoji sheet, the report dialog, and the redact dialog.
    // Zami: the keyboard's height from React Native's Keyboard events, for
    // `visualViewport`.
    const keyboardWanted =
        isTouchscreen &&
        (showEmojiPicker || showReportDialog || showRedactDialog);
    useEffect(() => {
        if (!keyboardWanted) {
            setKeyboardOffset(0);
            return;
        }
        const ios = Platform.OS === "ios";
        const shown = Keyboard.addListener(
            ios ? "keyboardWillShow" : "keyboardDidShow",
            (e) => setKeyboardOffset(Math.max(0, e.endCoordinates.height)),
        );
        const hidden = Keyboard.addListener(
            ios ? "keyboardWillHide" : "keyboardDidHide",
            () => setKeyboardOffset(0),
        );
        setKeyboardOffset(
            Keyboard.isVisible() ? (Keyboard.metrics()?.height ?? 0) : 0,
        );
        return () => {
            shown.remove();
            hidden.remove();
        };
    }, [keyboardWanted]);

    // Zami: not ported: the delete confirmation's keyboard focus (focusing Yes,
    // ArrowLeft/ArrowRight between Yes and No, Enter and Escape).
    const deleteRefocus = useRef(false);

    function resolveDelete(confirmed: boolean) {
        setConfirmingDelete(false);
        if (confirmed) {
            deleteMessage(room.roomId, eventId).catch((err) => {
                console.error("[MessageItem] delete failed", err);
                showErrorToast(t("messageItem.couldnTDeleteTheMessage"));
            });
        }
        if (deleteRefocus.current) {
            deleteRefocus.current = false;
            onEditDone?.();
            return;
        }
        // Zami: no refocusing the row, which upstream does for the keyboard.
    }

    const [imageLightboxOpen, setImageLightboxOpen] = useState(false);
    // Paged lightbox over a single message's OWN inline body images (rich/bridged
    // messages with several <img> in the formatted_body). Null = closed.
    const [bodyGallery, setBodyGallery] = useState<{
        images: GalleryImage[];
        index: number;
    } | null>(null);
    function openBodyGallery(images: GalleryImage[], index: number) {
        setBodyGallery({ images, index });
    }

    // Zami: `use:bodyImageGallery` on Html's image presses (Html leaves out
    // emotes and spoilered images, as the action's click handler does): this
    // body's media images, in order, opened at the pressed one.
    function onBodyImagePress(
        _src: string,
        pressed: HtmlElement,
        imgs: HtmlElement[],
    ) {
        const describe = (img: HtmlElement): BodyImageInput => {
            const src = img.attrs.src ?? "";
            return {
                src: src.startsWith("mxc://") ? mxcToHttp(src) : src,
                alt: img.attrs.alt ?? null,
                emoticon: "data-mx-emoticon" in img.attrs,
                twemoji: /(^|\s)(name-)?twemoji(\s|$)/.test(
                    img.attrs.class ?? "",
                ),
            };
        };
        const gallery = imgs.filter((img) => isGalleryImage(describe(img)));
        const index = gallery.indexOf(pressed);
        if (index < 0) return;
        const images = collectBodyGalleryImages(gallery.map(describe));
        if (images.length === 0) return;
        openBodyGallery(images, index);
    }

    // Paged lightbox over this sender's ADJACENT image UPLOADS in the same burst
    // (a run of consecutive m.image messages). Null = closed. Distinct from
    // bodyGallery (inline formatted_body images of ONE message).
    const [uploadGallery, setUploadGallery] = useState<{
        images: GalleryImage[];
        index: number;
    } | null>(null);

    // Called by the m.image tile onclick. Opens the PAGED lightbox when this
    // upload has ≥2 same-burst sibling uploads; otherwise the unchanged
    // single-image lightbox (which also covers encrypted images).
    function openImageUpload() {
        const events = timelineEvents;
        const idx = timelineIndex;
        if (events && idx != null && idx >= 0 && idx < events.length) {
            const pageable = events.map(isPageableImageUpload);
            const indices = siblingUploadIndices(events, pageable, idx);
            if (indices.length > 1) {
                setUploadGallery({
                    images: indices.map((i) => uploadImageOf(events[i])),
                    index: indices.indexOf(idx),
                });
                return;
            }
        }
        requestFullImage.current?.();
        setImageLightboxOpen(true);
    }

    const [emojiPickerBelow, setEmojiPickerBelow] = useState(false);
    const reactionBtnEl = useRef<HostInstance>(null);
    const [isEditing, setIsEditing] = useState(false);
    const editFromKeyboard = useRef(false);
    const [editText, setEditText] = useState("");
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const rootEl = useRef<HostInstance>(null);
    const editBoxEl = useRef<TextInputInstance>(null);
    const avatarBtnEl = useRef<HostInstance>(null);
    const nameBtnEl = useRef<HostInstance>(null);

    const reactionTick = useRune(() => messagesState.reactionTick);
    const mobileSelected = useRune(
        () =>
            interfaceState.isTouchscreen &&
            interfaceState.selectedMessageId === eventId,
        [eventId],
    );

    // The action bar mounts on demand (see actionBarMount.ts). Hover is
    // pointer-only: mobile browsers fire compat mouse events on tap, and a
    // touch row only shows its bar while selected (`mobileSelected`).
    // Zami: no `rowFocused`: keyboard focus isn't ported.
    const [rowHovered, setRowHovered] = useState(false);
    // Open and visible no matter where the pointer or focus is.
    const actionBarPinned =
        showEmojiPicker ||
        confirmingDelete ||
        showReportDialog ||
        showRedactDialog ||
        mobileSelected;
    const mountActionBar = shouldMountActionBar({
        hovered: rowHovered,
        focused: false,
        pinned: actionBarPinned,
    });

    const menuMode = useRune(() =>
        menuModeFromSetting(settingsState.holdToOpenMessageMenu),
    );

    const alignOwnEnabled = useRune(() => settingsState.rightAlignOwnBubbles);
    const bubble = useMemo(
        () =>
            resolveBubbleLayout({
                isOwn: isOwnMessage,
                alignOwnEnabled,
                showHeader,
            }),
        [isOwnMessage, alignOwnEnabled, showHeader],
    );
    // Width the receipt cluster button occupies: 16px avatars with a 2px gap,
    // the "+N" label (ms-1 + text), and 4px of breathing room. Only the
    // bottom-right anchor can overlap trailing text; right-aligned own bubbles
    // move the cluster to the left.
    const receiptSpacerWidth = (() => {
        if (receipts.length === 0 || bubble.alignOwn) return 0;
        const n = receiptCluster.shown.length;
        const avatars = Math.max(24, n * 16 + Math.max(0, n - 1) * 2);
        const overflow =
            receiptCluster.overflow > 0
                ? 4 + 6 * (String(receiptCluster.overflow).length + 1)
                : 0;
        return avatars + overflow + 4;
    })();
    const isEdited = useRune(() => {
        void messagesState.reactionTick;
        // An encrypted edit is applied once it decrypts; content re-reads on
        // this tick then, so the indicator must too or the edited text shows
        // without it.
        void messagesState.timelineTick;
        return !!event.replacingEvent();
    }, [event]);

    // A failed (NOT_SENT) local echo: the send errored and the SDK is blocking
    // further sends in this room until it's retried or removed.
    // Zami: the status is read once, for this and the shield's key below.
    const eventStatus = useRune(
        () => (void messagesState.timelineTick, event.status),
        [event],
    );
    const isFailed = eventStatus === EventStatus.NOT_SENT;
    const [isResending, setIsResending] = useState(false);

    async function retrySend() {
        if (isResending) return;
        setIsResending(true);
        try {
            await resendMessage(event);
        } catch (err) {
            console.error("Failed to resend:", err);
        } finally {
            setIsResending(false);
        }
    }

    const [linkCopied, setLinkCopied] = useState(false);
    const linkCopiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );
    async function copyMessageLink() {
        try {
            // Zami: expo-clipboard for navigator.clipboard.
            await Clipboard.setStringAsync(
                getMessageShareLink(room.roomId, eventId),
            );
            setLinkCopied(true);
            clearTimeout(linkCopiedTimer.current);
            linkCopiedTimer.current = setTimeout(
                () => setLinkCopied(false),
                1500,
            );
        } catch {
            showErrorToast(t("messageItem.couldnTCopyTheMessageLink"));
        }
    }

    const senderId = event.getSender() ?? "";
    // Depend on roomsTick so a sender whose member loads AFTER this row rendered
    // (lazy-loaded/bridged members) re-resolves from raw MXID to name+avatar —
    // getMember reads don't re-run when the member mutates in place.
    const displayName = useRune(
        () => (void roomsState.roomsTick, getMemberName(room, senderId)),
        [room, senderId],
    );
    const avatarSrc = useRune(
        () => (void roomsState.roomsTick, getMemberAvatar(room, senderId)),
        [room, senderId],
    );
    const nameColour = useRune(() => nameColourFor(senderId), [senderId]);
    const timestamp = event.getTs();
    const content = useRune(() => {
        void messagesState.reactionTick;
        // A live MatrixEvent mutates IN PLACE when it decrypts (same reference),
        // so depend on timelineTick — bumped on MatrixEventEvent.Decrypted — or
        // the encrypted envelope's (empty) content sticks after decryption.
        void messagesState.timelineTick;
        return event.getContent();
    }, [event]);
    // Likewise tick-dependent: getType() flips "m.room.encrypted" → the cleartext
    // type on decryption without changing the object reference, so a plain
    // $derived(event.getType()) would keep the UTD placeholder up forever.
    const eventType = useRune(
        () => (void messagesState.timelineTick, event.getType()),
        [event],
    );

    const msgtype: string = content?.msgtype ?? "";

    // Still encrypted, or failed to decrypt: a failure swaps in an
    // m.room.message stand-in (msgtype m.bad.encrypted) whose body is the
    // SDK's raw "** Unable to decrypt **" text, so the type alone misses it.
    const isUtd = useRune(
        () =>
            eventType === "m.room.encrypted" ||
            (void messagesState.timelineTick, event.isDecryptionFailure()),
        [event, eventType],
    );

    // Gate for Edit action: your own m.text messages, plus the caption of your
    // own captioned media (MSC2530), can be edited inline.
    const canEditMessage =
        isOwnMessage &&
        eventType === "m.room.message" &&
        isEditableContent(content);

    // Swipe reveal icon: "none" | "reply" | "edit" (depends on canEditMessage).
    const swipeRevealIcon = resolveSwipeAction(swipeStageNow, canEditMessage);

    // UTD body copy, refined by the decryption-failure reason: a deliberate
    // key-withhold reads differently from transient key-lag. Tick-bound for the
    // same reason as eventType — the reason lands on the same object when the
    // Decrypted event fires and bumps timelineTick.
    // Zami: only a UTD row reads them, so the others don't follow the tick.
    const utdText = useRune(
        () =>
            isUtd
                ? (void messagesState.timelineTick,
                  utdPlaceholderText(event.decryptionFailureReason))
                : "",
        [event, isUtd],
    );
    const utdRequestable = useRune(
        () =>
            isUtd
                ? (void messagesState.timelineTick,
                  canRequestRoomKeys(event.decryptionFailureReason))
                : false,
        [event, isUtd],
    );
    // "Request keys" on a UTD row: idle, sending, or sent (stays sent, so a
    // second click can't pile up requests; the row unlocks if an answer comes).
    const [keyRequest, setKeyRequest] = useState<"idle" | "sending" | "sent">(
        "idle",
    );

    async function onRequestKeys(): Promise<void> {
        if (keyRequest !== "idle") return;
        setKeyRequest("sending");
        try {
            await requestRoomKeys(event);
        } finally {
            setKeyRequest("sent");
        }
    }

    // Whether this room has encryption switched on. Tick-bound because the Room
    // mutates in place when the m.room.encryption state event lands.
    const roomEncrypted = useRune(
        () => (void roomsState.roomsTick, isRoomEncrypted(room)),
        [room],
    );

    // Per-message E2EE shield. getEncryptionInfoForEvent is ASYNC, so this
    // cannot be a $derived — it's $state written from an $effect. The effect
    // re-runs on timelineTick (an event decrypting late gets a shield it did
    // not have) and on securityTick (verifying a device changes the shield on
    // every message that device sent; crypto.ts drops its memo on the same
    // events).
    // Zami: the effect depends on what moves this row's shield (the
    // shieldRefreshKey inputs) rather than on timelineTick itself, so a row
    // doesn't re-render on every tick; a fetch that failed listens to
    // timelineTick until it can retry, as upstream's gate allows.
    const [shield, setShield] = useState<ShieldView | null>(null);
    // The last shield inputs we actually fetched for. Plain `let`, NOT $state:
    // like `lastThreadSummary` below, a memo cell written from inside a tracked
    // scope must stay invisible to the reactivity graph. Component scope, not
    // module scope — one row's verdict must never leak into another row.
    const lastShieldKey = useRef<string | null>(null);
    const [shieldRetry, setShieldRetry] = useState(false);
    const shieldRetryTick = useRune(
        () => (shieldRetry ? messagesState.timelineTick : 0),
        [shieldRetry],
    );
    const securityTick = useRune(
        () => (roomEncrypted ? securityState.securityTick : 0),
        [roomEncrypted],
    );
    const shieldKey = roomEncrypted
        ? // timelineTick is bumped for EVERY timeline event and every decryption
          // anywhere in the app, and there is one of these effects per rendered row.
          // getEventShield deliberately does not memoize null results or local
          // echoes, so an unguarded call re-hits the crypto layer per row per event.
          // Skip when nothing that can move THIS row's shield has changed; the tick
          // dependencies above stay exactly as they were.
          shieldRefreshKey({
              eventId,
              eventType,
              status: eventStatus,
              securityTick,
          })
        : null;
    useEffect(() => {
        void shieldRetryTick;
        if (shieldKey === null) {
            // Assigning the same primitive is already a no-op for $state
            // (referential equality), so this costs nothing on repeat ticks —
            // and reading `shield` here would make the effect depend on it.
            setShield(null);
            // A room can be switched ON: forget the key so the next encrypted
            // pass refetches rather than trusting a pre-encryption verdict.
            lastShieldKey.current = null;
            return;
        }

        const key = shieldKey;
        if (key === lastShieldKey.current) return;
        lastShieldKey.current = key;

        const id = eventId;
        let cancelled = false;
        let settled = false;
        void getEventShield(event)
            .then((info) => {
                settled = true;
                // A late resolution must not overwrite a newer row's state.
                if (cancelled || event.getId() !== id) return;
                const next = shieldViewForEvent({
                    roomEncrypted: true,
                    info,
                });
                // shieldViewForEvent mints a fresh object every call, so an
                // unconditional assign would dirty this row on EVERY
                // timelineTick — i.e. every row in the timeline re-renders
                // on every sync. Only write when the value actually moved.
                setShield((shield) =>
                    sameShield(shield, next) ? shield : next,
                );
                setShieldRetry(false);
            })
            .catch(() => {
                settled = true;
                if (!cancelled) setShield(null);
                // A failed fetch must be retryable on the next real change.
                lastShieldKey.current = null;
                if (!cancelled) setShieldRetry(true);
            });
        return () => {
            cancelled = true;
            // This teardown runs before every RE-RUN, not just on destroy. A
            // tick landing mid-flight therefore cancels a fetch that was still
            // going to produce this row's verdict — and with the key gate above
            // the re-run would decline to retry, leaving the shield silently
            // absent. Only remember a key whose fetch actually got to settle.
            if (!settled) lastShieldKey.current = null;
        };
    }, [shieldKey, shieldRetryTick, event, eventId]);

    // --- Mobile action overflow ("⋯ More") sheet ---
    // Extracted so the desktop pin button and the mobile sheet run the same
    // toggle rather than diverging copies.
    async function togglePin() {
        if (pinning) return;
        setPinning(true);
        const wasPinned = isPinned;
        try {
            if (wasPinned) await unpinMessage(room, eventId);
            else await pinMessage(room, eventId);
        } catch (e) {
            console.error("Failed to update pinned messages", e);
            showErrorToast(
                wasPinned
                    ? t("messageItem.failedToUnpinMessage")
                    : t("messageItem.failedToPinMessage"),
            );
        } finally {
            setPinning(false);
        }
    }

    const [showActionsSheet, setShowActionsSheet] = useState(false);
    // Bound to the touch-only, trigger-less Report/Redact instances so the
    // sheet can open their dialogs (which live inside those components).
    const reportComp = useRef<MessageReportActionHandle>(null);
    const redactComp = useRef<MessageRedactActionHandle>(null);
    // Zami: those instances mount the first time the sheet asks for one,
    // rather than with every row (two components per row of someone else's
    // message, on a timeline of hundreds), and the dialog opens once mounted.
    const [touchDialogsMounted, setTouchDialogsMounted] = useState(false);
    const pendingDialog = useRef<"report" | "redact" | null>(null);
    useEffect(() => {
        const pending = pendingDialog.current;
        if (!pending) return;
        const comp = pending === "report" ? reportComp : redactComp;
        if (!comp.current) return;
        pendingDialog.current = null;
        comp.current.show();
    });
    function showTouchDialog(which: "report" | "redact") {
        const comp = which === "report" ? reportComp : redactComp;
        if (comp.current) {
            comp.current.show();
            return;
        }
        pendingDialog.current = which;
        setTouchDialogsMounted(true);
    }

    // Plugin-contributed message actions for THIS message, filtered by each
    // action's `when` gate. Additive — never replaces a core action.
    // Zami: kept while they render the same, so a row doesn't re-render for a
    // fresh but equal list (none, for most rows).
    const lastPluginActionViews = useRef<PluginMessageActionView[]>(NO_ACTIONS);
    const pluginActionViews = useRune(() => {
        void pluginRegistry.tick;
        const next = pluginMessageActions(pluginRegistry.messageActions, {
            roomId: room.roomId,
            eventId,
            msgtype,
        });
        if (sameActionViews(lastPluginActionViews.current, next))
            return lastPluginActionViews.current;
        lastPluginActionViews.current = next;
        return next;
    }, [room.roomId, eventId, msgtype]);

    // Text a plugin shows under a voice message (a transcript).
    // Zami: read as one string (busy flag, then text) so an equal annotation
    // doesn't re-render the row; only voice messages show one.
    const pluginAnnotationKey = useRune(() => {
        void pluginRegistry.tick;
        if (msgtype !== "m.audio") return null;
        const annotation = collectAnnotation(pluginRegistry.annotators, {
            roomId: room.roomId,
            eventId,
            msgtype,
        });
        if (!annotation) return null;
        return `${annotation.busy ? "1" : "0"}${annotation.text ?? "\u0000"}`;
    }, [room.roomId, eventId, msgtype]);
    const pluginAnnotation =
        pluginAnnotationKey === null
            ? null
            : {
                  busy: pluginAnnotationKey[0] === "1",
                  text:
                      pluginAnnotationKey.slice(1) === "\u0000"
                          ? undefined
                          : pluginAnnotationKey.slice(1),
              };

    // Additive plugin decorations for THIS message (badges/tooltips overlaid
    // on the row). Never touches body rendering (interop rule).
    const lastDecorations = useRef<MessageDecoration[]>(NO_DECORATIONS);
    const decorations = useRune(() => {
        void pluginRegistry.tick;
        const next = collectDecorations(pluginRegistry.decorators, {
            roomId: room.roomId,
            eventId,
            senderId,
        });
        if (sameDecorations(lastDecorations.current, next))
            return lastDecorations.current;
        lastDecorations.current = next;
        return next;
    }, [room.roomId, eventId, senderId]);

    function openActionsSheet() {
        // Claim the single modal slot so opening the sheet closes any other
        // open modal, and Escape/handover route back through closeModal.
        slotToken.current = openModal("message-actions", () => {
            setShowActionsSheet(false);
        });
        setShowActionsSheet(true);
    }

    function handleActionChoose(key: MessageActionKey) {
        // The sheet has already released the modal slot (it closes before
        // choosing), so report/redact are free to claim it via show().
        switch (key) {
            case "thread":
                onOpenThread?.(threadRootId);
                break;
            case "edit":
                startEdit();
                break;
            case "pin":
                void togglePin();
                break;
            case "copy-link":
                void copyMessageLink();
                break;
            case "report":
                showTouchDialog("report");
                break;
            case "redact":
                showTouchDialog("redact");
                break;
            case "delete":
                deleteMessage(room.roomId, eventId).catch((err) => {
                    console.error("[MessageItem] delete failed", err);
                    showErrorToast(t("messageItem.couldnTDeleteTheMessage"));
                });
                break;
        }
    }

    function handlePluginAction(key: string) {
        const view = pluginActionViews.find((v) => v.key === key);
        if (!view) return;
        try {
            const r = view.run();
            if (r && typeof r.then === "function")
                r.catch((err) =>
                    console.error("[zam] plugin message action threw", err),
                );
        } catch (err) {
            console.error("[zam] plugin message action threw", err);
        }
    }

    const isPoll = isPollStartEventType(eventType);
    const isFileOffer = isFileOfferEventType(eventType);
    const isCallEvent = isCallEventType(eventType);
    // In-room verification requests ride in as m.room.message; their plain-text
    // body claims this client can't do in-chat verification (it can), so they
    // get a card instead of the fallback text.
    const isVerificationRequest = isVerificationRequestMessage(
        eventType,
        msgtype,
    );

    // Whether the event's ORIGINAL content declared a reply relation. A rich-
    // reply fallback ("> quoted…" body / <mx-reply> block) can only legally
    // exist on a reply, so we strip it only when this is true. We read the
    // ORIGINAL content (not the edited getContent()) because an edit drops the
    // reply relation from getContent() while the fallback stays in the body.
    const isReply = useRune(
        () => (
            void messagesState.timelineTick,
            !!event.getOriginalContent()?.["m.relates_to"]?.["m.in_reply_to"]
        ),
        [event],
    );

    // Strip the Matrix rich-reply fallback ("> quoted…\n\n") from body via the
    // shared spec-v1.19 algorithm. Spec v1.13 removed the fallback; legacy
    // senders may still include it. We render the quote from the referenced
    // event, so the fallback is always redundant here.
    // Zami: computed once per content, and called as upstream calls it.
    const body = useMemo(() => {
        void content;
        const value = editableBody(event);
        return () => value;
    }, [content, event]);

    // The original file name of an uploaded media event. Per MSC2530, when a
    // caption is present the file name lives in `filename` and `body` holds the
    // caption; otherwise `body` is the file name.
    const mediaFilename: string =
        (content?.filename as string | undefined) ??
        (content?.body as string | undefined) ??
        "";
    // A media caption exists when `filename` is present and differs from `body`
    // (i.e. `body` is real caption text, not just the file name). We render it as
    // a normal message above the media rather than as a label on the media.
    const hasCaption = useMemo(() => {
        const value = hasMediaCaption(content);
        return () => value;
    }, [content]);

    // Strip a leading <mx-reply> fallback from formatted_body so we don't
    // double-render the quote (we render it from the referenced event). Uses the
    // shared DOM-based strip — the old regex was evadable via mx-reply attrs.
    const formattedBody = useMemo(() => {
        const value = (() => {
            const raw = content?.formatted_body as string | undefined;
            if (!raw) return undefined;
            // Spec: formatted_body is only meaningful when the sender declared the
            // custom-HTML format. Otherwise fall through to the plain-body path.
            if (content?.format !== "org.matrix.custom.html") return undefined;
            // Zami: stripFormattedFallback needs a DOMParser, which React
            // Native lacks; Html drops <mx-reply> and its content anyway.
            return (
                isReply && typeof DOMParser !== "undefined"
                    ? stripFormattedFallback(raw)
                    : raw
            ).trim();
        })();
        return () => value;
    }, [content, isReply]);

    // Replied-to event, if this is a reply
    const inReplyToId = useMemo(() => {
        // Thread replies carry an m.in_reply_to that is only a DISPLAY fallback
        // (is_falling_back: true) pointing at the previous thread message, not a
        // genuine reply. Rendering it as a quote duplicates what the thread view
        // already shows, so suppress it. Genuine replies-within-a-thread
        // (is_falling_back false/absent) still get their quote.
        const original = event.getOriginalContent();
        // Per the threads spec, is_falling_back sits on m.relates_to itself
        // (a sibling of m.in_reply_to), NOT inside m.in_reply_to.
        const originalRel = original?.["m.relates_to"] as
            | {
                  rel_type?: string;
                  is_falling_back?: boolean;
                  "m.in_reply_to"?: { event_id?: string };
              }
            | undefined;
        if (
            originalRel?.rel_type === "m.thread" &&
            originalRel?.is_falling_back === true
        )
            return undefined;

        const fromContent =
            content?.["m.relates_to"]?.["m.in_reply_to"]?.event_id;
        if (fromContent) return fromContent as string;
        // Edits send m.new_content without m.relates_to, so after an m.replace
        // getContent() drops the reply relation. Fall back to the original
        // event content so edited replies still render their quoted message.
        return original?.["m.relates_to"]?.["m.in_reply_to"]?.event_id as
            | string
            | undefined;
    }, [content, event]);
    // Finding the parent is a linear scan of the loaded timeline chunk, and this
    // derived re-runs on every timelineTick for every reply on screen. A resolved
    // target cannot change (same MatrixEvent reference; edits and redactions mutate
    // it in place), so search only while we do not have one — the same
    // resolve-once shape `fetchedReplyTarget` below already uses. Plain `let`, not
    // $state: a memo cell written inside a $derived must stay out of the graph.
    const cachedReplyTarget = useRef<CachedReplyTarget<MatrixEvent> | null>(
        null,
    );
    const timelineReplyTarget = useRune(() => {
        if (!inReplyToId) return null;
        void messagesState.timelineTick;
        if (shouldRescanReplyTarget(cachedReplyTarget.current, inReplyToId)) {
            cachedReplyTarget.current = {
                id: inReplyToId,
                target: findEventById(room, inReplyToId) ?? null,
            };
        }
        return cachedReplyTarget.current?.target ?? null;
    }, [inReplyToId, room]);
    // Parents outside the loaded timeline window are fetched individually —
    // modern clients (gomuks & friends) omit the legacy "> quote" fallback,
    // so without this their replies render "Original message not loaded".
    const [fetchedReplyTarget, setFetchedReplyTarget] =
        useState<MatrixEvent | null>(null);
    useEffect(() => {
        const id = inReplyToId;
        if (!id || timelineReplyTarget) {
            setFetchedReplyTarget(null);
            return;
        }
        let cancelled = false;
        fetchSingleEvent(room.roomId, id)
            .then((ev) => {
                if (!cancelled) setFetchedReplyTarget(ev);
            })
            .catch((err) => {
                if (!cancelled) setFetchedReplyTarget(null);
                console.error("Failed to fetch reply target:", err);
            });
        return () => {
            cancelled = true;
        };
    }, [inReplyToId, timelineReplyTarget, room.roomId]);
    const replyTarget = timelineReplyTarget ?? fetchedReplyTarget;
    const replyTargetSender = useRune(
        () =>
            replyTarget
                ? (void roomsState.roomsTick,
                  getMemberName(room, replyTarget.getSender() ?? ""))
                : null,
        [replyTarget, room],
    );
    const replyTargetBody = useRune(() => {
        if (!replyTarget) return null;
        // Depend on timelineTick: an encrypted target arrives as m.room.encrypted
        // (no body) and decrypts later IN PLACE on the same MatrixEvent reference,
        // which does not change replyTarget's identity. Decryption bumps
        // timelineTick (crypto.ts), so reading it here re-derives the body then —
        // without it the row stays on the "unavailable" fallback until a reload.
        void messagesState.timelineTick;
        // Parents with no text of their own get a type placeholder instead of
        // falling through to "Original message unavailable".
        return eventPreviewText(replyTarget);
    }, [replyTarget]);
    // Zami: whether the parent is redacted, for the fallback quote's wording.
    const replyTargetRedacted = useRune(
        () =>
            replyTarget
                ? (void messagesState.timelineTick, replyTarget.isRedacted())
                : false,
        [replyTarget],
    );

    // Sticker URL
    const stickerHttpUrl = useMemo(() => {
        const value =
            eventType !== "m.sticker"
                ? null
                : mxcToHttp(content?.url as string);
        return () => value;
    }, [eventType, content]);

    // Whether this uploaded image is a GIF (eligible for favouriting)
    const isGif =
        msgtype === "m.image" &&
        // Clients differ on casing and on whether the name is in
        // `filename` or only `body`, so check every spelling.
        (((content?.info as { mimetype?: string } | undefined)?.mimetype ?? "")
            .trim()
            .toLowerCase() === "image/gif" ||
            [mediaFilename, content?.body as string | undefined].some((n) =>
                (n ?? "").trim().toLowerCase().endsWith(".gif"),
            ));

    // Image conversion.
    // In chat we show a server-scaled 800x600 thumbnail to save bandwidth; the
    // full-resolution image is only requested when opened in the lightbox.
    const imageFullUrl = useMemo(() => {
        const value =
            msgtype !== "m.image" ? null : mxcToHttp(content?.url as string);
        return () => value;
    }, [msgtype, content]);
    const imageThumbUrl = useMemo(() => {
        const value = (() => {
            if (msgtype !== "m.image") return null;
            // GIFs are served full-res in chat so they keep animating; the server
            // thumbnail would (depending on homeserver) drop the animation.
            if (isGif) return mxcToHttp(content?.url as string);
            // Homeservers generally can't thumbnail JPEG XL, so ask for the
            // original; utils/jxl transcodes it where the engine can't decode it.
            if (
                (content?.info as { mimetype?: string } | undefined)
                    ?.mimetype === "image/jxl" ||
                mediaFilename.toLowerCase().endsWith(".jxl")
            )
                return mxcToHttp(content?.url as string);
            return (
                mxcToHttp(content?.url as string, 800, 600, "scale") ??
                mxcToHttp(content?.url as string)
            );
        })();
        return () => value;
    }, [msgtype, isGif, content, mediaFilename]);

    // Reserved display box (px) for uploaded images/stickers, from the sender's
    // untrusted `info.w`/`info.h`. Rendered as the `<img>`'s width/height
    // attributes so the browser holds the exact space before the image loads —
    // otherwise it pops in from zero height and shoves the timeline on scroll.
    // Fall back to `info.thumbnail_info.w/h`: bridges (e.g. OOYE) frequently omit
    // top-level dims but still populate the thumbnail's, and the thumbnail shares
    // the original's aspect ratio. Bounds mirror the CSS caps: images
    // max-w-lg/max-h-96 (512×384), stickers max-w-48/max-h-48 (192×192). Null
    // when no dims are present → the markup falls back to the old CSS-only bounds.
    // With none, the size it loaded at earlier this session, so a row the
    // timeline mounts again (row windowing) doesn't start at 0×0 and grow.
    const mediaSizeKey =
        ((content?.url ?? (content?.file as any)?.url) as string | undefined) ??
        null;
    // Zami: read every render (a Map lookup), so the size an image learns on
    // load applies on the re-render its load causes.
    const learnedSize = learnedMediaSize(mediaSizeKey);
    const imgInfoW =
        (content?.info as any)?.w ??
        (content?.info as any)?.thumbnail_info?.w ??
        learnedSize?.width;
    const imgInfoH =
        (content?.info as any)?.h ??
        (content?.info as any)?.thumbnail_info?.h ??
        learnedSize?.height;
    const imageBox = reservedMediaBox(imgInfoW, imgInfoH, 512, 384);
    const stickerBox = reservedMediaBox(imgInfoW, imgInfoH, 192, 192);

    // Encrypted image: decrypt on mount when content.file is present
    const [encryptedImageThumbUrl, setEncryptedImageThumbUrl] = useState<
        string | null
    >(null);
    const [encryptedImageFullUrl, setEncryptedImageFullUrl] = useState<
        string | null
    >(null);
    const [imageDecrypting, setImageDecrypting] = useState(false);
    const [imageDecryptFailed, setImageDecryptFailed] = useState(false);
    const [imageProgress, setImageProgress] = useState<DownloadProgress | null>(
        null,
    );
    // A large encrypted image paints onto the tile's canvas (and the
    // lightbox's, if it is opened) while it downloads (see
    // progressiveImage.ts); it is replaced by the real <img> once verified.
    // Zami: not ported: the tile's canvas. React Native has no ImageDecoder, so
    // canPreviewImage is false and nothing is drawn; `imagePreviewing` stays
    // false.
    const [imagePreview] = useState(createFrameRelay);
    const [imagePreviewing, setImagePreviewing] = useState(false);
    // Set while the tile shows a kept copy (decryptedImageCache.ts) and the
    // original hasn't been decrypted again: opening the viewer starts that.
    const requestFullImage = useRef<(() => void) | null>(null);

    // Image/sticker media 401s when the media service worker isn't authenticating
    // it (notably a hard reload, which leaves the page uncontrolled). createMediaRetry
    // re-fetches with the token and swaps to a blob URL so it heals without a
    // manual reload. A message is image XOR sticker, so one src is null and a
    // single instance covers both. See mediaAuth.svelte.
    // Zami: no createMediaRetry (a rune factory with its own effects): the image
    // request carries the token (mediaSource), so a failure is genuine and is
    // remembered for the src that failed.
    const mediaImgSrc =
        encryptedImageThumbUrl ?? imageThumbUrl() ?? stickerHttpUrl();
    const [mediaImgFailedSrc, setMediaImgFailedSrc] = useState<string | null>(
        null,
    );
    const mediaImgRetry = {
        src: mediaImgSrc,
        failed: mediaImgSrc !== null && mediaImgFailedSrc === mediaImgSrc,
        onError: () => setMediaImgFailedSrc(mediaImgSrc),
    };
    // Zami: a re-render after an image of no known size loads, to lay it out
    // at the size it learned.
    const [, setImageLearned] = useState(0);

    const imageFile =
        msgtype === "m.image"
            ? (content?.file as EncryptedFile | undefined)
            : undefined;
    useEffect(() => {
        const file = imageFile;
        if (!file) return;
        setImageDecryptFailed(false);
        setImageProgress(null);
        setImagePreviewing(false);
        let blobUrl: string | null = null;
        let tileUrl: string | null = null;
        let cancelled = false;
        const abort = new AbortController();
        const cleanup = () => {
            cancelled = true;
            abort.abort();
            requestFullImage.current = null;
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            if (tileUrl) URL.revokeObjectURL(tileUrl);
            setEncryptedImageThumbUrl(null);
            setEncryptedImageFullUrl(null);
        };
        // Seen before (another room and back): show the kept copy now.
        const cached = cachedDecryptedImage(file.url);
        if (cached) {
            tileUrl = URL.createObjectURL(cached.blob);
            setEncryptedImageThumbUrl(tileUrl);
            setImageDecrypting(false);
            if (cached.isOriginal) {
                setEncryptedImageFullUrl(tileUrl);
                return cleanup;
            }
        } else {
            setImageDecrypting(true);
        }
        const info = content?.info as
            | { mimetype?: string; size?: number }
            | undefined;
        const mime = info?.mimetype?.split(";")[0].trim().toLowerCase();
        const httpUrl = mxcToHttp(file.url);
        const onProgress = (p: DownloadProgress) => {
            if (!cancelled) setImageProgress(p);
        };
        // One download serves both the inline image and the viewer: the
        // thumbnail and the full image are the same ciphertext, and fetching it
        // twice doubled the wait on a slow server.
        const plainDownload = async () =>
            fetchDecryptedAttachmentBlob(file, info?.mimetype, {
                expectedSize: info?.size,
                signal: abort.signal,
                onProgress,
            });
        // Big images preview as they arrive when the browser can decode the
        // format incrementally; anything else, or any failure of that route,
        // takes the plain download-verify-show path.
        const load = async (): Promise<string> => {
            if (
                httpUrl &&
                mime &&
                typeof info?.size === "number" &&
                info.size >= PROGRESSIVE_IMAGE_MIN_BYTES &&
                (await canPreviewImage(mime))
            ) {
                try {
                    const blob = await loadImageProgressively(httpUrl, {
                        mimetype: mime,
                        decrypt: file,
                        expectedSize: info.size,
                        signal: abort.signal,
                        onProgress,
                        onPreview: (frame) => {
                            if (!cancelled) imagePreview.draw(frame);
                        },
                    });
                    return URL.createObjectURL(blob);
                } catch (err) {
                    if (abort.signal.aborted) throw err;
                    setImagePreviewing(false);
                    setImageProgress(null);
                }
            }
            return plainDownload();
        };
        // The tile gets a copy sized to its box (see tileImage.ts) so it
        // doesn't hold a full-resolution decode for the message's lifetime;
        // the original is kept for the lightbox only.
        // It is also what decryptedImageCache keeps, or the original if it is
        // small and has no copy.
        const tileCopy = async (url: string): Promise<Blob | null> => {
            try {
                const original = await (await fetch(url)).blob();
                const small = await createTileImage(original);
                if (small) {
                    cacheDecryptedImage(file.url, {
                        blob: small,
                        isOriginal: false,
                    });
                } else if (original.size <= DECRYPTED_IMAGE_ORIGINAL_MAX) {
                    cacheDecryptedImage(file.url, {
                        blob: original,
                        isOriginal: true,
                    });
                }
                return small;
            } catch {
                return null;
            }
        };
        const start = cached
            ? new Promise<void>(
                  (resolve) => (requestFullImage.current = resolve),
              )
            : Promise.resolve();
        start
            .then(load)
            .then(async (url) => {
                if (cancelled) {
                    URL.revokeObjectURL(url);
                    return;
                }
                blobUrl = url;
                setImagePreviewing(false);
                // The kept copy stays as the tile; only the viewer needed this.
                if (cached) {
                    setEncryptedImageFullUrl(url);
                    return;
                }
                const tile = await tileCopy(url);
                if (cancelled) return;
                tileUrl = tile ? URL.createObjectURL(tile) : null;
                setEncryptedImageThumbUrl(tileUrl ?? url);
                setEncryptedImageFullUrl(url);
                setImageDecrypting(false);
            })
            .catch(() => {
                if (cancelled) return;
                setImagePreviewing(false);
                // A kept copy is still worth showing over an error.
                if (cached) return;
                setImageDecrypting(false);
                setImageDecryptFailed(true);
            });
        return cleanup;
        // Zami: as upstream's effect, it reads `content` once per encrypted file.
    }, [imageFile, imagePreview]);

    // The sender's own small thumbnail (info.thumbnail_url / thumbnail_file),
    // shown as a stand-in until the real image loads: behind the server's
    // thumbnail in the tile, and behind the full image in the lightbox. The
    // poster helper is not video-specific: it reads the same thumbnail fields.
    const senderThumbSrc = useMemo(
        () => (msgtype === "m.image" ? videoPoster(content) : null),
        [msgtype, content],
    );
    const [encryptedSenderThumbUrl, setEncryptedSenderThumbUrl] = useState<
        string | null
    >(null);
    const senderThumbUrl = !senderThumbSrc
        ? null
        : senderThumbSrc.kind === "plain"
          ? mxcToHttp(senderThumbSrc.mxc)
          : encryptedSenderThumbUrl;
    // Keyed on the thumbnail's mxc so a re-render with equal content doesn't
    // decrypt it again.
    const encryptedSenderThumbKey =
        senderThumbSrc?.kind === "encrypted" ? senderThumbSrc.file.url : null;
    const senderThumbSrcRef = useRef(senderThumbSrc);
    senderThumbSrcRef.current = senderThumbSrc;
    useEffect(() => {
        if (encryptedSenderThumbKey === null) return;
        const src = senderThumbSrcRef.current;
        if (src?.kind !== "encrypted") return;
        let capturedUrl: string | null = null;
        let cancelled = false;
        fetchDecryptedAttachmentBlob(src.file, src.mimetype ?? undefined)
            .then((url) => {
                if (cancelled) {
                    URL.revokeObjectURL(url);
                    return;
                }
                capturedUrl = url;
                setEncryptedSenderThumbUrl(url);
            })
            .catch(() => {
                // No stand-in: the progress bar shows on its own, as before.
            });
        return () => {
            cancelled = true;
            if (capturedUrl) URL.revokeObjectURL(capturedUrl);
            setEncryptedSenderThumbUrl(null);
        };
    }, [encryptedSenderThumbKey]);
    // Dropped once the tile's own image has loaded, so a transparent image
    // doesn't show the stand-in through it.
    // Zami: expo-image's `placeholder` is that stand-in: it shows until the
    // image loads and goes then. (placeholderStyle builds CSS, which isn't
    // needed: the URL goes to the image as it is.)
    const imageTilePlaceholder = senderThumbUrl;
    // Lightbox stand-ins, best first. Unencrypted: the server's thumbnail (most
    // likely cached from the tile) over the sender's. Encrypted: the tile's
    // copy when it isn't the original (a kept copy whose original is being
    // decrypted again), then the sender's. A GIF's tile already loads the
    // original, so it adds nothing.
    const lightboxPlaceholders = (() => {
        if (content?.file)
            return [
                encryptedImageThumbUrl !== encryptedImageFullUrl
                    ? encryptedImageThumbUrl
                    : null,
                senderThumbUrl,
            ];
        const server = imageThumbUrl();
        return [server !== imageFullUrl() ? server : null, senderThumbUrl];
    })();

    // Audio: lazy-load blob only after play is clicked
    const [audioClicked, setAudioClicked] = useState(false);
    const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
    const [audioLoading, setAudioLoading] = useState(false);
    const [audioProgress, setAudioProgress] = useState<DownloadProgress | null>(
        null,
    );
    const [audioFailed, setAudioFailed] = useState(false);
    // Bumped by the Retry affordance to re-run the load effect (toggling
    // audioClicked can't: false→true in one handler nets to no change).
    const [audioAttempt, setAudioAttempt] = useState(0);
    const audioMode = audioPlaybackMode({
        hasBlob: !!audioBlobUrl,
        loading: audioLoading,
        failed: audioFailed,
    });
    // Voice message (MSC3245): render a waveform + length instead of a bare
    // audio row. Null for ordinary uploaded audio files.
    const voiceMsg = useMemo(
        () => (msgtype === "m.audio" ? parseVoiceContent(content) : null),
        [msgtype, content],
    );

    // Audio that plays while it downloads (videoStream.ts). Not for MIDI, which
    // has to be synthesized from the whole file; not for a small encrypted file,
    // where waiting for the integrity check costs little (see
    // STREAM_ENCRYPTED_MIN_BYTES). A stream that breaks flips
    // audioStreamFailed, which hands the file to the download path below.
    // Zami: React Native has no MediaSource, so audioStreamUrl is always null
    // and the download path plays everything.
    const audioStreamFailed = false;
    const audioStreamReady = false;
    const audioIsMidi = isMidiAttachment(
        (content?.info as { mimetype?: string } | undefined)?.mimetype,
        mediaFilename,
    );
    // Tracker modules (MOD/XM/S3M/IT...) are rendered like MIDI. Browsers
    // don't give them an audio/ type, so they usually arrive as m.file and
    // get the player alongside the download card.
    const audioIsTracker = isTrackerAttachment(
        (content?.info as { mimetype?: string } | undefined)?.mimetype,
        mediaFilename,
    );
    const audioPlayable =
        msgtype === "m.audio" || (msgtype === "m.file" && audioIsTracker);

    /**
     * Save the attachment as it was sent, decrypted if need be. The audio
     * player's own download can't stand in: for MIDI and tracker modules it
     * holds a WAV rendered here, and for streamed audio a MediaSource.
     */
    async function downloadAttachment() {
        // Zami: no shift+click quiet save.
        const quiet = false;
        const file = content?.file as EncryptedFile | undefined;
        const fileUrl = file ? null : mxcToHttp(content?.url as string);
        if (!file && !fileUrl) return;
        try {
            const blobUrl = file
                ? await fetchDecryptedAttachmentBlob(
                      file,
                      (content?.info as { mimetype?: string } | undefined)
                          ?.mimetype,
                  )
                : await fetchAttachmentBlob(fileUrl!);
            try {
                await saveObjectUrl(blobUrl, mediaFilename, { quiet });
            } finally {
                revokeLater(blobUrl);
            }
        } catch (err) {
            console.error("Failed to download attachment", err);
            showErrorToast("Failed to download attachment");
        }
    }
    const audioStreamUrl = (() => {
        if (!audioClicked || !audioPlayable) return null;
        if (voiceMsg || audioIsMidi || audioIsTracker || audioStreamFailed)
            return null;
        if (typeof MediaSource === "undefined") return null;
        const file = content?.file as EncryptedFile | undefined;
        if (file) {
            const size = (content?.info as { size?: number } | undefined)?.size;
            return typeof size === "number" &&
                size >= STREAM_ENCRYPTED_MIN_BYTES
                ? mxcToHttp(file.url)
                : null;
        }
        return mxcToHttp(content?.url as string);
    })();

    useEffect(() => {
        void audioAttempt; // re-run when the user retries a failed load
        if (!audioClicked || !audioPlayable) return;
        if (audioStreamUrl) return;
        const file = content?.file as EncryptedFile | undefined;
        const isMidi = audioIsMidi;
        const isTracker = audioIsTracker;
        let cancelled = false;
        // <audio> can't decode MIDI or tracker modules, so render to WAV first.
        // Zami: MIDI renders on the app's thread (no Workers). Not ported:
        // tracker modules. Their renderer is libopenmpt compiled to
        // WebAssembly, which Hermes can't run, so they fail to load and show
        // the failed state (the file card still saves the module).
        const toPlayableAudio = (url: string) =>
            isMidi
                ? midiUrlToWavUrl(url)
                : isTracker
                  ? trackerUrlToWavUrl(url)
                  : url;
        if (file) {
            // Encrypted audio
            setAudioLoading(true);
            setAudioFailed(false);
            let objectUrl: string | null = null;
            const audioInfo = content?.info as
                | { mimetype?: string; size?: number }
                | undefined;
            setAudioProgress(null);
            fetchDecryptedAttachmentBlob(file, audioInfo?.mimetype, {
                expectedSize: audioInfo?.size,
                onProgress: (p) => {
                    if (!cancelled) setAudioProgress(p);
                },
            })
                .then(toPlayableAudio)
                .then((url) => {
                    if (cancelled) return URL.revokeObjectURL(url);
                    objectUrl = url;
                    setAudioBlobUrl(url);
                    setAudioLoading(false);
                })
                .catch(() => {
                    setAudioLoading(false);
                    setAudioFailed(true);
                });
            return () => {
                cancelled = true;
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                setAudioBlobUrl(null);
            };
        } else {
            // Unencrypted audio
            const httpUrl = mxcToHttp(content?.url as string);
            if (!httpUrl) return;
            setAudioLoading(true);
            setAudioFailed(false);
            let objectUrl: string | null = null;
            setAudioProgress(null);
            fetchAttachmentBlob(httpUrl, {
                expectedSize: (content?.info as { size?: number } | undefined)
                    ?.size,
                onProgress: (p) => {
                    if (!cancelled) setAudioProgress(p);
                },
            })
                .then(toPlayableAudio)
                .then((url) => {
                    if (cancelled) return URL.revokeObjectURL(url);
                    objectUrl = url;
                    setAudioBlobUrl(url);
                    setAudioLoading(false);
                })
                .catch(() => {
                    setAudioLoading(false);
                    setAudioFailed(true);
                });
            return () => {
                cancelled = true;
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                setAudioBlobUrl(null);
            };
        }
    }, [
        audioAttempt,
        audioClicked,
        audioPlayable,
        audioStreamUrl,
        content,
        audioIsMidi,
        audioIsTracker,
    ]);

    // Reactively track whether the current image URL is favourited. The
    // full-resolution URL is the favourite key (so the picker sends full quality).
    // An encrypted GIF has no usable URL, so it is keyed by a pointer to this
    // message instead (see favouriteFile.ts).
    const encryptedFavouriteSource = useMemo(
        () => ({ roomId: room.roomId, eventId }),
        [room.roomId, eventId],
    );
    // Zami: only a GIF can be a favourite, so only a GIF's row reads the list.
    const imageIsFavourited = useRune(() => {
        if (!isGif) return false;
        void favouritesState.gifs; // track
        const src =
            imageFullUrl() ?? eventFavouriteKey(encryptedFavouriteSource);
        return !!src && isFavouriteGif(src);
    }, [isGif, imageFullUrl, encryptedFavouriteSource]);

    function toggleImageFavourite() {
        const full = imageFullUrl();
        if (!full) {
            const key = eventFavouriteKey(encryptedFavouriteSource);
            if (isFavouriteGif(key)) removeFavouriteGif(key);
            else
                addFavouriteGif({
                    url: key,
                    previewUrl: key,
                    source: encryptedFavouriteSource,
                });
            return;
        }
        if (isFavouriteGif(full)) {
            removeFavouriteGif(full);
        } else {
            addFavouriteGif({ url: full, previewUrl: imageThumbUrl() ?? full });
        }
    }

    // Relation shape is read from the ORIGINAL content — never the post-edit
    // getContent(), which folds m.new_content and can misreport the relation on
    // an edited event (mirrors client.ts eventThreadRoot). Tick-guarded like
    // `content` so it re-reads when an encrypted event decrypts in place.
    const originalRelatesTo = useRune(
        () => (
            void messagesState.timelineTick,
            event.getOriginalContent()?.["m.relates_to"]
        ),
        [event],
    );

    // Whether this message is a thread reply
    const isThreadReply = originalRelatesTo?.rel_type === "m.thread";
    // Root of the thread to open for this message: the reply's own thread root
    // if it's a thread reply, otherwise this message starts a new thread.
    const threadRootId = isThreadReply
        ? ((originalRelatesTo?.event_id as string) ?? eventId)
        : eventId;
    // An event whose ORIGINAL content already carries any m.relates_to.rel_type
    // (edit / annotation / thread) cannot legally become a NEW thread root — the
    // server SHOULD-rejects the reply with an opaque 400. Used to suppress the
    // "Reply in thread" offer on such events (Element greys it out likewise).
    // Thread replies are exempt: for them the affordance reads "Open thread".
    const isRelatedEvent = !!originalRelatesTo?.rel_type;
    // The thread action offered on this message (see the action bar's thread
    // button): "open" for a thread reply, "reply" to start one, else none.
    const threadAction: "open" | "reply" | null =
        onOpenThread && (isThreadReply || !isRelatedEvent)
            ? isThreadReply
                ? "open"
                : "reply"
            : null;
    // The overflow rows for THIS message, gated exactly like the desktop
    // buttons. Drives the mobile ⋯ sheet only; desktop keeps every button
    // inline.
    const overflowRows = useMemo(
        () =>
            messageActionsMenu({
                canEdit: canEditMessage,
                thread: threadAction,
                canPin,
                isPinned,
                hasLink: eventId.startsWith("$") && !isFailed,
                canReport: !isOwnMessage && !isFailed,
                canRedact: !isOwnMessage && !isFailed && canRedact,
                canDelete: isOwnMessage,
            }),
        [
            canEditMessage,
            threadAction,
            canPin,
            isPinned,
            eventId,
            isFailed,
            isOwnMessage,
            canRedact,
        ],
    );
    // Root summary: this message is a thread ROOT iff other events reply to it.
    // Keyed off roomsTick so the chip refreshes on sync (a live Thread mutates
    // in place — a bare $derived would not re-run; CLAUDE.md reactivity landmine).
    // getThreadSummary mints a fresh object every call, so returning it unchanged
    // would dirty this row on EVERY sync — one row's chip re-rendering is nothing,
    // but there is one of these per timeline row. Keep the previous reference when
    // the value has not moved (same trick as `shield` above, commit 55a5936).
    // Plain `let`, NOT $state: a memo cell written inside a $derived must stay
    // invisible to the reactivity graph (writing $state there throws).
    const lastThreadSummary = useRef<ThreadSummary | null>(null);
    const threadSummary = useRune(() => {
        void roomsState.roomsTick;
        const next = getThreadSummary(room, eventId);
        if (
            lastThreadSummary.current &&
            sameThreadSummary(lastThreadSummary.current, next)
        )
            return lastThreadSummary.current;
        lastThreadSummary.current = next;
        return next;
    }, [room, eventId]);
    const isThreadRoot = !isThreadReply && threadSummary.count > 0;
    const threadName = useRune(() => {
        if (!isThreadRoot) return null;
        void roomsState.roomsTick;
        return getThreadName(room, eventId);
    }, [isThreadRoot, room, eventId]);

    // Links to other messages render as an embed of that message instead of
    // a homeserver URL preview (which would only show matrix.to's own page).
    const eventLinks = useMemo(() => {
        if (
            msgtype !== "m.text" &&
            msgtype !== "m.notice" &&
            msgtype !== "m.emote"
        )
            return [];
        return extractEventPermalinks(body(), formattedBody());
    }, [msgtype, body, formattedBody]);

    // Extract http/https URLs from the plain body for link previews
    const linkedUrls = useMemo(() => {
        if (msgtype !== "m.text") return [];
        const matches = body().match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
        return [...new Set(matches)].filter((url) => {
            const target = parseMatrixLink(url);
            return !(target && target.kind !== "user" && target.eventId);
        });
    }, [msgtype, body]);
    const linkPreviewsEnabled = useRune(
        () => linkedUrls.length > 0 && settingsState.linkPreviewsEnabled,
        [linkedUrls.length > 0],
    );

    // True if the body text consists entirely of emoji + whitespace (no other characters)
    const emojiOnly = useMemo(() => {
        const b = body();
        if (!b.trim()) return false;
        // Strip Unicode emoji, variation selectors, ZWJ, whitespace, and :shortcode: patterns
        const stripped = b
            .replace(/:\w+:/g, "") // custom emoji shortcodes
            .replace(
                /[\p{Emoji_Presentation}\p{Extended_Pictographic}️‍\s]/gu,
                "",
            );
        return stripped.length === 0;
    }, [body]);

    function withTwemoji(html: string): string {
        // Read the highlighter FIRST and unconditionally — this read is the
        // reactive subscription that re-runs this render when the highlight.js
        // chunk lands (engine: null -> loaded, exactly once). Folding the loaded
        // flag into the cache key means a hit computed BEFORE the chunk arrived is
        // never reused AFTER it arrives, so code blocks still upgrade to coloured.
        // Zami: not ported: syntax highlighting. highlightCodeBlocks rewrites
        // the code through a <template> element, which the DOM stand-in can't
        // build, so the highlighter isn't fetched and code blocks stay plain.
        return twemojiCache.get(`0\u0000${html}`, () =>
            renderHtml(html, "twemoji"),
        );
    }

    useEffect(() => {
        if (editRequested) {
            editFromKeyboard.current = true;
            startEdit();
        }
        // Zami: it runs when the parent asks, as upstream's effect does.
    }, [editRequested]);

    // Zami: the edit box focuses when it mounts, which covers every way in
    // (this button, ArrowUp in the composer, a double-tap).
    useEffect(() => {
        if (isEditing) editBoxEl.current?.focus();
    }, [isEditing]);

    function startEdit() {
        setEditText(body());
        setIsEditing(true);
        // Zami: not ported: scrolling the row into view, which the timeline's
        // list would have to do (the keyboard's own avoidance mostly covers it).
    }

    function cancelEdit() {
        setIsEditing(false);
        setEditText("");
        if (editFromKeyboard.current) {
            editFromKeyboard.current = false;
            onEditDone?.();
        }
    }

    async function saveEdit() {
        if (!event.getId() || isSavingEdit) return;
        // Captioned media: an empty caption just strips the caption rather
        // than offering to delete the attachment.
        if (isEmptyEdit(event, editText)) {
            // Empty edit — cancel without returning focus, then prompt to delete
            setIsEditing(false);
            setEditText("");
            deleteRefocus.current = editFromKeyboard.current;
            editFromKeyboard.current = false;
            setConfirmingDelete(true);
            return;
        }
        setIsSavingEdit(true);
        try {
            await sendMessageEdit(room, event, editText);
            setIsEditing(false);
            setEditText("");
            if (editFromKeyboard.current) {
                editFromKeyboard.current = false;
                onEditDone?.();
            }
        } catch (err) {
            console.error("Failed to edit message:", err);
        } finally {
            setIsSavingEdit(false);
        }
    }

    function plainToHtml(text: string): string {
        const escaped = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\|\|(.+?)\|\|/gs, "<span data-mx-spoiler>$1</span>");
        // Escaping above keeps this injection-safe; linkify before <br> so
        // newlines still count as mention boundaries. linkifyPlainText covers
        // http(s) URLs as well as bare mentions — a pasted matrix.to link needs
        // to become an anchor for the matrixLinks action to open it in-app.
        return renderMessageTimestamps(
            highlightRoomMention(linkifyPlainText(escaped)),
        ).replace(/\n/g, "<br>");
    }

    function sanitize(html: string): string {
        if (!html) return sanitizeMatrixHtml(html, { resolveMxc: mxcToHttp });
        // Key on (homeserver base URL, raw html): sanitize rewrites mxc:// URIs to
        // absolute homeserver media URLs via mxcToHttp, so the SAME body resolves
        // differently across an account switch. A NUL (U+0000) is a safe
        // separator (never present in a URL or in Matrix HTML).
        const base = getHomeserverBaseUrl() ?? "";
        return renderMessageTimestamps(
            highlightRoomMention(
                sanitizeCache.get(`${base}\u0000${html}`, () =>
                    sanitizeMatrixHtml(html, { resolveMxc: mxcToHttp }),
                ),
            ),
        );
    }

    // Zami: the `{@html}` body, built as upstream builds it, once per content.
    const bodyHtml = useMemo(() => {
        const formatted = formattedBody();
        return formatted
            ? withTwemoji(sanitize(formatted))
            : withTwemoji(plainToHtml(body()));
        // Zami: withTwemoji and sanitize read only their argument.
    }, [formattedBody, body]);

    async function navigateToMatrixTarget(
        target: Exclude<MatrixLinkTarget, { kind: "user" }>,
    ): Promise<void> {
        let roomId: string;
        let via: string[];
        if (target.kind === "alias") {
            const resolved = await getRoomIdForAlias(target.alias);
            roomId = resolved.roomId;
            via = mergeViaServers(target.via, resolved.servers);
        } else {
            roomId = target.roomId;
            via = target.via;
        }
        const membership = getRoom(roomId)?.getMyMembership();
        if (needsJoinConsent(membership)) {
            const descriptor = describeJoinTarget({
                kind: target.kind,
                alias: target.kind === "alias" ? target.alias : undefined,
                linkRoomId: target.kind === "room" ? target.roomId : undefined,
                resolvedRoomId: roomId,
            });
            const confirmed = await requestJoinConsent(descriptor);
            if (!confirmed) return;
            await joinRoom(roomId, via);
        } else {
            // Already joined, but possibly as a state-less stub (see
            // seedRoomStateIfMissing) — heal before deciding how to open it.
            await seedRoomStateIfMissing(roomId);
        }
        // A space link focuses the space; opening it as a chat room would
        // render an empty timeline with a live composer.
        if (getRoom(roomId)?.isSpaceRoom()) {
            setActiveSpace(roomId);
            return;
        }
        if (roomId === room.roomId) {
            if (target.eventId) jumpToReply(target.eventId);
        } else {
            // Cross-room permalink: carry the event id so we land ON the linked
            // message, not just in the room (was dropped here before).
            navigateToRoom(roomId, target.eventId);
        }
    }

    function openMatrixTarget(
        target: Exclude<MatrixLinkTarget, { kind: "user" }>,
    ): void {
        navigateToMatrixTarget(target).catch((err) => {
            console.error("Failed to open Matrix link:", err);
            showErrorToast(
                matrixErrorMessage(
                    err,
                    t("messageItem.couldNotOpenTheMatrixLink"),
                ),
            );
        });
    }

    // Svelte action: open Matrix links (matrix.to permalinks, matrix: URIs,
    // mention anchors) in-app — user links open the profile card; room and
    // alias links join if needed, then switch rooms — instead of letting the
    // SPA navigate away to matrix.to.
    // Zami: the press Html reports for a link in the body. Any other link
    // opens as upstream leaves it to the browser. Not ported: the full-id
    // tooltip on user links (no `title`). The profile card anchors to the row,
    // as a link inside the text has no box of its own here.
    function matrixLinks(href: string) {
        const target = parseMatrixLink(href);
        if (!target) {
            openLink(href);
            return;
        }
        if (target.kind === "user") {
            void anchorElement(rootEl.current).then((el) =>
                openProfileCard(target.userId, el),
            );
            return;
        }
        openMatrixTarget(target);
    }

    function openSenderProfile(el: HostInstance | null) {
        void anchorElement(el).then((anchor) =>
            openProfileCard(senderId, anchor),
        );
    }

    // Zami: `.message-body`'s text classes, for Html; an own bubble's text and
    // links are white.
    const bodyTextClass = bubble.bubble
        ? "text-sm text-white leading-relaxed [&_a]:text-white [&_a]:underline"
        : "text-sm text-discord-textPrimary leading-relaxed";

    // Zami: the body with what upstream sets inline after it (the edited mark,
    // the receipts' spacer). After text they wrap on as a row; after blocks
    // (a row would shrink them to their content) they go beneath. The one
    // View keeps Html mounted as receipts come and go.
    function bodyWithTrailing(
        html: string,
        className: string,
        spacerWidth: number,
    ) {
        const trailing = isEdited || spacerWidth > 0;
        return (
            <View
                className={
                    trailing && !BLOCK_HTML.test(html)
                        ? "flex-row flex-wrap items-end"
                        : ""
                }
            >
                <Html
                    html={html}
                    className={className}
                    resolveMxc={mxcToHttp}
                    onLinkPress={matrixLinks}
                    onImagePress={onBodyImagePress}
                />
                {isEdited ? (
                    <Text className="text-xs text-discord-textMuted ms-1 leading-relaxed">
                        {t("messageItem.edited")}
                    </Text>
                ) : null}
                {spacerWidth > 0 ? (
                    // Zero-height stand-in for the out-of-flow receipt
                    // cluster: free when the last line has room, and wraps
                    // to its own line when the text would otherwise run
                    // under the avatars at the row's bottom corner.
                    // Zami: as tall as the avatars, so a wrapped one makes room.
                    <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        className="h-4"
                        style={{ width: spacerWidth }}
                    />
                ) : null}
            </View>
        );
    }

    // Media caption (MSC2530): rendered as a normal message above the
    // media, so an image/video/etc. with a caption reads like a message
    // followed by the attachment.
    // Inline edit box: replaces a text body, or a media caption (the
    // attachment itself stays rendered below it).
    function editBox() {
        return (
            <View className="mt-1">
                <MessageEditBox
                    text={editText}
                    onTextChange={setEditText}
                    editorEl={editBoxEl}
                    room={room}
                    messageEmotes={emoticonsFromHtml(
                        event.getContent().formatted_body as string | undefined,
                    )}
                    onSave={saveEdit}
                    onCancel={cancelEdit}
                />
                <Text className="text-xs text-discord-textMuted mt-1">
                    <Text className="font-mono">Enter</Text>{" "}
                    {t("messageItem.toSave")}{" "}
                    <Text className="font-mono">Esc</Text>{" "}
                    {t("messageItem.toCancel")}
                </Text>
                <View className="flex-row gap-2 mt-1">
                    <Pressable
                        accessibilityRole="button"
                        onPress={saveEdit}
                        disabled={
                            isSavingEdit || (!editText.trim() && !hasCaption())
                        }
                        accessibilityState={{
                            disabled:
                                isSavingEdit ||
                                (!editText.trim() && !hasCaption()),
                        }}
                        className={`px-3 py-1 bg-discord-accent rounded transition-colors ${
                            isSavingEdit || (!editText.trim() && !hasCaption())
                                ? "opacity-50"
                                : ""
                        }`}
                    >
                        <Text className="text-xs font-semibold text-white">
                            {t("common.save")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={cancelEdit}
                        className="px-3 py-1 bg-discord-backgroundTertiary rounded transition-colors"
                    >
                        <Text className="text-xs font-semibold text-discord-textPrimary">
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    // The player row for uploaded audio, and for tracker
    // modules sent as m.file.
    function audioCard() {
        function audioBar() {
            if (!audioProgress?.total) return null;
            const percent = Math.round(
                (audioProgress.loaded / audioProgress.total) * 100,
            );
            return (
                <View
                    className="mt-1 h-1 rounded-full bg-discord-backgroundSecondary overflow-hidden"
                    role="progressbar"
                    accessibilityLabel={t("common.loading")}
                    accessibilityValue={{ min: 0, max: 100, now: percent }}
                >
                    <View
                        className="h-full bg-discord-accent transition-[width] duration-150"
                        style={{ width: `${percent}%` }}
                    />
                </View>
            );
        }
        return (
            <View className="flex-row items-center gap-3 p-3 bg-discord-backgroundTertiary rounded-lg mt-1 max-w-sm w-full">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={mediaFilename || t("messageItem.audio")}
                    accessibilityState={{ disabled: audioLoading }}
                    onPress={() => {
                        if (audioBlobUrl) return;
                        if (audioFailed) {
                            setAudioFailed(false);
                            setAudioAttempt((n) => n + 1);
                        } else {
                            setAudioClicked(true);
                        }
                    }}
                    className={`w-8 h-8 rounded-full bg-discord-accent flex-shrink-0 flex items-center justify-center ${
                        audioLoading ? "opacity-50" : ""
                    }`}
                    disabled={audioLoading}
                >
                    {audioLoading || (audioStreamUrl && !audioStreamReady) ? (
                        <Spin className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    ) : !audioBlobUrl && !audioStreamUrl ? (
                        <SvgIcon
                            d={PLAY_PATH}
                            className="w-4 h-4 text-white ms-0.5"
                        />
                    ) : (
                        <SvgIcon
                            d={MUSIC_PATH}
                            className="w-4 h-4 text-white"
                        />
                    )}
                </Pressable>
                <View className="flex-1 min-w-0">
                    <Text
                        numberOfLines={1}
                        className="text-discord-textPrimary text-xs font-medium mb-1"
                    >
                        {mediaFilename || t("messageItem.audio")}
                    </Text>
                    {audioStreamUrl ? (
                        // Zami: not ported: streamed playback (MediaSource),
                        // unreachable here, as audioStreamUrl is always null.
                        audioStreamReady ? null : (
                            audioBar()
                        )
                    ) : audioBlobUrl ? (
                        // For MIDI and trackers, this <audio>'s own
                        // download saves the rendered WAV; the button
                        // beside it saves the original.
                        <AudioControls src={audioBlobUrl} />
                    ) : (
                        <>
                            <Text
                                className={`text-xs ${
                                    audioMode === "failed"
                                        ? "text-discord-danger"
                                        : "text-discord-textMuted"
                                }`}
                            >
                                {audioStatusLabel(audioMode)}
                            </Text>
                            {audioLoading ? audioBar() : null}
                        </>
                    )}
                </View>
                {/* A tracker sent as m.file has the file card's
                    download button under this already. */}
                {msgtype !== "m.file" && (content?.file || content?.url) ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("messageItem.download")}
                        onPress={() => void downloadAttachment()}
                        className="p-1.5 rounded transition-colors flex-shrink-0"
                    >
                        <SvgIcon
                            d={DOWNLOAD_PATH}
                            className="w-5 h-5 text-discord-textMuted"
                        />
                    </Pressable>
                ) : null}
            </View>
        );
    }

    function mediaCaption() {
        if (isEditing) return editBox();
        if (!hasCaption()) return null;
        return bodyWithTrailing(bodyHtml, bodyTextClass, 0);
    }

    // Message body
    function messageBody(): ReactNode {
        if (isCallEvent) {
            return callSummary ? (
                <CallEventCard summary={callSummary} room={room} />
            ) : null;
        }
        if (isPoll) return <PollBody event={event} room={room} />;
        if (isFileOffer) return <FileOfferCard event={event} />;
        if (isUtd) {
            // E2EE UTD (unable-to-decrypt) placeholder. The row chrome
            // (avatar / sender / timestamp) is cleartext; only the body is
            // unavailable. When keys arrive mid-session the decryption tick
            // re-runs this derived timeline and the row swaps to real
            // content automatically.
            return (
                <View className="flex-row flex-wrap items-center gap-1.5">
                    <Lock
                        size={14}
                        className="flex-shrink-0 text-discord-textMuted"
                    />
                    <Text className="text-sm italic text-discord-textMuted leading-relaxed">
                        {utdText}
                    </Text>
                    {utdRequestable ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityHint={t("messageItem.requestKeysHelp")}
                            accessibilityState={{
                                disabled: keyRequest !== "idle",
                            }}
                            disabled={keyRequest !== "idle"}
                            onPress={() => void onRequestKeys()}
                            className={
                                keyRequest !== "idle" ? "opacity-60" : ""
                            }
                        >
                            <Text className="text-xs font-medium text-discord-accent">
                                {keyRequest === "idle"
                                    ? t("messageItem.requestKeys")
                                    : t("messageItem.keysRequested")}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            );
        }
        if (eventType === "m.sticker") {
            if (!mediaImgRetry.src || mediaImgRetry.failed) return null;
            return (
                <Image
                    source={mediaSource(mediaImgRetry.src)}
                    accessibilityLabel={content?.body ?? "sticker"}
                    className="mt-1"
                    style={
                        stickerBox
                            ? boxStyle(stickerBox)
                            : // Zami: a sticker of no known size holds a box
                              // until it loads, then learns its own.
                              fitStyle(null, 192, 192)
                    }
                    contentFit="contain"
                    onError={mediaImgRetry.onError}
                    onLoad={(e) => {
                        if (stickerBox) return;
                        learnMediaSize(
                            mediaSizeKey,
                            e.source.width,
                            e.source.height,
                        );
                        setImageLearned((n) => n + 1);
                    }}
                />
            );
        }
        if (msgtype === "m.image") {
            const file = content?.file as EncryptedFile | undefined;
            const thumb = file ? encryptedImageThumbUrl : imageThumbUrl();
            const full = file ? encryptedImageFullUrl : imageFullUrl();
            let tile: ReactNode;
            if (file && imageDecrypting) {
                // The canvas is always mounted (the effect paints into
                // it) but only shown once a first partial frame is drawn.
                // With a sender thumbnail, that sits underneath at the
                // reserved size and the canvas paints over it.
                tile = (
                    <>
                        <View className="relative self-start mt-1 max-w-full">
                            {senderThumbUrl ? (
                                <Pressable
                                    accessibilityRole="imagebutton"
                                    accessibilityLabel={
                                        mediaFilename || undefined
                                    }
                                    onPress={openImageUpload}
                                    style={
                                        imageBox
                                            ? boxStyle(imageBox)
                                            : fitStyle(null, 512, 384)
                                    }
                                >
                                    <Image
                                        source={mediaSource(senderThumbUrl)}
                                        accessible={false}
                                        className="w-full h-full rounded-lg"
                                        contentFit="contain"
                                    />
                                </Pressable>
                            ) : null}
                            {/* Zami: not ported: the preview canvas. */}
                            {imagePreviewing || senderThumbUrl ? (
                                <View
                                    className="absolute inset-x-2 bottom-2"
                                    pointerEvents="none"
                                >
                                    <MediaProgress
                                        label={t("messageItem.decryptingImage")}
                                        progress={imageProgress}
                                    />
                                </View>
                            ) : null}
                        </View>
                        {!imagePreviewing && !senderThumbUrl ? (
                            <MediaProgress
                                label={t("messageItem.decryptingImage")}
                                progress={imageProgress}
                            />
                        ) : null}
                    </>
                );
            } else if (file && imageDecryptFailed) {
                tile = (
                    <View className="flex-row items-center gap-2 p-3 bg-discord-backgroundSecondary rounded-lg mt-1 max-w-sm">
                        <SvgIcon
                            d={ERROR_PATH}
                            className="w-4 h-4 text-discord-danger"
                        />
                        <Text className="text-xs text-discord-danger">
                            {t("messageItem.couldnTDecryptImage")}
                        </Text>
                    </View>
                );
            } else if (thumb && !mediaImgRetry.failed) {
                let gallery: ReactNode = null;
                if (uploadGallery) {
                    const ug = uploadGallery;
                    const unav = galleryNav(ug.images.length, ug.index);
                    const ucur = ug.images[ug.index];
                    const uprev = unav.prevIndex;
                    const unext = unav.nextIndex;
                    if (ucur) {
                        gallery = (
                            <Lightbox
                                src={ucur.src}
                                alt={ucur.alt}
                                placeholders={ucur.placeholders}
                                dims={ucur.dims}
                                onClose={() => setUploadGallery(null)}
                                onPrev={
                                    uprev !== null
                                        ? () =>
                                              setUploadGallery({
                                                  images: ug.images,
                                                  index: uprev,
                                              })
                                        : undefined
                                }
                                onNext={
                                    unext !== null
                                        ? () =>
                                              setUploadGallery({
                                                  images: ug.images,
                                                  index: unext,
                                              })
                                        : undefined
                                }
                                position={galleryPositionLabel(
                                    ug.images.length,
                                    ug.index,
                                )}
                            />
                        );
                    }
                }
                tile = (
                    <>
                        <View
                            className="relative self-start group/img mt-1"
                            style={
                                imageBox
                                    ? boxStyle(imageBox)
                                    : // Zami: an image of no known size holds
                                      // a 16:9 box until it loads, then the
                                      // size it learned.
                                      fitStyle(null, 512, 384)
                            }
                        >
                            <Pressable
                                accessibilityRole="imagebutton"
                                accessibilityLabel={mediaFilename || undefined}
                                onPress={openImageUpload}
                                className="w-full h-full"
                            >
                                <Image
                                    source={mediaSource(mediaImgRetry.src)}
                                    placeholder={mediaSource(
                                        imageTilePlaceholder,
                                    )}
                                    placeholderContentFit="fill"
                                    accessible={false}
                                    className="w-full h-full rounded-lg"
                                    contentFit="contain"
                                    onError={mediaImgRetry.onError}
                                    onLoad={(e) => {
                                        if (imageBox) return;
                                        learnMediaSize(
                                            mediaSizeKey,
                                            e.source.width,
                                            e.source.height,
                                        );
                                        setImageLearned((n) => n + 1);
                                    }}
                                />
                            </Pressable>
                            {/* Zami: the GIF star shows on hover, which touch
                                doesn't have: there the viewer offers it. */}
                            {isGif && !isTouchscreen ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={
                                        imageIsFavourited
                                            ? t("common.removeFromFavourites")
                                            : t("common.addToFavourites")
                                    }
                                    onPress={toggleImageFavourite}
                                    className="absolute top-1.5 end-1.5 p-1 rounded-full bg-black/50 transition-opacity"
                                >
                                    {imageIsFavourited ? (
                                        <SvgIcon
                                            d={STAR_PATH}
                                            className="w-4 h-4 text-discord-warning"
                                        />
                                    ) : (
                                        <StrokedIcon className="w-4 h-4 text-white">
                                            <Path d={STAR_PATH} />
                                        </StrokedIcon>
                                    )}
                                </Pressable>
                            ) : null}
                        </View>
                        {gallery}
                    </>
                );
            } else {
                tile = (
                    <Text className="text-xs text-discord-textMuted italic">
                        {t("messageItem.imageUnavailable")}
                    </Text>
                );
            }
            return (
                <>
                    {mediaCaption()}
                    {tile}
                    {/* Outside the branches above so an encrypted image's viewer,
                        opened on its thumbnail mid-decrypt, stays open when the
                        full image lands. */}
                    {imageLightboxOpen && (full || thumb || senderThumbUrl) ? (
                        <Lightbox
                            src={full ?? ""}
                            alt={mediaFilename}
                            filename={mediaFilename || undefined}
                            placeholders={lightboxPlaceholders}
                            preview={file ? imagePreview : null}
                            dims={{ w: imgInfoW, h: imgInfoH }}
                            favourite={
                                !isGif
                                    ? undefined
                                    : file
                                      ? {
                                            url: eventFavouriteKey(
                                                encryptedFavouriteSource,
                                            ),
                                            previewUrl: eventFavouriteKey(
                                                encryptedFavouriteSource,
                                            ),
                                            source: encryptedFavouriteSource,
                                        }
                                      : full
                                        ? {
                                              url: full,
                                              previewUrl: thumb ?? full,
                                          }
                                        : undefined
                            }
                            onClose={() => setImageLightboxOpen(false)}
                        />
                    ) : null}
                </>
            );
        }
        if (msgtype === "m.video") {
            return (
                <>
                    {mediaCaption()}
                    <MessageVideo content={content} filename={mediaFilename} />
                </>
            );
        }
        if (msgtype === "m.audio") {
            if (voiceMsg) {
                const file = content?.file as EncryptedFile | undefined;
                return (
                    <>
                        {mediaCaption()}
                        <VoiceMessagePlayer
                            mxcUrl={file ? undefined : (content?.url as string)}
                            encryptedFile={file}
                            mimetype={
                                (
                                    content?.info as
                                        | { mimetype?: string }
                                        | undefined
                                )?.mimetype
                            }
                            waveform={voiceMsg.waveform}
                            durationMs={voiceMsg.durationMs}
                        />
                        {pluginAnnotation ? (
                            pluginAnnotation.busy ? (
                                <Pulse className="mt-1 max-w-sm">
                                    <Text className="text-sm text-gray-300">
                                        {pluginAnnotation.text ?? "…"}
                                    </Text>
                                </Pulse>
                            ) : (
                                <Text
                                    selectable
                                    className="mt-1 max-w-sm text-sm text-gray-300"
                                >
                                    {pluginAnnotation.text ?? "…"}
                                </Text>
                            )
                        ) : null}
                    </>
                );
            }
            return (
                <>
                    {mediaCaption()}
                    {audioCard()}
                </>
            );
        }
        if (isVerificationRequest) {
            return (
                <VerificationRequestMessage
                    eventId={eventId}
                    senderName={displayName}
                    isOwn={isOwnMessage}
                />
            );
        }
        if (msgtype === "m.location") {
            return (
                <LocationBody
                    content={content}
                    senderName={displayName}
                    senderAvatarUrl={avatarSrc}
                    isSelf={isOwnMessage}
                />
            );
        }
        if (msgtype === "m.file") {
            const file = content?.file as EncryptedFile | undefined;
            const fileUrl = file ? null : mxcToHttp(content?.url as string);
            const fileSize = (content?.info as any)?.size;
            const fileName = mediaFilename;
            const isSwf = fileName.toLowerCase().endsWith(".swf");
            return (
                <>
                    {mediaCaption()}
                    {isSwf && (file || fileUrl) ? (
                        <SwfEmbed
                            getSrc={() =>
                                file
                                    ? fetchDecryptedAttachmentBlob(
                                          file,
                                          (
                                              content?.info as
                                                  | { mimetype?: string }
                                                  | undefined
                                          )?.mimetype,
                                      )
                                    : fetchAttachmentBlob(fileUrl!)
                            }
                        />
                    ) : null}
                    {audioIsTracker ? audioCard() : null}
                    <View className="flex-row items-center gap-2 p-3 bg-discord-backgroundSecondary rounded-lg mt-1 max-w-sm w-full">
                        <SvgIcon
                            d={FILE_PATH}
                            className="w-8 h-8 text-discord-accent flex-shrink-0"
                        />
                        <View className="min-w-0 flex-1">
                            <Text
                                numberOfLines={1}
                                className="text-discord-textPrimary text-sm font-medium"
                            >
                                {fileName}
                            </Text>
                            <Text className="text-discord-textMuted text-xs">
                                {fileSize
                                    ? fileSize / 1024 < 1024
                                        ? t("messageItem.kb", {
                                              toFixed: (
                                                  fileSize / 1024
                                              ).toFixed(1),
                                          })
                                        : t("messageItem.mb", {
                                              toFixed: (
                                                  fileSize / 1048576
                                              ).toFixed(1),
                                          })
                                    : t("messageItem.fileAttachment")}
                            </Text>
                        </View>
                        {fileUrl || file ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t("messageItem.download")}
                                onPress={() => void downloadAttachment()}
                                className="p-1.5 rounded transition-colors flex-shrink-0"
                            >
                                <SvgIcon
                                    d={DOWNLOAD_PATH}
                                    className="w-5 h-5 text-discord-textMuted"
                                />
                            </Pressable>
                        ) : null}
                    </View>
                </>
            );
        }
        if (isEditing) return editBox();
        // m.emote: prefix the action with the sender's name so it
        // reads "* Name does something" even in grouped messages
        // where the header is hidden. Uses the same member-name
        // helper as the header (displayName). Rendered as its own
        // span, NEVER concatenated into the {@html} body (that
        // would corrupt the sanitized/escaped output).
        // Zami: the span goes at the start of Html's markup so it flows into
        // the first line as upstream's does; the name is escaped first, so it
        // can only ever be text.
        const html =
            msgtype === "m.emote"
                ? `<span>* ${escapeHtml(displayName)} </span>${bodyHtml}`
                : bodyHtml;
        return (
            <>
                <View className={bubble.bubble ? OWN_BUBBLE : ""}>
                    {bodyWithTrailing(
                        html,
                        `${bodyTextClass}${emojiOnly ? " emoji-only" : ""}${
                            msgtype === "m.emote" ? " italic" : ""
                        }${msgtype === "m.notice" ? " opacity-70" : ""}`,
                        receiptSpacerWidth,
                    )}
                </View>
                {eventLinks.map((link) => (
                    <MessageEmbed
                        key={link.href}
                        link={link}
                        currentRoomId={room.roomId}
                        onOpen={() => openMatrixTarget(link)}
                    />
                ))}
                {linkPreviewsEnabled
                    ? linkedUrls.map((url) => (
                          <LinkPreview key={url} url={url} />
                      ))
                    : null}
            </>
        );
    }

    // Zami: the receipt cluster's padding gutter on touch and the right-aligned
    // layout, as upstream's class toggles.
    const reactionsClass = `${
        isTouchscreen && receipts.length > 0 && !bubble.alignOwn ? "pe-14" : ""
    } ${bubble.alignOwn ? "flex-row justify-end" : ""}`;

    const row = (
        <Pressable
            ref={rootEl}
            // The row is a tab stop so the keyboard can reach the hover action bar
            // (which is `display:none` until this row, or something inside it, is
            // focus-visible). It is deliberately NOT `role="button"`: it isn't one,
            // and claiming the role would promise an Enter/Space activation we
            // don't implement.
            // Zami: not a screen-reader element either, so its content is.
            accessible={false}
            className={`group relative px-4 py-0.5 rounded transition-colors ${
                mentionHighlight
                    ? "bg-discord-warning/10 border-s-2 border-discord-warning"
                    : ""
            } ${showHeader ? "pt-3" : ""} ${
                mobileSelected || (!isTouchscreen && rowHovered)
                    ? "bg-discord-messageHover"
                    : ""
            }`}
            onHoverIn={() => {
                if (!interfaceState.isTouchscreen) setRowHovered(true);
            }}
            onHoverOut={() => {
                setRowHovered(false);
            }}
            onPress={onRowPress}
            onLongPress={menuMode === "hold" ? onRowLongPress : undefined}
            delayLongPress={500}
        >
            <SwipeShift store={swipe}>
                {/* Avatar column */}
                {bubble.alignOwn ? null : (
                    <View className="w-10 flex-shrink-0 mt-0.5">
                        {bubble.showAvatar ? (
                            <Pressable
                                ref={avatarBtnEl}
                                accessibilityRole="button"
                                accessibilityLabel={t(
                                    "messageItem.viewProfile",
                                )}
                                onPress={() =>
                                    openSenderProfile(avatarBtnEl.current)
                                }
                                className="rounded-full"
                            >
                                <Avatar
                                    src={avatarSrc}
                                    name={displayName}
                                    id={senderId}
                                    size={40}
                                />
                            </Pressable>
                        ) : null}
                    </View>
                )}

                {/* Content column */}
                <View
                    className={`flex-1 min-w-0 ${bubble.alignOwn ? "items-end" : ""}`}
                >
                    {/* Sender + timestamp */}
                    {bubble.showSenderName ? (
                        <View className="flex-row items-baseline gap-2 mb-0.5 min-w-0">
                            <Pressable
                                ref={nameBtnEl}
                                accessibilityRole="button"
                                onPress={() =>
                                    openSenderProfile(nameBtnEl.current)
                                }
                                className="min-w-0 shrink"
                            >
                                <Text
                                    numberOfLines={1}
                                    style={
                                        nameColour
                                            ? { color: nameColour }
                                            : undefined
                                    }
                                    className="font-semibold text-sm text-discord-textPrimary"
                                >
                                    {displayName}
                                </Text>
                            </Pressable>
                            <Text className="text-xs text-discord-textMuted flex-shrink-0">
                                {messageTimestamp(timestamp)}
                            </Text>
                            {shield ? <EventShield shield={shield} /> : null}
                            <MessageDecorations decorations={decorations} />
                        </View>
                    ) : bubble.showTimeOnlyHeader ? (
                        <View className="flex-row items-baseline gap-2 mb-0.5 justify-end">
                            <Text className="text-xs text-discord-textMuted flex-shrink-0">
                                {messageTimestamp(timestamp)}
                            </Text>
                            {shield ? <EventShield shield={shield} /> : null}
                            <MessageDecorations decorations={decorations} />
                        </View>
                    ) : shield || decorations.length ? (
                        // Grouped messages have no header row, but a shield/decoration
                        // must never vanish just because a message follows one from the
                        // same sender. This borrows the header row's shape so the badges
                        // land in the same column position they would have had above.
                        <View className="flex-row items-baseline gap-2 mb-0.5">
                            {shield ? <EventShield shield={shield} /> : null}
                            <MessageDecorations decorations={decorations} />
                        </View>
                    ) : null}

                    {/* Reply quote block */}
                    {replyTarget && replyTargetSender && replyTargetBody ? (
                        // A real <button>, not `role="button"`: the quote renders only
                        // plain-text spans (no {@html}, no link, no nested control), so
                        // the native element is safe — and it gets Enter/Space activation
                        // through the SAME onclick instead of a hand-rolled key handler.
                        // Zami: the sr-only purpose leads its accessible name, ahead
                        // of the quoted sender and body.
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${t("messageItem.jumpToTheRepliedToMessage")} ${replyTargetSender} ${replyTargetBody}`}
                            className="flex-row w-full items-start gap-1 mb-1 rounded"
                            onPress={() => jumpToReply(replyTarget.getId()!)}
                        >
                            <Reply
                                size={14}
                                className="text-discord-textMuted flex-shrink-0 self-center"
                            />
                            <View className="w-0.5 bg-discord-textMuted rounded-full self-stretch flex-shrink-0 opacity-60" />
                            <View className="flex-row items-center gap-1.5 min-w-0 shrink">
                                <Text className="text-xs font-semibold text-discord-textSecondary flex-shrink-0">
                                    {replyTargetSender}
                                </Text>
                                <Text
                                    numberOfLines={1}
                                    className="shrink text-xs text-discord-textSecondary opacity-80"
                                >
                                    {replyTargetBody}
                                </Text>
                            </View>
                        </Pressable>
                    ) : inReplyToId ? (
                        // Referenced event not in timeline — clickable to load context
                        <ReplyFallback
                            body={(content?.body as string | undefined) ?? ""}
                            onPress={() => jumpToReply(inReplyToId)}
                            missingLabel={
                                !replyTarget
                                    ? t("messageItem.originalMessageNotLoaded")
                                    : replyTargetRedacted
                                      ? t("messageItem.originalMessageDeleted")
                                      : t(
                                            "messageItem.originalMessageUnavailable",
                                        )
                            }
                        />
                    ) : null}

                    {messageBody()}

                    {/* Paged lightbox for this message's OWN inline body images. A single
                        media image opens with no dead nav; ≥2 page with the chevrons /
                        arrow keys. Mounted once at row level so it covers both the text
                        body and a media caption. */}
                    {bodyGallery
                        ? (() => {
                              const g = bodyGallery;
                              const nav = galleryNav(g.images.length, g.index);
                              const cur = g.images[g.index];
                              const prev = nav.prevIndex;
                              const next = nav.nextIndex;
                              if (!cur) return null;
                              return (
                                  <Lightbox
                                      src={cur.src}
                                      alt={cur.alt}
                                      onClose={() => setBodyGallery(null)}
                                      onPrev={
                                          prev !== null
                                              ? () =>
                                                    setBodyGallery({
                                                        images: g.images,
                                                        index: prev,
                                                    })
                                              : undefined
                                      }
                                      onNext={
                                          next !== null
                                              ? () =>
                                                    setBodyGallery({
                                                        images: g.images,
                                                        index: next,
                                                    })
                                              : undefined
                                      }
                                      position={galleryPositionLabel(
                                          g.images.length,
                                          g.index,
                                      )}
                                  />
                              );
                          })()
                        : null}

                    {/* Thread summary chip (root only, once replies are diverted).
                        Only where opening the thread is possible: the thread panel's
                        own header renders the root without a handler. */}
                    {isThreadRoot && onOpenThread ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityHint={t("messageItem.openThread")}
                            onPress={() => onOpenThread?.(eventId)}
                            className="flex-row self-start items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded bg-discord-backgroundSecondary border border-discord-divider transition-colors"
                        >
                            <SvgIcon
                                d={THREAD_CHIP_PATH}
                                className="w-3 h-3 flex-shrink-0 text-discord-textMuted"
                            />
                            {threadName ? (
                                <>
                                    <Text
                                        numberOfLines={1}
                                        className="text-xs font-semibold text-discord-textPrimary max-w-48 shrink"
                                    >
                                        {threadName}
                                    </Text>
                                    <Text className="text-xs text-discord-textMuted">
                                        &middot;
                                    </Text>
                                </>
                            ) : null}
                            <Text className="text-xs text-discord-textMuted">
                                {t("common.replyCount", {
                                    count: threadSummary.count,
                                })}
                            </Text>
                            {threadSummary.latestTs > 0 ? (
                                <Text className="text-xs text-discord-textMuted">
                                    &middot; {timeOnly(threadSummary.latestTs)}
                                </Text>
                            ) : null}
                        </Pressable>
                    ) : null}

                    {/* Reactions (reserve right clearance on touch so the wrapped reaction
                        row never runs under the out-of-flow read-receipt overlay; not needed
                        when own bubbles are right-aligned — the overlay is on the LEFT then) */}
                    <View className={reactionsClass}>
                        <Reactions
                            eventId={eventId}
                            room={room}
                            reactionTick={reactionTick}
                        />
                    </View>

                    {/* Failed-send indicator: retry or delete a NOT_SENT local echo */}
                    {isFailed ? (
                        <View className="flex-row items-center gap-2 px-4 py-0.5">
                            <StrokedIcon className="w-4 h-4 flex-shrink-0 text-discord-danger">
                                <Circle cx="12" cy="12" r="10" />
                                <Line x1="12" y1="8" x2="12" y2="12" />
                                <Line x1="12" y1="16" x2="12.01" y2="16" />
                            </StrokedIcon>
                            <Text className="text-xs text-discord-danger">
                                {t("messageItem.failedToSend")}
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ disabled: isResending }}
                                disabled={isResending}
                                onPress={() => void retrySend()}
                                className={isResending ? "opacity-50" : ""}
                            >
                                <Text className="text-xs text-discord-danger font-semibold underline">
                                    {isResending
                                        ? t("messageItem.retrying")
                                        : t("common.retry")}
                                </Text>
                            </Pressable>
                            <Text className="text-xs text-discord-textMuted">
                                ·
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => deleteFailedMessage(event)}
                            >
                                <Text className="text-xs text-discord-danger font-semibold underline">
                                    {t("common.delete")}
                                </Text>
                            </Pressable>
                        </View>
                    ) : null}
                </View>
            </SwipeShift>

            {/* Read receipts: absolutely anchored to the row's bottom corner (the
                row is `relative`), OUT OF FLOW, so receipts appearing or moving
                between messages never reflows the timeline. Anchored bottom-RIGHT
                by default; when own bubbles are right-aligned the bubble hugs the
                right edge, so the cluster moves to the bottom-LEFT to clear it.
                Zami: a child of the row itself (upstream's sits in the content
                column but is placed against the row, its positioned ancestor). */}
            {receipts.length > 0 ? (
                <>
                    <Pressable
                        ref={receiptBtnEl}
                        accessibilityRole="button"
                        accessibilityLabel={t(
                            "messageItem.showWhoReadThisMessage",
                        )}
                        onPress={openReaderList}
                        className={`absolute bottom-0 flex-row items-center justify-center gap-0.5 max-w-[45%] min-h-6 min-w-6 rounded ${
                            bubble.alignOwn ? "start-4" : "end-4"
                        }`}
                    >
                        {receiptCluster.shown.map((r) => (
                            <Avatar
                                key={r.userId}
                                src={r.avatarUrl}
                                name={r.name}
                                id={r.userId}
                                size={16}
                            />
                        ))}
                        {receiptCluster.overflow > 0 ? (
                            <Text className="text-[10px] text-discord-textMuted ms-1">
                                +{receiptCluster.overflow}
                            </Text>
                        ) : null}
                    </Pressable>
                    {readerOpen ? (
                        <ReactorPopover
                            reactors={receiptReaderList.shown.map((r) => ({
                                userId: r.userId,
                                name: r.name,
                                avatarUrl: r.avatarUrl,
                            }))}
                            overflow={receiptReaderList.overflow}
                            touch={readerTouch}
                            desktopDismiss
                            x={readerX}
                            y={readerY}
                            onClose={closeReaderList}
                            modalId="read-receipts"
                            dialogLabel={t("messageItem.readBy")}
                        />
                    ) : null}
                </>
            ) : null}

            {/* Inline timestamp (non-grouped messages, shows on hover).
                Ends 8px before the content column (px-4 + w-10 + gap-3 =
                68px), since "10:56 PM" is wider than the avatar column; a
                longer time spills toward the row edge, not the content.
                Zami: mounted while hovered, for `group-hover:opacity-100`. */}
            {bubble.showInlineHoverTime && rowHovered ? (
                <View
                    pointerEvents="none"
                    className="absolute start-0 top-0 bottom-0 w-[60px] flex-row items-center justify-end"
                >
                    <Text
                        numberOfLines={1}
                        className="text-xs text-discord-textMuted"
                    >
                        {timeOnly(timestamp)}
                    </Text>
                </View>
            ) : null}

            {!isFailed ? (
                <SwipeReveal store={swipe} icon={swipeRevealIcon} />
            ) : null}

            {/*
                Hover action bar: always visible when a picker/dialog is open, otherwise
                on group-hover OR *keyboard* focus.
                The bar is only MOUNTED while the row is hovered, focused or pinned
                (`mountActionBar`, utils/actionBarMount.ts); the classes below still
                decide whether a mounted bar shows.
                Zami: mounted is shown: only hover and the pins mount it here.
            */}
            {mountActionBar ? (
                <View
                    role="toolbar"
                    accessibilityLabel={t("messageItem.messageActions")}
                    className="flex-row absolute end-4 top-0 -translate-y-1/2 items-center gap-1 bg-discord-backgroundSecondary border border-discord-divider rounded-lg px-1 py-0.5 shadow-md z-20"
                >
                    {!isTouchscreen && canEditMessage ? (
                        <ActionButton
                            label={t("messageItem.editMessage")}
                            onPress={startEdit}
                        >
                            <SvgIcon
                                d={EDIT_PATH}
                                className="w-4 h-4 text-discord-textMuted"
                            />
                        </ActionButton>
                    ) : null}
                    {!isTouchscreen && canPin ? (
                        <ActionButton
                            label={
                                isPinned
                                    ? t("messageItem.unpinMessage")
                                    : t("messageItem.pinMessage")
                            }
                            onPress={() => void togglePin()}
                            disabled={pinning}
                        >
                            <SvgIcon
                                d={PIN_PATH}
                                className={`w-4 h-4 ${
                                    isPinned
                                        ? "text-discord-accent"
                                        : "text-discord-textMuted"
                                }`}
                            />
                        </ActionButton>
                    ) : null}
                    {/* Add reaction */}
                    <View className="relative">
                        <ActionButton
                            buttonRef={reactionBtnEl}
                            label={t("messageItem.addReaction")}
                            expanded={showEmojiPicker}
                            onPress={() => {
                                if (showEmojiPicker) {
                                    closeModal();
                                } else {
                                    // Zami: measured, so `below` settles just
                                    // after the picker opens.
                                    setEmojiPickerBelow(false);
                                    reactionBtnEl.current?.measureInWindow(
                                        (_x, top) =>
                                            setEmojiPickerBelow(top < 400),
                                    );
                                    openReactionPicker();
                                }
                            }}
                        >
                            <SvgIcon className="w-4 h-4 text-discord-textMuted">
                                <Path fillRule="evenodd" d={REACTION_PATH} />
                            </SvgIcon>
                        </ActionButton>
                        {showEmojiPicker && !isTouchscreen ? (
                            <View
                                className={
                                    emojiPickerBelow
                                        ? "absolute top-full end-0 mt-1 z-50"
                                        : "absolute bottom-full end-0 mb-1 z-50"
                                }
                            >
                                <EmojiPicker
                                    room={room}
                                    onSelect={async (emoji) => {
                                        await sendReaction(
                                            room.roomId,
                                            eventId,
                                            emoji,
                                        );
                                        closeModal();
                                    }}
                                    onSelectCustom={async (emoji) => {
                                        await sendReaction(
                                            room.roomId,
                                            eventId,
                                            emoji.mxcUrl,
                                        );
                                        closeModal();
                                    }}
                                    onClose={closeModal}
                                />
                            </View>
                        ) : null}
                    </View>
                    <ActionButton
                        label={t("messageItem.reply")}
                        onPress={() => onReply(event)}
                    >
                        <SvgIcon
                            d={REPLY_PATH}
                            className="w-4 h-4 text-discord-textMuted"
                        />
                    </ActionButton>
                    {isTouchscreen && canEditMessage ? (
                        // Mobile: on your own editable message Edit takes the
                        // thread slot (thread moves into the ⋯ sheet). Desktop shows
                        // Edit at the start of the bar instead.
                        <ActionButton
                            label={t("messageItem.editMessage")}
                            onPress={startEdit}
                        >
                            <SvgIcon
                                d={EDIT_PATH}
                                className="w-4 h-4 text-discord-textMuted"
                            />
                        </ActionButton>
                    ) : onOpenThread && (isThreadReply || !isRelatedEvent) ? (
                        <ActionButton
                            label={
                                isThreadReply
                                    ? t("messageItem.openThread")
                                    : t("messageItem.replyInThread")
                            }
                            onPress={() => onOpenThread(threadRootId)}
                        >
                            <SvgIcon
                                d={THREAD_PATH}
                                className="w-4 h-4 text-discord-textMuted"
                            />
                        </ActionButton>
                    ) : null}
                    {(eventType === "m.room.message" ||
                        eventType === "m.sticker") &&
                    !isFailed ? (
                        <ActionButton
                            label={t("messageItem.forwardMessage")}
                            onPress={openForwardDialog}
                        >
                            <Forward
                                size={16}
                                className="text-discord-textMuted"
                            />
                        </ActionButton>
                    ) : null}
                    {!isTouchscreen
                        ? pluginActionViews.map((view) => (
                              <ActionButton
                                  key={view.entryId}
                                  label={view.label}
                                  onPress={() => handlePluginAction(view.key)}
                              >
                                  {view.icon ? (
                                      <SvgIcon
                                          d={view.icon}
                                          className="w-4 h-4 text-discord-textMuted"
                                      />
                                  ) : (
                                      <Text className="text-xs font-semibold text-discord-textMuted">
                                          {view.label.slice(0, 1)}
                                      </Text>
                                  )}
                              </ActionButton>
                          ))
                        : null}
                    {isTouchscreen &&
                    (overflowRows.length > 0 ||
                        pluginActionViews.length > 0) ? (
                        <ActionButton
                            label={t("messageItem.moreActions")}
                            onPress={openActionsSheet}
                        >
                            <SvgIcon
                                d={MORE_PATH}
                                className="w-4 h-4 text-discord-textMuted"
                            />
                        </ActionButton>
                    ) : null}
                    {!isTouchscreen && eventId.startsWith("$") && !isFailed ? (
                        <ActionButton
                            label={
                                linkCopied
                                    ? t("messageItem.linkCopied2")
                                    : t("messageItem.copyMessageLink")
                            }
                            onPress={() => void copyMessageLink()}
                        >
                            {linkCopied ? (
                                <Check
                                    size={16}
                                    className="text-discord-textMuted"
                                />
                            ) : (
                                <Link
                                    size={16}
                                    className="text-discord-textMuted"
                                />
                            )}
                        </ActionButton>
                    ) : null}
                    {!isTouchscreen && !isOwnMessage && !isFailed ? (
                        <MessageReportAction
                            roomId={room.roomId}
                            eventId={eventId}
                            keyboardOffset={keyboardOffset}
                            open={showReportDialog}
                            onOpenChange={setShowReportDialog}
                        />
                    ) : null}
                    {!isTouchscreen &&
                    !isOwnMessage &&
                    !isFailed &&
                    canRedact ? (
                        <MessageRedactAction
                            roomId={room.roomId}
                            eventId={eventId}
                            keyboardOffset={keyboardOffset}
                            open={showRedactDialog}
                            onOpenChange={setShowRedactDialog}
                        />
                    ) : null}
                    {/* Delete is last for your own messages and for a moderator's
                        redact on others', so it sits in the same place on both. */}
                    {!isTouchscreen && isOwnMessage ? (
                        confirmingDelete ? (
                            <>
                                <Text className="text-xs text-discord-textMuted px-1">
                                    {t("messageItem.delete")}
                                </Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={t(
                                        "messageItem.yesDeleteMessage",
                                    )}
                                    onPress={() => resolveDelete(true)}
                                    className="px-2 py-1 rounded bg-discord-danger transition-colors"
                                >
                                    <Text className="text-xs font-semibold text-white">
                                        {t("messageItem.yes")}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={t(
                                        "messageItem.noKeepMessage",
                                    )}
                                    onPress={() => resolveDelete(false)}
                                    className="px-2 py-1 rounded transition-colors"
                                >
                                    <Text className="text-xs font-semibold text-discord-textMuted">
                                        {t("messageItem.no")}
                                    </Text>
                                </Pressable>
                            </>
                        ) : (
                            // Zami: no shift-click to skip the confirmation.
                            <ActionButton
                                label={t("messageItem.deleteMessage")}
                                onPress={() => setConfirmingDelete(true)}
                            >
                                <SvgIcon
                                    d={DELETE_PATH}
                                    className="w-4 h-4 text-discord-textMuted"
                                />
                            </ActionButton>
                        )
                    ) : null}
                </View>
            ) : null}
        </Pressable>
    );

    return (
        <>
            {showEmojiPicker && isTouchscreen ? (
                // Zami: upstream's `fixed` backdrop and sheet, at the app root.
                <Portal>
                    <View className="absolute inset-0" pointerEvents="box-none">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("common.close")}
                            className="absolute inset-0 z-40"
                            onPress={closeModal}
                        />
                        <View
                            className="absolute start-0 end-0 z-50"
                            style={{ bottom: keyboardOffset }}
                        >
                            <EmojiPicker
                                room={room}
                                onSelect={async (emoji) => {
                                    await sendReaction(
                                        room.roomId,
                                        eventId,
                                        emoji,
                                    );
                                    closeModal();
                                }}
                                onSelectCustom={async (emoji) => {
                                    await sendReaction(
                                        room.roomId,
                                        eventId,
                                        emoji.mxcUrl,
                                    );
                                    closeModal();
                                }}
                                onClose={closeModal}
                            />
                        </View>
                    </View>
                </Portal>
            ) : null}
            {/* Zami: `data-event-id` is how MessageArea finds a row in the DOM;
                its list finds rows by index instead. */}
            {swipeOffered ? (
                <SwipePan handlers={swipeHandlers}>{row}</SwipePan>
            ) : (
                row
            )}

            {/*
                Touch overflow: the Report/Redact dialogs live inside these components, so
                on mobile we render them trigger-less (no inline button) and drive them
                from the sheet via the bound `show()`. Only one of the desktop-inline or
                these touch instances renders per device.
            */}
            {isTouchscreen &&
            !isOwnMessage &&
            !isFailed &&
            touchDialogsMounted ? (
                <MessageReportAction
                    showTrigger={false}
                    ref={reportComp}
                    roomId={room.roomId}
                    eventId={eventId}
                    keyboardOffset={keyboardOffset}
                    open={showReportDialog}
                    onOpenChange={setShowReportDialog}
                />
            ) : null}
            {isTouchscreen &&
            !isOwnMessage &&
            !isFailed &&
            canRedact &&
            touchDialogsMounted ? (
                <MessageRedactAction
                    showTrigger={false}
                    ref={redactComp}
                    roomId={room.roomId}
                    eventId={eventId}
                    keyboardOffset={keyboardOffset}
                    open={showRedactDialog}
                    onOpenChange={setShowRedactDialog}
                />
            ) : null}

            {showActionsSheet ? (
                <MessageActionsSheet
                    rows={overflowRows}
                    pluginRows={pluginActionViews}
                    onChoose={handleActionChoose}
                    onChoosePlugin={handlePluginAction}
                    onClose={closeModal}
                />
            ) : null}

            {showForwardDialog ? <ForwardMessageDialog event={event} /> : null}
        </>
    );
}

/**
 * Zami: rows re-render only when their props change. `timelineEvents` and
 * `timelineIndex` are new for every row whenever the timeline grows or pages,
 * but only an image upload reads them (to page across its siblings), so
 * other rows skip those changes.
 */
function sameProps(prev: Readonly<Props>, next: Readonly<Props>): boolean {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<
        keyof Props
    >;
    for (const key of keys) {
        if (Object.is(prev[key], next[key])) continue;
        if (
            (key === "timelineEvents" || key === "timelineIndex") &&
            next.event.getContent()?.msgtype !== "m.image"
        )
            continue;
        return false;
    }
    return true;
}

export default memo(MessageItem, sameProps);

// A timeline event is a pageable image upload iff it is a plain m.image with
// a resolvable url. Encrypted uploads (content.file) are excluded — they need
// an async per-event decrypt, so an encrypted room keeps single-image opens.
function isPageableImageUpload(e: MatrixEvent): boolean {
    if (e.getType() !== "m.room.message") return false;
    const c = e.getContent() as {
        msgtype?: string;
        url?: unknown;
        file?: unknown;
    };
    if (c?.msgtype !== "m.image") return false;
    if (c?.file) return false;
    if (typeof c?.url !== "string" || (c.url as string).length === 0)
        return false;
    // Must resolve to a real http URL: a non-mxc/malformed url yields null
    // from mxcToHttp and would otherwise page as a broken empty-src image.
    return mxcToHttp(c.url as string) != null;
}

function uploadImageOf(e: MatrixEvent): GalleryImage {
    const c = e.getContent() as {
        url?: string;
        filename?: string;
        body?: string;
        info?: { w?: unknown; h?: unknown; mimetype?: string };
    };
    const sender = videoPoster(c as Record<string, unknown>);
    const isGifUpload = c.info?.mimetype === "image/gif";
    return {
        src: mxcToHttp(c.url as string) ?? "",
        alt: (c.filename ?? c.body ?? "") as string,
        placeholders: [
            isGifUpload ? null : mxcToHttp(c.url as string, 800, 600, "scale"),
            sender?.kind === "plain" ? mxcToHttp(sender.mxc) : null,
        ],
        dims: { w: c.info?.w, h: c.info?.h },
    };
}

// Zami: the shared empty lists, so a row with no plugin actions or
// decorations keeps the same one.
const NO_ACTIONS: PluginMessageActionView[] = [];
const NO_DECORATIONS: MessageDecoration[] = [];

function sameActionViews(
    a: PluginMessageActionView[],
    b: PluginMessageActionView[],
): boolean {
    return (
        a.length === b.length &&
        a.every(
            (v, i) =>
                v.key === b[i].key &&
                v.entryId === b[i].entryId &&
                v.label === b[i].label &&
                v.icon === b[i].icon,
        )
    );
}

function sameDecorations(
    a: MessageDecoration[],
    b: MessageDecoration[],
): boolean {
    return (
        a.length === b.length &&
        a.every(
            (d, i) =>
                d.key === b[i].key &&
                d.badge === b[i].badge &&
                d.tooltip === b[i].tooltip,
        )
    );
}

/** Zami: a display name as HTML text. */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** Zami: a media box's size, for a View or an Image. */
interface MediaBoxStyle {
    width: DimensionValue;
    maxWidth: DimensionValue;
    aspectRatio: number;
}

/** Zami: an `<img width height>` box: its size, shrinking to the column. */
function boxStyle(box: { width: number; height: number }): MediaBoxStyle {
    return {
        width: box.width,
        maxWidth: "100%",
        aspectRatio: box.width / box.height,
    };
}

/**
 * Zami: media of no known size within CSS bounds (`max-w-lg max-h-96`): as
 * wide as the column allows up to `maxW`, at 16:9 until it loads.
 */
function fitStyle(
    size: { width: number; height: number } | null,
    maxW: number,
    maxH: number,
): MediaBoxStyle {
    if (!size) return { width: "100%", maxWidth: maxW, aspectRatio: 16 / 9 };
    const aspect = size.width / size.height;
    return {
        width: "100%",
        maxWidth: Math.min(maxW, maxH * aspect, size.width),
        aspectRatio: aspect,
    };
}

/** Zami: one of the action bar's icon buttons (`p-1.5 rounded`). */
function ActionButton({
    label,
    onPress,
    disabled = false,
    expanded,
    buttonRef,
    children,
}: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    expanded?: boolean;
    buttonRef?: RefObject<HostInstance | null>;
    children: ReactNode;
}) {
    return (
        <Pressable
            ref={buttonRef}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled, expanded }}
            disabled={disabled}
            onPress={onPress}
            className={`p-1.5 rounded transition-colors ${
                disabled ? "opacity-50" : ""
            }`}
        >
            {children}
        </Pressable>
    );
}

/** Zami: the replied-to quote when the parent isn't loaded. */
function ReplyFallback({
    body,
    onPress,
    missingLabel,
}: {
    body: string;
    onPress: () => void;
    missingLabel: string;
}) {
    const fallbackLine = (() => {
        const line = body.split("\n")[0];
        if (!line.startsWith("> ")) return null;
        // Format: "> <@sender:server> text" or "> * <@sender:server> text"
        const m = line.match(/^> (?:\* )?<(@[^>]+)> ?(.*)/);
        return m ? { sender: m[1], text: m[2] } : null;
    })();
    // Same <button> choice, and the same sr-only-child labelling, as
    // the resolved quote above, so both previews behave identically
    // from the keyboard and read identically to assistive tech.
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("messageItem.jumpToTheRepliedToMessage")} ${
                fallbackLine
                    ? `${fallbackLine.sender} ${fallbackLine.text || "…"}`
                    : missingLabel
            }`}
            className="flex-row w-full items-start gap-1 mb-1 rounded opacity-60 transition-opacity"
            onPress={onPress}
        >
            <View className="w-0.5 bg-discord-textMuted rounded-full self-stretch flex-shrink-0" />
            <View className="flex-row items-center gap-1.5 min-w-0 shrink">
                {fallbackLine ? (
                    <>
                        <Text className="text-xs font-semibold text-discord-textSecondary flex-shrink-0">
                            {fallbackLine.sender}
                        </Text>
                        <Text
                            numberOfLines={1}
                            className="shrink text-xs text-discord-textMuted"
                        >
                            {fallbackLine.text || "…"}
                        </Text>
                    </>
                ) : (
                    // Only a genuinely redacted parent is "deleted". A
                    // present-but-bodyless parent is either still
                    // decrypting (encrypted room, keys not yet applied)
                    // or a non-message type (sticker/poll) — call that
                    // "unavailable", not "deleted", so a decrypting
                    // target is not mislabelled. No parent = not loaded.
                    <Text className="text-xs text-discord-textMuted italic">
                        {missingLabel}
                    </Text>
                )}
            </View>
        </Pressable>
    );
}

/** Zami: Zam's stroked inline icons (`fill="none" stroke="currentColor"
 *  stroke-width="2"`, round caps), stroked in the text color of `className`. */
function StrokedIcon({
    className,
    children,
}: {
    className: string;
    children: ReactNode;
}) {
    const { color } = useResolveClassNames(className);
    return (
        <View
            className={className}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            <Svg width="100%" height="100%" viewBox="0 0 24 24">
                <G
                    fill="none"
                    stroke={(color as string | undefined) ?? "white"}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    {children}
                </G>
            </Svg>
        </View>
    );
}

/** Zami: the media events AudioControls redraws on. */
const AUDIO_CONTROL_EVENTS = [
    "play",
    "pause",
    "ended",
    "timeupdate",
    "durationchange",
    "error",
];

/**
 * Zami: the `<audio controls autoplay>` element, playing the downloaded file
 * (Zami's `Audio`, which plays Ogg and WebM Opus too), with a play/pause
 * button, a seek bar and the time.
 */
function AudioControls({ src }: { src: string }) {
    const [audio] = useState(() => {
        const element = new Audio();
        element.autoplay = true;
        return element;
    });
    const [, redraw] = useState(0);
    const [barWidth, setBarWidth] = useState(0);
    useEffect(() => {
        const update = () => redraw((n) => n + 1);
        for (const type of AUDIO_CONTROL_EVENTS)
            audio.addEventListener(type, update);
        audio.src = src;
        return () => {
            for (const type of AUDIO_CONTROL_EVENTS)
                audio.removeEventListener(type, update);
            audio.pause();
        };
    }, [audio, src]);
    const playing = !audio.paused;
    const currentTime = audio.currentTime;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
    function toggle() {
        if (playing) audio.pause();
        else void audio.play().catch(() => {});
    }
    function seek(e: GestureResponderEvent) {
        if (duration <= 0 || barWidth <= 0) return;
        const frac = Math.min(
            1,
            Math.max(0, e.nativeEvent.locationX / barWidth),
        );
        audio.currentTime = frac * duration;
    }
    return (
        <View className="w-full h-8 flex-row items-center gap-2">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("messageItem.audio")}
                accessibilityState={{ checked: playing }}
                onPress={toggle}
                className="p-1 rounded"
            >
                <SvgIcon
                    d={playing ? PAUSE_PATH : PLAY_PATH}
                    className="w-4 h-4 text-discord-textPrimary"
                />
            </Pressable>
            <Pressable
                accessibilityRole="adjustable"
                accessibilityLabel={t("voiceMessagePlayer.seek")}
                accessibilityValue={{
                    min: 0,
                    max: 100,
                    now: Math.round(progress * 100),
                }}
                onPress={seek}
                onLayout={(e: LayoutChangeEvent) =>
                    setBarWidth(e.nativeEvent.layout.width)
                }
                className="flex-1 h-8 justify-center"
            >
                <View className="h-1 rounded-full bg-discord-backgroundSecondary overflow-hidden">
                    <View
                        className="h-full bg-discord-accent"
                        style={{ width: `${progress * 100}%` }}
                    />
                </View>
            </Pressable>
            <Text className="text-[11px] text-discord-textMuted tabular-nums">
                {formatCallDuration(currentTime * 1000)}
                {duration > 0
                    ? ` / ${formatCallDuration(duration * 1000)}`
                    : ""}
            </Text>
        </View>
    );
}

// --- Swipe-to-reply (`use:swipePan`) ---

interface SwipeHandlers {
    onEngage: () => void;
    onMove: (translateX: number, stage: SwipeStage, dx: number) => void;
    onRelease: (stage: SwipeStage) => void;
    onCancel: () => void;
}

const SWIPE_SNAP_MS = 320;
const SWIPE_SNAP_EASING = Easing.bezier(0.34, 1.56, 0.64, 1);
// Zami: the far end of the pan's offset ranges, for "never".
const OFFSET_NEVER = 100_000;

/**
 * Zami: `swipeTranslate` and `swipeDx` (upstream's $state), outside React state:
 * a drag moves only the views that read them. The snap-back tweens the
 * translate home with upstream's transition (320 ms, overshooting).
 */
interface SwipeStore {
    readonly translate: number;
    readonly dx: number;
    set: (translate: number, dx: number) => void;
    snapBack: (animate: boolean) => void;
    stop: () => void;
    subscribe: (listener: () => void) => () => void;
}

function createSwipeStore(): SwipeStore {
    let translate = 0;
    let dx = 0;
    let frame = 0;
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of listeners) listener();
    };
    const stop = () => {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
    };
    return {
        get translate() {
            return translate;
        },
        get dx() {
            return dx;
        },
        set(nextTranslate, nextDx) {
            stop();
            translate = nextTranslate;
            dx = nextDx;
            emit();
        },
        snapBack(animate) {
            stop();
            dx = 0;
            const from = translate;
            if (!animate || from === 0) {
                translate = 0;
                emit();
                return;
            }
            const started = Date.now();
            const step = () => {
                const t = Math.min(1, (Date.now() - started) / SWIPE_SNAP_MS);
                translate = from * (1 - SWIPE_SNAP_EASING(t));
                if (t >= 1) {
                    translate = 0;
                    frame = 0;
                } else {
                    frame = requestAnimationFrame(step);
                }
                emit();
            };
            emit();
            frame = requestAnimationFrame(step);
        },
        stop,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

/** Zami: the `.swipe-shift` row, slid by the swipe. (Its `flex-1` is
 *  dropped: on the web its parent isn't a flex box, so it does nothing, and
 *  here it would collapse the row's height.) */
function SwipeShift({
    store,
    children,
}: {
    store: SwipeStore;
    children: ReactNode;
}) {
    const translate = useSyncExternalStore(
        store.subscribe,
        () => store.translate,
    );
    return (
        <View
            className="swipe-shift flex-row gap-3 min-w-0"
            style={
                translate !== 0
                    ? { transform: [{ translateX: translate }] }
                    : undefined
            }
        >
            {children}
        </View>
    );
}

/** Zami: the reply/edit button the swipe reveals at the row's end. */
function SwipeReveal({
    store,
    icon,
}: {
    store: SwipeStore;
    icon: "none" | "reply" | "edit";
}) {
    const dx = useSyncExternalStore(store.subscribe, () => store.dx);
    if (!(dx < 0)) return null;
    const reveal = swipeRevealStyle(dx);
    // Zami: not ported: the armed pop (`swipe-armed-pop`, a keyframe
    // overshoot when a threshold is crossed).
    return (
        <View
            className="absolute end-3 top-1/2"
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
                opacity: reveal.opacity,
                // `translateY(-50%)` of the 36px button.
                transform: [{ translateY: -18 }, { scale: reveal.scale }],
            }}
        >
            <View
                className={`flex-row items-center justify-center w-9 h-9 rounded-full transition-colors ${
                    icon === "edit"
                        ? "bg-discord-backgroundTertiary"
                        : icon === "reply"
                          ? "bg-discord-accent"
                          : "bg-discord-backgroundTertiary"
                }`}
            >
                {icon === "edit" ? (
                    <Pencil size={16} className="text-discord-textPrimary" />
                ) : (
                    <Reply
                        size={16}
                        className={
                            icon === "reply"
                                ? "text-white"
                                : "text-discord-textSecondary"
                        }
                    />
                )}
            </View>
        </View>
    );
}

/**
 * Zami: `use:swipePan`: a pan that engages on a leftward drag past
 * SWIPE_ENGAGE_PX and fails on a vertical one (the timeline scrolls) or a
 * rightward one (the channel drawer opens). Once it engages, the row's press
 * is cancelled, which is upstream's suppressed tap. Only rows on a device that
 * swipes mount it, so the others create no native handler.
 */
function SwipePan({
    handlers,
    children,
}: {
    handlers: RefObject<SwipeHandlers>;
    children: ReactNode;
}) {
    const enabled = useRune(
        () => (
            void pluginRegistry.tick,
            interfaceState.isTouchscreen &&
                pluginRegistry.swipeHandlers.length > 0 &&
                interfaceState.modal === null &&
                !interfaceState.lightboxOpen &&
                interfaceState.sidebar === null
        ),
    );
    const pan = usePanGesture(
        useMemo(
            (): PanGestureConfig => ({
                runOnJS: true,
                enabled,
                activeOffsetX: [-SWIPE_ENGAGE_PX, OFFSET_NEVER],
                failOffsetX: [-OFFSET_NEVER, SWIPE_ENGAGE_PX],
                failOffsetY: [-VERTICAL_LOCK_PX, VERTICAL_LOCK_PX],
                onActivate: (e) => {
                    handlers.current.onEngage();
                    handlers.current.onMove(
                        clampSwipeTranslate(e.translationX),
                        swipeStage(e.translationX),
                        e.translationX,
                    );
                },
                onUpdate: (e) =>
                    handlers.current.onMove(
                        clampSwipeTranslate(e.translationX),
                        swipeStage(e.translationX),
                        e.translationX,
                    ),
                onDeactivate: (e) => {
                    if (e.canceled) handlers.current.onCancel();
                    else handlers.current.onRelease(swipeStage(e.translationX));
                },
            }),
            [enabled, handlers],
        ),
    );
    return <GestureDetector gesture={pan}>{children}</GestureDetector>;
}
