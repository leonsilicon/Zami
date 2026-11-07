import { useState } from "react";
import {
    I18nManager,
    Platform,
    Pressable,
    Text,
    TextInput,
    View,
} from "react-native";
import { Select } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import { installedPlugins, getPluginHost } from "$lib/stores/plugins.svelte";
import {
    readPluginSettings,
    writePluginSettings,
} from "$lib/plugins/pluginSettingsStore";
import {
    addListRow,
    removeListRow,
    moveListRow,
    setListCell,
    setFieldValue,
} from "$lib/plugins/settingsForm";
import type {
    SettingsField,
    ListField,
    SelectField,
    NumberField,
    TextField,
} from "$lib/plugins/settingsSchema";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-svelte";

interface Props {
    pluginId: string;
    onBack: () => void;
}

const inputClass =
    "w-full px-2.5 py-1.5 rounded bg-discord-backgroundSecondary text-sm text-discord-textPrimary border border-discord-divider focus:border-discord-accent outline-none";
const selectClass = inputClass;

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. Text classes sit on each Text; `block` is dropped (a
// Text is a block in a column already). A `<label for>` is the input's
// accessibilityLabel.
export default function PluginSettingsForm({ pluginId, onBack }: Props) {
    const record = useRune(() => installedPlugins[pluginId], [pluginId]);
    const schema: SettingsField[] = record?.manifest.settings ?? [];
    const pluginName = record?.manifest.name ?? pluginId;

    // Initialize once from storage. The user is editing from here on, so this
    // must NOT re-read reactively (the parent keys this form on pluginId, so a
    // different plugin remounts it).
    const [values, setValues] = useState<Record<string, unknown>>(() =>
        readPluginSettings(
            pluginId,
            installedPlugins[pluginId]?.manifest.settings ?? [],
        ),
    );

    /** Single write path: update local state, then persist + broadcast via the
     *  live host if enabled, else straight to storage. */
    function persist(next: Record<string, unknown>): void {
        setValues(next);
        const host = getPluginHost(pluginId);
        if (host) host.setSettings(next);
        else writePluginSettings(pluginId, schema, next);
    }

    function setScalar(key: string, value: unknown): void {
        persist(setFieldValue(values, key, value));
    }

    function rowsOf(key: string): Record<string, unknown>[] {
        const v = values[key];
        return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
    }

    function addRow(field: ListField): void {
        persist(
            setFieldValue(
                values,
                field.key,
                addListRow(rowsOf(field.key), field.fields),
            ),
        );
    }
    function removeRow(field: ListField, i: number): void {
        persist(
            setFieldValue(
                values,
                field.key,
                removeListRow(rowsOf(field.key), i),
            ),
        );
    }
    function moveRow(field: ListField, from: number, to: number): void {
        persist(
            setFieldValue(
                values,
                field.key,
                moveListRow(rowsOf(field.key), from, to),
            ),
        );
    }
    function setCell(
        field: ListField,
        i: number,
        key: string,
        value: unknown,
    ): void {
        persist(
            setFieldValue(
                values,
                field.key,
                setListCell(rowsOf(field.key), i, key, value),
            ),
        );
    }

    return (
        <View className="gap-4">
            <View className="flex-row items-center gap-2">
                <Pressable
                    accessibilityRole="button"
                    onPress={onBack}
                    accessibilityLabel={t("pluginSettingsForm.backToPlugins")}
                    className="-ms-2 p-1.5 rounded hover:bg-discord-messageHover transition-colors flex-shrink-0"
                >
                    {/* Zami: `mirror:-scale-x-100`, from I18nManager. */}
                    <ArrowLeft
                        size={20}
                        className="text-discord-textMuted hover:text-discord-textPrimary"
                        style={
                            I18nManager.isRTL
                                ? { transform: [{ scaleX: -1 }] }
                                : undefined
                        }
                    />
                </Pressable>
                <Text
                    accessibilityRole="header"
                    numberOfLines={1}
                    className="flex-shrink text-base font-bold text-discord-textPrimary min-w-0 truncate"
                >
                    {t("pluginSettingsForm.settings", { pluginName })}
                </Text>
            </View>

            {schema.length === 0 ? (
                <Text className="text-sm text-discord-textMuted">
                    {t("pluginSettingsForm.thisPluginHasNoSettings")}
                </Text>
            ) : (
                <View className="gap-4">
                    {schema.map((field) =>
                        field.type === "toggle" ? (
                            <View
                                key={field.key}
                                className="flex-row items-center gap-3"
                            >
                                <View className="flex-1 min-w-0">
                                    <Text className="text-sm text-discord-textPrimary">
                                        {field.label}
                                    </Text>
                                    {field.description ? (
                                        <Text className="text-xs text-discord-textMuted">
                                            {field.description}
                                        </Text>
                                    ) : null}
                                </View>
                                <ToggleSwitch
                                    checked={values[field.key] === true}
                                    onChange={(next) =>
                                        setScalar(field.key, next)
                                    }
                                    label={field.label}
                                />
                            </View>
                        ) : field.type === "text" ? (
                            <View key={field.key}>
                                <Text className="text-sm text-discord-textPrimary mb-1">
                                    {field.label}
                                </Text>
                                {field.description ? (
                                    <Text className="text-xs text-discord-textMuted mb-1">
                                        {field.description}
                                    </Text>
                                ) : null}
                                <TextInput
                                    nativeID={`pf-${field.key}`}
                                    accessibilityLabel={field.label}
                                    className={inputClass}
                                    placeholder={field.placeholder ?? ""}
                                    placeholderTextColorClassName="accent-discord-textMuted"
                                    value={String(values[field.key] ?? "")}
                                    onChangeText={(text) =>
                                        setScalar(field.key, text)
                                    }
                                />
                            </View>
                        ) : field.type === "number" ? (
                            <View key={field.key}>
                                <Text className="text-sm text-discord-textPrimary mb-1">
                                    {field.label}
                                </Text>
                                {field.description ? (
                                    <Text className="text-xs text-discord-textMuted mb-1">
                                        {field.description}
                                    </Text>
                                ) : null}
                                <NumberInput
                                    nativeID={`pf-${field.key}`}
                                    accessibilityLabel={field.label}
                                    className={inputClass}
                                    value={values[field.key]}
                                    onInput={(value) =>
                                        setScalar(field.key, value)
                                    }
                                />
                            </View>
                        ) : field.type === "select" ? (
                            <View key={field.key}>
                                <Text className="text-sm text-discord-textPrimary mb-1">
                                    {field.label}
                                </Text>
                                {field.description ? (
                                    <Text className="text-xs text-discord-textMuted mb-1">
                                        {field.description}
                                    </Text>
                                ) : null}
                                <Select
                                    nativeID={`pf-${field.key}`}
                                    accessibilityLabel={field.label}
                                    className={selectClass}
                                    value={String(values[field.key] ?? "")}
                                    onChange={(value) =>
                                        setScalar(field.key, value)
                                    }
                                    options={field.options}
                                />
                            </View>
                        ) : field.type === "list" ? (
                            <View key={field.key}>
                                <Text className="text-sm text-discord-textPrimary mb-1">
                                    {field.label}
                                </Text>
                                {field.description ? (
                                    <Text className="text-xs text-discord-textMuted mb-2">
                                        {field.description}
                                    </Text>
                                ) : null}
                                <View className="gap-2">
                                    {rowsOf(field.key).map((row, i) => (
                                        <View
                                            key={i}
                                            className="flex-row items-start gap-2 p-2 rounded bg-discord-backgroundTertiary"
                                        >
                                            <View className="flex-1 min-w-0 gap-2">
                                                {field.fields.map((sub) => {
                                                    if (sub.type === "toggle") {
                                                        return (
                                                            <View
                                                                key={sub.key}
                                                                className="flex-row items-center gap-2"
                                                            >
                                                                <Text className="flex-1 text-xs text-discord-textMuted">
                                                                    {sub.label}
                                                                </Text>
                                                                <ToggleSwitch
                                                                    checked={
                                                                        row[
                                                                            sub
                                                                                .key
                                                                        ] ===
                                                                        true
                                                                    }
                                                                    onChange={(
                                                                        next,
                                                                    ) =>
                                                                        setCell(
                                                                            field,
                                                                            i,
                                                                            sub.key,
                                                                            next,
                                                                        )
                                                                    }
                                                                    label={
                                                                        sub.label
                                                                    }
                                                                />
                                                            </View>
                                                        );
                                                    } else if (
                                                        sub.type === "select"
                                                    ) {
                                                        const selectField =
                                                            sub as SelectField;
                                                        return (
                                                            <Select
                                                                key={sub.key}
                                                                className={
                                                                    selectClass
                                                                }
                                                                accessibilityLabel={
                                                                    selectField.label
                                                                }
                                                                value={String(
                                                                    row[
                                                                        selectField
                                                                            .key
                                                                    ] ?? "",
                                                                )}
                                                                onChange={(
                                                                    value,
                                                                ) =>
                                                                    setCell(
                                                                        field,
                                                                        i,
                                                                        selectField.key,
                                                                        value,
                                                                    )
                                                                }
                                                                options={
                                                                    selectField.options
                                                                }
                                                            />
                                                        );
                                                    } else if (
                                                        sub.type === "number"
                                                    ) {
                                                        const numberField =
                                                            sub as NumberField;
                                                        return (
                                                            <NumberInput
                                                                key={sub.key}
                                                                className={
                                                                    inputClass
                                                                }
                                                                accessibilityLabel={
                                                                    numberField.label
                                                                }
                                                                placeholder={
                                                                    numberField.label
                                                                }
                                                                value={
                                                                    row[
                                                                        numberField
                                                                            .key
                                                                    ]
                                                                }
                                                                onInput={(
                                                                    value,
                                                                ) =>
                                                                    setCell(
                                                                        field,
                                                                        i,
                                                                        numberField.key,
                                                                        value,
                                                                    )
                                                                }
                                                            />
                                                        );
                                                    } else {
                                                        const textField =
                                                            sub as TextField;
                                                        return (
                                                            <TextInput
                                                                key={sub.key}
                                                                className={
                                                                    inputClass
                                                                }
                                                                accessibilityLabel={
                                                                    textField.label
                                                                }
                                                                placeholder={
                                                                    textField.type ===
                                                                    "text"
                                                                        ? (textField.placeholder ??
                                                                          textField.label)
                                                                        : textField.label
                                                                }
                                                                placeholderTextColorClassName="accent-discord-textMuted"
                                                                value={String(
                                                                    row[
                                                                        textField
                                                                            .key
                                                                    ] ?? "",
                                                                )}
                                                                onChangeText={(
                                                                    text,
                                                                ) =>
                                                                    setCell(
                                                                        field,
                                                                        i,
                                                                        textField.key,
                                                                        text,
                                                                    )
                                                                }
                                                            />
                                                        );
                                                    }
                                                })}
                                            </View>
                                            <View className="flex-col gap-1 flex-shrink-0">
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        moveRow(field, i, i - 1)
                                                    }
                                                    disabled={i === 0}
                                                    accessibilityLabel={t(
                                                        "pluginSettingsForm.moveUp",
                                                    )}
                                                    accessibilityState={{
                                                        disabled: i === 0,
                                                    }}
                                                    className="p-1 rounded hover:bg-discord-messageHover transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                                                >
                                                    <ChevronUp
                                                        size={14}
                                                        className="text-discord-textMuted hover:text-discord-textPrimary"
                                                    />
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        moveRow(field, i, i + 1)
                                                    }
                                                    disabled={
                                                        i ===
                                                        rowsOf(field.key)
                                                            .length -
                                                            1
                                                    }
                                                    accessibilityLabel={t(
                                                        "pluginSettingsForm.moveDown",
                                                    )}
                                                    accessibilityState={{
                                                        disabled:
                                                            i ===
                                                            rowsOf(field.key)
                                                                .length -
                                                                1,
                                                    }}
                                                    className="p-1 rounded hover:bg-discord-messageHover transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                                                >
                                                    <ChevronDown
                                                        size={14}
                                                        className="text-discord-textMuted hover:text-discord-textPrimary"
                                                    />
                                                </Pressable>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        removeRow(field, i)
                                                    }
                                                    accessibilityLabel={t(
                                                        "pluginSettingsForm.removeRow",
                                                    )}
                                                    className="p-1 rounded hover:bg-discord-messageHover transition-colors"
                                                >
                                                    <Trash2
                                                        size={14}
                                                        className="text-discord-textMuted hover:text-discord-danger"
                                                    />
                                                </Pressable>
                                            </View>
                                        </View>
                                    ))}
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => addRow(field)}
                                    className="mt-2 flex-row self-start items-center gap-1.5 px-2.5 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover transition-colors"
                                >
                                    <Plus
                                        size={14}
                                        className="text-discord-textPrimary"
                                    />
                                    <Text className="text-xs font-semibold text-discord-textPrimary">
                                        {t("common.add")}
                                    </Text>
                                </Pressable>
                            </View>
                        ) : null,
                    )}
                </View>
            )}
        </View>
    );
}

