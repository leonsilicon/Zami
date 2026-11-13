import { createRowCache } from "@-/com.leonsilicon.zami.lists";
import { SvgIcon, Spin } from "@-/com.leonsilicon.zami.rn";
import {
    sameObject,
    shallowEqual,
    useRune,
} from "@-/com.leonsilicon.zami.svelte-react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
    createContext,
    memo,
    useCallback,
    useContext,
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactNode,
    type ComponentRef,
    type RefObject,
} from "react";
import {
    BackHandler,
    FlatList,
    I18nManager,
    PixelRatio,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
    type LayoutRectangle,
    type ListRenderItemInfo,
    type ViewStyle,
} from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useCSSVariable, useResolveClassNames } from "uniwind";
import { HIERARCHY_TTL_MS } from "$lib/utils/hierarchyRefresh";
import { t } from "$lib/i18n";
import type { Room } from "matrix-js-sdk";
import Avatar from "$lib/components/ui/Avatar.svelte";
import {
    getRoomAvatar,
    getRoomDisplayName,
    getRoomUnreadInfo,
    roomHasThreadUnread,
    joinRoom,
    knockRoom,
    cancelKnock,
    leaveRoom,
    getMyPowerLevel,
    getRoomPowerLevels,
    getRoom,
    isJoinedNow,
    canInviteToRoom,
    getRoomShareLink,
    markRoomAsRead,
    getSpaces,
    getRoomDisplayName as getSpaceName,
    addRoomToSpace,
    canAddRoomToSpace,
    getRoomNotificationSetting,
    setRoomNotificationSetting,
    getRoomTags,
    toggleRoomTag,
    getRoomsInSpace,
    reorderRoomTag,
    reorderSpaceChild,
    setRoomTagOrderRaw,
    setSpaceChildOrder,
    getSpaceChildren,
    getSpaceChildIds,
    fetchSpaceHierarchy,
    getCachedHierarchy,
    getCachedHierarchyAge,
    patchCachedHierarchyEntry,
    getDMPartnerId,
    getRoomCallMemberships,
    getCallParticipantCounts,
    getMemberName,
    getMemberAvatar,
    isVideoRoom,
    isLastJoinedMember,
    type RoomNotificationSetting,
    type SpaceChildInfo,
} from "$lib/matrix/client";
import { voiceCallState } from "$lib/stores/voiceCall.svelte";
import {
    dedupeParticipants,
    type VoiceParticipant,
} from "$lib/utils/voiceCall";
import { rosterCallStatus } from "$lib/utils/callTileStatus";
import {
    MicOff,
    HeadphoneOff,
    GripVertical,
    Video,
    Hash,
    Circle,
    Check,
} from "lucide-svelte";
import { presenceState, presenceFor } from "$lib/stores/presence.svelte";
import { settingsState, setDmSortOrder } from "$lib/stores/settings.svelte";
import {
    presenceDot,
    presenceDotClass,
    presenceLabel,
} from "$lib/utils/presence";
import {
    groupRoomsByTag,
    sortRoomsByTag,
    dmComparator,
    DM_SORT_ORDERS,
    type DmSortFacts,
    type DmSortOrder,
    roomTagKind,
    TAG_FAVOURITE,
    TAG_LOWPRIORITY,
    type RoomTagKind,
    type RoomTagMap,
} from "$lib/utils/roomOrdering";
import { shouldOfferKnock, matrixErrorMessage } from "$lib/utils/knock";
import { collectSpaceAndDescendantRoomIds } from "$lib/utils/spaceNotifications";
import { latestMessage, latestMessagePreview } from "$lib/utils/roomPreview";
import { roomsState, setActiveRoom } from "$lib/stores/rooms.svelte";
import { hasLoudInRoom } from "$lib/stores/notifications.svelte";
import {
    interfaceState,
    openModal,
    closeModal,
    clearModalIfOwner,
    showCallView,
} from "$lib/stores/interface.svelte";
import { openInviteDialog } from "$lib/stores/inviteDialog.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import QuickActions from "$lib/components/layout/QuickActions.svelte";
import VoiceCallPanel from "$lib/components/layout/VoiceCallPanel.svelte";
import CallParticipantMenu from "$lib/components/layout/CallParticipantMenu.svelte";
import { pluginRegistry } from "$lib/stores/plugins.svelte";
import Portal from "$lib/components/ui/Portal.svelte";
import BottomSheet from "$lib/components/ui/BottomSheet.svelte";
import { setNavRooms } from "$lib/keybinds/runner";

interface Props {
    onOpenSpaceSettings?: (room: Room) => void;
    onOpenRoomSettings?: (room: Room) => void;
}

// Zami: React Native has no right-click (`oncontextmenu`): the `longPress` action
// (500 ms, a 50 ms vibrate) opens the menus, as on a touchscreen. AppShell's
// keyboard room navigation finds rows by `data-nav-room`, `data-nav-unread` and
// `data-nav-mention`; here the list publishes them (setNavRooms) instead.
const LONG_PRESS_MS = 500;
function vibrate(): void {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

// ── Row state ───────────────────────────────────────────────────────────
// Zami: upstream computes these inside the component. Here every row is its own
// memoized component that reads its own room's state (so one room's change, or
// a sync tick, doesn't re-render the whole list), so the helpers that only read
// stores live at module level, where the rows and the list both call them.

// Presence dot for a DM partner. Unknown presence (server may have it
// disabled) renders as offline. Zami: upstream's `dmPresence` map, one room
// at a time.
function dmPresenceFor(room: Room): { dotClass: string; label: string } {
    void presenceState.presenceTick;
    void roomsState.roomsTick;
    const p = presenceFor(getDMPartnerId(room));
    const state = p?.state ?? "offline";
    return {
        dotClass: presenceDotClass(presenceDot(state)),
        label: p?.statusMsg
            ? `${presenceLabel(state)} - ${p.statusMsg}`
            : presenceLabel(state),
    };
}

// Newest-message line under each DM name. unreadTick follows new and
// freshly decrypted messages; the live Room's timeline mutates in place.
// Zami: upstream's `dmPreview` map, one room at a time.
function dmPreviewFor(room: Room): string | undefined {
    void roomsState.unreadTick;
    void roomsState.roomsTick;
    const text = latestMessagePreview(
        // Messages still being sent live outside the timeline until the
        // server accepts them; they are the newest.
        // Zami: only the timeline's tail, as latestMessagePreview looks at
        // most PREVIEW_SCAN events back: copying a long timeline per row per
        // tick was the cost.
        [
            ...room.getLiveTimeline().getEvents().slice(-PREVIEW_SCAN),
            ...room.getPendingEvents(),
        ],
        auth.userId,
    );
    return text || undefined;
}
// latestMessagePreview's SCAN_LIMIT.
const PREVIEW_SCAN = 50;

// ── Sub-spaces as tree categories ────────────────────────────────────
type SubSpace = { id: string; name: string };

// Direct children of a space: joined rooms and joined sub-spaces come from
// local state (live, no fetch), unjoined ones from its /hierarchy result.
function spaceChildren(
    spaceId: string,
    hierarchy: SpaceChildInfo[] | undefined,
): { rooms: Room[]; spaces: SubSpace[]; unjoined: SpaceChildInfo[] } {
    void roomsState.roomsTick; // child state + names mutate in place
    const rooms = getRoomsInSpace(spaceId);
    const spaces: SubSpace[] = [];
    const seen = new Set<string>();
    for (const id of getSpaceChildIds(spaceId)) {
        const r = getRoom(id);
        if (r?.isSpaceRoom() && r.getMyMembership() === "join") {
            spaces.push({ id, name: getRoomDisplayName(r) });
            seen.add(id);
        }
    }
    for (const h of hierarchy ?? []) {
        if (h.isSpace && !seen.has(h.roomId)) {
            spaces.push({ id: h.roomId, name: h.name });
            seen.add(h.roomId);
        }
    }
    const unjoined = (hierarchy ?? []).filter(
        (h) => !h.isSpace && !isJoinedNow(h),
    );
    return { rooms, spaces, unjoined };
}

// Aggregate unread + "contains the open room" for a collapsed category.
function subtreeState(spaceId: string): {
    unread: boolean;
    alert: boolean;
    hasActive: boolean;
} {
    void roomsState.roomsTick;
    void roomsState.unreadTick;
    const ids = collectSpaceAndDescendantRoomIds(spaceId, {
        roomsInSpace: (id) => getRoomsInSpace(id).map((r) => r.roomId),
        childSpaceIds: (id) =>
            getSpaceChildIds(id).filter(
                (c) => getRoom(c)?.isSpaceRoom() ?? false,
            ),
    });
    let unread = false;
    let alert = false;
    let hasActive = false;
    for (const id of ids) {
        if (id === spaceId) continue;
        const room = getRoom(id);
        if (!room) continue;
        if (roomIsActive(room.roomId)) hasActive = true;
        const b = roomUnread(room);
        if (b.unread) unread = true;
        if (b.highlight || b.loud) alert = true;
    }
    return { unread, alert, hasActive };
}

// Zami: upstream's `roomButton`, in two parts each row reads on its own: a
// room switch then re-renders only the two rows whose `isActive` flips, and
// an unread change only the rows whose unread state did.
function roomIsActive(roomId: string): boolean {
    // A draft DM covers the main pane, so the room under it is not active.
    return roomsState.activeRoomId === roomId && !roomsState.draftDm;
}

function roomUnread(room: Room) {
    void roomsState.unreadTick; // track read receipt / new message changes
    const { unread, highlight } = getRoomUnreadInfo(room);
    const loud = hasLoudInRoom(room.roomId);
    const threadUnread = roomHasThreadUnread(room);
    return {
        unread: unread || loud || threadUnread,
        highlight,
        loud,
    };
}

function roomButton(room: Room) {
    return { isActive: roomIsActive(room.roomId), ...roomUnread(room) };
}

// Zami: who is in a call, per room: one pass over the call sessions per
// voiceTick, shared by every row (each row used to fetch its own room's
// session and build its roster on every tick).
let callCountsMemo: {
    tick: number;
    userId: string | null;
    counts: ReadonlyMap<string, number>;
} | null = null;
function callCounts(): ReadonlyMap<string, number> {
    const tick = voiceCallState.voiceTick;
    const userId = auth.userId;
    if (callCountsMemo?.tick !== tick || callCountsMemo.userId !== userId)
        callCountsMemo = { tick, userId, counts: getCallParticipantCounts() };
    return callCountsMemo.counts;
}

function sameCounts(
    a: ReadonlyMap<string, number>,
    b: ReadonlyMap<string, number>,
): boolean {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const [id, n] of a) if (b.get(id) !== n) return false;
    return true;
}

// Zami: `groupRoomsByTag` (a sort) again only when the rooms or a room's tags
// changed (an `m.tag` event replaces the room's `tags` object), not on each
// sync tick.
function memoByTags<T>(
    derive: (rooms: Room[], getTags: (r: Room) => RoomTagMap) => T,
) {
    let last: { rooms: Room[]; tags: RoomTagMap[]; value: T } | null = null;
    const tagsOf = (r: Room) => getRoomTags(r.roomId);
    return (rooms: readonly Room[]): T => {
        const list = rooms.slice();
        const tags = list.map(tagsOf);
        if (
            last?.rooms.length === list.length &&
            list.every((room, i) => {
                const prev = last!.tags[i];
                return (
                    room === last!.rooms[i] &&
                    (tags[i] === prev || (isEmpty(tags[i]) && isEmpty(prev)))
                );
            })
        )
            return last.value;
        last = { rooms: list, tags, value: derive(list, tagsOf) };
        return last.value;
    };
}

function isEmpty(tags: RoomTagMap | undefined): boolean {
    for (const _ in tags) return false;
    return true;
}

// ── Reorder mode (edit-mode drag + raw-order field) ─────────────────────
type Section = "favourite" | "lowPriority" | "channels";
type DragList = "main" | "dm";
type DragState = {
    roomId: string;
    section: Section;
    // Which on-screen cluster the dragged row lives in. In Home view a
    // `m.favourite`/`m.lowpriority` room appears BOTH as an orphan
    // channelRow (list "main") and as a DM row (list "dm") — both carry
    // the same data-section, so this discriminator keeps a drag confined
    // to its own visual list.
    list: DragList;
    // Zami: no `pointerId`: the row's own pan gesture carries the drag.
    overId: string | null;
    before: boolean;
};

// The DM row's section: its tag, when that is one we order.
function dmSectionOf(kind: RoomTagKind): Section | null {
    return kind === "favourite"
        ? "favourite"
        : kind === "lowPriority"
          ? "lowPriority"
          : null;
}

function activeSpaceRoomNow(): Room | null {
    return roomsState.activeSpaceId ? getRoom(roomsState.activeSpaceId) : null;
}

// Preserve a space child's `via` when writing its order.
function viaOf(roomId: string): string[] {
    const activeSpaceRoom = activeSpaceRoomNow();
    if (!activeSpaceRoom) return [];
    return (
        getSpaceChildren(activeSpaceRoom).find((c) => c.roomId === roomId)
            ?.via ?? []
    );
}

// The raw order value shown in a row's edit-mode field.
function rawOrderOf(room: Room, section: Section): string {
    if (section === "channels") {
        const activeSpaceRoom = activeSpaceRoomNow();
        if (!activeSpaceRoom) return "";
        const child = getSpaceChildren(activeSpaceRoom).find(
            (c) => c.roomId === room.roomId,
        );
        return child?.order ?? "";
    }
    const t = getRoomTags(room.roomId);
    const raw =
        t[section === "favourite" ? TAG_FAVOURITE : TAG_LOWPRIORITY]?.order;
    return raw == null ? "" : String(raw);
}

