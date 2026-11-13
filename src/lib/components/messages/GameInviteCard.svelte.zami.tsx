import { Image, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import { Gamepad2 } from "lucide-svelte";
import type { MessageKey } from "$lib/i18n/en";
import { steamIconUrl, type ParsedGameInvite } from "$lib/utils/gameInvite";

interface Props {
    invite: ParsedGameInvite;
}

type JoinError = "unsupported" | "invalid";
const JOIN_ERROR: Record<JoinError, MessageKey> = {
    unsupported: "gameInvite.joinUnsupported",
    invalid: "gameInvite.joinInvalid",
};

export default function GameInviteCard({ invite }: Props) {
    // The game's icon when the invite has one and it loads; else the gamepad.
    const [iconFailed, setIconFailed] = useState(false);
    const iconUrl =
        invite.steam.icon && !iconFailed
            ? steamIconUrl(invite.steam.appId, invite.steam.icon)
            : null;

    const [confirming, setConfirming] = useState(false);
    const [joining, setJoining] = useState(false);
    const [joined, setJoined] = useState(false);
    const [joinError, setJoinError] = useState<MessageKey | null>(null);

    // Joining needs the desktop app's launcher; the browser has none.
    // Zami: not ported: launching the game. A phone has no desktop launcher
    // (`window.desktop` is never set here) and can't run a Steam game, so the
    // card says to open it in the desktop app, as Zam's browser build does.
    const canJoin =
        typeof window !== "undefined" &&
        typeof window.desktop?.richPresence?.joinGame === "function";

    // Said in plain text: the arguments are shown exactly as they will run. A
    // lobby join (steam://joinlobby, see steamJoinLink) has no arguments.
    const viaLobby = !!(invite.steam.steamId && invite.steam.lobbyId);
    const confirmText = viaLobby
        ? t("gameInvite.confirmLobby", { game: invite.name })
        : t("gameInvite.confirmSteam", {
              game: invite.name,
              connect: invite.steam.connect ?? "",
          });

    async function join() {
        const bridge = window.desktop?.richPresence;
        if (!bridge?.joinGame || joining) return;
        setJoining(true);
        setJoinError(null);
        try {
            const res = await bridge.joinGame({
                kind: "steam",
                appId: invite.steam.appId,
                connect: invite.steam.connect,
                steamId: invite.steam.steamId,
                lobbyId: invite.steam.lobbyId,
            });
            if (res.ok) {
                setJoined(true);
                setConfirming(false);
            } else {
                setJoinError(JOIN_ERROR[res.error] ?? "gameInvite.joinFailed");
            }
        } catch {
            setJoinError("gameInvite.joinFailed");
        } finally {
            setJoining(false);
        }
    }

    return (
        <View className="mt-1 max-w-md rounded-lg border border-discord-divider bg-discord-backgroundSecondary px-3 py-2.5">
            <View className="flex-row items-center gap-2.5">
                {iconUrl ? (
                    // Zami: `referrerpolicy="no-referrer"` and lazy loading
                    // have no expo-image equivalent; a native request sends
                    // no referrer.
                    <Image
                        source={mediaSource(iconUrl)}
                        accessibilityIgnoresInvertColors
                        className="h-8 w-8 flex-shrink-0 rounded"
                        onError={() => setIconFailed(true)}
                    />
                ) : (
                    <Gamepad2
                        size={20}
                        className="flex-shrink-0 text-discord-textMuted"
                    />
                )}
                <View className="min-w-0 flex-1">
                    <Text className="text-xs text-discord-textMuted">
                        {t("gameInvite.cardTitle")} ·{" "}
                        {t("gameInvite.sourceSteam")}
                    </Text>
                    <Text
                        numberOfLines={1}
                        className="text-sm font-semibold text-discord-textPrimary"
                    >
                        {invite.name}
                    </Text>
                </View>
            </View>

            {!!(invite.details || invite.state || invite.partySize) && (
                <View className="mt-2 flex-col gap-0.5">
                    {!!invite.details && (
                        <Text className="text-xs text-discord-textPrimary break-words">
                            {invite.details}
                        </Text>
                    )}
                    {!!invite.state && (
                        <Text className="text-xs text-discord-textMuted break-words">
                            {invite.state}
                        </Text>
                    )}
                    {invite.partySize && (
                        <Text className="text-xs text-discord-textMuted">
                            {t("gameInvite.partySize", {
                                current: invite.partySize[0],
                                max: invite.partySize[1],
                            })}
                        </Text>
                    )}
                </View>
            )}

            {!!invite.note && (
                <Text className="mt-2 text-sm text-discord-textPrimary whitespace-pre-wrap break-words">
                    {invite.note}
                </Text>
            )}

            {joined ? (
                <Text className="mt-2 text-xs text-discord-textMuted">
                    {t("gameInvite.joinSent")}
                </Text>
            ) : !canJoin ? (
                <Text className="mt-2 text-xs text-discord-textMuted">
                    {t("gameInvite.openInDesktop")}
                </Text>
            ) : confirming ? (
                <>
                    <Text className="mt-2 text-xs text-discord-textPrimary break-all">
                        {confirmText}
                    </Text>
                    <View className="mt-2 flex-row items-center gap-2">
                        <Pressable
                            accessibilityRole="button"
                            disabled={joining}
                            accessibilityState={{ disabled: joining }}
                            onPress={() => void join()}
                            className={`px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors ${
                                joining ? "opacity-50" : ""
                            }`}
                        >
                            <Text className="text-white text-xs font-semibold">
                                {joining
                                    ? t("common.joining")
                                    : t("gameInvite.joinGame")}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            disabled={joining}
                            accessibilityState={{ disabled: joining }}
                            onPress={() => setConfirming(false)}
                            className="px-3 py-1.5 rounded"
                        >
                            <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary transition-colors">
                                {t("common.cancel")}
                            </Text>
                        </Pressable>
                    </View>
                </>
            ) : (
                <Pressable
                    accessibilityRole="button"
                    className="mt-2 self-start px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors"
                    onPress={() => {
                        setJoinError(null);
                        setConfirming(true);
                    }}
                >
                    <Text className="text-white text-xs font-semibold">
                        {t("common.join")}
                    </Text>
                </Pressable>
            )}

            {joinError && (
                <Text
                    className="mt-2 text-xs text-discord-danger"
                    accessibilityRole="alert"
                >
                    {t(joinError)}
                </Text>
            )}
        </View>
    );
}
