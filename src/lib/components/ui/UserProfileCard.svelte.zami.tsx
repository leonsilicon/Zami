import {
    DomMount,
    Image,
    mediaSource,
    openLink,
    Spin,
    SvgIcon,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    Pressable,
    ScrollView,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import { Path } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { t } from "$lib/i18n";
import type { Room } from "matrix-js-sdk";
import Avatar from "$lib/components/ui/Avatar.svelte";
import Portal from "$lib/components/ui/Portal.svelte";
import RichPresenceCard from "$lib/components/ui/RichPresenceCard.svelte";
import { nextRpcExpiry, parseRpcField } from "$lib/utils/richPresence";
import BottomSheet from "$lib/components/ui/BottomSheet.svelte";
import { auth } from "$lib/stores/auth.svelte";
import {
    interfaceState,
    openAppSettingsTab,
} from "$lib/stores/interface.svelte";
import {
    profileCardState,
    closeProfileCard,
} from "$lib/stores/profileCard.svelte";
import {
    roomsState,
    setActiveRoom,
    openDraftDm,
} from "$lib/stores/rooms.svelte";
import { presenceState, presenceFor } from "$lib/stores/presence.svelte";
import {
    isUserBlocked,
    blockUser,
    unblockUser,
} from "$lib/stores/ignoredUsers.svelte";
import {
    getMemberAvatar,
    getMutualRoomsWith,
    getMyPowerRank,
    getUserPowerLevel,
    getUserPowerRank,
    hasImmutableCreatorPower,
    getRoomPowerLevels,
    createDirectMessage,
    hasExistingDirectMessage,
    retryRoomFollowUp,
    kickUser,
    banUser,
    getRoom,
    memberDisplayName,
    mxcToHttp,
} from "$lib/matrix/client";
import {
    getCachedProfile,
    nameColourFor,
    requestProfile,
} from "$lib/stores/profileFields.svelte";
import {
    PROFILE_FIELDS,
    describeCall,
    formatLocalTime,
    formatStatusMessage,
    isSameStatus,
    parseBanner,
    parseBiography,
    parseCallJoinedTs,
    parseConnections,
    parsePronouns,
    parseStatus,
    parseTimezone,
    pronounsToText,
    readFieldWithLegacy,
} from "$lib/utils/extendedProfile";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import type { RoomFollowUp } from "$lib/utils/roomCreationOutcome";
import {
    presenceDot,
    presenceDotClass,
    presenceLabel,
} from "$lib/utils/presence";
import { popoutPosition, summarizeMutualRooms } from "$lib/utils/profileCard";
import {
    shouldEncryptNewDm,
    shouldWarnPlaintextDmReuse,
    PLAINTEXT_DM_REUSE_WARNING,
} from "$lib/utils/roomEncryption";
import { settingsState } from "$lib/stores/settings.svelte";
import {
    isCryptoAvailable,
    getUserTrust,
    getKnownDevices,
    isRoomEncrypted,
    type KnownDevice,
} from "$lib/matrix/crypto";
import {
    deviceTrustBadge,
    userTrustBadge,
    type TrustTone,
} from "$lib/utils/verification";
import { createStaleGuard } from "$lib/utils/staleGuard";
import { verificationState, verifyUser } from "$lib/stores/verification.svelte";
import { pluginRegistry } from "$lib/stores/plugins.svelte";
import { pluginMount } from "$lib/plugins/pluginMount";
import { visibleUserActions } from "$lib/plugins/pluginMembers";
import type { UserActionItem } from "$lib/plugins/types";

interface Props {
    room: Room;
}

// Zami: `profileCardState.userId` as upstream's `userId` derived reads it, for the
// checks after an `await`, where this render's `userId` may already be stale.
const currentUserId = () => profileCardState.userId ?? "";

export default function UserProfileCard({ room }: Props) {
    const open = useRune(
        () =>
            interfaceState.modal === "profile-card" &&
            profileCardState.userId !== null,
    );
    const userId = useRune(() => profileCardState.userId ?? "");
    const isSelf = useRune(() => userId === auth.userId, [userId]);
    // Context handed to plugin profile sections and action buttons.
    const pluginCtx = useMemo(
        () => ({ userId, roomId: room.roomId, isSelf }),
        [userId, room.roomId, isSelf],
    );
    // Plugin profile sections and action buttons. Re-derived on every registry
    // mutation (tick) and when the card retargets. Actions are filtered by the
    // same `when` rule the helper applies, mapped back to their entries for keys.
    const pluginTick = useRune(() => pluginRegistry.tick);
    const profileSections = useMemo(() => {
        void pluginTick;
        return [...pluginRegistry.profileSections];
    }, [pluginTick]);
    const pluginActions = useMemo(() => {
        void pluginTick;
        const entries = [...pluginRegistry.userActions];
        const visible = new Set<UserActionItem>(
            visibleUserActions(
                entries.map((e) => e.value),
                pluginCtx,
            ),
        );
        return entries.filter((e) => visible.has(e.value));
    }, [pluginTick, pluginCtx]);

    // Live SDK objects mutate in place — depend on the ticks so kicks/bans,
    // membership and presence changes re-render the open card.
    // Zami: a tick re-renders the card, and the reads below run again.
    const roomsTick = useRune(() => roomsState.roomsTick);
    const member = userId ? room.getMember(userId) : null;
    const displayName = member ? memberDisplayName(member) : userId;
    const avatarSrc = userId ? getMemberAvatar(room, userId) : null;
    const presence = useRune(
        () => (
            void presenceState.presenceTick,
            userId ? presenceFor(userId) : null
        ),
        [userId],
    );
    const dotState = presence?.state ?? "offline";

    // Extended profile (MSC4133 and friends). Hidden for banned users, as
    // MSC4440 recommends, so a ban also silences their self-description.
    // A minute is as stale as rich presence may be when a card opens.
    useEffect(() => {
        if (userId) requestProfile(userId, 60_000);
    }, [userId]);
    const cachedProfile = useRune(() => getCachedProfile(userId), [userId]);
    const banned = member?.membership === "ban";
    const extended = banned ? undefined : cachedProfile;
    const field = (key: keyof typeof PROFILE_FIELDS) =>
        readFieldWithLegacy(extended, PROFILE_FIELDS[key]);
    const bannerSrc = mxcToHttp(parseBanner(field("banner")), 288, 96, "crop");
    const pronouns = pronounsToText(parsePronouns(field("pronouns")));
    const status = parseStatus(field("status"));
    // Rich presence (MSC4544): what they are doing now. Entries lapse at their
    // expiry, when the profile is fetched again to find any successor.
    const [rpcNow, setRpcNow] = useState(Date.now());
    const rpcField = field("rpc");
    const rpcEntries = useMemo(
        () => (banned ? [] : parseRpcField(rpcField, rpcNow)),
        [banned, rpcField, rpcNow],
    );
    const nextExpiry = nextRpcExpiry(rpcEntries);
    useEffect(() => {
        const next = nextExpiry;
        if (next === null || !userId) return;
        const target = userId;
        const timer = setTimeout(
            () => {
                setRpcNow(Date.now());
                requestProfile(target, 0);
            },
            Math.max(1000, next - Date.now() + 500),
        );
        return () => clearTimeout(timer);
    }, [nextExpiry, userId]);
    const callText = (() => {
        const joined = parseCallJoinedTs(field("call"));
        return joined === null ? null : describeCall(joined, Date.now());
    })();
    const bio = parseBiography(field("biography")).trim();
    const timezone = parseTimezone(field("timezone"));
    const localTime = timezone ? formatLocalTime(timezone, new Date()) : null;
    const connections = parseConnections(field("connections"));
    const nameColour = useRune(() => nameColourFor(userId), [userId]);

    const mutual = useMemo(() => {
        void roomsTick;
        if (!userId || isSelf) return { shown: [], moreCount: 0, total: 0 };
        const rooms = getMutualRoomsWith(userId);
        return {
            ...summarizeMutualRooms(rooms.map((r) => r.name)),
            total: rooms.length,
        };
    }, [roomsTick, userId, isSelf]);

    const myPowerRank = getMyPowerRank(room);
    const pl = getRoomPowerLevels(room);
    // Ranks, not levels: a creator acts on any admin, nobody acts on a creator.
    const canActOnTarget =
        !isSelf &&
        !!member &&
        myPowerRank > getUserPowerRank(room, member.userId);
    const canKickTarget = canActOnTarget && myPowerRank >= pl.kick;
    const canBanTarget = canActOnTarget && myPowerRank >= pl.ban;
    const blocked = useRune(() => isUserBlocked(userId), [userId]);

    const [pending, setPending] = useState<
        null | "message" | "block" | "kick" | "ban" | "verify"
    >(null);
    const [confirming, setConfirming] = useState<null | "kick" | "ban">(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const copyTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );

    // Verification trust (Layer 1). Reloaded on retarget and whenever a
    // verification completes (verificationTick).
    const [userTrust, setUserTrust] = useState<{
        isVerified: boolean;
        needsApproval?: boolean;
        known?: boolean;
    } | null>(null);
    const trustBadge =
        !isSelf && userId && isCryptoAvailable()
            ? userTrustBadge(userTrust)
            : null;

    // The card retargets in place — clicking another avatar swaps
    // profileCardState.userId without remounting — so a slow response can land
    // on the wrong person. Trust and the action buttons get separate guards:
    // they run concurrently and neither should supersede the other.
    const [trustRequests] = useState(createStaleGuard);
    const [actionRequests] = useState(createStaleGuard);
    const [deviceRequests] = useState(createStaleGuard);

    // Their sessions as this session's crypto knows them: the ones our
    // messages are encrypted for. Loaded on first expand (it can mean a keys
    // download), and again after a verification finishes.
    const [sessionsOpen, setSessionsOpen] = useState(false);
    const [devices, setDevices] = useState<KnownDevice[] | null>(null);
    const [devicesLoading, setDevicesLoading] = useState(false);
    const [devicesError, setDevicesError] = useState(false);

    async function loadDevices(refresh = false) {
        if (!userId || !isCryptoAvailable()) return;
        const target = userId;
        setDevicesLoading(true);
        setDevicesError(false);
        const outcome = await deviceRequests.run(() =>
            getKnownDevices(target, { refresh }),
        );
        if (outcome.status === "stale" || target !== currentUserId()) return;
        setDevicesLoading(false);
        if (outcome.status === "ok" && outcome.value) setDevices(outcome.value);
        else setDevicesError(true);
    }

    function toggleSessions() {
        const next = !sessionsOpen;
        setSessionsOpen(next);
        if (next && devices === null) void loadDevices();
    }

    const toneClass = (tone: TrustTone) =>
        tone === "verified"
            ? "bg-discord-online/20 text-discord-online"
            : tone === "warning"
              ? "bg-discord-warning/20 text-discord-warning"
              : "bg-discord-messageHover text-discord-textMuted";

    async function loadTrust() {
        setUserTrust(null);
        if (isSelf || !userId || !isCryptoAvailable()) return;
        const target = userId;
        const outcome = await trustRequests.run(() => getUserTrust(target));
        // A late verdict for a user the card is no longer showing would paint
        // one person's verification badge onto another's.
        if (outcome.status !== "ok" || target !== currentUserId()) return;
        setUserTrust(outcome.value);
    }

    // Reset transient state whenever the card retargets or closes. Cancelling
    // the guards is what stops the previous target's in-flight responses from
    // writing into the state we just cleared.
    //
    // (Item 10 carried an equivalent ad-hoc `cardGeneration` counter here; it
    // is dropped in favour of the shared createStaleGuard, which the block and
    // kick/ban handlers on this card already use. Two mechanisms for one job
    // is how one of them rots.)
    useEffect(() => {
        trustRequests.cancel();
        actionRequests.cancel();
        deviceRequests.cancel();
        setSessionsOpen(false);
        setDevices(null);
        setDevicesLoading(false);
        setDevicesError(false);
        setPending(null);
        setConfirming(null);
        setErrorMsg(null);
        setCopied(false);
        void loadTrust();
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream's effect tracks `profileCardState.userId` alone.
    }, [userId]);

    // Refresh trust when a verification finishes (tick bumps on Done).
    const verificationTick = useRune(() => verificationState.verificationTick);
    useEffect(() => {
        void loadTrust();
        if (devices !== null) void loadDevices();
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream reads `devices` untracked.
    }, [verificationTick]);

    async function startVerifyUser() {
        setPending("verify");
        setErrorMsg(null);
        // verifyUser -> startUserVerification creates a DM if there isn't one,
        // so this can sit for up to 15s while the card retargets. The guard is
        // what stops A's error landing on B's card or clearing B's pending.
        const target = userId;
        const outcome = await actionRequests.run(() => verifyUser(target));
        if (outcome.status === "stale") return;
        setPending(null);
        if (outcome.status === "error") {
            setErrorMsg(
                outcome.error instanceof Error
                    ? outcome.error.message
                    : t("userProfileCard.couldNotStartVerification"),
            );
        }
    }

    // Position: measured card size against the stored anchor, viewport-clamped.
    const { width: innerWidth, height: innerHeight } = useWindowDimensions();
    const [cardW, setCardW] = useState(0);
    const [cardH, setCardH] = useState(0);
    const anchor = useRune(() => profileCardState.anchor);
    const position = !anchor
        ? { left: 0, top: 0 }
        : popoutPosition(
              anchor,
              { width: cardW || 288, height: cardH || 380 },
              { width: innerWidth, height: innerHeight },
          );
    const asSheet = useRune(() => interfaceState.isTouchscreen);
    // In the sheet the banner tucks up under the grab handle (BottomSheet's
    // pt-2 + handle + mb-2 = 1.25rem) and the avatar rings match the sheet's
    // surface instead of the desktop card's.
    const bannerPull = asSheet ? "-mt-5" : "";
    const ringColor = asSheet
        ? "border-discord-backgroundTertiary"
        : "border-discord-backgroundSecondary";

    // Zami: the links' `color: var(--discord-link, var(--discord-accent-text))`.
    const [linkVar, accentTextVar] = useCSSVariable([
        "--discord-link",
        "--discord-accent-text",
    ]);
    const linkColour = (linkVar ?? accentTextVar) as string | undefined;

    function editOwnProfile() {
        // openAppSettingsTab claims the modal slot, closing this card.
        openAppSettingsTab("account");
    }

    // Plugin action buttons (zam.members.addAction). The helper's try/catch
    // covers synchronous throws; a rejected promise is caught here.
    function runPluginAction(action: UserActionItem) {
        try {
            Promise.resolve(action.onSelect(pluginCtx)).catch((e) =>
                console.error("[zam] members.addAction onSelect threw", e),
            );
        } catch (e) {
            console.error("[zam] members.addAction onSelect threw", e);
        }
    }

    async function copyUserId() {
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(userId);
            setCopied(true);
            clearTimeout(copyTimeout.current);
            copyTimeout.current = setTimeout(() => setCopied(false), 1500);
        } catch {
            setErrorMsg(t("userProfileCard.couldNotCopyToClipboard"));
        }
    }

    // A created room whose follow-up write failed (or timed out unconfirmed):
    // the room is real, so we open it and offer a retry of ONLY the failed
    // step. Reporting a failure here would send the user back to the form to
    // create a duplicate (TX-01).
    function surfaceFollowUp(followUp: RoomFollowUp) {
        // Deliberately silent on success — this store is an ERROR surface (red,
        // role="alert"), and a landed follow-up is already visible without it:
        // the DM moves into the DM list.
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

    async function openDM() {
        setPending("message");
        setErrorMsg(null);
        const target = userId;
        // Captured inside the work callback, NOT from the outcome: `run`
        // reports "stale" however a superseded call settled, so reading the
        // room id off the outcome would silently drop the navigation when the
        // card is dismissed or retargeted mid-create. master navigated
        // unconditionally and the room exists either way — the user asked for
        // this person's DM, so take them there. Only the card-local state is
        // gated on staleness.
        let createdRoomId: string | undefined;
        const wantEncrypted = shouldEncryptNewDm({
            cryptoReady: isCryptoAvailable(),
            setting: settingsState.encryptNewDms,
        });
        // No DM yet: open a draft, created on its first message, rather than
        // creating the room (and inviting them) just for looking.
        if (!hasExistingDirectMessage(target)) {
            setPending(null);
            closeProfileCard();
            openDraftDm(target, wantEncrypted);
            return;
        }
        let followUpStatus = "none";
        const outcome = await actionRequests.run(async () => {
            const { roomId, followUp } = await createDirectMessage(
                target,
                wantEncrypted,
            );
            // Surfaced inside the callback, so it reports even on the stale
            // path: a failed m.direct write is an account-level outcome, not a
            // property of this card's request.
            surfaceFollowUp(followUp);
            createdRoomId = roomId;
            followUpStatus = followUp.status;
        });
        if (createdRoomId !== undefined) {
            // Warn BEFORE navigating away (the toast survives the unmount).
            if (
                shouldWarnPlaintextDmReuse({
                    followUpStatus,
                    wantEncrypted,
                    roomEncrypted: isRoomEncrypted(getRoom(createdRoomId)),
                })
            ) {
                showErrorToast(PLAINTEXT_DM_REUSE_WARNING);
            }
            closeProfileCard();
            setActiveRoom(createdRoomId);
        }
        if (outcome.status === "stale") return;
        // Cleared on the success path too: master's `finally` always cleared
        // it, and the card is not remounted on close, so a skipped clear would
        // leave the button spinning the next time this card opens.
        setPending(null);
        if (outcome.status === "error") {
            setErrorMsg(
                outcome.error instanceof Error
                    ? outcome.error.message
                    : t("userProfileCard.couldNotOpenDm"),
            );
        }
    }

    async function toggleBlock() {
        setPending("block");
        setErrorMsg(null);
        const target = userId;
        const wasBlocked = blocked;
        const outcome = await actionRequests.run(() =>
            wasBlocked ? unblockUser(target) : blockUser(target),
        );
        if (outcome.status === "stale") return;
        setPending(null);
        if (outcome.status === "error") {
            setErrorMsg(
                outcome.error instanceof Error
                    ? outcome.error.message
                    : "Could not update block list",
            );
        }
    }

    async function doModeration(action: "kick" | "ban") {
        if (confirming !== action) {
            setConfirming(action);
            return;
        }
        setPending(action);
        setErrorMsg(null);
        const target = userId;
        const targetRoomId = room.roomId;
        const outcome = await actionRequests.run(() =>
            action === "kick"
                ? kickUser(targetRoomId, target)
                : banUser(targetRoomId, target),
        );
        if (outcome.status === "ok") {
            // See openDM: master's `finally` always cleared this and the card
            // is not remounted on close.
            setPending(null);
            closeProfileCard();
            return;
        }
        if (outcome.status === "stale") return;
        setPending(null);
        setConfirming(null);
        setErrorMsg(
            outcome.error instanceof Error
                ? outcome.error.message
                : action === "kick"
                  ? t("userProfileCard.couldNotKick")
                  : t("userProfileCard.couldNotBan"),
        );
    }

    const refreshIcon = (
        <SvgIcon
            viewBox="0 0 20 20"
            className="w-3.5 h-3.5 text-discord-textMuted"
        >
            <Path
                fillRule="evenodd"
                d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z"
                clipRule="evenodd"
            />
        </SvgIcon>
    );

    const cardBody = () => (
        <>
            {/* Banner */}
            {bannerSrc ? (
                <Image
                    source={mediaSource(bannerSrc)}
                    contentFit="cover"
                    className={`h-16 w-full bg-discord-accent ${bannerPull}`}
                />
            ) : (
                <View className={`h-16 bg-discord-accent ${bannerPull}`} />
            )}

            <View className="px-4 pb-4">
                {/* Avatar overlapping the banner */}
                {/* Zami: `w-fit` → `self-start`; the dot's `title` (a tooltip)
                    → its accessibility label. */}
                <View className="relative -mt-8 mb-2 self-start">
                    <View className={`rounded-full border-4 ${ringColor}`}>
                        <Avatar
                            src={avatarSrc}
                            name={displayName}
                            id={userId}
                            size={64}
                        />
                    </View>
                    <View
                        accessible
                        accessibilityLabel={presenceLabel(dotState)}
                        className={`absolute bottom-1 end-1 w-4 h-4 ${presenceDotClass(
                            presenceDot(dotState),
                        )} rounded-full border-2 ${ringColor}`}
                    />
                </View>

                <View className="flex-row items-center gap-1.5 min-w-0">
                    <Text
                        numberOfLines={1}
                        className="flex-shrink text-base font-bold text-discord-textPrimary"
                        style={nameColour ? { color: nameColour } : undefined}
                    >
                        {displayName}
                    </Text>
                    {trustBadge && (
                        <Text
                            className={`flex-shrink-0 px-1.5 py-0.5 rounded overflow-hidden text-[10px] font-semibold uppercase ${
                                trustBadge.tone === "verified"
                                    ? "bg-discord-online/20 text-discord-online"
                                    : trustBadge.tone === "warning"
                                      ? "bg-discord-warning/20 text-discord-warning"
                                      : "bg-discord-messageHover text-discord-textMuted"
                            }`}
                        >
                            {trustBadge.label}
                        </Text>
                    )}
                </View>
                <View className="flex-row items-center gap-1 min-w-0">
                    <Text
                        numberOfLines={1}
                        className="flex-shrink text-xs text-discord-textMuted"
                    >
                        {userId}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("userProfileCard.copyUserId")}
                        onPress={() => void copyUserId()}
                        className="flex-shrink-0 p-1 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                    >
                        {copied ? (
                            <Text className="text-xs text-discord-online">
                                {t("userProfileCard.copied")}
                            </Text>
                        ) : (
                            <SvgIcon
                                d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
                                className="w-3.5 h-3.5 text-discord-textMuted"
                            />
                        )}
                    </Pressable>
                </View>
                {pronouns ? (
                    <Text
                        numberOfLines={1}
                        className="text-xs text-discord-textSecondary"
                    >
                        {pronouns}
                    </Text>
                ) : null}
                {status && (
                    <Text
                        numberOfLines={1}
                        className="mt-1 text-xs text-discord-textSecondary"
                    >
                        {formatStatusMessage(status)}
                    </Text>
                )}
                {!status && callText ? (
                    <Text
                        numberOfLines={1}
                        className="mt-1 text-xs text-discord-textSecondary"
                    >
                        {callText}
                    </Text>
                ) : null}
                {presence?.statusMsg &&
                !isSameStatus(presence.statusMsg, status) ? (
                    <Text
                        numberOfLines={1}
                        className="mt-1 text-xs text-discord-textSecondary"
                    >
                        {presence.statusMsg}
                    </Text>
                ) : null}
                {rpcEntries.length > 0 && (
                    <RichPresenceCard entries={rpcEntries} />
                )}
                {bio ? (
                    <ScrollView
                        nestedScrollEnabled
                        className="mt-2 max-h-24 flex-grow-0"
                    >
                        <Text className="text-xs text-discord-textSecondary">
                            {bio}
                        </Text>
                    </ScrollView>
                ) : null}
                {/* Plugin profile sections (zam.members.addProfileSection).
                    Zami: the plugin builds DOM into the element (pluginMount),
                    which DomView shows. */}
                {profileSections.map((entry) => (
                    <DomMount
                        key={`${entry.entryId}:${userId}`}
                        className="mt-2"
                        document={document}
                        mount={(el) => {
                            el.setAttribute("data-zam-plugin", entry.pluginId);
                            return pluginMount(el, (el) =>
                                entry.value.render(el, pluginCtx),
                            ).destroy;
                        }}
                    />
                ))}
                {localTime ? (
                    <Text className="mt-2 text-xs text-discord-textMuted">
                        {t("userProfileCard.localTime", {
                            localTime,
                            timezone,
                        })}
                    </Text>
                ) : null}
                {connections.length > 0 && (
                    <View className="mt-2 gap-0.5">
                        {connections.map((link) => (
                            // Zami: `<a target="_blank">` → the system opens it.
                            <Text
                                key={link.uri}
                                numberOfLines={1}
                                accessibilityRole="link"
                                onPress={() => openLink(link.uri)}
                                className="text-xs hover:underline"
                                style={
                                    linkColour
                                        ? { color: linkColour }
                                        : undefined
                                }
                            >
                                {link.description || link.uri}
                            </Text>
                        ))}
                    </View>
                )}
                {member && (
                    <Text className="mt-1 text-xs text-discord-textMuted">
                        {hasImmutableCreatorPower(room, member.userId)
                            ? t("userProfileCard.powerLevelCreator")
                            : t("userProfileCard.powerLevel", {
                                  level: getUserPowerLevel(room, member.userId),
                              })}
                    </Text>
                )}
                {!member && !isSelf && (
                    <Text className="mt-1 text-xs text-discord-textMuted">
                        {t("userProfileCard.notAMemberOfThisRoom")}
                    </Text>
                )}

                {!isSelf && mutual.total > 0 && (
                    <View className="mt-3 pt-3 border-t border-discord-divider">
                        <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1">
                            {t("userProfileCard.mutualRooms", {
                                total: mutual.total,
                            })}
                        </Text>
                        {mutual.shown.map((name) => (
                            <Text
                                key={name}
                                numberOfLines={1}
                                className="text-xs text-discord-textSecondary"
                            >
                                #{name}
                            </Text>
                        ))}
                        {mutual.moreCount > 0 && (
                            <Text className="text-xs text-discord-textMuted">
                                {t("userProfileCard.more", {
                                    moreCount: mutual.moreCount,
                                })}
                            </Text>
                        )}
                    </View>
                )}

                {isCryptoAvailable() && (
                    <View className="mt-3 pt-3 border-t border-discord-divider">
                        <View className="flex-row items-center gap-1">
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ expanded: sessionsOpen }}
                                onPress={toggleSessions}
                                className="flex-1 flex-row items-center gap-1 min-w-0 transition-colors"
                            >
                                {/* Zami: `rtl:` as upstream has it, and the
                                    button's text color as `currentColor`. */}
                                <SvgIcon
                                    viewBox="0 0 20 20"
                                    className={`w-3 h-3 flex-shrink-0 transition-transform text-discord-textMuted ${
                                        sessionsOpen
                                            ? "rotate-90"
                                            : "rtl:rotate-180"
                                    }`}
                                >
                                    <Path
                                        fillRule="evenodd"
                                        d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.17 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                                        clipRule="evenodd"
                                    />
                                </SvgIcon>
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-xs font-semibold text-discord-textMuted uppercase tracking-wide hover:text-discord-textPrimary"
                                >
                                    {devices
                                        ? t("userProfileCard.sessionsCount", {
                                              total: devices.length,
                                          })
                                        : t("userProfileCard.sessions")}
                                </Text>
                            </Pressable>
                            {sessionsOpen && (
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => void loadDevices(true)}
                                    disabled={devicesLoading}
                                    accessibilityState={{
                                        disabled: devicesLoading,
                                    }}
                                    accessibilityLabel={t(
                                        "userProfileCard.refreshSessions",
                                    )}
                                    className={`flex-shrink-0 p-1 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors ${
                                        devicesLoading ? "opacity-50" : ""
                                    }`}
                                >
                                    {devicesLoading ? (
                                        <Spin>{refreshIcon}</Spin>
                                    ) : (
                                        refreshIcon
                                    )}
                                </Pressable>
                            )}
                        </View>
                        {sessionsOpen &&
                            (devices === null && devicesLoading ? (
                                <Text className="mt-1 text-xs text-discord-textMuted">
                                    {t("common.loading")}
                                </Text>
                            ) : devicesError && devices === null ? (
                                <Text className="mt-1 text-xs text-discord-danger">
                                    {t("userProfileCard.couldNotLoadSessions")}
                                </Text>
                            ) : devices && devices.length === 0 ? (
                                <Text className="mt-1 text-xs text-discord-warning">
                                    {t("userProfileCard.noKnownSessions")}
                                </Text>
                            ) : devices ? (
                                <>
                                    <ScrollView
                                        nestedScrollEnabled
                                        className="mt-1 max-h-40 flex-grow-0"
                                        contentContainerClassName="gap-1"
                                    >
                                        {devices.map((device) => {
                                            const badge = device.keysChanged
                                                ? {
                                                      label: t(
                                                          "userProfileCard.keysChanged",
                                                      ),
                                                      tone: "warning" as const,
                                                  }
                                                : deviceTrustBadge(device, {
                                                      flagUnsigned: true,
                                                  });
                                            return (
                                                <View
                                                    key={device.deviceId}
                                                    className="flex-row items-center gap-2 min-w-0"
                                                >
                                                    <View className="flex-1 min-w-0">
                                                        <Text
                                                            numberOfLines={1}
                                                            className="text-xs text-discord-textSecondary"
                                                        >
                                                            {device.displayName ||
                                                                device.deviceId}
                                                        </Text>
                                                        {device.displayName && (
                                                            <Text
                                                                numberOfLines={
                                                                    1
                                                                }
                                                                className="text-[10px] font-mono text-discord-textMuted"
                                                            >
                                                                {
                                                                    device.deviceId
                                                                }
                                                            </Text>
                                                        )}
                                                    </View>
                                                    <Text
                                                        className={`flex-shrink-0 px-1.5 py-0.5 rounded overflow-hidden text-[10px] font-semibold uppercase ${toneClass(
                                                            badge.tone,
                                                        )}`}
                                                    >
                                                        {badge.label}
                                                    </Text>
                                                </View>
                                            );
                                        })}
                                    </ScrollView>
                                    {devices.some((d) => d.keysChanged) && (
                                        <Text className="mt-1 text-xs text-discord-warning">
                                            {t(
                                                "userProfileCard.keysChangedHint",
                                            )}
                                        </Text>
                                    )}
                                    {devicesError && (
                                        <Text className="mt-1 text-xs text-discord-danger">
                                            {t(
                                                "userProfileCard.couldNotLoadSessions",
                                            )}
                                        </Text>
                                    )}
                                </>
                            ) : null)}
                    </View>
                )}

                {!isSelf && (
                    <View className="mt-3 pt-3 border-t border-discord-divider gap-1.5">
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void openDM()}
                            disabled={pending !== null}
                            accessibilityState={{ disabled: pending !== null }}
                            className={`w-full px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover active:bg-discord-accentHover transition-colors ${
                                pending !== null ? "opacity-50" : ""
                            }`}
                        >
                            <Text className="text-center text-white text-sm font-semibold">
                                {pending === "message"
                                    ? t("userProfileCard.opening")
                                    : t("userProfileCard.message")}
                            </Text>
                        </Pressable>
                        {trustBadge && trustBadge.tone !== "verified" && (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => void startVerifyUser()}
                                disabled={pending !== null}
                                accessibilityState={{
                                    disabled: pending !== null,
                                }}
                                className={`w-full px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors ${
                                    pending !== null ? "opacity-50" : ""
                                }`}
                            >
                                <Text className="text-center text-discord-textPrimary text-sm font-semibold">
                                    {pending === "verify"
                                        ? t("common.starting")
                                        : t("userProfileCard.verifyUser")}
                                </Text>
                            </Pressable>
                        )}
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void toggleBlock()}
                            disabled={pending !== null}
                            accessibilityState={{ disabled: pending !== null }}
                            className={`w-full px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors ${
                                pending !== null ? "opacity-50" : ""
                            }`}
                        >
                            <Text
                                className={`text-center text-sm font-semibold ${
                                    blocked
                                        ? "text-discord-textPrimary"
                                        : "text-discord-danger"
                                }`}
                            >
                                {pending === "block"
                                    ? t("common.saving")
                                    : blocked
                                      ? t("common.unblock")
                                      : t("common.block")}
                            </Text>
                        </Pressable>
                        {(canKickTarget || canBanTarget) && (
                            <View className="flex-row gap-1.5">
                                {canKickTarget && (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() =>
                                            void doModeration("kick")
                                        }
                                        disabled={pending !== null}
                                        accessibilityState={{
                                            disabled: pending !== null,
                                        }}
                                        className={`flex-1 px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-warning/20 active:bg-discord-warning/20 transition-colors ${
                                            pending !== null ? "opacity-50" : ""
                                        }`}
                                    >
                                        <Text className="text-center text-discord-warning text-sm font-semibold">
                                            {pending === "kick"
                                                ? t("userProfileCard.kicking")
                                                : confirming === "kick"
                                                  ? t(
                                                        "userProfileCard.confirmKick",
                                                    )
                                                  : t("userProfileCard.kick")}
                                        </Text>
                                    </Pressable>
                                )}
                                {canBanTarget && (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void doModeration("ban")}
                                        disabled={pending !== null}
                                        accessibilityState={{
                                            disabled: pending !== null,
                                        }}
                                        className={`flex-1 px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-danger/20 active:bg-discord-danger/20 transition-colors ${
                                            pending !== null ? "opacity-50" : ""
                                        }`}
                                    >
                                        <Text className="text-center text-discord-danger text-sm font-semibold">
                                            {pending === "ban"
                                                ? t("userProfileCard.banning")
                                                : confirming === "ban"
                                                  ? t(
                                                        "userProfileCard.confirmBan",
                                                    )
                                                  : t("userProfileCard.ban")}
                                        </Text>
                                    </Pressable>
                                )}
                            </View>
                        )}
                    </View>
                )}

                {isSelf && (
                    // Same card others see, plus what only the owner can do.
                    <View className="mt-3 pt-3 border-t border-discord-divider gap-1.5">
                        <Pressable
                            accessibilityRole="button"
                            onPress={editOwnProfile}
                            className="w-full px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover active:bg-discord-accentHover transition-colors"
                        >
                            <Text className="text-center text-white text-sm font-semibold">
                                {t("userProfileCard.editProfile")}
                            </Text>
                        </Pressable>
                    </View>
                )}

                {pluginActions.length > 0 && (
                    <View className="mt-3 pt-3 border-t border-discord-divider gap-1.5">
                        {pluginActions.map((entry) => (
                            <Pressable
                                key={entry.entryId}
                                accessibilityRole="button"
                                onPress={() => runPluginAction(entry.value)}
                                className="w-full px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                            >
                                <Text className="text-center text-discord-textPrimary text-sm font-semibold">
                                    {String(entry.value.label)}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                )}

                {errorMsg && (
                    <Text className="mt-2 text-xs text-discord-danger">
                        {errorMsg}
                    </Text>
                )}
            </View>
        </>
    );

    if (!open) return null;
    return asSheet ? (
        <Portal>
            <BottomSheet onClose={closeProfileCard}>{cardBody()}</BottomSheet>
        </Portal>
    ) : (
        // Zami: `position: fixed` → rendered at the app root through the Portal.
        <Portal>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
                className="absolute inset-0 z-40"
                onPress={closeProfileCard}
            />
            <View
                onLayout={(e) => {
                    setCardW(e.nativeEvent.layout.width);
                    setCardH(e.nativeEvent.layout.height);
                }}
                className="z-50 bg-discord-backgroundSecondary border border-discord-divider shadow-xl overflow-hidden absolute w-72 rounded-lg"
                style={{ left: position.left, top: position.top }}
            >
                {cardBody()}
            </View>
        </Portal>
    );
}
