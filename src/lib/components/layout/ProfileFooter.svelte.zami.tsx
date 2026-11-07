import {
    anchorElement,
    Image,
    mediaSource,
    SvgIcon,
} from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useRef, useState } from "react";
import { Pressable, type PressableInstance, Text, View } from "react-native";
import { Path } from "react-native-svg";
import { useResolveClassNames } from "uniwind";
import { t } from "$lib/i18n";
import { openEncryptionSetup } from "$lib/stores/onboarding.svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import AccountSwitcher from "$lib/components/layout/AccountSwitcher.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import {
    presenceDot,
    presenceDotClass,
    presenceLabel,
} from "$lib/utils/presence";
import { settingsState } from "$lib/stores/settings.svelte";
import { openModal, closeModal } from "$lib/stores/interface.svelte";
import { openProfileCard } from "$lib/stores/profileCard.svelte";
import { getOwnAvatarUrl, mxcToHttp } from "$lib/matrix/client";
import { richPresenceState } from "$lib/stores/richPresence.svelte";
import type { RpcEntry } from "$lib/utils/richPresence";
import {
    verificationStatusState,
    refreshVerificationStatus,
    dismissVerificationNudge,
} from "$lib/stores/verificationStatus.svelte";
import { securityState } from "$lib/stores/security.svelte";
import {
    verificationState,
    verifyWithAnotherDevice,
} from "$lib/stores/verification.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";

interface Props {
    onLogout: () => void;
    onSettings: () => void;
}

const entryName = (e: RpcEntry) => (e.kind === "activity" ? e.name : e.track);
const entryDetail = (e: RpcEntry) =>
    e.kind === "activity" ? (e.details ?? e.state) : e.artist;