// Zami: the drag state lives outside React state, so a drag that moves the
// drop marker re-renders only the two rows whose marker changes (each row
// subscribes to whether it is the target). Upstream finds the row under the
// pointer with `elementFromPoint`; here the draggable rows register their views,
// and those of the dragged row's section and list are measured as the drag
// starts (the list doesn't scroll during a drag). The gesture finds the row
// under the finger on the UI thread, against those rects (`publish`).
type DragTarget = { roomId: string; section: Section; list: DragList };
type DragRect = DragTarget & LayoutRectangle;
type ViewInstance = ComponentRef<typeof View>;

function createDragStore() {
    let drag: DragState | null = null;
    const listeners = new Set<() => void>();
    const targets = new Map<
        string,
        DragTarget & { view: RefObject<ViewInstance | null> }
    >();
    return {
        get: () => drag,
        set(next: DragState | null) {
            drag = next;
            for (const listener of listeners) listener();
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        register(target: DragTarget, view: RefObject<ViewInstance | null>) {
            const key = `${target.list}:${target.roomId}`;
            const entry = { ...target, view };
            targets.set(key, entry);
            return () => {
                if (targets.get(key) === entry) targets.delete(key);
            };
        },
        measure(
            section: Section,
            list: DragList,
            publish: (rects: DragRect[]) => void,
        ) {
            const next: DragRect[] = [];
            // The measurements arrive one callback each: publish them once
            // per turn, not once per row.
            let queued = false;
            for (const target of targets.values()) {
                if (target.section !== section || target.list !== list)
                    continue;
                const { roomId } = target;
                target.view.current?.measureInWindow((x, y, width, height) => {
                    next.push({ roomId, section, list, x, y, width, height });
                    if (queued) return;
                    queued = true;
                    setTimeout(() => {
                        queued = false;
                        publish(next.slice());
                    }, 0);
                });
            }
        },
    };
}

/** The row under a point, on the UI thread. Upstream's `elementFromPoint`. */
function rowAt(
    rects: readonly DragRect[],
    x: number,
    y: number,
): DragRect | null {
    "worklet";
    for (const r of rects)
        if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
            return r;
    return null;
}
type DragStore = ReturnType<typeof createDragStore>;

// How long a row is held, in reorder mode, before it follows the finger. A
// quicker move scrolls the list instead.
const DRAG_DELAY_MS = 300;

/** The drop target the gesture last reported, on the UI thread. */
type DragHover = { overId: string; before: boolean } | null;

// ── Join / knock state ──────────────────────────────────────────────────
// Zami: upstream's `joiningIds`, `knockPromptId`, `knockReason` and
// `knockError` live outside React state: each unjoined row reads its own part,
// so a keystroke in the knock reason re-renders the row with the prompt, not
// every cell through the list's `renderItem`.
type KnockPrompt = { reason: string; error: string };

function createJoinStore() {
    let joiningIds = new Set<string>();
    let knockPromptId: string | null = null;
    let knock: KnockPrompt = { reason: "", error: "" };
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of listeners) listener();
    };
    return {
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        isJoining: (roomId: string) => joiningIds.has(roomId),
        get knockPromptId() {
            return knockPromptId;
        },
        /** The prompt's text, the same object until it changes. */
        get knock() {
            return knock;
        },
        addJoining(roomId: string) {
            joiningIds = new Set(joiningIds).add(roomId);
            emit();
        },
        removeJoining(roomId: string) {
            joiningIds = new Set(joiningIds);
            joiningIds.delete(roomId);
            emit();
        },
        setKnockPromptId(roomId: string | null) {
            knockPromptId = roomId;
            emit();
        },
        setKnockReason(reason: string) {
            knock = { ...knock, reason };
            emit();
        },
        setKnockError(error: string) {
            knock = { ...knock, error };
            emit();
        },
    };
}
type JoinStore = ReturnType<typeof createJoinStore>;

// ── Row heights ─────────────────────────────────────────────────────────
// Zami: each kind of row has a fixed height, from the text size (the system's
// font scale), set on the row and summed for FlatList's `getItemLayout`, so
// the list places rows it hasn't drawn instead of measuring every one. Text
// is one line of its class's line height (text-xs 16px, text-sm 20px), which
// React Native scales and rounds up to a pixel. The parts that vary are
// added: a call's roster (a fixed height per person) and the knock prompt
// (measured).
type RowMetrics = ReturnType<typeof rowMetrics>;

function rowMetrics(fontScale: number) {
    const pixel = PixelRatio.get() || 1;
    const line = (px: number) =>
        Math.ceil(px * fontScale * pixel - 0.01) / pixel;
    const xs = line(16);
    const sm = line(20);
    return {
        /** `xs` and `sm` text, for the DM row's two-line column. */
        xs,
        sm,
        /** The inbox button, less its `mb-2`. */
        inbox: 12 + Math.max(20, sm, xs),
        inboxMargin: 8,
        heading: 8 + xs,
        channel: 12 + Math.max(20, sm),
        unjoined: 12 + Math.max(20, sm),
        category: 8 + Math.max(12, xs),
        emptyCategory: 8 + xs,
        browse: 8 + Math.max(12, xs),
        // The preview line is always allowed for, so every DM row is the same
        // height whether or not it has one.
        dm: 12 + Math.max(32, sm + xs),
        empty: 64 + sm,
        rosterEntry: 4 + Math.max(20, xs),
        rosterMargin: 2,
        /** Until the knock prompt is measured. */
        knockPrompt: 96,
    };
}

// ── What the rows share ─────────────────────────────────────────────────
type RowActions = {
    openContextMenu: (
        roomId: string,
        x: number,
        y: number,
        touch: boolean,
    ) => void;
    openParticipantMenu: (
        room: Room,
        userId: string,
        x: number,
        y: number,
        touch: boolean,
    ) => void;
    openRoomSettings: (room: Room) => void;
    openSpaceSettings: () => void;
    toggleSubspace: (id: string) => void;
    toggleBrowseCollapsed: () => void;
    handleJoin: (room: SpaceChildInfo) => Promise<void>;
    handleKnock: (room: SpaceChildInfo) => Promise<void>;
    handleCancelKnock: (roomId: string) => Promise<void>;
    setKnockPromptId: (roomId: string | null) => void;
    setKnockReason: (reason: string) => void;
    /** The knock prompt's measured height, for `getItemLayout`. */
    setKnockPromptHeight: (height: number) => void;
    commitRawOrder: (
        room: Room,
        section: Section,
        raw: string,
    ) => Promise<void>;
    onRowPointerDown: (
        roomId: string,
        section: Section,
        list: DragList,
    ) => void;
    /** Zami: the drop target under the finger, which the gesture found on
     *  the UI thread, each time it changes (not each frame). */
    onRowPointerMove: (overId: string, before: boolean) => void;
    onRowPointerUp: () => Promise<void>;
    onRowPointerCancel: () => void;
};

interface RowContextValue {
    reorderMode: boolean;
    canReorderChannels: boolean;
    isTouchscreen: boolean;
    actions: RowActions;
    drag: DragStore;
    /** The dragged section's rows, measured as the drag starts. */
    dragRects: SharedValue<DragRect[]>;
    dragHover: SharedValue<DragHover>;
    join: JoinStore;
    metrics: RowMetrics;
    /** The selected row's background (see `selectedBackground`). */
    selectedStyle: ViewStyle | undefined;
}

const RowContext = createContext<RowContextValue | null>(null);

function useRowContext(): RowContextValue {
    const value = useContext(RowContext);
    if (!value) throw new Error("RoomList rows render inside RoomList");
    return value;
}

// Zami: memoized rows read the list's handlers through context, so they are
// bound once and call the latest render's functions.
function useStableHandlers<
    T extends Record<string, (...args: never[]) => unknown>,
>(handlers: T): T {
    const latest = useRef(handlers);
    useLayoutEffect(() => {
        latest.current = handlers;
    });
    const [stable] = useState(() => {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(handlers))
            out[key] = (...args: never[]) => latest.current[key](...args);
        return out as T;
    });
    return stable;
}

// Zami: the selected row's `border-inline-start: 3px solid var(--discord-accent)`
// is `border-s-[3px] border-discord-accent`; its `background: linear-gradient(to
// var(--end-side), var(--discord-bg-selected) 85%, var(--discord-bg-secondary))`
// is this style, from the theme's variables.
function useSelectedBackground(): ViewStyle | undefined {
    const [selected, secondary] = useCSSVariable([
        "--discord-bg-selected",
        "--discord-bg-secondary",
    ]);
    return useMemo(() => {
        if (selected === undefined || secondary === undefined) return undefined;
        const end = I18nManager.isRTL ? "left" : "right";
        return {
            backgroundImage: `linear-gradient(to ${end}, ${selected} 85%, ${secondary})`,
        };
    }, [selected, secondary]);
}

// Whether this row is the drop target, and on which side. Upstream:
// `draggable && drag?.overId === room.roomId && drag.before`.
function useDragMarker(
    drag: DragStore,
    view: RefObject<ViewInstance | null>,
    target: DragTarget | null,
): "before" | "after" | null {
    const roomId = target?.roomId;
    const section = target?.section;
    const list = target?.list;
    useEffect(() => {
        if (!roomId || !section || !list) return;
        return drag.register({ roomId, section, list }, view);
    }, [drag, view, roomId, section, list]);
    return useSyncExternalStore(drag.subscribe, () => {
        const d = drag.get();
        if (!roomId || d?.overId !== roomId) return null;
        return d.before ? "before" : "after";
    });
}

// Zami: the `pointerdown`/`pointermove`/`pointerup` drag on a draggable row. On
// the web the row is `touch-none`, so a touch drags it at once; here a held
// press (`DRAG_DELAY_MS`) starts the drag, so the list still scrolls in reorder
// mode. The order field and the settings button sit outside it, as their
// `stopPropagation()` keeps them out of the web drag.
// The gesture runs on the UI thread: it finds the row under the finger there
// and calls into JS only when the drop target changes, and on release.
function Draggable({
    target,
    children,
}: {
    target: DragTarget;
    children: ReactNode;
}) {
    const { actions, dragRects, dragHover } = useRowContext();
    const {
        onRowPointerDown,
        onRowPointerMove,
        onRowPointerUp,
        onRowPointerCancel,
    } = actions;
    const { roomId, section, list } = target;
    const pan = usePanGesture({
        activateAfterLongPress: DRAG_DELAY_MS,
        onActivate: () => {
            "worklet";
            // The last drag's rows are stale (the list may have scrolled).
            dragRects.value = [];
            dragHover.value = null;
            scheduleOnRN(vibrate);
            scheduleOnRN(onRowPointerDown, roomId, section, list);
        },
        onUpdate: (e) => {
            "worklet";
            const row = rowAt(dragRects.value, e.absoluteX, e.absoluteY);
            // Only accept a sibling row within the same section AND the same
            // on-screen cluster (data-list) — otherwise a Home-view favourite DM
            // row could become a drop target for a favourite channel row.
            if (!row || row.section !== section || row.list !== list) return;
            if (row.roomId === roomId) return;
            const before = e.absoluteY < row.y + row.height / 2;
            const hover = dragHover.value;
            if (hover?.overId === row.roomId && hover.before === before) return;
            dragHover.value = { overId: row.roomId, before };
            scheduleOnRN(onRowPointerMove, row.roomId, before);
        },
        onDeactivate: (e) => {
            "worklet";
            if (e.canceled) scheduleOnRN(onRowPointerCancel);
            else scheduleOnRN(onRowPointerUp);
        },
    });
    return <GestureDetector gesture={pan}>{children}</GestureDetector>;
}

// Zami: a category's `ms-3 border-s` body, once per level of nesting: the list
// is one flat FlatList, so each row carries its own indentation.
function Indent({ depth, children }: { depth: number; children: ReactNode }) {
    let node = children;
    for (let i = 0; i < depth; i++)
        node = (
            <View className="ms-3 border-s border-discord-divider">{node}</View>
        );
    return <>{node}</>;
}

// Zami: `<Circle fill="currentColor" />`: the fill is the color its class gives
// the stroke, as there's no currentColor.
function FilledCircle({
    size,
    className,
}: {
    size: number;
    className: string;
}) {
    const { color } = useResolveClassNames(className);
    return <Circle size={size} className={className} fill={color as string} />;
}

const GEAR_PATH =
    "M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.01 7.01 0 0 0-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.04.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z";
const CHEVRON_PATH = "M7 10l5 5 5-5z";

// ── Rows ────────────────────────────────────────────────────────────────

function InboxButtonRow() {
    const { selectedStyle, metrics } = useRowContext();
    const showInbox = useRune(() => roomsState.showInbox);
    const pending = useRune(
        () => roomsState.invitedRooms.length + roomsState.knockedRooms.length,
    );
    const color = showInbox
        ? "text-discord-textPrimary"
        : "text-discord-textSecondary";
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: showInbox }}
            onPress={() => {
                roomsState.showInbox = true;
                roomsState.activeRoomId = null;
                roomsState.draftDm = null;
                // The inbox fills the main area like a room — always close.
                if (interfaceState.isMobile) interfaceState.leftOpen = false;
            }}
            className={`mb-2 w-full flex-row items-center gap-2 pe-2 py-1.5 transition-colors ${
                showInbox
                    ? "border-s-[3px] border-discord-accent ps-[5px]"
                    : "ps-2 active:bg-discord-messageHover"
            }`}
            style={[{ height: metrics.inbox }, showInbox && selectedStyle]}
        >
            <SvgIcon
                className={`w-5 h-5 flex-shrink-0 opacity-70 ${color}`}
                d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"
            />
            <Text numberOfLines={1} className={`flex-1 text-sm ${color}`}>
                {t("roomList.pendingInvites")}
            </Text>
            {pending > 0 ? <CountBadge count={pending} /> : null}
        </Pressable>
    );
}
const InboxButton = memo(InboxButtonRow);

