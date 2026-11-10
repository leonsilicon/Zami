import {
    Checkbox,
    Details,
    DomMount,
    Image,
    mediaSource,
    pickedFile,
    Portal,
    Radio,
    Select,
    SvgIcon,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { ArrowLeft, ChevronRight, Circle, TriangleAlert } from "lucide-svelte";
import type { Room, RoomMember } from "matrix-js-sdk";
import {
    useCallback,
    useEffect,
    useEffectEvent,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    AccessibilityInfo,
    BackHandler,
    FlatList,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
    type HostInstance,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { t } from "$lib/i18n";
import { pluginRegistry } from "$lib/stores/plugins.svelte";
import { pluginMount } from "$lib/plugins/pluginMount";
import Avatar from "$lib/components/ui/Avatar.svelte";
import InvitePanel from "./InvitePanel.svelte";
import ImagePackEditor from "./ImagePackEditor.svelte";
import SoundPackEditor from "$lib/components/settings/SoundPackEditor.svelte";
import {
    canInviteToRoom,
    getMyPowerLevel,
    getMyPowerRank,
    getUserPowerLevel,
    getUserPowerRank,
    hasImmutableCreatorPower,
    getRoomPowerLevels,
    getThreadNameLevel,
    setRoomPowerLevels,
    setUserPowerLevel,
    holdSlidingSyncRoom,
    ensureRoomFullState,
    isUsingSlidingSync,
    inviteUser,
    kickUser,
    banUser,
    unbanUser,
    getBannedMembers,
    getKnockingMembers,
    getMemberKnockReason,
    setRoomName,
    setRoomTopic,
    setRoomAvatar,
    uploadContent,
    getJoinRule,
    setJoinRule,
    getDirectParentSpaceIds,
    setRestrictedJoinRule,
    getRoom,
    getHistoryVisibility,
    setHistoryVisibility,
    getGuestAccess,
    setGuestAccess,
    getRoomDirectoryVisibility,
    setRoomDirectoryVisibility,
    getLocalRoomAliases,
    createRoomAlias,
    deleteRoomAlias,
    getCanonicalAliasContent,
    setCanonicalAliasContent,
    getOwnServerName,
    getSpaceChildren,
    setSpaceChildOrder,
    removeSpaceChild,
    setSpaceChildSuggested,
    getRoomMembers,
    getRoomStateAvatar,
    getRoomTopic,
    enableRoomEncryption,
    mxcToHttp,
    upgradeRoomToVersion,
    getOwnUserId,
    getRoomVersionCapability,
    type SpaceChildEntry,
    memberDisplayName,
    getServerAclContent,
    setServerAcl,
    isRoomStateHealed,
    getRoomNotificationSetting,
    setRoomNotificationSetting,
    getRoomsInSpace,
    getSpaceChildIds,
    type RoomNotificationSetting,
} from "$lib/matrix/client";
import {
    getRestrictedJoinState,
    RESTRICTED_JOIN_RULE,
} from "$lib/utils/joinRules";
import {
    buildAlias,
    buildCanonicalAliasContent,
    canonicalAliasContentAfterRemoval,
    sortAliasesForDisplay,
    validateAliasLocalpart,
    type CanonicalAliasContent,
} from "$lib/utils/roomAliases";
import { parseMutePowerLevelInput } from "$lib/utils/mutePowerLevel";
import {
    effectiveCallJoinLevel,
    mergeCallJoinLevel,
    roomVersionHasImmutableCreators,
} from "$lib/utils/powerLevels";
import { getRoomUpgradeState } from "$lib/utils/roomUpgrade";
import UserPicker from "$lib/components/ui/UserPicker.svelte";
import { THREAD_NAME_POWER_LEVEL_KEY } from "$lib/utils/threadName";
import {
    parseServerAcl,
    hasServerAcl,
    validateServerAcl,
    parseServerListInput,
    serverListToText,
    DEFAULT_SERVER_ACL,
    type ServerAcl,
} from "$lib/utils/serverAcl";
import {
    roomSettingsNavView,
    roomSettingsTabs,
    roomSettingsTabLabel,
    type RoomSettingsTab,
} from "$lib/utils/roomSettingsNav";
import { roomStateTrustBadge } from "$lib/utils/roomStateTrust";

import { discardRoomSession, isRoomEncrypted } from "$lib/matrix/crypto";
import {
    getEnableEncryptionState,
    matchesEnableEncryptionConfirmation,
    ENABLE_ENCRYPTION_CONFIRM_PHRASE,
    ENABLE_ENCRYPTION_WARNING,
} from "$lib/utils/roomEncryption";
import { auth } from "$lib/stores/auth.svelte";
import {
    interfaceState,
    openSubPage,
    clearSubPageIfOwner,
    closeSubPage,
} from "$lib/stores/interface.svelte";
import { roomsState, setActiveRoom } from "$lib/stores/rooms.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import {
    blockUser,
    unblockUser,
    isUserBlocked,
    ignoredUsersState,
} from "$lib/stores/ignoredUsers.svelte";
import { mapWithConcurrency } from "$lib/utils/async";
import { collectSpaceAndDescendantRoomIds } from "$lib/utils/spaceNotifications";
import { showErrorToast } from "$lib/stores/toasts.svelte";

interface Props {
    room: Room;
    onClose: () => void;
    onUpdate?: () => void;
}

// Zami: the tab panel's `overflow-y-auto` box, as a ScrollView that keeps the
// focused field above the on-screen keyboard (the panel is full-screen on a
// phone, so there's nothing for a KeyboardAvoidingView to recentre).
const ScrollArea = withUniwind(KeyboardAwareScrollView);

// The close (×) and member-actions (⋮) icons.
const CLOSE_ICON =
    "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";
const MORE_ICON =
    "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z";

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same
// `gap-*` spaces the children instead. Text classes sit on each Text, buttons
// that are inline-block on the web are `self-start` in a column, and `title`
// tooltips are dropped. `use:focusTrap` has no equivalent: the panel is
// `accessibilityViewIsModal`, which keeps VoiceOver inside it.
export default function RoomSettings({ room, onClose, onUpdate }: Props) {
    // null = "nothing drilled into yet": the mobile category list, or the
    // desktop default panel. Kept across a viewport change in both directions
    // so resizing/rotating never loses the user's place.
    const [selectedTab, setSelectedTab] = useState<RoomSettingsTab | null>(
        null,
    );
    // Zami: declared here rather than with the Members tab below, as
    // goBackToList resets it.
    const [showInvite, setShowInvite] = useState(false);

    const isSpace = room.isSpaceRoom();

    // Plugin tabs (zam.room.addSettingsTab) this room gets, after Zam's own.
    const pluginTick = useRune(() => pluginRegistry.tick);
    const pluginTabEntries = useMemo(
        () => (
            void pluginTick,
            pluginRegistry.roomSettingsTabs.filter((e) => {
                try {
                    return (
                        e.value.when?.({ roomId: room.roomId, isSpace }) ?? true
                    );
                } catch (err) {
                    console.error("[zam] room settings tab when() threw", err);
                    return false;
                }
            })
        ),
        [pluginTick, room.roomId, isSpace],
    );
    const pluginTabs = useMemo(
        () =>
            pluginTabEntries.map((e) => ({
                id: `plugin:${e.entryId}` as RoomSettingsTab,
                label: String(e.value.label),
            })),
        [pluginTabEntries],
    );

    const isMobile = useRune(() => interfaceState.isMobile);
    const view = roomSettingsNavView({
        isMobile,
        isSpace,
        selectedTab,
        pluginTabs,
    });

    // The tab whose panel is on screen, or null on the mobile category list
    // where no panel is mounted. The lazy-load effects below gate on this, so
    // sitting on the list must not kick off a fetch.
    const activeTab: RoomSettingsTab | null =
        view.mode === "list" ? null : view.tab;

    // Zami: declared after activeTab, which it reads.
    const activePluginTab =
        pluginTabEntries.find((e) => activeTab === `plugin:${e.entryId}`) ??
        null;

    // Stable identity: it is the ownership token for the sub-page slot, so it
    // must NOT be recreated on every render. It resets local state ONLY — it
    // runs from inside the store's own close/supersede paths, so reaching back
    // into the store here would pop the wrong owner.
    const goBackToList = useCallback(() => {
        setSelectedTab(null);
        setShowInvite(false);
    }, []);

    // Reactive: re-derives after any push-rule write (getter reads
    // pushRulesState.revision; the setter bumps it).
    const notifSetting = useRune<RoomNotificationSetting>(
        () => getRoomNotificationSetting(room.roomId),
        [room.roomId],
    );
    const [notifSaving, setNotifSaving] = useState(false);

    const NOTIF_LEVELS: readonly [RoomNotificationSetting, string, string][] = [
        [
            "default",
            t("common.default"),
            t("roomSettings.useYourGlobalNotificationSettings"),
        ],
        [
            "all",
            t("roomSettings.allMessages"),
            t("roomSettings.notifyForEveryMessage"),
        ],
        [
            "mentions",
            t("roomSettings.mentionsOnly"),
            t("roomSettings.notifyOnlyForMentionsAndKeywords"),
        ],
        ["mute", t("common.mute"), t("roomSettings.neverNotify")],
    ];

    async function applyNotification(setting: RoomNotificationSetting) {
        if (notifSaving) return;
        setNotifSaving(true);
        try {
            if (isSpace) {
                const ids = collectSpaceAndDescendantRoomIds(room.roomId, {
                    roomsInSpace: (id) =>
                        getRoomsInSpace(id).map((r) => r.roomId),
                    childSpaceIds: (id) =>
                        getSpaceChildIds(id).filter(
                            (cid) => getRoom(cid)?.isSpaceRoom() ?? false,
                        ),
                });
                await mapWithConcurrency(ids, 4, (id) =>
                    setRoomNotificationSetting(id, setting),
                );
            } else {
                await setRoomNotificationSetting(room.roomId, setting);
            }
        } catch (err) {
            showErrorToast(
                err instanceof Error
                    ? err.message
                    : t("roomSettings.failedToUpdateNotifications"),
            );
        } finally {
            setNotifSaving(false);
        }
    }

    // Zami: not ported: `onNotifKeydown`, the arrow-key roving over the
    // notification radiogroup (a touchscreen has no arrow keys; VoiceOver
    // swipes between the radios).

    // Register the mobile sub-page with the central dismiss stack so Escape and
    // the hardware back button pop it before closing the whole dialog.
    //
    // Zami: the dependencies are what `view.mode` reads, as upstream's are what
    // `view` reads; `openSubPage` writes none of them, so there is no loop.
    useEffect(() => {
        if (view.mode !== "detail") return;
        openSubPage(goBackToList);
        return () => clearSubPageIfOwner(goBackToList);
    }, [view.mode, goBackToList]);

    // Zami: upstream leaves Escape to AppShell's `dismissTopmost()` (the
    // `handlesEscape={false}` precedent): it pops the sub-page registered above,
    // else closes this dialog. Android's back button and VoiceOver's escape
    // gesture do the same here. This listener is added after AppShell's, so it
    // runs first.
    function dismissTopmost() {
        if (interfaceState.subPageClose) closeSubPage();
        else onClose();
    }
    const onBackPress = useEffectEvent(() => dismissTopmost());
    useEffect(() => {
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                onBackPress();
                return true;
            },
        );
        return () => subscription.remove();
    }, []);

    // Plain refs, not state: these are transition bookkeeping, not view data.
    const backButtonEl = useRef<HostInstance | null>(null);
    // Only index 0 is ever read, and it is always "general" — the tab set has
    // the same length for a room and a space, but not the same members, so an
    // index means different things in the two shapes.
    const categoryEls = useRef<(HostInstance | null)[]>([]);
    const sidebarEls = useRef<Record<string, HostInstance | null>>({});
    const lastMode = useRef<string | null>(null);

    // EVERY mode change destroys the element that had focus — drilling in,
    // backing out, and crossing the 768px breakpoint in either direction. So
    // re-anchor focus on every change, including into "desktop" (never on
    // first mount). Writes no state, so it cannot retrigger itself.
    // Zami: the screen reader's focus, which is what a touchscreen has.
    useEffect(() => {
        const mode = view.mode;
        const tab = activeTab;
        if (lastMode.current === null || lastMode.current === mode) {
            lastMode.current = mode;
            return;
        }
        lastMode.current = mode;
        // After the views are committed, so the refs have landed.
        const el =
            mode === "detail"
                ? backButtonEl.current
                : mode === "list"
                  ? categoryEls.current[0]
                  : tab
                    ? sidebarEls.current[tab]
                    : null;
        if (el) AccessibilityInfo.sendAccessibilityEvent(el, "focus");
    }, [view.mode, activeTab]);

    // Zami: every reader below that upstream ties to `roomsState.roomsTick`
    // runs during render, and this re-renders on each tick.
    const roomsTick = useRune(() => roomsState.roomsTick);
    const myPowerLevel = getMyPowerLevel(room);
    // Rank decides who may act on whom (creators outrank admins); the level is
    // still the ceiling for hand-typed levels.
    const myPowerRank = getMyPowerRank(room);
    const pl = getRoomPowerLevels(room);
    const threadNameLevel = getThreadNameLevel(room);
    // Sliding sync only gives the viewed room full state; the room list (and
    // so a space, which is never "viewed") lacks power levels and members.
    // Hold the room while its settings are open (members, live updates), and
    // fetch the missing state directly: some servers never send state that a
    // widened subscription newly asks for.
    useEffect(() => holdSlidingSyncRoom(room.roomId), [room.roomId]);
    const [stateFetched, setStateFetched] = useState(false);
    const [stateLoadError, setStateLoadError] = useState("");
    function loadFullState() {
        setStateLoadError("");
        ensureRoomFullState(room)
            .then(() => {
                setStateFetched(true);
                // setStateEvents mutates the Room in place; re-derive readers.
                roomsState.roomsTick++;
            })
            .catch((e) => {
                setStateLoadError(e?.message ?? t("roomSettings.failed"));
            });
    }
    const reloadFullState = useEffectEvent(() => {
        setStateFetched(false);
        loadFullState();
    });
    useEffect(() => {
        reloadFullState();
    }, [room.roomId]);
    // Until the state is in, `pl` is the all-zero no-event fallback and
    // history visibility / guest access / server ACL read as their defaults:
    // show loading rather than wrong values that a save would then write.
    // Classic /sync has full state, so it is always loaded.
    const stateLoaded = !isUsingSlidingSync() || stateFetched;
    const canEditState = myPowerLevel >= pl.state_default;
    // May create a pack: new ones go under m.room.image_pack, or under
    // im.ponies.room_emotes when only that level is ours (packWriteTypes).
    const canEditEmojis = ["m.room.image_pack", "im.ponies.room_emotes"].some(
        (type) => myPowerLevel >= (pl.events?.[type] ?? pl.state_default),
    );
    // Publishing an address is gated by the power level for the canonical-alias
    // EVENT, not bare state_default — Element's default PL content ships
    // `state_default: 100` with `m.room.canonical_alias: 50`, so a moderator who
    // may publish would otherwise be shown nothing at all.
    const canSetCanonicalAlias =
        myPowerLevel >=
        (pl.events?.["m.room.canonical_alias"] ?? pl.state_default);
    const canKick = myPowerLevel >= pl.kick;
    const canBan = myPowerLevel >= pl.ban;

    // ── Members tab: inline invite ─────────────────────────────────────────────
    // (`showInvite` is declared at the top.)
    const canInvite = canInviteToRoom(room.roomId);

    // ── Security tab: encryption ───────────────────────────────────────────────
    // Depend on roomsTick: the Room mutates in place when the m.room.encryption
    // state event lands, so the status flips without reopening the modal.
    const encrypted = isRoomEncrypted(room);
    const encState = getEnableEncryptionState({
        alreadyEncrypted: encrypted,
        myPowerLevel,
        powerLevels: pl,
    });
    const [encShowConfirm, setEncShowConfirm] = useState(false);
    const [encConfirmInput, setEncConfirmInput] = useState("");
    const [encEnabling, setEncEnabling] = useState(false);
    const [encError, setEncError] = useState("");

    // SEC-M5: flag rooms whose state was healed out-of-band (server-fetched, not
    // synced). roomsTick so the banner appears/clears after a heal without reload.
    const stateTrust = roomStateTrustBadge(isRoomStateHealed(room.roomId));

    const [roomKeyResetting, setRoomKeyResetting] = useState(false);
    const [roomKeyResetDone, setRoomKeyResetDone] = useState(false);
    const [roomKeyResetError, setRoomKeyResetError] = useState("");

    async function doResetRoomKey() {
        setRoomKeyResetting(true);
        setRoomKeyResetDone(false);
        setRoomKeyResetError("");
        try {
            await discardRoomSession(room.roomId);
            setRoomKeyResetDone(true);
        } catch (e) {
            setRoomKeyResetError(
                e instanceof Error
                    ? e.message
                    : t("roomSettings.couldNotResetRoomKey"),
            );
        } finally {
            setRoomKeyResetting(false);
        }
    }

    async function doEnableEncryption() {
        if (!matchesEnableEncryptionConfirmation(encConfirmInput)) return;
        setEncEnabling(true);
        setEncError("");
        try {
            await enableRoomEncryption(room.roomId);
            roomsState.roomsTick++;
            setEncShowConfirm(false);
            setEncConfirmInput("");
        } catch (e: any) {
            setEncError(
                e?.data?.error ??
                    e?.message ??
                    t("roomSettings.failedToEnableEncryption"),
            );
        } finally {
            setEncEnabling(false);
        }
    }

    // ── General tab ────────────────────────────────────────────────────────────
    const [nameInput, setNameInput] = useState(() => room.name ?? "");
    const [topicInput, setTopicInput] = useState(
        () => getRoomTopic(room) ?? "",
    );
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [generalSaving, setGeneralSaving] = useState(false);
    const [generalError, setGeneralError] = useState("");
    const [generalSuccess, setGeneralSuccess] = useState(false);
    const [idCopied, setIdCopied] = useState(false);
    const idCopiedTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );

    const currentAvatarUrl = getRoomStateAvatar(room);

    async function copyRoomId() {
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(room.roomId);
            setIdCopied(true);
            clearTimeout(idCopiedTimeout.current);
            idCopiedTimeout.current = setTimeout(
                () => setIdCopied(false),
                1500,
            );
        } catch {
            // Clipboard denied — fail silently, matching the app's other copy affordances.
        }
    }

    async function saveGeneral() {
        setGeneralError("");
        setGeneralSaving(true);
        try {
            const promises: Promise<void>[] = [];
            if (nameInput.trim() && nameInput.trim() !== room.name) {
                promises.push(setRoomName(room.roomId, nameInput.trim()));
            }
            const currentTopic = getRoomTopic(room) ?? "";
            if (topicInput !== currentTopic) {
                promises.push(setRoomTopic(room.roomId, topicInput));
            }
            await Promise.all(promises);
            setGeneralSuccess(true);
            setTimeout(() => setGeneralSuccess(false), 2000);
        } catch (e: any) {
            setGeneralError(e?.message ?? t("roomSettings.failedToSave"));
        } finally {
            setGeneralSaving(false);
        }
    }

    // Zami: <input type="file" accept="image/*"> → expo-image-picker's photo
    // library, and the picked image as the input's `File`.
    async function handleAvatarUpload() {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 1,
        });
        const asset = result.canceled ? undefined : result.assets[0];
        if (!asset) return;
        setAvatarUploading(true);
        setGeneralError("");
        try {
            const file = await pickedFile(asset);
            const mxcUrl = await uploadContent(file);
            await setRoomAvatar(room.roomId, mxcUrl);
        } catch (err: any) {
            setGeneralError(err?.message ?? t("roomSettings.uploadFailed"));
        } finally {
            setAvatarUploading(false);
        }
    }

    // ── General tab: Advanced → room upgrade ───────────────────────────────────
    // The room-version capability is server-global; load it once when General
    // opens (mirrors the Access-tab dirLoaded pattern). Skipped for spaces
    // (upgrade is gated to non-space rooms in v1).
    const [roomVersionCap, setRoomVersionCap] = useState<{
        default: string;
        available: string[];
    } | null>(null);

    useEffect(() => {
        if (activeTab !== "general" || roomVersionCap || isSpace) return;
        getRoomVersionCapability()
            .then((cap) => setRoomVersionCap(cap))
            .catch(() => setRoomVersionCap({ default: "", available: [] }));
    }, [activeTab, roomVersionCap, isSpace]);

    // Tick-dependent so power/version refresh on sync (the reactivity landmine).
    const tombstoneLevel = pl.events?.["m.room.tombstone"] ?? pl.state_default;
    const upgradeState = getRoomUpgradeState({
        currentVersion: room.getVersion(),
        defaultVersion: roomVersionCap?.default ?? "",
        availableVersions: roomVersionCap?.available ?? [],
        myPowerLevel,
        tombstonePowerLevel: tombstoneLevel,
    });

    const [upgradeShowConfirm, setUpgradeShowConfirm] = useState(false);
    const [upgrading, setUpgrading] = useState(false);
    const [upgradeError, setUpgradeError] = useState("");
    // Room v12 additional creators, offered only when the target version has
    // immutable creators (see the confirm step below).
    const [upgradeCreators, setUpgradeCreators] = useState<string[]>([]);
    const upgradeExcludeUserIds = useMemo(() => [getOwnUserId() ?? ""], []);

    async function doUpgradeRoom() {
        setUpgrading(true);
        setUpgradeError("");
        try {
            const target = upgradeState.recommendedVersion;
            const newRoomId = await upgradeRoomToVersion(
                room.roomId,
                target,
                roomVersionHasImmutableCreators(target) ? upgradeCreators : [],
            );
            setUpgradeShowConfirm(false);
            onClose();
            setActiveRoom(newRoomId);
        } catch (e: any) {
            setUpgradeError(
                e?.data?.error ??
                    e?.message ??
                    t("roomSettings.failedToUpgradeRoom"),
            );
        } finally {
            setUpgrading(false);
        }
    }

    // The room prop can swap under a mounted dialog, so an upgrade confirm or
    // error opened for one room must not carry into the next. Depend only on
    // room.roomId.
    useEffect(() => {
        void room.roomId;
        setUpgradeShowConfirm(false);
        setUpgrading(false);
        setUpgradeError("");
        setUpgradeCreators([]);
    }, [room.roomId]);

    // ── Access tab ─────────────────────────────────────────────────────────────
    const [joinRule, setJoinRuleChoice] = useState(() => getJoinRule(room));
    const [historyVisibility, setHistoryVisibilityChoice] = useState(() =>
        getHistoryVisibility(room),
    );
    const [guestAccessAllowed, setGuestAccessAllowed] = useState(
        () => getGuestAccess(room) === "can_join",
    );
    // Same re-seed as the Permissions tab (see stateLoaded): saveAccess writes
    // any field that differs from live state, so a default seeded before the
    // real value arrived would be written back on an unrelated save.
    const [initialAccessSeed] = useState(() => ({
        historyVisibility: getHistoryVisibility(room),
        guestAccessAllowed: getGuestAccess(room) === "can_join",
    }));
    const accessSeed = useRef(initialAccessSeed);
    const reseedAccess = useEffectEvent(() => {
        if (
            historyVisibility !== accessSeed.current.historyVisibility ||
            guestAccessAllowed !== accessSeed.current.guestAccessAllowed
        )
            return;
        accessSeed.current = {
            historyVisibility: getHistoryVisibility(room),
            guestAccessAllowed: getGuestAccess(room) === "can_join",
        };
        setHistoryVisibilityChoice(accessSeed.current.historyVisibility);
        setGuestAccessAllowed(accessSeed.current.guestAccessAllowed);
    });
    useEffect(() => {
        if (!stateLoaded) return;
        reseedAccess();
    }, [stateLoaded]);
    const [accessSaving, setAccessSaving] = useState(false);
    const [accessError, setAccessError] = useState("");
    const [accessSuccess, setAccessSuccess] = useState(false);

    const parentSpaceIds = useMemo(() => {
        void roomsTick;
        return getDirectParentSpaceIds(room.roomId);
    }, [roomsTick, room.roomId]);
    const restrictedJoin = getRestrictedJoinState({
        roomVersion: room.getVersion(),
        parentSpaceIds,
        canEditState,
    });
    const parentSpaceNames = parentSpaceIds
        .map((id) => getRoom(id)?.name)
        .filter((n): n is string => !!n)
        .join(", ");

    async function saveAccess() {
        setAccessError("");
        setAccessSaving(true);
        try {
            const promises: Promise<void>[] = [];
            if (joinRule === RESTRICTED_JOIN_RULE) {
                promises.push(
                    setRestrictedJoinRule(room.roomId, parentSpaceIds),
                );
            } else if (joinRule !== getJoinRule(room)) {
                promises.push(setJoinRule(room.roomId, joinRule));
            }
            if (historyVisibility !== getHistoryVisibility(room))
                promises.push(
                    setHistoryVisibility(room.roomId, historyVisibility),
                );
            const nextGuestAccess = guestAccessAllowed
                ? "can_join"
                : "forbidden";
            if (nextGuestAccess !== getGuestAccess(room))
                promises.push(setGuestAccess(room.roomId, nextGuestAccess));
            await Promise.all(promises);
            setAccessSuccess(true);
            setTimeout(() => setAccessSuccess(false), 2000);
        } catch (e: any) {
            setAccessError(e?.message ?? t("roomSettings.failedToSave"));
        } finally {
            setAccessSaving(false);
        }
    }

    // ── Access tab: server ACL (m.room.server_acl) ────────────────────────────
    const authUserId = useRune(() => auth.userId);
    const myServerName = (authUserId ?? "").split(":").slice(1).join(":");
    // The state event's own content object: the same object until the event
    // changes, so the seeding effect below re-runs only then.
    const aclContent = getServerAclContent(room);
    const aclPresent = hasServerAcl(aclContent);
    // Power level for the m.room.server_acl EVENT (falls back to state_default),
    // mirroring canSetCanonicalAlias.
    const canEditServerAcl =
        myPowerLevel >= (pl.events?.["m.room.server_acl"] ?? pl.state_default);
    const [aclAllowText, setAclAllowText] = useState("");
    const [aclDenyText, setAclDenyText] = useState("");
    const [aclAllowIp, setAclAllowIp] = useState(true);
    const [aclSaving, setAclSaving] = useState(false);
    const [aclError, setAclError] = useState("");
    const [aclSuccess, setAclSuccess] = useState(false);
    // Seed the editable fields from the live ACL whenever the room (or its ACL) changes.
    useEffect(() => {
        const parsed = parseServerAcl(aclContent);
        setAclAllowText(
            serverListToText(
                aclPresent ? parsed.allow : DEFAULT_SERVER_ACL.allow,
            ),
        );
        setAclDenyText(
            serverListToText(
                aclPresent ? parsed.deny : DEFAULT_SERVER_ACL.deny,
            ),
        );
        setAclAllowIp(
            aclPresent
                ? parsed.allowIpLiterals
                : DEFAULT_SERVER_ACL.allowIpLiterals,
        );
    }, [aclContent, aclPresent]);
    const aclDraft: ServerAcl = {
        allow: parseServerListInput(aclAllowText),
        deny: parseServerListInput(aclDenyText),
        allowIpLiterals: aclAllowIp,
    };
    const aclWarnings = validateServerAcl(aclDraft, myServerName).warnings;

    async function saveServerAcl() {
        setAclError("");
        setAclSaving(true);
        try {
            await setServerAcl(room, aclDraft);
            setAclSuccess(true);
            setTimeout(() => setAclSuccess(false), 2000);
        } catch (e: any) {
            setAclError(e?.message ?? t("roomSettings.failedToSaveServerAcl"));
        } finally {
            setAclSaving(false);
        }
    }

    // ── Access tab: directory visibility (separate server call) ─────────────────
    const [dirVisibility, setDirVisibility] = useState<"public" | "private">(
        "private",
    );
    const [dirLoaded, setDirLoaded] = useState(false);
    const [dirSaving, setDirSaving] = useState(false);
    const [dirError, setDirError] = useState("");

    useEffect(() => {
        if (activeTab !== "access" || dirLoaded) return;
        getRoomDirectoryVisibility(room.roomId)
            .then((v) => {
                setDirVisibility(v);
                setDirLoaded(true);
            })
            .catch(() => setDirLoaded(true));
    }, [activeTab, dirLoaded, room.roomId]);

    async function toggleDirVisibility(next: "public" | "private") {
        if (dirSaving || next === dirVisibility) return;
        setDirSaving(true);
        setDirError("");
        const prev = dirVisibility;
        setDirVisibility(next);
        try {
            await setRoomDirectoryVisibility(room.roomId, next);
        } catch (e: any) {
            setDirVisibility(prev);
            setDirError(
                e?.data?.error ??
                    e?.message ??
                    t("roomSettings.couldNotChangeVisibility"),
            );
        } finally {
            setDirSaving(false);
        }
    }

    // ── Access tab: published addresses (separate directory calls) ─────────────
    const [localAliases, setLocalAliases] = useState<string[]>([]);
    const [aliasesLoaded, setAliasesLoaded] = useState(false);
    // Adding a local alias only appends to `localAliases` and never touches the
    // canonical-alias state, so it gets its own busy flag: a slow directory add
    // no longer freezes Remove / Set-main (and vice-versa). Remove + Set-main
    // both mutate `canonicalContent`, so they stay serialized on `aliasBusy`.
    const [addAliasBusy, setAddAliasBusy] = useState(false);
    const [aliasBusy, setAliasBusy] = useState(false);
    const [aliasError, setAliasError] = useState("");
    const [newAliasLocalpart, setNewAliasLocalpart] = useState("");
    const [canonicalContent, setCanonicalContent] =
        useState<CanonicalAliasContent>({});
    const [mainAliasChoice, setMainAliasChoice] = useState("");
    const [ownServer] = useState(getOwnServerName);

    const canonicalAlias = canonicalContent.alias ?? null;
    const sortedAliases = sortAliasesForDisplay(localAliases, canonicalAlias);
    const newAliasCheck = validateAliasLocalpart(
        newAliasLocalpart.trim(),
        ownServer,
        localAliases,
    );
    /** Is the picked main address different from the one actually published? */
    const mainAliasDirty = mainAliasChoice !== (canonicalContent.alias ?? "");
    /**
     * Choices for the main-address select. The published alias may not be one
     * of OUR local mappings — it can live on another homeserver, or another
     * admin may have deleted the local mapping out of band. Carry it as an
     * extra option so it is at least visible and clearable. `sortedAliases` is
     * already deduplicated, and it is only prepended when genuinely absent.
     */
    const mainAliasOptions =
        canonicalAlias && !sortedAliases.includes(canonicalAlias)
            ? [canonicalAlias, ...sortedAliases]
            : sortedAliases;

    useEffect(() => {
        if (activeTab !== "access" || aliasesLoaded) return;
        const content = getCanonicalAliasContent(room);
        setCanonicalContent(content);
        setMainAliasChoice(content.alias ?? "");
        getLocalRoomAliases(room.roomId)
            .then((a) => {
                setLocalAliases(a);
                setAliasesLoaded(true);
            })
            .catch((e: any) => {
                setAliasError(
                    e?.data?.error ??
                        e?.message ??
                        t("roomSettings.couldNotLoadThisRoomS"),
                );
                setAliasesLoaded(true);
            });
    }, [activeTab, aliasesLoaded, room]);

    async function addAlias() {
        const localpart = newAliasLocalpart.trim();
        if (addAliasBusy || !newAliasCheck.valid) return;
        setAddAliasBusy(true);
        setAliasError("");
        const alias = buildAlias(localpart, ownServer);
        try {
            await createRoomAlias(alias, room.roomId);
            setLocalAliases((prev) => [...prev, alias]);
            setNewAliasLocalpart("");
        } catch (e: any) {
            setAliasError(
                e?.data?.error ??
                    e?.message ??
                    t("roomSettings.couldNotAddThatAddress"),
            );
        } finally {
            setAddAliasBusy(false);
        }
    }

    async function removeAlias(alias: string) {
        if (aliasBusy) return;
        setAliasBusy(true);
        setAliasError("");
        // Zami: what `canonicalContent` holds as this runs; state read after an
        // `await` here would be the render's, not the live value.
        let published = canonicalContent;
        try {
            // Unpublish first: a canonical alias pointing at a deleted mapping
            // advertises an address nobody can resolve.
            const next = canonicalAliasContentAfterRemoval(published, alias);
            // Refuse the whole removal when this address is still the canonical/
            // alt address and we lack permission to unpublish it — deleting the
            // mapping alone would strand m.room.canonical_alias on a dead address.
            if (next && !canSetCanonicalAlias) {
                setAliasError(t("roomSettings.thisAddressIsPublishedAsOne"));
                return;
            }
            if (next) {
                await setCanonicalAliasContent(room.roomId, next);
                published = next;
                setCanonicalContent(next);
                setMainAliasChoice(next.alias ?? "");
                roomsState.roomsTick++;
            }
            await deleteRoomAlias(alias);
            setLocalAliases((prev) => prev.filter((a) => a !== alias));
            // Drop a pending (unsaved) pick of the address we just deleted:
            // it would vanish from the options, rendering the select blank
            // while Set stayed enabled — one click from publishing a mapping
            // that no longer exists. Snap back to what is actually published.
            setMainAliasChoice((choice) =>
                choice === alias ? (published.alias ?? "") : choice,
            );
        } catch (e: any) {
            setAliasError(
                e?.data?.error ??
                    e?.message ??
                    t("roomSettings.couldNotRemoveThatAddress"),
            );
        } finally {
            setAliasBusy(false);
        }
    }

    async function saveMainAlias() {
        const choice = mainAliasChoice || null;
        if (aliasBusy || choice === (canonicalContent.alias ?? null)) return;
        setAliasBusy(true);
        setAliasError("");
        const prev = canonicalContent;
        try {
            const next = buildCanonicalAliasContent({
                alias: choice,
                altAliases: canonicalContent.alt_aliases ?? [],
            });
            await setCanonicalAliasContent(room.roomId, next);
            setCanonicalContent(next);
            roomsState.roomsTick++;
        } catch (e: any) {
            setCanonicalContent(prev);
            setMainAliasChoice(prev.alias ?? "");
            setAliasError(
                e?.data?.error ??
                    e?.message ??
                    t("roomSettings.couldNotSetTheMainAddress"),
            );
        } finally {
            setAliasBusy(false);
        }
    }

    // ── Permissions tab ────────────────────────────────────────────────────────
    const [plBan, setPlBan] = useState(() => pl.ban);
    const [plKick, setPlKick] = useState(() => pl.kick);
    const [plRedact, setPlRedact] = useState(() => pl.redact);
    const [plInvite, setPlInvite] = useState(() => pl.invite);
    const [plEventsDefault, setPlEventsDefault] = useState(
        () => pl.events_default,
    );
    const [plStateDefault, setPlStateDefault] = useState(
        () => pl.state_default,
    );
    const [plUsersDefault, setPlUsersDefault] = useState(
        () => pl.users_default,
    );
    const [plThreadName, setPlThreadName] = useState(() => threadNameLevel);
    // "Power to join voice/video calls" is not a top-level PL field — it lives in
    // the `events` map (the three call-member state-event types). The effective
    // level is the min the user must clear to send ANY of them (absent types fall
    // back to state_default). On save we merge all three back into the events map.
    const [plCallJoin, setPlCallJoin] = useState(() =>
        effectiveCallJoinLevel({
            events: pl.events,
            state_default: pl.state_default,
        }),
    );
    // Frozen snapshot of the levels the editor was seeded with, so a Save can
    // tell whether the user actually changed anything. Without this guard,
    // saving in a room that has NO m.room.power_levels event would materialize a
    // full PL event out of the defaults even on a no-op save.
    const [initialPerm] = useState(() => ({
        ban: pl.ban,
        kick: pl.kick,
        redact: pl.redact,
        invite: pl.invite,
        events_default: pl.events_default,
        state_default: pl.state_default,
        users_default: pl.users_default,
        threadName: threadNameLevel,
        callJoin: effectiveCallJoinLevel({
            events: pl.events,
            state_default: pl.state_default,
        }),
    }));
    const permInitial = useRef(initialPerm);
    // Re-seed once the real levels arrive (see stateLoaded), unless the user has
    // already started editing.
    const reseedPermissions = useEffectEvent(() => {
        const fresh = {
            ban: pl.ban,
            kick: pl.kick,
            redact: pl.redact,
            invite: pl.invite,
            events_default: pl.events_default,
            state_default: pl.state_default,
            users_default: pl.users_default,
            threadName: threadNameLevel,
            callJoin: effectiveCallJoinLevel({
                events: pl.events,
                state_default: pl.state_default,
            }),
        };
        const initial = permInitial.current;
        const untouched =
            plBan === initial.ban &&
            plKick === initial.kick &&
            plRedact === initial.redact &&
            plInvite === initial.invite &&
            plEventsDefault === initial.events_default &&
            plStateDefault === initial.state_default &&
            plUsersDefault === initial.users_default &&
            plThreadName === initial.threadName &&
            plCallJoin === initial.callJoin;
        if (!untouched) return;
        permInitial.current = fresh;
        setPlBan(fresh.ban);
        setPlKick(fresh.kick);
        setPlRedact(fresh.redact);
        setPlInvite(fresh.invite);
        setPlEventsDefault(fresh.events_default);
        setPlStateDefault(fresh.state_default);
        setPlUsersDefault(fresh.users_default);
        setPlThreadName(fresh.threadName);
        setPlCallJoin(fresh.callJoin);
    });
    useEffect(() => {
        if (!stateLoaded) return;
        reseedPermissions();
    }, [stateLoaded]);
    const [permSaving, setPermSaving] = useState(false);
    const [permError, setPermError] = useState("");
    const [permSuccess, setPermSuccess] = useState(false);

    async function savePermissions() {
        setPermError("");
        const initial = permInitial.current;
        // No-op save guard: if nothing changed, don't write a PL event (which,
        // in a room with none, would create one from the defaults).
        const callJoinChanged = plCallJoin !== initial.callJoin;
        const threadNameChanged = plThreadName !== initial.threadName;
        const changed =
            plBan !== initial.ban ||
            plKick !== initial.kick ||
            plRedact !== initial.redact ||
            plInvite !== initial.invite ||
            plEventsDefault !== initial.events_default ||
            plStateDefault !== initial.state_default ||
            plUsersDefault !== initial.users_default ||
            threadNameChanged ||
            callJoinChanged;
        if (!changed) {
            setPermSuccess(true);
            setTimeout(() => setPermSuccess(false), 2000);
            return;
        }
        setPermSaving(true);
        try {
            const updated: Parameters<typeof setRoomPowerLevels>[1] = {
                ban: plBan,
                kick: plKick,
                redact: plRedact,
                invite: plInvite,
                events_default: plEventsDefault,
                state_default: plStateDefault,
                users_default: plUsersDefault,
            };
            // Only touch the events map when the call-join level actually
            // changed, so a normal permissions save never materializes the three
            // call-member types into a room that inherited state_default. Merge
            // into the LIVE events map (pl is roomsTick-derived) to preserve every
            // other event-type override — setRoomPowerLevels replaces `events`
            // wholesale, so we must pass the full merged object, not a partial.
            if (callJoinChanged) {
                updated.events = mergeCallJoinLevel(pl.events, plCallJoin);
            }
            // Likewise: most rooms inherit the default and never carry this key.
            if (threadNameChanged) {
                updated[THREAD_NAME_POWER_LEVEL_KEY] = plThreadName;
            }
            await setRoomPowerLevels(room, updated);
            setPermSuccess(true);
            setTimeout(() => setPermSuccess(false), 2000);
        } catch (e: any) {
            setPermError(e?.message ?? t("roomSettings.failedToSave"));
        } finally {
            setPermSaving(false);
        }
    }

    // ── Members tab ────────────────────────────────────────────────────────────
    const [memberSearch, setMemberSearch] = useState("");
    const [showBanned, setShowBanned] = useState(false);
    const [memberActionPending, setMemberActionPending] = useState<
        string | null
    >(null);
    const [memberError, setMemberError] = useState("");
    const [plDrafts, setPlDrafts] = useState<Record<string, string>>({});
    const [reasonInputs, setReasonInputs] = useState<Record<string, string>>(
        {},
    );
    const [showReasonFor, setShowReasonFor] = useState<string | null>(null);
    const showMatrixIds = useRune(() => settingsState.showMatrixIds);
    // Zami: re-render when the ignore list changes, for `isUserBlocked` below.
    const blockedUserIds = useRune(() => ignoredUsersState.userIds);

    // Depend on roomsTick (bumped every sync + on membership changes) so the
    // list and power-level badges refresh after a kick/ban/role change echoes
    // back from the server, rather than only when the modal is reopened.
    // Zami: only on the Members tab, where they are read (upstream's
    // `$derived`s are lazy).
    const membersShown = activeTab === "members";
    const allMembers = useMemo(() => {
        void roomsTick;
        return membersShown ? getRoomMembers(room) : [];
    }, [roomsTick, room, membersShown]);
    const bannedMembers = useMemo(() => {
        void roomsTick;
        return membersShown ? getBannedMembers(room) : [];
    }, [roomsTick, room, membersShown]);
    const knockingMembers = useMemo(() => {
        void roomsTick;
        return membersShown ? getKnockingMembers(room) : [];
    }, [roomsTick, room, membersShown]);
    // A moderator who can approve (invite) OR deny (kick) a knock; tick so the
    // section shows/hides live on a promote/demote.
    const canModerateKnocks = canInvite || canKick;

    const filteredMembers = useMemo(
        () =>
            allMembers
                .filter(
                    (m) =>
                        !memberSearch ||
                        m.name
                            .toLowerCase()
                            .includes(memberSearch.toLowerCase()) ||
                        m.userId
                            .toLowerCase()
                            .includes(memberSearch.toLowerCase()),
                )
                .sort((a, b) => {
                    // Rank, highest first. Subtraction would be NaN for two
                    // Infinity creators, so compare explicitly.
                    const ra = getUserPowerRank(room, a.userId);
                    const rb = getUserPowerRank(room, b.userId);
                    if (ra !== rb) return ra > rb ? -1 : 1;
                    return a.name.localeCompare(b.name);
                }),
        [allMembers, memberSearch, room],
    );

    async function doKick(userId: string) {
        setMemberActionPending(userId);
        setMemberError("");
        try {
            await kickUser(room.roomId, userId, reasonInputs[userId]);
            setShowReasonFor(null);
        } catch (e: any) {
            setMemberError(e?.message ?? t("roomSettings.failed"));
        } finally {
            setMemberActionPending(null);
        }
    }

    async function doBan(userId: string) {
        setMemberActionPending(userId);
        setMemberError("");
        try {
            await banUser(room.roomId, userId, reasonInputs[userId]);
            setShowReasonFor(null);
        } catch (e: any) {
            setMemberError(e?.message ?? t("roomSettings.failed"));
        } finally {
            setMemberActionPending(null);
        }
    }

    async function doToggleBlock(userId: string) {
        setMemberActionPending(userId);
        setMemberError("");
        try {
            if (isUserBlocked(userId)) await unblockUser(userId);
            else await blockUser(userId);
        } catch (e: any) {
            setMemberError(e?.message ?? t("roomSettings.failed"));
        } finally {
            setMemberActionPending(null);
        }
    }

    async function doUnban(userId: string) {
        setMemberActionPending(userId);
        setMemberError("");
        try {
            await unbanUser(room.roomId, userId);
        } catch (e: any) {
            setMemberError(e?.message ?? t("roomSettings.failed"));
        } finally {
            setMemberActionPending(null);
        }
    }

    async function doApproveKnock(userId: string) {
        setMemberActionPending(userId);
        setMemberError("");
        try {
            await inviteUser(room.roomId, userId);
        } catch (e: any) {
            setMemberError(e?.message ?? t("roomSettings.failed"));
        } finally {
            setMemberActionPending(null);
        }
    }

    async function doDenyKnock(userId: string) {
        setMemberActionPending(userId);
        setMemberError("");
        try {
            await kickUser(room.roomId, userId);
        } catch (e: any) {
            setMemberError(e?.message ?? t("roomSettings.failed"));
        } finally {
            setMemberActionPending(null);
        }
    }

    async function doSetPowerLevel(member: RoomMember, level: number) {
        setMemberActionPending(member.userId);
        setMemberError("");
        try {
            await setUserPowerLevel(room, member.userId, level);
        } catch (e: any) {
            setMemberError(e?.message ?? t("roomSettings.failed"));
        } finally {
            setMemberActionPending(null);
        }
    }

    function plLabel(level: number): string {
        if (level < 0) return t("roomSettings.muted");
        if (level >= 100) return t("roomSettings.admin");
        if (level >= 50) return t("roomSettings.moderator");
        return t("roomSettings.member");
    }

    // ── Rooms tab (spaces only) ────────────────────────────────────────────────
    const [spaceChildren, setSpaceChildren] = useState<SpaceChildEntry[]>([]);
    const [roomsError, setRoomsError] = useState("");
    const [roomActionPending, setRoomActionPending] = useState<string | null>(
        null,
    );
    const [orderEdits, setOrderEdits] = useState<Record<string, string>>({});

    function sortChildren(children: SpaceChildEntry[]) {
        return [...children].sort((a, b) => {
            if (a.order && b.order) return a.order.localeCompare(b.order);
            if (a.order) return -1;
            if (b.order) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    function loadChildren() {
        const hierarchyMap = new Map(
            roomsState.spaceHierarchy.map((r) => [r.roomId, r]),
        );
        const children = getSpaceChildren(room).map((c) => {
            const h = hierarchyMap.get(c.roomId);
            return {
                ...c,
                name: c.isJoined ? c.name : (h?.name ?? c.name),
                avatarUrl: c.isJoined
                    ? c.avatarUrl
                    : (h?.avatarUrl ?? c.avatarUrl),
            };
        });
        const sorted = sortChildren(children);
        setSpaceChildren(sorted);
        // Reset input values to match current server state
        setOrderEdits(
            Object.fromEntries(sorted.map((c) => [c.roomId, c.order])),
        );
    }

    const showRoomsTab = useEffectEvent(() => {
        setOrderEdits({}); // reset so loadChildren sets fresh values
        loadChildren();
    });
    useEffect(() => {
        if (activeTab === "rooms" && isSpace) showRoomsTab();
    }, [activeTab, isSpace]);

    async function saveOrder(child: SpaceChildEntry) {
        setRoomActionPending(child.roomId);
        setRoomsError("");
        try {
            const newOrder = orderEdits[child.roomId] ?? "";
            await setSpaceChildOrder(
                room.roomId,
                child.roomId,
                newOrder,
                child.via,
            );
            // Update child's order directly and re-sort (server state may not have synced yet)
            setSpaceChildren((prev) =>
                sortChildren(
                    prev.map((c) =>
                        c.roomId === child.roomId
                            ? { ...c, order: newOrder }
                            : c,
                    ),
                ),
            );
            onUpdate?.();
        } catch (e: any) {
            setRoomsError(e?.message ?? t("roomSettings.failed"));
        } finally {
            setRoomActionPending(null);
        }
    }

    async function doRemoveChild(child: SpaceChildEntry) {
        setRoomActionPending(child.roomId);
        setRoomsError("");
        try {
            await removeSpaceChild(room.roomId, child.roomId);
            setSpaceChildren((prev) =>
                prev.filter((c) => c.roomId !== child.roomId),
            );
            onUpdate?.();
        } catch (e: any) {
            setRoomsError(e?.message ?? t("roomSettings.failed"));
        } finally {
            setRoomActionPending(null);
        }
    }

    async function toggleSuggested(child: SpaceChildEntry) {
        setRoomActionPending(child.roomId);
        setRoomsError("");
        try {
            const next = !child.suggested;
            await setSpaceChildSuggested(room.roomId, child.roomId, next);
            setSpaceChildren((prev) =>
                prev.map((c) =>
                    c.roomId === child.roomId ? { ...c, suggested: next } : c,
                ),
            );
            onUpdate?.();
        } catch (e) {
            setRoomsError(
                e instanceof Error
                    ? e.message
                    : t("roomSettings.failedToUpdateSuggestion"),
            );
        } finally {
            setRoomActionPending(null);
        }
    }

    const tabs = roomSettingsTabs({ isSpace, pluginTabs });

    // Zami: Zam's panel fills the viewport on mobile (`h-[100dvh]`); here it
    // keeps clear of the status bar, notch and home indicator.
    const insets = useSafeAreaInsets();

    function stateLoading(): ReactNode {
        return stateLoadError ? (
            <>
                <Text className="text-sm text-discord-danger">
                    {stateLoadError}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    onPress={loadFullState}
                    className="mt-2 self-start px-4 py-2 bg-discord-accent hover:bg-discord-accentHover rounded transition-colors"
                >
                    <Text className="text-white font-medium text-sm">
                        {t("common.retry")}
                    </Text>
                </Pressable>
            </>
        ) : (
            <Text className="text-sm text-discord-textMuted">
                {t("common.loading")}
            </Text>
        );
    }

    const trustBanner = stateTrust.unverified ? (
        <View className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <Text className="text-sm font-semibold text-amber-400">
                {stateTrust.label}
            </Text>
            <Text className="mt-1 text-sm text-discord-textMuted">
                {stateTrust.tooltip}
            </Text>
        </View>
    ) : null;

    // The Permissions tab's scalar rows.
    const bindings: Record<string, number> = {
        plEventsDefault,
        plStateDefault,
        plUsersDefault,
        plInvite,
        plKick,
        plBan,
        plRedact,
        plThreadName,
    };
    const setters: Record<string, (v: number) => void> = {
        plEventsDefault: (v) => setPlEventsDefault(v),
        plStateDefault: (v) => setPlStateDefault(v),
        plUsersDefault: (v) => setPlUsersDefault(v),
        plInvite: (v) => setPlInvite(v),
        plKick: (v) => setPlKick(v),
        plBan: (v) => setPlBan(v),
        plRedact: (v) => setPlRedact(v),
        plThreadName: (v) => setPlThreadName(v),
    };

    function memberIdentity(member: RoomMember, suffix = ""): ReactNode {
        return (
            <View className="flex-1 min-w-0">
                <Text
                    numberOfLines={1}
                    className="text-sm font-medium text-discord-textPrimary truncate"
                >
                    {memberDisplayName(member)}
                    {suffix}
                </Text>
                {showMatrixIds && (
                    <Text
                        numberOfLines={1}
                        className="text-xs text-discord-textMuted truncate"
                    >
                        {member.userId}
                    </Text>
                )}
            </View>
        );
    }

    function knockRow(member: RoomMember): ReactNode {
        const reason = getMemberKnockReason(member);
        return (
            <View
                key={member.userId}
                className="rounded bg-discord-backgroundTertiary overflow-hidden"
            >
                <View className="flex-row items-center gap-3 p-2">
                    <Avatar
                        src={mxcToHttp(member.getMxcAvatarUrl())}
                        name={member.name}
                        id={member.userId}
                        size={28}
                    />
                    {memberIdentity(member)}
                    <View className="flex-row gap-2 flex-shrink-0">
                        {canKick && (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => void doDenyKnock(member.userId)}
                                disabled={memberActionPending === member.userId}
                                className="px-2.5 py-1 rounded border border-discord-divider hover:bg-discord-danger hover:border-discord-danger transition-colors disabled:opacity-50"
                            >
                                <Text className="text-xs font-semibold text-discord-textMuted hover:text-white">
                                    {t("roomSettings.deny")}
                                </Text>
                            </Pressable>
                        )}
                        {canInvite && (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() =>
                                    void doApproveKnock(member.userId)
                                }
                                disabled={memberActionPending === member.userId}
                                className="px-2.5 py-1 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-50"
                            >
                                <Text className="text-xs font-semibold text-white">
                                    {t("roomSettings.approve")}
                                </Text>
                            </Pressable>
                        )}
                    </View>
                </View>
                {reason ? (
                    <Text className="px-3 pb-2 -mt-1 text-xs text-discord-textMuted">
                        "{reason}"
                    </Text>
                ) : null}
            </View>
        );
    }

    function bannedRow(member: RoomMember) {
        return (
            <View className="flex-row items-center gap-3 p-2 rounded bg-discord-backgroundTertiary">
                <Avatar
                    src={mxcToHttp(member.getMxcAvatarUrl())}
                    name={member.name}
                    id={member.userId}
                    size={28}
                />
                {memberIdentity(member)}
                {canBan && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void doUnban(member.userId)}
                        disabled={memberActionPending === member.userId}
                        className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                    >
                        <Text className="text-xs font-semibold text-discord-textPrimary">
                            {t("roomSettings.unban")}
                        </Text>
                    </Pressable>
                )}
            </View>
        );
    }

    function memberRow(member: RoomMember) {
        const isSelf = member.userId === authUserId;
        // roomsTick: the SDK member object is reused across syncs, so nothing
        // else re-runs this after a level change.
        const memberPl = getUserPowerLevel(room, member.userId);
        const memberRank = getUserPowerRank(room, member.userId);
        const isCreatorMember = hasImmutableCreatorPower(room, member.userId);
        const canActOnMember = !isSelf && myPowerRank > memberRank;
        const plResult = parseMutePowerLevelInput(
            plDrafts[member.userId] ?? String(memberPl),
            myPowerLevel,
        );
        const pending = memberActionPending === member.userId;
        return (
            <View className="rounded bg-discord-backgroundTertiary overflow-hidden">
                <View className="flex-row items-center gap-3 p-2">
                    <Avatar
                        src={mxcToHttp(member.getMxcAvatarUrl())}
                        name={member.name}
                        id={member.userId}
                        size={28}
                    />
                    {memberIdentity(
                        member,
                        isSelf ? t("roomSettings.you") : "",
                    )}
                    <Text className="text-xs text-discord-textMuted flex-shrink-0">
                        {isCreatorMember
                            ? t("roomSettings.creatorLabel")
                            : `${plLabel(memberPl)} (${memberPl})`}
                    </Text>
                    {!isSelf && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("common.actions")}
                            accessibilityState={{
                                expanded: showReasonFor === member.userId,
                            }}
                            onPress={() =>
                                setShowReasonFor(
                                    showReasonFor === member.userId
                                        ? null
                                        : member.userId,
                                )
                            }
                            className="p-1 rounded hover:bg-discord-messageHover transition-colors"
                        >
                            <SvgIcon
                                d={MORE_ICON}
                                className="w-4 h-4 text-discord-textMuted"
                            />
                        </Pressable>
                    )}
                </View>
                {showReasonFor === member.userId && !isSelf && (
                    <View className="px-3 pb-3 pt-1 border-t border-discord-divider gap-2">
                        {canActOnMember && (canKick || canBan) && (
                            <TextInput
                                value={reasonInputs[member.userId] ?? ""}
                                onChangeText={(value) =>
                                    setReasonInputs((prev) => ({
                                        ...prev,
                                        [member.userId]: value,
                                    }))
                                }
                                placeholder={t("common.reasonOptional")}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                className="w-full bg-discord-backgroundSecondary text-discord-textPrimary text-xs rounded px-2 py-1.5 border border-transparent focus:border-discord-accent/50"
                            />
                        )}
                        <View className="flex-row flex-wrap items-center gap-2">
                            {!isCreatorMember &&
                                (myPowerLevel >= 100 ||
                                    myPowerRank > memberRank) && (
                                    <>
                                        {/* Zami: the `<select>` keeps showing
                                            "Set role", as the DOM's does until a
                                            pick; picking that placeholder is no
                                            change, so it fires nothing. */}
                                        <Select
                                            value=""
                                            onChange={(value) => {
                                                if (value === "") return;
                                                void doSetPowerLevel(
                                                    member,
                                                    Number(value),
                                                );
                                            }}
                                            disabled={pending}
                                            accessibilityLabel={t(
                                                "roomSettings.setRole",
                                            )}
                                            options={[
                                                {
                                                    value: "",
                                                    label: t(
                                                        "roomSettings.setRole",
                                                    ),
                                                },
                                                ...(myPowerLevel >= 100
                                                    ? [
                                                          {
                                                              value: "100",
                                                              label: t(
                                                                  "roomSettings.admin100",
                                                              ),
                                                          },
                                                      ]
                                                    : []),
                                                ...(myPowerLevel >= 50
                                                    ? [
                                                          {
                                                              value: "50",
                                                              label: t(
                                                                  "roomSettings.moderator50",
                                                              ),
                                                          },
                                                      ]
                                                    : []),
                                                {
                                                    value: "0",
                                                    label: t(
                                                        "roomSettings.member0",
                                                    ),
                                                },
                                                {
                                                    value: "-1",
                                                    label: t(
                                                        "roomSettings.muted1",
                                                    ),
                                                },
                                            ]}
                                            className="w-36 px-2 py-1 rounded bg-discord-backgroundSecondary border border-discord-divider disabled:opacity-50"
                                        />
                                        <TextInput
                                            keyboardType="numbers-and-punctuation"
                                            value={
                                                plDrafts[member.userId] ??
                                                String(memberPl)
                                            }
                                            onChangeText={(value) =>
                                                setPlDrafts((prev) => ({
                                                    ...prev,
                                                    [member.userId]: value,
                                                }))
                                            }
                                            editable={!pending}
                                            accessibilityLabel={t(
                                                "roomSettings.setRole",
                                            )}
                                            className="w-16 px-2 py-1 rounded text-xs bg-discord-backgroundSecondary text-discord-textPrimary border border-discord-divider disabled:opacity-50"
                                        />
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() =>
                                                void doSetPowerLevel(
                                                    member,
                                                    plResult.value!,
                                                )
                                            }
                                            disabled={!plResult.ok || pending}
                                            className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                                        >
                                            <Text className="text-xs font-semibold text-discord-textPrimary">
                                                {t("roomSettings.set")}
                                            </Text>
                                        </Pressable>
                                        {!plResult.ok && (
                                            <Text className="text-xs text-discord-danger w-full">
                                                {plResult.error}
                                            </Text>
                                        )}
                                    </>
                                )}
                            {canActOnMember && canKick && (
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => void doKick(member.userId)}
                                    disabled={pending}
                                    className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-warning/20 transition-colors disabled:opacity-50"
                                >
                                    <Text className="text-xs font-semibold text-discord-warning">
                                        {t("roomSettings.kick")}
                                    </Text>
                                </Pressable>
                            )}
                            {canActOnMember && canBan && (
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => void doBan(member.userId)}
                                    disabled={pending}
                                    className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-danger/20 transition-colors disabled:opacity-50"
                                >
                                    <Text className="text-xs font-semibold text-discord-danger">
                                        {t("roomSettings.ban")}
                                    </Text>
                                </Pressable>
                            )}
                            {isUserBlocked(member.userId) ? (
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() =>
                                        void doToggleBlock(member.userId)
                                    }
                                    disabled={pending}
                                    className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                                >
                                    <Text className="text-xs font-semibold text-discord-textPrimary">
                                        {t("common.unblock")}
                                    </Text>
                                </Pressable>
                            ) : (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityHint={t(
                                        "roomSettings.hideThisUserSMessagesEverywhere",
                                    )}
                                    onPress={() =>
                                        void doToggleBlock(member.userId)
                                    }
                                    disabled={pending}
                                    className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-danger/20 transition-colors disabled:opacity-50"
                                >
                                    <Text className="text-xs font-semibold text-discord-danger">
                                        {t("common.block")}
                                    </Text>
                                </Pressable>
                            )}
                        </View>
                    </View>
                )}
            </View>
        );
    }

    // The Members tab above its list: invite, search, the banned toggle, the
    // error and the pending join requests.
    const membersHeader = (
        <View className="gap-3 pb-3">
            <View className="flex-row items-center gap-3">
                {canInvite && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => setShowInvite(true)}
                        className="px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors"
                    >
                        <Text className="text-sm font-medium text-white">
                            {t("roomSettings.invite")}
                        </Text>
                    </Pressable>
                )}
                <TextInput
                    value={memberSearch}
                    onChangeText={setMemberSearch}
                    placeholder={t("roomSettings.searchMembers")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityLabel={t("roomSettings.searchMembers")}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="flex-1 min-w-0 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-1.5 border border-transparent focus:border-discord-accent/50"
                />
                {canBan && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: showBanned }}
                        onPress={() => setShowBanned(!showBanned)}
                        className={`px-3 py-1.5 rounded transition-colors ${
                            showBanned
                                ? "bg-discord-danger"
                                : "bg-discord-backgroundTertiary"
                        }`}
                    >
                        <Text
                            className={`text-sm font-medium ${
                                showBanned
                                    ? "text-white"
                                    : "text-discord-textMuted hover:text-discord-textPrimary"
                            }`}
                        >
                            {t("roomSettings.banned", {
                                length: bannedMembers.length,
                            })}
                        </Text>
                    </Pressable>
                )}
            </View>

            {memberError ? (
                <Text className="text-sm text-discord-danger">
                    {memberError}
                </Text>
            ) : null}

            {canModerateKnocks && knockingMembers.length > 0 && (
                <View className="gap-1">
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                        {t("roomSettings.pendingJoinRequests", {
                            length: knockingMembers.length,
                        })}
                    </Text>
                    {knockingMembers.map((member) => knockRow(member))}
                </View>
            )}
        </View>
    );

    const textInputClass =
        "w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 border border-transparent focus:border-discord-accent/50 disabled:opacity-50";

    return (
        <Portal>
            {/* Zam's layer is `position: fixed`; here it is rendered at the app
                root through the Portal, as an absolute-fill layer. */}
            <View
                pointerEvents="box-none"
                className="absolute inset-0 z-50 flex-row items-center justify-center p-0 md:p-4"
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("roomSettings.closeSettings")}
                    className="absolute inset-0 bg-black/60"
                    onPress={onClose}
                />
                {/* No `onEscape` on purpose: Escape is owned by
                    AppShell.dismissTopmost(), so the mobile sub-page pops before
                    the dialog closes (see dismissTopmost above). */}
                <View
                    role="dialog"
                    accessibilityViewIsModal
                    aria-labelledby="room-settings-title"
                    onAccessibilityEscape={dismissTopmost}
                    className="relative z-10 shrink bg-discord-backgroundSecondary rounded-none md:rounded-xl shadow-2xl w-full max-w-2xl flex-col overflow-hidden h-full md:h-[85%]"
                    style={
                        isMobile
                            ? {
                                  paddingTop: insets.top,
                                  paddingBottom: insets.bottom,
                                  paddingLeft: insets.left,
                                  paddingRight: insets.right,
                              }
                            : undefined
                    }
                >
                    {/* Header. On a mobile sub-page the close button is replaced
                        by a back arrow and the title names the category. */}
                    <View className="flex-row items-center gap-2 px-6 py-4 border-b border-discord-divider flex-shrink-0">
                        {view.mode === "detail" && (
                            <Pressable
                                ref={backButtonEl}
                                accessibilityRole="button"
                                accessibilityLabel={t(
                                    "roomSettings.backToSettings",
                                )}
                                onPress={goBackToList}
                                className="-ms-2 p-1.5 rounded hover:bg-discord-messageHover transition-colors flex-shrink-0"
                            >
                                {/* Zami: `mirror:` (`:dir(rtl)`) → Uniwind's `rtl:`. */}
                                <ArrowLeft
                                    size={20}
                                    className="rtl:-scale-x-100 text-discord-textMuted"
                                />
                            </Pressable>
                        )}
                        {/* This heading IS the dialog's accessible name
                            (aria-labelledby), and on a sub-page the visible text
                            is only the category — so name the room for screen
                            readers without repeating it on screen. */}
                        <Text
                            nativeID="room-settings-title"
                            role="heading"
                            accessibilityLabel={
                                view.mode === "detail"
                                    ? `${room.name} - ${roomSettingsTabLabel(view.tab, pluginTabs)}`
                                    : undefined
                            }
                            numberOfLines={1}
                            className="text-lg font-bold text-discord-textPrimary min-w-0 truncate flex-1"
                        >
                            {view.mode === "detail"
                                ? roomSettingsTabLabel(view.tab, pluginTabs)
                                : t("roomSettings.settings", {
                                      name: room.name,
                                  })}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("roomSettings.closeSettings")}
                            onPress={onClose}
                            className="p-1.5 rounded hover:bg-discord-messageHover transition-colors flex-shrink-0"
                        >
                            <SvgIcon
                                d={CLOSE_ICON}
                                className="w-5 h-5 text-discord-textMuted"
                            />
                        </Pressable>
                    </View>

                    {view.mode === "list" ? (
                        // Mobile root: drill-down category list.
                        <ScrollView
                            className="flex-1"
                            contentContainerClassName="py-2"
                        >
                            {tabs.map((tab, i) => (
                                <Pressable
                                    key={tab.id}
                                    ref={(el) => {
                                        categoryEls.current[i] = el;
                                    }}
                                    accessibilityRole="button"
                                    onPress={() => {
                                        setSelectedTab(tab.id);
                                        setShowInvite(false);
                                    }}
                                    className="w-full flex-row items-center justify-between gap-3 px-6 py-3.5 hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                                >
                                    <Text
                                        numberOfLines={1}
                                        className="min-w-0 shrink truncate text-base font-medium text-discord-textPrimary"
                                    >
                                        {tab.label}
                                    </Text>
                                    <ChevronRight
                                        size={20}
                                        className="rtl:-scale-x-100 flex-shrink-0 text-discord-textMuted"
                                    />
                                </Pressable>
                            ))}
                        </ScrollView>
                    ) : (
                        <View className="flex-row flex-1 min-h-0">
                            {view.mode === "desktop" && (
                                // Desktop: category sidebar beside the active panel.
                                <ScrollView
                                    className="flex-shrink-0 grow-0 w-40 border-e border-discord-divider min-h-0"
                                    contentContainerClassName="gap-0.5 px-2 py-3"
                                >
                                    {tabs.map((tab) => (
                                        <Pressable
                                            key={tab.id}
                                            ref={(el) => {
                                                sidebarEls.current[tab.id] = el;
                                            }}
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                selected: activeTab === tab.id,
                                            }}
                                            onPress={() => {
                                                setSelectedTab(tab.id);
                                                setShowInvite(false);
                                            }}
                                            className={`flex-shrink-0 w-full px-3 py-2 rounded transition-colors ${
                                                activeTab === tab.id
                                                    ? "bg-discord-messageHover"
                                                    : ""
                                            }`}
                                        >
                                            <Text
                                                numberOfLines={1}
                                                className={`text-sm font-medium ${
                                                    activeTab === tab.id
                                                        ? "text-discord-textPrimary"
                                                        : "text-discord-textMuted"
                                                }`}
                                            >
                                                {tab.label}
                                            </Text>
                                        </Pressable>
                                    ))}
                                </ScrollView>
                            )}

                            {/* Tab content */}
                            {activeTab === "members" && !showInvite ? (
                                // Zami: the Members tab's scroll box is the
                                // member list itself (a FlatList, so a large room
                                // renders only the rows on screen); the banner and
                                // the toolbar above the list are its header.
                                <FlatList
                                    className="flex-1 min-w-0"
                                    contentContainerClassName="p-4 md:p-6"
                                    data={
                                        showBanned
                                            ? bannedMembers
                                            : filteredMembers
                                    }
                                    extraData={{
                                        showReasonFor,
                                        plDrafts,
                                        reasonInputs,
                                        memberActionPending,
                                        blockedUserIds,
                                        showMatrixIds,
                                        roomsTick,
                                    }}
                                    keyExtractor={(member) => member.userId}
                                    keyboardShouldPersistTaps="handled"
                                    renderScrollComponent={(props) => (
                                        <KeyboardAwareScrollView {...props} />
                                    )}
                                    ListHeaderComponent={
                                        <>
                                            {trustBanner}
                                            {membersHeader}
                                        </>
                                    }
                                    ItemSeparatorComponent={MemberGap}
                                    renderItem={({ item: member }) =>
                                        // Banned members, or the active ones.
                                        showBanned
                                            ? bannedRow(member)
                                            : memberRow(member)
                                    }
                                    ListEmptyComponent={
                                        showBanned ? (
                                            <Text className="text-sm text-discord-textMuted text-center py-4">
                                                {t(
                                                    "roomSettings.noBannedMembers",
                                                )}
                                            </Text>
                                        ) : undefined
                                    }
                                />
                            ) : (
                                <ScrollArea
                                    className="flex-1 min-w-0"
                                    contentContainerClassName="p-4 md:p-6"
                                    keyboardShouldPersistTaps="handled"
                                >
                                    {trustBanner}

                                    {/* ── Plugin tab ────────────────────────────────────── */}
                                    {activePluginTab ? (
                                        // Zami: the plugin builds DOM into the
                                        // element (pluginMount), which DomView
                                        // shows.
                                        <DomMount
                                            key={`${activePluginTab.entryId}:${room.roomId}`}
                                            document={document}
                                            mount={(el) => {
                                                const tab = activePluginTab;
                                                el.setAttribute(
                                                    "data-zam-plugin",
                                                    tab.pluginId,
                                                );
                                                return pluginMount(el, (el) =>
                                                    tab.value.render(el, {
                                                        roomId: room.roomId,
                                                        isSpace,
                                                    }),
                                                ).destroy;
                                            }}
                                        />
                                    ) : /* ── General ─────────────────────────────────────────── */
                                    activeTab === "general" ? (
                                        <View className="gap-5">
                                            {/* Avatar */}
                                            <View>
                                                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                                                    {t(
                                                        "roomSettings.roomAvatar",
                                                    )}
                                                </Text>
                                                <View className="flex-row items-center gap-4">
                                                    <View className="w-16 h-16 rounded-full bg-discord-backgroundTertiary overflow-hidden flex-shrink-0 items-center justify-center">
                                                        {currentAvatarUrl ? (
                                                            <Image
                                                                source={mediaSource(
                                                                    currentAvatarUrl,
                                                                )}
                                                                contentFit="cover"
                                                                className="w-full h-full"
                                                            />
                                                        ) : (
                                                            <Text className="text-2xl font-bold text-discord-textMuted">
                                                                {room.name?.[0]?.toUpperCase() ??
                                                                    "#"}
                                                            </Text>
                                                        )}
                                                    </View>
                                                    {canEditState && (
                                                        <Pressable
                                                            accessibilityRole="button"
                                                            onPress={() =>
                                                                void handleAvatarUpload()
                                                            }
                                                            disabled={
                                                                avatarUploading
                                                            }
                                                            className={`px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover transition-colors ${
                                                                avatarUploading
                                                                    ? "opacity-50"
                                                                    : ""
                                                            }`}
                                                        >
                                                            <Text className="text-discord-textPrimary text-sm font-medium">
                                                                {avatarUploading
                                                                    ? t(
                                                                          "common.uploading",
                                                                      )
                                                                    : t(
                                                                          "common.uploadImage",
                                                                      )}
                                                            </Text>
                                                        </Pressable>
                                                    )}
                                                </View>
                                            </View>

                                            {/* Name */}
                                            <View>
                                                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                                    {t("roomSettings.roomName")}
                                                </Text>
                                                <TextInput
                                                    nativeID="room-settings-name"
                                                    accessibilityLabel={t(
                                                        "roomSettings.roomName",
                                                    )}
                                                    value={nameInput}
                                                    onChangeText={setNameInput}
                                                    editable={canEditState}
                                                    className={textInputClass}
                                                />
                                            </View>

                                            {/* Topic */}
                                            <View>
                                                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                                    {t("common.topic")}
                                                </Text>
                                                {/* Zami: rows="3" → numberOfLines
                                                    (Android) and a three-line
                                                    minimum height. */}
                                                <TextInput
                                                    nativeID="room-settings-topic"
                                                    accessibilityLabel={t(
                                                        "common.topic",
                                                    )}
                                                    value={topicInput}
                                                    onChangeText={setTopicInput}
                                                    editable={canEditState}
                                                    multiline
                                                    numberOfLines={3}
                                                    textAlignVertical="top"
                                                    className={`min-h-[76px] ${textInputClass}`}
                                                />
                                            </View>

                                            {generalError ? (
                                                <Text className="text-sm text-discord-danger">
                                                    {generalError}
                                                </Text>
                                            ) : null}
                                            {canEditState && (
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        void saveGeneral()
                                                    }
                                                    disabled={generalSaving}
                                                    className="self-start px-4 py-2 bg-discord-accent hover:bg-discord-accentHover rounded transition-colors disabled:opacity-50"
                                                >
                                                    <Text className="text-white font-medium text-sm">
                                                        {generalSaving
                                                            ? t("common.saving")
                                                            : generalSuccess
                                                              ? t(
                                                                    "roomSettings.saved",
                                                                )
                                                              : t(
                                                                    "roomSettings.saveChanges",
                                                                )}
                                                    </Text>
                                                </Pressable>
                                            )}

                                            <View className="pt-4 mt-2 border-t border-discord-backgroundTertiary gap-3">
                                                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                                                    {t("roomSettings.advanced")}
                                                </Text>

                                                {/* Room / Space ID (read-only, copyable) */}
                                                <View>
                                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                                        {isSpace
                                                            ? t(
                                                                  "roomSettings.spaceId",
                                                              )
                                                            : t(
                                                                  "roomSettings.roomId",
                                                              )}
                                                    </Text>
                                                    <View className="flex-row items-center gap-2">
                                                        {/* Zami: `<code>`'s box as
                                                            a View, which clips its
                                                            rounded background. */}
                                                        <View className="flex-1 min-w-0 bg-discord-backgroundTertiary rounded px-3 py-2">
                                                            <Text
                                                                selectable
                                                                numberOfLines={
                                                                    1
                                                                }
                                                                className="truncate text-discord-textPrimary text-xs font-mono"
                                                            >
                                                                {room.roomId}
                                                            </Text>
                                                        </View>
                                                        <Pressable
                                                            accessibilityRole="button"
                                                            onPress={() =>
                                                                void copyRoomId()
                                                            }
                                                            className="flex-shrink-0 px-3 py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover transition-colors"
                                                        >
                                                            <Text className="text-discord-textPrimary text-sm font-medium">
                                                                {idCopied
                                                                    ? t(
                                                                          "roomSettings.copied",
                                                                      )
                                                                    : t(
                                                                          "common.copy",
                                                                      )}
                                                            </Text>
                                                        </Pressable>
                                                    </View>
                                                </View>

                                                {!isSpace && roomVersionCap && (
                                                    <View className="gap-2">
                                                        <Text className="text-xs text-discord-textMuted">
                                                            {t(
                                                                "roomSettings.roomVersionV",
                                                                {
                                                                    getVersion:
                                                                        room.getVersion(),
                                                                },
                                                            )}
                                                        </Text>
                                                        {upgradeState.isCurrentLatest ||
                                                        !upgradeState.available ? (
                                                            <Text className="text-sm text-discord-textMuted">
                                                                {
                                                                    upgradeState.reason
                                                                }
                                                            </Text>
                                                        ) : !upgradeShowConfirm ? (
                                                            <Pressable
                                                                accessibilityRole="button"
                                                                onPress={() => {
                                                                    setUpgradeShowConfirm(
                                                                        true,
                                                                    );
                                                                    setUpgradeError(
                                                                        "",
                                                                    );
                                                                }}
                                                                className="self-start px-4 py-2 bg-discord-danger hover:opacity-90 rounded transition-colors"
                                                            >
                                                                <Text className="text-white font-medium text-sm">
                                                                    {t(
                                                                        "roomSettings.upgradeRoom",
                                                                    )}
                                                                </Text>
                                                            </Pressable>
                                                        ) : (
                                                            <View className="gap-2">
                                                                <Text className="text-sm text-discord-textPrimary">
                                                                    {t(
                                                                        "roomSettings.thisCreatesANewRoomOn",
                                                                        {
                                                                            recommendedVersion:
                                                                                upgradeState.recommendedVersion,
                                                                        },
                                                                    )}
                                                                </Text>
                                                                {roomVersionHasImmutableCreators(
                                                                    upgradeState.recommendedVersion,
                                                                ) && (
                                                                    <Details
                                                                        className="rounded border border-discord-divider px-3 py-2"
                                                                        summary={
                                                                            <Text className="shrink text-sm text-discord-textPrimary">
                                                                                {t(
                                                                                    "roomSettings.additionalCreators",
                                                                                )}{" "}
                                                                                <Text className="text-xs text-discord-textMuted">
                                                                                    {t(
                                                                                        "quickActions.optional",
                                                                                    )}
                                                                                </Text>
                                                                            </Text>
                                                                        }
                                                                    >
                                                                        <View className="mt-2 flex-col gap-2">
                                                                            <Text className="text-xs text-discord-textMuted">
                                                                                {t(
                                                                                    "roomSettings.additionalCreatorsHint",
                                                                                )}
                                                                            </Text>
                                                                            <UserPicker
                                                                                mode="multi"
                                                                                selected={
                                                                                    upgradeCreators
                                                                                }
                                                                                onSelectedChange={
                                                                                    setUpgradeCreators
                                                                                }
                                                                                excludeUserIds={
                                                                                    upgradeExcludeUserIds
                                                                                }
                                                                                disabled={
                                                                                    upgrading
                                                                                }
                                                                            />
                                                                        </View>
                                                                    </Details>
                                                                )}
                                                                {upgradeError ? (
                                                                    <Text className="text-sm text-discord-danger">
                                                                        {
                                                                            upgradeError
                                                                        }
                                                                    </Text>
                                                                ) : null}
                                                                <View className="flex-row gap-2">
                                                                    <Pressable
                                                                        accessibilityRole="button"
                                                                        onPress={() =>
                                                                            void doUpgradeRoom()
                                                                        }
                                                                        disabled={
                                                                            upgrading
                                                                        }
                                                                        className="px-4 py-2 bg-discord-danger hover:opacity-90 rounded transition-colors disabled:opacity-50"
                                                                    >
                                                                        <Text className="text-white font-medium text-sm">
                                                                            {upgrading
                                                                                ? t(
                                                                                      "roomSettings.upgrading",
                                                                                  )
                                                                                : t(
                                                                                      "roomSettings.upgradeRoom2",
                                                                                  )}
                                                                        </Text>
                                                                    </Pressable>
                                                                    <Pressable
                                                                        accessibilityRole="button"
                                                                        onPress={() => {
                                                                            setUpgradeShowConfirm(
                                                                                false,
                                                                            );
                                                                            setUpgradeError(
                                                                                "",
                                                                            );
                                                                            setUpgradeCreators(
                                                                                [],
                                                                            );
                                                                        }}
                                                                        disabled={
                                                                            upgrading
                                                                        }
                                                                        className="px-4 py-2 rounded hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                                                                    >
                                                                        <Text className="text-sm font-medium text-discord-textMuted hover:text-discord-textPrimary">
                                                                            {t(
                                                                                "common.cancel",
                                                                            )}
                                                                        </Text>
                                                                    </Pressable>
                                                                </View>
                                                            </View>
                                                        )}
                                                    </View>
                                                )}
                                            </View>
                                        </View>
                                    ) : /* ── Access ──────────────────────────────────────────── */
                                    activeTab === "access" ? (
                                        !stateLoaded ? (
                                            stateLoading()
                                        ) : (
                                            <View className="gap-5">
                                                <View>
                                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                                                        {t(
                                                            "roomSettings.whoCanJoin",
                                                        )}
                                                    </Text>
                                                    <View
                                                        accessibilityRole="radiogroup"
                                                        accessibilityLabel={t(
                                                            "roomSettings.whoCanJoin",
                                                        )}
                                                        className="gap-1.5"
                                                    >
                                                        {[
                                                            [
                                                                "invite",
                                                                "Invite only - members must be invited",
                                                            ],
                                                            [
                                                                "knock",
                                                                "Knock - users can request to join",
                                                            ],
                                                            [
                                                                "public",
                                                                "Public - anyone can join",
                                                            ],
                                                        ].map(
                                                            ([
                                                                value,
                                                                label,
                                                            ]) => (
                                                                <Radio
                                                                    key={value}
                                                                    value={
                                                                        value
                                                                    }
                                                                    group={
                                                                        joinRule
                                                                    }
                                                                    onChange={
                                                                        setJoinRuleChoice
                                                                    }
                                                                    label={
                                                                        label
                                                                    }
                                                                    disabled={
                                                                        !canEditState
                                                                    }
                                                                    className={`items-center gap-2.5 ${
                                                                        !canEditState
                                                                            ? "opacity-50"
                                                                            : ""
                                                                    }`}
                                                                />
                                                            ),
                                                        )}
                                                        <Radio
                                                            value={
                                                                RESTRICTED_JOIN_RULE
                                                            }
                                                            group={joinRule}
                                                            onChange={
                                                                setJoinRuleChoice
                                                            }
                                                            label={
                                                                parentSpaceNames
                                                                    ? t(
                                                                          "roomSettings.spaceMembersAnyoneInCanJoin",
                                                                          {
                                                                              parentSpaceNames,
                                                                          },
                                                                      )
                                                                    : t(
                                                                          "roomSettings.spaceMembersAnyoneInTheParent",
                                                                      )
                                                            }
                                                            disabled={
                                                                !restrictedJoin.available
                                                            }
                                                            className={`items-center gap-2.5 ${
                                                                !restrictedJoin.available
                                                                    ? "opacity-50"
                                                                    : ""
                                                            }`}
                                                        />
                                                        {restrictedJoin.reason ? (
                                                            <Text className="text-xs text-discord-textMuted ms-6">
                                                                {
                                                                    restrictedJoin.reason
                                                                }
                                                            </Text>
                                                        ) : null}
                                                    </View>
                                                </View>

                                                <View>
                                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                                                        {t(
                                                            "roomSettings.messageHistory",
                                                        )}
                                                    </Text>
                                                    <View
                                                        accessibilityRole="radiogroup"
                                                        accessibilityLabel={t(
                                                            "roomSettings.messageHistory",
                                                        )}
                                                        className="gap-1.5"
                                                    >
                                                        {[
                                                            [
                                                                "world_readable",
                                                                "Anyone (including guests)",
                                                            ],
                                                            [
                                                                "shared",
                                                                "Anyone once joined",
                                                            ],
                                                            [
                                                                "invited",
                                                                "Members since invited",
                                                            ],
                                                            [
                                                                "joined",
                                                                "Members since joining",
                                                            ],
                                                        ].map(
                                                            ([
                                                                value,
                                                                label,
                                                            ]) => (
                                                                <Radio
                                                                    key={value}
                                                                    value={
                                                                        value
                                                                    }
                                                                    group={
                                                                        historyVisibility
                                                                    }
                                                                    onChange={
                                                                        setHistoryVisibilityChoice
                                                                    }
                                                                    label={
                                                                        label
                                                                    }
                                                                    disabled={
                                                                        !canEditState
                                                                    }
                                                                    className={`items-center gap-2.5 ${
                                                                        !canEditState
                                                                            ? "opacity-50"
                                                                            : ""
                                                                    }`}
                                                                />
                                                            ),
                                                        )}
                                                    </View>
                                                </View>

                                                <View>
                                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                                                        {t(
                                                            "roomSettings.guestAccess",
                                                        )}
                                                    </Text>
                                                    <Checkbox
                                                        checked={
                                                            guestAccessAllowed
                                                        }
                                                        onChange={
                                                            setGuestAccessAllowed
                                                        }
                                                        disabled={!canEditState}
                                                        label={t(
                                                            "roomSettings.allowGuestsToJoinWithoutAn",
                                                        )}
                                                        className={`items-center gap-2.5 ${
                                                            !canEditState
                                                                ? "opacity-50"
                                                                : ""
                                                        }`}
                                                    />
                                                    <Text className="text-xs text-discord-textMuted mt-1">
                                                        {t(
                                                            "roomSettings.guestsAreAnonymousAccountsTheHomeserver",
                                                        )}
                                                    </Text>
                                                </View>

                                                <View>
                                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                                                        {t(
                                                            "roomSettings.discoverability",
                                                        )}
                                                    </Text>
                                                    <Checkbox
                                                        checked={
                                                            dirVisibility ===
                                                            "public"
                                                        }
                                                        onChange={(checked) =>
                                                            void toggleDirVisibility(
                                                                checked
                                                                    ? "public"
                                                                    : "private",
                                                            )
                                                        }
                                                        disabled={
                                                            !canEditState ||
                                                            dirSaving ||
                                                            !dirLoaded
                                                        }
                                                        label={
                                                            isSpace
                                                                ? t(
                                                                      "roomSettings.listThisSpaceInTheServerDirectory",
                                                                  )
                                                                : t(
                                                                      "roomSettings.listThisRoomInTheServerDirectory",
                                                                  )
                                                        }
                                                        className={`items-center gap-2.5 ${
                                                            !canEditState ||
                                                            dirSaving
                                                                ? "opacity-50"
                                                                : ""
                                                        }`}
                                                    />
                                                    <Text className="text-xs text-discord-textMuted mt-1">
                                                        {isSpace
                                                            ? t(
                                                                  "roomSettings.listsTheSpaceByIdBeingFound",
                                                              )
                                                            : t(
                                                                  "roomSettings.listsTheRoomByIdBeingFound",
                                                              )}
                                                    </Text>
                                                    {dirError ? (
                                                        <Text className="text-sm text-discord-danger mt-1">
                                                            {dirError}
                                                        </Text>
                                                    ) : null}
                                                </View>

                                                <View>
                                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                                                        {t(
                                                            "roomSettings.addresses",
                                                        )}
                                                    </Text>
                                                    <Text className="text-xs text-discord-textMuted mb-2">
                                                        {isSpace
                                                            ? t(
                                                                  "roomSettings.aPublishedAddressLetsPeopleFindSpace",
                                                              )
                                                            : t(
                                                                  "roomSettings.aPublishedAddressLetsPeopleFindRoom",
                                                              )}
                                                    </Text>
                                                    {!aliasesLoaded ? (
                                                        <Text className="text-xs text-discord-textMuted">
                                                            {t(
                                                                "roomSettings.loadingAddresses",
                                                            )}
                                                        </Text>
                                                    ) : (
                                                        <>
                                                            {sortedAliases.length ===
                                                            0 ? (
                                                                !aliasError ? (
                                                                    <Text className="text-xs text-discord-textMuted">
                                                                        {t(
                                                                            "roomSettings.noAddressesYet",
                                                                        )}
                                                                    </Text>
                                                                ) : null
                                                            ) : (
                                                                <View
                                                                    accessibilityRole="list"
                                                                    className="gap-1"
                                                                >
                                                                    {sortedAliases.map(
                                                                        (
                                                                            alias,
                                                                        ) => (
                                                                            <View
                                                                                key={
                                                                                    alias
                                                                                }
                                                                                className="flex-row items-center gap-2 min-w-0"
                                                                            >
                                                                                <Text
                                                                                    numberOfLines={
                                                                                        1
                                                                                    }
                                                                                    className="shrink text-sm text-discord-textPrimary font-mono truncate"
                                                                                >
                                                                                    {
                                                                                        alias
                                                                                    }
                                                                                </Text>
                                                                                {alias ===
                                                                                    canonicalAlias && (
                                                                                    <View className="shrink-0 bg-discord-accent rounded px-1.5 py-0.5">
                                                                                        <Text className="text-[10px] uppercase tracking-wide text-white">
                                                                                            {t(
                                                                                                "roomSettings.main",
                                                                                            )}
                                                                                        </Text>
                                                                                    </View>
                                                                                )}
                                                                                <Pressable
                                                                                    accessibilityRole="button"
                                                                                    accessibilityLabel={t(
                                                                                        "roomSettings.remove",
                                                                                        {
                                                                                            alias,
                                                                                        },
                                                                                    )}
                                                                                    onPress={() =>
                                                                                        void removeAlias(
                                                                                            alias,
                                                                                        )
                                                                                    }
                                                                                    disabled={
                                                                                        aliasBusy
                                                                                    }
                                                                                    className="ms-auto shrink-0 disabled:opacity-50"
                                                                                >
                                                                                    <Text className="text-xs text-discord-danger hover:underline">
                                                                                        {t(
                                                                                            "common.remove",
                                                                                        )}
                                                                                    </Text>
                                                                                </Pressable>
                                                                            </View>
                                                                        ),
                                                                    )}
                                                                </View>
                                                            )}

                                                            {canSetCanonicalAlias &&
                                                                mainAliasOptions.length >
                                                                    0 && (
                                                                    <View className="flex-row items-end gap-1.5 mt-3 min-w-0">
                                                                        <View className="flex-1 min-w-0">
                                                                            <Text className="text-xs text-discord-textMuted mb-1">
                                                                                {t(
                                                                                    "roomSettings.mainAddress",
                                                                                )}
                                                                            </Text>
                                                                            <Select
                                                                                value={
                                                                                    mainAliasChoice
                                                                                }
                                                                                onChange={
                                                                                    setMainAliasChoice
                                                                                }
                                                                                disabled={
                                                                                    aliasBusy
                                                                                }
                                                                                accessibilityLabel={t(
                                                                                    "roomSettings.mainAddress",
                                                                                )}
                                                                                options={[
                                                                                    {
                                                                                        value: "",
                                                                                        label: t(
                                                                                            "roomSettings.noMainAddress",
                                                                                        ),
                                                                                    },
                                                                                    ...mainAliasOptions.map(
                                                                                        (
                                                                                            alias,
                                                                                        ) => ({
                                                                                            value: alias,
                                                                                            label: alias,
                                                                                        }),
                                                                                    ),
                                                                                ]}
                                                                                className="w-full px-2 py-1.5 bg-discord-backgroundTertiary rounded border border-discord-divider disabled:opacity-50"
                                                                            />
                                                                        </View>
                                                                        <Pressable
                                                                            accessibilityRole="button"
                                                                            onPress={() =>
                                                                                void saveMainAlias()
                                                                            }
                                                                            disabled={
                                                                                aliasBusy ||
                                                                                !mainAliasDirty
                                                                            }
                                                                            className="shrink-0 px-3 py-1.5 bg-discord-accent hover:bg-discord-accentHover rounded transition-colors disabled:opacity-50"
                                                                        >
                                                                            <Text className="text-white text-sm font-medium">
                                                                                {t(
                                                                                    "roomSettings.set",
                                                                                )}
                                                                            </Text>
                                                                        </Pressable>
                                                                    </View>
                                                                )}

                                                            <View className="flex-row items-center gap-1.5 mt-3">
                                                                <Text className="text-sm text-discord-textMuted shrink-0">
                                                                    #
                                                                </Text>
                                                                <TextInput
                                                                    value={
                                                                        newAliasLocalpart
                                                                    }
                                                                    onChangeText={
                                                                        setNewAliasLocalpart
                                                                    }
                                                                    placeholder={t(
                                                                        "roomSettings.myRoom",
                                                                    )}
                                                                    placeholderTextColorClassName="accent-discord-textMuted"
                                                                    accessibilityLabel={t(
                                                                        "roomSettings.addresses",
                                                                    )}
                                                                    editable={
                                                                        !addAliasBusy
                                                                    }
                                                                    autoCapitalize="none"
                                                                    autoCorrect={
                                                                        false
                                                                    }
                                                                    submitBehavior="submit"
                                                                    onSubmitEditing={() =>
                                                                        void addAlias()
                                                                    }
                                                                    className="flex-1 min-w-0 px-2 py-1.5 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded border border-discord-divider disabled:opacity-50"
                                                                />
                                                                <Text
                                                                    numberOfLines={
                                                                        1
                                                                    }
                                                                    className="text-sm text-discord-textMuted shrink-0 max-w-[40%] truncate"
                                                                >
                                                                    :{ownServer}
                                                                </Text>
                                                                <Pressable
                                                                    accessibilityRole="button"
                                                                    onPress={() =>
                                                                        void addAlias()
                                                                    }
                                                                    disabled={
                                                                        addAliasBusy ||
                                                                        !ownServer ||
                                                                        !newAliasCheck.valid
                                                                    }
                                                                    className="shrink-0 px-3 py-1.5 bg-discord-accent hover:bg-discord-accentHover rounded transition-colors disabled:opacity-50"
                                                                >
                                                                    <Text className="text-white text-sm font-medium">
                                                                        {t(
                                                                            "common.add",
                                                                        )}
                                                                    </Text>
                                                                </Pressable>
                                                            </View>
                                                            {newAliasLocalpart.trim() &&
                                                            newAliasCheck.reason ? (
                                                                <Text className="text-xs text-discord-danger mt-1">
                                                                    {
                                                                        newAliasCheck.reason
                                                                    }
                                                                </Text>
                                                            ) : null}
                                                        </>
                                                    )}
                                                    {aliasError ? (
                                                        <Text className="text-sm text-discord-danger mt-1">
                                                            {aliasError}
                                                        </Text>
                                                    ) : null}
                                                </View>

                                                {accessError ? (
                                                    <Text className="text-sm text-discord-danger">
                                                        {accessError}
                                                    </Text>
                                                ) : null}
                                                {canEditState && (
                                                    <Pressable
                                                        accessibilityRole="button"
                                                        onPress={() =>
                                                            void saveAccess()
                                                        }
                                                        disabled={accessSaving}
                                                        className="self-start px-4 py-2 bg-discord-accent hover:bg-discord-accentHover rounded transition-colors disabled:opacity-50"
                                                    >
                                                        <Text className="text-white font-medium text-sm">
                                                            {accessSaving
                                                                ? t(
                                                                      "common.saving",
                                                                  )
                                                                : accessSuccess
                                                                  ? t(
                                                                        "roomSettings.saved",
                                                                    )
                                                                  : t(
                                                                        "roomSettings.saveChanges",
                                                                    )}
                                                        </Text>
                                                    </Pressable>
                                                )}

                                                <View>
                                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                                                        {t(
                                                            "roomSettings.serverAccessControl",
                                                        )}
                                                    </Text>
                                                    <Text className="text-xs text-discord-textMuted mb-3">
                                                        {t(
                                                            "roomSettings.controlWhichHomeserversMayParticipateIn",
                                                        )}{" "}
                                                        <Text className="text-xs text-discord-textMuted font-mono">
                                                            *
                                                        </Text>{" "}
                                                        {t(
                                                            "roomSettings.matchesAnyCharacters",
                                                        )}{" "}
                                                        <Text className="text-xs text-discord-textMuted font-mono">
                                                            ?
                                                        </Text>{" "}
                                                        {t(
                                                            "roomSettings.matchesOneDeniedServersAreRemoved",
                                                        )}
                                                    </Text>

                                                    {!aclPresent && (
                                                        <Text className="text-xs text-discord-textMuted mb-3">
                                                            {t(
                                                                "roomSettings.noServerAclIsSetAll",
                                                            )}
                                                        </Text>
                                                    )}

                                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1">
                                                        {t(
                                                            "roomSettings.allowedServersOnePerLine",
                                                        )}
                                                    </Text>
                                                    <TextInput
                                                        nativeID="acl-allow"
                                                        accessibilityLabel={t(
                                                            "roomSettings.allowedServersOnePerLine",
                                                        )}
                                                        value={aclAllowText}
                                                        onChangeText={
                                                            setAclAllowText
                                                        }
                                                        multiline
                                                        numberOfLines={3}
                                                        textAlignVertical="top"
                                                        editable={
                                                            canEditServerAcl
                                                        }
                                                        placeholder="*"
                                                        placeholderTextColorClassName="accent-discord-textMuted"
                                                        autoCapitalize="none"
                                                        autoCorrect={false}
                                                        spellCheck={false}
                                                        className={`min-h-[76px] font-mono ${textInputClass}`}
                                                    />

                                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1 mt-3">
                                                        {t(
                                                            "roomSettings.deniedServersOnePerLine",
                                                        )}
                                                    </Text>
                                                    <TextInput
                                                        nativeID="acl-deny"
                                                        accessibilityLabel={t(
                                                            "roomSettings.deniedServersOnePerLine",
                                                        )}
                                                        value={aclDenyText}
                                                        onChangeText={
                                                            setAclDenyText
                                                        }
                                                        multiline
                                                        numberOfLines={3}
                                                        textAlignVertical="top"
                                                        editable={
                                                            canEditServerAcl
                                                        }
                                                        autoCapitalize="none"
                                                        autoCorrect={false}
                                                        spellCheck={false}
                                                        className={`min-h-[76px] font-mono ${textInputClass}`}
                                                    />

                                                    <Checkbox
                                                        checked={aclAllowIp}
                                                        onChange={setAclAllowIp}
                                                        disabled={
                                                            !canEditServerAcl
                                                        }
                                                        label={t(
                                                            "roomSettings.allowServersIdentifiedByARaw",
                                                        )}
                                                        className="items-center gap-2 mt-3"
                                                    />

                                                    {aclWarnings.length > 0 && (
                                                        <View className="mt-3 gap-1">
                                                            {aclWarnings.map(
                                                                (w) => (
                                                                    <View
                                                                        className="flex-row items-center gap-1"
                                                                        key={w}
                                                                    >
                                                                        <TriangleAlert
                                                                            size={
                                                                                14
                                                                            }
                                                                            className="text-discord-danger"
                                                                        />
                                                                        <Text className="text-sm text-discord-danger">
                                                                            {w}
                                                                        </Text>
                                                                    </View>
                                                                ),
                                                            )}
                                                        </View>
                                                    )}
                                                    {aclError ? (
                                                        <Text className="text-sm text-discord-danger mt-2">
                                                            {aclError}
                                                        </Text>
                                                    ) : null}

                                                    {canEditServerAcl ? (
                                                        <Pressable
                                                            accessibilityRole="button"
                                                            onPress={() =>
                                                                void saveServerAcl()
                                                            }
                                                            disabled={aclSaving}
                                                            className="mt-3 self-start px-4 py-2 bg-discord-accent hover:bg-discord-accentHover rounded transition-colors disabled:opacity-50"
                                                        >
                                                            <Text className="text-white font-medium text-sm">
                                                                {aclSaving
                                                                    ? t(
                                                                          "common.saving",
                                                                      )
                                                                    : aclSuccess
                                                                      ? t(
                                                                            "roomSettings.saved",
                                                                        )
                                                                      : t(
                                                                            "roomSettings.saveServerAcl",
                                                                        )}
                                                            </Text>
                                                        </Pressable>
                                                    ) : (
                                                        <Text className="text-xs text-discord-textMuted mt-2">
                                                            {t(
                                                                "roomSettings.youDoNotHavePermissionTo",
                                                            )}
                                                        </Text>
                                                    )}
                                                </View>
                                            </View>
                                        )
                                    ) : /* ── Notifications ───────────────────────────────── */
                                    activeTab === "notifications" ? (
                                        <View className="gap-5">
                                            <View>
                                                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                                                    {t("common.notifications")}
                                                </Text>
                                                <Text className="text-xs text-discord-textMuted mb-3">
                                                    {isSpace
                                                        ? t(
                                                              "roomSettings.chooseHowThisSpaceNotifiesYou",
                                                          )
                                                        : t(
                                                              "roomSettings.chooseHowThisRoomNotifiesYou",
                                                          )}
                                                    {isSpace
                                                        ? ` ${t(
                                                              "roomSettings.appliesToTheSpaceAndAll",
                                                          )}`
                                                        : null}
                                                </Text>
                                                <View
                                                    className="flex-col gap-1"
                                                    accessibilityRole="radiogroup"
                                                    accessibilityLabel={t(
                                                        "roomSettings.notificationLevel",
                                                    )}
                                                >
                                                    {NOTIF_LEVELS.map(
                                                        ([
                                                            val,
                                                            label,
                                                            desc,
                                                        ]) => (
                                                            <Pressable
                                                                key={val}
                                                                accessibilityRole="radio"
                                                                accessibilityState={{
                                                                    checked:
                                                                        notifSetting ===
                                                                        val,
                                                                    disabled:
                                                                        notifSaving,
                                                                }}
                                                                disabled={
                                                                    notifSaving
                                                                }
                                                                onPress={() =>
                                                                    void applyNotification(
                                                                        val,
                                                                    )
                                                                }
                                                                className={`w-full px-3 py-2 rounded flex-row items-start gap-3 transition-colors hover:bg-discord-messageHover disabled:opacity-60 ${
                                                                    notifSetting ===
                                                                    val
                                                                        ? "bg-discord-messageHover"
                                                                        : ""
                                                                }`}
                                                            >
                                                                <View className="mt-0.5 w-3 flex-row items-center justify-center flex-shrink-0">
                                                                    {notifSetting ===
                                                                        val && (
                                                                        <Circle
                                                                            size={
                                                                                8
                                                                            }
                                                                            fill="currentColor"
                                                                            className="text-discord-accent"
                                                                        />
                                                                    )}
                                                                </View>
                                                                <View className="min-w-0 flex-1">
                                                                    <Text className="text-sm font-medium text-discord-textPrimary">
                                                                        {label}
                                                                    </Text>
                                                                    <Text className="text-xs text-discord-textMuted">
                                                                        {desc}
                                                                    </Text>
                                                                </View>
                                                            </Pressable>
                                                        ),
                                                    )}
                                                </View>
                                            </View>
                                        </View>
                                    ) : /* ── Security ────────────────────────────────────────── */
                                    activeTab === "security" ? (
                                        <View className="gap-5">
                                            <View>
                                                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                                                    {t(
                                                        "roomSettings.encryption",
                                                    )}
                                                </Text>
                                                <View
                                                    className={`self-start px-1.5 py-0.5 rounded ${
                                                        encrypted
                                                            ? "bg-discord-accent/20"
                                                            : "bg-discord-messageHover"
                                                    }`}
                                                >
                                                    <Text
                                                        className={`text-[10px] font-semibold uppercase ${
                                                            encrypted
                                                                ? "text-discord-accent"
                                                                : "text-discord-textMuted"
                                                        }`}
                                                    >
                                                        {encrypted
                                                            ? t(
                                                                  "roomSettings.encrypted",
                                                              )
                                                            : t(
                                                                  "roomSettings.notEncrypted",
                                                              )}
                                                    </Text>
                                                </View>
                                                <Text className="text-xs text-discord-textMuted mt-2">
                                                    {encrypted
                                                        ? t(
                                                              "roomSettings.messagesInThisRoomAreEnd",
                                                          )
                                                        : ENABLE_ENCRYPTION_WARNING}
                                                </Text>
                                            </View>

                                            {encrypted && (
                                                <View>
                                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                                                        {t(
                                                            "roomSettings.roomKey",
                                                        )}
                                                    </Text>
                                                    <Text className="text-xs text-discord-textMuted mb-2">
                                                        {t(
                                                            "roomSettings.resetRoomKeyHint",
                                                        )}
                                                    </Text>
                                                    <Pressable
                                                        accessibilityRole="button"
                                                        onPress={() =>
                                                            void doResetRoomKey()
                                                        }
                                                        disabled={
                                                            roomKeyResetting
                                                        }
                                                        className="self-start px-4 py-2 bg-discord-backgroundTertiary hover:bg-discord-messageHover rounded transition-colors disabled:opacity-50"
                                                    >
                                                        <Text className="text-discord-textPrimary font-medium text-sm">
                                                            {t(
                                                                "roomSettings.resetRoomKey",
                                                            )}
                                                        </Text>
                                                    </Pressable>
                                                    {roomKeyResetDone && (
                                                        <Text className="text-sm text-discord-online mt-2">
                                                            {t(
                                                                "crypto.roomKeyDiscarded",
                                                            )}
                                                        </Text>
                                                    )}
                                                    {roomKeyResetError ? (
                                                        <Text className="text-sm text-discord-danger mt-2">
                                                            {roomKeyResetError}
                                                        </Text>
                                                    ) : null}
                                                </View>
                                            )}

                                            {!encrypted &&
                                                (!encState.canEnable ? (
                                                    <Text className="text-sm text-discord-textMuted">
                                                        {encState.reason}
                                                    </Text>
                                                ) : !encShowConfirm ? (
                                                    <Pressable
                                                        accessibilityRole="button"
                                                        onPress={() => {
                                                            setEncShowConfirm(
                                                                true,
                                                            );
                                                            setEncConfirmInput(
                                                                "",
                                                            );
                                                            setEncError("");
                                                        }}
                                                        className="self-start px-4 py-2 bg-discord-accent hover:bg-discord-accentHover rounded transition-colors"
                                                    >
                                                        <Text className="text-white font-medium text-sm">
                                                            {t(
                                                                "roomSettings.enableEncryption",
                                                            )}
                                                        </Text>
                                                    </Pressable>
                                                ) : (
                                                    <View className="gap-2">
                                                        <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                                                            {t(
                                                                "roomSettings.typeToConfirm",
                                                                {
                                                                    ENABLE_ENCRYPTION_CONFIRM_PHRASE,
                                                                },
                                                            )}
                                                        </Text>
                                                        <TextInput
                                                            nativeID="room-settings-enc-confirm"
                                                            accessibilityLabel={t(
                                                                "roomSettings.typeToConfirm",
                                                                {
                                                                    ENABLE_ENCRYPTION_CONFIRM_PHRASE,
                                                                },
                                                            )}
                                                            value={
                                                                encConfirmInput
                                                            }
                                                            onChangeText={
                                                                setEncConfirmInput
                                                            }
                                                            placeholder={
                                                                ENABLE_ENCRYPTION_CONFIRM_PHRASE
                                                            }
                                                            placeholderTextColorClassName="accent-discord-textMuted"
                                                            autoCapitalize="characters"
                                                            autoCorrect={false}
                                                            className="w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 border border-transparent focus:border-discord-accent/50"
                                                        />
                                                        {encError ? (
                                                            <Text className="text-sm text-discord-danger">
                                                                {encError}
                                                            </Text>
                                                        ) : null}
                                                        <View className="flex-row gap-2">
                                                            <Pressable
                                                                accessibilityRole="button"
                                                                onPress={() =>
                                                                    void doEnableEncryption()
                                                                }
                                                                disabled={
                                                                    encEnabling ||
                                                                    !matchesEnableEncryptionConfirmation(
                                                                        encConfirmInput,
                                                                    )
                                                                }
                                                                className="px-4 py-2 bg-discord-danger hover:opacity-90 rounded transition-colors disabled:opacity-50"
                                                            >
                                                                <Text className="text-white font-medium text-sm">
                                                                    {encEnabling
                                                                        ? t(
                                                                              "roomSettings.enabling",
                                                                          )
                                                                        : t(
                                                                              "roomSettings.enableEncryption",
                                                                          )}
                                                                </Text>
                                                            </Pressable>
                                                            <Pressable
                                                                accessibilityRole="button"
                                                                onPress={() => {
                                                                    setEncShowConfirm(
                                                                        false,
                                                                    );
                                                                    setEncConfirmInput(
                                                                        "",
                                                                    );
                                                                    setEncError(
                                                                        "",
                                                                    );
                                                                }}
                                                                disabled={
                                                                    encEnabling
                                                                }
                                                                className="px-4 py-2 rounded hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                                                            >
                                                                <Text className="text-sm font-medium text-discord-textMuted hover:text-discord-textPrimary">
                                                                    {t(
                                                                        "common.cancel",
                                                                    )}
                                                                </Text>
                                                            </Pressable>
                                                        </View>
                                                    </View>
                                                ))}
                                        </View>
                                    ) : /* ── Permissions ─────────────────────────────────────── */
                                    activeTab === "permissions" ? (
                                        <View className="gap-4">
                                            <Text className="text-xs text-discord-textMuted">
                                                {t(
                                                    "roomSettings.powerLevelRequiredForEachAction",
                                                )}
                                            </Text>
                                            {!stateLoaded ? (
                                                stateLoading()
                                            ) : (
                                                <>
                                                    {[
                                                        [
                                                            "Send messages",
                                                            "plEventsDefault",
                                                        ],
                                                        [
                                                            "Change room settings",
                                                            "plStateDefault",
                                                        ],
                                                        [
                                                            "Default member level",
                                                            "plUsersDefault",
                                                        ],
                                                        [
                                                            "Invite members",
                                                            "plInvite",
                                                        ],
                                                        [
                                                            "Kick members",
                                                            "plKick",
                                                        ],
                                                        [
                                                            "Ban members",
                                                            "plBan",
                                                        ],
                                                        [
                                                            "Redact messages",
                                                            "plRedact",
                                                        ],
                                                        ...(isSpace
                                                            ? []
                                                            : [
                                                                  [
                                                                      t(
                                                                          "roomSettings.nameAnyThread",
                                                                      ),
                                                                      "plThreadName",
                                                                  ],
                                                              ]),
                                                    ].map(([label, key]) => (
                                                        <View
                                                            key={key}
                                                            className="flex-row items-center justify-between gap-4"
                                                        >
                                                            <Text className="shrink text-sm text-discord-textPrimary">
                                                                {label}
                                                            </Text>
                                                            <View className="flex-row items-center gap-2">
                                                                <TextInput
                                                                    keyboardType="number-pad"
                                                                    accessibilityLabel={
                                                                        label
                                                                    }
                                                                    value={String(
                                                                        bindings[
                                                                            key
                                                                        ],
                                                                    )}
                                                                    onChangeText={(
                                                                        value,
                                                                    ) =>
                                                                        setters[
                                                                            key
                                                                        ](
                                                                            Number(
                                                                                value,
                                                                            ),
                                                                        )
                                                                    }
                                                                    editable={
                                                                        canEditState
                                                                    }
                                                                    className="w-16 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-2 py-1 border border-transparent focus:border-discord-accent/50 text-center disabled:opacity-50"
                                                                />
                                                                <Text className="text-xs text-discord-textMuted w-16">
                                                                    {plLabel(
                                                                        bindings[
                                                                            key
                                                                        ],
                                                                    )}
                                                                </Text>
                                                            </View>
                                                        </View>
                                                    ))}

                                                    {/* Call-join lives in the events map (3 call-member
                                                        types), not a top-level PL field, so it sits outside
                                                        the scalar loop above and binds to plCallJoin. */}
                                                    <View className="flex-row items-center justify-between gap-4">
                                                        <Text className="shrink text-sm text-discord-textPrimary">
                                                            {t(
                                                                "roomSettings.joinCallsVoiceVideo",
                                                            )}
                                                        </Text>
                                                        <View className="flex-row items-center gap-2">
                                                            <TextInput
                                                                keyboardType="number-pad"
                                                                accessibilityLabel={t(
                                                                    "roomSettings.joinCallsVoiceVideo",
                                                                )}
                                                                value={String(
                                                                    plCallJoin,
                                                                )}
                                                                onChangeText={(
                                                                    value,
                                                                ) =>
                                                                    setPlCallJoin(
                                                                        Number(
                                                                            value,
                                                                        ),
                                                                    )
                                                                }
                                                                editable={
                                                                    canEditState
                                                                }
                                                                className="w-16 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-2 py-1 border border-transparent focus:border-discord-accent/50 text-center disabled:opacity-50"
                                                            />
                                                            <Text className="text-xs text-discord-textMuted w-16">
                                                                {plLabel(
                                                                    plCallJoin,
                                                                )}
                                                            </Text>
                                                        </View>
                                                    </View>

                                                    {permError ? (
                                                        <Text className="text-sm text-discord-danger">
                                                            {permError}
                                                        </Text>
                                                    ) : null}
                                                    {canEditState && (
                                                        <Pressable
                                                            accessibilityRole="button"
                                                            onPress={() =>
                                                                void savePermissions()
                                                            }
                                                            disabled={
                                                                permSaving
                                                            }
                                                            className="self-start px-4 py-2 bg-discord-accent hover:bg-discord-accentHover rounded transition-colors disabled:opacity-50"
                                                        >
                                                            <Text className="text-white font-medium text-sm">
                                                                {permSaving
                                                                    ? t(
                                                                          "common.saving",
                                                                      )
                                                                    : permSuccess
                                                                      ? t(
                                                                            "roomSettings.saved",
                                                                        )
                                                                      : t(
                                                                            "roomSettings.saveChanges",
                                                                        )}
                                                            </Text>
                                                        </Pressable>
                                                    )}
                                                </>
                                            )}
                                        </View>
                                    ) : /* ── Members ─────────────────────────────────────────── */
                                    activeTab === "members" ? (
                                        // The list itself is the FlatList above.
                                        <View className="gap-3">
                                            <InvitePanel
                                                roomId={room.roomId}
                                                onClose={() =>
                                                    setShowInvite(false)
                                                }
                                            />
                                        </View>
                                    ) : /* ── Rooms (space only) ──────────────────────────────── */
                                    activeTab === "rooms" ? (
                                        <View className="gap-3">
                                            <Text className="text-xs text-discord-textMuted">
                                                {t("roomSettings.setThe")}{" "}
                                                <Text className="text-xs text-discord-textMuted font-mono bg-discord-backgroundTertiary">
                                                    order
                                                </Text>{" "}
                                                {t(
                                                    "roomSettings.fieldOnEachChildRoomTo",
                                                )}
                                            </Text>
                                            {roomsError ? (
                                                <Text className="text-sm text-discord-danger">
                                                    {roomsError}
                                                </Text>
                                            ) : null}
                                            <View className="gap-1.5">
                                                {spaceChildren.map((child) => (
                                                    <View
                                                        key={child.roomId}
                                                        className="flex-row items-center gap-3 p-2 rounded bg-discord-backgroundTertiary"
                                                    >
                                                        <View className="w-7 h-7 rounded-full bg-discord-backgroundSecondary flex-shrink-0 overflow-hidden items-center justify-center">
                                                            {child.avatarUrl ? (
                                                                <Image
                                                                    source={mediaSource(
                                                                        child.avatarUrl,
                                                                    )}
                                                                    contentFit="cover"
                                                                    className="w-full h-full"
                                                                />
                                                            ) : (
                                                                <Text className="text-xs font-bold text-discord-textMuted">
                                                                    {child.name[0]?.toUpperCase() ??
                                                                        "#"}
                                                                </Text>
                                                            )}
                                                        </View>
                                                        <View className="flex-1 min-w-0">
                                                            <Text
                                                                numberOfLines={
                                                                    1
                                                                }
                                                                className="text-sm font-medium text-discord-textPrimary truncate"
                                                            >
                                                                {child.name}
                                                            </Text>
                                                            <Text
                                                                numberOfLines={
                                                                    1
                                                                }
                                                                className="text-xs text-discord-textMuted truncate"
                                                            >
                                                                {child.roomId}
                                                            </Text>
                                                        </View>
                                                        {child.suggested && (
                                                            <View className="bg-discord-accent/10 rounded px-2 py-0.5 flex-shrink-0">
                                                                <Text className="text-xs font-semibold text-discord-accent">
                                                                    {t(
                                                                        "roomSettings.suggested",
                                                                    )}
                                                                </Text>
                                                            </View>
                                                        )}
                                                        {canEditState && (
                                                            <Pressable
                                                                accessibilityRole="button"
                                                                accessibilityHint={
                                                                    child.suggested
                                                                        ? t(
                                                                              "roomSettings.removeSuggestedHint",
                                                                          )
                                                                        : t(
                                                                              "roomSettings.markAsSuggested",
                                                                          )
                                                                }
                                                                onPress={() =>
                                                                    void toggleSuggested(
                                                                        child,
                                                                    )
                                                                }
                                                                disabled={
                                                                    roomActionPending ===
                                                                    child.roomId
                                                                }
                                                                className="px-2.5 py-1 rounded transition-colors disabled:opacity-50"
                                                            >
                                                                <Text
                                                                    className={`text-xs font-semibold ${
                                                                        child.suggested
                                                                            ? "text-discord-textMuted hover:text-discord-textPrimary"
                                                                            : "text-discord-accent hover:underline"
                                                                    }`}
                                                                >
                                                                    {child.suggested
                                                                        ? t(
                                                                              "roomSettings.unsuggest",
                                                                          )
                                                                        : t(
                                                                              "roomSettings.suggest",
                                                                          )}
                                                                </Text>
                                                            </Pressable>
                                                        )}
                                                        {canEditState && (
                                                            <>
                                                                <TextInput
                                                                    value={
                                                                        orderEdits[
                                                                            child
                                                                                .roomId
                                                                        ] ?? ""
                                                                    }
                                                                    onChangeText={(
                                                                        value,
                                                                    ) =>
                                                                        setOrderEdits(
                                                                            (
                                                                                prev,
                                                                            ) => ({
                                                                                ...prev,
                                                                                [child.roomId]:
                                                                                    value,
                                                                            }),
                                                                        )
                                                                    }
                                                                    placeholder={t(
                                                                        "roomSettings.order",
                                                                    )}
                                                                    placeholderTextColorClassName="accent-discord-textMuted"
                                                                    accessibilityLabel={t(
                                                                        "roomSettings.order",
                                                                    )}
                                                                    autoCapitalize="none"
                                                                    autoCorrect={
                                                                        false
                                                                    }
                                                                    className="w-24 bg-discord-backgroundSecondary text-discord-textPrimary text-xs rounded px-2 py-1 border border-transparent focus:border-discord-accent/50 font-mono"
                                                                />
                                                                <Pressable
                                                                    accessibilityRole="button"
                                                                    onPress={() =>
                                                                        void saveOrder(
                                                                            child,
                                                                        )
                                                                    }
                                                                    disabled={
                                                                        roomActionPending ===
                                                                            child.roomId ||
                                                                        (orderEdits[
                                                                            child
                                                                                .roomId
                                                                        ] ??
                                                                            "") ===
                                                                            child.order
                                                                    }
                                                                    className="px-2.5 py-1 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-50"
                                                                >
                                                                    <Text className="text-xs font-semibold text-white">
                                                                        {roomActionPending ===
                                                                        child.roomId
                                                                            ? "…"
                                                                            : t(
                                                                                  "roomSettings.set",
                                                                              )}
                                                                    </Text>
                                                                </Pressable>
                                                                <Pressable
                                                                    accessibilityRole="button"
                                                                    accessibilityLabel={t(
                                                                        "roomSettings.removeFromSpace",
                                                                    )}
                                                                    onPress={() =>
                                                                        void doRemoveChild(
                                                                            child,
                                                                        )
                                                                    }
                                                                    disabled={
                                                                        roomActionPending ===
                                                                        child.roomId
                                                                    }
                                                                    className="p-1 rounded hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                                                                >
                                                                    <SvgIcon
                                                                        d={
                                                                            CLOSE_ICON
                                                                        }
                                                                        className="w-4 h-4 text-discord-textMuted"
                                                                    />
                                                                </Pressable>
                                                            </>
                                                        )}
                                                    </View>
                                                ))}
                                                {spaceChildren.length === 0 ? (
                                                    <Text className="text-sm text-discord-textMuted text-center py-4">
                                                        {t(
                                                            "roomSettings.noChildRooms",
                                                        )}
                                                    </Text>
                                                ) : null}
                                            </View>
                                        </View>
                                    ) : /* ── Emotes ──────────────────────────────────────────── */
                                    activeTab === "emotes" ? (
                                        <>
                                            <ImagePackEditor
                                                room={room}
                                                canEdit={canEditEmojis}
                                                onUpdate={onUpdate}
                                            />
                                            <View className="mt-8 gap-3">
                                                <Text
                                                    role="heading"
                                                    className="text-lg font-semibold text-discord-textPrimary"
                                                >
                                                    {t("soundboard.title")}
                                                </Text>
                                                <SoundPackEditor room={room} />
                                            </View>
                                        </>
                                    ) : null}
                                </ScrollArea>
                            )}
                        </View>
                    )}
                </View>
            </View>
        </Portal>
    );
}

// The `space-y-1` between member rows.
function MemberGap() {
    return <View className="h-1" />;
}