export default function ProfileFooter({ onLogout, onSettings }: Props) {
    const userId = useRune(() => auth.userId);
    const activeRoomId = useRune(() => roomsState.activeRoomId);

    const ownAvatarSrc = useRune(() => {
        void roomsState.roomsTick;
        return getOwnAvatarUrl();
    });

    // The chosen state, not the server's: tuwunel reports the highest
    // state across all our sessions, so an away pick would never show.
    const ownPresenceState = useRune(() => settingsState.ownPresence);
    const ownPresence = {
        dotClass: presenceDotClass(presenceDot(ownPresenceState)),
        label: presenceLabel(ownPresenceState),
    };

    // What Zam is showing on the profile right now (a detected game, an app's
    // rich presence), so it is plain that it is being sent.
    const sharing = useRune(() => richPresenceState.active);

    const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
    function openAccountSwitcher() {
        openModal("account-switcher", () => setAccountSwitcherOpen(false));
        setAccountSwitcherOpen(true);
    }

    // Verification status refresh (guarded by tick to avoid re-triggering).
    // Zami: the effect's dependency on the tick is that guard.
    const verificationTick = useRune(
        () => securityState.securityTick + verificationState.verificationTick,
    );
    useEffect(() => {
        refreshVerificationStatus();
    }, [verificationTick]);

    // Verification nudge (shown only when actionable and not dismissed).
    const nudge = useRune(() =>
        verificationStatusState.view &&
        verificationStatusState.view.actionable &&
        !verificationStatusState.nudgeDismissed
            ? verificationStatusState.view
            : null,
    );

    // An unverified session can ask its siblings directly instead of going
    // through Security settings first. The footer has no error line, so a
    // failure to send surfaces as a toast.
    async function startVerifyWithAnotherDevice() {
        try {
            await verifyWithAnotherDevice();
        } catch (e) {
            showErrorToast(
                e instanceof Error
                    ? e.message
                    : t("verification.couldNotSendVerificationRequest"),
            );
        }
    }

    // Zami: the settings icon's stroke is `currentColor`, the button's text
    // color.
    const settingsIconColor = useResolveClassNames(
        "text-discord-textMuted",
    ).color;
    // Zami: openProfileCard() anchors the card to the button's
    // getBoundingClientRect(); the measured view stands in.
    const avatarButton = useRef<PressableInstance>(null);

    const toneClass = !nudge
        ? ""
        : nudge.tone === "verified"
          ? "text-discord-online"
          : nudge.tone === "warning"
            ? "text-discord-warning"
            : nudge.tone === "unverified"
              ? "text-discord-danger"
              : "text-discord-textMuted";
    // Zami: no `bg-current`: the dot takes the tone's color as a background.
    const toneDotClass = !nudge
        ? ""
        : nudge.tone === "verified"
          ? "bg-discord-online"
          : nudge.tone === "warning"
            ? "bg-discord-warning"
            : nudge.tone === "unverified"
              ? "bg-discord-danger"
              : "bg-discord-textMuted";

    return (
        <>
            {nudge && (
                <View className="w-full px-2 py-1.5 flex-row items-center gap-2 bg-discord-backgroundTertiary border-t border-discord-divider flex-shrink-0">
                    <View className={`w-2 h-2 rounded-full ${toneDotClass}`} />
                    {/* Zami: `title` (the nudge's detail) has no React Native
                        equivalent. */}
                    <Text
                        numberOfLines={1}
                        className={`flex-1 text-xs ${toneClass} truncate`}
                    >
                        {nudge.label}
                    </Text>
                    {!!nudge.actionLabel && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => openEncryptionSetup()}
                            className="px-2 py-0.5"
                        >
                            <Text className={`text-xs ${toneClass}`}>
                                {nudge.actionLabel}
                            </Text>
                        </Pressable>
                    )}
                    {nudge.kind === "unverified" && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void startVerifyWithAnotherDevice()}
                            className="px-2 py-0.5"
                        >
                            <Text
                                numberOfLines={1}
                                className={`text-xs ${toneClass} whitespace-nowrap`}
                            >
                                {t("verification.useAnotherDevice")}
                            </Text>
                        </Pressable>
                    )}
                    <Pressable
                        accessibilityRole="button"
                        onPress={dismissVerificationNudge}
                        accessibilityLabel={t("profileFooter.dismiss")}
                    >
                        <Text className="text-discord-textMuted text-sm">
                            ×
                        </Text>
                    </Pressable>
                </View>
            )}

            {sharing.map((entry) => {
                const art =
                    entry.kind === "activity"
                        ? entry.largeIconUrl
                        : entry.coverUrl;
                const detail = entryDetail(entry);
                return (
                    // Zami: `title` has no React Native equivalent.
                    <View
                        key={entry.id}
                        className="w-full px-2 py-1.5 flex-row items-center gap-2 bg-discord-backgroundSecondary border-t border-discord-divider flex-shrink-0"
                    >
                        {!!art && (
                            <Image
                                className="h-8 w-8 flex-shrink-0 rounded"
                                contentFit="cover"
                                source={mediaSource(
                                    mxcToHttp(art, 64, 64, "crop"),
                                )}
                                accessible={false}
                            />
                        )}
                        <View className="flex-1 min-w-0">
                            <Text
                                numberOfLines={1}
                                className="text-sm font-semibold text-discord-textPrimary truncate"
                            >
                                {entryName(entry)}
                            </Text>
                            <Text
                                numberOfLines={1}
                                className="text-xs text-discord-textMuted truncate"
                            >
                                {detail || t("richPresence.sharingTitle")}
                            </Text>
                        </View>
                    </View>
                );
            })}

            <View className="w-full h-14 px-2 flex-row items-center gap-2 bg-discord-backgroundTertiary flex-shrink-0">
                <View className="flex-1 flex-row items-center gap-2 min-w-0">
                    {/* The profile card needs a room for power levels, and is mounted
                        with the room view, so there is nothing to open without one. */}
                    {/* Zami: the button's `title` is its only name (the avatar is
                        an image), so it's the accessibility label. The dot's
                        `title` has no React Native equivalent. */}
                    <Pressable
                        ref={avatarButton}
                        accessibilityRole="button"
                        onPress={() => {
                            const me = auth.userId;
                            if (me && roomsState.activeRoomId)
                                void anchorElement(avatarButton.current).then(
                                    (el) => openProfileCard(me, el),
                                );
                            else openAccountSwitcher();
                        }}
                        className="relative flex-shrink-0 rounded-full"
                        accessibilityLabel={
                            activeRoomId
                                ? t("messageItem.viewProfile")
                                : t("profileFooter.switchAccounts")
                        }
                    >
                        <Avatar
                            src={ownAvatarSrc}
                            name={userId || "?"}
                            id={userId}
                            size={32}
                        />
                        <View
                            className={`absolute bottom-0 end-0 w-3 h-3 ${ownPresence.dotClass} rounded-full border-2 border-discord-backgroundTertiary`}
                        />
                    </Pressable>
                    {/* Zami: `title` has no React Native equivalent; the texts
                        name the button. */}
                    <Pressable
                        accessibilityRole="button"
                        onPress={openAccountSwitcher}
                        className="flex-1 min-w-0 rounded p-1 -m-1 hover:bg-discord-messageHover transition-colors"
                    >
                        <Text
                            numberOfLines={1}
                            className="text-sm font-semibold text-discord-textPrimary truncate"
                        >
                            {userId?.split(":")[0].replace("@", "") ??
                                t("profileFooter.unknown")}
                        </Text>
                        <Text
                            numberOfLines={1}
                            className="text-xs text-discord-textSecondary truncate"
                        >
                            {userId ?? ""}
                        </Text>
                    </Pressable>
                </View>
                <Pressable
                    accessibilityRole="button"
                    onPress={onSettings}
                    className="p-1.5 rounded hover:bg-discord-messageHover transition-colors"
                    accessibilityLabel={t("common.settings")}
                >
                    <SvgIcon className="w-5 h-5">
                        <Path
                            fill="none"
                            stroke={settingsIconColor}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <Path
                            fill="none"
                            stroke={settingsIconColor}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                    </SvgIcon>
                </Pressable>
            </View>

            {accountSwitcherOpen && (
                <AccountSwitcher onClose={closeModal} onLogout={onLogout} />
            )}
        </>
    );
}
