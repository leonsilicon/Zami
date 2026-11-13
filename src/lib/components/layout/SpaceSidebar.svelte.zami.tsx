import {
    anchorElement,
    Checkbox,
    Spin,
    SvgIcon,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Circle } from "lucide-svelte";
import type { Room } from "matrix-js-sdk";
import {
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from "react";
import {
    FlatList,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
    type HostInstance,
    type LayoutRectangle,
    type ScrollViewInstance,
    type ViewStyle,
} from "react-native";
import {
    GestureDetector,
    usePanGesture,
    type PanGestureConfig,
} from "react-native-gesture-handler";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useResolveClassNames, useUniwind } from "uniwind";
import { t } from "$lib/i18n";
import Avatar from "$lib/components/ui/Avatar.svelte";
import Portal from "$lib/components/ui/Portal.svelte";
import BottomSheet from "$lib/components/ui/BottomSheet.svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import RoomDirectory from "$lib/components/layout/RoomDirectory.svelte";
import QuickActions from "$lib/components/layout/QuickActions.svelte";
import {
    getRoomAvatar,
    getRoomDisplayName,
    leaveRoom,
    setSpaceLayout,
    getHomeUnreadGroup,
    getSpaceUnreadGroup,
    getSpaceUnreadReach,
    getRoomsInSpace,
    getSpaceChildIds,
    getNestedSpaceIds,
    getRoom,
    getOrphanRooms,
    getDirectRooms,
    addRoomToSpace,
    canAddRoomToSpace,
    canInviteToRoom,
    getRoomShareLink,
    markSpaceAsRead,
    createRoom as createRoomFn,
    retryRoomFollowUp,
    getRoomNotificationSetting,
    setRoomNotificationSetting,
    isLastJoinedMember,
    type RoomNotificationSetting,
    type SpaceLayout,
} from "$lib/matrix/client";
import {
    roomsState,
    setActiveSpace,
    setActiveRoom,
    showSpaceHome,
    restoreLastRoom,
} from "$lib/stores/rooms.svelte";
import { openInviteDialog } from "$lib/stores/inviteDialog.svelte";
import {
    hasLoudInRoom,
    notificationsState,
} from "$lib/stores/notifications.svelte";
import { openModal, closeModal } from "$lib/stores/interface.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
// Zami: no focusTrap/activeFocusTrap or dismissOnOutsidePointer: a press outside
// is a backdrop, and Escape is VoiceOver's escape gesture.
import { mapWithConcurrency } from "$lib/utils/async";
import { collectSpaceAndDescendantRoomIds } from "$lib/utils/spaceNotifications";
import type { RoomFollowUp } from "$lib/utils/roomCreationOutcome";
import { setNavSpaces } from "$lib/keybinds/runner";

interface Notifs {
    unread: boolean;
    highlight: boolean;
    loud: boolean;
}

// Zami: the rooms with a loud notification, worked out once per change of the
// notifications store (each bumps its `tick`). They are few, so a badge looks
// for them among its rooms, not at each of its rooms.
let loudRoomsCache: { tick: number; ids: string[] } | null = null;
function loudRoomIds(): readonly string[] {
    const tick = notificationsState.tick;
    if (loudRoomsCache?.tick === tick) return loudRoomsCache.ids;
    const ids = Object.keys(notificationsState.byRoom).filter((id) =>
        hasLoudInRoom(id),
    );
    loudRoomsCache = { tick, ids };
    return ids;
}

// Zami: upstream's two passes (the unread state of every room in the space and
// in every space below it, then hasLoudInSpace over them again), from the
// unread roll-ups instead (getSpaceUnreadGroup, kept current as rooms change):
// a pass over the spaces the badge covers, not their rooms. The same answer:
// unread if any of those rooms is unread, has a highlight or a loud
// notification. roomsTick follows a change in which rooms those are.
function getSpaceNotifs(spaceId: string): Notifs {
    void roomsState.unreadTick;
    void roomsState.roomsTick;
    const loudIds = loudRoomIds();
    let unread = false;
    let highlight = false;
    let loud = false;
    for (const id of getSpaceUnreadReach(spaceId)) {
        const group = getSpaceUnreadGroup(id);
        if (group.highlight > 0) highlight = true;
        if (group.unread > 0) unread = true;
        if (!loud) loud = loudIds.some((roomId) => group.members.has(roomId));
    }
    return { unread: unread || loud, highlight, loud };
}

// Zami: as getSpaceNotifs, over Home's rooms and DMs (getHomeUnreadGroup).
function getHomeNotifs(): Notifs {
    void roomsState.unreadTick;
    void roomsState.roomsTick;
    const group = getHomeUnreadGroup();
    const loud = loudRoomIds().some((roomId) => group.members.has(roomId));
    return {
        unread: group.unread > 0 || loud,
        highlight: group.highlight > 0,
        loud,
    };
}

// Zami: upstream's `{@const folderNotifs = item.spaces.reduce(…)}`, as a
// function its badge reads.
function getFolderNotifs(spaces: Room[]): Notifs {
    return spaces.reduce<Notifs>(
        (acc, s) => {
            const n = getSpaceNotifs(s.roomId);
            return {
                unread: acc.unread || n.unread,
                highlight: acc.highlight || n.highlight,
                loud: acc.loud || n.loud,
            };
        },
        { unread: false, highlight: false, loud: false },
    );
}

// Zami: a scope for `{#each [getHomeNotifs()] as n}` and `{@const … =
// getSpaceNotifs(…)}`. The badge reads the unread state itself (it changes on
// every sync), down to the three flags it renders, so a sync re-renders the
// badges and not the whole rail.
function WithNotifs({
    read,
    deps = [],
    children,
}: {
    read: () => Notifs;
    deps?: readonly unknown[];
    children: (n: Notifs) => ReactNode;
}) {
    const bits = useRune(() => {
        const n = read();
        return (n.unread ? 1 : 0) | (n.highlight ? 2 : 0) | (n.loud ? 4 : 0);
    }, deps);
    return children({
        unread: (bits & 1) !== 0,
        highlight: (bits & 2) !== 0,
        loud: (bits & 4) !== 0,
    });
}

interface Props {
    onHomeClick: () => void;
    onOpenSpaceSettings?: (room: Room) => void;
}

type ContextMenu =
    | {
          kind: "space";
          spaceId: string;
          folderId: string | null;
          x: number;
          y: number;
          touch: boolean;
      }
    | {
          kind: "folder";
          folderId: string;
          x: number;
          y: number;
          touch: boolean;
      };

const FOLDER_COLORS = [
    "#7289da",
    "#3ba55c",
    "#ed4245",
    "#faa61a",
    "#eb459e",
    "#00b0f0",
    "#9475f5",
    "#23a559",
];

