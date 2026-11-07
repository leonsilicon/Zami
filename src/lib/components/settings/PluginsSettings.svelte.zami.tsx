import { Select } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Directory } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import {
    installedPlugins,
    pluginRegistry,
    pluginRepos,
    pluginPrefs,
    pluginUpdates,
    pluginNeedsUpdate,
} from "$lib/stores/plugins.svelte";
import {
    enablePlugin,
    disablePlugin,
    addRepo,
    removeRepo,
    installRepoPlugin,
    uninstallRepoPlugin,
    loadLocalPlugin,
    reloadLocalPlugin,
    disableAllPlugins,
    pushPluginSync,
    getPullSummary,
    applyPull,
    applyUpdateCheck,
    updateRepoPlugin,
    setGlobalAutoUpdate,
    setPluginAutoUpdate,
} from "$lib/plugins/pluginBoot";
import {
    mergeRepoList,
    canAddRepo,
    sortInstalledPlugins,
} from "$lib/plugins/repoList";
import {
    normalizeRepoRef,
    rawUrl,
    parseIndex,
    repoKey,
    type PluginIndexEntry,
} from "$lib/plugins/repo";
import type { PullSummary, PluginSyncPayload } from "$lib/plugins/pluginSync";
import { filesFromDirectory } from "$lib/plugins/localPlugin";
import { canPickDirectory, pickDirectory } from "$lib/plugins/localHandles";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import {
    Settings,
    Trash2,
    RefreshCw,
    Power,
    TriangleAlert,
} from "lucide-svelte";
import PluginSettingsForm from "$lib/components/settings/PluginSettingsForm.svelte";
import {
    interfaceState,
    openSubPage,
    clearSubPageIfOwner,
} from "$lib/stores/interface.svelte";

/** Zami: localPlugin's SKIPPED_DIRS (not exported): folders never worth
 *  reading when a whole project directory is picked. */
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

/**
 * Zami: `<input webkitdirectory>` → expo-file-system's directory picker (a
 * document picker for folders on iOS). This is localPlugin's `filesFromList`
 * for the picked `Directory`: its files keyed by path relative to it, skipping
 * the same folders. An expo-file-system `File` is a `Blob`, which is all
 * `readLocalPlugin` reads (`text()`, `arrayBuffer()`).
 */
function filesFromPickedDirectory(dir: Directory): Map<string, Blob> {
    const out = new Map<string, Blob>();
    function walk(d: Directory, prefix: string) {
        for (const item of d.list()) {
            const rel = prefix + item.name;
            if (SKIPPED_DIRS.has(item.name)) continue;
            if (item instanceof Directory) walk(item, rel + "/");
            else out.set(rel, item);
        }
    }
    walk(dir, "");
    return out;
}

/** Zami: the directory picker rejects with this code when the user cancels
 *  (the File System Access picker's AbortError). */
function isPickCancelled(e: unknown): boolean {
    return (
        (e as { code?: string } | null)?.code === "ERR_FILE_PICKING_CANCELLED"
    );
}

/** Zami: `delete record[id]` on a `$state` record, as a new record. */
function without<T>(record: Record<string, T>, id: string): Record<string, T> {
    const next = { ...record };
    delete next[id];
    return next;
}

