import { SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { X } from "lucide-svelte";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
// Out of storage: persistent, with no dismiss, until a check finds room
// again (storageHealth lifts it by itself; "Check again" checks now).
// Low on storage: an early warning, dismissible for the session.
import {
    storageHealthState,
    recheckStorage,
} from "$lib/stores/storageHealth.svelte";

export default function StorageBanner() {
    const [lowDismissed, setLowDismissed] = useState(false);
    const [checking, setChecking] = useState(false);

    const full = useRune(() => storageHealthState.full);
    const showLow = useRune(
        () =>
            !storageHealthState.full && storageHealthState.low && !lowDismissed,
        [lowDismissed],
    );

    const freeText = useRune(() => {
        const free = storageHealthState.freeBytes;
        if (free === null) return "";
        return new Intl.NumberFormat(undefined, {
            style: "unit",
            unit: "megabyte",
            maximumFractionDigits: 0,
        }).format(free / (1024 * 1024));
    });

    async function checkAgain() {
        setChecking(true);
        try {
            await recheckStorage();
        } finally {
            setChecking(false);
        }
    }

    if (!(full || showLow)) return null;
    return (
        <View
            accessibilityRole="alert"
            className={`flex-row max-w-full items-center gap-3 rounded-lg border bg-discord-backgroundSecondary px-4 py-2.5 shadow-lg ${
                full ? "border-discord-danger/50" : "border-discord-warning/50"
            }`}
        >
            <SvgIcon
                d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-2h2zm0-4h-2V7h2z"
                className={`h-5 w-5 flex-shrink-0 ${
                    full ? "text-discord-danger" : "text-discord-warning"
                }`}
            />
            <Text className="flex-shrink min-w-0 text-sm text-discord-textPrimary">
                {full
                    ? t("storageBanner.outOfStorage")
                    : t("storageBanner.lowStorage", { free: freeText })}
            </Text>
            {full ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: checking }}
                    onPress={() => void checkAgain()}
                    disabled={checking}
                    className="flex-shrink-0 rounded bg-discord-accent px-3 py-1 hover:opacity-90 disabled:opacity-50"
                >
                    <Text className="text-sm font-medium text-white">
                        {t("storageBanner.checkAgain")}
                    </Text>
                </Pressable>
            ) : (
                <Pressable
                    accessibilityRole="button"
                    onPress={() => setLowDismissed(true)}
                    accessibilityLabel={t(
                        "storageBanner.dismissLowStorageWarning",
                    )}
                    className="flex-shrink-0"
                >
                    <X size={16} className="text-discord-textMuted" />
                </Pressable>
            )}
        </View>
    );
}
