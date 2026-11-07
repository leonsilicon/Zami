import { openLink } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { ChevronDown, ChevronRight } from "lucide-svelte";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import {
    APP_VERSION,
    CAN_INSTALL_UPDATE,
    checkForUpdate,
    openReleasePage,
    reloadToLatest,
    type UpdateInfo,
} from "$lib/update";
import { DOWNLOAD_URL, GITHUB_URL, WEBSITE_URL } from "$lib/links";
import { clearCacheAndReload } from "$lib/matrix/client";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import WhatsNew from "./WhatsNew.svelte";
import {
    updateStatusView,
    type UpdateStatusInput,
    type UpdateStatusView,
} from "$lib/utils/updateStatus";
import {
    isDesktopUpdater,
    desktopCheck,
    desktopDownload,
    desktopRestartToInstall,
    desktopSetAutoDownload,
    onDesktopUpdateStatus,
} from "$lib/desktopUpdater";
import { pickApkAsset, versionCodeFromSemver } from "$lib/utils/androidUpdate";
import {
    isAndroidUpdater,
    downloadApk,
    apkDownloadInFlight,
    installApk,
    canInstall,
    openUnknownSourcesSettings,
} from "$lib/androidUpdater";
import {
    settingsState,
    setAutoUpdateEnabled,
} from "$lib/stores/settings.svelte";
import {
    androidBundleStep,
    updateBannerState,
} from "$lib/stores/updateBanner.svelte";
import { webBundleApply, webBundleSetAuto } from "$lib/androidWebBundle";

// Zami: <details>/<summary> → a pressable summary, with the browser's disclosure
// marker, that shows or hides the body (as in WhatsNew's translation).
function Details({
    summary,
    children,
}: {
    summary: ReactNode;
    children?: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const Marker = open ? ChevronDown : ChevronRight;
    return (
        <View>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => setOpen(!open)}
                className="flex-row items-center gap-1"
            >
                <Marker size={14} className="text-discord-textMuted" />
                {summary}
            </Pressable>
            <View className={open ? undefined : "hidden"}>{children}</View>
        </View>
    );
}

