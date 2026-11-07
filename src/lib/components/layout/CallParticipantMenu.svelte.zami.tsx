import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Circle, ChevronRight } from "lucide-svelte";
import type { Room } from "matrix-js-sdk";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
    BackHandler,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
    type GestureResponderEvent,
    type LayoutRectangle,
    type PressableInstance,
    type ViewStyle,
} from "react-native";
import { useResolveClassNames } from "uniwind";
import { t } from "$lib/i18n";
import Portal from "$lib/components/ui/Portal.svelte";
import BottomSheet from "$lib/components/ui/BottomSheet.svelte";
import { auth } from "$lib/stores/auth.svelte";
import {
    roomsState,
    setActiveRoom,
    openDraftDm,
} from "$lib/stores/rooms.svelte";
import { showChatView } from "$lib/stores/interface.svelte";
import { hostBridge } from "$lib/plugins/hostBridge";
import {
    getMyPowerRank,
    getUserPowerRank,
    getRoomPowerLevels,
    getMemberName,
    kickUser,
    banUser,
    createDirectMessage,
    hasExistingDirectMessage,
    retryRoomFollowUp,
    getRoom,
    setVoiceInputDevice,
    setVoiceOutputDevice,
    participantHasShareAudio,
} from "$lib/matrix/client";
import type { RoomFollowUp } from "$lib/utils/roomCreationOutcome";
import { MAX_PARTICIPANT_VOLUME } from "$lib/utils/participantAudio";
import { menuGates } from "$lib/utils/callMenu";
import {
    shouldEncryptNewDm,
    shouldWarnPlaintextDmReuse,
    PLAINTEXT_DM_REUSE_WARNING,
} from "$lib/utils/roomEncryption";
import {
    settingsState,
    setAudioInputDeviceId,
    setAudioOutputDeviceId,
} from "$lib/stores/settings.svelte";
import { isCryptoAvailable, isRoomEncrypted } from "$lib/matrix/crypto";
import {
    setUserVolume,
    setUserShareVolume,
    setUserSoundVolume,
    setUserLocalMute,
    participantAudioFor,
    setUserVideoHidden,
} from "$lib/stores/voiceCall.svelte";
import { openProfileCard } from "$lib/stores/profileCard.svelte";
import {
    isUserBlocked,
    blockUser,
    unblockUser,
} from "$lib/stores/ignoredUsers.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import { matrixErrorMessage } from "$lib/utils/knock";
import { listMediaDevices } from "$lib/audio/devices";
import { toDeviceOptions } from "$lib/utils/audioDevices";
import {
    toggleSubmenu,
    activeDeviceLabel,
    type SubmenuSection,
} from "$lib/utils/callMenuSubmenu";

interface Props {
    room: Room;
    userId: string;
    x: number;
    y: number;
    touch?: boolean;
    onClose: () => void;
}

