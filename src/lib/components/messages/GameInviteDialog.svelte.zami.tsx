import { Portal, Select } from "@-/com.leonsilicon.zami.rn";
import { useDeepRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useEffectEvent, useState } from "react";
import {
    BackHandler,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { t } from "$lib/i18n";
import {
    gameInviteDialogState,
    closeGameInviteDialog,
} from "$lib/stores/gameInviteDialog.svelte";
import { invitableGames } from "$lib/stores/richPresence.svelte";
import { sendGameInvite } from "$lib/matrix/gameInvite";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import { GAME_INVITE_LIMITS } from "$lib/utils/gameInvite";

export default function GameInviteDialog() {
    const [pickedKey, setPickedKey] = useState<string | null>(null);
    const [note, setNote] = useState("");
    const [sending, setSending] = useState(false);

    const games = useDeepRune(() => invitableGames());
    // The picked game if it is still running, else the first one.
    const selected = games.find((g) => g.key === pickedKey) ?? games[0] ?? null;

    async function send() {
        const roomId = gameInviteDialogState.roomId;
        const game = selected;
        if (!roomId || !game || sending) return;
        setSending(true);
        try {
            await sendGameInvite(roomId, game, note.trim() || undefined);
            closeGameInviteDialog();
        } catch (err) {
            showErrorToast(
                err instanceof Error && err.message
                    ? err.message
                    : t("gameInvite.failedToSend"),
            );
            setSending(false);
        }
    }

    // Zami: `use:focusTrap`'s Escape, as Android's back button.
    const onEscape = useEffectEvent(() => closeGameInviteDialog());
    useEffect(() => {
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                onEscape();
                return true;
            },
        );
        return () => subscription.remove();
    }, []);

    // Zami: `max-h-[85vh]`.
    const windowSize = useWindowDimensions();

    // Zami: `position: fixed` → rendered at the app root through the Portal.
    return (
        <Portal>
            <View pointerEvents="box-none" className="absolute inset-0 z-50">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.closeDialog")}
                    className="absolute inset-0 bg-black/60"
                    onPress={closeGameInviteDialog}
                />
                {/* Zami: the keyboard view keeps the dialog above the on-screen
                    keyboard, as ModalDialog does. */}
                <KeyboardAvoidingView
                    behavior="padding"
                    pointerEvents="box-none"
                    style={StyleSheet.absoluteFill}
                >
                    <View
                        pointerEvents="box-none"
                        className="flex-1 flex-row items-center justify-center p-4"
                    >
                        <View
                            role="dialog"
                            accessibilityViewIsModal
                            aria-labelledby="game-invite-title"
                            onAccessibilityEscape={closeGameInviteDialog}
                            className="relative z-10 shrink bg-discord-backgroundSecondary rounded-lg shadow-xl w-full max-w-md overflow-hidden"
                            style={{ maxHeight: windowSize.height * 0.85 }}
                        >
                            <ScrollView
                                className="grow-0"
                                keyboardShouldPersistTaps="handled"
                                contentContainerClassName="flex-col gap-4 p-6"
                            >
                                <Text
                                    nativeID="game-invite-title"
                                    role="heading"
                                    className="text-lg font-bold text-discord-textPrimary"
                                >
                                    {t("gameInvite.title")}
                                </Text>

                                {games.length === 0 ? (
                                    <Text className="text-sm text-discord-textMuted">
                                        {t("gameInvite.noGames")}
                                    </Text>
                                ) : (
                                    <View className="flex-col gap-1.5">
                                        <Text className="text-xs font-semibold uppercase tracking-wide text-discord-textMuted">
                                            {t("gameInvite.game")}
                                        </Text>
                                        {games.length > 1 ? (
                                            <Select
                                                nativeID="game-invite-game"
                                                accessibilityLabel={t(
                                                    "gameInvite.game",
                                                )}
                                                value={selected?.key ?? ""}
                                                onChange={setPickedKey}
                                                options={games.map((g) => ({
                                                    value: g.key,
                                                    label: g.name,
                                                    key: g.key,
                                                }))}
                                                className="w-full rounded bg-discord-backgroundTertiary px-3 py-2 text-sm text-discord-textPrimary focus:outline-none focus:ring-2 focus:ring-discord-accent"
                                            />
                                        ) : selected ? (
                                            <Text className="text-sm text-discord-textPrimary">
                                                {selected.name}
                                            </Text>
                                        ) : null}
                                    </View>
                                )}

                                <View className="flex-col gap-1.5">
                                    <Text className="text-xs font-semibold uppercase tracking-wide text-discord-textMuted">
                                        {t("gameInvite.note")}
                                    </Text>
                                    {/* Zami: `rows="2"` → a two-line minimum
                                        height (text-sm's 20px lines plus
                                        py-2). */}
                                    <TextInput
                                        nativeID="game-invite-note"
                                        value={note}
                                        onChangeText={setNote}
                                        multiline
                                        maxLength={GAME_INVITE_LIMITS.note}
                                        placeholder={t(
                                            "gameInvite.notePlaceholder",
                                        )}
                                        accessibilityLabel={t(
                                            "gameInvite.note",
                                        )}
                                        textAlignVertical="top"
                                        className="w-full min-h-14 rounded bg-discord-backgroundTertiary px-3 py-2 text-sm text-discord-textPrimary placeholder:text-discord-textMuted focus:outline-none focus:ring-2 focus:ring-discord-accent"
                                    />
                                </View>

                                <View className="flex-row justify-end gap-2">
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={closeGameInviteDialog}
                                        className="px-4 py-2 rounded"
                                    >
                                        <Text className="text-sm text-discord-textMuted hover:text-discord-textPrimary transition-colors">
                                            {t("common.cancel")}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void send()}
                                        disabled={!selected || sending}
                                        accessibilityState={{
                                            disabled: !selected || sending,
                                        }}
                                        className={`px-4 py-2 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors ${
                                            !selected || sending
                                                ? "opacity-50"
                                                : ""
                                        }`}
                                    >
                                        <Text className="text-white text-sm font-semibold">
                                            {sending
                                                ? t("common.saving")
                                                : t("gameInvite.send")}
                                        </Text>
                                    </Pressable>
                                </View>
                            </ScrollView>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </View>
        </Portal>
    );
}