// Zami: <input type="number">. Upstream shows `Number(value ?? 0)` and stores what's
// typed as a number, or "" when the field holds no number (an empty or unfinished
// entry, whose `value` the browser reports as ""). The browser keeps showing what's
// typed meanwhile; a TextInput shows its `value`, so this keeps the typed text while
// it still stands for the stored value ("" or "1." for 1) and shows the stored number
// once it changes from outside (a reordered row).
// Zami: not ported: `min`, `max` and `step`, which only drive the browser's spinner
// arrows and form validation; a TextInput has neither.
function NumberInput({
    value,
    onInput,
    className,
    accessibilityLabel,
    placeholder,
    nativeID,
}: {
    value: unknown;
    onInput: (value: number | "") => void;
    className: string;
    accessibilityLabel: string;
    placeholder?: string;
    nativeID?: string;
}) {
    const shownNumber = String(Number(value ?? 0));
    const [text, setText] = useState(shownNumber);
    const [shown, setShown] = useState(value);
    if (!Object.is(value, shown)) {
        setShown(value);
        if (!Object.is(parseNumber(text), value)) setText(shownNumber);
    }
    return (
        <TextInput
            nativeID={nativeID}
            accessibilityLabel={accessibilityLabel}
            className={className}
            placeholder={placeholder}
            placeholderTextColorClassName="accent-discord-textMuted"
            keyboardType={
                Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"
            }
            value={text}
            onChangeText={(next) => {
                setText(next);
                onInput(parseNumber(next));
            }}
        />
    );
}

/** What a number input's `value` gives: "" for no number, else the number. */
function parseNumber(text: string): number | "" {
    const trimmed = text.trim();
    if (trimmed === "") return "";
    const n = Number(trimmed);
    return Number.isNaN(n) ? "" : n;
}
