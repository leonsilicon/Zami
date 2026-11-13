import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useDeepRune, useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import {
    setRichPresenceArrpc,
    setRichPresenceAutoRestartDiscord,
    setRichPresenceEnabled,
    setRichPresenceFakeDiscord,
    setRichPresenceMedia,
    setRichPresenceScan,
    settingsState,
} from "$lib/stores/settings.svelte";
import {
    addCustomGame,
    disableSteam,
    enableSteam,
    forgetApp,
    listRunningPrograms,
    refreshRichPresenceStatus,
    removeCustomGame,
    richPresenceAvailable,
    richPresenceState,
    setAppAllowed,
    syncRichPresence,
    type SteamDebugOutcome,
} from "$lib/stores/richPresence.svelte";

// Zami: Text classes sit on each Text; `title` tooltips are dropped. `<code>` is a
// selectable Text with the monospace font the browser gives it. `data-setting-anchor`
// (settings search scrolls to it) is not ported. Rich presence needs the desktop
// bridge (`window.desktop.richPresence`), so on React Native richPresenceAvailable()
// is false and this lists only what plugins publish, as on Zam's web build.
export default function RichPresenceSettings() {
    // Desktop only: apps on this computer report what they are doing and it is
    // published to the profile (MSC4544). Off until switched on here, and each
    // app is allowed until switched off.

    const knownApps = useDeepRune(() => richPresenceState.apps);
    const apps = Object.entries(knownApps).sort(
        (a, b) => b[1].lastSeen - a[1].lastSeen,
    );
    const status = useDeepRune(() => richPresenceState.status);
    const desktop = richPresenceAvailable();
    // Off the desktop app only plugins publish, so only they are listed.
    const hasPlugins = apps.some(([, a]) => a.source === "plugin");
    const games = useDeepRune(() => richPresenceState.games);
    const publishError = useRune(() => richPresenceState.error);
    const richPresenceEnabled = useRune(
        () => settingsState.richPresenceEnabled,
    );
    const richPresenceArrpc = useRune(() => settingsState.richPresenceArrpc);
    const richPresenceScan = useRune(() => settingsState.richPresenceScan);
    const richPresenceMedia = useRune(() => settingsState.richPresenceMedia);
    const richPresenceAutoRestartDiscord = useRune(
        () => settingsState.richPresenceAutoRestartDiscord,
    );
    const richPresenceFakeDiscord = useRune(
        () => settingsState.richPresenceFakeDiscord,
    );
    const richPresenceSteam = useRune(() => settingsState.richPresenceSteam);

    function onToggleShare(next: boolean): void {
        setRichPresenceEnabled(next);
        void syncRichPresence();
    }

    function onToggleScan(next: boolean): void {
        setRichPresenceScan(next);
        void syncRichPresence();
    }

    function onToggleMedia(next: boolean): void {
        setRichPresenceMedia(next);
        void syncRichPresence();
    }

    function onToggleArrpc(next: boolean): void {
        setRichPresenceArrpc(next);
        void syncRichPresence();
    }

    function onToggleAutoRestart(next: boolean): void {
        setRichPresenceAutoRestartDiscord(next);
        void syncRichPresence();
    }

    function onToggleFake(next: boolean): void {
        setRichPresenceFakeDiscord(next);
        void syncRichPresence();
    }

    // Steam: the debug flag is written first (Windows asks for permission), so
    // the source only turns on once that worked. Turning it off always tries to
    // remove the flag; the outcome is shown rather than swallowed.
    const [steamBusy, setSteamBusy] = useState(false);
    const [steamEnableError, setSteamEnableError] = useState<string | null>(
        null,
    );
    const [steamDisable, setSteamDisable] = useState<SteamDebugOutcome | null>(
        null,
    );
    const [confirmingSteamRestart, setConfirmingSteamRestart] = useState(false);
    const [steamRestarting, setSteamRestarting] = useState(false);
    const [steamRestartError, setSteamRestartError] = useState<string | null>(
        null,
    );
    const steamPoll = useRef<ReturnType<typeof setInterval> | null>(null);

    const steamVisible =
        status?.steam?.supported !== false ||
        status?.steam?.needsPermission === true;
    // The flag is still set after a failed removal, per the last status read.
    const steamFlagLeft =
        !richPresenceSteam &&
        steamDisable !== null &&
        !steamDisable.ok &&
        status?.steam?.enabled !== false;

    function stopSteamPoll(): void {
        if (steamPoll.current) clearInterval(steamPoll.current);
        steamPoll.current = null;
    }

    useEffect(() => stopSteamPoll, []);

    /** After a restart Steam's port takes a moment: look every 2s, for 30s. */
    function pollSteamPort(): void {
        stopSteamPoll();
        let tries = 0;
        steamPoll.current = setInterval(async () => {
            tries++;
            await refreshRichPresenceStatus();
            if (richPresenceState.status?.steam?.portOpen || tries >= 15)
                stopSteamPoll();
        }, 2000);
    }

    // Zami: a ref beside `steamBusy`, so a second tap before the first
    // settles sees it busy, as the `$state` read does.
    const steamBusyRef = useRef(false);
    async function onToggleSteam(next: boolean): Promise<void> {
        if (steamBusyRef.current) return;
        setSteamEnableError(null);
        setSteamDisable(null);
        steamBusyRef.current = true;
        setSteamBusy(true);
        if (next) {
            const res = await enableSteam();
            if (!res.ok)
                setSteamEnableError(
                    res.cancelled
                        ? t("richPresence.steamUacCancelled")
                        : t("richPresence.steamEnableFailed", {
                              error: res.error ?? "",
                          }),
                );
        } else {
            stopSteamPoll();
            setSteamDisable(await disableSteam());
        }
        steamBusyRef.current = false;
        setSteamBusy(false);
    }

    async function restartSteam(): Promise<void> {
        setConfirmingSteamRestart(false);
        setSteamRestarting(true);
        setSteamRestartError(null);
        let restartError: string | null = null;
        try {
            const res = await window.desktop?.richPresence?.restartSteam();
            if (res && !res.ok) restartError = res.error ?? "";
        } catch (e) {
            restartError = String((e as Error)?.message ?? e);
        }
        setSteamRestartError(restartError);
        await refreshRichPresenceStatus();
        setSteamRestarting(false);
        if (restartError === null) pollSteamPort();
    }

    // Discord holds the first slot when it started before Zam.
    const discordFirst =
        richPresenceEnabled &&
        richPresenceArrpc &&
        status?.arrpc.running === true &&
        (status.arrpc.slot ?? 0) > 0;
    const [confirmingRestart, setConfirmingRestart] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const [restartError, setRestartError] = useState<string | null>(null);

    async function restartDiscord(): Promise<void> {
        setConfirmingRestart(false);
        setRestarting(true);
        setRestartError(null);
        try {
            const res = await window.desktop?.richPresence?.restartDiscord();
            if (res && !res.ok) setRestartError(res.error ?? "");
        } catch (e) {
            setRestartError(String((e as Error)?.message ?? e));
        }
        await syncRichPresence();
        setRestarting(false);
    }

    // Added games: pick a running program, name it, and it is a game.
    const [picking, setPicking] = useState(false);
    const [programs, setPrograms] = useState<{ path: string; name: string }[]>(
        [],
    );
    const [loadingPrograms, setLoadingPrograms] = useState(false);
    const [query, setQuery] = useState("");
    const [chosen, setChosen] = useState<{ path: string; name: string } | null>(
        null,
    );
    const [gameName, setGameName] = useState("");

    const q = query.trim().toLowerCase();
    const shownPrograms = programs
        .filter(
            (p) =>
                !q ||
                p.name.toLowerCase().includes(q) ||
                p.path.toLowerCase().includes(q),
        )
        .slice(0, 100);

    async function loadPrograms(): Promise<void> {
        setLoadingPrograms(true);
        setPrograms(await listRunningPrograms());
        setLoadingPrograms(false);
    }

    function startPicking(): void {
        setPicking(true);
        setChosen(null);
        setQuery("");
        void loadPrograms();
    }

    function choose(p: { path: string; name: string }): void {
        setChosen(p);
        setGameName(p.name);
    }

    function confirmAdd(): void {
        if (!chosen || !gameName.trim()) return;
        addCustomGame(gameName, chosen.path);
        setPicking(false);
        setChosen(null);
    }

    const lastPlayed = (ts: number): string => {
        if (!ts) return t("richPresence.neverPlayed");
        const days = Math.round((ts - Date.now()) / 86_400_000);
        const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
        let when: string;
        if (Math.abs(days) >= 30)
            when = rtf.format(Math.round(days / 30), "month");
        else if (Math.abs(days) >= 1) when = rtf.format(days, "day");
        else
            when = rtf.format(
                Math.round((ts - Date.now()) / 3_600_000),
                "hour",
            );
        return t("richPresence.lastPlayed", { when });
    };

    return (
        <>
            {(desktop || hasPlugins) && (
                <View>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                        {t("richPresence.heading")}
                    </Text>
                    {!desktop && publishError ? (
                        <Text className="text-xs text-discord-danger mb-2">
                            {t("richPresence.publishFailed")} {publishError}
                        </Text>
                    ) : null}
                    {desktop && (
                        <>
                            <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                                <View className="flex-1 min-w-0">
                                    <Text className="text-sm text-discord-textPrimary">
                                        {t("richPresence.share")}
                                    </Text>
                                    <Text className="text-xs text-discord-textMuted">
                                        {t("richPresence.shareHint")}
                                    </Text>
                                    {richPresenceEnabled &&
                                        status?.msc4544.listening && (
                                            <Text className="text-xs text-discord-textMuted">
                                                {t("richPresence.listening", {
                                                    port: String(
                                                        status.msc4544.port,
                                                    ),
                                                })}
                                            </Text>
                                        )}
                                    {richPresenceEnabled &&
                                    status?.msc4544.socket ? (
                                        <Text className="text-xs text-discord-textMuted break-all">
                                            {t("richPresence.socket", {
                                                path: status.msc4544.socket,
                                            })}
                                        </Text>
                                    ) : null}
                                    {richPresenceEnabled &&
                                    status?.msc4544.error ? (
                                        <Text className="text-xs text-discord-danger">
                                            {t("richPresence.listenFailed", {
                                                error: status.msc4544.error,
                                            })}
                                        </Text>
                                    ) : null}
                                    {publishError ? (
                                        <Text className="text-xs text-discord-danger">
                                            {t("richPresence.publishFailed")}{" "}
                                            {publishError}
                                        </Text>
                                    ) : null}
                                </View>
                                <ToggleSwitch
                                    checked={richPresenceEnabled}
                                    onChange={onToggleShare}
                                    label={t("richPresence.share")}
                                />
                            </View>
                            <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                                <View className="flex-1 min-w-0">
                                    <Text className="text-sm text-discord-textPrimary">
                                        {t("richPresence.arrpc")}
                                    </Text>
                                    <Text className="text-xs text-discord-textMuted">
                                        {t("richPresence.arrpcHint")}
                                    </Text>
                                    {!richPresenceEnabled && (
                                        <Text className="text-xs text-discord-textMuted">
                                            {t("richPresence.arrpcNeedsShare")}
                                        </Text>
                                    )}
                                    {discordFirst && (
                                        <>
                                            <Text className="text-xs text-discord-textMuted">
                                                {t("richPresence.discordFirst")}
                                            </Text>
                                            {status?.arrpc.canRestartDiscord ? (
                                                <Pressable
                                                    accessibilityRole="button"
                                                    className="mt-1 self-start rounded bg-discord-backgroundSecondary px-2 py-1 hover:bg-discord-backgroundSecondaryAlt disabled:opacity-50"
                                                    disabled={restarting}
                                                    onPress={() =>
                                                        setConfirmingRestart(
                                                            true,
                                                        )
                                                    }
                                                >
                                                    <Text className="text-xs text-discord-textPrimary">
                                                        {t(
                                                            "richPresence.restartDiscord",
                                                        )}
                                                    </Text>
                                                </Pressable>
                                            ) : status?.arrpc
                                                  .needsPermission ? (
                                                <>
                                                    <Text className="text-xs text-discord-textMuted">
                                                        {t(
                                                            "richPresence.hostNeedsPermission",
                                                        )}
                                                    </Text>
                                                    <Text
                                                        selectable
                                                        className="mt-1 break-all rounded bg-discord-backgroundTertiary p-2 font-mono text-xs text-discord-textPrimary"
                                                    >
                                                        {t(
                                                            "richPresence.scanGrantCommand",
                                                        )}
                                                    </Text>
                                                </>
                                            ) : null}
                                        </>
                                    )}
                                    {restartError !== null && (
                                        <Text className="text-xs text-discord-danger">
                                            {t(
                                                "richPresence.restartDiscordFailed",
                                                {
                                                    error: restartError,
                                                },
                                            )}
                                        </Text>
                                    )}
                                    {richPresenceEnabled &&
                                    richPresenceArrpc &&
                                    status?.arrpc.error ? (
                                        <Text className="text-xs text-discord-danger">
                                            {t("richPresence.arrpcFailed", {
                                                error: status.arrpc.error,
                                            })}
                                        </Text>
                                    ) : null}
                                </View>
                                <ToggleSwitch
                                    checked={richPresenceArrpc}
                                    onChange={onToggleArrpc}
                                    label={t("richPresence.arrpc")}
                                />
                            </View>

                            {richPresenceEnabled &&
                                richPresenceArrpc &&
                                status?.arrpc.canRestartDiscord && (
                                    <View className="flex-row items-center gap-3 py-2 ps-4 border-b border-discord-divider">
                                        <View className="flex-1 min-w-0">
                                            <Text className="text-sm text-discord-textPrimary">
                                                {t("richPresence.autoRestart")}
                                            </Text>
                                            <Text className="text-xs text-discord-textMuted">
                                                {t(
                                                    "richPresence.autoRestartHint",
                                                )}
                                            </Text>
                                        </View>
                                        <ToggleSwitch
                                            checked={
                                                richPresenceAutoRestartDiscord
                                            }
                                            onChange={onToggleAutoRestart}
                                            label={t(
                                                "richPresence.autoRestart",
                                            )}
                                        />
                                    </View>
                                )}

                            {richPresenceEnabled &&
                                richPresenceArrpc &&
                                status?.fake?.supported && (
                                    <View className="flex-row items-center gap-3 py-2 ps-4 border-b border-discord-divider">
                                        <View className="flex-1 min-w-0">
                                            <Text className="text-sm text-discord-textPrimary">
                                                {t("richPresence.fake")}
                                            </Text>
                                            <Text className="text-xs text-discord-textMuted">
                                                {t("richPresence.fakeHint")}
                                            </Text>
                                            {status.fake.needsPermission && (
                                                <>
                                                    <Text className="text-xs text-discord-textMuted">
                                                        {t(
                                                            "richPresence.hostNeedsPermission",
                                                        )}
                                                    </Text>
                                                    <Text
                                                        selectable
                                                        className="mt-1 break-all rounded bg-discord-backgroundTertiary p-2 font-mono text-xs text-discord-textPrimary"
                                                    >
                                                        {t(
                                                            "richPresence.scanGrantCommand",
                                                        )}
                                                    </Text>
                                                </>
                                            )}
                                            {richPresenceFakeDiscord &&
                                            status.fake.error ? (
                                                <Text className="text-xs text-discord-danger">
                                                    {t(
                                                        "richPresence.fakeFailed",
                                                        {
                                                            error: status.fake
                                                                .error,
                                                        },
                                                    )}
                                                </Text>
                                            ) : null}
                                        </View>
                                        <ToggleSwitch
                                            checked={richPresenceFakeDiscord}
                                            onChange={onToggleFake}
                                            label={t("richPresence.fake")}
                                        />
                                    </View>
                                )}

                            <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                                <View className="flex-1 min-w-0">
                                    <Text className="text-sm text-discord-textPrimary">
                                        {t("richPresence.scan")}
                                    </Text>
                                    <Text className="text-xs text-discord-textMuted">
                                        {t("richPresence.scanHint")}
                                    </Text>
                                    {richPresenceEnabled &&
                                    richPresenceScan &&
                                    status?.scan.needsPermission ? (
                                        <>
                                            <Text className="text-xs text-discord-textMuted">
                                                {t(
                                                    "richPresence.scanNeedsPermission",
                                                )}
                                            </Text>
                                            <Text
                                                selectable
                                                className="mt-1 break-all rounded bg-discord-backgroundTertiary p-2 font-mono text-xs text-discord-textPrimary"
                                            >
                                                {t(
                                                    "richPresence.scanGrantCommand",
                                                )}
                                            </Text>
                                        </>
                                    ) : !richPresenceEnabled ? (
                                        <Text className="text-xs text-discord-textMuted">
                                            {t("richPresence.arrpcNeedsShare")}
                                        </Text>
                                    ) : null}
                                    {richPresenceEnabled &&
                                    richPresenceScan &&
                                    status?.scan.error ? (
                                        <Text className="text-xs text-discord-danger">
                                            {t("richPresence.scanFailed", {
                                                error: status.scan.error,
                                            })}
                                        </Text>
                                    ) : null}
                                    {richPresenceEnabled &&
                                        (richPresenceScan ||
                                            richPresenceArrpc) &&
                                        status?.games && (
                                            <>
                                                {status.games.downloading ? (
                                                    <Text className="text-xs text-discord-textMuted">
                                                        {t(
                                                            "richPresence.gameListDownloading",
                                                        )}
                                                    </Text>
                                                ) : status.games.updated !==
                                                  null ? (
                                                    <Text className="text-xs text-discord-textMuted">
                                                        {t(
                                                            "richPresence.gameList",
                                                            {
                                                                count: String(
                                                                    status.games
                                                                        .count,
                                                                ),
                                                                when: new Date(
                                                                    status.games
                                                                        .updated,
                                                                ).toLocaleDateString(),
                                                            },
                                                        )}
                                                    </Text>
                                                ) : null}
                                                {status.games.error ? (
                                                    <Text className="text-xs text-discord-danger">
                                                        {t(
                                                            "richPresence.gameListFailed",
                                                            {
                                                                error: status
                                                                    .games
                                                                    .error,
                                                            },
                                                        )}
                                                    </Text>
                                                ) : null}
                                            </>
                                        )}
                                </View>
                                <ToggleSwitch
                                    checked={richPresenceScan}
                                    onChange={onToggleScan}
                                    label={t("richPresence.scan")}
                                />
                            </View>

                            {steamVisible && (
                                <View
                                    className={`flex-row items-center gap-3 py-2 border-b border-discord-divider ${
                                        steamBusy
                                            ? "opacity-50 pointer-events-none"
                                            : ""
                                    }`}
                                    accessibilityState={{ busy: steamBusy }}
                                >
                                    <View className="flex-1 min-w-0">
                                        <Text className="text-sm text-discord-textPrimary">
                                            {t("richPresence.steam")}
                                        </Text>
                                        <Text className="text-xs text-discord-textMuted">
                                            {t("richPresence.steamHint")}
                                        </Text>
                                        {!richPresenceEnabled && (
                                            <Text className="text-xs text-discord-textMuted">
                                                {t(
                                                    "richPresence.arrpcNeedsShare",
                                                )}
                                            </Text>
                                        )}
                                        {status?.steam?.needsPermission && (
                                            <>
                                                <Text className="text-xs text-discord-textMuted">
                                                    {t(
                                                        "richPresence.hostNeedsPermission",
                                                    )}
                                                </Text>
                                                <Text
                                                    selectable
                                                    className="mt-1 break-all rounded bg-discord-backgroundTertiary p-2 font-mono text-xs text-discord-textPrimary"
                                                >
                                                    {t(
                                                        "richPresence.scanGrantCommand",
                                                    )}
                                                </Text>
                                            </>
                                        )}
                                        {steamEnableError !== null && (
                                            <Text className="text-xs text-discord-danger">
                                                {steamEnableError}
                                            </Text>
                                        )}
                                        {steamFlagLeft && steamDisable && (
                                            <Text className="text-xs text-discord-danger">
                                                {steamDisable.cancelled
                                                    ? t(
                                                          "richPresence.steamUacCancelled",
                                                      )
                                                    : t(
                                                          "richPresence.steamDisableFailed",
                                                          {
                                                              error:
                                                                  steamDisable.error ??
                                                                  "",
                                                          },
                                                      )}
                                            </Text>
                                        )}
                                        {richPresenceEnabled &&
                                        richPresenceSteam &&
                                        status?.steam?.error ? (
                                            <Text className="text-xs text-discord-danger">
                                                {t("richPresence.steamFailed", {
                                                    error: status.steam.error,
                                                })}
                                            </Text>
                                        ) : null}
                                        {richPresenceEnabled &&
                                            richPresenceSteam &&
                                            status?.steam?.connected && (
                                                <Text className="text-xs text-discord-textMuted">
                                                    {t(
                                                        "richPresence.steamConnected",
                                                    )}
                                                </Text>
                                            )}
                                        {richPresenceSteam &&
                                            status?.steam &&
                                            !status.steam.portOpen &&
                                            (status.steam.steamRunning ? (
                                                <>
                                                    <Text className="text-xs text-discord-textMuted">
                                                        {t(
                                                            "richPresence.steamNeedsRestart",
                                                        )}
                                                    </Text>
                                                    <Pressable
                                                        accessibilityRole="button"
                                                        accessibilityState={{
                                                            disabled:
                                                                steamRestarting,
                                                        }}
                                                        className={`mt-1 self-start rounded bg-discord-backgroundSecondary px-2 py-1 hover:bg-discord-backgroundSecondaryAlt ${
                                                            steamRestarting
                                                                ? "opacity-50"
                                                                : ""
                                                        }`}
                                                        disabled={
                                                            steamRestarting
                                                        }
                                                        onPress={() =>
                                                            setConfirmingSteamRestart(
                                                                true,
                                                            )
                                                        }
                                                    >
                                                        <Text className="text-xs text-discord-textPrimary">
                                                            {t(
                                                                "richPresence.restartSteam",
                                                            )}
                                                        </Text>
                                                    </Pressable>
                                                </>
                                            ) : (
                                                <Text className="text-xs text-discord-textMuted">
                                                    {t(
                                                        "richPresence.steamNotRunning",
                                                    )}
                                                </Text>
                                            ))}
                                        {steamRestartError !== null && (
                                            <Text className="text-xs text-discord-danger">
                                                {t(
                                                    "richPresence.restartSteamFailed",
                                                    {
                                                        error: steamRestartError,
                                                    },
                                                )}
                                            </Text>
                                        )}
                                    </View>
                                    <ToggleSwitch
                                        checked={richPresenceSteam}
                                        onChange={(next) =>
                                            void onToggleSteam(next)
                                        }
                                        label={t("richPresence.steam")}
                                    />
                                </View>
                            )}

                            <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                                <View className="flex-1 min-w-0">
                                    <Text className="text-sm text-discord-textPrimary">
                                        {t("richPresence.media")}
                                    </Text>
                                    <Text className="text-xs text-discord-textMuted">
                                        {t("richPresence.mediaHint")}
                                    </Text>
                                    {!richPresenceEnabled && (
                                        <Text className="text-xs text-discord-textMuted">
                                            {t("richPresence.arrpcNeedsShare")}
                                        </Text>
                                    )}
                                    {richPresenceEnabled &&
                                    richPresenceMedia &&
                                    status?.media?.error ? (
                                        <Text className="text-xs text-discord-danger">
                                            {t("richPresence.mediaFailed", {
                                                error: status.media.error,
                                            })}
                                        </Text>
                                    ) : null}
                                </View>
                                <ToggleSwitch
                                    checked={richPresenceMedia}
                                    onChange={onToggleMedia}
                                    label={t("richPresence.media")}
                                />
                            </View>
                        </>
                    )}
                    {desktop && (
                        <>
                            <Text className="text-sm text-discord-textPrimary mt-4 mb-1">
                                {t("richPresence.addedGames")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted mb-2">
                                {t("richPresence.addedGamesHint")}
                            </Text>
                        </>
                    )}
                    {apps.length === 0 ? (
                        <Text className="text-xs text-discord-textMuted">
                            {t("richPresence.noApps")}
                        </Text>
                    ) : (
                        <View accessibilityRole="list">
                            {apps.map(([key, app]) => {
                                const added = games.find(
                                    (g) => `arrpc:${g.id}` === key,
                                );
                                return (
                                    <View
                                        key={key}
                                        className="flex-row items-center gap-3 py-2 border-b border-discord-divider"
                                    >
                                        <View className="flex-1 min-w-0">
                                            <Text
                                                numberOfLines={1}
                                                className="text-sm text-discord-textPrimary truncate"
                                            >
                                                {app.name}
                                            </Text>
                                            {added ? (
                                                <Text
                                                    numberOfLines={1}
                                                    className="text-xs text-discord-textMuted truncate"
                                                >
                                                    {added.exe}
                                                </Text>
                                            ) : (
                                                <Text className="text-xs text-discord-textMuted">
                                                    {app.source === "plugin"
                                                        ? t(
                                                              "richPresence.viaPlugin",
                                                          )
                                                        : app.source !== "arrpc"
                                                          ? t(
                                                                "richPresence.viaMatrix",
                                                            )
                                                          : app.viaMedia
                                                            ? t(
                                                                  "richPresence.viaMedia",
                                                              )
                                                            : app.viaScan ||
                                                                app.viaRpc ||
                                                                app.viaSteam
                                                              ? [
                                                                    app.viaRpc &&
                                                                        t(
                                                                            "richPresence.viaRpc",
                                                                        ),
                                                                    app.viaScan &&
                                                                        t(
                                                                            "richPresence.viaScan",
                                                                        ),
                                                                    app.viaSteam &&
                                                                        t(
                                                                            "richPresence.viaSteam",
                                                                        ),
                                                                ]
                                                                    .filter(
                                                                        Boolean,
                                                                    )
                                                                    .join(" + ")
                                                              : t(
                                                                    "richPresence.viaDiscord",
                                                                )}{" "}
                                                    · {lastPlayed(app.lastSeen)}
                                                </Text>
                                            )}
                                        </View>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={t(
                                                "richPresence.forgetApp",
                                                {
                                                    name: app.name,
                                                },
                                            )}
                                            onPress={() =>
                                                added
                                                    ? removeCustomGame(added.id)
                                                    : forgetApp(key)
                                            }
                                        >
                                            <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                                {added
                                                    ? t("common.remove")
                                                    : t("richPresence.forget")}
                                            </Text>
                                        </Pressable>
                                        <ToggleSwitch
                                            checked={app.allowed}
                                            onChange={(next) =>
                                                setAppAllowed(key, next)
                                            }
                                            label={t("richPresence.allowApp", {
                                                name: app.name,
                                            })}
                                        />
                                    </View>
                                );
                            })}
                        </View>
                    )}
                    {picking ? (
                        <View className="mt-2 rounded bg-discord-backgroundTertiary p-3 gap-2">
                            {chosen ? (
                                <>
                                    <Text className="text-xs text-discord-textMuted break-all">
                                        {chosen.path}
                                    </Text>
                                    <View>
                                        <Text className="text-xs text-discord-textMuted">
                                            {t("richPresence.gameName")}
                                        </Text>
                                        <TextInput
                                            maxLength={64}
                                            value={gameName}
                                            onChangeText={setGameName}
                                            accessibilityLabel={t(
                                                "richPresence.gameName",
                                            )}
                                            className="mt-1 w-full rounded bg-discord-background px-2 py-1.5 text-sm text-discord-textPrimary"
                                        />
                                    </View>
                                    <View className="flex-row gap-2">
                                        <Pressable
                                            accessibilityRole="button"
                                            className="px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover disabled:opacity-50"
                                            disabled={!gameName.trim()}
                                            onPress={confirmAdd}
                                        >
                                            <Text className="text-white text-sm font-semibold">
                                                {t("common.add")}
                                            </Text>
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            className="px-3 py-1.5 rounded"
                                            onPress={() => setChosen(null)}
                                        >
                                            <Text className="text-sm text-discord-textMuted hover:text-discord-textPrimary">
                                                {t("common.cancel")}
                                            </Text>
                                        </Pressable>
                                    </View>
                                </>
                            ) : (
                                <>
                                    <View className="flex-row items-center gap-2">
                                        <TextInput
                                            value={query}
                                            onChangeText={setQuery}
                                            placeholder={t(
                                                "richPresence.searchPrograms",
                                            )}
                                            placeholderTextColorClassName="accent-discord-textMuted"
                                            accessibilityLabel={t(
                                                "richPresence.searchPrograms",
                                            )}
                                            returnKeyType="search"
                                            clearButtonMode="while-editing"
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            className="flex-1 min-w-0 rounded bg-discord-background px-2 py-1.5 text-sm text-discord-textPrimary"
                                        />
                                        <Pressable
                                            accessibilityRole="button"
                                            disabled={loadingPrograms}
                                            onPress={loadPrograms}
                                        >
                                            <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                                {t(
                                                    "richPresence.refreshPrograms",
                                                )}
                                            </Text>
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() => setPicking(false)}
                                        >
                                            <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                                {t("common.cancel")}
                                            </Text>
                                        </Pressable>
                                    </View>
                                    {shownPrograms.length === 0 ? (
                                        <Text className="text-xs text-discord-textMuted">
                                            {loadingPrograms
                                                ? t("common.loading")
                                                : t("richPresence.noPrograms")}
                                        </Text>
                                    ) : (
                                        <ScrollView
                                            nestedScrollEnabled
                                            keyboardShouldPersistTaps="handled"
                                            className="max-h-56 grow-0"
                                        >
                                            {shownPrograms.map((p) => (
                                                <Pressable
                                                    key={p.path}
                                                    accessibilityRole="button"
                                                    className="w-full rounded px-2 py-1 hover:bg-discord-messageHover"
                                                    onPress={() => choose(p)}
                                                >
                                                    <Text
                                                        numberOfLines={1}
                                                        className="text-sm text-discord-textPrimary truncate"
                                                    >
                                                        {p.name}
                                                    </Text>
                                                    <Text
                                                        numberOfLines={1}
                                                        className="text-xs text-discord-textMuted truncate"
                                                    >
                                                        {p.path}
                                                    </Text>
                                                </Pressable>
                                            ))}
                                        </ScrollView>
                                    )}
                                </>
                            )}
                        </View>
                    ) : desktop ? (
                        <Pressable
                            accessibilityRole="button"
                            className="mt-2 self-start px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover"
                            onPress={startPicking}
                        >
                            <Text className="text-sm font-semibold text-discord-textPrimary">
                                {t("richPresence.addGame")}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            )}

            {confirmingRestart && (
                <ModalDialog
                    onClose={() => setConfirmingRestart(false)}
                    labelledBy="restart-discord-title"
                    panelClass="relative w-full max-w-sm rounded-lg bg-discord-backgroundSecondary p-4 shadow-xl"
                >
                    <Text
                        nativeID="restart-discord-title"
                        accessibilityRole="header"
                        className="mb-2 text-base font-semibold text-discord-textPrimary"
                    >
                        {t("richPresence.restartDiscordTitle")}
                    </Text>
                    <Text className="mb-3 text-sm text-discord-textSecondary">
                        {t("richPresence.restartDiscordBody")}
                    </Text>
                    <View className="flex-row justify-end gap-2">
                        <Pressable
                            accessibilityRole="button"
                            className="px-3 py-1"
                            onPress={() => setConfirmingRestart(false)}
                        >
                            <Text className="text-sm text-discord-textMuted hover:text-discord-textPrimary">
                                {t("common.cancel")}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            className="rounded bg-discord-accent px-3 py-1"
                            onPress={restartDiscord}
                        >
                            <Text className="text-sm text-white">
                                {t("richPresence.restartDiscord")}
                            </Text>
                        </Pressable>
                    </View>
                </ModalDialog>
            )}

            {confirmingSteamRestart && (
                <ModalDialog
                    onClose={() => setConfirmingSteamRestart(false)}
                    labelledBy="restart-steam-title"
                    panelClass="relative w-full max-w-sm rounded-lg bg-discord-backgroundSecondary p-4 shadow-xl"
                >
                    <Text
                        nativeID="restart-steam-title"
                        accessibilityRole="header"
                        className="mb-2 text-base font-semibold text-discord-textPrimary"
                    >
                        {t("richPresence.restartSteamTitle")}
                    </Text>
                    <Text className="mb-3 text-sm text-discord-textSecondary">
                        {t("richPresence.restartSteamBody")}
                    </Text>
                    <View className="flex-row justify-end gap-2">
                        <Pressable
                            accessibilityRole="button"
                            className="px-3 py-1"
                            onPress={() => setConfirmingSteamRestart(false)}
                        >
                            <Text className="text-sm text-discord-textMuted hover:text-discord-textPrimary">
                                {t("common.cancel")}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            className="rounded bg-discord-accent px-3 py-1"
                            onPress={restartSteam}
                        >
                            <Text className="text-sm text-white">
                                {t("richPresence.restartSteam")}
                            </Text>
                        </Pressable>
                    </View>
                </ModalDialog>
            )}
        </>
    );
}
