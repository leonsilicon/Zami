import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Select, SettingAnchor } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { LOCALES, getLocale, setLocale, t, type Locale } from "$lib/i18n";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import ThemeColorEditor from "$lib/components/settings/ThemeColorEditor.svelte";
import OptionSelector from "$lib/components/ui/OptionSelector.svelte";
import {
    setRightAlignOwnBubbles,
    setShowNameColours,
    setTimeClock,
    setDateStyle,
    setCustomDatePattern,
    setAlwaysAbsolute,
    setReduceMotion,
    setKeepSidebarOpen,
    setCustomCss,
    setCustomCssEnabled,
    settingsState,
} from "$lib/stores/settings.svelte";
import {
    previewDatePattern,
    type TimeClock,
    type DateStyle,
} from "$lib/utils/timeFormat";

const timeOptions: Array<{ value: TimeClock; label: string }> = [
    { value: "12h", label: t("appearanceSettings.12Hour") },
    { value: "24h", label: t("appearanceSettings.24Hour") },
];
const dateOptions: Array<{ value: DateStyle; label: string }> = [
    { value: "default", label: t("common.default") },
    { value: "iso", label: "ISO" },
    { value: "dmy", label: "D/M/Y" },
    { value: "mdy", label: "M/D/Y" },
    { value: "custom", label: t("appearanceSettings.custom") },
];

const CSS_PLACEHOLDER = ":root {\n    --discord-accent: #e91e63 !important;\n}";

// Zami: not ported: applying custom CSS. setCustomCss and setCustomCssEnabled store
// the setting, then applyCustomCss adds a <style> element, which throws on React
// Native once the box is on and holds CSS. The setting is still kept.
function applyingCustomCss(set: () => void): void {
    try {
        set();
    } catch {
        /* the setting was stored before the stylesheet failed */
    }
}