// Zami: the red count pill: the `<span>`'s box is a View and its text a Text.
function CountBadge({ count }: { count: number | string }) {
    return (
        <View className="flex-shrink-0 bg-discord-danger rounded-full px-1.5 min-w-[1.2rem] items-center">
            <Text className="text-white text-xs font-bold text-center">
                {count}
            </Text>
        </View>
    );
}

// Who's in this room's call — rendered under the room's own row.
// Replaces the old participant-count badge.
// Zami: rooms without a call read only whether they have one (one count per
// room, computed once per voiceTick for every row); the roster (speaking,
// muted) is read by the rooms that have one.
const CallRoster = memo(function CallRoster({ room }: { room: Room }) {
    const inCall = useRune(() => callCounts().has(room.roomId), [room]);
    if (!inCall) return null;
    return <CallRosterList room={room} />;
});

function sameParticipants(a: VoiceParticipant[], b: VoiceParticipant[]) {
    return (
        a.length === b.length && a.every((p, i) => p.userId === b[i]!.userId)
    );
}

function sameRoster(
    a: { userId: string; name: string; avatar: string | null }[],
    b: { userId: string; name: string; avatar: string | null }[],
) {
    return a.length === b.length && a.every((p, i) => shallowEqual(p, b[i]));
}

function CallRosterList({ room }: { room: Room }) {
    const { actions, metrics } = useRowContext();
    const participants = useRune(
        () => {
            void voiceCallState.voiceTick;
            return dedupeParticipants(getRoomCallMemberships(room));
        },
        [room],
        { isEqual: sameParticipants },
    );
    const speaking = useRune(() => voiceCallState.speakingUserIds);
    const muted = useRune(() => voiceCallState.mutedUserIds);
    const inThisCall = useRune(
        () => voiceCallState.roomId === room.roomId,
        [room],
    );
    const selfMicMuted = useRune(() => voiceCallState.micMuted);
    const selfDeafened = useRune(() => voiceCallState.deafened);
    const userId = useRune(() => auth.userId);
    const members = useRune(
        () => {
            void roomsState.roomsTick;
            return participants.map((p) => ({
                userId: p.userId,
                name: getMemberName(room, p.userId),
                avatar: getMemberAvatar(room, p.userId),
            }));
        },
        [room, participants],
        { isEqual: sameRoster },
    );
    return (
        <View className="mb-0.5">
            {members.map((p) => {
                const { name, avatar } = p;
                const status = rosterCallStatus({
                    // Our state is only known for the call this
                    // device is in, not one we're in elsewhere.
                    isSelf: p.userId === userId && inThisCall,
                    muted: muted.has(p.userId),
                    speaking: speaking.has(p.userId),
                    selfMicMuted,
                    selfDeafened,
                });
                return (
                    <Pressable
                        key={p.userId}
                        accessibilityRole="button"
                        accessibilityLabel={t("roomList.inVoice", { name })}
                        className="w-full flex-row items-center gap-2 ps-8 pe-2 py-0.5 rounded active:bg-discord-messageHover"
                        style={{ height: metrics.rosterEntry }}
                        onPress={() => {
                            setActiveRoom(room.roomId);
                            showCallView(room.roomId);
                        }}
                        delayLongPress={LONG_PRESS_MS}
                        onLongPress={(e) => {
                            vibrate();
                            actions.openParticipantMenu(
                                room,
                                p.userId,
                                e.nativeEvent.pageX,
                                e.nativeEvent.pageY,
                                true,
                            );
                        }}
                    >
                        {/* Zami: the `ring-2` is a border just outside
                            the avatar, as a ring takes no room. */}
                        <View className="relative rounded-full flex-shrink-0">
                            <Avatar
                                src={avatar}
                                name={name}
                                id={p.userId}
                                size={20}
                            />
                            {speaking.has(p.userId) ? (
                                <View
                                    pointerEvents="none"
                                    className="absolute -inset-0.5 rounded-full border-2 border-discord-accent"
                                />
                            ) : null}
                        </View>
                        <Text
                            numberOfLines={1}
                            className="flex-1 text-xs text-discord-textSecondary"
                        >
                            {name}
                        </Text>
                        {status.micOff ? (
                            <MicOff
                                size={14}
                                className="flex-shrink-0 text-discord-danger"
                            />
                        ) : null}
                        {status.deafened ? (
                            <HeadphoneOff
                                size={14}
                                className="flex-shrink-0 text-discord-danger"
                            />
                        ) : null}
                    </Pressable>
                );
            })}
        </View>
    );
}

// The edit-mode order field. Zami: `value` → `defaultValue`, remounted when the
// stored order changes; Enter blurs, and the blur (`onEndEditing`) commits.
function RawOrderInput({ room, section }: { room: Room; section: Section }) {
    const { actions } = useRowContext();
    const rawOrder = useRune(() => {
        void roomsState.roomsTick;
        return rawOrderOf(room, section);
    }, [room, section]);
    return (
        <TextInput
            key={rawOrder}
            defaultValue={rawOrder}
            accessibilityLabel={t("roomList.orderValue")}
            // Zami: `py-0` drops Android's own padding, which made the field
            // taller than its row.
            className="w-16 me-1 flex-shrink-0 rounded bg-discord-backgroundTertiary px-1 py-0 text-xs text-discord-textSecondary"
            onEndEditing={(e) => {
                const v = e.nativeEvent.text;
                if (v !== rawOrderOf(room, section))
                    void actions.commitRawOrder(room, section, v);
            }}
        />
    );
}

// Zami: drawn over the row's top or bottom edge rather than between rows, so
// it moves nothing: rows keep their fixed heights, and the rects the drag
// measured stay where the rows are.
function DropMarker({ at }: { at: "before" | "after" }) {
    return (
        <View
            pointerEvents="none"
            className={`absolute start-2 end-2 h-0.5 rounded bg-discord-accent ${
                at === "before" ? "top-0" : "bottom-0"
            }`}
        />
    );
}

// Joined rooms / channels
const ChannelRow = memo(function ChannelRow({
    room,
    section,
}: {
    room: Room;
    section: Section | null;
}) {
    // Zami: what changes on its own, read on its own (see roomIsActive).
    const isActive = useRune(() => roomIsActive(room.roomId), [room]);
    const unreadState = useRune(() => roomUnread(room), [room], {
        isEqual: shallowEqual,
    });
    const label = useRune(
        () => {
            void roomsState.roomsTick;
            return {
                isVideo: isVideoRoom(room),
                // Tick dependency: names change by in-place Room
                // mutation (late-seeded state, renames).
                roomName: getRoomDisplayName(room),
            };
        },
        [room],
        { isEqual: shallowEqual },
    );
    return (
        <ChannelRowView
            room={room}
            section={section}
            isActive={isActive}
            {...unreadState}
            {...label}
        />
    );
});

const ChannelRowView = memo(function ChannelRowView({
    room,
    section,
    isActive,
    unread,
    highlight,
    loud,
    isVideo,
    roomName,
}: {
    room: Room;
    section: Section | null;
    isActive: boolean;
    unread: boolean;
    highlight: number;
    loud: boolean;
    isVideo: boolean;
    roomName: string;
}) {
    const {
        reorderMode,
        canReorderChannels,
        isTouchscreen,
        actions,
        drag,
        metrics,
        selectedStyle,
    } = useRowContext();
    const draggable =
        reorderMode &&
        section !== null &&
        (section !== "channels" || canReorderChannels);
    const rowRef = useRef<ViewInstance>(null);
    const target =
        draggable && section !== null
            ? { roomId: room.roomId, section, list: "main" as const }
            : null;
    const marker = useDragMarker(drag, rowRef, target);
    const color =
        isActive || unread
            ? "text-discord-textPrimary"
            : "text-discord-textSecondary";
    const pressable = (
        <View className="flex-1 flex-row items-center min-w-0">
            {draggable ? (
                <View className="flex-shrink-0 ps-1">
                    <GripVertical
                        size={14}
                        className="text-discord-textMuted"
                    />
                </View>
            ) : null}
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                onPress={() => {
                    if (reorderMode) return;
                    setActiveRoom(room.roomId);
                }}
                delayLongPress={LONG_PRESS_MS}
                onLongPress={(e) => {
                    if (reorderMode) return;
                    vibrate();
                    actions.openContextMenu(
                        room.roomId,
                        e.nativeEvent.pageX,
                        e.nativeEvent.pageY,
                        true,
                    );
                }}
                className={`flex-1 flex-row items-center gap-2 py-1.5 min-w-0 transition-colors ${
                    isActive
                        ? "ps-[5px]"
                        : "ps-2 active:bg-discord-messageHover"
                }`}
            >
                {/* Zami: `min-h-5`, so the unread dot's slot is as tall as the
                    icon's and the row keeps its height at small text sizes. */}
                <View className="w-5 min-h-5 flex-shrink-0 flex-row items-center justify-center">
                    {unread && !isActive ? (
                        <View
                            className={`w-2 h-2 rounded-full ${
                                loud || highlight
                                    ? "bg-discord-danger"
                                    : "bg-discord-textPrimary"
                            } flex-shrink-0`}
                        />
                    ) : isVideo ? (
                        <View
                            className="opacity-70 flex-row items-center justify-center"
                            accessibilityLabel={t("common.videoRoom")}
                        >
                            <Video size={14} className={color} />
                        </View>
                    ) : (
                        <View className="w-5 h-5 opacity-70 flex-row items-center justify-center">
                            <Hash size={14} className={color} />
                        </View>
                    )}
                </View>
                <Text
                    numberOfLines={1}
                    className={`flex-1 text-sm ${color} ${
                        unread ? "font-semibold" : ""
                    }`}
                >
                    {roomName}
                </Text>
                {highlight && !isActive ? (
                    <CountBadge count={highlight > 99 ? "99+" : highlight} />
                ) : null}
            </Pressable>
        </View>
    );
    return (
        <>
            <View
                ref={rowRef}
                className={`flex-row items-center transition-colors ${
                    isActive ? "border-s-[3px] border-discord-accent" : ""
                }`}
                style={[{ height: metrics.channel }, isActive && selectedStyle]}
            >
                {target ? (
                    <Draggable target={target}>{pressable}</Draggable>
                ) : (
                    pressable
                )}
                {draggable && section !== null ? (
                    <RawOrderInput room={room} section={section} />
                ) : null}
                {/* Zami: upstream reveals this on hover (`opacity-0
                    group-hover/room:opacity-100`). On a touchscreen that
                    leaves an invisible tap target at the end of every row, so
                    it isn't rendered there: the long-press menu's Settings
                    opens the same. Without a touchscreen it always shows. */}
                {isTouchscreen ? null : (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("roomList.roomSettings")}
                        onPress={() => actions.openRoomSettings(room)}
                        className="flex-shrink-0 p-1 me-1 rounded transition-colors"
                    >
                        <SvgIcon
                            className="w-3.5 h-3.5 text-discord-textMuted"
                            d={GEAR_PATH}
                        />
                    </Pressable>
                )}
                {draggable && marker !== null ? (
                    <DropMarker at={marker} />
                ) : null}
            </View>
            <CallRoster room={room} />
        </>
    );
});

