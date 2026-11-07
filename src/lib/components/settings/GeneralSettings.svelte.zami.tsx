import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { t } from "$lib/i18n";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import ProxySettings from "./ProxySettings.svelte";
import {
    setMinimizeToTrayOnClose,
    settingsState,
} from "$lib/stores/settings.svelte";
import { isDesktopTray, setMinimizeToTray } from "$lib/desktopTray";

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. `data-setting-anchor` (settings search scrolls to it)
// is not ported. The desktop section is Electron's (`window.desktop`), which the
// Expo app never has, so the app shows the "no general settings" line.
export default function GeneralSettings() {
    const autostart =
        typeof window !== "undefined" ? window.desktop?.autostart : undefined;

    const [autostartInfo, setAutostartInfo] = useState<{
        available: boolean;
        enabled: boolean;
    } | null>(null);
    const [autostartFailed, setAutostartFailed] = useState(false);
    const minimizeToTrayOnClose = useRune(
        () => settingsState.minimizeToTrayOnClose,
    );

    useEffect(() => {
        autostart
            ?.info()
            .then((info) => setAutostartInfo(info))
            .catch(() => {});
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as onMount.
    }, []);

    function onToggleMinimizeToTray(next: boolean): void {
        setMinimizeToTrayOnClose(next);
        setMinimizeToTray(next);
    }

    async function onToggleAutostart(next: boolean): Promise<void> {
        if (!autostart) return;
        setAutostartFailed(false);
        try {
            const info = await autostart.set(next);
            setAutostartInfo(info);
            setAutostartFailed(info.enabled !== next);
        } catch {
            setAutostartFailed(true);
        }
    }

    return (
        <View className="gap-6">
            {isDesktopTray() ? (
                <>
                    <View>
                        <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                            {t("generalSettings.desktop")}
                        </Text>
                        {autostartInfo?.available ? (
                            <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                                <View className="flex-1 min-w-0">
                                    <Text className="text-sm text-discord-textPrimary">
                                        {t("generalSettings.runAtStartup")}
                                    </Text>
                                    <Text className="text-xs text-discord-textMuted">
                                        {t(
                                            "generalSettings.startZamWhenYouLogIn",
                                        )}
                                    </Text>
                                    {autostartFailed ? (
                                        <Text className="text-xs text-discord-danger">
                                            {t(
                                                "generalSettings.runAtStartupFailed",
                                            )}
                                        </Text>
                                    ) : null}
                                </View>
                                <ToggleSwitch
                                    checked={autostartInfo.enabled}
                                    onChange={(next) => {
                                        void onToggleAutostart(next);
                                    }}
                                    label={t("generalSettings.runAtStartup")}
                                />
                            </View>
                        ) : null}
                        <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                            <View className="flex-1 min-w-0">
                                <Text className="text-sm text-discord-textPrimary">
                                    {t("generalSettings.minimiseToTrayOnClose")}
                                </Text>
                                <Text className="text-xs text-discord-textMuted">
                                    {t(
                                        "generalSettings.keepZamRunningInTheSystem",
                                    )}
                                </Text>
                            </View>
                            <ToggleSwitch
                                checked={minimizeToTrayOnClose}
                                onChange={onToggleMinimizeToTray}
                                label={t(
                                    "generalSettings.minimiseToTrayOnClose",
                                )}
                            />
                        </View>
                    </View>
                    <ProxySettings />
                </>
            ) : (
                <Text className="text-sm text-discord-textMuted">
                    {t("generalSettings.noGeneralSettingsAreAvailableOn")}
                </Text>
            )}
        </View>
    );
}
