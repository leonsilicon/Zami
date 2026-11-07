import { SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { X } from "lucide-svelte";
import { DevSettings, Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
// Banner shown when rust-crypto failed to initialise this session
// (audit SEC-M6): encryption is off on this device, encrypted rooms show
// placeholders, sends to them fail closed and this device's keys aren't
// published. Says why; dismissible for the session (not while sync is
// held for it). Stacked by HealthBanners.
//
// "Try again" reloads rather than restarting crypto in place: the boot
// path is what checks the store against the keys the server has for
// this device (ownDeviceKeysReplaced) and sets sync up for a working
// engine. While the cause is a full disk, it waits for space.
import {
    shouldShowCryptoBanner,
    dismissCryptoBanner,
    sessionHealthState,
} from "$lib/stores/sessionHealth.svelte";
import { storageHealthState } from "$lib/stores/storageHealth.svelte";

export default function CryptoUnavailableBanner() {
    const visible = useRune(() => shouldShowCryptoBanner());
    const waitingForSpace = useRune(
        () =>
            sessionHealthState.cryptoFailureKind === "storage" &&
            storageHealthState.full,
    );
    const message = useRune(() =>
        sessionHealthState.cryptoFailureKind === "storage"
            ? t("cryptoUnavailableBanner.offOutOfStorage")
            : sessionHealthState.cryptoFailureKind === "locked"
              ? t("cryptoUnavailableBanner.offLocked")
              : t("cryptoUnavailableBanner.offOther"),
    );
    const syncHeldForCrypto = useRune(
        () => sessionHealthState.syncHeldForCrypto,
    );
    const cryptoFailureKind = useRune(
        () => sessionHealthState.cryptoFailureKind,
    );
    const cryptoFailureDetail = useRune(
        () => sessionHealthState.cryptoFailureDetail,
    );

    function retry() {
        // Zami: not ported: reloading a release build. `location.reload()` is
        // DevSettings.reload() here, which only reloads in development; a
        // release build needs expo-updates' reloadAsync().
        DevSettings.reload();
    }

    if (!visible) return null;
    return (
        <View
            accessibilityRole="alert"
            className="flex-row max-w-full items-center gap-3 rounded-lg border border-discord-danger/50 bg-discord-backgroundSecondary px-4 py-2.5 shadow-lg"
        >
            <SvgIcon
                d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-2h2zm0-4h-2V7h2z"
                className="h-5 w-5 flex-shrink-0 text-discord-danger"
            />
            <View className="flex flex-shrink min-w-0 flex-col gap-0.5">
                <Text className="text-sm text-discord-textPrimary">
                    {message}
                </Text>
                {syncHeldForCrypto && (
                    <Text className="text-sm text-discord-textPrimary">
                        {t("cryptoUnavailableBanner.syncPaused")}
                    </Text>
                )}
                {cryptoFailureKind === "other" && !!cryptoFailureDetail && (
                    <Text className="break-words text-xs text-discord-textMuted">
                        {cryptoFailureDetail}
                    </Text>
                )}
            </View>
            {/* Zami: `title` (why the button is disabled) has no React Native
                equivalent, so it isn't used. */}
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: waitingForSpace }}
                onPress={retry}
                disabled={waitingForSpace}
                className="flex-shrink-0 rounded bg-discord-accent px-3 py-1 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
                <Text className="text-sm font-medium text-white">
                    {t("cryptoUnavailableBanner.tryAgain")}
                </Text>
            </Pressable>
            {!syncHeldForCrypto && (
                <Pressable
                    accessibilityRole="button"
                    onPress={dismissCryptoBanner}
                    accessibilityLabel={t(
                        "cryptoUnavailableBanner.dismissEncryptionWarning",
                    )}
                    className="flex-shrink-0"
                >
                    <X size={16} className="text-discord-textMuted" />
                </Pressable>
            )}
        </View>
    );
}
