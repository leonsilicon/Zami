import {
    Portal,
    revealSettingAnchor,
    SvgIcon,
    type AnchorScrollView,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import {
    Fragment,
    useCallback,
    useEffect,
    useEffectEvent,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    AccessibilityInfo,
    BackHandler,
    Keyboard,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
    type PressableInstance,
    type TextInputInstance,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "$lib/i18n";
import AppearanceSettings from "$lib/components/settings/AppearanceSettings.svelte";
import MessagesMediaSettings from "$lib/components/settings/MessagesMediaSettings.svelte";
import GeneralSettings from "$lib/components/settings/GeneralSettings.svelte";
import PrivacySafetySettings from "$lib/components/settings/PrivacySafetySettings.svelte";
import PushDiagnostics from "$lib/components/settings/PushDiagnostics.svelte";
import NotificationSettings from "$lib/components/settings/NotificationSettings.svelte";
import ServerSettings from "$lib/components/settings/ServerSettings.svelte";
import AboutSettings from "$lib/components/settings/AboutSettings.svelte";
import DebugSettings from "$lib/components/settings/DebugSettings.svelte";
import SessionSettings from "$lib/components/settings/SessionSettings.svelte";
import SecuritySettings from "$lib/components/settings/SecuritySettings.svelte";
import AccountSettings from "$lib/components/settings/AccountSettings.svelte";
import CustomPackSettings from "$lib/components/settings/CustomPackSettings.svelte";
import SoundPackEditor from "$lib/components/settings/SoundPackEditor.svelte";
import SharedPackSettings from "$lib/components/settings/SharedPackSettings.svelte";
import VoiceAudioSettings from "$lib/components/settings/VoiceAudioSettings.svelte";
import KeybindSettings from "$lib/components/settings/KeybindSettings.svelte";
import PluginsSettings from "$lib/components/settings/PluginsSettings.svelte";
import { motionOK } from "$lib/utils/motionPreference";
import {
    interfaceState,
    openSubPage,
    clearSubPageIfOwner,
    closeSubPage,
} from "$lib/stores/interface.svelte";
import {
    SETTINGS_TABS,
    settingsTabLabel,
    settingsNavView,
    isSettingsTabAvailable,
    visibleSettingsGroups,
    type SettingsTab,
} from "$lib/utils/settingsNav";
import {
    searchSettings,
    settingsSearchKeyAction,
    SETTINGS_SEARCH_INDEX,
    type SettingsSearchEntry,
} from "$lib/utils/settingsSearch";
import { isDesktopTray } from "$lib/desktopTray";
import { richPresenceAvailable } from "$lib/stores/richPresence.svelte";
import RichPresenceSettings from "$lib/components/settings/RichPresenceSettings.svelte";
import { Capacitor } from "@capacitor/core";
import { ChevronRight, ArrowLeft } from "lucide-svelte";

interface Props {
    onClose: () => void;
    onLogout: () => void;
}

// Zami: `use:focusTrap` is dropped; the panel is an accessibility-modal view
// instead. Each page scrolls in a keyboard-aware scroll view, which keeps a
// focused field above the on-screen keyboard. The full-screen (mobile) panel
// pads for the safe area. `mirror:` (`:dir(rtl)`) → Uniwind's `rtl:`.
export default function AppSettings({ onClose, onLogout }: Props) {
    const isMobile = useRune(() => interfaceState.isMobile);
    const insets = useSafeAreaInsets();

    // null = "nothing drilled into yet": the mobile category list, or the
    // desktop default panel. Kept across a viewport change in both directions
    // so resizing/rotating never loses the user's place.
    const [selectedTab, setSelectedTab] = useState<SettingsTab | null>(
        () => interfaceState.settingsInitialTab,
    );

    const view = settingsNavView({ isMobile, selectedTab });

    // Bumped on every settings-tab (re)selection. Reselecting the already-active
    // tab is a $state no-op for `selectedTab`, so this monotonic counter is what
    // signals a child panel (PluginsSettings) to reset its own sub-view state.
    const [pluginsNavTick, setPluginsNavTick] = useState(0);
    function selectTab(id: SettingsTab) {
        setSelectedTab(id);
        setPluginsNavTick((n) => n + 1);
    }

    // Tabs with no content on this platform (General off packaged desktop)
    // are hidden from the nav and from search (audit UX-12), as are search
    // entries for single settings this platform doesn't show. Both facts are
    // fixed for the page's lifetime, so a plain const is enough.
    const platform = {
        desktopTray: isDesktopTray(),
        nativeApp: Capacitor.isNativePlatform(),
        richPresence: richPresenceAvailable(),
    };
    const settingsGroups = visibleSettingsGroups(platform);
    const searchIndex = SETTINGS_SEARCH_INDEX.filter(
        (e) =>
            isSettingsTabAvailable(e.tab, platform) &&
            (e.available?.(platform) ?? true),
    );

    const [searchQuery, setSearchQuery] = useState("");
    const searchResults = searchSettings(searchQuery, searchIndex);
    const searchActive = searchQuery.trim().length > 0;
    const searchEl = useRef<TextInputInstance>(null);

    // Stable identity: it is the ownership token for the sub-page slot, so it
    // must NOT be recreated on every render. It resets local state ONLY — it
    // runs from inside the store's own close/supersede paths, so reaching back
    // into the store here would pop the wrong owner.
    const goBackToList = useCallback(() => {
        setSelectedTab(null);
    }, []);

    // A search result was chosen: navigate to the owning tab via the existing
    // selectedTab mechanism (drills in on mobile, selects the sidebar tab on
    // desktop) and clear the query so the normal panel shows.
    // Zami: the panel's scroll view, and the anchor to scroll to and flash
    // once the new tab's panel has rendered (upstream awaits `tick()`). A panel
    // marks its `data-setting-anchor` elements with SettingAnchor; one that
    // isn't rendered leaves the result on its tab, as upstream's does.
    const panelScroll = useRef<AnchorScrollView>(null);
    const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
    function selectResult(entry: SettingsSearchEntry) {
        setSearchQuery("");
        setSelectedTab(entry.tab);
        setPendingAnchor(entry.anchor ?? null);
    }
    useEffect(() => {
        if (!pendingAnchor) return;
        // After the panel's layout, as `scrollIntoView` after `tick()`.
        const frame = requestAnimationFrame(() => {
            revealSettingAnchor(pendingAnchor, panelScroll.current);
            setPendingAnchor(null);
        });
        return () => cancelAnimationFrame(frame);
    }, [pendingAnchor, selectedTab]);

    // Escape clears a typed query before it closes the dialog; Enter opens the
    // top result. Returning true stands in for stopping propagation, which keeps
    // that Escape away from the back handling below, which would otherwise close
    // the whole dialog.
    // Zami: Enter is the field's return key (`onSubmitEditing`), and Escape is
    // Android's back button while the field has focus.
    function onSearchKeydown(e: { key: string }): boolean {
        const action = settingsSearchKeyAction(
            e,
            searchQuery,
            searchResults.length,
        );
        if (!action) return false;
        if (action === "clear") setSearchQuery("");
        else selectResult(searchResults[0]);
        return true;
    }

    // Register the mobile sub-page with the central dismiss stack so Escape and
    // the hardware back button pop it before closing the whole dialog.
    //
    // Zami: upstream `untrack`s `openSubPage` so the slot it reads isn't a
    // dependency; here the dependency list is explicit, and `view.mode` is
    // what the effect reads.
    useEffect(() => {
        if (view.mode !== "detail") return;
        openSubPage(goBackToList);
        return () => clearSubPageIfOwner(goBackToList);
    }, [view.mode, goBackToList]);

    // Zami: Escape and the back button belong to AppShell's
    // `dismissTopmost()` upstream (see the comment on the dialog below): it
    // pops the sub-page slot (this drill-down, or a plugin's settings form)
    // before closing the modal. The overlay takes Android's back button (and
    // VoiceOver's escape gesture) for the same steps while it is open; a
    // dialog opened from a page registers later, so its own handler runs
    // first. With the search field focused, the press is its Escape.
    function dismissTopmost() {
        if (
            searchEl.current?.isFocused() &&
            onSearchKeydown({ key: "Escape" })
        ) {
            return;
        }
        if (interfaceState.subPageClose) closeSubPage();
        else onClose();
    }
    const onBackPress = useEffectEvent(dismissTopmost);
    useEffect(() => {
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                onBackPress();
                return true;
            },
        );
        return () => subscription.remove();
    }, []);

    // Zami: the `sr-only` live region → an announcement whenever its text
    // changes.
    const searchStatus = searchActive
        ? searchResults.length === 0
            ? t("appSettings.noSettingsMatch")
            : t("appSettings.resultCount", {
                  count: searchResults.length,
              })
        : "";
    useEffect(() => {
        if (searchStatus)
            AccessibilityInfo.announceForAccessibility(searchStatus);
    }, [searchStatus]);

    // Refs, not state: these are transition bookkeeping, not view data.
    // Nothing renders from them.
    const backButtonEl = useRef<PressableInstance>(null);
    const categoryEls = useRef<Record<string, PressableInstance | null>>({});
    const sidebarEls = useRef<Record<string, PressableInstance | null>>({});
    const lastMode = useRef<string | null>(null);

    // EVERY mode change destroys the element that had focus — drilling in,
    // backing out, and crossing the 768px breakpoint in either direction. So
    // re-anchor focus on every change, including into "desktop" (never on
    // first mount).
    // Zami: the focus is the screen reader's (VoiceOver / TalkBack), moved
    // with an accessibility `focus` event.
    const viewTab = view.mode === "list" ? null : view.tab;
    useEffect(() => {
        const mode = view.mode;
        const tab = viewTab;
        if (lastMode.current === null || lastMode.current === mode) {
            lastMode.current = mode;
            return;
        }
        lastMode.current = mode;
        // After the views are committed, so the refs have landed.
        const el =
            mode === "detail"
                ? backButtonEl.current
                : mode === "list"
                  ? categoryEls.current[SETTINGS_TABS[0].id]
                  : tab
                    ? sidebarEls.current[tab]
                    : null;
        if (el) AccessibilityInfo.sendAccessibilityEvent(el, "focus");
    }, [view.mode, viewTab]);

    const fadeIn = motionOK() ? FadeIn.duration(120) : undefined;

    function panel(tab: SettingsTab): ReactNode {
        if (tab === "account") return <AccountSettings onLogout={onLogout} />;
        if (tab === "security")
            return (
                <View className="gap-8">
                    <SecuritySettings />
                    <SessionSettings />
                </View>
            );
        if (tab === "privacy") return <PrivacySafetySettings />;
        if (tab === "rich-presence") return <RichPresenceSettings />;
        if (tab === "appearance") return <AppearanceSettings />;
        if (tab === "messages-media") return <MessagesMediaSettings />;
        if (tab === "notifications") return <NotificationSettings />;
        if (tab === "voice") return <VoiceAudioSettings />;
        if (tab === "keybinds") return <KeybindSettings />;
        if (tab === "emotes")
            return (
                <>
                    <CustomPackSettings kind="emotes" />
                    <SharedPackSettings />
                    <View className="mt-8 gap-3">
                        <Text
                            accessibilityRole="header"
                            className="text-lg font-semibold text-discord-textPrimary"
                        >
                            {t("soundboard.title")}
                        </Text>
                        <SoundPackEditor />
                    </View>
                </>
            );
        if (tab === "general") return <GeneralSettings />;
        if (tab === "plugins")
            return <PluginsSettings navSignal={pluginsNavTick} />;
        if (tab === "server") return <ServerSettings />;
        if (tab === "about") return <AboutSettings />;
        if (tab === "debug")
            return (
                <View className="gap-6">
                    <DebugSettings />
                    <PushDiagnostics />
                </View>
            );
        return null;
    }

    return (
        // Zami: the `fixed inset-0` layer is rendered at the app root through
        // the Portal.
        <Portal>
            <View className="absolute inset-0 z-50 flex-row items-center justify-center p-0 md:p-4">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.closeDialog")}
                    className="absolute inset-0 bg-black/60"
                    onPress={onClose}
                />
                {/* No `onEscape` on purpose: focusTrap's node-level keydown fires BEFORE
                    <svelte:window onkeydown> reaches AppShell, so an onEscape here would
                    close the whole dialog on the first Escape and the mobile sub-page could
                    never be popped. Escape is owned by AppShell.dismissTopmost().
                    Zami: `h-[100dvh] md:h-[85dvh]` → the layer's full height, and 85%
                    of it from `md:`. */}
                <View
                    role="dialog"
                    accessibilityViewIsModal
                    aria-labelledby="app-settings-title"
                    onAccessibilityEscape={dismissTopmost}
                    className="relative z-10 bg-discord-backgroundSecondary rounded-none md:rounded-xl shadow-2xl w-full max-w-2xl flex-col overflow-hidden h-full md:h-[85%]"
                    style={
                        isMobile
                            ? {
                                  paddingTop: insets.top,
                                  paddingBottom: insets.bottom,
                              }
                            : undefined
                    }
                >
                    {/* Header. On a mobile sub-page the close button is replaced by a back
                        arrow and the title names the category. */}
                    <View className="flex-row items-center gap-2 px-6 py-4 border-b border-discord-divider flex-shrink-0">
                        {view.mode === "detail" && (
                            <Pressable
                                ref={backButtonEl}
                                accessibilityRole="button"
                                onPress={goBackToList}
                                accessibilityLabel={t(
                                    "appSettings.backToSettings",
                                )}
                                className="-ms-2 p-1.5 rounded hover:bg-discord-messageHover transition-colors flex-shrink-0"
                            >
                                <ArrowLeft
                                    className="rtl:-scale-x-100 text-discord-textMuted"
                                    size={20}
                                />
                            </Pressable>
                        )}
                        <Text
                            nativeID="app-settings-title"
                            accessibilityRole="header"
                            numberOfLines={1}
                            className="text-lg font-bold text-discord-textPrimary min-w-0 truncate flex-1"
                        >
                            {view.mode === "detail"
                                ? settingsTabLabel(view.tab)
                                : t("common.settings")}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            onPress={onClose}
                            accessibilityLabel={t("appSettings.closeSettings")}
                            className="p-1.5 rounded hover:bg-discord-messageHover transition-colors flex-shrink-0"
                        >
                            <SvgIcon
                                className="w-5 h-5 text-discord-textMuted"
                                d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                            />
                        </Pressable>
                    </View>

                    {view.mode !== "detail" && (
                        <View className="px-6 py-3 border-b border-discord-divider flex-shrink-0">
                            <TextInput
                                ref={searchEl}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                onSubmitEditing={() =>
                                    onSearchKeydown({ key: "Enter" })
                                }
                                returnKeyType="search"
                                clearButtonMode="while-editing"
                                autoCorrect={false}
                                placeholder={t("appSettings.searchSettings")}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                accessibilityLabel={t(
                                    "appSettings.searchSettings2",
                                )}
                                className="w-full px-3 py-2 rounded bg-discord-backgroundTertiary text-sm text-discord-textPrimary focus:outline-none focus:ring-2 focus:ring-discord-accent"
                            />
                        </View>
                    )}

                    {searchActive ? (
                        <ScrollView
                            className="flex-1"
                            contentContainerClassName="py-2"
                            accessibilityLabel={t("common.searchResults")}
                            keyboardShouldPersistTaps="handled"
                            keyboardDismissMode="on-drag"
                            automaticallyAdjustKeyboardInsets
                        >
                            {searchResults.length === 0 ? (
                                <Text className="px-6 py-8 text-sm text-discord-textMuted text-center">
                                    {t("appSettings.noSettingsMatch2", {
                                        searchQuery,
                                    })}
                                </Text>
                            ) : (
                                searchResults.map((result) => (
                                    <Pressable
                                        key={result.tab + result.label}
                                        accessibilityRole="button"
                                        onPress={() => {
                                            // Zami: a click takes focus off the field.
                                            Keyboard.dismiss();
                                            selectResult(result);
                                        }}
                                        className="w-full flex-row items-center justify-between gap-3 px-6 py-3 hover:bg-discord-messageHover transition-colors"
                                    >
                                        <Text
                                            numberOfLines={1}
                                            className="min-w-0 flex-shrink truncate text-sm text-discord-textPrimary"
                                        >
                                            {result.label}
                                        </Text>
                                        <Text className="flex-shrink-0 text-xs text-discord-textMuted">
                                            {settingsTabLabel(result.tab)}
                                        </Text>
                                    </Pressable>
                                ))
                            )}
                        </ScrollView>
                    ) : view.mode === "list" ? (
                        // Mobile root: drill-down category list.
                        <ScrollView
                            className="flex-1"
                            contentContainerClassName="py-2"
                            keyboardShouldPersistTaps="handled"
                        >
                            {settingsGroups.map((group) => (
                                <Fragment key={group.title}>
                                    <Text className="px-6 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-discord-textMuted">
                                        {group.title}
                                    </Text>
                                    {group.tabs.map((tab) => (
                                        <Pressable
                                            key={tab.id}
                                            ref={(el) => {
                                                categoryEls.current[tab.id] =
                                                    el;
                                            }}
                                            accessibilityRole="button"
                                            onPress={() => selectTab(tab.id)}
                                            className="w-full flex-row items-center justify-between gap-3 px-6 py-3.5 hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                                        >
                                            <Text
                                                numberOfLines={1}
                                                className="min-w-0 flex-shrink truncate text-base font-medium text-discord-textPrimary"
                                            >
                                                {tab.label}
                                            </Text>
                                            <ChevronRight
                                                size={20}
                                                className="rtl:-scale-x-100 flex-shrink-0 text-discord-textMuted"
                                            />
                                        </Pressable>
                                    ))}
                                </Fragment>
                            ))}
                        </ScrollView>
                    ) : view.mode === "detail" ? (
                        // Mobile sub-page: one category, full screen.
                        <KeyboardAwareScrollView
                            ref={panelScroll as never}
                            // flex-1 overflow-y-auto min-w-0
                            style={{ flex: 1, minWidth: 0 }}
                            keyboardShouldPersistTaps="handled"
                            bottomOffset={16}
                        >
                            <View className="p-4 min-w-0">
                                <Animated.View
                                    key={view.tab}
                                    entering={fadeIn}
                                    className="min-w-0"
                                >
                                    {panel(view.tab)}
                                </Animated.View>
                            </View>
                        </KeyboardAwareScrollView>
                    ) : (
                        // Desktop: category sidebar beside the active panel.
                        <View className="flex-row flex-1 min-h-0">
                            <ScrollView
                                className="flex-shrink-0 w-40 border-e border-discord-divider min-h-0"
                                contentContainerClassName="gap-0.5 px-2 py-3"
                            >
                                {settingsGroups.map((group) => (
                                    <Fragment key={group.title}>
                                        <Text className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-discord-textMuted">
                                            {group.title}
                                        </Text>
                                        {group.tabs.map((tab) => (
                                            <Pressable
                                                key={tab.id}
                                                ref={(el) => {
                                                    sidebarEls.current[tab.id] =
                                                        el;
                                                }}
                                                accessibilityRole="button"
                                                onPress={() =>
                                                    selectTab(tab.id)
                                                }
                                                className={`flex-shrink-0 w-full px-3 py-2 rounded transition-colors ${
                                                    view.tab === tab.id
                                                        ? "bg-discord-messageHover"
                                                        : ""
                                                }`}
                                            >
                                                <Text
                                                    numberOfLines={1}
                                                    className={`text-sm font-medium ${
                                                        view.tab === tab.id
                                                            ? "text-discord-textPrimary"
                                                            : "text-discord-textMuted"
                                                    }`}
                                                >
                                                    {tab.label}
                                                </Text>
                                            </Pressable>
                                        ))}
                                    </Fragment>
                                ))}
                            </ScrollView>

                            <KeyboardAwareScrollView
                                ref={panelScroll as never}
                                // flex-1 overflow-y-auto min-w-0
                                style={{ flex: 1, minWidth: 0 }}
                                keyboardShouldPersistTaps="handled"
                                bottomOffset={16}
                            >
                                <View className="p-6 min-w-0">
                                    <Animated.View
                                        key={view.tab}
                                        entering={fadeIn}
                                        className="min-w-0"
                                    >
                                        {panel(view.tab)}
                                    </Animated.View>
                                </View>
                            </KeyboardAwareScrollView>
                        </View>
                    )}
                </View>
            </View>
        </Portal>
    );
}