// Zami: links (`<a target="_blank">`) open with the system, through openLink.
export default function AboutSettings() {
    const [checking, setChecking] = useState(false);
    const [info, setInfoState] = useState<UpdateInfo | null>(null);
    // Zami: androidCheck sets `info` and androidDownload reads it in the same
    // async flow, which a `$state` allows; the ref holds the latest value for
    // reads that outlive a render.
    const infoRef = useRef(info);
    function setInfo(next: UpdateInfo | null) {
        infoRef.current = next;
        setInfoState(next);
    }
    const [error, setError] = useState("");
    const [reloading, setReloading] = useState(false);
    const [clearingCache, setClearingCache] = useState(false);

    const autoUpdateEnabled = useRune(() => settingsState.autoUpdateEnabled);

    // Packaged-desktop auto-updater. The main process streams status objects
    // WITHOUT `autoEnabled`, so the view model merges the device toggle in on
    // every render below. On web/Android `isDesktopUpdater()` is false, the
    // onMount below never subscribes, and none of this renders.
    const [desktopStatus, setDesktopStatus] = useState<UpdateStatusInput>(
        () => ({
            phase: "idle",
            autoEnabled: settingsState.autoUpdateEnabled,
        }),
    );
    const view = updateStatusView({
        ...desktopStatus,
        autoEnabled: autoUpdateEnabled,
    });

    // Android updater: unlike desktop (pushed from the main process), the
    // renderer drives this state machine itself. `info` (shared with the web
    // path) holds the checked release incl. its downloadable `assets`.
    const [androidStatus, setAndroidStatus] = useState<UpdateStatusInput>(
        () => ({
            phase: "idle",
            autoEnabled: settingsState.autoUpdateEnabled,
        }),
    );
    const [androidApkPath, setAndroidApkPath] = useState<string | null>(null);
    // A web-bundle update (no new APK) lives in the app-wide update state, which
    // also carries its download progress; everything else is this tab's own APK
    // state machine above.
    const bannerStatus = useRune(() => updateBannerState.status);
    const androidBundle = bannerStatus.kind === "bundle";
    const androidView = updateStatusView({
        ...(androidBundle ? bannerStatus : androidStatus),
        platform: "android",
        autoEnabled: autoUpdateEnabled,
    });

    useEffect(() => {
        if (isAndroidUpdater()) {
            // Refresh the passive About surface with real status on open,
            // mirroring the desktop branch; androidCheck auto-downloads when
            // the toggle is on. No subscription to tear down.
            void androidCheck();
            return;
        }
        if (!isDesktopUpdater()) return;
        // ONE-TIME wiring (not a reactive $effect): seed the main process with
        // the current toggle, kick a check so opening About refreshes the
        // passive surface to real status (it dropped the background launch
        // check's events while unsubscribed), then subscribe. The callback only
        // assigns `desktopStatus` (which this body never reads), so there is no
        // reactive loop; the returned unsub is the cleanup.
        desktopSetAutoDownload(settingsState.autoUpdateEnabled);
        desktopCheck();
        // Merge, don't replace: the main process omits `version` on the
        // `downloading` event, so carrying the prior status forward keeps the
        // target version visible through the whole flow (matches the banner).
        const unsub = onDesktopUpdateStatus((s) =>
            setDesktopStatus((prev) => ({ ...prev, ...s })),
        );
        return unsub;
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as onMount.
    }, []);

    function releaseUrl(): string {
        return info?.url ?? "https://github.com/az4521/Zam/releases/latest";
    }

    function runDesktopAction(): void {
        switch (view.action) {
            case "check":
                desktopCheck();
                break;
            case "download":
                desktopDownload();
                break;
            case "restart":
                desktopRestartToInstall();
                break;
            case "open-release":
                openReleasePage(releaseUrl());
                break;
        }
    }

    async function androidCheck(manual = false): Promise<void> {
        setAndroidStatus((s) => ({ ...s, phase: "checking", kind: "shell" }));
        try {
            // A release that only changes the web UI updates as a bundle; the
            // APK flow below must not also offer it.
            if (await androidBundleStep(manual ? "offer" : "auto")) return;
            const result = await checkForUpdate();
            setInfo(result);
            if (!result.updateAvailable) {
                setAndroidStatus((s) => ({
                    ...s,
                    phase: "up-to-date",
                    version: result.latest,
                }));
                return;
            }
            setAndroidStatus((s) => ({
                ...s,
                phase: "available",
                version: result.latest,
            }));
            // Auto-download only on a background (app-open) check when the
            // toggle is on — a manual "Check for updates" tap stays confirm-
            // gated: it just shows the "Download" choice. (Android still ends in
            // a manual Install tap; it can't self-install a sideloaded APK.)
            if (!manual && settingsState.autoUpdateEnabled) {
                await androidDownload();
            }
        } catch (checkError) {
            setAndroidStatus((s) => ({
                ...s,
                phase: "error",
                message:
                    (checkError as Error)?.message ??
                    t("aboutSettings.updateCheckFailed"),
            }));
        }
    }

    async function androidDownload(): Promise<void> {
        const info = infoRef.current;
        const url = info ? pickApkAsset(info.assets ?? []) : null;
        if (!url) {
            // No .apk attached to the release → fall back to the release page.
            setAndroidStatus((s) => ({ ...s, phase: "unsupported" }));
            return;
        }
        setAndroidStatus((s) => ({
            ...s,
            phase: "downloading",
            percent: apkDownloadInFlight() ?? 0,
        }));
        try {
            // Floor = the version the user was shown, so native also refuses a
            // rolled-back-but-still-signed archive.
            const minVersionCode = versionCodeFromSemver(info?.latest ?? "");
            const path = await downloadApk(url, minVersionCode, (percent) => {
                setAndroidStatus((s) => ({
                    ...s,
                    phase: "downloading",
                    percent,
                }));
            });
            setAndroidApkPath(path);
            setAndroidStatus((s) => ({ ...s, phase: "downloaded" }));
        } catch (downloadError) {
            setAndroidStatus((s) => ({
                ...s,
                phase: "error",
                message:
                    (downloadError as Error)?.message ??
                    t("aboutSettings.downloadFailed"),
            }));
        }
    }

    async function androidInstall(): Promise<void> {
        if (!androidApkPath) return;
        try {
            const granted = await canInstall();
            if (!granted) {
                // Route to the OS "install unknown apps" screen; the user
                // grants, returns, and taps Install again.
                await openUnknownSourcesSettings();
                return;
            }
            // No path argument: native installs its own private download, so a
            // compromised renderer cannot steer what gets installed.
            await installApk();
        } catch (installError) {
            setAndroidStatus((s) => ({
                ...s,
                phase: "error",
                message:
                    (installError as Error)?.message ??
                    t("aboutSettings.installFailed"),
            }));
        }
    }

    function runAndroidAction(): void {
        switch (androidView.action) {
            case "check":
                void androidCheck(true);
                break;
            case "download":
                if (androidBundle) void androidBundleStep("download");
                else void androidDownload();
                break;
            case "restart":
                // Only offered for a downloaded web bundle.
                void webBundleApply().catch(() => {});
                break;
            case "install":
                void androidInstall();
                break;
            case "open-release":
                openReleasePage(releaseUrl());
                break;
        }
    }

    function onToggleAuto(next: boolean): void {
        // The toggle governs only whether a BACKGROUND check auto-downloads;
        // it never kicks off a download for an already-found update. A pending
        // "available" keeps its explicit "Download & install" choice, so
        // flipping this setting never starts an unconfirmed download.
        setAutoUpdateEnabled(next);
        desktopSetAutoDownload(next);
        webBundleSetAuto(next);
    }

    function clearCache() {
        setClearingCache(true);
        void clearCacheAndReload();
    }

    async function check() {
        setChecking(true);
        setError("");
        setInfo(null);
        try {
            setInfo(await checkForUpdate());
        } catch (checkError) {
            setError(
                (checkError as Error)?.message ??
                    t("aboutSettings.failedToCheckForUpdates"),
            );
        } finally {
            setChecking(false);
        }
    }

    async function apply(update: UpdateInfo) {
        if (CAN_INSTALL_UPDATE) {
            openReleasePage(update.url);
            return;
        }
        setReloading(true);
        try {
            await reloadToLatest();
        } catch {
            setReloading(false);
        }
    }

    function actionButton(v: UpdateStatusView, run: () => void) {
        return v.action !== "none" ? (
            <Pressable
                accessibilityRole="button"
                onPress={run}
                disabled={v.busy}
                accessibilityState={{ disabled: v.busy }}
                className="px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors disabled:opacity-50 flex-shrink-0"
            >
                <Text className="text-sm font-medium text-discord-textPrimary">
                    {v.actionLabel}
                </Text>
            </Pressable>
        ) : null;
    }

    function updaterStatus(v: UpdateStatusView, autoDesc: string) {
        return (
            <>
                <View className="py-2 border-b border-discord-divider gap-2">
                    <Text className="text-sm text-discord-textMuted">
                        {v.label}
                    </Text>
                    {v.percent !== null ? (
                        <View className="h-1.5 w-full overflow-hidden rounded-full bg-discord-backgroundTertiary">
                            <View
                                className="h-full rounded-full bg-discord-accent transition-all"
                                style={{ width: `${v.percent}%` }}
                            />
                        </View>
                    ) : null}
                </View>
                <View className="flex-row items-center gap-3 py-2">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("aboutSettings.automaticUpdates")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {autoDesc}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={autoUpdateEnabled}
                        onChange={onToggleAuto}
                        label={t("aboutSettings.automaticUpdates")}
                    />
                </View>
            </>
        );
    }

    return (
        <View className="gap-6">
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                    {t("aboutSettings.version")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            Zam
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("aboutSettings.currentVersionV", {
                                APP_VERSION,
                            })}
                        </Text>
                        <View className="flex-row flex-wrap gap-x-3 gap-y-1">
                            <Text
                                accessibilityRole="link"
                                onPress={() => openLink(GITHUB_URL)}
                                className="text-xs text-discord-accent hover:underline"
                            >
                                {t("aboutSettings.sourceCodeOnGitHub")}
                            </Text>
                            {!CAN_INSTALL_UPDATE && (
                                <>
                                    <Text
                                        accessibilityRole="link"
                                        onPress={() => openLink(WEBSITE_URL)}
                                        className="text-xs text-discord-accent hover:underline"
                                    >
                                        {t("links.website")}
                                    </Text>
                                    <Text
                                        accessibilityRole="link"
                                        onPress={() => openLink(DOWNLOAD_URL)}
                                        className="text-xs text-discord-accent hover:underline"
                                    >
                                        {t("links.downloadApps")}
                                    </Text>
                                </>
                            )}
                        </View>
                    </View>
                    {isDesktopUpdater() ? (
                        actionButton(view, runDesktopAction)
                    ) : isAndroidUpdater() ? (
                        actionButton(androidView, runAndroidAction)
                    ) : (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void check()}
                            disabled={checking}
                            accessibilityState={{ disabled: checking }}
                            className="px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors disabled:opacity-50 flex-shrink-0"
                        >
                            <Text className="text-sm font-medium text-discord-textPrimary">
                                {checking
                                    ? t("common.checking")
                                    : t("aboutSettings.checkForUpdates")}
                            </Text>
                        </Pressable>
                    )}
                </View>

                {isDesktopUpdater()
                    ? updaterStatus(
                          view,
                          "Download and install updates automatically.",
                      )
                    : isAndroidUpdater()
                      ? updaterStatus(
                            androidView,
                            "Download updates automatically. Installing still needs one tap.",
                        )
                      : null}
            </View>

            {!isDesktopUpdater() && !isAndroidUpdater() ? (
                error ? (
                    <Text className="text-sm text-discord-textMuted">
                        {error}
                    </Text>
                ) : info?.updateAvailable ? (
                    <View className="rounded-lg border border-discord-accent bg-discord-accent/10 p-4 flex-row items-center gap-4">
                        <View className="flex-1 min-w-0">
                            <Text className="text-sm font-semibold text-discord-textPrimary">
                                {t("aboutSettings.updateAvailable")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                v{info.current} → v{info.latest}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void apply(info)}
                            disabled={reloading}
                            accessibilityState={{ disabled: reloading }}
                            className="px-4 py-2 rounded bg-discord-accent hover:bg-discord-accentHover active:bg-discord-accentHover transition-colors flex-shrink-0 disabled:opacity-50"
                        >
                            <Text className="text-sm font-semibold text-white">
                                {reloading
                                    ? t("aboutSettings.reloading")
                                    : CAN_INSTALL_UPDATE
                                      ? t("aboutSettings.update")
                                      : t("aboutSettings.reloadToUpdate")}
                            </Text>
                        </Pressable>
                    </View>
                ) : info ? (
                    <Text className="text-sm text-discord-textMuted">
                        {t("aboutSettings.youReOnTheLatestVersion")}
                    </Text>
                ) : null
            ) : null}

            <WhatsNew />

            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                    {t("aboutSettings.troubleshooting")}
                </Text>
                <View className="flex-row items-center gap-3 py-2 border-b border-discord-divider">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("aboutSettings.clearCacheAndResync")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("aboutSettings.reDownloadsYourRoomsFromThe")}
                        </Text>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        onPress={clearCache}
                        disabled={clearingCache}
                        accessibilityState={{ disabled: clearingCache }}
                        className="px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                        <Text className="text-sm font-medium text-discord-textPrimary">
                            {clearingCache
                                ? t("aboutSettings.resyncing")
                                : t("aboutSettings.clearCache")}
                        </Text>
                    </Pressable>
                </View>
            </View>

            {/* Attribution for the bundled sound bank's sources. Collapsed: it's
                for the record, not something anyone needs to see day to day. */}
            <Details
                summary={
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide cursor-pointer select-none hover:text-discord-textPrimary">
                        {t("aboutSettings.credits")}
                    </Text>
                }
            >
                <View className="py-2 gap-1">
                    <Text className="text-sm text-discord-textPrimary">
                        {t("aboutSettings.creditsMidiInstruments")}:{" "}
                        <Text
                            accessibilityRole="link"
                            onPress={() =>
                                openLink(
                                    "https://musical-artifacts.com/artifacts/1481",
                                )
                            }
                            className="text-discord-accent hover:underline"
                        >
                            Phoenix MT-32
                        </Text>
                    </Text>
                    <Text className="text-xs text-discord-textMuted">
                        {t("aboutSettings.creditsSoundFont", {
                            author: "W.D. Tharinda Perera",
                            original: "Jexu",
                        })}
                    </Text>
                    <Text className="text-xs text-discord-textMuted">
                        {t("aboutSettings.creditsSoundFontGaps", {
                            microgm: "microgm",
                            microgmAuthor: "michael",
                            generalUser: "GeneralUser GS",
                            generalUserAuthor: "S. Christian Collins",
                        })}{" "}
                        <Text
                            accessibilityRole="link"
                            onPress={() =>
                                openLink(
                                    "https://github.com/mrbumpy409/GeneralUser-GS",
                                )
                            }
                            className="text-discord-accent hover:underline"
                        >
                            github.com/mrbumpy409/GeneralUser-GS
                        </Text>
                    </Text>
                </View>
            </Details>
        </View>
    );
}
