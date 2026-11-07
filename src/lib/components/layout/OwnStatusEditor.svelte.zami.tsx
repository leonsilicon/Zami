import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import { Smile } from "lucide-svelte";
import EmojiPicker from "$lib/components/ui/EmojiPicker.svelte";
import { fetchOwnExtendedProfile } from "$lib/matrix/client";
import { saveOwnStatus } from "$lib/matrix/ownStatus";
import { interfaceState } from "$lib/stores/interface.svelte";
import {
    MAX_STATUS_TEXT_LENGTH,
    PROFILE_FIELDS,
    buildStatus,
    parseStatus,
    readField,
    statusProblem,
} from "$lib/utils/extendedProfile";

interface Props {
    /** Called after a successful save or clear. */
    onDone?: () => void;
}

export default function OwnStatusEditor({ onDone }: Props) {
    const isTouchscreen = useRune(() => interfaceState.isTouchscreen);

    // Quick status editing, for the account switcher. The full set of profile
    // fields stays in Settings → Account.
    const [emoji, setEmoji] = useState("");
    const [text, setText] = useState("");
    const [savedEmoji, setSavedEmoji] = useState("");
    const [savedText, setSavedText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [pickerOpen, setPickerOpen] = useState(false);

    const dirty = emoji.trim() !== savedEmoji || text.trim() !== savedText;
    const problem = statusProblem(text, emoji);
    const hasStatus = savedEmoji !== "" || savedText !== "";

    useEffect(() => {
        fetchOwnExtendedProfile()
            .then((profile) => {
                const status = parseStatus(
                    readField(profile, PROFILE_FIELDS.status),
                );
                setSavedEmoji(status?.emoji ?? "");
                setEmoji(status?.emoji ?? "");
                setSavedText(status?.text ?? "");
                setText(status?.text ?? "");
            })
            .catch(() => {});
    }, []);

    async function save(clear = false) {
        if (busy || (!clear && (!dirty || problem))) return;
        setBusy(true);
        setError("");
        try {
            const status = clear ? null : buildStatus(text, emoji);
            await saveOwnStatus(status);
            setSavedEmoji(status?.emoji ?? "");
            setEmoji(status?.emoji ?? "");
            setSavedText(status?.text ?? "");
            setText(status?.text ?? "");
            onDone?.();
        } catch (e) {
            setError(
                (e as Error)?.message ??
                    t("ownStatusEditor.couldNotSaveStatus"),
            );
        } finally {
            setBusy(false);
        }
    }

    // Beside the popover on desktop (it is the positioned ancestor); a
    // bottom sheet over it on touch.
    // Zami: on touch, `position: fixed` → rendered at the app root through the
    // Portal.
    const picker = pickerOpen && (
        <View
            className={
                isTouchscreen
                    ? "absolute start-0 end-0 bottom-0 z-[60]"
                    : "absolute left-full bottom-0 ml-2 z-[60]"
            }
        >
            <EmojiPicker
                unicodeOnly
                onSelect={(picked) => setEmoji(picked)}
                onClose={() => setPickerOpen(false)}
            />
        </View>
    );

    return (
        <View className="gap-2">
            <View className="flex-row gap-1.5">
                <Pressable
                    accessibilityRole="button"
                    onPress={() => setPickerOpen(!pickerOpen)}
                    accessibilityLabel={t("ownStatusEditor.pickAStatusEmoji")}
                    accessibilityState={{ expanded: pickerOpen }}
                    className="w-9 flex-shrink-0 flex-row items-center justify-center rounded bg-discord-backgroundTertiary"
                >
                    {emoji ? (
                        // Zami: renderPlainTextWithTwemoji → plain text; iOS
                        // draws emoji itself.
                        <Text className="text-base">{emoji}</Text>
                    ) : (
                        <Smile
                            size={16}
                            className="text-discord-textMuted hover:text-discord-textPrimary"
                        />
                    )}
                </Pressable>
                <TextInput
                    value={text}
                    onChangeText={setText}
                    maxLength={MAX_STATUS_TEXT_LENGTH}
                    placeholder={t("ownStatusEditor.whatSHappening")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityLabel={t("ownStatusEditor.statusText")}
                    // Zami: Enter → the return key.
                    onSubmitEditing={() => void save()}
                    submitBehavior="submit"
                    returnKeyType="done"
                    className="flex-1 min-w-0 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-2.5 py-1.5"
                />
            </View>
            <View className="flex-row gap-1.5">
                <Pressable
                    accessibilityRole="button"
                    onPress={() => void save()}
                    disabled={busy || !dirty || !!problem}
                    accessibilityState={{
                        disabled: busy || !dirty || !!problem,
                    }}
                    className={`px-3 py-1 bg-discord-accent rounded ${
                        busy || !dirty || !!problem ? "opacity-50" : ""
                    }`}
                >
                    <Text className="text-white text-xs font-medium">
                        {busy ? t("common.saving") : t("common.save")}
                    </Text>
                </Pressable>
                {hasStatus && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void save(true)}
                        disabled={busy}
                        accessibilityState={{ disabled: busy }}
                        className={`px-3 py-1 bg-discord-backgroundTertiary rounded ${
                            busy ? "opacity-50" : ""
                        }`}
                    >
                        <Text className="text-discord-textPrimary text-xs font-medium">
                            {t("ownStatusEditor.clearStatus")}
                        </Text>
                    </Pressable>
                )}
            </View>
            {problem && dirty ? (
                <Text className="text-xs text-discord-textMuted">
                    {problem}
                </Text>
            ) : null}
            {error ? (
                <Text className="text-xs text-discord-danger">{error}</Text>
            ) : null}

            {picker && isTouchscreen ? <Portal>{picker}</Portal> : picker}
        </View>
    );
}
