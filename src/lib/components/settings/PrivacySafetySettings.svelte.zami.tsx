import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Text, View } from "react-native";
import { t } from "$lib/i18n";
import OptionSelector from "$lib/components/ui/OptionSelector.svelte";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import BlockedUsersSettings from "$lib/components/settings/BlockedUsersSettings.svelte";
import {
    setPrivateReadReceipts,
    setSendTypingIndicators,
    setHideNotificationBody,
    setLinkPreviewMedia,
    setIndexEncryptedRooms,
    settingsState,
} from "$lib/stores/settings.svelte";
import type { LinkPreviewMedia } from "$lib/utils/linkPreviewPolicy";
import {
    updateServiceWorkerNotificationPrivacy,
    updateServiceWorkerReceiptPrivacy,
    startEventIndex,
    deleteEventIndex,
} from "$lib/matrix/client";
import {
    syncNativeNotificationPrivacy,
    syncNativeReceiptPrivacy,
} from "$lib/nativeSession";
import { auth } from "$lib/stores/auth.svelte";

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. `data-setting-anchor` (settings search scrolls to it)
// is not ported.
export default function PrivacySafetySettings() {
    const privateReadReceipts = useRune(
        () => settingsState.privateReadReceipts,
    );
    const sendTypingIndicators = useRune(
        () => settingsState.sendTypingIndicators,
    );
    const indexEncryptedRooms = useRune(
        () => settingsState.indexEncryptedRooms,
    );
    const hideNotificationBody = useRune(
        () => settingsState.hideNotificationBody,
    );
    const linkPreviewMedia = useRune(() => settingsState.linkPreviewMedia);

    const linkPreviewOptions: Array<{
        value: LinkPreviewMedia;
        label: string;
        title: string;
    }> = [
        {
            value: "all",
            label: t("privacySafetySettings.all"),
            title: t("privacySafetySettings.loadPreviewMediaFromWhereverIt"),
        },
        {
            value: "proxied",
            label: t("privacySafetySettings.homeserverOnly"),
            title: t("privacySafetySettings.onlyLoadPreviewMediaYourOwn"),
        },
        {
            value: "none",
            label: t("privacySafetySettings.off"),
            title: t(
                "privacySafetySettings.neverLoadPreviewMediaAutomatically",
            ),
        },
    ];

    function onToggleHideNotificationBody(value: boolean) {
        setHideNotificationBody(value);
        // The service worker and the Android FCM service each keep their own
        // copy of this flag — they cannot read localStorage.
        updateServiceWorkerNotificationPrivacy(value);
        syncNativeNotificationPrivacy(value).catch(() => {});
    }

    function onToggleIndexEncryptedRooms(value: boolean) {
        setIndexEncryptedRooms(value);
        if (value) startEventIndex();
        else if (auth.userId && auth.deviceId)
            void deleteEventIndex(auth.userId, auth.deviceId);
    }

    function onTogglePrivateReadReceipts(value: boolean) {
        setPrivateReadReceipts(value);
        // The service worker and the Android notification actions each keep
        // their own copy for quick mark-read.
        if (auth.userId) {
            updateServiceWorkerReceiptPrivacy(auth.userId, value);
            syncNativeReceiptPrivacy(auth.userId, value).catch(() => {});
        }
    }

    return (
        <View className="gap-6">
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                    {t("privacySafetySettings.privacy")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("privacySafetySettings.privateReadReceipts")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "privacySafetySettings.hideYourReadReceiptsFromOther",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={privateReadReceipts}
                        onChange={onTogglePrivateReadReceipts}
                        label={t("privacySafetySettings.privateReadReceipts")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("privacySafetySettings.sendTypingIndicators")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("privacySafetySettings.letOthersInARoomSee")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={sendTypingIndicators}
                        onChange={setSendTypingIndicators}
                        label={t("privacySafetySettings.sendTypingIndicators")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("privacySafetySettings.indexEncryptedRooms")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("privacySafetySettings.indexEncryptedRoomsHint")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={indexEncryptedRooms}
                        onChange={onToggleIndexEncryptedRooms}
                        label={t("privacySafetySettings.indexEncryptedRooms")}
                    />
                </View>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t(
                                "privacySafetySettings.hideMessageTextInNotifications",
                            )}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "privacySafetySettings.notificationsOnThisDeviceSayWho",
                            )}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={hideNotificationBody}
                        onChange={onToggleHideNotificationBody}
                        label={t(
                            "privacySafetySettings.hideMessageTextInNotifications",
                        )}
                    />
                </View>
                <View className="flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("privacySafetySettings.linkPreviewMedia")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t(
                                "privacySafetySettings.previewImagesAndVideosUsuallyCome",
                            )}
                        </Text>
                    </View>
                    <OptionSelector
                        value={linkPreviewMedia}
                        options={linkPreviewOptions}
                        onChange={setLinkPreviewMedia}
                        ariaLabel={t("privacySafetySettings.linkPreviewMedia")}
                    />
                </View>
            </View>

            <Text
                accessibilityRole="header"
                className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
            >
                {t("privacySafetySettings.blockedUsers")}
            </Text>
            <BlockedUsersSettings />
        </View>
    );
}
