import { Image, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useState, type ReactNode } from "react";
import {
    Pressable,
    ScrollView,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "$lib/i18n";
import { goto } from "$app/navigation";
import {
    Check,
    ChevronLeft,
    ChevronRight,
    Pencil,
    SmilePlus,
    Users,
} from "lucide-svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import AccountAvatar from "$lib/components/layout/AccountAvatar.svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import OwnStatusEditor from "$lib/components/layout/OwnStatusEditor.svelte";
import Portal from "$lib/components/ui/Portal.svelte";
import { accountsState, removeAccountById } from "$lib/stores/accounts.svelte";
import { auth } from "$lib/stores/auth.svelte";
import {
    interfaceState,
    closeModal,
    openAppSettingsTab,
} from "$lib/stores/interface.svelte";
import {
    getOwnAvatarUrl,
    getOwnDisplayName,
    mxcToHttp,
    signOutStoredAccount,
} from "$lib/matrix/client";
import { deleteCryptoStore } from "$lib/matrix/crypto";
import { deleteEventIndex } from "$lib/matrix/eventIndex";
import {
    changeOwnPresence,
    changeDoNotDisturb,
} from "$lib/stores/presence.svelte";
import {
    getCachedProfile,
    nameColourFor,
    requestProfile,
} from "$lib/stores/profileFields.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import { aliasUserLocalpart, shownHomeserver } from "$lib/utils/streamerAlias";
import {
    PROFILE_FIELDS,
    formatStatusMessage,
    parseBanner,
    parsePronouns,
    parseStatus,
    pronounsToText,
    readFieldWithLegacy,
} from "$lib/utils/extendedProfile";
import { switchToAccount } from "$lib/stores/accountSwitch";
import {
    OWN_PRESENCE_OPTIONS,
    presenceDot,
    presenceDotClass,
    presenceLabel,
    type PresenceState,
} from "$lib/utils/presence";

interface Props {
    onClose: () => void;
    /** Existing app-shell logout flow (used for the active account). */
    onLogout: () => void;
}

// Which sub-view is showing. Desktop opens "presence" and "accounts" as
// flyouts beside the card (Discord style); touch drills into them in place.
// "status" is the inline status editor on both.
// Zami: `MenuView`, as `View` is React Native's.
type MenuView = "main" | "status" | "presence" | "accounts";

export default function AccountSwitcher({ onClose, onLogout }: Props) {
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();

    const [view, setView] = useState<MenuView>("main");
    const isTouch = useRune(() => interfaceState.isTouchscreen);

    // Two-click confirm for the destructive per-row sign-out.
    const [confirmSignOutId, setConfirmSignOutId] = useState<string | null>(
        null,
    );
    const [presenceError, setPresenceError] = useState("");

    const me = useRune(() => auth.userId ?? "");
    useEffect(() => {
        if (me) requestProfile(me);
    }, [me]);
    const profile = useRune(() => getCachedProfile(me), [me]);
    const field = (key: keyof typeof PROFILE_FIELDS) =>
        readFieldWithLegacy(profile, PROFILE_FIELDS[key]);
    const status = parseStatus(field("status"));
    const pronouns = pronounsToText(parsePronouns(field("pronouns")));
    const bannerSrc = mxcToHttp(parseBanner(field("banner")), 320, 96, "crop");
    const nameColour = useRune(() => nameColourFor(me), [me]);
    const displayName = useRune(
        () => (void roomsState.roomsTick, getOwnDisplayName() ?? me),
        [me],
    );
    const avatarSrc = useRune(
        () => (void roomsState.roomsTick, getOwnAvatarUrl()),
    );
    // The chosen state, not the server's: tuwunel reports the highest state
    // across all our sessions, so an away pick would never show.
    const presenceValue = useRune<PresenceState>(
        () => settingsState.ownPresence,
    );
    // Zami: the registry is replaced on every change, so reading it is enough.
    const accounts = useRune(() => accountsState.registry.accounts);
    const doNotDisturb = useRune(() => settingsState.doNotDisturb);
    const streamerMode = useRune(() => settingsState.streamerMode);
    const activeUserId = useRune(() => auth.userId);

    function serverHost(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }

    function open(next: MenuView): void {
        setView(next);
    }

    /** Desktop hover opens a flyout; leaving to a plain row closes it. */
    function hoverView(next: MenuView): void {
        if (!isTouch && view !== "status") setView(next);
    }

    function editProfile(): void {
        openAppSettingsTab("account");
    }

    async function setPresence(value: PresenceState): Promise<void> {
        setPresenceError("");
        try {
            await changeOwnPresence(value);
            setView("main");
        } catch (e) {
            setPresenceError(
                (e as Error)?.message ??
                    t("accountSwitcher.couldNotSetPresence"),
            );
        }
    }

    async function toggleDoNotDisturb(): Promise<void> {
        setPresenceError("");
        try {
            await changeDoNotDisturb(!settingsState.doNotDisturb);
            setView("main");
        } catch (e) {
            setPresenceError(
                (e as Error)?.message ??
                    t("accountSwitcher.couldNotSetPresence"),
            );
        }
    }

    async function switchTo(userId: string): Promise<void> {
        if (userId === auth.userId) {
            onClose();
            return;
        }
        await switchToAccount(userId);
    }

    function addAccount(): void {
        onClose();
        goto("/?add");
    }

    async function signOut(userId: string): Promise<void> {
        if (confirmSignOutId !== userId) {
            setConfirmSignOutId(userId);
            return;
        }
        setConfirmSignOutId(null);
        if (userId === auth.userId) {
            onClose();
            onLogout();
            return;
        }
        const account = accountsState.registry.accounts.find(
            (a) => a.userId === userId,
        );
        if (!account) return;
        // Best-effort server-side token invalidation (spec-compliant
        // servers drop the token's pushers with it; OAuth accounts are
        // revoked at their provider). Local removal happens regardless:
        // the account leaves this device either way.
        await signOutStoredAccount(account);
        // Wipe this account's rust-crypto store on its way off the device — it
        // has no live client, so we delete the IndexedDB directly (keyed to
        // this account, so it can't touch the active session's keys).
        await deleteCryptoStore(account.userId, account.deviceId);
        await deleteEventIndex(account.userId, account.deviceId);
        removeAccountById(userId);
    }

    // Zami: Uniwind has no `divide-y` or `first:`/`last:` (child selectors), and
    // no `rounded-[inherit]`: each row gets its own rounding, and the rows after
    // the first a top border. The text classes move to each row's `Text`.
    const rowClass =
        "w-full flex-row items-center gap-3 px-3 py-2.5 hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors";
    const rowTextClass = "flex-1 text-sm text-discord-textPrimary";
    const groupClass = "mx-2 mt-2 rounded-lg bg-discord-backgroundTertiary/60";
    const flyoutClass =
        "absolute left-full bottom-0 ml-2 w-64 rounded-lg bg-discord-backgroundSecondary border border-discord-divider shadow-xl p-1.5 z-10";

    const presenceMenu = () => (
        <>
            {OWN_PRESENCE_OPTIONS.map((option) => (
                <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    onPress={() => void setPresence(option.value)}
                    className="w-full flex-row items-center gap-3 p-2 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                >
                    <View
                        className={`w-3 h-3 rounded-full flex-shrink-0 ${presenceDotClass(
                            presenceDot(option.value),
                        )}`}
                    />
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {option.label}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {option.description}
                        </Text>
                    </View>
                    {presenceValue === option.value && (
                        <Check
                            size={16}
                            className="text-discord-accent flex-shrink-0"
                        />
                    )}
                </Pressable>
            ))}
            <Pressable
                accessibilityRole="button"
                onPress={() => void toggleDoNotDisturb()}
                className="w-full flex-row items-center gap-3 p-2 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
            >
                <View className="w-3 h-3 rounded-full flex-shrink-0 bg-discord-dnd" />
                <View className="flex-1 min-w-0">
                    <Text className="text-sm text-discord-textPrimary">
                        {t("presence.doNotDisturb")}
                    </Text>
                    <Text className="text-xs text-discord-textMuted">
                        {t("presence.doNotDisturbDescription")}
                    </Text>
                </View>
                {doNotDisturb && (
                    <Check
                        size={16}
                        className="text-discord-accent flex-shrink-0"
                    />
                )}
            </Pressable>
            {presenceError ? (
                <Text className="px-2 py-1 text-xs text-discord-danger">
                    {presenceError}
                </Text>
            ) : null}
        </>
    );

    const accountsMenu = () => (
        <>
            {accounts.map((account) => {
                const isActive = account.userId === activeUserId;
                const confirming = confirmSignOutId === account.userId;
                return (
                    <View
                        key={account.userId}
                        className="flex-row items-center gap-2 rounded hover:bg-discord-messageHover transition-colors"
                    >
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void switchTo(account.userId)}
                            className="flex-1 flex-row items-center gap-2.5 p-2 min-w-0"
                        >
                            <AccountAvatar account={account} size={32} />
                            <View className="flex-1 min-w-0">
                                {/* Zami: not ported: streamer-hide (streamer mode's blur) */}
                                <Text
                                    numberOfLines={1}
                                    className="text-sm text-discord-textPrimary"
                                >
                                    {streamerMode
                                        ? aliasUserLocalpart(account.userId)
                                        : (account.displayName ??
                                          account.userId)}
                                </Text>
                                <Text
                                    numberOfLines={1}
                                    className="text-xs text-discord-textMuted"
                                >
                                    {shownHomeserver(
                                        serverHost(account.homeserverUrl),
                                        streamerMode,
                                    )}
                                </Text>
                            </View>
                            {isActive && (
                                <Check
                                    size={16}
                                    className="text-discord-accent flex-shrink-0"
                                />
                            )}
                        </Pressable>
                        {/* `group-focus-within/account:opacity-100` is the keyboard
                            analogue of the row-hover reveal below it. Without it the
                            focus trap makes this destructive control the second tab
                            stop while `opacity-0` hides both it and its focus ring.
                            Zami: Uniwind has no `group-hover`/`group-focus-within`,
                            so the control always shows, as upstream's `!opacity-100`
                            does on touch. */}
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("accountSwitcher.signOut", {
                                userId: account.userId,
                            })}
                            onPress={() => void signOut(account.userId)}
                            className={`flex-shrink-0 px-2 py-1 me-1 rounded transition-colors ${
                                confirming ? "bg-discord-danger" : ""
                            }`}
                        >
                            <Text
                                className={`text-xs font-medium ${
                                    confirming
                                        ? "text-white"
                                        : "text-discord-textMuted hover:text-discord-danger"
                                }`}
                            >
                                {confirming
                                    ? t("accountSwitcher.confirm")
                                    : t("accountSwitcher.signOut2")}
                            </Text>
                        </Pressable>
                    </View>
                );
            })}

            <View className="my-1 border-t border-discord-divider" />

            <Pressable
                accessibilityRole="button"
                onPress={addAccount}
                className="w-full flex-row items-center gap-2.5 p-2 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
            >
                <View className="w-8 h-8 rounded-full bg-discord-backgroundTertiary flex-row items-center justify-center flex-shrink-0">
                    <Text className="text-discord-accent text-lg font-bold">
                        +
                    </Text>
                </View>
                <Text className="text-sm text-discord-textPrimary">
                    {t("accountSwitcher.addAccount")}
                </Text>
            </Pressable>
        </>
    );

    const backButton = (className: string) => (
        <Pressable
            accessibilityRole="button"
            onPress={() => open("main")}
            className={`flex-row items-center gap-1 self-start ${className}`}
        >
            {/* Zami: `mirror:` (`:dir(rtl)`) → Uniwind's `rtl:`. */}
            <ChevronLeft
                className="rtl:-scale-x-100 text-discord-textMuted"
                size={16}
            />
            <Text className="text-sm text-discord-textMuted hover:text-discord-textPrimary">
                {t("accountSwitcher.back")}
            </Text>
        </Pressable>
    );

    const content: ReactNode =
        isTouch &&
        (view === "presence" || view === "accounts" || view === "status") ? (
            <View className="p-2">
                {backButton("px-2 py-1.5")}
                {view === "presence" ? (
                    presenceMenu()
                ) : view === "accounts" ? (
                    accountsMenu()
                ) : (
                    <View className="px-2 pt-1">
                        <OwnStatusEditor onDone={() => open("main")} />
                    </View>
                )}
            </View>
        ) : (
            <>
                {/* Profile card header */}
                {bannerSrc ? (
                    <Image
                        source={mediaSource(bannerSrc)}
                        contentFit="cover"
                        className="h-24 w-full rounded-t-lg"
                    />
                ) : (
                    <View className="h-24 rounded-t-lg bg-discord-accent" />
                )}

                <View className="px-4">
                    <View className="flex-row items-start gap-2">
                        {/* Zami: the dot's `title` (a tooltip) → its
                            accessibility label. */}
                        <View className="relative -mt-10 flex-shrink-0 rounded-full border-[5px] border-discord-backgroundSecondary">
                            <Avatar
                                src={avatarSrc}
                                name={displayName}
                                id={me}
                                size={80}
                            />
                            <View
                                accessible
                                accessibilityLabel={presenceLabel(
                                    presenceValue,
                                )}
                                className={`absolute bottom-0.5 end-0.5 w-5 h-5 rounded-full border-4 border-discord-backgroundSecondary ${presenceDotClass(
                                    presenceDot(presenceValue),
                                )}`}
                            />
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t(
                                "accountSwitcher.setYourStatus",
                            )}
                            onPress={() =>
                                open(view === "status" ? "main" : "status")
                            }
                            className="mt-1 flex-shrink max-w-[11rem] flex-row items-center gap-2 rounded-2xl bg-discord-backgroundTertiary/80 hover:bg-discord-messageHover active:bg-discord-messageHover px-3 py-2 transition-colors"
                        >
                            {status ? (
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-sm text-discord-textSecondary"
                                >
                                    {formatStatusMessage(status)}
                                </Text>
                            ) : (
                                <>
                                    <SmilePlus
                                        size={16}
                                        className="flex-shrink-0 text-discord-textSecondary"
                                    />
                                    <Text
                                        numberOfLines={1}
                                        className="flex-shrink italic text-sm text-discord-textSecondary"
                                    >
                                        {t("accountSwitcher.setAStatus")}
                                    </Text>
                                </>
                            )}
                        </Pressable>
                    </View>

                    <Text
                        numberOfLines={1}
                        className="mt-2 text-xl font-bold text-discord-textPrimary"
                        style={nameColour ? { color: nameColour } : undefined}
                    >
                        {displayName}
                    </Text>
                    <Text
                        numberOfLines={1}
                        className="text-sm text-discord-textSecondary"
                    >
                        {me}
                        {pronouns ? ` • ${pronouns}` : ""}
                    </Text>
                </View>

                {view === "status" ? (
                    <View className="mx-4 mt-3">
                        {backButton("-ms-1 mb-2 px-1 py-1")}
                        <OwnStatusEditor onDone={() => open("main")} />
                    </View>
                ) : (
                    <>
                        <View className={groupClass}>
                            <Pressable
                                accessibilityRole="button"
                                onPress={editProfile}
                                onHoverIn={() => hoverView("main")}
                                className={`${rowClass} rounded-t-lg`}
                            >
                                <Pencil
                                    size={18}
                                    className="text-discord-textMuted"
                                />
                                <Text className={rowTextClass}>
                                    {t("accountSwitcher.editProfile")}
                                </Text>
                            </Pressable>
                            {/* Zami: the wrapper's `onmouseenter` → the row's
                                `onHoverIn` (a pointer, on iPad). */}
                            <View className="relative border-t border-discord-divider">
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        expanded: view === "presence",
                                    }}
                                    onPress={() =>
                                        open(
                                            view === "presence"
                                                ? "main"
                                                : "presence",
                                        )
                                    }
                                    onHoverIn={() => hoverView("presence")}
                                    className={`${rowClass} rounded-b-lg`}
                                >
                                    <View
                                        className={`w-3 h-3 rounded-full ms-0.5 me-0.5 flex-shrink-0 ${presenceDotClass(
                                            presenceDot(presenceValue),
                                        )}`}
                                    />
                                    <Text className={rowTextClass}>
                                        {presenceLabel(presenceValue)}
                                    </Text>
                                    <ChevronRight
                                        size={16}
                                        className="rtl:-scale-x-100 text-discord-textMuted"
                                    />
                                </Pressable>
                                {view === "presence" && !isTouch && (
                                    <View className={flyoutClass}>
                                        {presenceMenu()}
                                    </View>
                                )}
                            </View>
                        </View>

                        <View className={groupClass}>
                            <View className="relative">
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        expanded: view === "accounts",
                                    }}
                                    onPress={() =>
                                        open(
                                            view === "accounts"
                                                ? "main"
                                                : "accounts",
                                        )
                                    }
                                    onHoverIn={() => hoverView("accounts")}
                                    className={`${rowClass} rounded-lg`}
                                >
                                    <Users
                                        size={18}
                                        className="text-discord-textMuted"
                                    />
                                    <Text className={rowTextClass}>
                                        {t("accountSwitcher.switchAccounts")}
                                    </Text>
                                    <ChevronRight
                                        size={16}
                                        className="rtl:-scale-x-100 text-discord-textMuted"
                                    />
                                </Pressable>
                                {view === "accounts" && !isTouch && (
                                    <View className={flyoutClass}>
                                        {accountsMenu()}
                                    </View>
                                )}
                            </View>
                        </View>
                    </>
                )}
            </>
        );

    return (
        <Portal>
            {/*
              Anchored popover on desktop, bottom sheet on touch — not a centred
              dialog, so the layer gets no flex centring and the panel is positioned
              `absolute` INSIDE the shell's `fixed inset-0` layer. That layer spans the
              viewport, so `bottom-16 left-2` / `inset-x-0 bottom-0` resolve exactly
              where the old `fixed` panel sat. The backdrop stays invisible on desktop
              (it is only a light-dismiss click catcher) and keeps its scrim on touch.
              `cursor-default` on that invisible branch only: the shell's backdrop is a
              real <button>, and preflight's `button{cursor:pointer}` would otherwise
              turn the whole viewport into a pointer region with nothing visible under
              it. The dimmed touch scrim keeps the pointer cursor, which is correct.
              There is no heading element, so the dialog is named directly. Flyouts and
              the emoji picker are absolutely positioned off this panel, so it must not
              clip its overflow.
            */}
            <ModalDialog
                onClose={closeModal}
                label={t("accountSwitcher.accountMenu")}
                layerClass="z-50"
                backdropClass={isTouch ? "bg-black/40" : "cursor-default"}
                panelClass={`absolute bg-discord-backgroundSecondary border border-discord-divider shadow-xl ${
                    isTouch
                        ? "inset-x-0 bottom-0 rounded-t-lg"
                        : "bottom-16 left-2 w-80 rounded-lg pb-2"
                }`}
                closeLabel={t("accountSwitcher.closeAccountMenu")}
            >
                {/* Zami: on touch, `max-h-[85dvh] overflow-y-auto` → a ScrollView
                    capped at 85% of the window, and its `pb-4` clears the home
                    indicator too. */}
                {isTouch ? (
                    <ScrollView
                        keyboardShouldPersistTaps="handled"
                        style={{ maxHeight: windowHeight * 0.85 }}
                        contentContainerStyle={{
                            paddingBottom: 16 + insets.bottom,
                        }}
                    >
                        {content}
                    </ScrollView>
                ) : (
                    content
                )}
            </ModalDialog>
        </Portal>
    );
}
