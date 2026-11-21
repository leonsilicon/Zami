import { useRef, useState } from "react";
import {
    Pressable,
    Text,
    TextInput,
    View,
    type TextInputInstance,
} from "react-native";
import { useKeyScope } from "@-/com.leonsilicon.zami.browser";
import { Select } from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";
import {
    TIMESTAMP_STYLES,
    buildInlineTimestampToken,
    localDateTimeToUnix,
    unixToLocalDateTimeValue,
    type TimestampStyle,
} from "$lib/utils/inlineTimestamp";

interface Props {
    /** Receives the `<t:UNIX:STYLE>` token to insert into the composer. */
    onInsert: (token: string) => void;
    onClose: () => void;
}

export default function TimestampPicker({ onInsert, onClose }: Props) {
    // Default to the current minute, in the viewer's own time zone.
    const [value, setValue] = useState(() =>
        unixToLocalDateTimeValue(Math.floor(Date.now() / 60000) * 60),
    );
    const [style, setStyle] = useState<TimestampStyle>("f");
    const seconds = localDateTimeToUnix(value);
    const inputEl = useRef<TextInputInstance>(null);

    function styleLabel(s: TimestampStyle): string {
        switch (s) {
            case "t":
                return t("timestampPicker.styleShortTime");
            case "T":
                return t("timestampPicker.styleLongTime");
            case "d":
                return t("timestampPicker.styleShortDate");
            case "D":
                return t("timestampPicker.styleLongDate");
            case "f":
                return t("timestampPicker.styleShortDateTime");
            case "F":
                return t("timestampPicker.styleLongDateTime");
            case "R":
                return t("timestampPicker.styleRelative");
        }
    }

    function insert() {
        if (seconds === null) return;
        onInsert(buildInlineTimestampToken(seconds, style));
    }

    function onKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        }
    }

    // Zami: the dialog's `onkeydown`, with focus in its field or nowhere.
    useKeyScope({ onKeydown }, [inputEl]);

    return (
        <View
            accessibilityRole="none"
            accessibilityLabel={t("timestampPicker.title")}
            className="w-64 bg-zam-backgroundSecondary border border-zam-divider rounded-lg shadow-lg p-3"
        >
            <View className="flex flex-col gap-2">
                <Text className="text-sm font-semibold text-zam-textPrimary">
                    {t("timestampPicker.title")}
                </Text>
                <View className="flex flex-col gap-1">
                    <Text className="text-xs text-zam-textMuted">
                        {t("timestampPicker.dateAndTime")}
                    </Text>
                    {/* Zami: not ported: the native date and time picker of
                        `<input type="datetime-local">` (Zami has no date picker
                        module yet), so the value is typed as its
                        `YYYY-MM-DDTHH:MM` text. Enter submits the form. */}
                    <TextInput
                        ref={inputEl}
                        value={value}
                        onChangeText={setValue}
                        accessibilityLabel={t("timestampPicker.dateAndTime")}
                        autoCapitalize="none"
                        autoCorrect={false}
                        onSubmitEditing={insert}
                        className="bg-zam-background border border-zam-divider rounded px-2 py-1 text-sm text-zam-textPrimary"
                    />
                </View>
                <View className="flex flex-col gap-1">
                    <Text className="text-xs text-zam-textMuted">
                        {t("timestampPicker.format")}
                    </Text>
                    <Select
                        value={style}
                        options={TIMESTAMP_STYLES.map((s) => ({
                            value: s,
                            label: styleLabel(s),
                        }))}
                        onChange={setStyle}
                        accessibilityLabel={t("timestampPicker.format")}
                        className="bg-zam-background border border-zam-divider rounded px-2 py-1 text-sm text-zam-textPrimary"
                    />
                </View>
                <View className="flex-row justify-end gap-2 pt-1">
                    <Pressable
                        onPress={onClose}
                        accessibilityRole="button"
                        className="px-3 py-1 rounded hover:bg-zam-messageHover"
                    >
                        <Text className="text-sm text-zam-textMuted">
                            {t("timestampPicker.cancel")}
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={insert}
                        disabled={seconds === null}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: seconds === null }}
                        className={`px-3 py-1 rounded bg-zam-accent${
                            seconds === null ? " opacity-40" : ""
                        }`}
                    >
                        <Text className="text-sm text-white">
                            {t("timestampPicker.insert")}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}