// Zami: `data-setting-anchor` elements → SettingAnchor, which settings search
// scrolls to and flashes.
// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. Text classes sit on each Text. `data-setting-anchor`
// (settings search scrolls to it) is not ported.
export default function AppearanceSettings() {
    const rightAlignOwnBubbles = useRune(
        () => settingsState.rightAlignOwnBubbles,
    );
    const showNameColours = useRune(() => settingsState.showNameColours);
    const keepSidebarOpen = useRune(() => settingsState.keepSidebarOpen);
    const customCssEnabled = useRune(() => settingsState.customCssEnabled);
    const customCss = useRune(() => settingsState.customCss);
    const timeClock = useRune(() => settingsState.timeClock);
    const dateStyle = useRune(() => settingsState.dateStyle);
    const alwaysAbsolute = useRune(() => settingsState.alwaysAbsolute);
    const reduceMotion = useRune(() => settingsState.reduceMotion);

    const [customDraft, setCustomDraft] = useState(
        () => settingsState.customDatePattern,
    );
    const customPreview = previewDatePattern(customDraft);
    function onCustomInput(value: string): void {
        setCustomDraft(value);
        // Only persist patterns date-fns accepts, so a mid-typing invalid
        // pattern never blanks every timestamp in the app.
        if (previewDatePattern(value) !== null) setCustomDatePattern(value);
    }

    const currentLocale = getLocale();

    function onLocaleChange(value: string) {
        setLocale(value as Locale);
    }

    return (
        <View className="gap-6">
            <SettingAnchor anchor="appearance-language">
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("appearanceSettings.language")}
                </Text>
                <View className="flex-col gap-2 py-2 border-b border-discord-divider sm:flex-row sm:items-center sm:justify-between">
                    <View className="min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("appearanceSettings.displayLanguage")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("appearanceSettings.displayLanguageHint")}
                        </Text>
                    </View>
                    <Select
                        className="bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-2 py-1.5 border border-discord-divider focus:outline-none focus:ring-2 focus:ring-discord-accent sm:max-w-[16rem]"
                        value={currentLocale}
                        onChange={onLocaleChange}
                        accessibilityLabel={t(
                            "appearanceSettings.displayLanguage",
                        )}
                        // Each language names itself (in its own script and
                        // direction), with the English name for everyone else.
                        options={LOCALES.map((l) => ({
                            value: l.code as string,
                            label:
                                l.nativeName === l.englishName
                                    ? l.nativeName
                                    : `${l.nativeName} (${l.englishName})`,
                        }))}
                    />
                </View>
            </SettingAnchor>
            <SettingAnchor anchor="appearance-layout">
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("appearanceSettings.layout")}
                </Text>
                <SettingAnchor
                    anchor="theme-rightalign"
                    className="flex-row items-center gap-3 py-2 border-b border-discord-divider"
                >
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t(
                                "appearanceSettings.rightAlignMyMessagesBubbleLayout",
                            )}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "appearanceSettings.displayYourOwnMessagesOnThe",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={rightAlignOwnBubbles}
                        onChange={setRightAlignOwnBubbles}
                        label={t(
                            "appearanceSettings.rightAlignMyMessagesBubbleLayout",
                        )}
                    />
                </SettingAnchor>
                <SettingAnchor
                    anchor="appearance-namecolours"
                    className="flex-row items-center gap-3 py-2 border-b border-discord-divider"
                >
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("appearanceSettings.showNameColours")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("appearanceSettings.drawPeopleSNamesInThe")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={showNameColours}
                        onChange={setShowNameColours}
                        label={t("appearanceSettings.showNameColours")}
                    />
                </SettingAnchor>
                <SettingAnchor
                    anchor="appearance-keepsidebar"
                    className="flex-row items-center gap-3 py-2 border-b border-discord-divider"
                >
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("appearanceSettings.keepRoomListOpen")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("appearanceSettings.donTAutoCloseTheRoom")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={keepSidebarOpen}
                        onChange={setKeepSidebarOpen}
                        label={t("appearanceSettings.keepRoomListOpen")}
                    />
                </SettingAnchor>
            </SettingAnchor>
            <ThemeColorEditor />

            <SettingAnchor anchor="appearance-custom-css">
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("appearanceSettings.customCss")}
                </Text>
                <View className="flex-row items-center justify-between gap-3 py-2 border-b border-discord-divider">
                    {/* Zami: `shrink`, a web flex item's default. */}
                    <View className="shrink min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("appearanceSettings.customCssEnable")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("appearanceSettings.customCssHint")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={customCssEnabled}
                        onChange={(next) =>
                            applyingCustomCss(() => setCustomCssEnabled(next))
                        }
                        label={t("appearanceSettings.customCssEnable")}
                    />
                </View>
                {/* Zami: not ported: `dir="ltr"` (TextInput takes no direction). */}
                <TextInput
                    multiline
                    textAlignVertical="top"
                    className="mt-3 w-full min-h-40 rounded border border-discord-divider bg-discord-backgroundTertiary p-2 font-mono text-xs text-discord-textPrimary focus:outline-none focus:ring-2 focus:ring-discord-accent"
                    spellCheck={false}
                    autoCorrect={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    placeholder={CSS_PLACEHOLDER}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityLabel={t("appearanceSettings.customCss")}
                    value={customCss}
                    onChangeText={(value) =>
                        applyingCustomCss(() => setCustomCss(value))
                    }
                />
                <Text className="mt-1 text-xs text-discord-textMuted">
                    {t("appearanceSettings.customCssRecovery")}
                </Text>
            </SettingAnchor>

            <SettingAnchor anchor="cust-timestamps">
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("appearanceSettings.timestamps")}
                </Text>

                <View className="flex-col gap-2 py-2 border-b border-discord-divider sm:flex-row sm:items-center sm:justify-between">
                    <Text className="text-sm text-discord-textPrimary">
                        {t("appearanceSettings.timeFormat")}
                    </Text>
                    <OptionSelector
                        value={timeClock}
                        options={timeOptions}
                        onChange={setTimeClock}
                        ariaLabel={t("appearanceSettings.timeFormat")}
                    />
                </View>

                <View className="flex-col gap-2 py-2 border-b border-discord-divider sm:flex-row sm:items-center sm:justify-between">
                    <Text className="text-sm text-discord-textPrimary">
                        {t("appearanceSettings.dateFormat")}
                    </Text>
                    <OptionSelector
                        value={dateStyle}
                        options={dateOptions}
                        onChange={setDateStyle}
                        ariaLabel={t("appearanceSettings.dateFormat")}
                    />
                </View>

                {dateStyle === "custom" && (
                    <View className="py-3 border-b border-discord-divider">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("appearanceSettings.customDatePattern")}
                        </Text>
                        <TextInput
                            nativeID="custom-date-pattern"
                            accessibilityLabel={t(
                                "appearanceSettings.customDatePattern",
                            )}
                            value={customDraft}
                            onChangeText={onCustomInput}
                            spellCheck={false}
                            autoCorrect={false}
                            autoComplete="off"
                            autoCapitalize="none"
                            placeholder={t("appearanceSettings.yyyyMmDd")}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            className={`mt-2 w-full px-2.5 py-1.5 rounded bg-discord-backgroundTertiary text-sm text-discord-textPrimary border ${
                                customPreview === null
                                    ? "border-discord-danger"
                                    : "border-discord-divider focus:border-discord-accent"
                            } outline-none`}
                        />
                        {customPreview !== null ? (
                            <Text className="mt-1.5 text-xs text-discord-textMuted">
                                {t("appearanceSettings.preview")}{" "}
                                <Text className="text-xs text-discord-textPrimary">
                                    {customPreview}
                                </Text>{" "}
                                {t("appearanceSettings.dateFnsTokensEGYyyy")}
                            </Text>
                        ) : (
                            <Text className="mt-1.5 text-xs text-discord-danger">
                                {t(
                                    "appearanceSettings.invalidFormatUseLowercaseDateFns",
                                )}
                            </Text>
                        )}
                    </View>
                )}

                <View className="flex-row items-center gap-3 py-2">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("appearanceSettings.alwaysShowAbsoluteDates")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "appearanceSettings.replaceTodayAndYesterdayWithThe",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={alwaysAbsolute}
                        onChange={setAlwaysAbsolute}
                        label={t("appearanceSettings.alwaysShowAbsoluteDates")}
                    />
                </View>
            </SettingAnchor>

            <SettingAnchor anchor="appearance-reducemotion">
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("appearanceSettings.reduceMotion")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "appearanceSettings.minimizeAnimationsAndTransitionsYourDevice",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={reduceMotion}
                        onChange={setReduceMotion}
                        label={t("appearanceSettings.reduceMotion")}
                    />
                </View>
            </SettingAnchor>
        </View>
    );
}
