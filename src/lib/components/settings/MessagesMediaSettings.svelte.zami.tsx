import { pickedFile } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as DocumentPicker from "expo-document-picker";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import OptionSelector from "$lib/components/ui/OptionSelector.svelte";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import {
    setShowMatrixIds,
    setShowReadReceiptAvatars,
    setHoldToOpenMessageMenu,
    setSpellCheckEnabled,
    setLinkPreviewsEnabled,
    setPauseVideoOnScrollOff,
    setFaststartVideos,
    setProgressiveJpegs,
    setStripMetadata,
    setRandomizeFileNames,
    setGifsAsWebp,
    setGifDefaultTab,
    setMidiSoundBank,
    settingsState,
} from "$lib/stores/settings.svelte";
import { type GifTab } from "$lib/utils/klipy";
import type { MidiSoundBankChoice } from "$lib/utils/midiSoundBankChoice";
import {
    canUseSystemSoundBank,
    hasSystemSoundBank,
    resetSoundBank,
} from "$lib/utils/midiSoundBank";
import {
    deleteStoredSoundBank,
    getStoredSoundBankInfo,
    isRiff,
    putStoredSoundBank,
    validateCustomSoundBankFile,
} from "$lib/utils/customSoundBank";
import { formatMediaSize } from "$lib/utils/roomMedia";

