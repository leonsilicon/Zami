import { Image, Portal, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
    BackHandler,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
    type TextInputInstance,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { t } from "$lib/i18n";
// Edit a queued attachment before it is sent (Discord-style: tap the
// attachment in the composer drawer). The caller owns the modal slot.
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";

interface Props {
    name: string;
    previewUrl: string | null;
    video: boolean;
    direct: boolean;
    onSave: (name: string) => void;
    /** Omitted where a file can't be sent directly, hiding the toggle. */
    onDirectChange?: (direct: boolean) => void;
    onClose: () => void;
}

export default function RenameAttachmentDialog({
    name,
    previewUrl,
    video,
    direct,
    onSave,
    onDirectChange,
    onClose,
}: Props) {
    // Seeded once from the file the dialog opened with: the dialog is modal,
    // so no other attachment can be picked while it is open.
    const [value, setValue] = useState(name);
    const [sendDirectly, setSendDirectly] = useState(direct);
    const inputEl = useRef<TextInputInstance>(null);
    // No path separators or control characters in a filename.
    const cleaned = value.replace(/[\\/\p{Cc}]/gu, "_").trim();

    useEffect(() => {
        if (!inputEl.current) return;
        inputEl.current.focus();
        // Select the stem so typing replaces it but keeps the extension.
        const dot = name.lastIndexOf(".");
        inputEl.current.setSelection(0, dot > 0 ? dot : name.length);
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as onMount.
    }, []);

    function save() {
        if (!cleaned) return;
        if (cleaned !== name) onSave(cleaned);
        if (sendDirectly !== direct) onDirectChange?.(sendDirectly);
        onClose();
    }

    // The focus trap's Escape, as Android's back button.
    const onEscape = useEffectEvent(() => onClose());
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

    // Zami: <video controls preload="metadata"> → expo-video's player, which
    // loads the file but doesn't play it until asked.
    const player = useVideoPlayer(previewUrl && video ? previewUrl : null);
    // Zami: `max-h-[50vh] w-full object-contain`: the preview keeps the image's
    // aspect ratio (once it has loaded) up to half the screen's height.
    const windowSize = useWindowDimensions();
    const [aspect, setAspect] = useState(16 / 9);

    // Zami: `position: fixed` → rendered at the app root through the Portal.
    return (
        <Portal>
            <View pointerEvents="box-none" className="absolute inset-0 z-50">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.closeDialog")}
                    className="absolute inset-0 bg-black/60"
                    onPress={onClose}
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
                            aria-labelledby="rename-attachment-title"
                            onAccessibilityEscape={onClose}
                            className="relative z-10 shrink bg-discord-backgroundSecondary rounded-lg shadow-xl w-full max-w-xl max-h-full overflow-hidden"
                        >
                            <ScrollView
                                keyboardShouldPersistTaps="handled"
                                contentContainerClassName="flex-col gap-4 p-6"
                            >
                                {previewUrl && video ? (
                                    <View
                                        className="w-full rounded bg-black overflow-hidden"
                                        style={{
                                            maxHeight: windowSize.height * 0.5,
                                        }}
                                    >
                                        <VideoView
                                            player={player}
                                            nativeControls
                                            contentFit="contain"
                                            style={styles.video}
                                        />
                                    </View>
                                ) : previewUrl ? (
                                    <Image
                                        source={mediaSource(previewUrl)}
                                        contentFit="contain"
                                        onLoad={(e) => {
                                            const { width, height } = e.source;
                                            if (width > 0 && height > 0)
                                                setAspect(width / height);
                                        }}
                                        className="w-full rounded bg-discord-backgroundTertiary"
                                        style={{
                                            aspectRatio: aspect,
                                            maxHeight: windowSize.height * 0.5,
                                        }}
                                    />
                                ) : null}
                                <Text
                                    nativeID="rename-attachment-title"
                                    role="heading"
                                    className="text-lg font-bold text-discord-textPrimary"
                                >
                                    {t("renameAttachmentDialog.editAttachment")}
                                </Text>
                                <View className="flex-col gap-1.5">
                                    <Text className="text-xs font-bold uppercase text-discord-textSecondary">
                                        {t("renameAttachmentDialog.filename")}
                                    </Text>
                                    {/* Zami: the form's submit is the input's
                                        return key. */}
                                    <TextInput
                                        ref={inputEl}
                                        value={value}
                                        onChangeText={setValue}
                                        onSubmitEditing={save}
                                        accessibilityLabel={t(
                                            "renameAttachmentDialog.filename",
                                        )}
                                        spellCheck={false}
                                        autoComplete="off"
                                        autoCorrect={false}
                                        autoCapitalize="none"
                                        returnKeyType="done"
                                        className="rounded bg-discord-backgroundTertiary px-3 py-2 text-sm text-discord-textPrimary focus:ring-2 focus:ring-discord-accent"
                                    />
                                </View>
                                {onDirectChange && (
                                    <View className="flex-row items-center justify-between gap-3">
                                        <View className="flex-1 min-w-0">
                                            <Text className="text-sm text-discord-textPrimary">
                                                {t("messageInput.sendDirectly")}
                                            </Text>
                                            <Text className="text-xs text-discord-textMuted">
                                                {t(
                                                    "messageInput.directFileHint",
                                                )}
                                            </Text>
                                        </View>
                                        <ToggleSwitch
                                            checked={sendDirectly}
                                            onChange={(v) => setSendDirectly(v)}
                                            label={t(
                                                "messageInput.sendDirectly",
                                            )}
                                        />
                                    </View>
                                )}
                                <View className="flex-row justify-end gap-2">
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={onClose}
                                        className="rounded px-4 py-2"
                                    >
                                        <Text className="text-sm font-medium text-discord-textPrimary hover:underline">
                                            {t("common.cancel")}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={save}
                                        disabled={!cleaned}
                                        accessibilityState={{
                                            disabled: !cleaned,
                                        }}
                                        className={`rounded bg-discord-accent px-4 py-2 hover:bg-discord-accentHover ${
                                            !cleaned ? "opacity-50" : ""
                                        }`}
                                    >
                                        <Text className="text-sm font-medium text-white">
                                            {t("common.save")}
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
    video: { width: "100%", aspectRatio: 16 / 9 },
});