// A space child we haven't joined: join / knock in place
const UnjoinedRow = memo(function UnjoinedRow({
    room,
}: {
    room: SpaceChildInfo;
}) {
    const { actions, join, metrics } = useRowContext();
    // Zami: this row's part of the join store (see createJoinStore).
    const isJoining = useSyncExternalStore(join.subscribe, () =>
        join.isJoining(room.roomId),
    );
    /** The knock-to-join prompt under the row, while it is open. */
    const knock = useSyncExternalStore(join.subscribe, () =>
        join.knockPromptId === room.roomId && !room.isKnocked
            ? join.knock
            : null,
    );
    return (
        <>
            {/* Same row geometry as channelRow (flex, py-1.5, 0.5rem inset,
                w-5 icon slot, single-line name) so joined and unjoined rows
                share height, hover and spacing. The member count lives in
                the tooltip rather than a second line.
                Zami: there are no tooltips, so the member count isn't shown. */}
            <View
                className="flex-row items-center transition-colors"
                style={{ height: metrics.unjoined }}
            >
                <View className="flex-1 flex-row items-center gap-2 py-1.5 min-w-0 ps-2">
                    <View className="w-5 flex-shrink-0 flex-row items-center justify-center">
                        <View className="w-5 h-5 opacity-70 flex-row items-center justify-center">
                            <Hash
                                size={14}
                                className="text-discord-textPrimary"
                            />
                        </View>
                    </View>
                    <Text
                        numberOfLines={1}
                        className="flex-1 text-sm text-discord-textSecondary transition-colors"
                    >
                        {room.name ?? ""}
                    </Text>
                </View>

                {room.isKnocked ? (
                    <>
                        {/* Pending knock: state chip + cancel on hover.
                            Zami: no hover, so both show. */}
                        <Text className="flex-shrink-0 me-2 text-xs font-semibold text-discord-textMuted">
                            {t("roomList.requested")}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: isJoining }}
                            onPress={() =>
                                void actions.handleCancelKnock(room.roomId)
                            }
                            disabled={isJoining}
                            className={`flex-shrink-0 me-1 px-2 py-0.5 rounded border border-discord-divider transition-colors ${
                                isJoining ? "opacity-60" : ""
                            }`}
                        >
                            <Text className="text-xs font-semibold text-discord-textMuted">
                                {t("roomList.cancelRequest")}
                            </Text>
                        </Pressable>
                    </>
                ) : (
                    // Join button. Zami: upstream reveals it on hover
                    // (`opacity-0 group-hover:opacity-100`); it always shows.
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("common.join")}
                        accessibilityState={{ disabled: isJoining }}
                        onPress={() => void actions.handleJoin(room)}
                        disabled={isJoining}
                        className={`flex-shrink-0 me-1 px-2 py-0.5 rounded bg-discord-accent active:bg-discord-accentHover transition-colors ${
                            isJoining ? "opacity-60" : ""
                        }`}
                    >
                        {isJoining ? (
                            <View className="flex-row items-center gap-1">
                                <Spin className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full" />
                            </View>
                        ) : (
                            <Text className="text-xs font-semibold text-white">
                                {t("common.join")}
                            </Text>
                        )}
                    </Pressable>
                )}
            </View>
            {knock ? (
                // Zami: its height (with `mb-1.5`) goes to getItemLayout.
                <View
                    className="mx-2 mb-1.5 p-2 rounded bg-discord-backgroundTertiary flex-col gap-1.5"
                    onLayout={(e) =>
                        actions.setKnockPromptHeight(
                            e.nativeEvent.layout.height + 6,
                        )
                    }
                >
                    <Text className="text-xs text-discord-textMuted">
                        {t("roomList.youCanTJoinThisRoom")}
                    </Text>
                    <TextInput
                        value={knock.reason}
                        onChangeText={actions.setKnockReason}
                        placeholder={t("common.reasonOptional")}
                        placeholderTextColorClassName="accent-discord-textMuted"
                        className="w-full px-2 py-1 bg-discord-backgroundSecondary text-discord-textPrimary rounded border border-discord-divider focus:border-discord-accent text-xs"
                    />
                    {knock.error ? (
                        <Text className="text-xs text-discord-danger">
                            {knock.error}
                        </Text>
                    ) : null}
                    <View className="flex-row justify-end gap-1.5">
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => actions.setKnockPromptId(null)}
                            className="px-2 py-0.5 rounded transition-colors"
                        >
                            <Text className="text-xs font-medium text-discord-textMuted">
                                {t("roomList.notNow")}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: isJoining }}
                            onPress={() => void actions.handleKnock(room)}
                            disabled={isJoining}
                            className={`px-2 py-0.5 rounded bg-discord-accent active:bg-discord-accentHover transition-colors ${
                                isJoining ? "opacity-60" : ""
                            }`}
                        >
                            <Text className="text-xs font-semibold text-white">
                                {t("roomList.requestToJoin")}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            ) : null}
        </>
    );
});

// A sub-space, rendered as a collapsible category (recursive).
// Zami: its header; its rows follow it in the list.
const CategoryHeader = memo(function CategoryHeader({
    id,
    name,
    expanded,
    loading,
}: {
    id: string;
    name: string;
    expanded: boolean;
    loading: boolean;
}) {
    const { actions, metrics } = useRowContext();
    const sub = useRune(
        () => (expanded ? null : subtreeState(id)),
        [id, expanded],
        { isEqual: shallowEqual },
    );
    const color =
        sub?.hasActive || sub?.unread
            ? "text-discord-textPrimary"
            : "text-discord-textMuted";
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => actions.toggleSubspace(id)}
            className="w-full flex-row items-center gap-1 px-2 py-1 transition-colors"
            style={{ height: metrics.category }}
        >
            <SvgIcon
                className={`w-3 h-3 flex-shrink-0 transition-transform ${
                    expanded ? "" : "-rotate-90"
                } ${color}`}
                d={CHEVRON_PATH}
            />
            <Text
                numberOfLines={1}
                className={`flex-1 min-w-0 text-xs font-semibold uppercase tracking-wide ${color}`}
            >
                {name}
            </Text>
            {loading ? (
                <Spin className="w-3 h-3 flex-shrink-0 border-2 border-discord-textMuted border-t-transparent rounded-full" />
            ) : sub?.unread ? (
                <View
                    className={`w-2 h-2 flex-shrink-0 rounded-full ${
                        sub.alert
                            ? "bg-discord-danger"
                            : "bg-discord-textPrimary"
                    }`}
                />
            ) : null}
        </Pressable>
    );
});

// Direct messages
const DmRow = memo(function DmRow({ room }: { room: Room }) {
    // Zami: what changes on its own, read on its own: a room switch, an
    // unread change, a new message, a rename and a presence change each
    // re-run (and re-render for) only their own part.
    const isActive = useRune(() => roomIsActive(room.roomId), [room]);
    const unreadState = useRune(() => roomUnread(room), [room], {
        isEqual: shallowEqual,
    });
    const label = useRune(
        () => {
            void roomsState.roomsTick;
            return {
                avatarSrc: getRoomAvatar(room),
                dmName: getRoomDisplayName(room),
                dmSection: dmSectionOf(roomTagKind(getRoomTags(room.roomId))),
            };
        },
        [room],
        { isEqual: shallowEqual },
    );
    const preview = useRune(() => dmPreviewFor(room), [room]);
    const presence = useRune(() => dmPresenceFor(room), [room], {
        isEqual: shallowEqual,
    });
    return (
        <DmRowView
            room={room}
            isActive={isActive}
            {...unreadState}
            {...label}
            preview={preview}
            presenceDotClass={presence.dotClass}
            presenceLabel={presence.label}
        />
    );
});

const DmRowView = memo(function DmRowView({
    room,
    isActive,
    unread,
    highlight,
    loud,
    avatarSrc,
    dmName,
    preview,
    dmSection,
    presenceDotClass,
    presenceLabel,
}: {
    room: Room;
    isActive: boolean;
    unread: boolean;
    highlight: number;
    loud: boolean;
    avatarSrc: string | null;
    dmName: string;
    preview: string | undefined;
    dmSection: Section | null;
    presenceDotClass: string;
    presenceLabel: string;
}) {
    const { reorderMode, actions, drag, metrics, selectedStyle } =
        useRowContext();
    const dmDraggable = reorderMode && dmSection !== null;
    const rowRef = useRef<ViewInstance>(null);
    const target =
        dmDraggable && dmSection !== null
            ? { roomId: room.roomId, section: dmSection, list: "dm" as const }
            : null;
    const marker = useDragMarker(drag, rowRef, target);
    const color =
        isActive || unread
            ? "text-discord-textPrimary"
            : "text-discord-textSecondary";
    const pressable = (
        <View className="flex-1 flex-row items-center min-w-0">
            {dmDraggable ? (
                <View className="flex-shrink-0 ps-1">
                    <GripVertical
                        size={14}
                        className="text-discord-textMuted"
                    />
                </View>
            ) : null}
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                onPress={() => {
                    if (reorderMode) return;
                    setActiveRoom(room.roomId);
                }}
                delayLongPress={LONG_PRESS_MS}
                onLongPress={(e) => {
                    if (reorderMode) return;
                    vibrate();
                    actions.openContextMenu(
                        room.roomId,
                        e.nativeEvent.pageX,
                        e.nativeEvent.pageY,
                        true,
                    );
                }}
                className={`flex-1 min-w-0 flex-row items-center gap-2 pe-2 py-1.5 transition-colors ${
                    isActive
                        ? "border-s-[3px] border-discord-accent ps-[5px]"
                        : "ps-2 active:bg-discord-messageHover"
                }`}
                style={isActive ? selectedStyle : undefined}
            >
                <View className="relative flex-shrink-0">
                    <Avatar src={avatarSrc} name={dmName} size={32} />
                    {/* Presence only: a red unread dot here read as Do Not
                        Disturb. Unread sits at the row's end instead.
                        Zami: the dot's `title` is its accessibility label. */}
                    <View
                        accessibilityLabel={presenceLabel}
                        className={`absolute -bottom-0.5 -end-0.5 w-3 h-3 rounded-full border-2 border-discord-backgroundSecondary ${
                            presenceDotClass || "bg-discord-offline"
                        }`}
                    />
                </View>
                {/* Zami: two lines tall with or without the preview, so every
                    DM row has the same height (see rowMetrics). */}
                <View
                    className="flex-1 min-w-0 flex-col justify-center"
                    style={{ minHeight: metrics.sm + metrics.xs }}
                >
                    <Text
                        numberOfLines={1}
                        className={`text-sm ${color} ${
                            unread ? "font-semibold" : ""
                        }`}
                    >
                        {dmName}
                    </Text>
                    {preview ? (
                        <Text
                            numberOfLines={1}
                            className={`text-xs font-normal ${
                                unread && !isActive
                                    ? "text-discord-textSecondary"
                                    : "text-discord-textMuted"
                            }`}
                        >
                            {preview}
                        </Text>
                    ) : null}
                </View>
                {highlight && !isActive ? (
                    <CountBadge count={highlight > 99 ? "99+" : highlight} />
                ) : unread && !isActive ? (
                    <View
                        accessible
                        accessibilityLabel={t(
                            "messageArea.unreadNotifications",
                        )}
                        className={`flex-shrink-0 w-2 h-2 me-1 rounded-full ${
                            loud
                                ? "bg-discord-danger"
                                : "bg-discord-textPrimary"
                        }`}
                    />
                ) : null}
            </Pressable>
        </View>
    );
    // The DM row is a <button>, so the roster can't nest
    // inside it — wrap both as siblings.
    return (
        <View ref={rowRef}>
            <View
                className="flex-row items-center"
                style={{ height: metrics.dm }}
            >
                {target ? (
                    <Draggable target={target}>{pressable}</Draggable>
                ) : (
                    pressable
                )}
                {dmDraggable && dmSection !== null ? (
                    <RawOrderInput room={room} section={dmSection} />
                ) : null}
                {dmDraggable && marker !== null ? (
                    <DropMarker at={marker} />
                ) : null}
            </View>
            <CallRoster room={room} />
        </View>
    );
});

// Zami: the room list's `{#if}`/`{#each}` blocks (sections, sub-space
// categories and their nesting) as the rows of one FlatList.
type Row =
    | { kind: "inbox"; key: string }
    | { kind: "heading"; key: string; label: string }
    | {
          kind: "channel";
          key: string;
          room: Room;
          section: Section | null;
          depth: number;
      }
    | { kind: "unjoined"; key: string; room: SpaceChildInfo; depth: number }
    | {
          kind: "category";
          key: string;
          id: string;
          name: string;
          depth: number;
          expanded: boolean;
          loading: boolean;
      }
    | { kind: "emptyCategory"; key: string; depth: number }
    | { kind: "browse"; key: string; collapsed: boolean }
    | { kind: "dm"; key: string; room: Room }
    /** A block's bottom margin (`mb-2`, a category's `mb-1`). */
    | { kind: "gap"; key: string; depth: number; size: "h-1" | "h-2" }
    | { kind: "empty"; key: string };

/** A category the list shows, for the `loadSubHierarchy` action. */
type CategoryLoad = { id: string; depth: number; expanded: boolean };

// Zami: each row's height, as `rowMetrics` and the rows set them, for
// getItemLayout. A room with a call has its roster under its row.
function rowHeight(
    row: Row,
    m: RowMetrics,
    calls: ReadonlyMap<string, number>,
    knock: { roomId: string | null; height: number | null },
): number {
    const roster = (roomId: string) => {
        const n = calls.get(roomId) ?? 0;
        return n > 0 ? n * m.rosterEntry + m.rosterMargin : 0;
    };
    switch (row.kind) {
        case "inbox":
            return m.inbox + m.inboxMargin;
        case "heading":
            return m.heading;
        case "channel":
            return m.channel + roster(row.room.roomId);
        case "unjoined":
            return (
                m.unjoined +
                (knock.roomId === row.room.roomId && !row.room.isKnocked
                    ? (knock.height ?? m.knockPrompt)
                    : 0)
            );
        case "category":
            return m.category;
        case "emptyCategory":
            return m.emptyCategory;
        case "browse":
            return m.browse;
        case "dm":
            return m.dm + roster(row.room.roomId);
        case "gap":
            return row.size === "h-1" ? 4 : 8;
        case "empty":
            return m.empty;
    }
}

function rowKey(row: Row): string {
    return row.key;
}

const NO_ROOMS: SpaceChildInfo[] = [];
const NO_SUBSPACES: SubSpace[] = [];

function sameSubSpaces(a: SubSpace[], b: SubSpace[]): boolean {
    return a.length === b.length && a.every((s, i) => shallowEqual(s, b[i]));
}

function sameMenu(
    a: {
        eligibleSpaces: Room[];
    } | null,
    b: {
        eligibleSpaces: Room[];
    } | null,
): boolean {
    if (a === null || b === null) return a === b;
    const { eligibleSpaces: aSpaces, ...aRest } = a;
    const { eligibleSpaces: bSpaces, ...bRest } = b;
    return shallowEqual(aSpaces, bSpaces) && shallowEqual(aRest, bRest);
}