// Browse state per repo
type BrowseState = {
    loading: boolean;
    entries: PluginIndexEntry[];
    error: string | null;
};

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. Text classes sit on each Text, and each icon gets
// its button's text color. `title` tooltips have no equivalent and are dropped.
export default function PluginsSettings({
    navSignal = 0,
}: {
    navSignal?: number;
}) {
    // Installed list — reactively sorted, re-renders on tick
    const installedList = useRune(
        () => (
            void pluginRegistry.tick,
            sortInstalledPlugins(
                Object.values(installedPlugins).map((r) => ({
                    id: r.manifest.id,
                    name: r.manifest.name,
                    version: r.manifest.version,
                    author: r.manifest.author,
                    source: r.source,
                    enabled: r.enabled,
                    error: r.error,
                    repoRef: r.repoRef,
                    sha: r.sha,
                })),
            )
        ),
    );

    // Repos list — official first, user repos after
    const repoList = useRune(() => mergeRepoList(pluginRepos.refs));

    // Zami: the other store reads the markup makes, as snapshots that change
    // when an entry does.
    const updatesAvailable = useRune(() => ({ ...pluginUpdates.available }));
    const needsUpdate = useRune(() => ({ ...pluginNeedsUpdate }));
    const perPlugin = useRune(() => ({ ...pluginPrefs.perPlugin }));
    const autoUpdate = useRune(() => pluginPrefs.autoUpdate);
    const isMobile = useRune(() => interfaceState.isMobile);

    // Per-plugin busy state for enable/disable
    const [busy, setBusy] = useState<Record<string, boolean>>({});
    const setBusyFor = (id: string, value: boolean) =>
        setBusy((b) => ({ ...b, [id]: value }));

    // The plugin whose settings form is open in place (null = manager list).
    const [settingsForPluginId, setSettingsForPluginId] = useState<
        string | null
    >(null);

    // Stable identity: it is the sub-page ownership token, so it must not be
    // recreated per render. Resets local state only (it runs from the store's own
    // close/supersede paths, so reaching back into the store here is wrong).
    const closeSettingsForm = useCallback(() => {
        setSettingsForPluginId(null);
    }, []);

    // Sync sub-view state
    const [syncView, setSyncView] = useState(false);
    const [syncBusy, setSyncBusy] = useState(false);
    const [syncMessage, setSyncMessage] = useState("");
    const [syncError, setSyncError] = useState("");
    const [pullSummary, setPullSummary] = useState<PullSummary | null>(null);
    const [pullPayload, setPullPayload] = useState<PluginSyncPayload | null>(
        null,
    );

    function openSync() {
        setSyncView(true);
        setSyncMessage("");
        setSyncError("");
        setPullSummary(null);
        setPullPayload(null);
    }
    const closeSync = useCallback(() => {
        setSyncView(false);
        setPullSummary(null);
        setPullPayload(null);
    }, []);

    // Reselecting the "Plugins" tab (or navigating to it) bumps `navSignal` in
    // AppSettings. Without a remount, re-assigning the already-active tab is a
    // no-op, so a plugin's settings form / the sync sub-view would stay open.
    // Snap back to the manager list whenever the signal changes. This reads ONLY
    // `navSignal`; its writes (settingsForPluginId, syncView, pull*) don't feed
    // back into navSignal, so it cannot self-retrigger. On the initial mount the
    // list is already showing, so the reset is a harmless no-op.
    useEffect(() => {
        closeSettingsForm();
        closeSync();
    }, [navSignal, closeSettingsForm, closeSync]);

    async function doPush() {
        setSyncBusy(true);
        setSyncError("");
        setSyncMessage("");
        const res = await pushPluginSync();
        setSyncBusy(false);
        if (res.ok)
            setSyncMessage(t("pluginsSettings.pushedYourPluginSetToYour"));
        else setSyncError(res.error ?? t("pluginsSettings.pushFailed"));
    }

    async function doPullPreview() {
        setSyncBusy(true);
        setSyncError("");
        setSyncMessage("");
        setPullSummary(null);
        setPullPayload(null);
        const res = await getPullSummary();
        setSyncBusy(false);
        if (res.ok && res.summary && res.payload) {
            setPullSummary(res.summary);
            setPullPayload(res.payload);
        } else {
            setSyncError(res.error ?? t("pluginsSettings.pullFailed"));
        }
    }

    async function doApplyPull() {
        if (!pullPayload) return;
        setSyncBusy(true);
        try {
            const { failed } = await applyPull(pullPayload);
            setPullSummary(null);
            setPullPayload(null);
            setSyncMessage(t("pluginsSettings.appliedTheSyncedPluginSet"));
            if (failed.length)
                setSyncError(
                    t("pluginsSettings.couldNotInstall", {
                        join: failed
                            .map((f) => `${f.id} (${f.error})`)
                            .join(", "),
                    }),
                );
        } finally {
            setSyncBusy(false);
        }
    }

    // Global auto-update toggle
    async function toggleAutoUpdate(next: boolean) {
        setGlobalAutoUpdate(next);
    }

    // Per-plugin override select value: "default" | "on" | "off"
    function overrideValue(id: string): "default" | "on" | "off" {
        const v = perPlugin[id];
        return v === undefined ? "default" : v ? "on" : "off";
    }
    function setOverride(id: string, val: string) {
        setPluginAutoUpdate(id, val === "default" ? undefined : val === "on");
    }

    // Update a single repo plugin now
    const [updateBusy, setUpdateBusy] = useState<Record<string, boolean>>({});
    const [updateError, setUpdateError] = useState<Record<string, string>>({});
    async function doUpdate(id: string) {
        setUpdateBusy((b) => ({ ...b, [id]: true }));
        setUpdateError((e) => without(e, id));
        const res = await updateRepoPlugin(id);
        if (!res.ok)
            setUpdateError((e) => ({
                ...e,
                [id]: res.error ?? t("pluginsSettings.updateFailed"),
            }));
        refreshUpdates();
        setUpdateBusy((b) => ({ ...b, [id]: false }));
    }

    // On DESKTOP only, register the form's close with the central dismiss stack so
    // Escape / back pops the form before the settings dialog. On mobile, AppSettings
    // already owns the sub-page slot for the plugins drill-down; claiming it here
    // would supersede AppSettings' handler and unmount this whole tab, so we skip it
    // (Escape on mobile returns straight to the settings category list — acceptable).
    // Mirrors AppSettings' untrack + clearSubPageIfOwner pattern to avoid
    // effect_update_depth_exceeded.
    useEffect(() => {
        if (!settingsForPluginId || isMobile) return;
        openSubPage(closeSettingsForm);
        return () => clearSubPageIfOwner(closeSettingsForm);
    }, [settingsForPluginId, isMobile, closeSettingsForm]);

    async function toggle(id: string, next: boolean) {
        setBusyFor(id, true);
        try {
            if (next) {
                await enablePlugin(id);
            } else {
                await disablePlugin(id);
            }
        } finally {
            setBusyFor(id, false);
        }
    }

    // Remove is irreversible, so the trash button only arms an inline
    // Cancel/Remove step (audit UX-10); the second click uninstalls.
    const [removePending, setRemovePending] = useState<string | null>(null);
    const [removeError, setRemoveError] = useState<Record<string, string>>({});
    async function remove(id: string) {
        setRemovePending(null);
        setBusyFor(id, true);
        setRemoveError((e) => without(e, id));
        try {
            await uninstallRepoPlugin(id);
        } catch (err) {
            setRemoveError((e) => ({
                ...e,
                [id]:
                    err instanceof Error && err.message
                        ? t("pluginsSettings.couldnTRemovePlugin", {
                              message: err.message,
                          })
                        : t("pluginsSettings.couldnTRemovePlugin2"),
            }));
        } finally {
            setBusyFor(id, false);
        }
    }

    // Local-folder plugins (development)
    const [localError, setLocalError] = useState("");
    const [localBusy, setLocalBusy] = useState<string | null>(null); // plugin id, or "" while picking
    // The plugin a folder pick is for (a reload), or undefined for a new load.
    const pickFor = useRef<string | undefined>(undefined);

    async function loadFolder(
        files: Map<string, Blob>,
        handle?: FileSystemDirectoryHandle,
    ) {
        const res = await loadLocalPlugin(files, {
            handle,
            expectedId: pickFor.current,
        });
        if (!res.ok)
            setLocalError(res.error ?? t("pluginsSettings.installFailed"));
    }

    /** Ask for the plugin's folder. Where the browser can keep a handle to it,
     *  later reloads need no picking. */
    async function chooseFolder(forId?: string) {
        setLocalError("");
        pickFor.current = forId;
        if (!canPickDirectory()) {
            // Zami: in place of clicking the hidden folder input.
            await onFolderInput();
            return;
        }
        setLocalBusy(forId ?? "");
        try {
            const handle = await pickDirectory();
            await loadFolder(await filesFromDirectory(handle), handle);
        } catch (e) {
            if ((e as Error).name !== "AbortError")
                setLocalError((e as Error).message);
        } finally {
            setLocalBusy(null);
        }
    }

    // Zami: the folder input's change → the picked Directory. React Native keeps
    // no handle to it across launches, so a reload asks for the folder again.
    async function onFolderInput() {
        let picked: Directory;
        try {
            picked = await Directory.pickDirectoryAsync();
        } catch (e) {
            if (!isPickCancelled(e)) setLocalError((e as Error).message);
            return;
        }
        setLocalBusy(pickFor.current ?? "");
        try {
            await loadFolder(filesFromPickedDirectory(picked));
        } catch (e) {
            setLocalError((e as Error).message);
        } finally {
            setLocalBusy(null);
        }
    }

    async function reloadLocal(id: string) {
        setLocalError("");
        setLocalBusy(id);
        try {
            const res = await reloadLocalPlugin(id);
            if (res.needsPick) {
                setLocalBusy(null);
                await chooseFolder(id);
            } else if (!res.ok) {
                setLocalError(res.error ?? t("pluginsSettings.installFailed"));
            }
        } finally {
            setLocalBusy(null);
        }
    }

    // Repos add
    const [repoInput, setRepoInput] = useState("");
    const [repoError, setRepoError] = useState("");

    function submitAddRepo() {
        const res = canAddRepo(
            pluginRepos.refs,
            repoInput,
            import.meta.env.DEV,
        );
        if (!res.ok) {
            setRepoError(res.reason ?? t("pluginsSettings.cannotAddThisRepo"));
            return;
        }
        addRepo(res.normalized!);
        setRepoError("");
        setRepoInput("");
        void loadRepo(res.normalized!).then(refreshUpdates);
    }

    // Zami: `browse` is read back by refreshUpdates right after loadRepo
    // writes it, so a ref holds the current value and the state mirrors it
    // for rendering.
    const [browse, setBrowseState] = useState<Record<string, BrowseState>>({});
    const browseRef = useRef<Record<string, BrowseState>>({});
    function setBrowse(ref: string, state: BrowseState) {
        browseRef.current = { ...browseRef.current, [ref]: state };
        setBrowseState(browseRef.current);
    }

    async function loadRepo(ref: string) {
        setBrowse(ref, { loading: true, entries: [], error: null });
        try {
            const parsed = normalizeRepoRef(ref);
            const res = await fetch(rawUrl(parsed, "index.json"));
            if (!res.ok) {
                setBrowse(ref, {
                    loading: false,
                    entries: [],
                    error: t("pluginsSettings.noIndexJson", {
                        status: res.status,
                    }),
                });
                return;
            }
            setBrowse(ref, {
                loading: false,
                entries: parseIndex(await res.json()),
                error: null,
            });
        } catch (e) {
            setBrowse(ref, {
                loading: false,
                entries: [],
                error: (e as Error).message,
            });
        }
    }

    // Initial Browse fetch on mount
    useEffect(() => {
        (async () => {
            await Promise.all(
                mergeRepoList(pluginRepos.refs).map((r) => loadRepo(r.ref)),
            );
            refreshUpdates();
        })();
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as onMount.
    }, []);

    /** `owner/repo` for the installed row; the raw ref if it doesn't parse. */
    function repoLabel(ref: string): string {
        try {
            const r = normalizeRepoRef(ref);
            return `${r.owner}/${r.repo}`;
        } catch {
            return ref;
        }
    }

    function refreshUpdates() {
        const latestByRepo: Record<string, Record<string, string>> = {};
        for (const [ref, state] of Object.entries(browseRef.current)) {
            const key = repoKey(ref);
            if (!latestByRepo[key]) latestByRepo[key] = {};
            for (const entry of state.entries) {
                latestByRepo[key][entry.id] = entry.version;
            }
        }
        void applyUpdateCheck(latestByRepo);
    }

    // Install a repo plugin
    const [installError, setInstallError] = useState("");

    async function install(ref: string, entry: PluginIndexEntry) {
        setInstallError("");
        const res = await installRepoPlugin(ref, entry);
        if (!res.ok) {
            setInstallError(res.error ?? t("pluginsSettings.installFailed"));
        }
    }

    // Disable all plugins
    async function disableAll() {
        await disableAllPlugins();
    }

    if (settingsForPluginId) {
        return (
            <PluginSettingsForm
                key={settingsForPluginId}
                pluginId={settingsForPluginId}
                onBack={closeSettingsForm}
            />
        );
    }

    if (syncView) {
        return (
            <View className="gap-4">
                <Pressable
                    accessibilityRole="button"
                    onPress={closeSync}
                    className="self-start"
                >
                    <Text className="text-sm text-discord-textMuted hover:text-discord-textPrimary">
                        {t("pluginsSettings.back")}
                    </Text>
                </Pressable>
                <Text className="text-xs text-discord-textMuted">
                    {t("pluginsSettings.syncYourEnabledPluginsSettingsTo")}
                </Text>
                <View className="flex-row gap-2">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: syncBusy }}
                        onPress={() => void doPush()}
                        disabled={syncBusy}
                        className={`flex-1 items-center px-3 py-2 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors ${
                            syncBusy ? "opacity-50" : ""
                        }`}
                    >
                        <Text className="text-sm font-semibold text-white text-center">
                            {t("pluginsSettings.pushToAccount")}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: syncBusy }}
                        onPress={() => void doPullPreview()}
                        disabled={syncBusy}
                        className={`flex-1 items-center px-3 py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover transition-colors ${
                            syncBusy ? "opacity-50" : ""
                        }`}
                    >
                        <Text className="text-sm font-semibold text-discord-textPrimary text-center">
                            {t("pluginsSettings.pullFromAccount")}
                        </Text>
                    </Pressable>
                </View>
                {syncMessage ? (
                    <Text className="text-sm text-discord-textSecondary">
                        {syncMessage}
                    </Text>
                ) : null}
                {syncError ? (
                    <Text className="text-sm text-discord-danger">
                        {syncError}
                    </Text>
                ) : null}
                {pullSummary ? (
                    <View className="p-3 rounded bg-discord-backgroundTertiary gap-2">
                        <Text className="text-sm font-semibold text-discord-textPrimary">
                            {t("pluginsSettings.thisPullWill")}
                        </Text>
                        {pullSummary.reposToAdd.length ? (
                            <Text className="text-sm text-discord-textSecondary">
                                {t("pluginsSettings.addRepos", {
                                    join: pullSummary.reposToAdd.join(", "),
                                })}
                            </Text>
                        ) : null}
                        {pullSummary.toInstall.length ? (
                            <Text className="text-sm text-discord-textSecondary">
                                {t("pluginsSettings.installFromRepos", {
                                    join: pullSummary.toInstall
                                        .map((p) => `${p.id} (${p.repoRef})`)
                                        .join(", "),
                                })}
                            </Text>
                        ) : null}
                        {pullSummary.toEnable.length ? (
                            <Text className="text-sm text-discord-textSecondary">
                                {t("pluginsSettings.enable", {
                                    join: pullSummary.toEnable.join(", "),
                                })}
                            </Text>
                        ) : null}
                        {pullSummary.toDisable.length ? (
                            <Text className="text-sm text-discord-textSecondary">
                                {t("pluginsSettings.disable", {
                                    join: pullSummary.toDisable.join(", "),
                                })}
                            </Text>
                        ) : null}
                        {pullSummary.settingsChanges.length ? (
                            <Text className="text-sm text-discord-textSecondary">
                                {t("pluginsSettings.updateSettingsFor", {
                                    join: pullSummary.settingsChanges.join(
                                        ", ",
                                    ),
                                })}
                            </Text>
                        ) : null}
                        {pullSummary.autoUpdateChange !== null ? (
                            <Text className="text-sm text-discord-textSecondary">
                                {t("pluginsSettings.setAutoUpdate", {
                                    value: pullSummary.autoUpdateChange
                                        ? "on"
                                        : "off",
                                })}
                            </Text>
                        ) : null}
                        {pullSummary.autoUpdateOverrides.length ? (
                            <Text className="text-sm text-discord-textSecondary">
                                {t("pluginsSettings.setPerPluginAutoUpdate", {
                                    join: pullSummary.autoUpdateOverrides
                                        .map(
                                            (o) =>
                                                `${o.id}=${o.value ? "on" : "off"}`,
                                        )
                                        .join(", "),
                                })}
                            </Text>
                        ) : null}
                        {pullSummary.notInstalledHere.length ? (
                            <Text className="text-discord-textMuted text-xs">
                                {t(
                                    "pluginsSettings.notInstalledOnThisDeviceInstall",
                                    {
                                        join: pullSummary.notInstalledHere
                                            .map((n) => n.id)
                                            .join(", "),
                                    },
                                )}
                            </Text>
                        ) : null}
                        {pullSummary.reposToAdd.length === 0 &&
                        pullSummary.toInstall.length === 0 &&
                        pullSummary.toEnable.length === 0 &&
                        pullSummary.toDisable.length === 0 &&
                        pullSummary.settingsChanges.length === 0 &&
                        pullSummary.autoUpdateChange === null &&
                        pullSummary.autoUpdateOverrides.length === 0 ? (
                            <Text className="text-sm text-discord-textSecondary">
                                {t(
                                    "pluginsSettings.nothingToChangeAlreadyInSync",
                                )}
                            </Text>
                        ) : null}
                        <View className="flex-row gap-2 pt-1">
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ disabled: syncBusy }}
                                onPress={() => void doApplyPull()}
                                disabled={syncBusy}
                                className={`px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors ${
                                    syncBusy ? "opacity-50" : ""
                                }`}
                            >
                                <Text className="text-sm font-semibold text-white">
                                    {t("pluginsSettings.apply")}
                                </Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => {
                                    setPullSummary(null);
                                    setPullPayload(null);
                                }}
                                className="px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover transition-colors"
                            >
                                <Text className="text-sm font-semibold text-discord-textPrimary">
                                    {t("common.cancel")}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                ) : null}
            </View>
        );
    }

    return (
        <View className="gap-6">
            {/* Installed */}
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("pluginsSettings.installed")}
                </Text>
                {installedList.length === 0 ? (
                    <Text className="text-sm text-discord-textMuted text-center py-8">
                        {t("pluginsSettings.noPluginsInstalled")}
                    </Text>
                ) : (
                    <View className="gap-2">
                        {installedList.map((p) => {
                            // Zami: read as the row renders; installedList
                            // re-renders it when the record's manifest changes.
                            const hasSettings =
                                (installedPlugins[p.id]?.manifest.settings
                                    ?.length ?? 0) > 0;
                            return (
                                <View
                                    key={p.id}
                                    className="flex-row items-start gap-3 p-3 rounded bg-discord-backgroundTertiary"
                                >
                                    <View className="flex-1 min-w-0">
                                        <Text className="text-sm font-medium text-discord-textPrimary">
                                            {p.name}
                                        </Text>
                                        <Text className="text-xs text-discord-textMuted">
                                            v{p.version} · {p.author}
                                            {p.source === "repo" && p.repoRef
                                                ? ` · ${repoLabel(p.repoRef)}${
                                                      p.sha
                                                          ? `@${p.sha.slice(0, 7)}`
                                                          : ""
                                                  }`
                                                : p.source === "local"
                                                  ? ` · ${t("pluginsSettings.localFolder")}`
                                                  : null}
                                        </Text>
                                        {p.error ? (
                                            <View className="flex-row items-center gap-1.5 mt-1">
                                                <TriangleAlert
                                                    size={14}
                                                    className="text-discord-danger flex-shrink-0"
                                                />
                                                <Text className="flex-shrink text-xs text-discord-danger">
                                                    {p.error}
                                                </Text>
                                            </View>
                                        ) : null}
                                        {updatesAvailable[p.id] ||
                                        needsUpdate[p.id] ? (
                                            <View className="flex-row items-center gap-2 mt-1">
                                                {needsUpdate[p.id] ? (
                                                    <View className="px-1.5 py-0.5 rounded bg-discord-danger/20">
                                                        <Text className="text-[10px] font-semibold text-discord-danger">
                                                            {t(
                                                                "pluginsSettings.needsUpdate",
                                                            )}
                                                        </Text>
                                                    </View>
                                                ) : updatesAvailable[p.id] ? (
                                                    <View className="px-1.5 py-0.5 rounded bg-discord-accent/20">
                                                        <Text className="text-[10px] font-semibold text-discord-accent">
                                                            {t(
                                                                "pluginsSettings.updateToV",
                                                                {
                                                                    value: updatesAvailable[
                                                                        p.id
                                                                    ],
                                                                },
                                                            )}
                                                        </Text>
                                                    </View>
                                                ) : null}
                                                <Pressable
                                                    accessibilityRole="button"
                                                    accessibilityState={{
                                                        disabled:
                                                            !!updateBusy[p.id],
                                                    }}
                                                    onPress={() =>
                                                        void doUpdate(p.id)
                                                    }
                                                    disabled={updateBusy[p.id]}
                                                    className={
                                                        updateBusy[p.id]
                                                            ? "opacity-50"
                                                            : ""
                                                    }
                                                >
                                                    <Text className="text-xs text-discord-accent hover:underline">
                                                        {updateBusy[p.id]
                                                            ? t(
                                                                  "pluginsSettings.updating",
                                                              )
                                                            : t(
                                                                  "pluginsSettings.update",
                                                              )}
                                                    </Text>
                                                </Pressable>
                                            </View>
                                        ) : null}
                                        {updateError[p.id] ? (
                                            <Text
                                                className="text-xs text-discord-danger mt-1"
                                                accessibilityRole="alert"
                                            >
                                                {updateError[p.id]}
                                            </Text>
                                        ) : null}
                                        {removeError[p.id] ? (
                                            <Text
                                                className="text-xs text-discord-danger mt-1"
                                                accessibilityRole="alert"
                                            >
                                                {removeError[p.id]}
                                            </Text>
                                        ) : null}
                                    </View>
                                    <View className="flex-row items-center gap-2 flex-shrink-0">
                                        {hasSettings ? (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel={t(
                                                    "pluginsSettings.pluginSettings",
                                                )}
                                                onPress={() =>
                                                    setSettingsForPluginId(p.id)
                                                }
                                                className="p-1.5 rounded hover:bg-discord-messageHover transition-colors"
                                            >
                                                <Settings
                                                    size={16}
                                                    className="text-discord-textMuted hover:text-discord-textPrimary"
                                                />
                                            </Pressable>
                                        ) : null}
                                        <ToggleSwitch
                                            checked={p.enabled}
                                            onChange={(next) =>
                                                void toggle(p.id, next)
                                            }
                                            label={t(
                                                "pluginsSettings.enable2",
                                                {
                                                    name: p.name,
                                                },
                                            )}
                                            title={
                                                busy[p.id]
                                                    ? t(
                                                          "pluginsSettings.working",
                                                      )
                                                    : undefined
                                            }
                                        />
                                        {p.source === "local" ? (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel={t(
                                                    "pluginsSettings.reloadFromFolder",
                                                )}
                                                accessibilityState={{
                                                    disabled:
                                                        localBusy !== null,
                                                }}
                                                onPress={() =>
                                                    void reloadLocal(p.id)
                                                }
                                                disabled={localBusy !== null}
                                                className={`px-2 py-1 rounded hover:bg-discord-messageHover transition-colors ${
                                                    localBusy !== null
                                                        ? "opacity-50"
                                                        : ""
                                                }`}
                                            >
                                                <Text className="text-xs font-semibold text-discord-accent">
                                                    {localBusy === p.id
                                                        ? t(
                                                              "pluginsSettings.reloading",
                                                          )
                                                        : t(
                                                              "pluginsSettings.reload",
                                                          )}
                                                </Text>
                                            </Pressable>
                                        ) : null}
                                        {p.source === "repo" ? (
                                            <Select
                                                value={overrideValue(p.id)}
                                                onChange={(value) =>
                                                    setOverride(p.id, value)
                                                }
                                                accessibilityLabel={t(
                                                    "pluginsSettings.autoUpdateThisPlugin",
                                                )}
                                                // Zami: `w-32`: in this row of fixed-size
                                                // controls Select would grow to the row's
                                                // width (a <select> fits its options).
                                                className="w-32 rounded bg-discord-backgroundSecondary border border-discord-divider px-1 py-0.5"
                                                options={[
                                                    {
                                                        value: "default",
                                                        label: t(
                                                            "pluginsSettings.autoDefault",
                                                        ),
                                                    },
                                                    {
                                                        value: "on",
                                                        label: t(
                                                            "pluginsSettings.autoOn",
                                                        ),
                                                    },
                                                    {
                                                        value: "off",
                                                        label: t(
                                                            "pluginsSettings.autoOff",
                                                        ),
                                                    },
                                                ]}
                                            />
                                        ) : null}
                                        {p.source !== "builtin" ? (
                                            removePending === p.id ? (
                                                <>
                                                    <Pressable
                                                        accessibilityRole="button"
                                                        onPress={() =>
                                                            setRemovePending(
                                                                null,
                                                            )
                                                        }
                                                        className="px-2 py-1 rounded hover:bg-discord-messageHover transition-colors"
                                                    >
                                                        <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                                            {t("common.cancel")}
                                                        </Text>
                                                    </Pressable>
                                                    <Pressable
                                                        accessibilityRole="button"
                                                        accessibilityLabel={t(
                                                            "pluginsSettings.confirmRemove",
                                                            { name: p.name },
                                                        )}
                                                        onPress={() =>
                                                            void remove(p.id)
                                                        }
                                                        className="px-2 py-1 rounded bg-discord-danger hover:bg-discord-dangerHover transition-colors"
                                                    >
                                                        <Text className="text-xs text-white">
                                                            {t("common.remove")}
                                                        </Text>
                                                    </Pressable>
                                                </>
                                            ) : (
                                                <Pressable
                                                    accessibilityRole="button"
                                                    accessibilityLabel={t(
                                                        "pluginsSettings.remove",
                                                        { name: p.name },
                                                    )}
                                                    accessibilityState={{
                                                        disabled: !!busy[p.id],
                                                    }}
                                                    onPress={() =>
                                                        setRemovePending(p.id)
                                                    }
                                                    disabled={busy[p.id]}
                                                    className={`p-1.5 rounded hover:bg-discord-messageHover transition-colors ${
                                                        busy[p.id]
                                                            ? "opacity-50"
                                                            : ""
                                                    }`}
                                                >
                                                    <Trash2
                                                        size={16}
                                                        className="text-discord-textMuted hover:text-discord-danger"
                                                    />
                                                </Pressable>
                                            )
                                        ) : null}
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                )}
            </View>

            {/* Browse */}
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("pluginsSettings.browse")}
                </Text>
                {installError ? (
                    <Text className="text-sm text-discord-danger mb-2">
                        {installError}
                    </Text>
                ) : null}
                <View className="gap-4">
                    {repoList.map((repo) => (
                        <View key={repo.ref}>
                            <Text className="text-sm font-semibold text-discord-textPrimary mb-2">
                                {repo.ref}
                            </Text>
                            {browse[repo.ref]?.loading ? (
                                <Text className="text-xs text-discord-textMuted">
                                    {t("pluginsSettings.loading")}
                                </Text>
                            ) : browse[repo.ref]?.error ? (
                                <Text className="text-xs text-discord-textMuted">
                                    {browse[repo.ref].error}
                                </Text>
                            ) : !browse[repo.ref]?.entries.length ? (
                                <Text className="text-xs text-discord-textMuted">
                                    {t(
                                        "pluginsSettings.noPluginsInThisRepoYet",
                                    )}
                                </Text>
                            ) : (
                                <View className="gap-2">
                                    {browse[repo.ref].entries.map((entry) => {
                                        // Zami: read as the row renders;
                                        // installedList re-renders on installs.
                                        const alreadyInstalled =
                                            entry.id in installedPlugins;
                                        return (
                                            <View
                                                key={entry.id}
                                                className="flex-row items-start gap-3 p-2 rounded bg-discord-backgroundSecondary"
                                            >
                                                <View className="flex-1 min-w-0">
                                                    <Text className="text-sm font-medium text-discord-textPrimary">
                                                        {entry.name}
                                                    </Text>
                                                    <Text className="text-xs text-discord-textMuted">
                                                        v{entry.version} ·{" "}
                                                        {entry.author}
                                                    </Text>
                                                    <Text className="text-xs text-discord-textSecondary mt-0.5">
                                                        {entry.description}
                                                    </Text>
                                                </View>
                                                {alreadyInstalled ? (
                                                    <View className="px-2.5 py-1 rounded bg-discord-backgroundTertiary">
                                                        <Text className="text-xs font-semibold text-discord-textMuted">
                                                            {t(
                                                                "pluginsSettings.installed",
                                                            )}
                                                        </Text>
                                                    </View>
                                                ) : (
                                                    <Pressable
                                                        accessibilityRole="button"
                                                        onPress={() =>
                                                            void install(
                                                                repo.ref,
                                                                entry,
                                                            )
                                                        }
                                                        className="px-2.5 py-1 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors"
                                                    >
                                                        <Text className="text-xs font-semibold text-white">
                                                            {t(
                                                                "pluginsSettings.install",
                                                            )}
                                                        </Text>
                                                    </Pressable>
                                                )}
                                            </View>
                                        );
                                    })}
                                </View>
                            )}
                        </View>
                    ))}
                </View>
            </View>

            {/* Local folder (plugin development) */}
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("pluginsSettings.localFolder")}
                </Text>
                <View className="p-3 rounded bg-discord-backgroundTertiary gap-3">
                    <Text className="text-xs text-discord-textPrimary font-medium">
                        {t("pluginsSettings.loadFromFolder")}
                    </Text>
                    <Text className="text-xs text-discord-textMuted">
                        {t("pluginsSettings.loadFromFolderHint")}
                    </Text>
                    {/* Zami: the hidden `<input type="file" webkitdirectory>` is
                        the directory picker onFolderInput opens. */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: localBusy !== null }}
                        onPress={() => void chooseFolder()}
                        disabled={localBusy !== null}
                        className={`self-start px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors ${
                            localBusy !== null ? "opacity-50" : ""
                        }`}
                    >
                        <Text className="text-sm font-semibold text-white">
                            {t("pluginsSettings.chooseFolder")}
                        </Text>
                    </Pressable>
                    {localError ? (
                        <Text
                            className="text-xs text-discord-danger"
                            accessibilityRole="alert"
                        >
                            {localError}
                        </Text>
                    ) : null}
                </View>
            </View>

            {/* Repos */}
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("pluginsSettings.repos")}
                </Text>
                <View className="gap-2 mb-4">
                    {repoList.map((repo) => (
                        <View
                            key={repo.ref}
                            className="flex-row items-center gap-3 p-2 rounded bg-discord-backgroundTertiary"
                        >
                            <View className="flex-1 min-w-0">
                                <Text
                                    numberOfLines={1}
                                    className="text-sm text-discord-textPrimary"
                                >
                                    {repo.ref}
                                </Text>
                                {repo.official ? (
                                    <Text className="text-xs text-discord-textMuted">
                                        {t("pluginsSettings.official")}
                                    </Text>
                                ) : null}
                            </View>
                            {!repo.official ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={t(
                                        "pluginsSettings.removeRepo",
                                    )}
                                    onPress={() => removeRepo(repo.ref)}
                                    className="p-1.5 rounded hover:bg-discord-messageHover transition-colors"
                                >
                                    <Trash2
                                        size={16}
                                        className="text-discord-textMuted hover:text-discord-danger"
                                    />
                                </Pressable>
                            ) : null}
                        </View>
                    ))}
                </View>

                <View className="p-3 rounded bg-discord-backgroundTertiary gap-3">
                    <Text className="text-xs text-discord-textPrimary font-medium">
                        {t("pluginsSettings.addARepo")}
                    </Text>
                    <Text className="text-xs text-discord-textMuted">
                        {t("pluginsSettings.thirdPartyReposRunFullTrust")}
                    </Text>
                    <View className="flex-row gap-2">
                        <TextInput
                            value={repoInput}
                            onChangeText={setRepoInput}
                            placeholder={t(
                                "pluginsSettings.ownerRepoOrGithubUrl",
                            )}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            accessibilityLabel={t(
                                "pluginsSettings.ownerRepoOrGithubUrl",
                            )}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                            returnKeyType="done"
                            className="flex-1 px-2.5 py-1.5 rounded bg-discord-backgroundSecondary text-sm text-discord-textPrimary border border-discord-divider focus:border-discord-accent outline-none"
                            onSubmitEditing={submitAddRepo}
                        />
                        <Pressable
                            accessibilityRole="button"
                            onPress={submitAddRepo}
                            className="justify-center px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors"
                        >
                            <Text className="text-sm font-semibold text-white">
                                {t("pluginsSettings.addRepo")}
                            </Text>
                        </Pressable>
                    </View>
                    {repoError ? (
                        <Text className="text-xs text-discord-danger">
                            {repoError}
                        </Text>
                    ) : null}
                </View>
            </View>

            {/* Actions */}
            <View>
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                    {t("common.actions")}
                </Text>
                <View className="gap-3">
                    <Pressable
                        accessibilityRole="button"
                        onPress={openSync}
                        className="w-full flex-row items-center justify-center gap-2 px-4 py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover transition-colors"
                    >
                        <RefreshCw
                            size={16}
                            className="text-discord-textPrimary"
                        />
                        <Text className="text-sm font-semibold text-discord-textPrimary">
                            {t("pluginsSettings.syncPlugins")}
                        </Text>
                    </Pressable>

                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void disableAll()}
                        className="w-full flex-row items-center justify-center gap-2 px-4 py-2 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover transition-colors"
                    >
                        <Power size={16} className="text-discord-textPrimary" />
                        <Text className="text-sm font-semibold text-discord-textPrimary">
                            {t("pluginsSettings.disableAllPlugins")}
                        </Text>
                    </Pressable>

                    <View className="flex-row items-center gap-3 py-2 border-t border-discord-divider pt-3">
                        <View className="flex-1 min-w-0">
                            <Text className="text-sm text-discord-textPrimary">
                                {t("pluginsSettings.autoUpdatePlugins")}
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {t(
                                    "pluginsSettings.automaticallyPullNewerVersionsOfRepo",
                                )}
                            </Text>
                        </View>
                        <ToggleSwitch
                            checked={autoUpdate}
                            onChange={(next) => void toggleAutoUpdate(next)}
                            label={t("pluginsSettings.autoUpdatePlugins")}
                        />
                    </View>
                </View>
            </View>
        </View>
    );
}