function hsvToHex(h: number, s: number, v: number): string {
    const f = (n: number) => {
        const k = (n + h / 60) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    const r = Math.round(f(5) * 255);
    const g = Math.round(f(3) * 255);
    const b = Math.round(f(1) * 255);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function hexToHsv(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b),
        d = max - min;
    const v = max;
    const s = max === 0 ? 0 : d / max;
    let hh = 0;
    if (d !== 0) {
        if (max === r) hh = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (max === g) hh = ((b - r) / d + 2) * 60;
        else hh = ((r - g) / d + 4) * 60;
    }
    return [hh, s, v];
}

type DragState = { id: string; fromFolderId: string | null };
// id = root item id or folder-space id, position = where to drop relative to it
type DropTarget = {
    id: string;
    position: "before" | "after" | "into";
};

type RootItem =
    | { kind: "space"; id: string; space: Room }
    | { kind: "folder"; id: string; spaces: Room[] };

// Zami: upstream's touch timers: a 300 ms hold starts a drag, 600 ms opens the
// context menu.
const DRAG_HOLD_MS = 300;
const CONTEXT_MENU_HOLD_MS = 600;
// Zami: how far (points) a dragged rail item moves before its drop target is
// worked out again (TouchDrag).
const TOUCH_MOVE_STEP_PX = 4;

// Zami: state the touch handlers read too. They run from gesture callbacks,
// which can arrive before React re-renders with a value they just set, so they
// read the ref, as upstream's handlers read the `$state` itself.
function useMirroredState<T>(initial: T): [T, RefObject<T>, (next: T) => void] {
    const [value, setValue] = useState(initial);
    const ref = useRef(initial);
    const set = useCallback((next: T) => {
        ref.current = next;
        setValue(next);
    }, []);
    return [value, ref, set];
}

interface TouchHandlers {
    start: (x: number, y: number) => void;
    drag: (
        kind: "space" | "folder",
        id: string,
        fromFolderId: string | null,
    ) => void;
    move: (x: number, y: number) => void;
    end: () => void;
}

// Zami: `ontouchstart`/`ontouchmove`/`ontouchend` on a rail item, as a pan that
// activates after upstream's 300 ms drag hold, and fails if the finger moves
// first (as touchHasMoved cancels the drag timer), leaving the rail to scroll.
// Activating cancels the item's press. The ghost follows the finger on the UI
// thread; the handlers are the rail's latest (a ref), so the gesture keeps its
// config across the rail's renders.
function TouchDrag({
    handlers,
    kind,
    id,
    fromFolderId,
    ghostX,
    ghostY,
    children,
}: {
    handlers: RefObject<TouchHandlers | null>;
    kind: "space" | "folder";
    id: string;
    fromFolderId: string | null;
    ghostX: SharedValue<number>;
    ghostY: SharedValue<number>;
    children: ReactNode;
}) {
    // Zami: where the finger was last handed to JS (see onUpdate).
    const sentX = useSharedValue(0);
    const sentY = useSharedValue(0);
    const config = useMemo((): PanGestureConfig => {
        const start = (x: number, y: number) => handlers.current?.start(x, y);
        const drag = () => handlers.current?.drag(kind, id, fromFolderId);
        const move = (x: number, y: number) => handlers.current?.move(x, y);
        const end = () => handlers.current?.end();
        return {
            activateAfterLongPress: DRAG_HOLD_MS,
            onBegin: (e) => {
                "worklet";
                sentX.set(e.absoluteX);
                sentY.set(e.absoluteY);
                scheduleOnRN(start, e.absoluteX, e.absoluteY);
            },
            onActivate: (e) => {
                "worklet";
                ghostX.set(e.absoluteX);
                ghostY.set(e.absoluteY);
                scheduleOnRN(drag);
            },
            onUpdate: (e) => {
                "worklet";
                ghostX.set(e.absoluteX);
                ghostY.set(e.absoluteY);
                // Zami: the ghost follows every frame here; the drop target's
                // hit test (in JS) only needs the finger once it has moved a
                // few points, not on every frame of the drag.
                if (
                    Math.abs(e.absoluteX - sentX.get()) +
                        Math.abs(e.absoluteY - sentY.get()) <
                    TOUCH_MOVE_STEP_PX
                )
                    return;
                sentX.set(e.absoluteX);
                sentY.set(e.absoluteY);
                scheduleOnRN(move, e.absoluteX, e.absoluteY);
            },
            onFinalize: () => {
                "worklet";
                scheduleOnRN(end);
            },
        };
    }, [handlers, kind, id, fromFolderId, ghostX, ghostY, sentX, sentY]);
    const gesture = usePanGesture(config);
    return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

/** A view's on-screen box, from `anchorElement`. */
type Box = ReturnType<HTMLElement["getBoundingClientRect"]>;

function contains(r: Box | null, x: number, y: number): boolean {
    return !!r && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

async function boxOf(view: HostInstance | null): Promise<Box> {
    return (await anchorElement(view)).getBoundingClientRect();
}

// Zami: the folder color picker, as its own component holding the picker's
// state (upstream keeps it in the sidebar). Dragging in the box or on the hue
// slider sets that state on every frame, which re-rendered the whole rail and
// its dialogs per frame; now it renders the picker alone. The sidebar gets the
// color on save.
function FolderColorPicker({
    initialHex,
    onSave,
    onClose,
}: {
    initialHex: string;
    onSave: (hex: string) => void;
    onClose: () => void;
}) {
    // HSV color picker state
    const [initialHsv] = useState(() =>
        /^#[0-9a-fA-F]{6}$/.test(initialHex) ? hexToHsv(initialHex) : null,
    );
    const [cpHue, setCpHue] = useState(initialHsv?.[0] ?? 0); // 0–360
    const [cpSat, setCpSat] = useState(initialHsv?.[1] ?? 1); // 0–1
    const [cpVal, setCpVal] = useState(initialHsv?.[2] ?? 1); // 0–1
    // Zami: bind:this on the SV box and hue slider → their laid-out sizes.
    const svBoxEl = useRef({ width: 1, height: 1 });
    const hueSliderEl = useRef({ width: 1, height: 1 });

    const cpHex = hsvToHex(cpHue, cpSat, cpVal);

    function setHsvFromHex(hex: string) {
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
            const [h, s, v] = hexToHsv(hex);
            setCpHue(h);
            setCpSat(s);
            setCpVal(v);
        }
    }

    // Zami: `onmousedown` plus document mousemove/mouseup → a pan from the
    // first touch; its x/y are relative to the box, as `clientX - rect.left`.
    const startSVDrag = usePanGesture(
        useMemo((): PanGestureConfig => {
            function updateSV(x: number, y: number) {
                const rect = svBoxEl.current;
                setCpSat(Math.max(0, Math.min(1, x / rect.width)));
                setCpVal(Math.max(0, Math.min(1, 1 - y / rect.height)));
            }
            return {
                runOnJS: true,
                onBegin: (e) => updateSV(e.x, e.y),
                onUpdate: (e) => updateSV(e.x, e.y),
            };
        }, []),
    );

    const startHueDrag = usePanGesture(
        useMemo((): PanGestureConfig => {
            function updateHue(y: number) {
                const rect = hueSliderEl.current;
                setCpHue(Math.max(0, Math.min(360, (y / rect.height) * 360)));
            }
            return {
                runOnJS: true,
                onBegin: (e) => updateHue(e.y),
                onUpdate: (e) => updateHue(e.y),
            };
        }, []),
    );

    // Zami: the color picker's hex field shows what was typed until the color
    // changes, as `value={cpHex}` only writes the input when cpHex changes.
    const [hexText, setHexText] = useState(cpHex);
    const [hexFor, setHexFor] = useState(cpHex);
    if (hexFor !== cpHex) {
        setHexFor(cpHex);
        setHexText(cpHex);
    }

    return (
        // The title is a <p>, not a heading, so the dialog is named directly
        // rather than promoted to an <h2> (which would change typography).
        // The 240px width was an inline style; ModalDialog takes no `style`,
        // so it becomes the identical Tailwind arbitrary value.
        <ModalDialog
            onClose={onClose}
            label={t("spaceSidebar.folderColor")}
            panelClass="relative w-[240px] bg-discord-backgroundSecondary rounded-xl shadow-2xl p-4 flex flex-col gap-3"
            backdropClass="bg-black/50"
        >
            <Text className="text-sm font-semibold text-discord-textPrimary">
                {t("spaceSidebar.folderColor")}
            </Text>

            {/* SV box + hue slider */}
            <View className="flex-row gap-2" style={{ height: 148 }}>
                {/* Saturation/Value gradient box */}
                <GestureDetector gesture={startSVDrag}>
                    <View
                        onLayout={(e) => {
                            svBoxEl.current = e.nativeEvent.layout;
                        }}
                        className="relative flex-1 rounded-lg overflow-hidden cursor-crosshair select-none"
                        style={{
                            backgroundImage: `linear-gradient(to right, white, hsl(${cpHue}, 100%, 50%))`,
                        }}
                    >
                        {/* Black-to-transparent overlay */}
                        <View
                            className="absolute inset-0"
                            style={{
                                backgroundImage:
                                    "linear-gradient(to bottom, transparent, black)",
                            }}
                        />
                        {/* Cursor */}
                        <View
                            pointerEvents="none"
                            className="absolute w-3 h-3 rounded-full border-2 border-white shadow pointer-events-none"
                            style={{
                                left: `${cpSat * 100}%`,
                                top: `${(1 - cpVal) * 100}%`,
                                transform: [
                                    { translateX: -6 },
                                    { translateY: -6 },
                                ],
                                boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                            }}
                        />
                    </View>
                </GestureDetector>

                {/* Hue slider */}
                <GestureDetector gesture={startHueDrag}>
                    <View
                        onLayout={(e) => {
                            hueSliderEl.current = e.nativeEvent.layout;
                        }}
                        className="relative w-4 rounded-lg overflow-hidden cursor-ns-resize select-none flex-shrink-0"
                        style={{
                            backgroundImage:
                                "linear-gradient(to bottom, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
                        }}
                    >
                        {/* Cursor bar */}
                        <View
                            pointerEvents="none"
                            className="absolute start-0 end-0 h-1 pointer-events-none rounded-sm"
                            style={{
                                top: `${(cpHue / 360) * 100}%`,
                                transform: [{ translateY: -2 }],
                                boxShadow:
                                    "0 0 0 1.5px white, 0 0 0 2.5px rgba(0,0,0,0.5)",
                            }}
                        />
                    </View>
                </GestureDetector>
            </View>

            {/* Presets */}
            <View className="flex-row gap-1.5">
                {FOLDER_COLORS.map((color) => {
                    const [h, s, v] = hexToHsv(color);
                    const selected =
                        Math.abs(cpHue - h) < 2 &&
                        Math.abs(cpSat - s) < 0.05 &&
                        Math.abs(cpVal - v) < 0.05;
                    return (
                        <Pressable
                            key={color}
                            accessibilityRole="button"
                            accessibilityLabel={color}
                            accessibilityState={{ selected }}
                            onPress={() => setHsvFromHex(color)}
                            className="flex-1 h-5 rounded transition-all duration-100"
                            style={{
                                backgroundColor: color,
                                outlineColor: "white",
                                outlineStyle: "solid",
                                outlineWidth: selected ? 2 : 0,
                            }}
                        />
                    );
                })}
            </View>

            {/* Hex input */}
            <View className="flex-row items-center gap-2">
                <View
                    className="w-7 h-7 rounded flex-shrink-0"
                    style={{ backgroundColor: cpHex }}
                />
                {/* Nominated as the trap's initial focus: the first focusable
                    in DOM order is a preset swatch, which is unnamed and whose
                    inline `outline: none` would leave a keyboard user with no
                    visible focus at all. */}
                {/* Zami: not focused on open (data-autofocus): on a
                    phone that raises the keyboard over the picker,
                    whose box and swatches are the touch path.
                    `uppercase` → the text uppercased (iOS inputs
                    don't transform text). */}
                <TextInput
                    accessibilityLabel={t("spaceSidebar.folderColor")}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    className="flex-1 bg-discord-backgroundTertiary text-discord-textPrimary text-sm font-mono px-2 py-1.5 rounded outline-none border border-discord-divider focus:border-discord-accent uppercase tracking-wider"
                    value={hexText.toUpperCase()}
                    maxLength={7}
                    onChangeText={(value) => {
                        setHexText(value);
                        setHsvFromHex(value);
                    }}
                />
            </View>

            {/* Actions */}
            <View className="flex-row gap-2">
                <Pressable
                    accessibilityRole="button"
                    onPress={() => onSave(cpHex)}
                    className="flex-1 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover active:bg-discord-accentHover transition-colors"
                >
                    <Text className="text-center text-sm font-semibold text-white">
                        {t("common.save")}
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    onPress={onClose}
                    className="flex-1 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                >
                    <Text className="text-center text-sm font-semibold text-discord-textPrimary">
                        {t("common.cancel")}
                    </Text>
                </Pressable>
            </View>
        </ModalDialog>
    );
}

// Zami: a row of the "Add existing room to space" list, memoized (see the
// dialog's FlatList).
const roomKey = (room: Room) => room.roomId;
const AddRoomRow = memo(function AddRoomRow({
    room,
    onPick,
}: {
    room: Room;
    onPick: (roomId: string) => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={() => onPick(room.roomId)}
            className="w-full px-3 py-2 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors flex-row items-center gap-2"
        >
            <Avatar
                src={getRoomAvatar(room)}
                name={getRoomDisplayName(room)}
                size={24}
                rounded="none"
                class="rounded flex-shrink-0"
            />
            <Text
                numberOfLines={1}
                className="flex-1 text-sm text-discord-textSecondary hover:text-discord-textPrimary"
            >
                {getRoomDisplayName(room)}
            </Text>
        </Pressable>
    );
});

// Zami: the context menu rows' classes, which upstream repeats on each: the
// row's box, and its text.
const MENU_ITEM =
    "w-full flex-row items-center gap-2 px-3 py-1.5 hover:bg-discord-accent active:bg-discord-accent";
const MENU_TEXT = "text-sm text-discord-textPrimary hover:text-white";
const MENU_DANGER = "text-sm text-discord-danger hover:text-white";

export default function SpaceSidebar({
    onHomeClick,
    onOpenSpaceSettings,
}: Props) {
    const viewport = useWindowDimensions();
    const { theme } = useUniwind();

    const activeSpaceId = useRune(() => roomsState.activeSpaceId);
    const spaceDrillParentId = useRune(() => roomsState.spaceDrillParentId);
    // Live SDK objects (m.space.child state, space names and avatars) mutate in
    // place; roomsTick bumps with them.
    const roomsTick = useRune(() => roomsState.roomsTick);
    const spaces = useRune(() => roomsState.spaces);
    const spaceLayout = useRune(() => roomsState.spaceLayout);

    const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
    const [expandedFolders, setExpandedFolders] = useState(new Set<string>());
    // Zami: the picker's own state is FolderColorPicker's; this is the folder
    // it colors and the color it opened with.
    const [colorPicker, setColorPicker] = useState<{
        folderId: string;
        initialHex: string;
    } | null>(null);

    // Drag state
    const [dragState, dragStateRef, setDragState] =
        useMirroredState<DragState | null>(null);
    const [dropTarget, dropTargetRef, setDropTargetValue] =
        useMirroredState<DropTarget | null>(null);
    // Zami: a touch move sets the same target again and again; only a change
    // re-renders.
    function setDropTarget(next: DropTarget | null) {
        const prev = dropTargetRef.current;
        if (prev?.id === next?.id && prev?.position === next?.position) return;
        setDropTargetValue(next);
    }

    // Sub-spaces of a joined space render as categories in the room list, so
    // only top-level spaces get a slot on the rail.
    const railSpaces = useMemo(() => {
        void roomsTick; // m.space.child state mutates in place
        const nested = getNestedSpaceIds();
        return spaces.filter((s) => !nested.has(s.roomId));
    }, [roomsTick, spaces]);

    const rootItems = useMemo((): RootItem[] => {
        void roomsTick; // space names/avatars mutate in place
        const { order, folders } = spaceLayout;
        const spacesInFolders = new Set(
            Object.values(folders).flatMap((f) => f.spaceIds),
        );

        if (!order.length) {
            return railSpaces.map((s) => ({
                kind: "space",
                id: s.roomId,
                space: s,
            }));
        }

        const result: RootItem[] = [];
        for (const id of order) {
            if (folders[id]) {
                const folderSpaces = folders[id].spaceIds
                    .map((sid) => railSpaces.find((s) => s.roomId === sid))
                    .filter((s): s is Room => !!s);
                result.push({ kind: "folder", id, spaces: folderSpaces });
            } else {
                const space = railSpaces.find((s) => s.roomId === id);
                if (space) result.push({ kind: "space", id, space });
            }
        }
        for (const space of railSpaces) {
            if (
                !order.includes(space.roomId) &&
                !spacesInFolders.has(space.roomId)
            ) {
                result.push({ kind: "space", id: space.roomId, space });
            }
        }
        return result;
    }, [roomsTick, spaceLayout, railSpaces]);

    // Zami: the keyboard space navigation's order, upstream's `data-nav-space`
    // buttons: Home, then the rail's spaces, with an expanded folder's own.
    const navSpaces = useRef({ rootItems, expandedFolders });
    useLayoutEffect(() => {
        navSpaces.current = { rootItems, expandedFolders };
    }, [rootItems, expandedFolders]);
    useEffect(
        () =>
            setNavSpaces(() => {
                const { rootItems, expandedFolders } = navSpaces.current;
                return [
                    "",
                    ...rootItems.flatMap((item) =>
                        item.kind === "space"
                            ? [item.space.roomId]
                            : expandedFolders.has(item.id)
                              ? item.spaces.map((space) => space.roomId)
                              : [],
                    ),
                ];
            }),
        [],
    );

    const spaceFolderMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const [folderId, folder] of Object.entries(spaceLayout.folders)) {
            for (const spaceId of folder.spaceIds) {
                map.set(spaceId, folderId);
            }
        }
        return map;
    }, [spaceLayout]);

    function getLayout(): SpaceLayout {
        // Include root items that render but aren't persisted in `order` yet
        // (e.g. newly joined spaces), so indexOf never returns -1
        const order = [...roomsState.spaceLayout.order];
        for (const item of rootItems) {
            if (!order.includes(item.id)) order.push(item.id);
        }
        return {
            order,
            folders: Object.fromEntries(
                Object.entries(roomsState.spaceLayout.folders).map(([k, v]) => [
                    k,
                    { ...v, spaceIds: [...v.spaceIds] },
                ]),
            ),
        };
    }

    function saveLayout(layout: SpaceLayout) {
        // Dissolve any empty folders
        for (const [folderId, folder] of Object.entries(layout.folders)) {
            if (folder.spaceIds.length === 0) {
                layout.order = layout.order.filter((id) => id !== folderId);
                delete layout.folders[folderId];
            }
        }
        roomsState.spaceLayout = layout;
        setSpaceLayout(layout).catch((err) =>
            console.error("[setSpaceLayout] failed:", err),
        );
    }

    function isDraggingSpace(): boolean {
        const dragState = dragStateRef.current;
        if (!dragState) return false;
        if (dragState.fromFolderId !== null) return true;
        return !roomsState.spaceLayout.folders[dragState.id];
    }

    // Zami: not ported: HTML5 drag and drop (`draggable`, ondragstart,
    // ondragover, ondrop and calcPos), which needs a mouse. The touch drag
    // below reorders the rail.

    // Zami: `bind:this={navEl}`, `data-drag-id`/`data-drag-kind`,
    // `data-root-id` and `data-folder-inner`: the views register here and are
    // measured on screen when a drag starts (measureDragTargets), in place of
    // elementFromPoint(), closest() and getBoundingClientRect(). The rail
    // doesn't scroll during a drag, so the boxes hold until it ends.
    const navEl = useRef<ScrollViewInstance>(null);
    const dragEls = useRef(
        new Map<string, { view: HostInstance; kind: "space" | "folder" }>(),
    );
    const rootEls = useRef(new Map<string, HostInstance>());
    const folderInnerEls = useRef(new Map<string, HostInstance>());
    const dragBoxes = useRef({
        drag: new Map<string, { rect: Box; kind: "space" | "folder" }>(),
        root: new Map<string, Box>(),
        folderInner: [] as Box[],
        nav: null as Box | null,
    });

    function registerIn<V>(map: Map<string, V>, id: string, value: V) {
        map.set(id, value);
        return () => {
            if (map.get(id) === value) map.delete(id);
        };
    }

    async function measureDragTargets() {
        const [drag, root, folderInner, nav] = await Promise.all([
            Promise.all(
                [...dragEls.current].map(
                    async ([id, { view, kind }]) =>
                        [id, { rect: await boxOf(view), kind }] as const,
                ),
            ),
            Promise.all(
                [...rootEls.current].map(
                    async ([id, view]) => [id, await boxOf(view)] as const,
                ),
            ),
            Promise.all([...folderInnerEls.current.values()].map(boxOf)),
            boxOf(navEl.current),
        ]);
        dragBoxes.current = {
            drag: new Map(drag),
            root: new Map(root),
            folderInner,
            nav,
        };
    }

    // Drop target for a pointer that isn't over an item (gaps between items,
    // empty space below the last one): nearest root slot by vertical position
    function rootTargetAt(clientY: number): DropTarget | null {
        const dragState = dragStateRef.current;
        if (!navEl.current || !dragState) return null;
        const els = rootItems
            .map((item) => item.id)
            .filter((id) => id !== dragState.id)
            .flatMap((rootId) => {
                const r = dragBoxes.current.root.get(rootId);
                return r ? [{ rootId, r }] : [];
            });
        if (!els.length) return null;
        for (const { rootId, r } of els) {
            if (clientY < r.top + r.height / 2)
                return { id: rootId, position: "before" };
        }
        return { id: els[els.length - 1].rootId, position: "after" };
    }

    function onDragEnd() {
        setDragState(null);
        setDropTarget(null);
    }

    function performDrop() {
        const dragState = dragStateRef.current;
        const dropTarget = dropTargetRef.current;
        if (!dragState) {
            onDragEnd();
            return;
        }

        if (!dropTarget) {
            // Dropped in empty space — move folder-space to root end
            if (dragState.fromFolderId !== null) {
                const layout = getLayout();
                layout.folders[dragState.fromFolderId].spaceIds =
                    layout.folders[dragState.fromFolderId].spaceIds.filter(
                        (id) => id !== dragState.id,
                    );
                layout.order.push(dragState.id);
                saveLayout(layout);
            }
            onDragEnd();
            return;
        }

        const { id: fromId, fromFolderId } = dragState;
        const { id: toId, position } = dropTarget;
        if (fromId === toId) {
            onDragEnd();
            return;
        }

        const layout = getLayout();
        const toFolderId = spaceFolderMap.get(toId) ?? null;
        const toIsFolder = !!layout.folders[toId];

        if (fromFolderId !== null) {
            layout.folders[fromFolderId].spaceIds = layout.folders[
                fromFolderId
            ].spaceIds.filter((id) => id !== fromId);
        } else {
            layout.order = layout.order.filter((id) => id !== fromId);
        }

        if (position === "into") {
            if (toIsFolder) {
                if (!layout.folders[toId].spaceIds.includes(fromId))
                    layout.folders[toId].spaceIds.push(fromId);
                setExpandedFolders((prev) => new Set([...prev, toId]));
            } else {
                const toIndex = layout.order.indexOf(toId);
                layout.order.splice(toIndex, 1);
                const folderId = `folder_${Date.now()}`;
                layout.order.splice(toIndex, 0, folderId);
                layout.folders[folderId] = {
                    name: "",
                    spaceIds: [toId, fromId],
                };
                setExpandedFolders((prev) => new Set([...prev, folderId]));
            }
        } else if (toFolderId !== null) {
            const folderSpaces = layout.folders[toFolderId].spaceIds.filter(
                (id) => id !== fromId,
            );
            const toIndex = folderSpaces.indexOf(toId);
            folderSpaces.splice(
                position === "before" ? toIndex : toIndex + 1,
                0,
                fromId,
            );
            layout.folders[toFolderId].spaceIds = folderSpaces;
        } else {
            const toIndex = layout.order.indexOf(toId);
            layout.order.splice(
                position === "before" ? toIndex : toIndex + 1,
                0,
                fromId,
            );
        }

        saveLayout(layout);
        onDragEnd();
    }

    // --- Context menu ---

    // Zami: there's no right-click (oncontextmenu) here, so the long press is
    // the only way in and passes `touch: true` (a MouseEvent sets it false).
    function openSpaceContextMenu(
        e: { clientX: number; clientY: number; touch: boolean },
        spaceId: string,
        folderId: string | null = null,
    ) {
        // Claim first — a same-id handover runs the outgoing close.
        openModal("space-menu", () => setContextMenu(null));
        setContextMenu({
            kind: "space",
            spaceId,
            folderId,
            x: e.clientX,
            y: e.clientY,
            touch: e.touch,
        });
    }

    function openFolderContextMenu(
        e: { clientX: number; clientY: number; touch: boolean },
        folderId: string,
    ) {
        // Claim first — a same-id handover runs the outgoing close.
        openModal("space-menu", () => setContextMenu(null));
        setContextMenu({
            kind: "folder",
            folderId,
            x: e.clientX,
            y: e.clientY,
            touch: e.touch,
        });
    }

    // --- Actions ---

    async function handleSetSpaceNotification(
        spaceId: string,
        setting: RoomNotificationSetting,
    ) {
        closeModal();
        // Apply to the space room itself and all its rooms recursively.
        const allRoomIds = collectSpaceAndDescendantRoomIds(spaceId, {
            roomsInSpace: (id) => getRoomsInSpace(id).map((r) => r.roomId),
            childSpaceIds: (id) =>
                getSpaceChildIds(id).filter(
                    (cid) => getRoom(cid)?.isSpaceRoom() ?? false,
                ),
        });
        await mapWithConcurrency(allRoomIds, 4, (id) =>
            setRoomNotificationSetting(id, setting),
        );
    }

    // Two-click confirmation for the destructive Leave Space action.
    const [leaveConfirmId, setLeaveConfirmId] = useState<string | null>(null);
    // reset whenever the menu opens/closes/changes
    const [leaveConfirmFor, setLeaveConfirmFor] = useState(contextMenu);
    if (leaveConfirmFor !== contextMenu) {
        setLeaveConfirmFor(contextMenu);
        setLeaveConfirmId(null);
    }

    async function handleLeaveSpace(spaceId: string) {
        closeModal();
        try {
            await leaveRoom(spaceId);
            if (roomsState.activeSpaceId === spaceId) setActiveSpace(null);
        } catch (err) {
            console.error("Failed to leave space:", err);
        }
    }

    // ── Create room / Add room modals ─────────────────────────────────────────

    const [createRoomModal, setCreateRoomModal] = useState<{
        spaceId: string;
    } | null>(null);
    const [addRoomModal, setAddRoomModal] = useState<{
        spaceId: string;
    } | null>(null);
    const [modalInput1, setModalInput1] = useState("");
    const [modalInput2, setModalInput2] = useState("");
    const [modalLoading, setModalLoading] = useState(false);
    const [modalError, setModalError] = useState("");
    const [modalVideoRoom, setModalVideoRoom] = useState(false);

    function openCreateRoom(spaceId: string) {
        // Claim first — a same-id handover runs the outgoing close.
        openModal("create-room", () => setCreateRoomModal(null));
        setModalInput1("");
        setModalInput2("");
        setModalError("");
        setModalVideoRoom(false);
        setCreateRoomModal({ spaceId });
    }

    function openAddRoom(spaceId: string) {
        // Claim first — a same-id handover runs the outgoing close.
        openModal("add-room", () => setAddRoomModal(null));
        setAddRoomModal({ spaceId });
    }

    function handleOpenSpaceSettings(spaceId: string) {
        const room = getRoom(spaceId);
        closeModal();
        if (room) onOpenSpaceSettings?.(room);
    }
    function handleInviteToSpace(spaceId: string) {
        closeModal();
        openInviteDialog(spaceId);
    }
    async function handleCopySpaceLink(spaceId: string) {
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(getRoomShareLink(spaceId));
        } catch {
            /* clipboard denied */
        }
        closeModal();
    }
    async function handleMarkSpaceRead(spaceId: string) {
        closeModal();
        await markSpaceAsRead(spaceId);
    }

    const [exploreOpen, setExploreOpen] = useState(false);

    function openExplore() {
        // Claim first — a same-id handover runs the outgoing close.
        openModal("room-directory", () => setExploreOpen(false));
        setExploreOpen(true);
    }

    // Space-rail "+" flyout: a compact Create-space / Join chooser (QuickActions
    // in `compact` mode). The chooser lives on the rail so creating a space is
    // reachable regardless of which space is active — the room-header "+" only
    // offered it on Home. The flyout stays MOUNTED (toggled by a `hidden` class,
    // not `{#if}`) so QuickActions' Portaled form modal survives the flyout
    // closing when picking an action supersedes the "space-add-menu" slot.
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [addMenuX, setAddMenuX] = useState(0);
    const [addMenuY, setAddMenuY] = useState(0);
    const addMenuButton = useRef<HostInstance>(null);

    async function openAddMenu() {
        // Zami: the button's on-screen box, measured.
        const r = (
            await anchorElement(addMenuButton.current)
        ).getBoundingClientRect();
        setAddMenuX(r.right + 8);
        // Anchor beside the button; clamp so the two-item menu never runs off
        // the bottom of a short viewport.
        setAddMenuY(Math.min(r.top, viewport.height - 120));
        // Claim first — a same-id handover runs the outgoing close.
        openModal("space-add-menu", () => setAddMenuOpen(false));
        setAddMenuOpen(true);
    }

    // A created room whose follow-up write failed (or timed out unconfirmed):
    // the room is real, so we open it and offer a retry of ONLY the failed
    // step. Reporting a failure here would send the user back to the form to
    // create a duplicate (TX-01).
    function surfaceFollowUp(followUp: RoomFollowUp) {
        // Deliberately silent on success — this store is an ERROR surface (red,
        // role="alert"), and a landed follow-up is already visible without it:
        // the room appears in the space, the DM moves into the DM list.
        if (followUp.status === "none" || followUp.status === "ok") return;
        const task = followUp.task;
        showErrorToast(followUp.message, {
            label: t("common.retry"),
            // retryRoomFollowUp is bounded, so a retry into a wedged sync comes
            // back as its own "unconfirmed" toast instead of hanging forever
            // with the affordance already expired.
            run: () => void retryRoomFollowUp(task).then(surfaceFollowUp),
        });
    }

    async function submitCreateRoom() {
        if (!createRoomModal) return;
        setModalError("");
        setModalLoading(true);
        try {
            const { roomId, followUp } = await createRoomFn(
                modalInput1.trim(),
                modalInput2.trim(),
                createRoomModal.spaceId,
                false,
                modalVideoRoom,
            );
            surfaceFollowUp(followUp);
            setActiveRoom(roomId);
            closeModal();
        } catch (e: any) {
            setModalError(
                e?.data?.error ??
                    e?.message ??
                    t("spaceSidebar.somethingWentWrong"),
            );
        } finally {
            setModalLoading(false);
        }
    }

    async function submitAddRoom(roomId: string) {
        if (!addRoomModal) return;
        await addRoomToSpace(addRoomModal.spaceId, roomId);
        closeModal();
    }

    function getRoomsNotInSpace(spaceId: string) {
        const childIds = new Set(getSpaceChildIds(spaceId));
        return [...getOrphanRooms(), ...getDirectRooms()].filter(
            (r) => !childIds.has(r.roomId) && !r.isSpaceRoom(),
        );
    }

    function handleNewFolder(spaceId: string) {
        closeModal();
        const layout = getLayout();
        for (const fid in layout.folders) {
            layout.folders[fid].spaceIds = layout.folders[fid].spaceIds.filter(
                (id) => id !== spaceId,
            );
        }
        const folderId = `folder_${Date.now()}`;
        const spaceIndex = layout.order.indexOf(spaceId);
        layout.order = layout.order.filter((id) => id !== spaceId);
        layout.order.splice(
            spaceIndex === -1 ? layout.order.length : spaceIndex,
            0,
            folderId,
        );
        layout.folders[folderId] = { name: "", spaceIds: [spaceId] };
        saveLayout(layout);
        setExpandedFolders((prev) => new Set([...prev, folderId]));
    }

    function handleRemoveFromFolder(spaceId: string, folderId: string) {
        closeModal();
        const layout = getLayout();
        layout.folders[folderId].spaceIds = layout.folders[
            folderId
        ].spaceIds.filter((id) => id !== spaceId);
        const folderIndex = layout.order.indexOf(folderId);
        layout.order.splice(folderIndex + 1, 0, spaceId);
        saveLayout(layout);
    }

    function openColorPicker(folderId: string) {
        // Claim first — a same-id handover runs the outgoing close.
        openModal("color-picker", () => setColorPicker(null));
        const current =
            roomsState.spaceLayout.folders[folderId]?.color ?? FOLDER_COLORS[0];
        setColorPicker({ folderId, initialHex: current });
    }

    function commitColor(cpHex: string) {
        if (!colorPicker) return;
        const layout = getLayout();
        if (!layout.folders[colorPicker.folderId]) return;
        layout.folders[colorPicker.folderId].color = cpHex;
        saveLayout(layout);
        closeModal();
    }

    function handleDissolveFolder(folderId: string) {
        closeModal();
        const layout = getLayout();
        const spaceIds = layout.folders[folderId]?.spaceIds ?? [];
        const folderIndex = layout.order.indexOf(folderId);
        layout.order = layout.order.filter((id) => id !== folderId);
        layout.order.splice(folderIndex, 0, ...spaceIds);
        delete layout.folders[folderId];
        saveLayout(layout);
    }

    // Zami: the `positionMenu` action, as a measuring pass: the menu lays out
    // hidden at the top-left, and its size places it. A menu reopened on a NEW
    // target (new x/y) measures again, so it can't strand at the old target's
    // coordinates, and a prior clamp doesn't leak.
    const [placedMenu, setPlacedMenu] = useState<ViewStyle | null>(null);
    const [placedFor, setPlacedFor] = useState(contextMenu);
    if (placedFor !== contextMenu) {
        setPlacedFor(contextMenu);
        setPlacedMenu(null);
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

    function toggleFolder(folderId: string) {
        const next = new Set(expandedFolders);
        if (next.has(folderId)) next.delete(folderId);
        else next.add(folderId);
        setExpandedFolders(next);
    }

    // --- Touch drag & long-press ---

    const [touchDragActive, touchDragActiveRef, setTouchDragActive] =
        useMirroredState(false);
    const [touchGhostId, setTouchGhostId] = useState<string | null>(null);
    // Zami: the ghost's position follows the finger on the UI thread
    // (TouchDrag sets these).
    const touchGhostX = useSharedValue(0);
    const touchGhostY = useSharedValue(0);

    // Zami: the 300 ms drag timer is TouchDrag's `activateAfterLongPress`;
    // the menu timer below covers the rest of the 600 ms.
    const ctxTouchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchStart = useRef({ x: 0, y: 0, hasMoved: false });

    function onItemTouchStart(x: number, y: number) {
        touchStart.current = { x, y, hasMoved: false };
    }

    function openItemContextMenu(
        kind: "space" | "folder",
        id: string,
        fromFolderId: string | null,
        x: number,
        y: number,
    ) {
        const e = { clientX: x, clientY: y, touch: true };
        if (kind === "space") openSpaceContextMenu(e, id, fromFolderId);
        else openFolderContextMenu(e, id);
    }

    // 300ms → start drag
    function onItemDragStart(
        kind: "space" | "folder",
        id: string,
        fromFolderId: string | null,
    ) {
        if (touchStart.current.hasMoved) return;
        setTouchDragActive(true);
        setTouchGhostId(id);
        setDragState({ id, fromFolderId });
        // Zami: navigator.vibrate(30) → a light haptic.
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        void measureDragTargets();

        // 600ms → context menu (cancels drag if it started)
        ctxTouchTimer.current = setTimeout(() => {
            ctxTouchTimer.current = null;
            if (touchStart.current.hasMoved) return;
            if (touchDragActiveRef.current) {
                setTouchDragActive(false);
                setTouchGhostId(null);
                setDragState(null);
                setDropTarget(null);
            }
            // Zami: navigator.vibrate(50) → a medium haptic.
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            openItemContextMenu(
                kind,
                id,
                fromFolderId,
                touchStart.current.x,
                touchStart.current.y,
            );
        }, CONTEXT_MENU_HOLD_MS - DRAG_HOLD_MS);
    }

    function onItemTouchMove(x: number, y: number) {
        const dx = x - touchStart.current.x;
        const dy = y - touchStart.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 8) {
            touchStart.current.hasMoved = true;
            if (ctxTouchTimer.current) {
                clearTimeout(ctxTouchTimer.current);
                ctxTouchTimer.current = null;
            }
        }

        if (!touchDragActiveRef.current) return;
        // Zami: the rail doesn't scroll while dragging (`scrollEnabled`), and
        // the ghost follows the finger in TouchDrag.

        // Find drop target under finger
        const boxes = dragBoxes.current;
        const btn = [...boxes.drag].find(([, el]) => contains(el.rect, x, y));
        if (btn) {
            const [targetId, { rect, kind: targetKind }] = btn;
            if (targetId && targetId !== dragStateRef.current?.id) {
                const rel = (y - rect.top) / rect.height;
                let position: "before" | "after" | "into";
                if (
                    isDraggingSpace() &&
                    !spaceFolderMap.has(targetId) &&
                    (targetKind === "space" || targetKind === "folder")
                ) {
                    position =
                        rel < 0.3 ? "before" : rel > 0.7 ? "after" : "into";
                } else {
                    position = rel < 0.5 ? "before" : "after";
                }
                setDropTarget({ id: targetId, position });
            }
        } else if (contains(boxes.nav, x, y)) {
            if (!boxes.folderInner.some((r) => contains(r, x, y)))
                setDropTarget(rootTargetAt(y));
        } else {
            setDropTarget(null);
        }
    }

    function onItemTouchEnd() {
        if (ctxTouchTimer.current) {
            clearTimeout(ctxTouchTimer.current);
            ctxTouchTimer.current = null;
        }
        if (!touchDragActiveRef.current) return;
        setTouchDragActive(false);
        setTouchGhostId(null);
        performDrop();
    }

    // Zami: the latest handlers, for TouchDrag.
    const touchHandlers = useRef<TouchHandlers>(null);
    useLayoutEffect(() => {
        touchHandlers.current = {
            start: onItemTouchStart,
            drag: onItemDragStart,
            move: onItemTouchMove,
            end: onItemTouchEnd,
        };
    });

    // `left`/`top` as a translation from the corner, so the ghost moves without
    // a layout pass.
    const ghostStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: touchGhostX.get() - 24 },
            { translateY: touchGhostY.get() - 24 },
            { scale: 1.15 },
        ],
    }));

    const touchProps = {
        handlers: touchHandlers,
        ghostX: touchGhostX,
        ghostY: touchGhostY,
    };

    const cm = contextMenu;
    const menuContent = () => {
        if (cm === null) return null;
        if (cm.kind === "folder") return folderMenuContent(cm.folderId);
        const currentNotif = getRoomNotificationSetting(cm.spaceId);
        return (
            <>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => handleOpenSpaceSettings(cm.spaceId)}
                    className={MENU_ITEM}
                >
                    <Text className={MENU_TEXT}>
                        {t("spaceSidebar.spaceSettings")}
                    </Text>
                </Pressable>
                {/* Zami: the rail re-renders on roomsTick, which upstream reads here. */}
                {canInviteToRoom(cm.spaceId) && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => handleInviteToSpace(cm.spaceId)}
                        className={MENU_ITEM}
                    >
                        <Text className={MENU_TEXT}>
                            {t("common.invitePeople")}
                        </Text>
                    </Pressable>
                )}
                <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleCopySpaceLink(cm.spaceId)}
                    className={MENU_ITEM}
                >
                    <Text className={MENU_TEXT}>
                        {t("spaceSidebar.copySpaceLink")}
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleMarkSpaceRead(cm.spaceId)}
                    className={MENU_ITEM}
                >
                    <Text className={MENU_TEXT}>
                        {t("spaceSidebar.markAsRead")}
                    </Text>
                </Pressable>
                <View className="w-full h-px bg-discord-divider my-1" />
                {/* px-3 matches this menu's buttons; twin of RoomList's context menu. */}
                <Text className="px-3 py-1 text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                    {t("common.notifications")}
                </Text>
                {(
                    [
                        ["default", "Default"],
                        ["all", "All Messages"],
                        ["mentions", "Mentions Only"],
                        ["mute", "Mute"],
                    ] as const
                ).map(([val, label]) => (
                    <Pressable
                        key={val}
                        accessibilityRole="button"
                        onPress={() =>
                            void handleSetSpaceNotification(
                                cm.spaceId,
                                val as RoomNotificationSetting,
                            )
                        }
                        accessibilityState={{
                            selected: currentNotif === val,
                        }}
                        className={MENU_ITEM}
                    >
                        <View className="w-3 flex-row items-center justify-center">
                            {currentNotif === val && (
                                <FilledCircle
                                    size={8}
                                    className="text-discord-textPrimary"
                                />
                            )}
                        </View>
                        <Text className={MENU_TEXT}>{label}</Text>
                    </Pressable>
                ))}
                {canAddRoomToSpace(cm.spaceId) && (
                    <>
                        <View className="w-full h-px bg-discord-divider my-1" />
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => openCreateRoom(cm.spaceId)}
                            className={MENU_ITEM}
                        >
                            <Text className={MENU_TEXT}>
                                {t("spaceSidebar.createRoom")}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => openAddRoom(cm.spaceId)}
                            className={MENU_ITEM}
                        >
                            <Text className={MENU_TEXT}>
                                {t("spaceSidebar.addExistingRoom")}
                            </Text>
                        </Pressable>
                    </>
                )}
                <View className="w-full h-px bg-discord-divider my-1" />
                {cm.folderId ? (
                    <>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                                handleRemoveFromFolder(cm.spaceId, cm.folderId!)
                            }
                            className={MENU_ITEM}
                        >
                            <Text className={MENU_TEXT}>
                                {t("spaceSidebar.removeFromFolder")}
                            </Text>
                        </Pressable>
                        <View className="w-full h-px bg-discord-divider my-1" />
                    </>
                ) : (
                    <>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => handleNewFolder(cm.spaceId)}
                            className={MENU_ITEM}
                        >
                            <Text className={MENU_TEXT}>
                                {t("spaceSidebar.newFolder")}
                            </Text>
                        </Pressable>
                        <View className="w-full h-px bg-discord-divider my-1" />
                    </>
                )}
                {leaveConfirmId === cm.spaceId ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void handleLeaveSpace(cm.spaceId)}
                        className="w-full flex-row items-center gap-2 px-3 py-1.5 bg-discord-danger"
                    >
                        <Text className="text-sm text-white font-medium">
                            {isLastJoinedMember(cm.spaceId)
                                ? t("spaceSidebar.clickAgainToLeaveLastMember")
                                : t("spaceSidebar.clickAgainToLeave")}
                        </Text>
                    </Pressable>
                ) : (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => setLeaveConfirmId(cm.spaceId)}
                        className="w-full flex-row items-center gap-2 px-3 py-1.5 hover:bg-discord-danger active:bg-discord-danger"
                    >
                        <Text className={MENU_DANGER}>
                            {t("spaceSidebar.leaveSpace")}
                        </Text>
                    </Pressable>
                )}
            </>
        );
    };
    const folderMenuContent = (folderId: string) => (
        <>
            <Pressable
                accessibilityRole="button"
                onPress={() => openColorPicker(folderId)}
                className={MENU_ITEM}
            >
                <Text className={MENU_TEXT}>{t("spaceSidebar.setColor")}</Text>
            </Pressable>
            <View className="w-full h-px bg-discord-divider my-1" />
            <Pressable
                accessibilityRole="button"
                onPress={() => handleDissolveFolder(folderId)}
                className="w-full flex-row items-center gap-2 px-3 py-1.5 hover:bg-discord-danger active:bg-discord-danger"
            >
                <Text className={MENU_DANGER}>
                    {t("spaceSidebar.dissolveFolder")}
                </Text>
            </Pressable>
        </>
    );

    const menuClass =
        "absolute z-50 bg-discord-backgroundTertiary border border-discord-divider rounded-lg shadow-xl min-w-40";

    // Zami: once per opening (and per change of the room list), not on every
    // render of the rail while the dialog is open: it walks every Home room
    // and DM.
    const addRoomCandidates = useMemo(() => {
        void roomsTick;
        return addRoomModal ? getRoomsNotInSpace(addRoomModal.spaceId) : [];
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- getRoomsNotInSpace reads no props or state.
    }, [addRoomModal, roomsTick]);
    const pickRoomToAdd = useCallback(
        (roomId: string) => void submitAddRoom(roomId),
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- submitAddRoom reads addRoomModal.
        [addRoomModal],
    );

    const ghostSpace = touchGhostId
        ? spaces.find((s) => s.roomId === touchGhostId)
        : undefined;

    // Zami: the root items' markup, as functions in the order upstream's
    // `{#each rootItems}` has it (a root space, a folder, a space in a folder),
    // so it isn't nested past reading.
    function renderRootSpace(item: Extract<RootItem, { kind: "space" }>) {
        const isActive =
            activeSpaceId === item.space.roomId ||
            spaceDrillParentId === item.space.roomId;
        const avatarSrc = getRoomAvatar(item.space);
        const isMergeTarget =
            dropTarget?.id === item.id && dropTarget.position === "into";
        return (
            <TouchDrag
                key={item.id}
                {...touchProps}
                kind="space"
                id={item.space.roomId}
                fromFolderId={null}
            >
                <Pressable
                    ref={(view) => {
                        if (!view) return;
                        const unDrag = registerIn(
                            dragEls.current,
                            item.space.roomId,
                            { view, kind: "space" as const },
                        );
                        const unRoot = registerIn(
                            rootEls.current,
                            item.id,
                            view,
                        );
                        return () => {
                            unDrag();
                            unRoot();
                        };
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={item.space.name || item.space.roomId}
                    accessibilityState={{ selected: isActive }}
                    onPress={() =>
                        roomsState.activeSpaceId === item.space.roomId &&
                        roomsState.spaceDrillParentId === null
                            ? roomsState.showSpaceHome
                                ? restoreLastRoom()
                                : showSpaceHome()
                            : setActiveSpace(item.space.roomId)
                    }
                    className={`group relative w-12 h-12 flex-row items-center justify-center transition-all duration-200 flex-shrink-0 ${
                        dragState?.id === item.id ? "opacity-40" : ""
                    } ${isMergeTarget ? "ring-2 ring-discord-accent rounded-xl" : ""}`}
                >
                    <Avatar
                        src={avatarSrc}
                        name={item.space.name || "?"}
                        size={48}
                        rounded="none"
                        class={`${
                            isActive
                                ? "rounded-xl"
                                : isMergeTarget
                                  ? "rounded-xl"
                                  : "rounded-2xl group-hover:rounded-xl"
                        } transition-all duration-200`}
                    />
                    <WithNotifs
                        read={() => getSpaceNotifs(item.space.roomId)}
                        deps={[item.space.roomId]}
                    >
                        {(spaceNotifs) =>
                            isActive ? (
                                <View className="absolute start-0 top-1/2 -translate-y-1/2 -translate-x-3 mirror:translate-x-3 w-1 h-8 bg-discord-textPrimary rounded-e-full" />
                            ) : spaceNotifs.unread ? (
                                <View
                                    pointerEvents="none"
                                    className={`absolute start-0 top-1/2 -translate-y-1/2 -translate-x-3 mirror:translate-x-3 w-1 rounded-e-full pointer-events-none ${
                                        spaceNotifs.loud ||
                                        spaceNotifs.highlight
                                            ? "h-4 bg-discord-danger"
                                            : "h-2 bg-discord-textPrimary"
                                    }`}
                                />
                            ) : (
                                <View className="absolute start-0 top-1/2 -translate-y-1/2 -translate-x-3 mirror:translate-x-3 w-1 h-2 bg-discord-textPrimary rounded-e-full opacity-0 group-hover:opacity-100 group-hover:h-5 transition-all duration-200" />
                            )
                        }
                    </WithNotifs>
                    {dropTarget?.id === item.id &&
                        dropTarget.position !== "into" && (
                            <View
                                pointerEvents="none"
                                className={`absolute left-1/2 -translate-x-1/2 w-10 h-0.5 bg-discord-accent rounded-full pointer-events-none ${
                                    dropTarget.position === "before"
                                        ? "-top-[5px]"
                                        : "-bottom-[5px]"
                                }`}
                            />
                        )}
                </Pressable>
            </TouchDrag>
        );
    }

    function renderFolder(item: Extract<RootItem, { kind: "folder" }>) {
        const isExpanded = expandedFolders.has(item.id);
        const folderHasActive = item.spaces.some(
            (s) => s.roomId === activeSpaceId,
        );
        const folderColor = spaceLayout.folders[item.id]?.color;
        const isIntoTarget =
            dropTarget?.id === item.id && dropTarget.position === "into";
        // Zami: the folder icon's `display: grid` (up to 2×2 cells, 2px gaps,
        // 6px padding in its 44px box) as wrapped rows of sized cells. Each
        // avatar fills its cell, as `w-full h-full` does on the web.
        const cols = Math.min(item.spaces.length, 2);
        const rows = item.spaces.length > 2 ? 2 : 1;
        const cellWidth = (44 - 12 - (cols - 1) * 2) / cols;
        const cellHeight = (44 - 12 - (rows - 1) * 2) / rows;
        return (
            <View
                key={item.id}
                ref={(view) =>
                    view
                        ? registerIn(rootEls.current, item.id, view)
                        : undefined
                }
                className={`relative flex flex-col items-center gap-1 flex-shrink-0 ${
                    dragState?.id === item.id ? "opacity-40" : ""
                }`}
            >
                {dropTarget?.id === item.id &&
                    dropTarget.position !== "into" && (
                        <View
                            pointerEvents="none"
                            className={`absolute left-1/2 -translate-x-1/2 w-10 h-0.5 bg-discord-accent rounded-full pointer-events-none ${
                                dropTarget.position === "before"
                                    ? "-top-[5px]"
                                    : "-bottom-[5px]"
                            }`}
                        />
                    )}
                <TouchDrag
                    {...touchProps}
                    kind="folder"
                    id={item.id}
                    fromFolderId={null}
                >
                    <Pressable
                        ref={(view) =>
                            view
                                ? registerIn(dragEls.current, item.id, {
                                      view,
                                      kind: "folder" as const,
                                  })
                                : undefined
                        }
                        accessibilityRole="button"
                        accessibilityState={{ expanded: isExpanded }}
                        accessibilityLabel={item.spaces
                            .map((s) => s.name || s.roomId)
                            .join(", ")}
                        onPress={() => toggleFolder(item.id)}
                        className={`group relative w-12 h-12 flex-row items-center justify-center flex-shrink-0 ${
                            isIntoTarget
                                ? "ring-2 ring-discord-accent rounded-xl"
                                : ""
                        }`}
                    >
                        <View
                            className={`w-11 h-11 ${
                                isExpanded || isIntoTarget
                                    ? "rounded-xl"
                                    : "rounded-2xl"
                            } group-hover:rounded-xl overflow-hidden transition-all duration-200 flex-row flex-wrap ${
                                folderColor
                                    ? ""
                                    : "bg-discord-backgroundSecondary"
                            }`}
                            style={{
                                gap: 2,
                                padding: 6,
                                backgroundColor: folderColor,
                            }}
                        >
                            {item.spaces.slice(0, 4).map((space) => (
                                <View
                                    key={space.roomId}
                                    className="rounded-sm overflow-hidden items-center justify-center"
                                    style={{
                                        width: cellWidth,
                                        height: cellHeight,
                                    }}
                                >
                                    <Avatar
                                        src={getRoomAvatar(space)}
                                        name={space.name || "?"}
                                        size={Math.max(cellWidth, cellHeight)}
                                        rounded="none"
                                    />
                                </View>
                            ))}
                            {item.spaces.length === 0 && (
                                <View className="flex-1 flex-row items-center justify-center">
                                    <SvgIcon
                                        className="w-4 h-4 text-discord-textMuted"
                                        d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
                                    />
                                </View>
                            )}
                        </View>
                        <WithNotifs
                            read={() => getFolderNotifs(item.spaces)}
                            deps={[item]}
                        >
                            {(folderNotifs) =>
                                folderHasActive && !isExpanded ? (
                                    <View className="absolute start-0 top-1/2 -translate-y-1/2 -translate-x-3 mirror:translate-x-3 w-1 h-8 bg-discord-textPrimary rounded-e-full" />
                                ) : folderNotifs.unread && !isExpanded ? (
                                    <View
                                        pointerEvents="none"
                                        className={`absolute start-0 top-1/2 -translate-y-1/2 -translate-x-3 mirror:translate-x-3 w-1 rounded-e-full pointer-events-none ${
                                            folderNotifs.loud ||
                                            folderNotifs.highlight
                                                ? "h-4 bg-discord-danger"
                                                : "h-2 bg-discord-textPrimary"
                                        }`}
                                    />
                                ) : !isExpanded ? (
                                    <View className="absolute start-0 top-1/2 -translate-y-1/2 -translate-x-3 mirror:translate-x-3 w-1 h-2 bg-discord-textPrimary rounded-e-full opacity-0 group-hover:opacity-100 group-hover:h-5 transition-all duration-200" />
                                ) : null
                            }
                        </WithNotifs>
                    </Pressable>
                </TouchDrag>

                {isExpanded && (
                    <View
                        ref={(view) =>
                            view
                                ? registerIn(
                                      folderInnerEls.current,
                                      item.id,
                                      view,
                                  )
                                : undefined
                        }
                        className="flex flex-col items-center gap-1 bg-discord-backgroundSecondary/50 rounded-xl px-1 py-1 w-12"
                    >
                        {item.spaces.map((space) =>
                            renderFolderSpace(item, space),
                        )}
                    </View>
                )}
            </View>
        );
    }

    function renderFolderSpace(
        item: Extract<RootItem, { kind: "folder" }>,
        space: Room,
    ) {
        const isActive = activeSpaceId === space.roomId;
        return (
            <TouchDrag
                key={space.roomId}
                {...touchProps}
                kind="space"
                id={space.roomId}
                fromFolderId={item.id}
            >
                <Pressable
                    ref={(view) =>
                        view
                            ? registerIn(dragEls.current, space.roomId, {
                                  view,
                                  kind: "space" as const,
                              })
                            : undefined
                    }
                    accessibilityRole="button"
                    accessibilityLabel={space.name || space.roomId}
                    accessibilityState={{ selected: isActive }}
                    onPress={() => setActiveSpace(space.roomId)}
                    className={`group relative w-9 h-9 flex-row items-center justify-center transition-all duration-200 flex-shrink-0 ${
                        dragState?.id === space.roomId ? "opacity-40" : ""
                    }`}
                >
                    <Avatar
                        src={getRoomAvatar(space)}
                        name={space.name || "?"}
                        size={36}
                        rounded="none"
                        class={`${
                            isActive
                                ? "rounded-lg"
                                : "rounded-2xl group-hover:rounded-lg"
                        } transition-all duration-200`}
                    />
                    <WithNotifs
                        read={() => getSpaceNotifs(space.roomId)}
                        deps={[space.roomId]}
                    >
                        {(isn) =>
                            isActive ? (
                                <View className="absolute start-0 top-1/2 -translate-y-1/2 -translate-x-3 mirror:translate-x-3 w-1 h-6 bg-discord-textPrimary rounded-e-full" />
                            ) : isn.unread ? (
                                <View
                                    pointerEvents="none"
                                    className={`absolute start-0 top-1/2 -translate-y-1/2 -translate-x-3 mirror:translate-x-3 w-1 rounded-e-full pointer-events-none ${
                                        isn.loud || isn.highlight
                                            ? "h-3 bg-discord-danger"
                                            : "h-1.5 bg-discord-textPrimary"
                                    }`}
                                />
                            ) : (
                                <View className="absolute start-0 top-1/2 -translate-y-1/2 -translate-x-3 mirror:translate-x-3 w-1 h-2 bg-discord-textPrimary rounded-e-full opacity-0 group-hover:opacity-100 group-hover:h-4 transition-all duration-200" />
                            )
                        }
                    </WithNotifs>
                    {dropTarget?.id === space.roomId &&
                        dropTarget.position !== "into" && (
                            <View
                                pointerEvents="none"
                                className={`absolute left-1/2 -translate-x-1/2 w-8 h-0.5 bg-discord-accent rounded-full pointer-events-none ${
                                    dropTarget.position === "before"
                                        ? "-top-[3px]"
                                        : "-bottom-[3px]"
                                }`}
                            />
                        )}
                </Pressable>
            </TouchDrag>
        );
    }

    return (
        <>
            {/* Zami: the AMOLED theme's hairline between the rail and the room
                list (app.css `:root[data-theme="amoled"] .space-rail`).
                `grow-0`: a ScrollView grows by default (a `<nav>` doesn't), which
                split the drawer's spare width between the rail and the room list.
                Zami: not ported: `data-zam-region="space-sidebar"`, the DOM hook
                plugins find the rail by (pluginDom.ts); there's no DOM to query. */}
            <ScrollView
                ref={navEl}
                scrollEnabled={!touchDragActive}
                showsVerticalScrollIndicator={false}
                className={`space-rail w-[4.5rem] grow-0 bg-discord-backgroundTertiary flex-shrink-0 ${
                    theme === "amoled" ? "border-e border-white/15" : ""
                }`}
                contentContainerClassName="flex flex-col items-center py-3 gap-2"
            >
                {/* Home button */}
                {/* Zami: not ported: `data-nav-space`, for the keyboard shortcuts
                    that move between spaces. */}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("spaceSidebar.home")}
                    accessibilityState={{ selected: activeSpaceId === null }}
                    onPress={onHomeClick}
                    className={`group relative w-12 h-12 flex-row items-center justify-center transition-all duration-200 flex-shrink-0 ${
                        activeSpaceId === null
                            ? "bg-[rgb(var(--discord-accent-rgb))] rounded-xl"
                            : "hover:bg-[rgb(var(--discord-accent-rgb))] rounded-2xl bg-discord-backgroundSecondary hover:rounded-xl"
                    }`}
                >
                    <SvgIcon
                        className={`w-6 h-6 transition-colors ${
                            activeSpaceId === null
                                ? "text-white"
                                : "text-discord-textPrimary group-hover:text-white"
                        }`}
                        d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"
                    />
                    <WithNotifs read={getHomeNotifs}>
                        {(n) =>
                            activeSpaceId === null ? (
                                <View className="absolute start-0 top-1/2 -translate-y-1/2 -translate-x-3 mirror:translate-x-3 w-1 h-8 bg-discord-textPrimary rounded-e-full" />
                            ) : n.unread ? (
                                <View
                                    pointerEvents="none"
                                    className={`absolute start-0 top-1/2 -translate-y-1/2 -translate-x-3 mirror:translate-x-3 w-1 rounded-e-full pointer-events-none ${
                                        n.loud || n.highlight
                                            ? "h-4 bg-discord-danger"
                                            : "h-2 bg-discord-textPrimary"
                                    }`}
                                />
                            ) : null
                        }
                    </WithNotifs>
                </Pressable>

                {/* Separator */}
                <View className="w-8 h-px bg-discord-divider my-1 flex-shrink-0" />

                {/* Root items */}
                {rootItems.map((item) =>
                    item.kind === "space"
                        ? renderRootSpace(item)
                        : renderFolder(item),
                )}

                {spaces.length > 0 && (
                    <View className="w-8 h-px bg-discord-divider my-1 flex-shrink-0" />
                )}

                {/* Add / create a space */}
                <Pressable
                    ref={addMenuButton}
                    accessibilityRole="button"
                    accessibilityLabel={t("spaceSidebar.addASpace")}
                    accessibilityState={{ expanded: addMenuOpen }}
                    onPress={() => void openAddMenu()}
                    className="group w-12 h-12 rounded-2xl flex-row items-center justify-center bg-discord-backgroundSecondary hover:rounded-xl hover:bg-discord-textPositive transition-all duration-200 flex-shrink-0"
                >
                    <SvgIcon
                        className="w-6 h-6 text-discord-textPositive group-hover:text-white transition-colors"
                        d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"
                    />
                </Pressable>

                {/* Explore public rooms */}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("spaceSidebar.exploreRooms")}
                    onPress={openExplore}
                    className="group w-12 h-12 rounded-2xl flex-row items-center justify-center bg-discord-backgroundSecondary hover:rounded-xl hover:bg-discord-textPositive transition-all duration-200 flex-shrink-0"
                >
                    <SvgIcon
                        className="w-6 h-6 text-discord-textSecondary group-hover:text-white transition-colors"
                        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19zM12 10.9a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2z"
                    />
                </Pressable>

                {/* Touch drag ghost */}
                {/* Zami: `position: fixed` → above the app, through Portal. */}
                {touchDragActive && touchGhostId && (
                    <Portal>
                        <Animated.View
                            pointerEvents="none"
                            className="absolute left-0 top-0 z-[100] pointer-events-none w-12 h-12 rounded-xl shadow-2xl opacity-90"
                            style={ghostStyle}
                        >
                            {ghostSpace ? (
                                <Avatar
                                    src={getRoomAvatar(ghostSpace)}
                                    name={ghostSpace.name || "?"}
                                    size={48}
                                    rounded="none"
                                    class="rounded-xl"
                                />
                            ) : (
                                <View className="w-12 h-12 rounded-xl bg-discord-backgroundSecondary flex-row items-center justify-center">
                                    <SvgIcon
                                        className="w-6 h-6 text-discord-textMuted"
                                        d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
                                    />
                                </View>
                            )}
                        </Animated.View>
                    </Portal>
                )}
            </ScrollView>

            <Portal>
                {/* Space-rail "+" flyout: compact Create-space / Join chooser. Kept
                    MOUNTED (class-toggled, not `{#if}`) so QuickActions' own Portaled form
                    modal survives this flyout closing when picking an action supersedes
                    the "space-add-menu" slot. Positioned `fixed` from the button's rect. */}
                {addMenuOpen && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("common.closeMenu")}
                        className="absolute inset-0 z-40"
                        onPress={closeModal}
                    />
                )}
                <View
                    role="menu"
                    accessibilityLabel={t("spaceSidebar.addASpace")}
                    accessibilityViewIsModal={addMenuOpen}
                    onAccessibilityEscape={closeModal}
                    className={`absolute z-50 bg-discord-backgroundTertiary border border-discord-divider rounded-lg shadow-xl py-1 min-w-52 ${
                        addMenuOpen ? "" : "hidden"
                    }`}
                    style={{ left: addMenuX, top: addMenuY }}
                >
                    <QuickActions compact />
                </View>

                {/* These four are portaled, not merely tidied out of the <nav>: on mobile
                    the sidebar lives inside AppShell's drawer, whose inline
                    `transform: translateX(…)` (present even at 0px) makes it the
                    containing block for `position: fixed`. Inside it, ModalDialog's
                    `fixed inset-0` layer covers the 19.5rem drawer instead of the viewport,
                    so a tap beside the dialog dismissed the DRAWER while the dialog kept
                    claiming aria-modal over the whole app. */}
                {/* Color picker dialog */}
                {colorPicker && (
                    <FolderColorPicker
                        initialHex={colorPicker.initialHex}
                        onSave={commitColor}
                        onClose={closeModal}
                    />
                )}

                {/* Create room in space modal */}
                {createRoomModal && (
                    // Zami: Enter (`onKeydown`) → each input's onSubmitEditing.
                    // The panel scrolls (`max-h-full` of the layer, which the
                    // keyboard shrinks), so the form stays reachable above the
                    // on-screen keyboard; its padding and gap move to the
                    // scroll content.
                    <ModalDialog
                        onClose={closeModal}
                        labelledBy="space-create-room-title"
                        panelClass="relative bg-discord-background rounded-lg shadow-xl w-full max-w-md mx-4 max-h-full overflow-hidden"
                    >
                        <ScrollView
                            keyboardShouldPersistTaps="handled"
                            contentContainerClassName="p-6 flex flex-col gap-4"
                        >
                            <Text
                                nativeID="space-create-room-title"
                                role="heading"
                                className="text-lg font-bold text-discord-textPrimary"
                            >
                                {t("spaceSidebar.createRoomInSpace")}
                            </Text>
                            <View className="flex flex-col gap-3">
                                <View>
                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                        {t("spaceSidebar.roomName")}
                                    </Text>
                                    {/* Zami: focused on open, as the
                                        dialog's focus trap focuses it
                                        (data-autofocus). */}
                                    <TextInput
                                        accessibilityLabel={t(
                                            "spaceSidebar.roomName",
                                        )}
                                        autoFocus
                                        value={modalInput1}
                                        onChangeText={setModalInput1}
                                        onSubmitEditing={() =>
                                            void submitCreateRoom()
                                        }
                                        submitBehavior="submit"
                                        returnKeyType="go"
                                        placeholder={t("spaceSidebar.myRoom")}
                                        placeholderTextColorClassName="accent-discord-textMuted"
                                        className="w-full px-3 py-2 bg-discord-backgroundSecondary text-discord-textPrimary rounded border border-discord-divider focus:border-discord-accent focus:outline-none text-sm"
                                    />
                                </View>
                                <View>
                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                        {t("common.topic")}{" "}
                                        <Text className="normal-case font-normal">
                                            {t("spaceSidebar.optional")}
                                        </Text>
                                    </Text>
                                    <TextInput
                                        accessibilityLabel={t("common.topic")}
                                        value={modalInput2}
                                        onChangeText={setModalInput2}
                                        onSubmitEditing={() =>
                                            void submitCreateRoom()
                                        }
                                        submitBehavior="submit"
                                        returnKeyType="go"
                                        placeholder={t(
                                            "spaceSidebar.whatSThisRoomAbout",
                                        )}
                                        placeholderTextColorClassName="accent-discord-textMuted"
                                        className="w-full px-3 py-2 bg-discord-backgroundSecondary text-discord-textPrimary rounded border border-discord-divider focus:border-discord-accent focus:outline-none text-sm"
                                    />
                                </View>
                                <Checkbox
                                    checked={modalVideoRoom}
                                    onChange={setModalVideoRoom}
                                    className="items-start gap-2.5"
                                    inputClassName="mt-0.5 w-3.5 h-3.5 rounded-sm"
                                    label={
                                        <View className="shrink">
                                            <Text className="text-sm text-discord-textPrimary">
                                                {t("common.videoRoom")}
                                            </Text>
                                            <Text className="text-xs text-discord-textMuted">
                                                {t(
                                                    "spaceSidebar.opensStraightIntoACallMessages",
                                                )}
                                            </Text>
                                        </View>
                                    }
                                />
                            </View>
                            {modalError ? (
                                <Text className="text-sm text-discord-danger">
                                    {modalError}
                                </Text>
                            ) : null}
                            <View className="flex-row justify-end gap-2 mt-1">
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={closeModal}
                                    disabled={modalLoading}
                                    accessibilityState={{
                                        disabled: modalLoading,
                                    }}
                                    className={`px-4 py-2 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors ${
                                        modalLoading ? "opacity-50" : ""
                                    }`}
                                >
                                    <Text className="text-sm font-medium text-discord-textMuted hover:text-discord-textPrimary">
                                        {t("common.cancel")}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => void submitCreateRoom()}
                                    disabled={
                                        modalLoading || !modalInput1.trim()
                                    }
                                    accessibilityState={{
                                        disabled:
                                            modalLoading || !modalInput1.trim(),
                                    }}
                                    className={`px-4 py-2 rounded bg-discord-accent hover:bg-discord-accentHover active:bg-discord-accentHover transition-colors flex-row items-center gap-2 ${
                                        modalLoading || !modalInput1.trim()
                                            ? "opacity-50"
                                            : ""
                                    }`}
                                >
                                    {modalLoading && (
                                        <Spin className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                                    )}
                                    <Text className="text-sm font-semibold text-white">
                                        {t("spaceSidebar.create")}
                                    </Text>
                                </Pressable>
                            </View>
                        </ScrollView>
                    </ModalDialog>
                )}

                {/* Add existing room to space modal */}
                {addRoomModal && (
                    <ModalDialog
                        onClose={closeModal}
                        labelledBy="space-add-room-title"
                        panelClass="relative bg-discord-background rounded-lg shadow-xl w-full max-w-md mx-4 p-6 flex flex-col gap-4"
                    >
                        <Text
                            nativeID="space-add-room-title"
                            role="heading"
                            className="text-lg font-bold text-discord-textPrimary"
                        >
                            {t("spaceSidebar.addExistingRoomToSpace")}
                        </Text>
                        {addRoomCandidates.length === 0 ? (
                            <Text className="text-sm text-discord-textMuted">
                                {t("spaceSidebar.noRoomsAvailableToAdd")}
                            </Text>
                        ) : (
                            // Zami: a FlatList of memoized rows: it lists every
                            // Home room and DM, thousands on a bridge account.
                            <FlatList
                                className="max-h-72 grow-0"
                                contentContainerClassName="flex flex-col gap-1"
                                data={addRoomCandidates}
                                keyExtractor={roomKey}
                                initialNumToRender={12}
                                windowSize={5}
                                renderItem={({ item: room }) => (
                                    <AddRoomRow
                                        room={room}
                                        onPick={pickRoomToAdd}
                                    />
                                )}
                            />
                        )}
                        <View className="flex-row justify-end">
                            <Pressable
                                accessibilityRole="button"
                                onPress={closeModal}
                                className="px-4 py-2 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                            >
                                <Text className="text-sm font-medium text-discord-textMuted hover:text-discord-textPrimary">
                                    {t("common.cancel")}
                                </Text>
                            </Pressable>
                        </View>
                    </ModalDialog>
                )}

                {/* Explore rooms modal */}
                {exploreOpen && <RoomDirectory />}

                {cm &&
                    (cm.touch ? (
                        <BottomSheet onClose={closeModal}>
                            {menuContent()}
                        </BottomSheet>
                    ) : (
                        // Zami: `dismissOnOutsidePointer` → a backdrop filling the layer.
                        <View
                            pointerEvents="box-none"
                            style={StyleSheet.absoluteFill}
                        >
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t("common.closeMenu")}
                                className="absolute inset-0"
                                onPress={closeModal}
                            />
                            {placedMenu ? (
                                <View
                                    accessibilityViewIsModal
                                    onAccessibilityEscape={closeModal}
                                    className={menuClass}
                                    style={placedMenu}
                                >
                                    <ScrollView style={styles.scroll}>
                                        <View className="py-1">
                                            {menuContent()}
                                        </View>
                                    </ScrollView>
                                </View>
                            ) : (
                                <View
                                    pointerEvents="none"
                                    className={menuClass}
                                    style={styles.measuring}
                                    onLayout={(e) =>
                                        setPlacedMenu(
                                            positionMenu(
                                                { x: cm.x, y: cm.y },
                                                e.nativeEvent.layout,
                                            ),
                                        )
                                    }
                                >
                                    <View className="py-1">
                                        {menuContent()}
                                    </View>
                                </View>
                            )}
                        </View>
                    ))}
            </Portal>
        </>
    );
}

const styles = StyleSheet.create({
    measuring: { left: 0, top: 0, opacity: 0 },
    // Sized by its content, up to the menu's max height.
    scroll: { flexGrow: 0, flexShrink: 1 },
});

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
