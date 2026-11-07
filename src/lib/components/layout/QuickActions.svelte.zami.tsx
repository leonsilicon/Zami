import { Checkbox, Spin, SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { ChevronDown, ChevronRight } from "lucide-svelte";
import {
    useImperativeHandle,
    useMemo,
    useState,
    type ReactNode,
    type Ref,
} from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import {
    createRoom,
    createSpace,
    createDirectMessage,
    hasExistingDirectMessage,
    joinRoomByAlias,
    knockRoom,
    canAddRoomToSpace,
    getRoom,
    retryRoomFollowUp,
    markRoomPendingArrival,
    getOwnUserId,
} from "$lib/matrix/client";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import type { RoomFollowUp } from "$lib/utils/roomCreationOutcome";
import { isCryptoAvailable, isRoomEncrypted } from "$lib/matrix/crypto";
import { shouldOfferKnock, matrixErrorMessage } from "$lib/utils/knock";
import {
    shouldEncryptNewDm,
    shouldWarnPlaintextDmReuse,
    PLAINTEXT_DM_REUSE_WARNING,
} from "$lib/utils/roomEncryption";
import { settingsState } from "$lib/stores/settings.svelte";
import {
    setActiveRoom,
    setActiveSpace,
    openDraftDm,
} from "$lib/stores/rooms.svelte";
import {
    interfaceState,
    openModal,
    closeModal,
} from "$lib/stores/interface.svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import Portal from "$lib/components/ui/Portal.svelte";
import UserPicker from "$lib/components/ui/UserPicker.svelte";

type Mode = "create-room" | "create-space" | "create-dm" | "join-room";

/** Zami: what `bind:this` gave upstream's parent (`shortcutActions?.openMode(mode)`), through `ref`. */
export interface QuickActionsHandle {
    openMode: (m: Mode) => void;
}

interface Props {
    /** If set, new rooms are created inside this space */
    spaceId?: string;
    /** Called after an action button is clicked (e.g. to close a dropdown) */
    onaction?: () => void;
    /** Compact "add a space" menu: only Create-space + Join-by-address.
     *  Used by the space-rail "+" so it reads as an add-a-server chooser,
     *  not a full create menu. */
    compact?: boolean;
    /** No buttons, just the dialog, opened through openMode (the
     *  keyboard shortcuts in AppShell). */
    headless?: boolean;
    ref?: Ref<QuickActionsHandle>;
}

// Zami: <details>/<summary> → a pressable summary, with the browser's disclosure
// marker, that shows or hides the body. A closed <details> keeps its content, so
// the body stays mounted (hidden) rather than unmounting.
function Details({
    className,
    summary,
    children,
}: {
    className: string;
    summary: ReactNode;
    children?: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const Marker = open ? ChevronDown : ChevronRight;
    return (
        <View className={className}>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => setOpen(!open)}
                className="flex-row items-center gap-1"
            >
                <Marker size={14} className="text-discord-textPrimary" />
                {summary}
            </Pressable>
            <View className={open ? undefined : "hidden"}>{children}</View>
        </View>
    );
}

// Zami: `style="padding-inline-start: 0.5rem;"` on the action buttons → `ps-2`.
export default function QuickActions({
    spaceId,
    onaction,
    compact = false,
    headless = false,
    ref,
}: Props) {
    const [mode, setMode] = useState<Mode | null>(null);
    const [input1, setInput1] = useState(""); // room name / space name / user id / room address
    const [input2, setInput2] = useState(""); // room topic / space topic
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    // Encryption toggle for create-room / create-dm. Only offered when crypto
    // started this session (encrypting a room we can't decrypt is a foot-gun).
    const [encrypt, setEncrypt] = useState(false);
    // Video-room toggle for create-room. Orthogonal to encryption, so it is
    // offered whether or not crypto started this session.
    const [videoRoom, setVideoRoom] = useState(false);
    // Create-space: also make a text and a voice room, joinable by the space.
    const [starterRooms, setStarterRooms] = useState(true);
    // Room v12 additional creators (create-room only; never a DM).
    const [creators, setCreators] = useState<string[]>([]);
    const [cryptoReady] = useState(isCryptoAvailable);

    // When encryption is requested but an *existing* (plaintext) DM is reused,
    // createDirectMessage deliberately won't retroactively encrypt it. Surface
    // that here instead of silently opening a DM the user asked to encrypt.
    const [notice, setNotice] = useState("");
    const [noticeRoomId, setNoticeRoomId] = useState<string | null>(null);

    const modalOpen = useRune(() => interfaceState.modal === "quick-actions");

    // A created room whose follow-up write failed (or timed out unconfirmed):
    // the room is real, so we open it and offer a retry of ONLY the failed
    // step. Reporting a failure here would send the user back to the form to
    // create a duplicate (TX-01).
    function surfaceFollowUp(followUp: RoomFollowUp) {
        // Deliberately silent on success — this store is an ERROR surface (red,
        // role="alert"), and a landed follow-up is already visible without it:
        // the DM moves into the DM list, the room appears in the space.
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

    async function startDm(userId: string) {
        setError("");
        setNotice("");
        setNoticeRoomId(null);
        setLoading(true);
        try {
            const wantEncrypted = shouldEncryptNewDm({
                cryptoReady,
                setting: encrypt,
            });
            // No DM yet: open a draft, created on its first message.
            if (!hasExistingDirectMessage(userId)) {
                openDraftDm(userId, wantEncrypted);
                close();
                return;
            }
            const { roomId, followUp } = await createDirectMessage(
                userId,
                wantEncrypted,
            );
            surfaceFollowUp(followUp);
            // The notice is about REUSING an existing plaintext DM, so it must
            // only fire when one was actually reused. `status === "none"` is
            // exactly that signal: the existing-joined-DM early return is
            // createDirectMessage's ONLY path that skips a follow-up — a fresh
            // creation and a stranded-room reuse both run one and come back
            // "ok" or "failed".
            //
            // Without that gate a freshly created ENCRYPTED DM tripped it too:
            // the SDK's createRoom is a bare POST that stores no Room, so
            // getRoom() is null until /sync and isRoomEncrypted(null) is false.
            // The user got "you already have an unencrypted DM" while the toast
            // said the DM had just been created — and the picker stayed open,
            // the one path on this branch that could still create a second room.
            if (
                shouldWarnPlaintextDmReuse({
                    followUpStatus: followUp.status,
                    wantEncrypted,
                    roomEncrypted: isRoomEncrypted(getRoom(roomId)),
                })
            ) {
                setNotice(PLAINTEXT_DM_REUSE_WARNING);
                setNoticeRoomId(roomId);
                setLoading(false);
                return;
            }
            if (mode === "create-space") {
                // Switch into the new space; claim it first so the landing
                // chain doesn't treat a not-yet-synced space as gone.
                markRoomPendingArrival(roomId);
                setActiveSpace(roomId);
            } else {
                setActiveRoom(roomId);
            }
            close();
        } catch (e: any) {
            setError(
                e?.data?.error ??
                    e?.message ??
                    t("quickActions.somethingWentWrong"),
            );
        } finally {
            setLoading(false);
        }
    }

    function openNoticeRoom() {
        if (noticeRoomId) {
            setActiveRoom(noticeRoomId);
            close();
        }
    }

    // Knock-to-join flow (join-room mode only)
    const [knockOffered, setKnockOffered] = useState(false);
    const [knockReason, setKnockReason] = useState("");
    const [knockSent, setKnockSent] = useState(false);

    function resetKnock() {
        setKnockOffered(false);
        setKnockReason("");
        setKnockSent(false);
    }

    function open(m: Mode) {
        onaction?.();
        // Claim first — a same-id handover runs the outgoing close, which nulls mode.
        openModal("quick-actions", () => setMode(null));
        setMode(m);
        setInput1("");
        setInput2("");
        setError("");
        setNotice("");
        setNoticeRoomId(null);
        // New DMs pre-check the account default; new rooms default off.
        setEncrypt(m === "create-dm" ? settingsState.encryptNewDms : false);
        setVideoRoom(false);
        setCreators([]);
        setStarterRooms(true);
        resetKnock();
    }

    function close() {
        closeModal();
    }

    function openMode(m: Mode) {
        open(m);
    }
    useImperativeHandle(ref, () => ({ openMode }));

    async function submit() {
        setError("");
        setLoading(true);
        try {
            let roomId: string;
            let followUp: RoomFollowUp = { status: "none" };
            if (mode === "create-room") {
                // In a space, anyone in the space can join (restricted join
                // rule), like the starter rooms createSpace makes; outside one
                // createRoom ignores this and the room stays invite-only.
                const created = await createRoom(
                    input1.trim(),
                    input2.trim(),
                    spaceId,
                    cryptoReady && encrypt,
                    videoRoom,
                    !!spaceId,
                    creators,
                );
                roomId = created.roomId;
                followUp = created.followUp;
            } else if (mode === "create-space") {
                roomId = await createSpace(
                    input1.trim(),
                    input2.trim(),
                    starterRooms,
                );
            } else {
                const alias = input1.trim();
                if (!alias.startsWith("#") && !alias.startsWith("!")) {
                    setError(t("quickActions.enterARoomAddressRoomServer"));
                    return;
                }
                roomId = await joinRoomByAlias(alias);
            }
            surfaceFollowUp(followUp);
            setActiveRoom(roomId);
            close();
        } catch (e: any) {
            setError(
                e?.data?.error ??
                    e?.message ??
                    t("quickActions.somethingWentWrong"),
            );
            if (mode === "join-room" && shouldOfferKnock(e, undefined)) {
                setKnockOffered(true);
            }
        } finally {
            setLoading(false);
        }
    }

    async function submitKnock() {
        setError("");
        setLoading(true);
        try {
            await knockRoom(input1.trim(), knockReason);
            setKnockSent(true);
        } catch (e) {
            setError(
                matrixErrorMessage(
                    e,
                    t("quickActions.couldNotSendTheJoinRequest"),
                ),
            );
        } finally {
            setLoading(false);
        }
    }

    // Zami: Enter in the dialog → each text input's `onSubmitEditing`. The
    // DM picker handles its own Enter.
    function onKeydown() {
        if (mode === "join-room" && knockSent) close();
        else if (mode === "join-room" && knockOffered) void submitKnock();
        else if (mode !== "create-dm") void submit();
    }

    // Zami: a stable list for the picker (its memos key on it).
    const ownUserId = getOwnUserId() ?? "";
    const excludeSelf = useMemo(() => [ownUserId], [ownUserId]);

    return (
        <>
            {/* Action buttons */}
            {!headless && (
                <View className="flex flex-col">
                    {!spaceId && !compact && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => open("create-dm")}
                            className="w-full flex-row items-center gap-2 pe-2 ps-2 py-1.5 hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                        >
                            <SvgIcon
                                className="w-4 h-4 flex-shrink-0 opacity-70 text-discord-textMuted"
                                d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"
                            />
                            <Text
                                numberOfLines={1}
                                className="flex-1 text-sm text-discord-textMuted"
                            >
                                {t("quickActions.newDm")}
                            </Text>
                        </Pressable>
                    )}
                    {!compact && (!spaceId || canAddRoomToSpace(spaceId)) && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => open("create-room")}
                            className="w-full flex-row items-center gap-2 pe-2 ps-2 py-1.5 hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                        >
                            <SvgIcon
                                className="w-4 h-4 flex-shrink-0 opacity-70 text-discord-textMuted"
                                d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"
                            />
                            <Text
                                numberOfLines={1}
                                className="flex-1 text-sm text-discord-textMuted"
                            >
                                {spaceId
                                    ? t("quickActions.createRoomInSpace")
                                    : t("quickActions.createNewRoom")}
                            </Text>
                        </Pressable>
                    )}
                    {!spaceId && (
                        <>
                            <Pressable
                                onPress={() => open("create-space")}
                                accessibilityRole={
                                    compact ? "menuitem" : "button"
                                }
                                className="w-full flex-row items-center gap-2 pe-2 ps-2 py-1.5 hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                            >
                                <SvgIcon
                                    className="w-4 h-4 flex-shrink-0 opacity-70 text-discord-textMuted"
                                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"
                                />
                                <Text
                                    numberOfLines={1}
                                    className="flex-1 text-sm text-discord-textMuted"
                                >
                                    {t("quickActions.createNewSpace")}
                                </Text>
                            </Pressable>
                            <Pressable
                                onPress={() => open("join-room")}
                                accessibilityRole={
                                    compact ? "menuitem" : "button"
                                }
                                className="w-full flex-row items-center gap-2 pe-2 ps-2 py-1.5 hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                            >
                                <SvgIcon
                                    className="w-4 h-4 flex-shrink-0 opacity-70 text-discord-textMuted"
                                    d="M11 7 9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"
                                />
                                <Text
                                    numberOfLines={1}
                                    className="flex-1 text-sm text-discord-textMuted"
                                >
                                    {t("quickActions.joinRoomByAddress")}
                                </Text>
                            </Pressable>
                        </>
                    )}
                </View>
            )}

            {/* Modal */}
            <Portal>
                {modalOpen && mode !== null && (
                    // Zami: the panel scrolls (`max-h-full` of the layer, which
                    // the keyboard shrinks), so a tall form stays reachable
                    // above the on-screen keyboard; its padding and gap move to
                    // the scroll content.
                    <ModalDialog
                        onClose={close}
                        labelledBy="quick-actions-title"
                        panelClass="relative bg-discord-background rounded-lg shadow-xl w-full max-w-md mx-4 max-h-full overflow-hidden"
                    >
                        <ScrollView
                            keyboardShouldPersistTaps="handled"
                            contentContainerClassName="p-6 flex flex-col gap-4"
                        >
                            <Text
                                nativeID="quick-actions-title"
                                role="heading"
                                className="text-lg font-bold text-discord-textPrimary"
                            >
                                {mode === "create-room"
                                    ? spaceId
                                        ? t("quickActions.createRoomInSpace")
                                        : t("quickActions.createARoom")
                                    : mode === "create-space"
                                      ? t("quickActions.createASpace")
                                      : mode === "create-dm"
                                        ? t("quickActions.newDirectMessage")
                                        : t("quickActions.joinARoom")}
                            </Text>

                            {mode === "create-room" ||
                            mode === "create-space" ? (
                                <View className="flex flex-col gap-3">
                                    <View>
                                        <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                            {mode === "create-space"
                                                ? t("quickActions.spaceName")
                                                : t("quickActions.roomName")}
                                        </Text>
                                        {/* Zami: focused on open, as the
                                            dialog's focus trap focuses its
                                            first field. */}
                                        <TextInput
                                            value={input1}
                                            onChangeText={setInput1}
                                            onSubmitEditing={onKeydown}
                                            submitBehavior="submit"
                                            returnKeyType="go"
                                            autoFocus
                                            accessibilityLabel={
                                                mode === "create-space"
                                                    ? t(
                                                          "quickActions.spaceName",
                                                      )
                                                    : t("quickActions.roomName")
                                            }
                                            placeholder={
                                                mode === "create-space"
                                                    ? t("quickActions.mySpace")
                                                    : "my-room"
                                            }
                                            placeholderTextColorClassName="accent-discord-textMuted"
                                            className="w-full px-3 py-2 bg-discord-backgroundSecondary text-discord-textPrimary rounded border border-discord-divider focus:border-discord-accent text-sm"
                                        />
                                    </View>
                                    <View>
                                        <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                            {t("common.topic")}{" "}
                                            <Text className="normal-case font-normal">
                                                {t("quickActions.optional")}
                                            </Text>
                                        </Text>
                                        <TextInput
                                            value={input2}
                                            onChangeText={setInput2}
                                            onSubmitEditing={onKeydown}
                                            submitBehavior="submit"
                                            returnKeyType="go"
                                            accessibilityLabel={t(
                                                "common.topic",
                                            )}
                                            placeholder={
                                                mode === "create-space"
                                                    ? t(
                                                          "quickActions.whatSThisSpaceAbout",
                                                      )
                                                    : t(
                                                          "quickActions.whatSThisRoomAbout",
                                                      )
                                            }
                                            placeholderTextColorClassName="accent-discord-textMuted"
                                            className="w-full px-3 py-2 bg-discord-backgroundSecondary text-discord-textPrimary rounded border border-discord-divider focus:border-discord-accent text-sm"
                                        />
                                    </View>
                                    {mode === "create-room" && (
                                        <Checkbox
                                            checked={videoRoom}
                                            onChange={setVideoRoom}
                                            className="items-start gap-2.5"
                                            label={
                                                <View className="shrink">
                                                    <Text className="text-sm text-discord-textPrimary">
                                                        {t("common.videoRoom")}
                                                    </Text>
                                                    <Text className="text-xs text-discord-textMuted">
                                                        {t(
                                                            "quickActions.opensStraightIntoACallMessages",
                                                        )}
                                                    </Text>
                                                </View>
                                            }
                                        />
                                    )}
                                    {mode === "create-room" && (
                                        <Details
                                            className="rounded border border-discord-divider px-3 py-2"
                                            summary={
                                                <Text className="shrink text-sm text-discord-textPrimary">
                                                    {t(
                                                        "quickActions.additionalCreators",
                                                    )}{" "}
                                                    <Text className="text-xs text-discord-textMuted">
                                                        {t(
                                                            "quickActions.optional",
                                                        )}
                                                    </Text>
                                                </Text>
                                            }
                                        >
                                            <View className="mt-2 flex flex-col gap-2">
                                                <Text className="text-xs text-discord-textMuted">
                                                    {t(
                                                        "quickActions.additionalCreatorsHint",
                                                    )}
                                                </Text>
                                                <UserPicker
                                                    mode="multi"
                                                    selected={creators}
                                                    onSelectedChange={
                                                        setCreators
                                                    }
                                                    excludeUserIds={excludeSelf}
                                                    disabled={loading}
                                                />
                                            </View>
                                        </Details>
                                    )}
                                    {mode === "create-space" && (
                                        <Checkbox
                                            checked={starterRooms}
                                            onChange={setStarterRooms}
                                            className="items-start gap-2.5"
                                            label={
                                                <View className="shrink">
                                                    <Text className="text-sm text-discord-textPrimary">
                                                        {t(
                                                            "quickActions.starterRooms",
                                                        )}
                                                    </Text>
                                                    <Text className="text-xs text-discord-textMuted">
                                                        {t(
                                                            "quickActions.starterRoomsHint",
                                                        )}
                                                    </Text>
                                                </View>
                                            }
                                        />
                                    )}
                                    {mode === "create-room" && cryptoReady && (
                                        <Checkbox
                                            checked={encrypt}
                                            onChange={setEncrypt}
                                            className="items-start gap-2.5"
                                            label={
                                                <View className="shrink">
                                                    <Text className="text-sm text-discord-textPrimary">
                                                        {t(
                                                            "quickActions.enableEncryption",
                                                        )}
                                                    </Text>
                                                    <Text className="text-xs text-discord-textMuted">
                                                        {t(
                                                            "quickActions.canTBeTurnedOffLater",
                                                        )}
                                                    </Text>
                                                </View>
                                            }
                                        />
                                    )}
                                </View>
                            ) : mode === "create-dm" ? (
                                <View className="flex flex-col gap-3">
                                    <UserPicker
                                        mode="single"
                                        autofocus
                                        disabled={loading}
                                        onpick={(userId) =>
                                            void startDm(userId)
                                        }
                                        placeholder={t(
                                            "quickActions.findSomeoneToMessage",
                                        )}
                                    />
                                    {cryptoReady && (
                                        <Checkbox
                                            checked={encrypt}
                                            onChange={setEncrypt}
                                            className="items-start gap-2.5"
                                            label={
                                                <View className="shrink">
                                                    <Text className="text-sm text-discord-textPrimary">
                                                        {t(
                                                            "quickActions.encryptThisDm",
                                                        )}
                                                    </Text>
                                                    <Text className="text-xs text-discord-textMuted">
                                                        {t(
                                                            "quickActions.canTBeTurnedOffLater",
                                                        )}
                                                    </Text>
                                                </View>
                                            }
                                        />
                                    )}
                                    {notice ? (
                                        <View className="rounded bg-discord-warning/10 border border-discord-warning/30 px-3 py-2 gap-2">
                                            <Text className="text-xs text-discord-warning">
                                                {notice}
                                            </Text>
                                            <Pressable
                                                accessibilityRole="button"
                                                onPress={openNoticeRoom}
                                                className="self-start px-3 py-1.5 bg-discord-messageHover rounded"
                                            >
                                                <Text className="text-discord-textPrimary text-xs">
                                                    {t(
                                                        "quickActions.openTheDm",
                                                    )}
                                                </Text>
                                            </Pressable>
                                        </View>
                                    ) : null}
                                </View>
                            ) : (
                                <View className="flex flex-col gap-3">
                                    <View>
                                        <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-1.5">
                                            {t("quickActions.roomAddressOrId")}
                                        </Text>
                                        {/* Zami: no autocapitalization or
                                            autocorrect, which would rewrite
                                            a typed address. */}
                                        <TextInput
                                            value={input1}
                                            onChangeText={(value) => {
                                                setInput1(value);
                                                resetKnock();
                                                setError("");
                                            }}
                                            onSubmitEditing={onKeydown}
                                            submitBehavior="submit"
                                            returnKeyType="go"
                                            autoFocus
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            accessibilityLabel={t(
                                                "quickActions.roomAddressOrId",
                                            )}
                                            placeholder={t(
                                                "quickActions.roomServerCom",
                                            )}
                                            placeholderTextColorClassName="accent-discord-textMuted"
                                            className="w-full px-3 py-2 bg-discord-backgroundSecondary text-discord-textPrimary rounded border border-discord-divider focus:border-discord-accent text-sm"
                                        />
                                    </View>
                                    {knockSent ? (
                                        <Text className="text-sm text-discord-textSecondary">
                                            {t(
                                                "quickActions.requestSentYouLlBeAble",
                                            )}
                                        </Text>
                                    ) : knockOffered ? (
                                        <View>
                                            <Text className="text-sm text-discord-textMuted mb-1.5">
                                                {t(
                                                    "quickActions.youCanTJoinThisRoom",
                                                )}
                                            </Text>
                                            <TextInput
                                                value={knockReason}
                                                onChangeText={setKnockReason}
                                                onSubmitEditing={onKeydown}
                                                submitBehavior="submit"
                                                returnKeyType="send"
                                                accessibilityLabel={t(
                                                    "common.reasonOptional",
                                                )}
                                                placeholder={t(
                                                    "common.reasonOptional",
                                                )}
                                                placeholderTextColorClassName="accent-discord-textMuted"
                                                className="w-full px-3 py-2 bg-discord-backgroundSecondary text-discord-textPrimary rounded border border-discord-divider focus:border-discord-accent text-sm"
                                            />
                                        </View>
                                    ) : null}
                                </View>
                            )}

                            {error ? (
                                <Text className="text-sm text-discord-danger">
                                    {error}
                                </Text>
                            ) : null}

                            <View className="flex flex-row justify-end gap-2 mt-1">
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={close}
                                    disabled={loading}
                                    accessibilityState={{ disabled: loading }}
                                    className="px-4 py-2 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors disabled:opacity-50"
                                >
                                    <Text className="text-sm font-medium text-discord-textMuted">
                                        {mode === "join-room" && knockSent
                                            ? t("common.close")
                                            : t("common.cancel")}
                                    </Text>
                                </Pressable>
                                {/* join-room with knockSent: request already
                                    sent; nothing left to submit */}
                                {mode === "join-room" &&
                                knockSent ? null : mode === "join-room" &&
                                  knockOffered ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void submitKnock()}
                                        disabled={loading || !input1.trim()}
                                        accessibilityState={{
                                            disabled: loading || !input1.trim(),
                                        }}
                                        className="px-4 py-2 rounded bg-discord-accent hover:bg-discord-accentHover active:bg-discord-accentHover transition-colors disabled:opacity-50 flex flex-row items-center gap-2"
                                    >
                                        {loading && (
                                            <Spin className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                                        )}
                                        <Text className="text-sm font-semibold text-white">
                                            {t("quickActions.requestToJoin")}
                                        </Text>
                                    </Pressable>
                                ) : mode !== "create-dm" ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void submit()}
                                        disabled={loading || !input1.trim()}
                                        accessibilityState={{
                                            disabled: loading || !input1.trim(),
                                        }}
                                        className="px-4 py-2 rounded bg-discord-accent hover:bg-discord-accentHover active:bg-discord-accentHover transition-colors disabled:opacity-50 flex flex-row items-center gap-2"
                                    >
                                        {loading && (
                                            <Spin className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                                        )}
                                        <Text className="text-sm font-semibold text-white">
                                            {mode === "create-room"
                                                ? t("quickActions.create")
                                                : mode === "create-space"
                                                  ? t("quickActions.create")
                                                  : t("common.join")}
                                        </Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        </ScrollView>
                    </ModalDialog>
                )}
            </Portal>
        </>
    );
}
