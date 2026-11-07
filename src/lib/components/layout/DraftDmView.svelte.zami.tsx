import { Spin, SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
    type TextInputInstance,
} from "react-native";
import {
    KeyboardAvoidingView,
    useKeyboardState,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "$lib/i18n";
import { Lock, Send, X } from "lucide-svelte";
import {
    createDirectMessage,
    fetchUserProfile,
    getRoom,
    hasExistingDirectMessage,
    retryRoomFollowUp,
} from "$lib/matrix/client";
import { sendEventContent } from "$lib/matrix/pluginHost";
import { isRoomEncrypted } from "$lib/matrix/crypto";
import {
    roomsState,
    setActiveRoom,
    closeDraftDm,
} from "$lib/stores/rooms.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import { pluginRegistry } from "$lib/stores/plugins.svelte";
import {
    applyContentTransforms,
    applyTextTransforms,
} from "$lib/plugins/outgoingTransforms";
import { buildDraftDmContent } from "$lib/utils/draftDmMessage";
import type { RoomFollowUp } from "$lib/utils/roomCreationOutcome";
import {
    shouldWarnPlaintextDmReuse,
    PLAINTEXT_DM_REUSE_WARNING,
} from "$lib/utils/roomEncryption";
import { matrixErrorMessage } from "$lib/utils/knock";
import Avatar from "$lib/components/ui/Avatar.svelte";

interface Props {
    userId: string;
    encrypt: boolean;
    isMobile?: boolean;
    onMenuOpen?: () => void;
}

export default function DraftDmView({
    userId,
    encrypt,
    isMobile = false,
    onMenuOpen,
}: Props) {
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const [profile, setProfile] = useState<{
        displayName: string | null;
        avatarUrl: string | null;
    }>({ displayName: null, avatarUrl: null });
    const textareaEl = useRef<TextInputInstance>(null);
    const spellCheckEnabled = useRune(() => settingsState.spellCheckEnabled);

    const name = profile.displayName || userId;

    // The pane is not remounted when the draft is retargeted to someone else,
    // so the profile, the typed text and any error all belong to one userId.
    useEffect(() => {
        const target = userId;
        setProfile({ displayName: null, avatarUrl: null });
        setText("");
        setError("");
        let stale = false;
        void fetchUserProfile(target).then((p) => {
            if (!stale) setProfile(p);
        });
        textareaEl.current?.focus();
        return () => {
            stale = true;
        };
    }, [userId]);

    // A DM with this person can appear while the draft is open: they messaged
    // first, or another session of this account opened one. Move onto it
    // rather than leave a draft that would create a second room.
    const roomsTick = useRune(() => roomsState.roomsTick);
    // Zami: upstream's `untrack`: `sending` is read, not depended on.
    const checkExisting = useEffectEvent((target: string) => {
        if (!sending && hasExistingDirectMessage(target))
            void openExisting(target);
    });
    useEffect(() => {
        void roomsTick;
        checkExisting(userId);
    }, [roomsTick, userId]);

    async function openExisting(target: string) {
        try {
            const { roomId } = await createDirectMessage(target, encrypt);
            if (roomsState.draftDm?.userId === target) setActiveRoom(roomId);
        } catch {
            /* the draft stays usable; sending retries the same lookup */
        }
    }

    // Same recovery the other DM entry points offer: the room is real, so only
    // the failed m.direct write is retried (TX-01).
    function surfaceFollowUp(followUp: RoomFollowUp) {
        if (followUp.status === "none" || followUp.status === "ok") return;
        const task = followUp.task;
        showErrorToast(followUp.message, {
            label: t("common.retry"),
            run: () => void retryRoomFollowUp(task).then(surfaceFollowUp),
        });
    }

    async function send() {
        if (sending) return;
        const target = userId;
        const typed = text;
        if (!buildDraftDmContent(typed, target)) return;
        setSending(true);
        setError("");
        try {
            // The room, and the invite, only come into being here.
            const { roomId, followUp } = await createDirectMessage(
                target,
                encrypt,
            );
            surfaceFollowUp(followUp);
            if (
                shouldWarnPlaintextDmReuse({
                    followUpStatus: followUp.status,
                    wantEncrypted: encrypt,
                    roomEncrypted: isRoomEncrypted(getRoom(roomId)),
                })
            ) {
                showErrorToast(PLAINTEXT_DM_REUSE_WARNING);
            }
            // Plugin transforms need the room id, so they run once it exists.
            const outgoing = applyTextTransforms(
                typed,
                pluginRegistry.outgoingTextTransforms.map((e) => e.value),
                { roomId },
            );
            const base = buildDraftDmContent(outgoing, target);
            // Navigate first: the SDK's local echo lands in the timeline the
            // user is about to see, with its own retry affordance on failure.
            // Someone who moved on mid-create still gets their message sent;
            // they just are not pulled back to it.
            if (roomsState.draftDm?.userId === target) setActiveRoom(roomId);
            if (base) {
                const content = applyContentTransforms(
                    base,
                    pluginRegistry.outgoingContentTransforms.map(
                        (e) => e.value,
                    ),
                    { roomId },
                );
                sendEventContent(roomId, content).catch((err) =>
                    console.warn("[draftDm] first message failed", err),
                );
            }
        } catch (e) {
            // Nothing was created, so the text stays for another try.
            setError(matrixErrorMessage(e, t("draftDm.couldNotStart")));
        } finally {
            setSending(false);
        }
    }

    // Zami: `onKeydown`. Mobile keyboards have no Shift: Enter is a newline
    // there and the send button sends, matching the room composer. Elsewhere
    // Enter sends (`submitBehavior="submit"`). Not ported: Shift+Enter for a
    // newline there; a TextInput reports no modifiers.

    // Zami: the view reaches the home indicator, as the room area does
    // (AppShell leaves it to the composer), so the composer pads for it while
    // the keyboard, which covers it, is down.
    const insets = useSafeAreaInsets();
    const keyboardShown = useKeyboardState((state) => state.isVisible);

    return (
        // Zami: the view shrinks above the keyboard, its composer with it, as
        // the room area's does (MessageArea).
        <KeyboardAvoidingView
            behavior="padding"
            automaticOffset
            style={{ flex: 1, minWidth: 0 }}
        >
            <View className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <View className="h-12 px-4 flex-row items-center gap-3 border-b border-discord-divider shadow-sm flex-shrink-0">
                    {isMobile ? (
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
                    ) : null}
                    <Avatar
                        src={profile.avatarUrl}
                        name={name}
                        id={userId}
                        size={24}
                    />
                    <Text
                        accessibilityRole="header"
                        numberOfLines={1}
                        className="flex-shrink font-semibold text-discord-textPrimary"
                    >
                        {name}
                    </Text>
                    {encrypt ? (
                        <View
                            accessible
                            accessibilityLabel={t("draftDm.encrypted")}
                            className="flex-shrink-0"
                        >
                            <Lock
                                size={16}
                                className="text-discord-textMuted"
                            />
                        </View>
                    ) : null}
                    <Pressable
                        accessibilityRole="button"
                        onPress={closeDraftDm}
                        className="ms-auto p-1.5 rounded hover:bg-discord-messageHover transition-colors flex-shrink-0"
                        accessibilityLabel={t("draftDm.discard")}
                    >
                        <X size={18} className="text-discord-textMuted" />
                    </Pressable>
                </View>

                <ScrollView
                    className="flex-1"
                    contentContainerClassName="flex-grow flex-col justify-end px-4 pb-4"
                    keyboardShouldPersistTaps="handled"
                >
                    <View className="max-w-xl">
                        <Avatar
                            src={profile.avatarUrl}
                            name={name}
                            id={userId}
                            size={80}
                        />
                        <Text className="mt-3 text-2xl font-bold text-discord-textPrimary">
                            {name}
                        </Text>
                        {profile.displayName ? (
                            <Text className="text-discord-textMuted text-sm">
                                {userId}
                            </Text>
                        ) : null}
                        <Text className="mt-3 text-discord-textSecondary">
                            {t("draftDm.intro", { name })}
                        </Text>
                        <Text className="mt-1 text-sm text-discord-textMuted">
                            {t("draftDm.lazyNote", { name })}
                        </Text>
                    </View>
                </ScrollView>

                <View
                    className="px-4 pb-4 flex-shrink-0"
                    style={{
                        paddingBottom: 16 + (keyboardShown ? 0 : insets.bottom),
                    }}
                >
                    {error ? (
                        <Text
                            accessibilityRole="alert"
                            className="mb-2 text-sm text-discord-danger"
                        >
                            {error}
                        </Text>
                    ) : null}
                    <View className="flex-row items-end gap-2 bg-discord-backgroundSecondary rounded-lg px-2.5 py-2.5">
                        {/* Zami: a multiline TextInput grows with its content, as
                        `field-sizing: content` does; `dir="auto"` is the
                        native default. */}
                        <TextInput
                            ref={textareaEl}
                            value={text}
                            onChangeText={setText}
                            multiline
                            submitBehavior={isMobile ? "newline" : "submit"}
                            onSubmitEditing={
                                isMobile ? undefined : () => void send()
                            }
                            autoCapitalize="sentences"
                            spellCheck={spellCheckEnabled}
                            autoCorrect={spellCheckEnabled}
                            editable={!sending}
                            placeholder={t("draftDm.placeholder", { name })}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            accessibilityLabel={t("draftDm.placeholder", {
                                name,
                            })}
                            className={`flex-1 min-w-0 bg-transparent text-discord-textPrimary text-[16px] leading-relaxed py-[3px] max-h-48 ${
                                sending ? "opacity-60" : ""
                            }`}
                        />
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void send()}
                            disabled={sending || !text.trim()}
                            accessibilityState={{
                                disabled: sending || !text.trim(),
                            }}
                            className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                                sending || !text.trim() ? "opacity-40" : ""
                            }`}
                            accessibilityLabel={
                                sending
                                    ? t("draftDm.starting")
                                    : t("draftDm.send")
                            }
                        >
                            {sending ? (
                                <Spin
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                    className="w-5 h-5 border-2 border-discord-textMuted border-t-transparent rounded-full"
                                />
                            ) : (
                                <Send
                                    size={20}
                                    className="text-discord-textMuted"
                                />
                            )}
                        </Pressable>
                    </View>
                </View>
            </View>
        </KeyboardAvoidingView>
    );
}
