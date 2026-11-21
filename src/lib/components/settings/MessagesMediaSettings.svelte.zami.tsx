import { pickedFile, Spin } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as DocumentPicker from "expo-document-picker";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import OptionSelector from "$lib/components/ui/OptionSelector.svelte";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import {
    setShowMatrixIds,
    setShowReadReceiptAvatars,
    setReplyPingDefault,
    setHoldToOpenMessageMenu,
    setSpellCheckEnabled,
    setLinkPreviewsEnabled,
    setPauseVideoOnScrollOff,
    setFaststartVideos,
    setProgressiveJpegs,
    setStripMetadata,
    setRandomizeFileNames,
    setGifsAsWebp,
    setHideRecentEmoji,
    setLightboxFitToScreen,
    setGifDefaultTab,
    setDiscordRefreshServiceUrl,
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
import {
    importFavouriteGifs,
    setFavouritesEncrypted,
} from "$lib/stores/favourites.svelte";
import { privateModeState } from "$lib/matrix/privateAccountData.svelte";
import { Loader2 } from "lucide-svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import { fetchLinkPreview, isGifSiteUrl } from "$lib/utils/linkPreviewFetch";
import {
    discordItemToFavourite,
    discordItemsToFavourites,
    mapWithLimit,
    usableDiscordItems,
    type DiscordFavouriteItem,
} from "$lib/utils/discordFavourites";
import { allowsThirdPartyEmbed } from "$lib/utils/linkPreviewPolicy";
import {
    attachmentFavourite,
    attachmentMediaType,
    normaliseRefreshServiceUrl,
    readUploadedAttachments,
    writeUploadedAttachments,
} from "$lib/utils/discordAttachmentImport";
import { getOwnUserId, mxcToHttp, uploadContent } from "$lib/matrix/client";

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
    const replyPingDefault = useRune(() => settingsState.replyPingDefault);
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
    const lightboxFitToScreen = useRune(
        () => settingsState.lightboxFitToScreen,
    );
    const faststartVideos = useRune(() => settingsState.faststartVideos);
    const progressiveJpegs = useRune(() => settingsState.progressiveJpegs);
    const stripMetadata = useRune(() => settingsState.stripMetadata);
    const randomizeFileNames = useRune(() => settingsState.randomizeFileNames);
    const gifsAsWebp = useRune(() => settingsState.gifsAsWebp);
    const hideRecentEmoji = useRune(() => settingsState.hideRecentEmoji);
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

    // Discord favourites import: only where the desktop app provides the bridge.
    // Zami: `window.desktop` is never set on React Native, so this row stays hidden,
    // as in Zam's browser build.
    const discordImportAvailable =
        typeof window !== "undefined" && !!window.desktop?.discordFavourites;
    const [discordBusy, setDiscordBusy] = useState(false);
    // The user's own refresh service for GIFs uploaded to Discord. Saved only
    // once it is a usable address (or cleared).
    const [refreshServiceDraft, setRefreshServiceDraft] = useState(
        () => settingsState.discordRefreshServiceUrl,
    );
    const refreshServiceInvalid =
        refreshServiceDraft.trim() !== "" &&
        normaliseRefreshServiceUrl(refreshServiceDraft) === null;
    function onRefreshServiceInput(value: string) {
        setRefreshServiceDraft(value);
        if (value.trim() === "" || normaliseRefreshServiceUrl(value) !== null)
            setDiscordRefreshServiceUrl(value);
    }
    function refreshErrorMessage(error: string, status?: number): string {
        if (error === "unreachable" || error === "bad-proxy-url")
            return t("messagesMediaSettings.discordRefreshUnreachable");
        if (error === "rate-limited")
            return t("messagesMediaSettings.discordRefreshRateLimited");
        if (error === "http-error")
            return t("messagesMediaSettings.discordRefreshHttpError", {
                status: status ?? 0,
            });
        return t("messagesMediaSettings.discordRefreshBadResponse");
    }

    // Encrypted favourites are account state, shown live from the server. Turning
    // them off is two-step: the list becomes readable by the homeserver again.
    const [confirmingEncryptionOff, setConfirmingEncryptionOff] =
        useState(false);
    const encryptedOn = useRune(() => privateModeState.mode === "encrypted");
    const encryptionBusy = useRune(
        () => privateModeState.switching || privateModeState.mode === "unknown",
    );
    async function setEncryption(enable: boolean) {
        setConfirmingEncryptionOff(false);
        await setFavouritesEncrypted(enable);
    }
    function onEncryptionToggle(checked: boolean) {
        if (checked) void setEncryption(true);
        else setConfirmingEncryptionOff(true);
    }
    const [discordProgress, setDiscordProgress] = useState<{
        done: number;
        total: number;
    } | null>(null);
    const [discordOutcome, setDiscordOutcome] = useState<string | null>(null);
    const discordMounted = useRef(true);
    useEffect(
        () => () => {
            discordMounted.current = false;
        },
        [],
    );

    // Checks each Discord link the way the chat previews it, then imports the
    // ones with media. The UI writes are skipped once the row is gone.
    async function importDiscordFavourites() {
        const bridge = window.desktop?.discordFavourites;
        if (!bridge || discordBusy) return;
        setDiscordBusy(true);
        setDiscordOutcome(null);
        setDiscordProgress(null);
        const setOutcome = (msg: string) => {
            if (discordMounted.current) setDiscordOutcome(msg);
        };
        try {
            const result = await bridge.read();
            if (!result.found) {
                setOutcome(t("messagesMediaSettings.discordImportNotFound"));
                return;
            }
            const items: DiscordFavouriteItem[] = usableDiscordItems(
                result.items,
            );
            const total = items.length;
            const allowEmbeds = allowsThirdPartyEmbed(
                settingsState.linkPreviewMedia,
            );
            // GIFs uploaded to Discord: refresh their links through the user's
            // service, then copy each file to the homeserver. Without a
            // service they are skipped, as before.
            const userId = getOwnUserId();
            const serviceUrl = normaliseRefreshServiceUrl(
                settingsState.discordRefreshServiceUrl,
            );
            const canCopy =
                !!serviceUrl && !!bridge.refresh && !!bridge.download;
            const uploaded = readUploadedAttachments(userId);
            let refreshed: Record<string, string> = {};
            let skippedAttachments = 0;
            let failedAttachments = 0;
            const pending = items
                .filter((i) => i.attachment && !uploaded.has(i.url))
                .map((i) => i.url);
            if (serviceUrl && canCopy && pending.length > 0 && bridge.refresh) {
                const r = await bridge.refresh(serviceUrl, pending);
                if (r.ok) refreshed = r.refreshed;
                else showErrorToast(refreshErrorMessage(r.error, r.status));
            }
            const sameAccount = () => getOwnUserId() === userId;
            // One attachment: re-use an earlier copy, or download and upload.
            const copyAttachment = async (item: DiscordFavouriteItem) => {
                let mxc = uploaded.get(item.url);
                let name: string | undefined;
                let video = item.video;
                if (!mxc) {
                    const fresh = refreshed[item.url];
                    if (!fresh || !bridge.download) return null;
                    const file = await bridge.download(fresh);
                    if (!file.ok) return null;
                    const type = attachmentMediaType(
                        file.name,
                        file.contentType,
                    );
                    if (!type) return null;
                    if (!sameAccount()) throw new Error("account changed");
                    name = file.name;
                    video = type.startsWith("video/");
                    mxc = await uploadContent(
                        new File([file.data as BlobPart], file.name, { type }),
                    );
                    uploaded.set(item.url, mxc);
                    writeUploadedAttachments(userId, uploaded);
                }
                const httpUrl = mxcToHttp(mxc);
                if (!httpUrl) return null;
                return attachmentFavourite({
                    mxc,
                    httpUrl,
                    video,
                    name,
                    width: item.width,
                    height: item.height,
                });
            };
            if (discordMounted.current) setDiscordProgress({ done: 0, total });
            let done = 0;
            const built = await mapWithLimit(
                items,
                4,
                async (item) => {
                    if (item.attachment) {
                        if (!canCopy && !uploaded.has(item.url)) {
                            skippedAttachments++;
                            return null;
                        }
                        try {
                            const entry = await copyAttachment(item);
                            if (!entry) failedAttachments++;
                            return entry;
                        } catch {
                            failedAttachments++;
                            return null;
                        }
                    }
                    try {
                        const { preview } = await fetchLinkPreview(
                            item.url,
                            allowEmbeds,
                        );
                        return discordItemToFavourite(
                            item,
                            preview,
                            isGifSiteUrl(item.url),
                        );
                    } catch {
                        return null;
                    }
                },
                () => {
                    done++;
                    if (discordMounted.current)
                        setDiscordProgress({ done, total });
                },
            );
            const entries = built.filter(
                (e): e is NonNullable<typeof e> => e !== null,
            );
            if (failedAttachments > 0)
                showErrorToast(
                    t("messagesMediaSettings.discordImportCopyFailed", {
                        count: failedAttachments,
                    }),
                );
            if (!sameAccount()) throw new Error("account changed");
            const skippedDiscord = result.skippedDiscord + skippedAttachments;
            const broken =
                result.invalid +
                (result.items.length - items.length) +
                (total -
                    entries.length -
                    skippedAttachments -
                    failedAttachments);
            const favourites = discordItemsToFavourites(entries, Date.now());
            if (favourites.length === 0) {
                setOutcome(
                    t("messagesMediaSettings.discordImportNoneImportable"),
                );
                return;
            }
            const added = await importFavouriteGifs(favourites);
            if (added === 0) {
                setOutcome(
                    t("messagesMediaSettings.discordImportAllPresent", {
                        count: favourites.length,
                    }),
                );
                return;
            }
            let msg = t("messagesMediaSettings.discordImportSuccess", {
                added,
            });
            if (skippedDiscord + broken > 0)
                msg +=
                    " " +
                    t("messagesMediaSettings.discordImportSkipped", {
                        discord: skippedDiscord,
                        broken,
                    });
            setOutcome(msg);
        } catch (err) {
            console.error("Discord favourites import failed:", err);
            showErrorToast(t("messagesMediaSettings.discordImportFailed"));
        } finally {
            if (discordMounted.current) {
                setDiscordBusy(false);
                setDiscordProgress(null);
            }
        }
    }

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
                <Text className="text-xs font-semibold text-zam-textMuted uppercase tracking-wide mb-3">
                    {t("messagesMediaSettings.messages")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-zam-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.showMatrixIds")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                <View className="flex-row items-center gap-3 py-2 border-b border-zam-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.readReceiptAvatars")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                <View className="flex-row items-center gap-3 py-2 border-b border-zam-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.pingOnReply")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
                            {t("messagesMediaSettings.pingOnReplyDescription")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={replyPingDefault}
                        onChange={setReplyPingDefault}
                        label={t("messagesMediaSettings.pingOnReply")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-zam-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.holdToOpenMessageMenu")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                <View className="flex-row items-center gap-3 py-2 border-b border-zam-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.checkSpelling")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.linkPreviews")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.pauseVideosOffScreen")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.fitImagesToScreen")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
                            {t(
                                "messagesMediaSettings.fitImagesToScreenDescription",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={lightboxFitToScreen}
                        onChange={setLightboxFitToScreen}
                        label={t("messagesMediaSettings.fitImagesToScreen")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-zam-textPrimary">
                            {t(
                                "messagesMediaSettings.sendVideosThatStreamFaster",
                            )}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                        <Text className="text-sm text-zam-textPrimary">
                            {t(
                                "messagesMediaSettings.sendPhotosThatAppearSooner",
                            )}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                        <Text className="text-sm text-zam-textPrimary">
                            {t(
                                "messagesMediaSettings.removeLocationAndMetadata",
                            )}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
                            {t(
                                "messagesMediaSettings.stripMetadataDescription",
                            )}
                        </Text>
                        <Text className="mt-1 text-xs font-semibold text-zam-danger">
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
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.randomizeFileNames")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.sendGifsAsAnimatedWebp")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                <View className="flex-row items-center gap-3 py-2">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.hideRecentEmoji")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
                            {t(
                                "messagesMediaSettings.hideRecentEmojiDescription",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={hideRecentEmoji}
                        onChange={setHideRecentEmoji}
                        label={t("messagesMediaSettings.hideRecentEmoji")}
                    />
                </View>
            </View>

            <View>
                <Text className="text-xs font-semibold text-zam-textMuted uppercase tracking-wide mb-3">
                    {t("common.gifs")}
                </Text>
                <View className="gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-zam-textPrimary">
                            {t("messagesMediaSettings.defaultTab")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                <View className="gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-zam-textPrimary">
                            {t("privateData.toggleLabel")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
                            {t("privateData.toggleHelp")}
                        </Text>
                        {confirmingEncryptionOff ? (
                            <Text
                                className="text-xs text-zam-textPrimary mt-1"
                                accessibilityRole="alert"
                            >
                                {t("privateData.offWarning")}
                            </Text>
                        ) : null}
                    </View>
                    {confirmingEncryptionOff ? (
                        <View className="flex-row items-center gap-2 shrink-0">
                            <Pressable
                                accessibilityRole="button"
                                className="px-3 py-1.5 rounded bg-zam-backgroundSecondary hover:bg-zam-messageHover transition-colors"
                                onPress={() =>
                                    setConfirmingEncryptionOff(false)
                                }
                            >
                                <Text className="text-sm text-zam-textPrimary">
                                    {t("common.cancel")}
                                </Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                className="px-3 py-1.5 rounded bg-zam-backgroundSecondary hover:bg-zam-messageHover disabled:opacity-50 transition-colors"
                                onPress={() => void setEncryption(false)}
                                disabled={encryptionBusy}
                            >
                                <Text className="text-sm text-zam-textPrimary">
                                    {t("privateData.turnOff")}
                                </Text>
                            </Pressable>
                        </View>
                    ) : (
                        <View className="flex-row items-center gap-2 shrink-0">
                            {encryptionBusy ? (
                                <Spin>
                                    <Loader2
                                        size={16}
                                        className="text-zam-accent"
                                    />
                                </Spin>
                            ) : null}
                            {/* Zami: `pointer-events-none` → pointerEvents="none". */}
                            <View
                                className={encryptionBusy ? "opacity-50" : ""}
                                pointerEvents={encryptionBusy ? "none" : "auto"}
                                accessibilityState={{
                                    disabled: encryptionBusy,
                                }}
                            >
                                <ToggleSwitch
                                    checked={encryptedOn}
                                    onChange={onEncryptionToggle}
                                    label={t("privateData.toggleLabel")}
                                />
                            </View>
                        </View>
                    )}
                </View>
                {discordImportAvailable ? (
                    <>
                        <View className="gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                            <View className="flex-1 min-w-0">
                                <Text className="text-sm text-zam-textPrimary">
                                    {t(
                                        "messagesMediaSettings.discordImportTitle",
                                    )}
                                </Text>
                                <Text className="text-xs text-zam-textMuted">
                                    {t(
                                        "messagesMediaSettings.discordImportDescription",
                                    )}
                                </Text>
                                {discordBusy && discordProgress ? (
                                    <Text
                                        className="text-xs text-zam-textMuted"
                                        accessibilityLiveRegion="polite"
                                    >
                                        {t(
                                            "messagesMediaSettings.discordImportChecking",
                                            {
                                                done: discordProgress.done,
                                                total: discordProgress.total,
                                            },
                                        )}
                                    </Text>
                                ) : discordOutcome ? (
                                    <Text
                                        className="text-xs text-zam-textMuted"
                                        accessibilityLiveRegion="polite"
                                    >
                                        {discordOutcome}
                                    </Text>
                                ) : null}
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                className="px-3 py-1.5 rounded bg-zam-backgroundSecondary hover:bg-zam-messageHover disabled:opacity-50 transition-colors"
                                onPress={() => void importDiscordFavourites()}
                                disabled={discordBusy}
                            >
                                <Text className="text-sm text-zam-textPrimary">
                                    {discordBusy
                                        ? t(
                                              "messagesMediaSettings.discordImportBusy",
                                          )
                                        : t(
                                              "messagesMediaSettings.discordImportButton",
                                          )}
                                </Text>
                            </Pressable>
                        </View>
                        <View className="py-2">
                            <Text
                                nativeID="discord-refresh-service-label"
                                className="text-sm text-zam-textPrimary"
                            >
                                {t(
                                    "messagesMediaSettings.discordRefreshServiceTitle",
                                )}
                            </Text>
                            <Text className="text-xs text-zam-textMuted">
                                {t(
                                    "messagesMediaSettings.discordRefreshServiceDescription",
                                )}
                            </Text>
                            <TextInput
                                nativeID="discord-refresh-service"
                                accessibilityLabelledBy="discord-refresh-service-label"
                                keyboardType="url"
                                value={refreshServiceDraft}
                                onChangeText={onRefreshServiceInput}
                                editable={!discordBusy}
                                spellCheck={false}
                                autoCorrect={false}
                                autoComplete="off"
                                autoCapitalize="none"
                                placeholder="https://refresh.example.com"
                                placeholderTextColorClassName="accent-zam-textMuted"
                                className={`mt-2 w-full px-2.5 py-1.5 rounded bg-zam-backgroundTertiary text-sm text-zam-textPrimary border ${
                                    refreshServiceInvalid
                                        ? "border-zam-danger"
                                        : "border-zam-divider focus:border-zam-accent"
                                } outline-none ${discordBusy ? "opacity-50" : ""}`}
                            />
                            {refreshServiceInvalid ? (
                                <Text
                                    className="mt-1.5 text-xs text-zam-danger"
                                    accessibilityRole="alert"
                                >
                                    {t(
                                        "messagesMediaSettings.discordRefreshServiceInvalid",
                                    )}
                                </Text>
                            ) : null}
                        </View>
                    </>
                ) : null}
            </View>

            <View>
                <Text className="text-xs font-semibold text-zam-textMuted uppercase tracking-wide mb-3">
                    {t("midiSoundBank.midi")}
                </Text>
                <View className="gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-zam-textPrimary">
                            {t("midiSoundBank.soundBank")}
                        </Text>
                        <Text className="text-xs text-zam-textMuted">
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
                    <Text className="text-xs text-zam-textMuted">
                        {t("midiSoundBank.noSystemSoundBankFound")}
                    </Text>
                ) : null}
                {customBank || effectiveSoundBank === "custom" ? (
                    <View className="mt-2 flex-row flex-wrap items-center gap-2">
                        {customBank ? (
                            <Text
                                numberOfLines={1}
                                className="min-w-0 shrink text-sm text-zam-textPrimary"
                            >
                                {customBank.name}{" "}
                                <Text className="text-xs text-zam-textMuted">
                                    ({formatMediaSize(customBank.size)})
                                </Text>
                            </Text>
                        ) : null}
                        <Pressable
                            accessibilityRole="button"
                            className="px-3 py-1.5 rounded bg-zam-backgroundSecondary hover:bg-zam-messageHover disabled:opacity-50 transition-colors"
                            onPress={() => void openBankFilePicker()}
                            disabled={bankUploadBusy}
                        >
                            <Text className="text-sm text-zam-textPrimary">
                                {customBank
                                    ? t("midiSoundBank.chooseAnotherFile")
                                    : t("midiSoundBank.chooseFile")}
                            </Text>
                        </Pressable>
                        {customBank ? (
                            <Pressable
                                accessibilityRole="button"
                                className="px-2 py-1 rounded hover:bg-zam-danger disabled:opacity-50 transition-colors"
                                onPress={() => void removeCustomBank()}
                                disabled={bankUploadBusy}
                            >
                                <Text className="text-xs text-zam-danger">
                                    {t("common.remove")}
                                </Text>
                            </Pressable>
                        ) : null}
                    </View>
                ) : null}
                {bankUploadBusy ? (
                    <Text className="mt-1 text-xs text-zam-textMuted">
                        {t("midiSoundBank.saving")}
                    </Text>
                ) : null}
                {bankUploadError ? (
                    <Text className="mt-1 text-xs text-zam-danger">
                        {bankUploadError}
                    </Text>
                ) : null}
                <Text className="mt-1 text-xs text-zam-textMuted">
                    {t("midiSoundBank.sf2Sf3OrDlsUpTo")}
                </Text>
            </View>
        </View>
    );
}