const gifTabOptions: Array<{ value: GifTab; label: string }> = [
    { value: "gifs", label: "GIFs" },
    { value: "favourites", label: t("messagesMediaSettings.favourites") },
];

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. Text classes sit on each Text. `data-setting-anchor`
// (settings search scrolls to it) is not ported.
export default function MessagesMediaSettings() {
    const showMatrixIds = useRune(() => settingsState.showMatrixIds);
    const showReadReceiptAvatars = useRune(
        () => settingsState.showReadReceiptAvatars,
    );
    const holdToOpenMessageMenu = useRune(
        () => settingsState.holdToOpenMessageMenu,
    );
    const spellCheckEnabled = useRune(() => settingsState.spellCheckEnabled);
    const linkPreviewsEnabled = useRune(
        () => settingsState.linkPreviewsEnabled,
    );
    const pauseVideoOnScrollOff = useRune(
        () => settingsState.pauseVideoOnScrollOff,
    );
    const faststartVideos = useRune(() => settingsState.faststartVideos);
    const progressiveJpegs = useRune(() => settingsState.progressiveJpegs);
    const stripMetadata = useRune(() => settingsState.stripMetadata);
    const randomizeFileNames = useRune(() => settingsState.randomizeFileNames);
    const gifsAsWebp = useRune(() => settingsState.gifsAsWebp);
    const gifDefaultTab = useRune(() => settingsState.gifDefaultTab);
    const midiSoundBank = useRune(() => settingsState.midiSoundBank);

    // Only the desktop app can read the OS's bank; elsewhere the "System"
    // option isn't offered at all. null until checked.
    const systemBankSupported = canUseSystemSoundBank();
    const [systemBankAvailable, setSystemBankAvailable] = useState<
        boolean | null
    >(systemBankSupported ? null : false);
    const [customBank, setCustomBank] = useState<{
        name: string;
        size: number;
    } | null>(null);
    const [customBankLoaded, setCustomBankLoaded] = useState(false);
    const [bankUploadBusy, setBankUploadBusy] = useState(false);
    const [bankUploadError, setBankUploadError] = useState<string | null>(null);

    useEffect(() => {
        if (systemBankSupported)
            void hasSystemSoundBank().then((has) =>
                setSystemBankAvailable(has),
            );
        void getStoredSoundBankInfo().then((info) => {
            setCustomBank(info);
            setCustomBankLoaded(true);
        });
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as the $effect reads no runes.
    }, []);

    // What actually plays: a choice that can't be met falls back to the
    // bundled bank, as utils/midiSoundBank does.
    const effectiveSoundBank = ((): MidiSoundBankChoice => {
        const choice = midiSoundBank;
        if (choice === "system" && systemBankAvailable === false)
            return "bundled";
        if (choice === "custom" && customBankLoaded && !customBank)
            return "bundled";
        return choice;
    })();

    const soundBankOptions: Array<{
        value: MidiSoundBankChoice;
        label: string;
        title?: string;
        disabled?: boolean;
    }> = [
        ...(systemBankSupported
            ? [
                  {
                      value: "system" as const,
                      label: t("midiSoundBank.system"),
                      title:
                          systemBankAvailable === false
                              ? t("midiSoundBank.noSystemSoundBankFound")
                              : undefined,
                      disabled: systemBankAvailable === false,
                  },
              ]
            : []),
        { value: "bundled", label: t("midiSoundBank.included") },
        { value: "custom", label: t("midiSoundBank.custom") },
    ];

    // Zami: the hidden <input type="file" accept={CUSTOM_SOUND_BANK_ACCEPT}> is
    // expo-document-picker, and `bankFileInput?.click()` opens it. It accepts any
    // file: iOS has no type for .sf2/.sf3/.dls, and validateCustomSoundBankFile
    // checks the extension as upstream does.
    async function openBankFilePicker() {
        const result = await DocumentPicker.getDocumentAsync({
            type: "*/*",
            copyToCacheDirectory: true,
        });
        const asset = result.canceled ? undefined : result.assets[0];
        if (!asset) return;
        await handleBankFile(await pickedFile(asset));
    }

    function chooseSoundBank(value: MidiSoundBankChoice) {
        setBankUploadError(null);
        // No custom bank yet: pick one first; it's selected once stored.
        if (value === "custom" && !customBank) {
            void openBankFilePicker();
            return;
        }
        setMidiSoundBank(value);
    }

    async function handleBankFile(file: File | undefined) {
        // Zami: no input value to clear; the picker can always pick the same file.
        if (!file) return;
        setBankUploadError(null);
        const v = validateCustomSoundBankFile(file);
        if (!v.ok) {
            setBankUploadError(v.reason);
            return;
        }
        setBankUploadBusy(true);
        try {
            const data = await file.arrayBuffer();
            if (!isRiff(data)) {
                setBankUploadError(t("midiSoundBank.notASoundBank"));
                return;
            }
            const stored = await putStoredSoundBank({
                name: file.name,
                size: file.size,
                data,
                storedAt: Date.now(),
            });
            if (!stored) {
                setBankUploadError(t("midiSoundBank.couldNotSave"));
                return;
            }
            setCustomBank({ name: file.name, size: file.size });
            resetSoundBank();
            setMidiSoundBank("custom");
        } catch {
            setBankUploadError(t("midiSoundBank.couldNotSave"));
        } finally {
            setBankUploadBusy(false);
        }
    }

    async function removeCustomBank() {
        setBankUploadBusy(true);
        setBankUploadError(null);
        await deleteStoredSoundBank();
        setCustomBank(null);
        resetSoundBank();
        if (settingsState.midiSoundBank === "custom")
            setMidiSoundBank("bundled");
        setBankUploadBusy(false);
    }

    return (
        <View className="gap-6">
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("messagesMediaSettings.messages")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("messagesMediaSettings.showMatrixIds")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "messagesMediaSettings.showFullMatrixIdsLikeUser",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={showMatrixIds}
                        onChange={setShowMatrixIds}
                        label={t("messagesMediaSettings.showMatrixIds")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("messagesMediaSettings.readReceiptAvatars")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "messagesMediaSettings.showWhoHasReadEachMessage",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={showReadReceiptAvatars}
                        onChange={setShowReadReceiptAvatars}
                        label={t("messagesMediaSettings.readReceiptAvatars")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("messagesMediaSettings.holdToOpenMessageMenu")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "messagesMediaSettings.onTouchDevicesOpenAMessage",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={holdToOpenMessageMenu}
                        onChange={setHoldToOpenMessageMenu}
                        label={t("messagesMediaSettings.holdToOpenMessageMenu")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("messagesMediaSettings.checkSpelling")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "messagesMediaSettings.underlineMisspelledWordsAnd",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={spellCheckEnabled}
                        onChange={setSpellCheckEnabled}
                        label={t("messagesMediaSettings.checkSpelling")}
                    />
                </View>
                <View className="gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("messagesMediaSettings.linkPreviews")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("messagesMediaSettings.whenOffNoLinkPreviewIs")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={linkPreviewsEnabled}
                        onChange={setLinkPreviewsEnabled}
                        label={t("messagesMediaSettings.linkPreviews")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("messagesMediaSettings.pauseVideosOffScreen")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "messagesMediaSettings.pauseAPlayingVideoWhenIt",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={pauseVideoOnScrollOff}
                        onChange={setPauseVideoOnScrollOff}
                        label={t("messagesMediaSettings.pauseVideosOffScreen")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t(
                                "messagesMediaSettings.sendVideosThatStreamFaster",
                            )}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "messagesMediaSettings.rearrangeMp4VideosYouSend",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={faststartVideos}
                        onChange={setFaststartVideos}
                        label={t(
                            "messagesMediaSettings.sendVideosThatStreamFaster",
                        )}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t(
                                "messagesMediaSettings.sendPhotosThatAppearSooner",
                            )}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "messagesMediaSettings.rewriteJpegPhotosYouSend",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={progressiveJpegs}
                        onChange={setProgressiveJpegs}
                        label={t(
                            "messagesMediaSettings.sendPhotosThatAppearSooner",
                        )}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t(
                                "messagesMediaSettings.removeLocationAndMetadata",
                            )}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "messagesMediaSettings.stripMetadataDescription",
                            )}
                        </Text>
                        <Text className="mt-1 text-xs font-semibold text-discord-danger">
                            {t("messagesMediaSettings.stripMetadataWarning")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={stripMetadata}
                        onChange={setStripMetadata}
                        label={t(
                            "messagesMediaSettings.removeLocationAndMetadata",
                        )}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("messagesMediaSettings.randomizeFileNames")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "messagesMediaSettings.randomizeFileNamesDescription",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={randomizeFileNames}
                        onChange={setRandomizeFileNames}
                        label={t("messagesMediaSettings.randomizeFileNames")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("messagesMediaSettings.sendGifsAsAnimatedWebp")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("messagesMediaSettings.reencodeGifsYouSend")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={gifsAsWebp}
                        onChange={setGifsAsWebp}
                        label={t(
                            "messagesMediaSettings.sendGifsAsAnimatedWebp",
                        )}
                    />
                </View>
            </View>

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("common.gifs")}
                </Text>
                <View className="gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("messagesMediaSettings.defaultTab")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "messagesMediaSettings.whichTabTheGifPickerOpens",
                            )}
                        </Text>
                    </View>
                    <OptionSelector
                        value={gifDefaultTab}
                        options={gifTabOptions}
                        onChange={setGifDefaultTab}
                        ariaLabel={t("messagesMediaSettings.defaultGifTab")}
                    />
                </View>
            </View>

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("midiSoundBank.midi")}
                </Text>
                <View className="gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("midiSoundBank.soundBank")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("midiSoundBank.theInstrumentSoundsUsedTo")}
                        </Text>
                    </View>
                    <OptionSelector
                        value={effectiveSoundBank}
                        options={soundBankOptions}
                        onChange={chooseSoundBank}
                        ariaLabel={t("midiSoundBank.soundBank")}
                    />
                </View>
                {systemBankSupported && systemBankAvailable === false ? (
                    <Text className="text-xs text-discord-textMuted">
                        {t("midiSoundBank.noSystemSoundBankFound")}
                    </Text>
                ) : null}
                {customBank || effectiveSoundBank === "custom" ? (
                    <View className="mt-2 flex-row flex-wrap items-center gap-2">
                        {customBank ? (
                            <Text
                                numberOfLines={1}
                                className="min-w-0 shrink text-sm text-discord-textPrimary"
                            >
                                {customBank.name}{" "}
                                <Text className="text-xs text-discord-textMuted">
                                    ({formatMediaSize(customBank.size)})
                                </Text>
                            </Text>
                        ) : null}
                        <Pressable
                            accessibilityRole="button"
                            className="px-3 py-1.5 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover disabled:opacity-50 transition-colors"
                            onPress={() => void openBankFilePicker()}
                            disabled={bankUploadBusy}
                        >
                            <Text className="text-sm text-discord-textPrimary">
                                {customBank
                                    ? t("midiSoundBank.chooseAnotherFile")
                                    : t("midiSoundBank.chooseFile")}
                            </Text>
                        </Pressable>
                        {customBank ? (
                            <Pressable
                                accessibilityRole="button"
                                className="px-2 py-1 rounded hover:bg-discord-danger disabled:opacity-50 transition-colors"
                                onPress={() => void removeCustomBank()}
                                disabled={bankUploadBusy}
                            >
                                <Text className="text-xs text-discord-danger">
                                    {t("common.remove")}
                                </Text>
                            </Pressable>
                        ) : null}
                    </View>
                ) : null}
                {bankUploadBusy ? (
                    <Text className="mt-1 text-xs text-discord-textMuted">
                        {t("midiSoundBank.saving")}
                    </Text>
                ) : null}
                {bankUploadError ? (
                    <Text className="mt-1 text-xs text-discord-danger">
                        {bankUploadError}
                    </Text>
                ) : null}
                <Text className="mt-1 text-xs text-discord-textMuted">
                    {t("midiSoundBank.sf2Sf3OrDlsUpTo")}
                </Text>
            </View>
        </View>
    );
}
