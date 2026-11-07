import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { t } from "$lib/i18n";
// Name or rename a thread (ThreadPanel header). The caller owns the modal
// slot; saving sends a naming event, so the dialog stays open until the
// server accepts it and shows the error if it doesn't.
import {
    MAX_THREAD_NAME_LENGTH,
    normalizeThreadName,
} from "$lib/utils/threadName";
import { matrixErrorMessage } from "$lib/utils/knock";

interface Props {
    /** The current name, or null for an unnamed thread. */
    name: string | null;
    onSave: (name: string) => Promise<void>;
    onClose: () => void;
}

export default function RenameThreadDialog({ name, onSave, onClose }: Props) {
    // Seeded once: the dialog is modal, so the thread can't change under it.
    const [value, setValue] = useState(() => name ?? "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const cleaned = normalizeThreadName(value);

    // Zami: focusing and selecting the input on mount is its `autoFocus` and
    // `selectTextOnFocus`.

    async function save(next: string) {
        if (saving) return;
        if (next === (name ?? "")) {
            onClose();
            return;
        }
        setSaving(true);
        setError("");
        try {
            await onSave(next);
            onClose();
        } catch (err) {
            setError(
                matrixErrorMessage(
                    err,
                    t("renameThreadDialog.couldNotSaveTheName"),
                ),
            );
        } finally {
            setSaving(false);
        }
    }

    // Zami: `fixed` → a Portal at the app root, which lifts the dialog above
    // the keyboard. Not ported: focusTrap's Tab cycling and Escape to close
    // (there's no hardware keyboard to speak of on a phone).
    return (
        <Portal>
            <View className="absolute inset-0 z-50">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.closeDialog")}
                    className="absolute inset-0 bg-black/60"
                    onPress={onClose}
                />
                <KeyboardAvoidingView
                    behavior="padding"
                    pointerEvents="box-none"
                    style={{ flex: 1 }}
                >
                    <View
                        pointerEvents="box-none"
                        className="flex-1 flex-row items-center justify-center p-4"
                    >
                        <View
                            accessibilityViewIsModal
                            className="relative z-10 bg-discord-backgroundSecondary rounded-lg shadow-xl w-full max-w-md"
                        >
                            <View className="flex flex-col gap-4 p-6">
                                <Text
                                    accessibilityRole="header"
                                    className="text-lg font-bold text-discord-textPrimary"
                                >
                                    {name
                                        ? t("renameThreadDialog.renameThread")
                                        : t("renameThreadDialog.nameThread")}
                                </Text>
                                <View className="flex flex-col gap-1.5">
                                    <Text className="text-xs font-bold uppercase text-discord-textSecondary">
                                        {t("renameThreadDialog.threadName")}
                                    </Text>
                                    <TextInput
                                        value={value}
                                        onChangeText={setValue}
                                        autoFocus
                                        selectTextOnFocus
                                        maxLength={MAX_THREAD_NAME_LENGTH}
                                        autoComplete="off"
                                        returnKeyType="done"
                                        accessibilityLabel={t(
                                            "renameThreadDialog.threadName",
                                        )}
                                        onSubmitEditing={() =>
                                            void save(cleaned)
                                        }
                                        className="rounded bg-discord-backgroundTertiary px-3 py-2 text-sm text-discord-textPrimary outline-none focus:ring-2 focus:ring-discord-accent"
                                    />
                                </View>
                                <Text className="text-xs text-discord-textMuted">
                                    {t(
                                        "renameThreadDialog.everyoneInTheRoomSeesIt",
                                    )}
                                </Text>
                                {!!error && (
                                    <Text
                                        className="text-sm text-discord-danger"
                                        accessibilityRole="alert"
                                    >
                                        {error}
                                    </Text>
                                )}
                                <View className="flex-row items-center gap-2">
                                    {!!name && (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                disabled: saving,
                                            }}
                                            disabled={saving}
                                            onPress={() => void save("")}
                                            className="rounded px-3 py-2 disabled:opacity-50"
                                        >
                                            <Text className="text-sm font-medium text-discord-danger">
                                                {t(
                                                    "renameThreadDialog.removeName",
                                                )}
                                            </Text>
                                        </Pressable>
                                    )}
                                    <View className="flex-1" />
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={onClose}
                                        className="rounded px-4 py-2"
                                    >
                                        <Text className="text-sm font-medium text-discord-textPrimary">
                                            {t("common.cancel")}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityState={{
                                            disabled: !cleaned || saving,
                                        }}
                                        disabled={!cleaned || saving}
                                        onPress={() => void save(cleaned)}
                                        className="rounded bg-discord-accent px-4 py-2 hover:bg-discord-accentHover disabled:opacity-50"
                                    >
                                        <Text className="text-sm font-medium text-white">
                                            {saving
                                                ? t("common.saving")
                                                : t("common.save")}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </View>
        </Portal>
    );
}