// Zami: `positionMenu`, `focusTrap` and `dismissOnOutsidePointer` for the
// pointer context menu, as CallParticipantMenu has them: the menu lays out
// hidden at the top-left and its size places it, a menu reopened at a new
// point measures again, Android's back button is the Escape, and a backdrop
// filling the layer is the outside press.
function PositionedMenu({
    x,
    y,
    onClose,
    children,
}: {
    x: number;
    y: number;
    onClose: () => void;
    children: ReactNode;
}) {
    const viewport = useWindowDimensions();
    const [placed, setPlaced] = useState<ViewStyle | null>(null);
    const [placedFor, setPlacedFor] = useState({ x, y });
    if (placedFor.x !== x || placedFor.y !== y) {
        setPlacedFor({ x, y });
        setPlaced(null);
    }
    function positionMenu(
        p: { x: number; y: number },
        size: LayoutRectangle,
    ): ViewStyle {
        const vw = viewport.width;
        const vh = viewport.height;
        const w = size.width;
        const h = size.height;
        let left = Math.min(p.x, vw - w - 4);
        if (left < 4) left = 4;
        let top = p.y;
        if (top + h > vh - 4) top = p.y - h;
        if (top < 4) top = 4;
        const maxH = vh - top - 4;
        return { left, top, maxHeight: h > maxH ? maxH : undefined };
    }
    const close = useEffectEvent(() => onClose());
    useEffect(() => {
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                close();
                return true;
            },
        );
        return () => subscription.remove();
    }, []);
    const menuClass =
        "absolute z-50 bg-discord-backgroundTertiary border border-discord-divider rounded-lg shadow-xl min-w-44 max-w-52";
    return (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
                className="absolute inset-0"
                onPress={onClose}
            />
            {placed ? (
                <View
                    accessibilityViewIsModal
                    onAccessibilityEscape={onClose}
                    className={menuClass}
                    style={placed}
                >
                    <ScrollView style={styles.scroll}>
                        <View className="py-1">{children}</View>
                    </ScrollView>
                </View>
            ) : (
                <View
                    pointerEvents="none"
                    className={menuClass}
                    style={styles.measuring}
                    onLayout={(e) =>
                        setPlaced(positionMenu({ x, y }, e.nativeEvent.layout))
                    }
                >
                    <View className="py-1">{children}</View>
                </View>
            )}
        </View>
    );
}

// The header's actions dropdown. Zami: `absolute end-0 top-full mt-1` under its
// trigger becomes a layer at the app root, placed under the trigger's measured
// box. It stays mounted while closed, as upstream's `hidden` keeps it, so a
// QuickActions dialog outlives the dropdown that opened it.
const DM_SORT_LABELS: Record<DmSortOrder, () => string> = {
    recent: () => t("roomList.dmSortRecent"),
    unread: () => t("roomList.dmSortUnread"),
    online: () => t("roomList.dmSortOnline"),
    name: () => t("roomList.dmSortName"),
};

