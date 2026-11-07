import { useState } from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import RNSvg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";
import { Portal } from "@-/com.leonsilicon.zami.rn";
import { Check } from "lucide-svelte";
import { t } from "$lib/i18n";
import {
    pollDialogState,
    closeCreatePollDialog,
} from "$lib/stores/pollDialog.svelte";
import { sendPollStart } from "$lib/matrix/client";
import {
    validatePollDraft,
    draftToPollData,
    type PollDraft,
} from "$lib/utils/pollContent";
import { showErrorToast } from "$lib/stores/toasts.svelte";

// Upstream's inline SVG icons: `w-*`/`h-*` size them, `colorClassName` is their
// `currentColor`.
const Svg = withUniwind(RNSvg);

const MAX_OPTIONS = 20;

// Zami: `use:focusTrap` (Tab cycling, Escape to close) has no React Native
// equivalent; the backdrop closes the dialog, as it does upstream.
export default function CreatePollDialog() {
    const [question, setQuestion] = useState("");
    const [answers, setAnswers] = useState<string[]>(["", ""]);
    const [kind, setKind] = useState<"disclosed" | "undisclosed">("disclosed");
    const [allowMultiple, setAllowMultiple] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const draft: PollDraft = {
        question,
        answers,
        kind,
        // multi-select = up to the number of non-empty answers
        maxSelections: allowMultiple
            ? Math.max(2, answers.filter((a) => a.trim()).length)
            : 1,
    };
    const validation = validatePollDraft(draft);
    const errorReason = validation.ok ? "" : validation.reason;

    function addAnswer() {
        if (answers.length < MAX_OPTIONS) setAnswers([...answers, ""]);
    }
    function removeAnswer(i: number) {
        if (answers.length > 2) setAnswers(answers.filter((_, j) => j !== i));
    }
    function setAnswer(i: number, value: string) {
        setAnswers((current) => current.map((a, j) => (j === i ? value : a)));
    }
    async function create() {
        if (submitting || validation.ok !== true) return;
        const roomId = pollDialogState.roomId;
        if (!roomId) return;
        setSubmitting(true);
        try {
            await sendPollStart(roomId, draftToPollData(draft));
            closeCreatePollDialog();
        } catch (err) {
            showErrorToast(
                err instanceof Error
                    ? err.message
                    : t("createPollDialog.failedToCreatePoll"),
            );
            setSubmitting(false);
        }
    }

    return (
        <Portal>
            <View className="absolute inset-0 z-50">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.closeDialog")}
                    className="absolute inset-0 bg-black/60"
                    onPress={closeCreatePollDialog}
                />
                {/* Zami: the dialog stays above the keyboard. Centred in a column,
                    it shrinks (and scrolls) to fit the space left. */}
                <KeyboardAvoidingView
                    behavior="padding"
                    pointerEvents="box-none"
                    style={StyleSheet.absoluteFill}
                >
                    <View
                        pointerEvents="box-none"
                        className="flex-1 items-center justify-center p-4"
                    >
                        <View
                            accessibilityViewIsModal
                            className="relative z-10 bg-discord-backgroundSecondary rounded-lg shadow-xl w-full max-w-md max-h-[85vh] flex-shrink overflow-hidden"
                        >
                            <ScrollView
                                keyboardShouldPersistTaps="handled"
                                style={styles.content}
                                contentContainerClassName="flex-col gap-4 p-6"
                            >
                                <Text
                                    accessibilityRole="header"
                                    className="text-lg font-bold text-discord-textPrimary"
                                >
                                    {t("createPollDialog.createPoll")}
                                </Text>

                                {/* Question */}
                                <View className="flex-col gap-1.5">
                                    <Text className="text-xs font-semibold uppercase tracking-wide text-discord-textMuted">
                                        {t("createPollDialog.question")}
                                    </Text>
                                    <TextInput
                                        accessibilityLabel={t(
                                            "createPollDialog.question",
                                        )}
                                        value={question}
                                        onChangeText={setQuestion}
                                        placeholder={t(
                                            "createPollDialog.askSomething",
                                        )}
                                        maxLength={340}
                                        className="w-full rounded bg-discord-backgroundTertiary px-3 py-2 text-sm text-discord-textPrimary placeholder:text-discord-textMuted focus:outline-none focus:ring-2 focus:ring-discord-accent"
                                        placeholderTextColorClassName="accent-discord-textMuted"
                                    />
                                </View>

                                {/* Options */}
                                <View className="flex-col gap-1.5">
                                    <Text className="text-xs font-semibold uppercase tracking-wide text-discord-textMuted">
                                        {t("createPollDialog.options")}
                                    </Text>
                                    <View className="flex-col gap-2">
                                        {answers.map((answer, i) => (
                                            <View
                                                key={i}
                                                className="flex-row items-center gap-2"
                                            >
                                                <TextInput
                                                    value={answer}
                                                    onChangeText={(value) =>
                                                        setAnswer(i, value)
                                                    }
                                                    placeholder={t(
                                                        "createPollDialog.option",
                                                        { value: i + 1 },
                                                    )}
                                                    accessibilityLabel={t(
                                                        "createPollDialog.option",
                                                        { value: i + 1 },
                                                    )}
                                                    maxLength={340}
                                                    className="flex-1 rounded bg-discord-backgroundTertiary px-3 py-2 text-sm text-discord-textPrimary placeholder:text-discord-textMuted focus:outline-none focus:ring-2 focus:ring-discord-accent"
                                                    placeholderTextColorClassName="accent-discord-textMuted"
                                                />
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        removeAnswer(i)
                                                    }
                                                    disabled={
                                                        answers.length <= 2
                                                    }
                                                    accessibilityLabel={t(
                                                        "createPollDialog.removeOption",
                                                    )}
                                                    className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded hover:bg-discord-messageHover transition-colors disabled:opacity-30"
                                                >
                                                    <Svg
                                                        className="w-4 h-4"
                                                        colorClassName="accent-discord-textMuted"
                                                        fill="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <Path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.29 19.7 2.87 18.3 9.17 12 2.87 5.71 4.29 4.29l6.3 6.3 6.29-6.3z" />
                                                    </Svg>
                                                </Pressable>
                                            </View>
                                        ))}
                                    </View>
                                    {answers.length < MAX_OPTIONS && (
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={addAnswer}
                                            className="self-start mt-1"
                                        >
                                            <Text className="text-sm font-medium text-discord-accent hover:text-discord-accentHover hover:underline transition-colors">
                                                {t(
                                                    "createPollDialog.addOption",
                                                )}
                                            </Text>
                                        </Pressable>
                                    )}
                                </View>

                                {/* Result visibility */}
                                <View className="flex-col gap-1.5">
                                    <Text className="text-xs font-semibold uppercase tracking-wide text-discord-textMuted">
                                        {t("createPollDialog.results")}
                                    </Text>
                                    <View className="flex-row gap-1 rounded bg-discord-backgroundTertiary p-1">
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                selected: kind === "disclosed",
                                            }}
                                            onPress={() => setKind("disclosed")}
                                            className={`flex-1 rounded px-3 py-1.5 transition-colors ${
                                                kind === "disclosed"
                                                    ? "bg-discord-accent"
                                                    : ""
                                            }`}
                                        >
                                            <Text
                                                className={`text-sm text-center ${
                                                    kind === "disclosed"
                                                        ? "text-white"
                                                        : "text-discord-textSecondary hover:text-discord-textPrimary"
                                                }`}
                                            >
                                                {t(
                                                    "createPollDialog.showAsPeopleVote",
                                                )}
                                            </Text>
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                selected:
                                                    kind === "undisclosed",
                                            }}
                                            onPress={() =>
                                                setKind("undisclosed")
                                            }
                                            className={`flex-1 rounded px-3 py-1.5 transition-colors ${
                                                kind === "undisclosed"
                                                    ? "bg-discord-accent"
                                                    : ""
                                            }`}
                                        >
                                            <Text
                                                className={`text-sm text-center ${
                                                    kind === "undisclosed"
                                                        ? "text-white"
                                                        : "text-discord-textSecondary hover:text-discord-textPrimary"
                                                }`}
                                            >
                                                {t(
                                                    "createPollDialog.hideUntilClosed",
                                                )}
                                            </Text>
                                        </Pressable>
                                    </View>
                                </View>

                                {/* Multi-select */}
                                <Pressable
                                    accessibilityRole="checkbox"
                                    accessibilityState={{
                                        checked: allowMultiple,
                                    }}
                                    onPress={() =>
                                        setAllowMultiple(!allowMultiple)
                                    }
                                    className="flex-row items-center gap-2.5 cursor-pointer select-none"
                                >
                                    {/* Zami: the checkbox, drawn. */}
                                    <View
                                        className={`h-4 w-4 rounded border items-center justify-center ${
                                            allowMultiple
                                                ? "bg-discord-accent border-discord-accent"
                                                : "border-discord-textMuted"
                                        }`}
                                    >
                                        {allowMultiple && (
                                            <Check
                                                size={12}
                                                strokeWidth={3}
                                                className="text-white"
                                            />
                                        )}
                                    </View>
                                    <Text className="flex-shrink text-sm text-discord-textPrimary">
                                        {t(
                                            "createPollDialog.allowSelectingMultipleOptions",
                                        )}
                                    </Text>
                                </Pressable>

                                {/* Footer */}
                                <View className="flex-row items-center justify-end gap-3 pt-1">
                                    {errorReason ? (
                                        <Text className="me-auto flex-shrink text-xs text-discord-textMuted">
                                            {errorReason}
                                        </Text>
                                    ) : null}
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={closeCreatePollDialog}
                                        className="px-4 py-2 rounded"
                                    >
                                        <Text className="text-sm font-medium text-discord-textSecondary hover:text-discord-textPrimary hover:underline transition-colors">
                                            {t("common.cancel")}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void create()}
                                        disabled={
                                            submitting || validation.ok !== true
                                        }
                                        className="px-4 py-2 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-50"
                                    >
                                        <Text className="text-white text-sm font-semibold">
                                            {submitting
                                                ? t("createPollDialog.creating")
                                                : t(
                                                      "createPollDialog.createPoll",
                                                  )}
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

const styles = StyleSheet.create({
    // Only as tall as its content, so the dialog sizes to it.
    content: { flexGrow: 0 },
});
