import {
    resolveFontStack,
    subscribeAppFont,
} from "@-/com.leonsilicon.zami.fonts/app-font";
import { pickedFile, Range, Select } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import {
    settingsState,
    setActivePreset,
    saveCustomPreset,
    deleteCustomPreset,
    forkActivePreset,
    activeBase,
    getPresetColors,
    renameCustomPreset,
    setMessageFontSize,
    setMessageFont,
    uploadCustomFont,
    removeCustomFont,
} from "$lib/stores/settings.svelte";
import { applyThemeColors } from "$lib/utils/theme";
import {
    THEME_TOKENS,
    resolveEffectiveColors,
    paletteContrastWarnings,
    normalizeHex,
    type ThemeColors,
    type ThemeToken,
    type ThemeTokenKey,
} from "$lib/utils/themePalette";
import {
    MESSAGE_FONTS,
    messageFontFamily,
    type MessageFontKey,
    appTextScalePercent,
    MSG_FONT_SIZE_DEFAULT,
} from "$lib/utils/messageDisplay";
import { encodeThemePreset, decodeThemePreset } from "$lib/utils/themeShare";
import { orderedPresetNames, isBuiltinPreset } from "$lib/utils/themePreset";

// Zami: Text classes sit on each Text, and `title` tooltips are dropped (an icon-only
// button's becomes its accessibilityLabel). applyThemeColors only sets CSS variables
// on `document`, so on React Native it does nothing yet.
export default function ThemeColorEditor() {
    // Current edit state
    const [draft, setDraft] = useState<ThemeColors>(() => ({
        ...getPresetColors(settingsState.activePreset),
    }));
    const [saveNameInput, setSaveNameInput] = useState("");
    const [importText, setImportText] = useState("");
    const [importError, setImportError] = useState("");
    const [copied, setCopied] = useState(false);
    const [renamingName, setRenamingNameState] = useState<string | null>(null);
    // Zami: also kept in a ref, so a blur that follows Enter or Cancel sees the
    // rename already ended, as it does with Svelte's synchronous state.
    const renamingRef = useRef<string | null>(null);
    function setRenamingName(name: string | null) {
        renamingRef.current = name;
        setRenamingNameState(name);
    }
    const [renameValue, setRenameValue] = useState("");
    // Zami: no fontFileInput; the button opens the document picker.
    const [fontUploadError, setFontUploadError] = useState<string | null>(null);
    const [fontUploadBusy, setFontUploadBusy] = useState(false);
    const [deletePending, setDeletePending] = useState<string | null>(null);

    async function handleFontFile() {
        // Zami: <input type="file" accept=".woff2,.ttf,.otf"> → expo-document-picker.
        const file = await pickFont();
        if (!file) return;
        setFontUploadError(null);
        setFontUploadBusy(true);
        const res = await uploadCustomFont(file);
        setFontUploadBusy(false);
        if (!res.ok) setFontUploadError(res.reason);
    }

    async function handleRemoveFont() {
        setFontUploadBusy(true);
        setFontUploadError(null);
        await removeCustomFont();
        setFontUploadBusy(false);
    }

    const activePresetName = useRune(() => settingsState.activePreset);
    const activeIsBuiltin = isBuiltinPreset(activePresetName);
    const themePresets = useRune(() => settingsState.themePresets);
    const allPresetNames = useMemo(
        () => orderedPresetNames(themePresets),
        [themePresets],
    );
    const currentBase = useRune(() => activeBase());
    const messageFontSize = useRune(() => settingsState.messageFontSize);
    const messageFont = useRune(() => settingsState.messageFont);
    const customFontName = useRune(() => settingsState.customFontName);
    const previewFontFamily = usePreviewFontFamily(
        messageFontFamily(messageFont),
    );

    const effective = resolveEffectiveColors(currentBase, draft);
    const warnings = paletteContrastWarnings(effective);

    function setColor(key: ThemeTokenKey, value: string) {
        if (activeIsBuiltin) return; // Built-ins are read-only
        const next = { ...draft, [key]: value };
        setDraft(next);
        // Live-update the active custom preset
        saveCustomPreset(activePresetName, currentBase, next);
        applyThemeColors(next);
    }

    function resetColor(key: ThemeTokenKey) {
        if (activeIsBuiltin) return;
        const updated = { ...draft };
        delete updated[key];
        setDraft(updated);
        saveCustomPreset(activePresetName, currentBase, updated);
        applyThemeColors(updated);
    }

    function selectPreset(name: string) {
        setActivePreset(name);
        setDraft({ ...getPresetColors(name) });
    }

    function handleDelete(name: string) {
        setDeletePending(null);
        deleteCustomPreset(name);
    }

    function handleSave() {
        const name = saveNameInput.trim();
        if (!name) return;
        try {
            saveCustomPreset(name, currentBase, draft);
            setActivePreset(name);
            setSaveNameInput("");
        } catch (err) {
            setImportError(
                err instanceof Error
                    ? err.message
                    : t("themeColorEditor.cannotSavePreset"),
            );
            setTimeout(() => {
                setImportError("");
            }, 3000);
        }
    }

    async function handleCopy() {
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(
                encodeThemePreset({
                    name: activePresetName || undefined,
                    base: currentBase,
                    colors: draft,
                }),
            );
            setCopied(true);
            setTimeout(() => {
                setCopied(false);
            }, 2000);
        } catch {
            // Permission denied or insecure context - do nothing
        }
    }

    function handleImport() {
        const p = decodeThemePreset(importText);
        if (p === null) {
            setImportError(t("themeColorEditor.notAValidThemeCode"));
        } else {
            const importName = p.name || t("themeColorEditor.imported");
            try {
                saveCustomPreset(importName, p.base, p.colors);
                setActivePreset(importName);
                setDraft({ ...p.colors });
                setImportError("");
                setImportText("");
            } catch (err) {
                setImportError(
                    err instanceof Error
                        ? err.message
                        : t("themeColorEditor.cannotImportPreset"),
                );
            }
        }
    }

    function handleDuplicate() {
        if (!activeIsBuiltin) return;
        const copyName = t("themeColorEditor.copy", { activePresetName });
        forkActivePreset(copyName, draft);
        setActivePreset(copyName);
        setDraft({ ...getPresetColors(copyName) });
    }

    function startRename(name: string) {
        setRenamingName(name);
        setRenameValue(name);
    }

    function commitRename() {
        if (renamingRef.current === null) return;
        const oldName = renamingRef.current;
        const newName = renameValue.trim();
        setRenamingName(null);

        if (!newName || newName === oldName) {
            // Empty or unchanged - just cancel
            return;
        }

        const success = renameCustomPreset(oldName, newName);
        if (!success) {
            // Collision or invalid - keep editing
            setRenamingName(oldName);
        }
    }

    function cancelRename() {
        setRenamingName(null);
        setRenameValue("");
    }

    useEffect(
        () => () => {
            // Restore active preset's colors on unmount
            const activeColors = getPresetColors(settingsState.activePreset);
            applyThemeColors(
                Object.keys(activeColors).length > 0 ? activeColors : null,
            );
        },
        [],
    );

    // Zami: the row markup upstream repeats in each color group (ColorRow, below).
    function colorRow(token: ThemeToken) {
        return (
            <ColorRow
                key={token.key}
                token={token}
                value={effective[token.key]}
                disabled={activeIsBuiltin}
                onChange={(value) => setColor(token.key, value)}
                onReset={() => resetColor(token.key)}
            />
        );
    }

    return (
        <View>
            <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                {t("themeColorEditor.themeColors")}
            </Text>

            {/* Top control row: Save | Import [Copy] */}
            <View className="flex flex-col gap-3 mb-4 pb-4 border-b border-discord-divider">
                {/* Save section */}
                <View>
                    <Text className="text-xs text-discord-textMuted mb-1">
                        {t("common.save")}
                    </Text>
                    <View className="flex-row items-center gap-2">
                        <TextInput
                            value={saveNameInput}
                            onChangeText={setSaveNameInput}
                            placeholder={t("themeColorEditor.presetName")}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            accessibilityLabel={t(
                                "themeColorEditor.presetName",
                            )}
                            className="flex-1 px-2.5 py-1.5 rounded bg-discord-backgroundTertiary text-sm text-discord-textPrimary border border-discord-divider focus:border-discord-accent"
                        />
                        <Pressable
                            accessibilityRole="button"
                            className="px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accent/90 disabled:opacity-50 transition-colors"
                            disabled={saveNameInput.trim() === ""}
                            onPress={handleSave}
                        >
                            <Text className="text-sm text-white">
                                {t("themeColorEditor.savePreset")}
                            </Text>
                        </Pressable>
                    </View>
                </View>

                {/* Import + Copy section */}
                <View>
                    <Text className="text-xs text-discord-textMuted mb-1">
                        {t("themeColorEditor.import")}
                    </Text>
                    <View className="flex-row items-center gap-2">
                        <TextInput
                            value={importText}
                            onChangeText={setImportText}
                            placeholder={t("themeColorEditor.pasteThemeCode")}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            accessibilityLabel={t(
                                "themeColorEditor.pasteThemeCode",
                            )}
                            autoCapitalize="none"
                            autoCorrect={false}
                            className={`flex-1 px-2.5 py-1.5 rounded bg-discord-backgroundTertiary text-sm text-discord-textPrimary border ${
                                importError
                                    ? "border-discord-danger"
                                    : "border-discord-divider focus:border-discord-accent"
                            }`}
                        />
                        <Pressable
                            accessibilityRole="button"
                            className="px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accent/90 disabled:opacity-50 transition-colors"
                            disabled={importText.trim() === ""}
                            onPress={handleImport}
                        >
                            <Text className="text-sm text-white">
                                {t("themeColorEditor.import")}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            className="px-3 py-1.5 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors"
                            onPress={() => {
                                handleCopy();
                            }}
                        >
                            <Text className="text-sm text-discord-textPrimary">
                                {copied
                                    ? t("themeColorEditor.copied")
                                    : t("common.copy")}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </View>

            {importError ? (
                <Text className="text-xs text-discord-danger mb-3">
                    {importError}
                </Text>
            ) : null}

            {/* Presets list */}
            <View className="mb-4">
                <Text className="text-sm text-discord-textPrimary mb-2">
                    {t("themeColorEditor.presets")}
                </Text>
                <View className="flex flex-col gap-1">
                    {allPresetNames.map((name) => {
                        const isBuiltin = isBuiltinPreset(name);
                        const isActive = name === activePresetName;
                        const isRenaming = renamingName === name;
                        return (
                            // Zami: a press on a control in the row (rename ✎ /
                            // delete) goes to that control alone, so the row needs
                            // no guard against them. For VoiceOver the row isn't
                            // one element: its name is the button that selects it,
                            // and its controls stay reachable. Enter/Space on the
                            // focused row is keyboard handling, not ported.
                            <Pressable
                                key={name}
                                accessible={false}
                                className={`flex-row items-center gap-2 px-3 py-2 rounded ${
                                    isActive
                                        ? "bg-discord-accent/20 border border-discord-accent"
                                        : "border border-discord-divider hover:bg-discord-messageHover"
                                } transition-colors ${
                                    isRenaming ? "" : "cursor-pointer"
                                }`}
                                onPress={() => {
                                    if (isRenaming) return;
                                    selectPreset(name);
                                }}
                            >
                                {isRenaming ? (
                                    <>
                                        <TextInput
                                            value={renameValue}
                                            onChangeText={setRenameValue}
                                            accessibilityLabel={t(
                                                "themeColorEditor.rename",
                                            )}
                                            className="flex-1 px-2 py-1 rounded bg-discord-backgroundTertiary text-sm text-discord-textPrimary border border-discord-accent"
                                            onBlur={commitRename}
                                            onSubmitEditing={commitRename}
                                            // Zami: not ported: Escape to cancel
                                            // (a hardware-keyboard key).
                                            autoFocus
                                        />
                                        <Pressable
                                            accessibilityRole="button"
                                            className="px-2 py-1 rounded hover:bg-discord-messageHover transition-colors"
                                            onPressIn={() => {
                                                // Press-in (the web's pointerdown)
                                                // ends the rename first, so the
                                                // input's onBlur→commitRename does
                                                // nothing — otherwise "Cancel"
                                                // would save.
                                                cancelRename();
                                            }}
                                        >
                                            <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                                {t("common.cancel")}
                                            </Text>
                                        </Pressable>
                                    </>
                                ) : (
                                    <>
                                        <Text
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                selected: isActive,
                                            }}
                                            onPress={() => selectPreset(name)}
                                            className="flex-1 text-sm text-discord-textPrimary"
                                        >
                                            {name}
                                        </Text>
                                        {isBuiltin ? (
                                            <Text className="px-2 py-0.5 rounded bg-discord-backgroundTertiary text-xs text-discord-textMuted">
                                                {t("common.default")}
                                            </Text>
                                        ) : deletePending === name ? (
                                            <>
                                                <Text className="text-xs text-discord-textMuted">
                                                    {t(
                                                        "themeColorEditor.delete",
                                                    )}
                                                </Text>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    className="px-2 py-1 rounded hover:bg-discord-messageHover transition-colors"
                                                    onPress={() => {
                                                        setDeletePending(null);
                                                    }}
                                                >
                                                    <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                                        {t("common.cancel")}
                                                    </Text>
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    className="px-2 py-1 rounded bg-discord-danger hover:bg-discord-dangerHover transition-colors"
                                                    accessibilityLabel={t(
                                                        "themeColorEditor.confirmDelete",
                                                        { name },
                                                    )}
                                                    onPress={() => {
                                                        handleDelete(name);
                                                    }}
                                                >
                                                    <Text className="text-xs text-white">
                                                        {t("common.delete")}
                                                    </Text>
                                                </Pressable>
                                            </>
                                        ) : (
                                            <>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    accessibilityLabel={t(
                                                        "themeColorEditor.rename",
                                                    )}
                                                    className="px-2 py-1 rounded hover:bg-discord-messageHover transition-colors"
                                                    onPress={() => {
                                                        startRename(name);
                                                    }}
                                                >
                                                    <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                                        ✎
                                                    </Text>
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    className="px-2 py-1 rounded hover:bg-discord-danger transition-colors"
                                                    accessibilityLabel={t(
                                                        "themeColorEditor.delete2",
                                                        { name },
                                                    )}
                                                    onPress={() => {
                                                        setDeletePending(name);
                                                    }}
                                                >
                                                    <Text className="text-xs text-discord-danger">
                                                        {t("common.delete")}
                                                    </Text>
                                                </Pressable>
                                            </>
                                        )}
                                    </>
                                )}
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            {activeIsBuiltin && (
                <View className="mb-4 p-3 rounded bg-discord-backgroundTertiary border border-discord-divider">
                    <Text className="text-sm text-discord-textPrimary mb-2">
                        {t("themeColorEditor.builtInPresetsAreReadOnly")}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        className="self-start px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accent/90 transition-colors"
                        onPress={handleDuplicate}
                    >
                        <Text className="text-sm text-white">
                            {t("themeColorEditor.duplicateToCustomize")}
                        </Text>
                    </Pressable>
                </View>
            )}

            {/* Color pickers (grouped) */}
            <View className="mb-4">
                <Text className="text-sm text-discord-textPrimary mb-3">
                    {t("themeColorEditor.colors")}
                </Text>

                {/* Backgrounds */}
                <View className="mb-4">
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                        {t("themeColorEditor.backgrounds")}
                    </Text>
                    <View className="flex flex-col gap-2">
                        {THEME_TOKENS.filter((t) =>
                            [
                                "background",
                                "backgroundSecondary",
                                "backgroundTertiary",
                            ].includes(t.key),
                        ).map(colorRow)}
                    </View>
                </View>

                {/* Text */}
                <View className="mb-4">
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                        {t("themeColorEditor.text")}
                    </Text>
                    <View className="flex flex-col gap-2">
                        {THEME_TOKENS.filter((t) =>
                            [
                                "textPrimary",
                                "textSecondary",
                                "textMuted",
                            ].includes(t.key),
                        ).map(colorRow)}
                    </View>
                </View>

                {/* Accents & semantics */}
                <View className="mb-4">
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                        {t("themeColorEditor.accentsSemantics")}
                    </Text>
                    <View className="flex flex-col gap-2">
                        {THEME_TOKENS.filter((t) =>
                            [
                                "accent",
                                "link",
                                "danger",
                                "positive",
                                "warning",
                            ].includes(t.key),
                        ).map(colorRow)}
                    </View>
                </View>

                {/* Presence */}
                <View className="mb-4">
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                        {t("themeColorEditor.presence")}
                    </Text>
                    <View className="flex flex-col gap-2">
                        {THEME_TOKENS.filter((t) =>
                            ["online", "idle", "dnd", "offline"].includes(
                                t.key,
                            ),
                        ).map(colorRow)}
                    </View>
                </View>

                {/* Details */}
                <View className="mb-4">
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                        {t("themeColorEditor.details")}
                    </Text>
                    <View className="flex flex-col gap-2">
                        {THEME_TOKENS.filter((t) =>
                            [
                                "divider",
                                "mention",
                                "spoilerBackground",
                                "ownBubbleBackground",
                            ].includes(t.key),
                        ).map(colorRow)}
                    </View>
                </View>
            </View>

            {/* Contrast warnings */}
            {warnings.length > 0 && (
                <View className="mb-4">
                    <Text className="text-sm text-discord-textPrimary mb-2">
                        {t("themeColorEditor.contrastWarnings")}
                    </Text>
                    <View className="flex flex-col gap-1">
                        {warnings.map((warning) => (
                            <Text
                                key={warning.token}
                                className="text-xs text-discord-danger"
                            >
                                ⚠ {warning.label}: {warning.ratio}:1
                            </Text>
                        ))}
                    </View>
                </View>
            )}

            {/* Message display */}
            <View className="mt-6 pt-4 border-t border-discord-divider">
                <Text className="text-sm font-semibold text-discord-textPrimary">
                    {t("themeColorEditor.messageDisplay")}
                </Text>
                <Text className="text-xs text-discord-textMuted mb-3">
                    {t("themeColorEditor.savedOnThisDeviceOnlyNot")}
                </Text>

                <View className="flex-row items-center justify-between mb-1">
                    <Text className="text-sm text-discord-textPrimary">
                        {t("themeColorEditor.appTextSize", {
                            round: Math.round(
                                appTextScalePercent(messageFontSize),
                            ),
                        })}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        className="px-2 py-0.5 rounded hover:bg-discord-messageHover transition-colors"
                        onPress={() =>
                            setMessageFontSize(MSG_FONT_SIZE_DEFAULT)
                        }
                    >
                        <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                            {t("themeColorEditor.resetToDefault")}
                        </Text>
                    </Pressable>
                </View>
                <Range
                    min={12}
                    max={24}
                    step={1}
                    value={messageFontSize}
                    onChange={(value) => setMessageFontSize(value)}
                    accessibilityLabel={t("themeColorEditor.appTextSize", {
                        round: Math.round(appTextScalePercent(messageFontSize)),
                    })}
                />
                <Text className="mt-1 text-xs text-discord-textMuted">
                    {t("themeColorEditor.scalesAllTextAndSpacingAcross")}
                </Text>

                <Text className="text-sm text-discord-textPrimary mt-4 mb-1">
                    {t("themeColorEditor.font")}
                </Text>
                {/* Zami: `input-dark` (a plain CSS class in app.css) as utilities. */}
                <Select
                    value={messageFont}
                    onChange={(value) =>
                        setMessageFont(value as MessageFontKey)
                    }
                    accessibilityLabel={t("themeColorEditor.font")}
                    options={[
                        ...MESSAGE_FONTS.map((f) => ({
                            key: f.key,
                            value: f.key,
                            label: f.label,
                        })),
                        ...(customFontName
                            ? [
                                  {
                                      key: "custom",
                                      value: "custom",
                                      label: t("themeColorEditor.custom", {
                                          customFontName,
                                      }),
                                  },
                              ]
                            : []),
                    ]}
                    className="bg-discord-backgroundSecondary border border-transparent rounded px-2 py-1 w-full"
                />
                <View className="mt-2 flex-row flex-wrap items-center gap-2">
                    <Pressable
                        accessibilityRole="button"
                        className="px-3 py-1.5 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover disabled:opacity-50 transition-colors"
                        onPress={() => {
                            handleFontFile();
                        }}
                        disabled={fontUploadBusy}
                    >
                        <Text className="text-sm text-discord-textPrimary">
                            {customFontName
                                ? t("themeColorEditor.replaceCustomFont")
                                : t("themeColorEditor.uploadCustomFont")}
                        </Text>
                    </Pressable>
                    {customFontName ? (
                        <Pressable
                            accessibilityRole="button"
                            className="px-2 py-1 rounded hover:bg-discord-danger disabled:opacity-50 transition-colors"
                            onPress={() => {
                                handleRemoveFont();
                            }}
                            disabled={fontUploadBusy}
                        >
                            <Text className="text-xs text-discord-danger">
                                {t("common.remove")}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
                {fontUploadError ? (
                    <Text className="mt-1 text-xs text-discord-danger">
                        {fontUploadError}
                    </Text>
                ) : null}
                <Text className="mt-1 text-xs text-discord-textMuted">
                    {t("themeColorEditor.woff2TtfOrOtfUpTo")}
                </Text>

                <Text
                    className="mt-3 text-discord-textPrimary"
                    style={{
                        fontSize: 14,
                        fontFamily: previewFontFamily,
                    }}
                >
                    {t("themeColorEditor.theQuickBrownFoxJumpsOver")}
                </Text>
            </View>
        </View>
    );
}

// Zami: React Native takes one font family, not a CSS stack: the stack's first
// the app has loaded (the custom font under the name it was loaded as), or the
// default (upstream's `inherit`) for none.
function usePreviewFontFamily(stack: string | null): string | undefined {
    return (
        useSyncExternalStore(subscribeAppFont, () => resolveFontStack(stack)) ??
        undefined
    );
}

// Zami: one color row. React Native has no <input type="color">: a swatch shows the
// color, and its hex code (the text upstream shows beside the picker) is an input,
// applied whenever it holds a valid #rgb or #rrggbb.
// Zami: not ported: a visual color picker; colors are typed as hex.
function ColorRow({
    token,
    value,
    disabled,
    onChange,
    onReset,
}: {
    token: ThemeToken;
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
    onReset: () => void;
}) {
    const [text, setText] = useState(value);
    // Follow the color when it changes from outside (another preset, a reset), but
    // not while what's typed already means it (#abc for #aabbcc).
    const [shown, setShown] = useState(value);
    if (value !== shown) {
        setShown(value);
        if (normalizeHex(text) !== value) setText(value);
    }
    return (
        <View className="flex-row items-center gap-2 py-2 border-b border-discord-divider">
            <Text className="flex-1 text-sm text-discord-textPrimary">
                {token.label}
            </Text>
            <View
                className={`w-10 h-8 rounded border border-discord-divider ${
                    disabled ? "opacity-60" : ""
                }`}
                style={{ backgroundColor: value }}
            />
            <TextInput
                value={text}
                onChangeText={(next) => {
                    setText(next);
                    const hex = normalizeHex(next);
                    if (hex) onChange(hex);
                }}
                onEndEditing={() => setText(value)}
                editable={!disabled}
                accessibilityLabel={token.label}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={7}
                className="text-xs text-discord-textMuted font-mono w-20"
            />
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("themeColorEditor.resetToDefault")}
                className="px-2 py-1 rounded hover:bg-discord-messageHover disabled:opacity-30 transition-colors"
                onPress={onReset}
                disabled={disabled}
            >
                <Text className="text-discord-textMuted hover:text-discord-textPrimary">
                    ✕
                </Text>
            </Pressable>
        </View>
    );
}

// Zami: <input type="file" accept=".woff2,.ttf,.otf"> → expo-document-picker. Any
// file can be picked, as with `accept`; uploadCustomFont checks the extension.
// Resolves to the picked file, or null when cancelled.
async function pickFont(): Promise<File | null> {
    const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return null;
    return pickedFile(asset);
}