const HeaderMenu = memo(function HeaderMenu({
    open,
    anchor,
    spaceId,
    canAccessSpaceSettings,
    onSpaceSettings,
}: {
    open: boolean;
    anchor: LayoutRectangle | null;
    spaceId: string | undefined;
    canAccessSpaceSettings: boolean;
    onSpaceSettings: () => void;
}) {
    const viewport = useWindowDimensions();
    const shown = open && anchor !== null;
    const dmSortOrder = useRune(() => settingsState.dmSortOrder);
    return (
        <Portal>
            <View
                pointerEvents="box-none"
                style={StyleSheet.absoluteFill}
                className={shown ? undefined : "hidden"}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.closeMenu")}
                    className="absolute inset-0 z-40"
                    onPress={closeModal}
                />
                <View
                    className="absolute z-50 bg-discord-backgroundTertiary border border-discord-divider rounded-lg shadow-xl py-1 min-w-44"
                    style={
                        anchor
                            ? {
                                  right:
                                      viewport.width -
                                      (anchor.x + anchor.width),
                                  top: anchor.y + anchor.height + 4,
                              }
                            : undefined
                    }
                >
                    <QuickActions spaceId={spaceId} />
                    {!spaceId ? (
                        <>
                            <View className="w-full h-px bg-discord-divider my-1" />
                            <Text className="px-2 pt-1 pb-0.5 text-xs font-semibold uppercase tracking-wide text-discord-textMuted">
                                {t("roomList.sortDmsBy")}
                            </Text>
                            <View
                                accessibilityRole="radiogroup"
                                accessibilityLabel={t("roomList.sortDmsBy")}
                            >
                                {DM_SORT_ORDERS.map((order) => {
                                    const selected = dmSortOrder === order;
                                    return (
                                        <Pressable
                                            key={order}
                                            accessibilityRole="radio"
                                            accessibilityState={{
                                                checked: selected,
                                            }}
                                            onPress={() =>
                                                setDmSortOrder(order)
                                            }
                                            className="w-full flex-row items-center gap-2 pe-2 ps-2 py-1.5 hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                                        >
                                            <View className="w-4 h-4 flex-shrink-0 flex-row items-center justify-center">
                                                {selected && (
                                                    <Check
                                                        size={14}
                                                        className="text-discord-textPrimary"
                                                    />
                                                )}
                                            </View>
                                            <Text
                                                numberOfLines={1}
                                                className={`flex-1 text-sm ${
                                                    selected
                                                        ? "text-discord-textPrimary"
                                                        : "text-discord-textMuted"
                                                }`}
                                            >
                                                {DM_SORT_LABELS[order]()}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </>
                    ) : null}
                    {canAccessSpaceSettings ? (
                        <>
                            <View className="w-full h-px bg-discord-divider my-1" />
                            <Pressable
                                accessibilityRole="button"
                                onPress={onSpaceSettings}
                                className="w-full flex-row items-center gap-2 pe-2 ps-2 py-1.5 active:bg-discord-messageHover transition-colors"
                            >
                                <SvgIcon
                                    className="w-4 h-4 flex-shrink-0 opacity-70 text-discord-textMuted"
                                    d={GEAR_PATH}
                                />
                                <Text
                                    numberOfLines={1}
                                    className="flex-1 text-sm text-discord-textMuted"
                                >
                                    {t("roomList.spaceSettings")}
                                </Text>
                            </Pressable>
                        </>
                    ) : null}
                </View>
            </View>
        </Portal>
    );
});

export default function RoomList({
    onOpenSpaceSettings,
    onOpenRoomSettings,
}: Props) {
    // Zami: `dmPresence` and `dmPreview` are read per DM row (`dmPresenceFor`,
    // `dmPreviewFor` above), so a presence change or a new message re-renders
    // only that row.

    // Rooms currently being joined (show spinner)
    // Zami: in the join store, with the knock prompt (see createJoinStore).
    const [join] = useState(createJoinStore);
    // Zami: upstream's `inviteActionIds`, `handleAccept` and `handleReject` have no
    // control in this list (invites live in the inbox), so they aren't kept.

    // Browse Rooms section collapse toggle, persisted per browser so a user who
    // collapses it keeps it collapsed across reloads.
    const BROWSE_COLLAPSED_KEY = "roomlist.browseCollapsed";
    const [browseCollapsed, setBrowseCollapsed] = useState(
        () =>
            typeof localStorage !== "undefined" &&
            localStorage.getItem(BROWSE_COLLAPSED_KEY) === "1",
    );
    function toggleBrowseCollapsed(): void {
        const next = !browseCollapsed;
        setBrowseCollapsed(next);
        try {
            localStorage.setItem(BROWSE_COLLAPSED_KEY, next ? "1" : "0");
        } catch {
            // Private-mode localStorage can throw; the in-session toggle still works.
        }
    }

    // Knock-to-join prompt (shown when a join is refused but knocking may work)
    // Zami: its text is the join store's; the list reads which room has it
    // (its height is in getItemLayout).
    const knockPromptId = useSyncExternalStore(
        join.subscribe,
        () => join.knockPromptId,
    );
    const [knockPromptHeight, setKnockPromptHeight] = useState<number | null>(
        null,
    );
    const setKnockPromptId = (roomId: string | null) => {
        setKnockPromptHeight(null);
        join.setKnockPromptId(roomId);
    };

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{
        roomId: string;
        x: number;
        y: number;
        touch: boolean;
    } | null>(null);

    // Plugin room actions (zam.rooms.addAction) for the open context menu. Each
    // entry carries the ctx it was filtered with, so the click passes the same
    // room and space flag. A throwing `when` hides that entry only.
    // Zami: re-derived on each render; `pluginTick` and `roomsTick` (below)
    // re-render on a change.
    const pluginTick = useRune(() => pluginRegistry.tick);
    const menuPluginActions = (() => {
        void pluginTick;
        if (!contextMenu) return [];
        const roomId = contextMenu.roomId;
        const ctx = {
            roomId,
            isSpace: getRoom(roomId)?.isSpaceRoom() ?? false,
        };
        return pluginRegistry.roomActions
            .filter((e) => {
                try {
                    return e.value.when?.(ctx) ?? true;
                } catch (err) {
                    console.error("[zam] rooms.addAction when() threw", err);
                    return false;
                }
            })
            .map((e) => ({
                key: e.entryId,
                pluginId: e.pluginId,
                label: e.value.label,
                run: () => e.value.onSelect(ctx),
            }));
    })();

    // Runs a plugin room action after closing the menu, as the built-in items do.
    function runPluginRoomAction(run: () => void | Promise<void>) {
        closeModal();
        try {
            Promise.resolve(run()).catch((e) =>
                console.error("[zam] rooms.addAction onSelect threw", e),
            );
        } catch (e) {
            console.error("[zam] rooms.addAction onSelect threw", e);
        }
    }

    // Zami: `positionMenu` is `PositionedMenu`'s, above.

    function openContextMenu(
        roomId: string,
        x: number,
        y: number,
        touch: boolean,
    ) {
        // Claim first — a same-id handover runs the outgoing close.
        openModal("room-menu", () => setContextMenu(null));
        setContextMenu({ roomId, x, y, touch });
    }

    // Call-roster participant menu. Claims the shared modal slot so Escape /
    // the mobile back button dismiss it, same as the room menu above.
    const [participantMenu, setParticipantMenu] = useState<{
        room: Room;
        userId: string;
        x: number;
        y: number;
        touch: boolean;
    } | null>(null);
    // Plain let: read only from event handlers, never from markup or an effect.
    const participantMenuToken = useRef(0);

    function openParticipantMenu(
        room: Room,
        userId: string,
        x: number,
        y: number,
        touch: boolean,
    ) {
        participantMenuToken.current = openModal("call-participant-menu", () =>
            setParticipantMenu(null),
        );
        setParticipantMenu({ room, userId, x, y, touch });
    }

    function handleOpenSettings(roomId: string) {
        const room = getRoom(roomId);
        closeModal();
        if (room) onOpenRoomSettings?.(room);
    }
    function handleInvite(roomId: string) {
        closeModal();
        openInviteDialog(roomId);
    }
    async function handleCopyLink(roomId: string) {
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(getRoomShareLink(roomId));
        } catch {
            /* clipboard denied — silent */
        }
        closeModal();
    }
    async function handleMarkRead(roomId: string) {
        closeModal();
        await markRoomAsRead(roomId);
    }

    async function handleSetNotification(
        roomId: string,
        setting: RoomNotificationSetting,
    ) {
        closeModal();
        await setRoomNotificationSetting(roomId, setting);
    }

    async function handleAddToSpace(roomId: string, spaceId: string) {
        closeModal();
        await addRoomToSpace(spaceId, roomId);
    }

    // Two-click confirmation for the destructive Leave action.
    const [leaveConfirmId, setLeaveConfirmId] = useState<string | null>(null);
    useEffect(() => {
        // reset whenever the menu opens/closes/changes
        setLeaveConfirmId(null);
    }, [contextMenu]);

    async function handleToggleTag(
        roomId: string,
        kind: "favourite" | "lowPriority",
    ) {
        closeModal();
        try {
            await toggleRoomTag(roomId, kind);
            roomsState.roomsTick++;
        } catch (err) {
            console.error("Failed to update room tag:", err);
        }
    }

    async function handleLeave(roomId: string) {
        closeModal();
        try {
            await leaveRoom(roomId);
            if (roomsState.activeRoomId === roomId)
                roomsState.activeRoomId = null;
            roomsState.orphanRooms = roomsState.orphanRooms.filter(
                (r) => r.roomId !== roomId,
            );
            roomsState.directRooms = roomsState.directRooms.filter(
                (r) => r.roomId !== roomId,
            );
            roomsState.roomsInSpace = roomsState.roomsInSpace.filter(
                (r) => r.roomId !== roomId,
            );
            roomsState.spaces = roomsState.spaces.filter(
                (r) => r.roomId !== roomId,
            );
            roomsState.spaceHierarchy = roomsState.spaceHierarchy.map((r) =>
                r.roomId === roomId ? { ...r, isJoined: false } : r,
            );
        } catch (err) {
            console.error("Failed to leave room:", err);
        }
    }

    const activeSpaceId = useRune(() => roomsState.activeSpaceId);
    // Zami: the list itself doesn't re-render on each sync tick: what reads
    // the tick below returns the same value (or object) when nothing in it
    // changed, so a tick that changes no row renders nothing.

    // Space names mutate in place on the live Room object, so depend on the
    // tick — roomsState.spaces is no longer reassigned on every sync.
    const title = useRune(() => {
        void roomsState.roomsTick;
        return roomsState.activeSpaceId === null
            ? t("spaceSidebar.home")
            : roomsState.spaces.find(
                  (s) => s.roomId === roomsState.activeSpaceId,
              )?.name ||
                  roomsState.spaceDrillName ||
                  t("roomDirectory.space");
    });

    const visibleRooms = useRune(() =>
        roomsState.activeSpaceId === null
            ? roomsState.orphanRooms
            : roomsState.roomsInSpace,
    );

    // Tags mutate in place on the live Room objects, so depend on roomsTick.
    // Zami: regrouped (sorted) only when the rooms or their tags changed.
    const [groupByTags] = useState(() => memoByTags(groupRoomsByTag));
    const roomGroups = useRune(
        () => {
            void roomsState.roomsTick;
            return groupByTags(visibleRooms);
        },
        [visibleRooms, groupByTags],
        { isEqual: sameObject },
    );

    // Zami: `DM_SORT_LABELS` is at module level, above `HeaderMenu`.

    const directRooms = useRune(() => roomsState.directRooms);
    // Untagged DMs sort by the order picked in the header menu (latest
    // message by default; the SDK's room order is arbitrary). unreadTick: a
    // new message or a read moves the row; presenceTick: "online first".
    // Zami: a re-sort that keeps the same order returns the same array
    // (`shallowEqual`), so it renders nothing.
    const sortedDirectRooms = useRune(
        () => {
            void roomsState.roomsTick;
            void roomsState.unreadTick;
            const order = settingsState.dmSortOrder;
            if (order === "online") void presenceState.presenceTick;
            const facts = new Map<string, DmSortFacts>();
            for (const room of directRooms) {
                const found = latestMessage([
                    // Zami: only the timeline's tail, as latestMessage looks
                    // at most PREVIEW_SCAN events back.
                    ...room.getLiveTimeline().getEvents().slice(-PREVIEW_SCAN),
                    ...room.getPendingEvents(),
                ]);
                const fallback = room.getLastActiveTimestamp();
                const { unread } = roomButton(room);
                facts.set(room.roomId, {
                    lastMessageTs:
                        found?.event.getTs() ??
                        (fallback > Number.MIN_SAFE_INTEGER ? fallback : null),
                    unread,
                    presence:
                        order === "online"
                            ? (presenceFor(getDMPartnerId(room))?.state ??
                              "offline")
                            : "offline",
                    name: room.name,
                });
            }
            return sortRoomsByTag(
                directRooms,
                (r) => getRoomTags(r.roomId),
                dmComparator(order, (r) => facts.get(r.roomId)!),
            );
        },
        [directRooms],
        { isEqual: shallowEqual },
    );

    // `isJoined` is baked in when /hierarchy is fetched, so it goes stale after
    // a join or leave — isJoinedNow prefers live membership; roomsTick
    // re-derives when it changes.
    const spaceHierarchy = useRune(() => roomsState.spaceHierarchy);
    const unjoinedRooms = useRune(
        () => {
            if (activeSpaceId === null) return NO_ROOMS;
            void roomsState.roomsTick;
            return spaceHierarchy.filter((r) => !r.isSpace && !isJoinedNow(r));
        },
        [activeSpaceId, spaceHierarchy],
        { isEqual: shallowEqual },
    );

    // Zami: `spaceChildren` is at module level, above.

    const childSpaces = useRune(
        () => {
            if (activeSpaceId === null) return NO_SUBSPACES;
            void roomsState.roomsTick;
            return spaceChildren(activeSpaceId, spaceHierarchy).spaces;
        },
        [activeSpaceId, spaceHierarchy],
        { isEqual: sameSubSpaces },
    );

    // Collapsed categories, persisted per browser (expanded by default).
    const COLLAPSED_SUBSPACES_KEY = "roomlist.collapsedSubspaces";
    const [collapsedSubspaces, setCollapsedSubspaces] = useState(
        () =>
            new Set<string>(
                (() => {
                    try {
                        return JSON.parse(
                            localStorage.getItem(COLLAPSED_SUBSPACES_KEY) ??
                                "[]",
                        ) as string[];
                    } catch {
                        return [];
                    }
                })(),
            ),
    );
    function toggleSubspace(id: string): void {
        const next = new Set(collapsedSubspaces);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setCollapsedSubspaces(next);
        try {
            localStorage.setItem(
                COLLAPSED_SUBSPACES_KEY,
                JSON.stringify([...next]),
            );
        } catch {
            // Private-mode localStorage can throw; the in-session toggle still works.
        }
    }

    // Per-sub-space /hierarchy results (for their unjoined rooms and unjoined
    // nested sub-spaces), fetched lazily the first time a category is expanded
    // and dropped whenever the active space changes.
    const [subHierarchies, setSubHierarchies] = useState<
        Record<string, SpaceChildInfo[]>
    >({});
    const [subHierarchyLoading, setSubHierarchyLoading] = useState(
        new Set<string>(),
    );
    const subHierarchyRequested = useRef(new Set<string>());
    const subHierarchyDepths = useRef(new Map<string, number>());
    useEffect(() => {
        void activeSpaceId;
        setSubHierarchies({});
        setSubHierarchyLoading(new Set());
        subHierarchyRequested.current.clear();
        subHierarchyDepths.current.clear();
    }, [activeSpaceId]);

    // Keep expanded sub-spaces current while the app is open: re-fetch each
    // one that has been shown, quietly, now and then.
    const SUB_HIERARCHY_REFRESH_MS = 5 * 60_000;
    useEffect(() => {
        const timer = setInterval(async () => {
            if (document.visibilityState !== "visible") return;
            const active = roomsState.activeSpaceId;
            if (!active) return;
            for (const id of [...subHierarchyRequested.current]) {
                if (roomsState.activeSpaceId !== active) return;
                const parent = roomsState.spaceDrillParentId ?? active;
                const depth =
                    (roomsState.spaceDrillDepth || 0) +
                    (subHierarchyDepths.current.get(id) ?? 1);
                const h = await fetchSpaceHierarchy(id, parent, depth).catch(
                    () => null,
                );
                if (h && roomsState.activeSpaceId === active)
                    setSubHierarchies((s) => ({ ...s, [id]: h }));
            }
        }, SUB_HIERARCHY_REFRESH_MS);
        return () => clearInterval(timer);
    }, []);

    // Zami: the `loadSubHierarchy` action's `run`, called for each category the
    // list shows (an effect below) where upstream's action runs on each
    // category's mount and update.
    function loadSubHierarchy(p: {
        id: string;
        depth: number;
        expanded: boolean;
    }) {
        const active = roomsState.activeSpaceId;
        if (!p.expanded || !active || subHierarchyRequested.current.has(p.id))
            return;
        subHierarchyRequested.current.add(p.id);
        subHierarchyDepths.current.set(p.id, p.depth);
        // Show the last known listing at once (kept across launches), and
        // only re-walk the nested hierarchy when it is not fresh. The
        // fetch below then updates it silently: `loading` is only true
        // while there is nothing to show.
        const age = getCachedHierarchyAge(p.id);
        const cached = getCachedHierarchy(p.id);
        if (cached) {
            setSubHierarchies((s) => ({ ...s, [p.id]: cached }));
            if (age !== null && age < HIERARCHY_TTL_MS) return;
        }
        // The fallback walks in through the nearest joined ancestor.
        const parent = roomsState.spaceDrillParentId ?? active;
        const depth = p.depth + (roomsState.spaceDrillDepth || 0);
        setSubHierarchyLoading((s) => new Set(s).add(p.id));
        void fetchSpaceHierarchy(p.id, parent, depth)
            .catch(() => null)
            .then((h) => {
                if (roomsState.activeSpaceId !== active) return;
                setSubHierarchyLoading((s) => {
                    const next = new Set(s);
                    next.delete(p.id);
                    return next;
                });
                if (h) setSubHierarchies((s) => ({ ...s, [p.id]: h }));
                // Failed: allow a retry on the next collapse/expand.
                else subHierarchyRequested.current.delete(p.id);
            });
    }

    // Zami: `subtreeState` is at module level, above.

    function patchHierarchyEntry(
        roomId: string,
        patch: Partial<SpaceChildInfo>,
    ): void {
        patchCachedHierarchyEntry(roomId, patch);
        roomsState.spaceHierarchy = roomsState.spaceHierarchy.map((r) =>
            r.roomId === roomId ? { ...r, ...patch } : r,
        );
        setSubHierarchies((subHierarchies) => {
            const next: Record<string, SpaceChildInfo[]> = {};
            for (const [k, list] of Object.entries(subHierarchies)) {
                next[k] = list.map((r) =>
                    r.roomId === roomId ? { ...r, ...patch } : r,
                );
            }
            return next;
        });
    }

    const showDMs = activeSpaceId === null && directRooms.length > 0;

    const addJoining = join.addJoining;
    const removeJoining = join.removeJoining;
    const setKnockReason = join.setKnockReason;
    const setKnockError = join.setKnockError;

    async function handleJoin(room: SpaceChildInfo) {
        const roomId = room.roomId;
        addJoining(roomId);
        try {
            await joinRoom(roomId, room.via);
            // Mark as joined in hierarchy so the UI updates immediately
            patchHierarchyEntry(roomId, { isJoined: true });
            // Navigate into the room
            setActiveRoom(roomId);
        } catch (err) {
            console.error("Failed to join room:", err);
            if (shouldOfferKnock(err, room.joinRule)) {
                setKnockPromptId(roomId);
                setKnockReason("");
                setKnockError("");
            }
        } finally {
            removeJoining(roomId);
        }
    }

    async function handleKnock(room: SpaceChildInfo) {
        const roomId = room.roomId;
        addJoining(roomId);
        setKnockError("");
        try {
            await knockRoom(roomId, join.knock.reason, room.via);
            setKnockPromptId(null);
            // Mark as requested in hierarchy so the UI updates immediately
            patchHierarchyEntry(roomId, { isKnocked: true });
        } catch (err) {
            console.error("Failed to knock on room:", err);
            setKnockError(
                matrixErrorMessage(
                    err,
                    t("roomList.couldNotSendTheJoinRequest"),
                ),
            );
        } finally {
            removeJoining(roomId);
        }
    }

    async function handleCancelKnock(roomId: string) {
        addJoining(roomId);
        try {
            await cancelKnock(roomId);
            patchHierarchyEntry(roomId, { isKnocked: false });
        } catch (err) {
            console.error("Failed to cancel join request:", err);
        } finally {
            removeJoining(roomId);
        }
    }

    const activeSpaceRoom = useMemo(
        () => (activeSpaceId ? getRoom(activeSpaceId) : null),
        [activeSpaceId],
    );

    const canAccessSpaceSettings = useRune(() => {
        // Power levels arrive over sync mutating the same Room object, so
        // re-run on the tick or this stays false after a fresh page load.
        void roomsState.roomsTick;
        if (!activeSpaceRoom) return false;
        const myPl = getMyPowerLevel(activeSpaceRoom);
        const pl = getRoomPowerLevels(activeSpaceRoom);
        return myPl >= pl.state_default || myPl >= pl.kick || myPl >= pl.ban;
    }, [activeSpaceRoom]);

    // The header "+" opens QuickActions (create room/space/dm, join) plus, in a
    // space, Space Settings. Inside a space where you can neither add a room nor
    // open settings, every item gates out and the dropdown renders as an empty
    // sliver — so hide the trigger entirely there. On Home the menu always has
    // the global create actions. Space creation itself now lives on the space
    // rail's "+" (SpaceSidebar), reachable regardless of the active space.
    const hasHeaderActions = useRune(() => {
        void roomsState.roomsTick;
        if (!activeSpaceId) return true;
        return canAddRoomToSpace(activeSpaceId) || canAccessSpaceSettings;
    }, [activeSpaceId, canAccessSpaceSettings]);

    // Zami: `roomButton` is at module level, above.

    // ── Reorder mode (edit-mode drag + raw-order field) ─────────────────────
    const [reorderMode, setReorderMode] = useState(false);
    const [drag] = useState(createDragStore);
    // Zami: what the drag gesture reads on the UI thread (see Draggable).
    const dragRects = useSharedValue<DragRect[]>([]);
    const dragHover = useSharedValue<DragHover>(null);
    // Zami: whether a drag is under way, so the list holds still under it.
    const [dragging, setDragging] = useState(false);

    function toggleReorderMode() {
        setReorderMode(!reorderMode);
        drag.set(null);
        setDragging(false);
    }

    // Leave reorder mode whenever the visible list changes out from under it
    // (⚑4: auto-exit when the active space changes).
    useEffect(() => {
        void activeSpaceId;
        setReorderMode(false);
        drag.set(null);
        setDragging(false);
    }, [activeSpaceId, drag]);

    // Space channels are only reorderable when we can write the space's
    // m.space.child state (same power-level gate as adding a room to a space).
    const canReorderChannels = useRune(() => {
        void roomsState.roomsTick;
        return activeSpaceId ? canAddRoomToSpace(activeSpaceId) : false;
    }, [activeSpaceId]);

    // Hide the reorder toggle where nothing could be reordered: a space whose
    // channels we can't write and which shows no personal favourite/low-priority
    // rows (those tags are ours to order regardless of space power levels).
    const canReorderAnything =
        !activeSpaceId ||
        canReorderChannels ||
        roomGroups.favourites.length > 0 ||
        roomGroups.lowPriority.length > 0;

    // Refresh the view after a successful order write (drag or raw commit).
    function applyReorderReactivity(section: Section) {
        roomsState.roomsTick++;
        if (section === "channels" && roomsState.activeSpaceId) {
            roomsState.roomsInSpace = getRoomsInSpace(roomsState.activeSpaceId);
        }
    }

    function onRowPointerDown(
        roomId: string,
        section: Section,
        list: DragList,
    ) {
        drag.set({
            roomId,
            section,
            list,
            overId: null,
            before: false,
        });
        drag.measure(section, list, (rects) => {
            if (drag.get()?.roomId === roomId) dragRects.value = rects;
        });
        setDragging(true);
    }

    // Zami: the gesture found the row under the finger (`rowAt`, with the
    // same-section and same-list check) on the UI thread; this commits it.
    function onRowPointerMove(overId: string, before: boolean) {
        const d = drag.get();
        if (!d) return;
        if (!overId || overId === d.roomId) return;
        if (d.overId !== overId || d.before !== before)
            drag.set({ ...d, overId, before });
    }

    async function onRowPointerUp() {
        const d = drag.get();
        if (!d) return;
        drag.set(null);
        setDragging(false);
        if (!d.overId || d.overId === d.roomId) return;

        // Reconstruct the section's visible order. Zami: upstream reads it back
        // from the DOM; here it comes from the list's rows, which are exactly
        // the rows rendered as draggable for the section, in visual order.
        const ids = rows.flatMap((r) =>
            (r.kind === "channel" &&
                d.list === "main" &&
                r.section === d.section) ||
            (r.kind === "dm" &&
                d.list === "dm" &&
                dmSectionOf(roomTagKind(getRoomTags(r.room.roomId))) ===
                    d.section)
                ? [r.room.roomId]
                : [],
        );
        const origIdx = ids.indexOf(d.roomId);
        const origBefore = origIdx > 0 ? ids[origIdx - 1] : null;
        const origAfter =
            origIdx >= 0 && origIdx < ids.length - 1 ? ids[origIdx + 1] : null;

        const list = ids.filter((id) => id !== d.roomId);
        const overIdx = list.indexOf(d.overId);
        if (overIdx === -1) return;
        list.splice(d.before ? overIdx : overIdx + 1, 0, d.roomId);
        const pos = list.indexOf(d.roomId);
        const beforeId = pos > 0 ? list[pos - 1] : null;
        const afterId = pos < list.length - 1 ? list[pos + 1] : null;

        // Skip the write when the slot didn't actually change.
        if (beforeId === origBefore && afterId === origAfter) return;

        try {
            if (d.section === "channels") {
                if (!roomsState.activeSpaceId) return;
                await reorderSpaceChild(
                    roomsState.activeSpaceId,
                    d.roomId,
                    beforeId,
                    afterId,
                );
            } else {
                await reorderRoomTag(d.section, d.roomId, beforeId, afterId);
            }
            applyReorderReactivity(d.section);
        } catch (err) {
            console.error("Failed to reorder room:", err);
        }
    }

    function onRowPointerCancel() {
        drag.set(null);
        setDragging(false);
    }

    // Zami: `viaOf` and `rawOrderOf` are at module level, above.

    async function commitRawOrder(room: Room, section: Section, raw: string) {
        try {
            if (section === "channels") {
                if (!roomsState.activeSpaceId) return;
                await setSpaceChildOrder(
                    roomsState.activeSpaceId,
                    room.roomId,
                    raw,
                    viaOf(room.roomId),
                );
            } else {
                const result = await setRoomTagOrderRaw(
                    room.roomId,
                    section === "favourite" ? TAG_FAVOURITE : TAG_LOWPRIORITY,
                    raw,
                );
                if (result.kind === "set" && result.clamped) {
                    showErrorToast(
                        t("roomList.orderMustBeBetween0And", {
                            value: result.value,
                        }),
                    );
                }
            }
            applyReorderReactivity(section);
        } catch (err) {
            console.error("Failed to set order value:", err);
            showErrorToast(
                err instanceof Error
                    ? err.message
                    : t("roomList.failedToSetOrder"),
            );
        }
    }

    const hierarchyLoading = useRune(() => roomsState.hierarchyLoading);

    // Zami: the list's blocks, in upstream's order, as FlatList rows. Built in
    // a rune selector: sub-space categories read their children live, so with
    // any on screen it re-runs on each sync tick, but unchanged rows keep their
    // objects and the list its array (`rowCache`), so such a tick re-renders
    // nothing.
    const [rowCache] = useState(() => createRowCache<Row>());
    const lastLoads = useRef<CategoryLoad[]>([]);
    const flatRows = useRune(
        () => {
            if (childSpaces.length > 0) void roomsState.roomsTick;
            let loads: CategoryLoad[] = [];
            const rows = rowCache.build((row) => {
                const out: Row[] = [];
                const push = (r: Row) => out.push(row(r));

                // Inbox button (home view only)
                if (!activeSpaceId) push({ kind: "inbox", key: "inbox" });

                if (visibleRooms.length > 0) {
                    // px-2 matches the channel rows' 8px left inset (the row
                    // button's padding-left: 0.5rem). MemberList and the
                    // context menus use other values on purpose: a heading's
                    // inset tracks the rows it labels, so don't collapse the
                    // three panels onto one number.
                    const group = (
                        id: string,
                        label: string,
                        rooms: Room[],
                        section: Section | null,
                    ) => {
                        if (rooms.length === 0) return;
                        push({ kind: "heading", key: `heading:${id}`, label });
                        for (const room of rooms)
                            push({
                                kind: "channel",
                                key: `${id}:${room.roomId}`,
                                room,
                                section,
                                depth: 0,
                            });
                    };
                    group(
                        "favourites",
                        t("roomList.favourites"),
                        roomGroups.favourites,
                        "favourite",
                    );
                    group(
                        "normal",
                        activeSpaceId
                            ? t("roomList.channels")
                            : t("roomList.rooms"),
                        roomGroups.normal,
                        activeSpaceId ? "channels" : null,
                    );
                    group(
                        "lowPriority",
                        t("roomList.lowPriority"),
                        roomGroups.lowPriority,
                        "lowPriority",
                    );
                    push({
                        kind: "gap",
                        key: "gap:rooms",
                        depth: 0,
                        size: "h-2",
                    });
                }

                // A sub-space, rendered as a collapsible category (recursive)
                const spaceCategory = (
                    node: SubSpace,
                    depth: number,
                    ancestors: string[],
                    indent: number,
                    path: string,
                ) => {
                    const expanded = !collapsedSubspaces.has(node.id);
                    const hier =
                        subHierarchies[node.id] ?? getCachedHierarchy(node.id);
                    const kids = spaceChildren(node.id, hier);
                    // Spinner only when there's nothing cached to show meanwhile.
                    const loading = subHierarchyLoading.has(node.id) && !hier;
                    const nestedSpaces = kids.spaces.filter(
                        (c) => c.id !== node.id && !ancestors.includes(c.id),
                    );
                    loads.push({ id: node.id, depth, expanded });
                    push({
                        kind: "category",
                        key: path,
                        id: node.id,
                        name: node.name,
                        depth: indent,
                        expanded,
                        loading,
                    });
                    if (expanded) {
                        for (const room of kids.rooms)
                            push({
                                kind: "channel",
                                key: `${path}|room:${room.roomId}`,
                                room,
                                section: null,
                                depth: indent + 1,
                            });
                        for (const room of kids.unjoined)
                            push({
                                kind: "unjoined",
                                key: `${path}|unjoined:${room.roomId}`,
                                room,
                                depth: indent + 1,
                            });
                        for (const child of nestedSpaces)
                            spaceCategory(
                                child,
                                depth + 1,
                                [...ancestors, node.id],
                                indent + 1,
                                `${path}/${child.id}`,
                            );
                        if (
                            !loading &&
                            kids.rooms.length === 0 &&
                            kids.unjoined.length === 0 &&
                            nestedSpaces.length === 0
                        )
                            push({
                                kind: "emptyCategory",
                                key: `${path}|empty`,
                                depth: indent + 1,
                            });
                    }
                    push({
                        kind: "gap",
                        key: `${path}|gap`,
                        depth: indent,
                        size: "h-1",
                    });
                };

                // Sub-spaces of the active space
                for (const space of childSpaces)
                    spaceCategory(
                        space,
                        1,
                        [activeSpaceId ?? ""],
                        0,
                        `category:${space.id}`,
                    );

                // Unjoined rooms (from space hierarchy)
                if (unjoinedRooms.length > 0) {
                    push({
                        kind: "browse",
                        key: "browse",
                        collapsed: browseCollapsed,
                    });
                    if (!browseCollapsed)
                        for (const room of unjoinedRooms)
                            push({
                                kind: "unjoined",
                                key: `unjoined:${room.roomId}`,
                                room,
                                depth: 0,
                            });
                    push({
                        kind: "gap",
                        key: "gap:browse",
                        depth: 0,
                        size: "h-2",
                    });
                }

                // Direct messages
                if (showDMs) {
                    push({
                        kind: "heading",
                        key: "heading:dms",
                        label: t("roomList.directMessages"),
                    });
                    for (const room of sortedDirectRooms)
                        push({ kind: "dm", key: `dm:${room.roomId}`, room });
                    push({
                        kind: "gap",
                        key: "gap:dms",
                        depth: 0,
                        size: "h-2",
                    });
                }

                if (
                    visibleRooms.length === 0 &&
                    unjoinedRooms.length === 0 &&
                    childSpaces.length === 0 &&
                    !hierarchyLoading &&
                    !showDMs
                )
                    push({ kind: "empty", key: "empty" });

                return out;
            });
            // The same loads keep their array, so the effect below doesn't
            // run for nothing.
            if (
                loads.length === lastLoads.current.length &&
                loads.every((l, i) => shallowEqual(l, lastLoads.current[i]))
            )
                loads = lastLoads.current;
            else lastLoads.current = loads;
            return { rows, loads };
        },
        [
            activeSpaceId,
            visibleRooms,
            roomGroups,
            childSpaces,
            collapsedSubspaces,
            subHierarchies,
            subHierarchyLoading,
            unjoinedRooms,
            browseCollapsed,
            showDMs,
            sortedDirectRooms,
            hierarchyLoading,
            rowCache,
        ],
        { isEqual: (a, b) => a.rows === b.rows && a.loads === b.loads },
    );
    const rows = flatRows.rows;
    const prevRows = useRef<readonly Row[]>(rows);
    useLayoutEffect(() => {
        prevRows.current = rows;
    }, [rows]);

    // Zami: the keyboard room navigation's rows, upstream's `data-nav-room`
    // rows (channels and DMs), read when a shortcut runs.
    useEffect(
        () =>
            setNavRooms(() =>
                prevRows.current.flatMap((row) => {
                    if (row.kind !== "channel" && row.kind !== "dm") return [];
                    const { unread, highlight } = roomButton(row.room);
                    return [
                        { id: row.room.roomId, unread, mention: highlight > 0 },
                    ];
                }),
            ),
        [],
    );

    // The `loadSubHierarchy` action on each category: fetch an expanded one's
    // hierarchy the first time it shows.
    const categoryLoads = flatRows.loads;
    useEffect(() => {
        for (const p of categoryLoads) loadSubHierarchy(p);
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- the action's mount + update.
    }, [categoryLoads]);

    const actions = useStableHandlers<RowActions>({
        openContextMenu,
        openParticipantMenu,
        openRoomSettings: (room) => onOpenRoomSettings?.(room),
        openSpaceSettings: () => {
            if (activeSpaceRoom) onOpenSpaceSettings?.(activeSpaceRoom);
        },
        toggleSubspace,
        toggleBrowseCollapsed,
        handleJoin,
        handleKnock,
        handleCancelKnock,
        setKnockPromptId,
        setKnockReason,
        setKnockPromptHeight: (height) => {
            if (height !== knockPromptHeight) setKnockPromptHeight(height);
        },
        commitRawOrder,
        onRowPointerDown,
        onRowPointerMove,
        onRowPointerUp,
        onRowPointerCancel,
    });
    const isTouchscreen = useRune(() => interfaceState.isTouchscreen);
    const selectedStyle = useSelectedBackground();
    const { fontScale } = useWindowDimensions();
    const metrics = useMemo(() => rowMetrics(fontScale), [fontScale]);
    const rowContext = useMemo<RowContextValue>(
        () => ({
            reorderMode,
            canReorderChannels,
            isTouchscreen,
            actions,
            drag,
            dragRects,
            dragHover,
            join,
            metrics,
            selectedStyle,
        }),
        [
            reorderMode,
            canReorderChannels,
            isTouchscreen,
            actions,
            drag,
            dragRects,
            dragHover,
            join,
            metrics,
            selectedStyle,
        ],
    );

    // Zami: where each row starts, for getItemLayout (see rowMetrics). Only a
    // change to the rows, a call's roster or the knock prompt redoes it.
    const calls = useRune(() => callCounts(), [], { isEqual: sameCounts });
    const offsets = useMemo(() => {
        const knock = { roomId: knockPromptId, height: knockPromptHeight };
        const out = new Float64Array(rows.length + 1);
        for (let i = 0; i < rows.length; i++)
            out[i + 1] = out[i]! + rowHeight(rows[i]!, metrics, calls, knock);
        return out;
    }, [rows, metrics, calls, knockPromptId, knockPromptHeight]);
    const getItemLayout = useCallback(
        (_: ArrayLike<Row> | null | undefined, index: number) => ({
            length: offsets[index + 1]! - offsets[index]!,
            offset: offsets[index]!,
            index,
        }),
        [offsets],
    );

    const renderItem = useCallback(
        ({ item }: ListRenderItemInfo<Row>) => {
            switch (item.kind) {
                case "inbox":
                    return <InboxButton />;
                case "heading":
                    // Zami: one line at a fixed height (see rowMetrics).
                    return (
                        <Text
                            accessibilityRole="header"
                            numberOfLines={1}
                            className="px-2 py-1 text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
                            style={{ height: metrics.heading }}
                        >
                            {item.label}
                        </Text>
                    );
                case "channel":
                    return (
                        <Indent depth={item.depth}>
                            <ChannelRow
                                room={item.room}
                                section={item.section}
                            />
                        </Indent>
                    );
                case "unjoined":
                    return (
                        <Indent depth={item.depth}>
                            <UnjoinedRow room={item.room} />
                        </Indent>
                    );
                case "category":
                    return (
                        <Indent depth={item.depth}>
                            <CategoryHeader
                                id={item.id}
                                name={item.name}
                                expanded={item.expanded}
                                loading={item.loading}
                            />
                        </Indent>
                    );
                case "emptyCategory":
                    return (
                        <Indent depth={item.depth}>
                            <Text
                                numberOfLines={1}
                                className="px-2 py-1 text-xs italic text-discord-textMuted"
                                style={{ height: metrics.emptyCategory }}
                            >
                                {t("roomList.emptyCategory")}
                            </Text>
                        </Indent>
                    );
                case "browse":
                    return (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ expanded: !item.collapsed }}
                            onPress={actions.toggleBrowseCollapsed}
                            className="w-full flex-row items-center gap-1 px-2 py-1 transition-colors"
                            style={{ height: metrics.browse }}
                        >
                            <Text
                                numberOfLines={1}
                                className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
                            >
                                {t("roomList.browseRooms")}
                            </Text>
                            <SvgIcon
                                className={`w-3 h-3 flex-shrink-0 ms-auto transition-transform text-discord-textMuted ${
                                    item.collapsed ? "-rotate-90" : ""
                                }`}
                                d={CHEVRON_PATH}
                            />
                        </Pressable>
                    );
                case "dm":
                    return <DmRow room={item.room} />;
                case "gap":
                    return (
                        <Indent depth={item.depth}>
                            <View className={item.size} />
                        </Indent>
                    );
                case "empty":
                    return (
                        <Text className="px-4 py-8 text-sm text-discord-textMuted text-center">
                            {t("roomList.noRoomsYet")}
                        </Text>
                    );
            }
        },
        // Zami: no row state: rows read their own (the join store, runes),
        // so this stays the same and FlatList re-renders no cell for it.
        [actions, metrics],
    );

    // Header actions dropdown: its trigger's box places it.
    const headerMenuOpen = useRune(
        () => interfaceState.modal === "room-header-menu",
    );
    const headerTrigger = useRef<ViewInstance>(null);
    const [headerAnchor, setHeaderAnchor] = useState<LayoutRectangle | null>(
        null,
    );

    // The context menu's live state (notification setting, tags, spaces).
    // Zami: a sync tick that changes none of it re-renders nothing (`sameMenu`).
    const cmRoomId = contextMenu?.roomId ?? null;
    const menu = useRune(
        () => {
            if (cmRoomId === null) return null;
            const currentSetting = getRoomNotificationSetting(cmRoomId);
            void roomsState.roomsTick;
            return {
                currentSetting,
                canInvite: canInviteToRoom(cmRoomId),
                activeTagKind: roomTagKind(getRoomTags(cmRoomId)),
                eligibleSpaces: getSpaces().filter((s) =>
                    canAddRoomToSpace(s.roomId),
                ),
                isLastMember: isLastJoinedMember(cmRoomId),
            };
        },
        [cmRoomId],
        { isEqual: sameMenu },
    );

    const menuItemClass =
        "w-full px-3 py-1.5 active:bg-discord-messageHover transition-colors";
    const menuItems = (cm: NonNullable<typeof contextMenu>) => {
        if (!menu) return null;
        const { currentSetting, activeTagKind, eligibleSpaces } = menu;
        return (
            <>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => handleOpenSettings(cm.roomId)}
                    className={menuItemClass}
                >
                    <Text className="text-sm text-discord-textSecondary">
                        {t("common.settings")}
                    </Text>
                </Pressable>
                {menu.canInvite ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => handleInvite(cm.roomId)}
                        className={menuItemClass}
                    >
                        <Text className="text-sm text-discord-textSecondary">
                            {t("common.invitePeople")}
                        </Text>
                    </Pressable>
                ) : null}
                <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleCopyLink(cm.roomId)}
                    className={menuItemClass}
                >
                    <Text className="text-sm text-discord-textSecondary">
                        {t("roomList.copyRoomLink")}
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleMarkRead(cm.roomId)}
                    className={menuItemClass}
                >
                    <Text className="text-sm text-discord-textSecondary">
                        {t("roomList.markAsRead")}
                    </Text>
                </Pressable>
                <View className="w-full h-px bg-discord-divider my-1" />
                {/* px-3 matches this menu's buttons, not the sidebar's list headings. */}
                <Text
                    accessibilityRole="header"
                    className="px-3 py-1 text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
                >
                    {t("common.notifications")}
                </Text>
                {(
                    [
                        ["default", "Default"],
                        ["all", "All Messages"],
                        ["mentions", "Mentions Only"],
                        ["mute", "Mute"],
                    ] as const
                ).map(([val, label]) => {
                    const color =
                        currentSetting === val
                            ? "text-discord-textPrimary"
                            : "text-discord-textSecondary";
                    return (
                        <Pressable
                            key={val}
                            accessibilityRole="button"
                            accessibilityState={{
                                selected: currentSetting === val,
                            }}
                            onPress={() =>
                                void handleSetNotification(cm.roomId, val)
                            }
                            className={`${menuItemClass} flex-row items-center gap-2`}
                        >
                            <View className="w-3 flex-row items-center justify-center">
                                {currentSetting === val ? (
                                    <FilledCircle size={8} className={color} />
                                ) : null}
                            </View>
                            <Text className={`text-sm ${color}`}>{label}</Text>
                        </Pressable>
                    );
                })}
                <View className="w-full h-px bg-discord-divider my-1" />
                {(
                    [
                        ["favourite", "Favourite"],
                        ["lowPriority", "Low Priority"],
                    ] as const
                ).map(([kind, label]) => {
                    const color =
                        activeTagKind === kind
                            ? "text-discord-textPrimary"
                            : "text-discord-textSecondary";
                    return (
                        <Pressable
                            key={kind}
                            accessibilityRole="button"
                            accessibilityState={{
                                selected: activeTagKind === kind,
                            }}
                            onPress={() =>
                                void handleToggleTag(cm.roomId, kind)
                            }
                            className={`${menuItemClass} flex-row items-center gap-2`}
                        >
                            <View className="w-3 flex-row items-center justify-center">
                                {activeTagKind === kind ? (
                                    <FilledCircle size={8} className={color} />
                                ) : null}
                            </View>
                            <Text className={`text-sm ${color}`}>{label}</Text>
                        </Pressable>
                    );
                })}
                {eligibleSpaces.length > 0 ? (
                    <>
                        <View className="w-full h-px bg-discord-divider my-1" />
                        <Text
                            accessibilityRole="header"
                            className="px-3 py-1 text-xs text-discord-textMuted uppercase font-semibold tracking-wide"
                        >
                            {t("roomList.addToSpace")}
                        </Text>
                        {eligibleSpaces.map((space) => (
                            <Pressable
                                key={space.roomId}
                                accessibilityRole="button"
                                onPress={() =>
                                    void handleAddToSpace(
                                        cm.roomId,
                                        space.roomId,
                                    )
                                }
                                className={menuItemClass}
                            >
                                <Text
                                    numberOfLines={1}
                                    className="text-sm text-discord-textSecondary"
                                >
                                    {getSpaceName(space)}
                                </Text>
                            </Pressable>
                        ))}
                    </>
                ) : null}
                <View className="w-full h-px bg-discord-divider my-1" />
                {leaveConfirmId === cm.roomId ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void handleLeave(cm.roomId)}
                        className="w-full px-3 py-1.5 bg-discord-danger transition-colors"
                    >
                        <Text className="text-sm text-white font-medium">
                            {menu.isLastMember
                                ? t("roomList.clickAgainToLeaveLastMember")
                                : t("roomList.clickAgainToLeave")}
                        </Text>
                    </Pressable>
                ) : (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => setLeaveConfirmId(cm.roomId)}
                        className="w-full px-3 py-1.5 active:bg-discord-danger transition-colors"
                    >
                        <Text className="text-sm text-discord-danger">
                            {t("roomList.leaveRoom")}
                        </Text>
                    </Pressable>
                )}
                {menuPluginActions.length > 0 ? (
                    <>
                        <View className="w-full h-px bg-discord-divider my-1" />
                        {menuPluginActions.map((entry) => (
                            <Pressable
                                key={entry.key}
                                accessibilityRole="button"
                                onPress={() => runPluginRoomAction(entry.run)}
                                className={menuItemClass}
                            >
                                <Text className="text-sm text-discord-textSecondary">
                                    {entry.label}
                                </Text>
                            </Pressable>
                        ))}
                    </>
                ) : null}
            </>
        );
    };

    return (
        <>
            {/* Zami: not ported: `data-zam-region="room-list"`, the DOM hook
                plugins find the list by (pluginDom.ts); there's no DOM to
                query. */}
            <View className="flex-1 min-w-0 bg-discord-backgroundSecondary flex-col">
                {/* Header */}
                <View className="h-12 px-4 flex-row items-center border-b border-discord-divider shadow-sm flex-shrink-0 gap-2">
                    {/* Zami: `text-base` is the size the web `<h2>` inherits. */}
                    <Text
                        accessibilityRole="header"
                        numberOfLines={1}
                        className="text-base font-semibold text-discord-textPrimary flex-1"
                    >
                        {title}
                    </Text>
                    {hierarchyLoading ? (
                        <Spin className="w-3.5 h-3.5 border-2 border-discord-textMuted border-t-transparent rounded-full flex-shrink-0" />
                    ) : null}
                    {/* Reorder-mode toggle. Zami: its `title` is its label. */}
                    {canReorderAnything ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={
                                reorderMode
                                    ? t("roomList.doneReordering")
                                    : t("roomList.reorderRooms")
                            }
                            accessibilityState={{ selected: reorderMode }}
                            onPress={toggleReorderMode}
                            className="p-1 rounded transition-colors flex-shrink-0 active:bg-discord-messageHover"
                        >
                            {reorderMode ? (
                                <SvgIcon
                                    className="w-4 h-4 text-discord-accent"
                                    d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                                />
                            ) : (
                                // Up/down arrows: "move things around"
                                <SvgIcon
                                    className="w-4 h-4 text-discord-textMuted"
                                    d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3 5 6.99h3V14h2V6.99h3L9 3z"
                                />
                            )}
                        </Pressable>
                    ) : null}
                    {/* Actions menu (burger) — hidden when the menu would be empty (a space where you
                         lack power to add a room or open settings), which otherwise rendered
                         an empty dropdown sliver. */}
                    {hasHeaderActions ? (
                        // Dropdown trigger
                        <View
                            ref={headerTrigger}
                            className="relative flex-shrink-0"
                        >
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t("common.actions")}
                                accessibilityState={{
                                    expanded: headerMenuOpen,
                                }}
                                onPress={() => {
                                    if (
                                        interfaceState.modal ===
                                        "room-header-menu"
                                    ) {
                                        closeModal();
                                        return;
                                    }
                                    headerTrigger.current?.measureInWindow(
                                        (x, y, width, height) =>
                                            setHeaderAnchor({
                                                x,
                                                y,
                                                width,
                                                height,
                                            }),
                                    );
                                    openModal("room-header-menu", () => {});
                                }}
                                className="p-1 rounded active:bg-discord-messageHover transition-colors"
                            >
                                <SvgIcon
                                    className="w-4 h-4 text-discord-textMuted"
                                    d="M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z"
                                />
                            </Pressable>
                        </View>
                    ) : null}
                </View>

                {/* Room list */}
                <RowContext.Provider value={rowContext}>
                    {/* Zami: rows have fixed heights (getItemLayout), and a screen
                        or two either side are mounted, not FlatList's ten. */}
                    <FlatList
                        className="flex-1"
                        data={rows}
                        keyExtractor={rowKey}
                        renderItem={renderItem}
                        getItemLayout={getItemLayout}
                        initialNumToRender={30}
                        windowSize={5}
                        keyboardShouldPersistTaps="handled"
                        scrollEnabled={!dragging}
                    />
                </RowContext.Provider>

                <VoiceCallPanel />
            </View>

            {hasHeaderActions ? (
                <HeaderMenu
                    open={headerMenuOpen}
                    anchor={headerAnchor}
                    spaceId={activeSpaceId ?? undefined}
                    canAccessSpaceSettings={canAccessSpaceSettings}
                    onSpaceSettings={actions.openSpaceSettings}
                />
            ) : null}

            {contextMenu && menu ? (
                <Portal>
                    {contextMenu.touch ? (
                        <BottomSheet onClose={closeModal}>
                            {menuItems(contextMenu)}
                        </BottomSheet>
                    ) : (
                        <PositionedMenu
                            x={contextMenu.x}
                            y={contextMenu.y}
                            onClose={closeModal}
                        >
                            {menuItems(contextMenu)}
                        </PositionedMenu>
                    )}
                </Portal>
            ) : null}

            {/* CallParticipantMenu brings its own Portal + backdrop — don't wrap it. */}
            {participantMenu ? (
                <CallParticipantMenu
                    room={participantMenu.room}
                    userId={participantMenu.userId}
                    x={participantMenu.x}
                    y={participantMenu.y}
                    touch={participantMenu.touch}
                    onClose={() => {
                        setParticipantMenu(null);
                        clearModalIfOwner(participantMenuToken.current);
                    }}
                />
            ) : null}
        </>
    );
}

const styles = StyleSheet.create({
    measuring: { left: 0, top: 0, opacity: 0 },
    // Sized by its content, up to the menu's max height.
    scroll: { flexGrow: 0, flexShrink: 1 },
});