export default function CallParticipantMenu({
    room,
    userId,
    x,
    y,
    touch = false,
    onClose,
}: Props) {
    const isSelf = useRune(() => userId === auth.userId, [userId]);

    // Live SDK objects mutate in place — depend on the tick so power-level and
    // membership changes re-derive while the menu is open.
    const name = useRune(() => {
        void roomsState.roomsTick;
        return getMemberName(room, userId);
    }, [room, userId]);
    const gates = useRune(() => {
        void roomsState.roomsTick;
        const member = room.getMember(userId);
        // A stale RTC membership can outlive the room membership. A *missing*
        // member means "cannot act", not "level 0" — otherwise we'd offer an
        // admin Kick/Ban entries that only fail server-side. Mirrors
        // UserProfileCard's `!!member` guard; `menuGates` has no such concept,
        // so the check belongs here at the call site.
        if (!member) return { canKick: false, canBan: false };
        const pl = getRoomPowerLevels(room);
        return menuGates({
            isSelf,
            myLevel: getMyPowerRank(room),
            targetLevel: getUserPowerRank(room, userId),
            kickLevel: pl.kick,
            banLevel: pl.ban,
        });
    }, [room, userId, isSelf]);
    const audio = useRune(() => participantAudioFor(userId), [userId]);
    // Read when the menu opens (or is retargeted): a second slider only
    // matters while they are sharing sound.
    const sharesAudio = useRune(
        () => participantHasShareAudio(userId),
        [userId],
    );
    const blocked = useRune(() => isUserBlocked(userId), [userId]);
    const audioInputDeviceId = useRune(() => settingsState.audioInputDeviceId);
    const audioOutputDeviceId = useRune(
        () => settingsState.audioOutputDeviceId,
    );

    // Device enumeration for self audio device switching.
    // Zami: `navigator.mediaDevices` is undefined here, so listMediaDevices()
    // finds none and each section offers only Default.
    const [mics, setMics] = useState<{ id: string; label: string }[]>([]);
    const [speakers, setSpeakers] = useState<{ id: string; label: string }[]>(
        [],
    );
    const [openSection, setOpenSection] = useState<SubmenuSection | null>(null);

    async function loadDevices(): Promise<void> {
        const all = await listMediaDevices();
        setMics(toDeviceOptions(all, "audioinput"));
        setSpeakers(toDeviceOptions(all, "audiooutput"));
    }
    useEffect(() => {
        if (isSelf) void loadDevices();
    }, [isSelf]);

    function pickMic(id: string | null): void {
        setAudioInputDeviceId(id);
        void setVoiceInputDevice(id);
    }
    function pickSpeaker(id: string | null): void {
        setAudioOutputDeviceId(id);
        setVoiceOutputDevice(id);
    }

    // Zami: not ported: the accordion's keyboard navigation
    // (`handleParentKeydown`, `handleDeviceKeydown`: arrow keys open a section
    // and move focus between its devices).

    // Same viewport-clamping action the room/space context menus use.
    // Zami: the `positionMenu` action, as a measuring pass: the menu lays out
    // hidden at the top-left, and its size places it. A menu reopened on a NEW
    // target (new x/y) measures again, so mount-only positioning can't strand
    // it at the old target's coordinates, and a prior clamp doesn't leak.
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

    // Which act() is in flight, so the menu can disable itself and say so —
    // same idiom as UserProfileCard's `pending`. The menu only closes once the
    // action settles, and creating a DM now waits for the new room to reach the
    // SDK store (up to 15s), so an unguarded second click would run the action
    // twice: two concurrent createDirectMessage calls can both miss the
    // existing-DM check and leave the user with two DM rooms for one contact.
    type MenuAction = "message" | "block" | "kick" | "ban";
    const [pending, setPending] = useState<MenuAction | null>(null);
    const pendingRef = useRef<MenuAction | null>(null);
    // Which moderation action is armed for confirmation — mirrors
    // UserProfileCard's `confirming` flow (UX-07).
    const [confirming, setConfirming] = useState<"kick" | "ban" | null>(null);

    // Reset confirming state when the open menu is retargeted to a different
    // participant (the host can swap userId without remounting), so an armed
    // Kick/Ban never carries over to someone else.
    useEffect(() => {
        setConfirming(null);
    }, [userId]);

    // `fallback` may be a thunk so it can read live derived state (e.g. `name`)
    // at failure time rather than capturing it when the handler is built.
    function act(
        id: MenuAction,
        fn: () => Promise<unknown>,
        fallback: string | (() => string),
    ) {
        return async () => {
            // Belt-and-braces with the disabled attribute: this closes the
            // window before Svelte has flushed `pending` to the DOM.
            // Zami: a ref, which the next press sees before React re-renders.
            if (pendingRef.current !== null) return;
            pendingRef.current = id;
            setPending(id);
            try {
                await fn();
            } catch (err) {
                const msg =
                    typeof fallback === "function" ? fallback() : fallback;
                showErrorToast(matrixErrorMessage(err, msg));
            } finally {
                pendingRef.current = null;
                setPending(null);
                onClose();
            }
        };
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

    // Open the card BEFORE closing the menu: openProfileCard() measures the
    // anchor's rect, and onClose() unmounts this menu (and its Portal), which
    // would detach the anchor and zero the rect. Ordering is safe because our
    // onClose releases the slot with clearModalIfOwner (a stale-token no-op once
    // the card owns the modal), so it can't shut the freshly-opened card.
    // Zami: the button's window box stands in for the anchor element;
    // openProfileCard only reads its getBoundingClientRect().
    const profileButton = useRef<PressableInstance>(null);
    const onProfile = () => {
        profileButton.current?.measureInWindow((left, top, width, height) => {
            const anchor = {
                getBoundingClientRect: () => ({
                    top,
                    left,
                    right: left + width,
                    bottom: top + height,
                }),
            } as unknown as HTMLElement;
            openProfileCard(userId, anchor);
            onClose();
        });
    };
    const onMessage = act(
        "message",
        async () => {
            const wantEncrypted = shouldEncryptNewDm({
                cryptoReady: isCryptoAvailable(),
                setting: settingsState.encryptNewDms,
            });
            // No DM yet: open a draft, created on its first message, rather
            // than inviting someone the user may only have meant to look at.
            if (!hasExistingDirectMessage(userId)) {
                openDraftDm(userId, wantEncrypted);
                return;
            }
            const { roomId, followUp } = await createDirectMessage(
                userId,
                wantEncrypted,
            );
            surfaceFollowUp(followUp);
            if (
                shouldWarnPlaintextDmReuse({
                    followUpStatus: followUp.status,
                    wantEncrypted,
                    roomEncrypted: isRoomEncrypted(getRoom(roomId)),
                })
            ) {
                showErrorToast(PLAINTEXT_DM_REUSE_WARNING);
            }
            setActiveRoom(roomId);
        },
        t("callParticipantMenu.couldNotOpenADirectMessage"),
    );
    const onToggleBlock = act(
        "block",
        async () => (blocked ? unblockUser(userId) : blockUser(userId)),
        "Could not update the block list",
    );
    // Kick and ban use two-step confirmation: first click arms `confirming`,
    // second click runs the action. Arming one clears the other.
    async function onKick() {
        if (confirming !== "kick") {
            setConfirming("kick");
            return;
        }
        await act(
            "kick",
            () => kickUser(room.roomId, userId),
            () => t("callParticipantMenu.couldNotKick", { name }),
        )();
    }
    async function onBan() {
        if (confirming !== "ban") {
            setConfirming("ban");
            return;
        }
        await act(
            "ban",
            () => banUser(room.roomId, userId),
            () => t("callParticipantMenu.couldNotBan", { name }),
        )();
    }
    const onMention = () => {
        const ctx = { roomId: room.roomId, userId };
        hostBridge.pendingMention = ctx;
        setActiveRoom(room.roomId);
        showChatView();
        // If a composer for this room is already mounted (menu opened from the room
        // list while its chat is showing), insert immediately; the handler clears
        // the queue on success and self-guards on roomId, so this never double-inserts.
        hostBridge.insertMention?.(ctx);
        onClose();
    };

    // The focus trap's Escape, as Android's back button (VoiceOver's escape
    // gesture is the menu's onAccessibilityEscape). The sheet has its own.
    const close = useEffectEvent(() => onClose());
    useEffect(() => {
        if (touch) return;
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                close();
                return true;
            },
        );
        return () => subscription.remove();
    }, [touch]);

    const menuItems = () => (
        <>
            <Pressable
                ref={profileButton}
                accessibilityRole="button"
                onPress={onProfile}
                className="w-full px-3 py-1.5 hover:bg-discord-messageHover transition-colors"
            >
                <Text className="text-sm text-discord-textSecondary hover:text-discord-textPrimary">
                    {t("callParticipantMenu.profile")}
                </Text>
            </Pressable>
            {isSelf && (
                <>
                    <View className="w-full h-px bg-discord-divider my-1" />

                    {/* Input (Microphone) accordion */}
                    <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                            setOpenSection(toggleSubmenu(openSection, "input"))
                        }
                        onHoverIn={
                            touch ? undefined : () => setOpenSection("input")
                        }
                        accessibilityState={{
                            expanded: openSection === "input",
                        }}
                        className="w-full px-3 py-1.5 hover:bg-discord-messageHover transition-colors flex-row items-center gap-2"
                    >
                        {/* Zami: `mirror:` (`:dir(rtl)`) → Uniwind's `rtl:`. */}
                        <ChevronRight
                            size={14}
                            className={`text-discord-textSecondary transition-transform flex-shrink-0 ${
                                openSection === "input"
                                    ? "rotate-90"
                                    : "rtl:-scale-x-100"
                            }`}
                        />
                        <Text className="flex-shrink-0 text-sm text-discord-textSecondary">
                            {t("callParticipantMenu.input")}
                        </Text>
                        <Text
                            numberOfLines={1}
                            className="flex-shrink text-xs text-discord-textMuted truncate ms-auto"
                        >
                            {activeDeviceLabel(mics, audioInputDeviceId)}
                        </Text>
                    </Pressable>
                    {openSection === "input" && (
                        <>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => pickMic(null)}
                                accessibilityState={{
                                    selected: !audioInputDeviceId,
                                }}
                                className="w-full px-3 py-1.5 hover:bg-discord-messageHover transition-colors flex-row items-center gap-2 ps-6"
                            >
                                <View className="w-3 flex-row items-center justify-center">
                                    {!audioInputDeviceId && (
                                        <FilledCircle
                                            size={8}
                                            className="text-discord-textSecondary"
                                        />
                                    )}
                                </View>
                                <Text className="text-sm text-discord-textSecondary">
                                    {t("common.default")}
                                </Text>
                            </Pressable>
                            {mics.map((m) => (
                                <Pressable
                                    key={m.id}
                                    accessibilityRole="button"
                                    onPress={() => pickMic(m.id)}
                                    accessibilityState={{
                                        selected: audioInputDeviceId === m.id,
                                    }}
                                    className="w-full px-3 py-1.5 hover:bg-discord-messageHover transition-colors flex-row items-center gap-2 ps-6"
                                >
                                    <View className="w-3 flex-row items-center justify-center">
                                        {audioInputDeviceId === m.id && (
                                            <FilledCircle
                                                size={8}
                                                className="text-discord-textSecondary"
                                            />
                                        )}
                                    </View>
                                    <Text
                                        numberOfLines={1}
                                        className="flex-shrink truncate text-sm text-discord-textSecondary"
                                    >
                                        {m.label}
                                    </Text>
                                </Pressable>
                            ))}
                        </>
                    )}

                    <View className="w-full h-px bg-discord-divider my-1" />

                    {/* Output (Speaker) accordion */}
                    <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                            setOpenSection(toggleSubmenu(openSection, "output"))
                        }
                        onHoverIn={
                            touch ? undefined : () => setOpenSection("output")
                        }
                        accessibilityState={{
                            expanded: openSection === "output",
                        }}
                        className="w-full px-3 py-1.5 hover:bg-discord-messageHover transition-colors flex-row items-center gap-2"
                    >
                        <ChevronRight
                            size={14}
                            className={`text-discord-textSecondary transition-transform flex-shrink-0 ${
                                openSection === "output"
                                    ? "rotate-90"
                                    : "rtl:-scale-x-100"
                            }`}
                        />
                        <Text className="flex-shrink-0 text-sm text-discord-textSecondary">
                            {t("callParticipantMenu.output")}
                        </Text>
                        <Text
                            numberOfLines={1}
                            className="flex-shrink text-xs text-discord-textMuted truncate ms-auto"
                        >
                            {activeDeviceLabel(speakers, audioOutputDeviceId)}
                        </Text>
                    </Pressable>
                    {openSection === "output" && (
                        <>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => pickSpeaker(null)}
                                accessibilityState={{
                                    selected: !audioOutputDeviceId,
                                }}
                                className="w-full px-3 py-1.5 hover:bg-discord-messageHover transition-colors flex-row items-center gap-2 ps-6"
                            >
                                <View className="w-3 flex-row items-center justify-center">
                                    {!audioOutputDeviceId && (
                                        <FilledCircle
                                            size={8}
                                            className="text-discord-textSecondary"
                                        />
                                    )}
                                </View>
                                <Text className="text-sm text-discord-textSecondary">
                                    {t("common.default")}
                                </Text>
                            </Pressable>
                            {speakers.map((s) => (
                                <Pressable
                                    key={s.id}
                                    accessibilityRole="button"
                                    onPress={() => pickSpeaker(s.id)}
                                    accessibilityState={{
                                        selected: audioOutputDeviceId === s.id,
                                    }}
                                    className="w-full px-3 py-1.5 hover:bg-discord-messageHover transition-colors flex-row items-center gap-2 ps-6"
                                >
                                    <View className="w-3 flex-row items-center justify-center">
                                        {audioOutputDeviceId === s.id && (
                                            <FilledCircle
                                                size={8}
                                                className="text-discord-textSecondary"
                                            />
                                        )}
                                    </View>
                                    <Text
                                        numberOfLines={1}
                                        className="flex-shrink truncate text-sm text-discord-textSecondary"
                                    >
                                        {s.label}
                                    </Text>
                                </Pressable>
                            ))}
                        </>
                    )}
                </>
            )}
            {!isSelf && (
                <>
                    <Pressable
                        accessibilityRole="button"
                        onPress={onMessage}
                        disabled={pending !== null}
                        accessibilityState={{ disabled: pending !== null }}
                        className="w-full px-3 py-1.5 hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                    >
                        <Text className="text-sm text-discord-textSecondary hover:text-discord-textPrimary">
                            {pending === "message"
                                ? t("callParticipantMenu.opening")
                                : t("callParticipantMenu.message")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={onMention}
                        className="w-full px-3 py-1.5 hover:bg-discord-messageHover transition-colors"
                    >
                        <Text className="text-sm text-discord-textSecondary hover:text-discord-textPrimary">
                            {t("callParticipantMenu.mention")}
                        </Text>
                    </Pressable>

                    <View className="w-full h-px bg-discord-divider my-1" />

                    {/* Zami: the `<label for>` names the slider, and the
                        `<datalist>` tick at 100% is the slider's `tick`. */}
                    <View className="px-3 py-1.5">
                        <View className="flex-row items-center justify-between gap-2">
                            <Text className="flex-shrink text-xs text-discord-textMuted uppercase font-semibold tracking-wide">
                                {t("callParticipantMenu.userVolume")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted tabular-nums flex-shrink-0">
                                {Math.round(audio.volume * 100)}%
                            </Text>
                        </View>
                        <Range
                            min={0}
                            max={MAX_PARTICIPANT_VOLUME * 100}
                            step={1}
                            tick={100}
                            value={Math.round(audio.volume * 100)}
                            accessibilityLabel={t(
                                "callParticipantMenu.userVolume",
                            )}
                            onInput={(value) =>
                                setUserVolume(userId, value / 100)
                            }
                            className="w-full mt-1.5"
                        />
                    </View>
                    <View className="px-3 py-1.5">
                        <View className="flex-row items-center justify-between gap-2">
                            <Text className="flex-shrink text-xs text-discord-textMuted uppercase font-semibold tracking-wide">
                                {t("callParticipantMenu.soundboardVolume")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted tabular-nums flex-shrink-0">
                                {Math.round(audio.soundVolume * 100)}%
                            </Text>
                        </View>
                        <Range
                            min={0}
                            max={MAX_PARTICIPANT_VOLUME * 100}
                            step={1}
                            tick={100}
                            value={Math.round(audio.soundVolume * 100)}
                            accessibilityLabel={t(
                                "callParticipantMenu.soundboardVolume",
                            )}
                            onInput={(value) =>
                                setUserSoundVolume(userId, value / 100)
                            }
                            className="w-full mt-1.5"
                        />
                    </View>
                    {sharesAudio && (
                        <View className="px-3 py-1.5">
                            <View className="flex-row items-center justify-between gap-2">
                                <Text className="flex-shrink text-xs text-discord-textMuted uppercase font-semibold tracking-wide">
                                    {t("callParticipantMenu.shareVolume")}
                                </Text>
                                <Text className="text-xs text-discord-textMuted tabular-nums flex-shrink-0">
                                    {Math.round(audio.shareVolume * 100)}%
                                </Text>
                            </View>
                            <Range
                                min={0}
                                max={MAX_PARTICIPANT_VOLUME * 100}
                                step={1}
                                tick={100}
                                value={Math.round(audio.shareVolume * 100)}
                                accessibilityLabel={t(
                                    "callParticipantMenu.shareVolume",
                                )}
                                onInput={(value) =>
                                    setUserShareVolume(userId, value / 100)
                                }
                                className="w-full mt-1.5"
                            />
                        </View>
                    )}
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => setUserLocalMute(userId, !audio.muted)}
                        accessibilityState={{ selected: audio.muted }}
                        className="w-full px-3 py-1.5 hover:bg-discord-messageHover transition-colors flex-row items-center gap-2"
                    >
                        <View className="w-3 flex-row items-center justify-center">
                            {audio.muted && (
                                <FilledCircle
                                    size={8}
                                    className="text-discord-textSecondary"
                                />
                            )}
                        </View>
                        <Text className="text-sm text-discord-textSecondary hover:text-discord-textPrimary">
                            {t("common.mute")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                            setUserVideoHidden(userId, !audio.videoHidden)
                        }
                        accessibilityState={{ selected: audio.videoHidden }}
                        className="w-full px-3 py-1.5 hover:bg-discord-messageHover transition-colors flex-row items-center gap-2"
                    >
                        <View className="w-3 flex-row items-center justify-center">
                            {audio.videoHidden && (
                                <FilledCircle
                                    size={8}
                                    className="text-discord-textSecondary"
                                />
                            )}
                        </View>
                        <Text className="text-sm text-discord-textSecondary hover:text-discord-textPrimary">
                            {t("callParticipantMenu.hideVideo")}
                        </Text>
                    </Pressable>

                    <View className="w-full h-px bg-discord-divider my-1" />

                    <Pressable
                        accessibilityRole="button"
                        onPress={onToggleBlock}
                        disabled={pending !== null}
                        accessibilityState={{ disabled: pending !== null }}
                        className="w-full px-3 py-1.5 hover:bg-discord-danger active:bg-discord-danger transition-colors disabled:opacity-50"
                    >
                        <Text className="text-sm text-discord-danger hover:text-white">
                            {pending === "block"
                                ? t("common.saving")
                                : blocked
                                  ? t("common.unblock")
                                  : t("common.block")}
                        </Text>
                    </Pressable>

                    {(gates.canKick || gates.canBan) && (
                        <View className="w-full h-px bg-discord-divider my-1" />
                    )}
                    {gates.canKick && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void onKick()}
                            disabled={pending !== null}
                            accessibilityState={{ disabled: pending !== null }}
                            className="w-full px-3 py-1.5 hover:bg-discord-danger active:bg-discord-danger transition-colors disabled:opacity-50"
                        >
                            <Text
                                numberOfLines={1}
                                className="text-sm text-discord-danger hover:text-white truncate"
                            >
                                {pending === "kick"
                                    ? t("callParticipantMenu.kicking")
                                    : confirming === "kick"
                                      ? t("callParticipantMenu.confirmKick", {
                                            name,
                                        })
                                      : t("callParticipantMenu.kickFromRoom", {
                                            name,
                                        })}
                            </Text>
                        </Pressable>
                    )}
                    {gates.canBan && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void onBan()}
                            disabled={pending !== null}
                            accessibilityState={{ disabled: pending !== null }}
                            className="w-full px-3 py-1.5 hover:bg-discord-danger active:bg-discord-danger transition-colors disabled:opacity-50"
                        >
                            <Text
                                numberOfLines={1}
                                className="text-sm text-discord-danger hover:text-white truncate"
                            >
                                {pending === "ban"
                                    ? t("callParticipantMenu.banning")
                                    : confirming === "ban"
                                      ? t("callParticipantMenu.confirmBan", {
                                            name,
                                        })
                                      : t("callParticipantMenu.ban", { name })}
                            </Text>
                        </Pressable>
                    )}
                </>
            )}
        </>
    );

    const menuClass =
        "absolute z-50 bg-discord-backgroundTertiary border border-discord-divider rounded-lg shadow-xl min-w-44 max-w-56";

    return (
        <Portal>
            {touch ? (
                <BottomSheet onClose={onClose}>{menuItems()}</BottomSheet>
            ) : (
                // Zami: `dismissOnOutsidePointer` → a backdrop filling the layer.
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
                                <View className="py-1">{menuItems()}</View>
                            </ScrollView>
                        </View>
                    ) : (
                        <View
                            pointerEvents="none"
                            className={menuClass}
                            style={styles.measuring}
                            onLayout={(e) =>
                                setPlaced(
                                    positionMenu(
                                        { x, y },
                                        e.nativeEvent.layout,
                                    ),
                                )
                            }
                        >
                            <View className="py-1">{menuItems()}</View>
                        </View>
                    )}
                </View>
            )}
        </Portal>
    );
}

const styles = StyleSheet.create({
    measuring: { left: 0, top: 0, opacity: 0 },
    // Sized by its content, up to the menu's max height.
    scroll: { flexGrow: 0, flexShrink: 1 },
});

// Zami: `<Circle fill="currentColor" />`: the fill is the color its class gives the
// stroke, as there's no currentColor.
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

// Zami: React Native has no <input type="range">. This is a track and thumb: a touch
// or drag along it reports each value as it moves (`oninput`), and VoiceOver steps
// it (swipe up/down). `tick` marks one value on the track, as a <datalist> does.
function Range({
    min,
    max,
    step,
    value,
    tick,
    onInput,
    accessibilityLabel,
    className = "",
}: {
    min: number;
    max: number;
    step: number;
    value: number;
    tick?: number;
    onInput: (value: number) => void;
    accessibilityLabel: string;
    className?: string;
}) {
    const [width, setWidth] = useState(0);
    // The track's left edge on the page, taken when a touch starts.
    const left = useRef(0);
    const last = useRef(value);
    const fractionOf = (v: number) =>
        max > min ? Math.min(Math.max((v - min) / (max - min), 0), 1) : 0;
    const fraction = fractionOf(value);
    const THUMB = 16;

    function clamp(next: number): number {
        return Math.min(max, Math.max(min, next));
    }

    function track(pageX: number) {
        if (width <= 0) return;
        const at = Math.min(Math.max((pageX - left.current) / width, 0), 1);
        const next = clamp(min + Math.round((at * (max - min)) / step) * step);
        if (next === last.current) return;
        last.current = next;
        onInput(next);
    }

    return (
        <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={accessibilityLabel}
            accessibilityValue={{ min, max, now: value }}
            accessibilityActions={[
                { name: "increment" },
                { name: "decrement" },
            ]}
            onAccessibilityAction={(event) => {
                const delta =
                    event.nativeEvent.actionName === "increment" ? step : -step;
                const next = clamp(value + delta);
                if (next !== value) onInput(next);
            }}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={(event: GestureResponderEvent) => {
                left.current =
                    event.nativeEvent.pageX - event.nativeEvent.locationX;
                last.current = value;
                track(event.nativeEvent.pageX);
            }}
            onResponderMove={(event: GestureResponderEvent) =>
                track(event.nativeEvent.pageX)
            }
            className={`h-6 justify-center ${className}`}
        >
            <View
                pointerEvents="none"
                className="h-1 rounded-full bg-discord-divider overflow-hidden"
            >
                <View
                    className="h-1 bg-discord-accent"
                    style={{ width: `${fraction * 100}%` }}
                />
            </View>
            {tick !== undefined && (
                <View
                    pointerEvents="none"
                    className="absolute bottom-0 w-px h-1.5 bg-discord-textMuted"
                    style={{
                        left:
                            THUMB / 2 +
                            fractionOf(tick) * Math.max(width - THUMB, 0),
                    }}
                />
            )}
            <View
                pointerEvents="none"
                className="absolute w-4 h-4 rounded-full bg-discord-accent"
                style={{ left: fraction * Math.max(width - THUMB, 0) }}
            />
        </View>
    );
}
