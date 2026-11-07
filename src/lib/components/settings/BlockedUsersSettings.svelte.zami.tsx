import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import Avatar from "$lib/components/ui/Avatar.svelte";
import {
    ignoredUsersState,
    unblockUser,
} from "$lib/stores/ignoredUsers.svelte";

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead.
export default function BlockedUsersSettings() {
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState("");
    const ignoredUserIds = useRune(() => ignoredUsersState.userIds);
    const userIds = [...ignoredUserIds].sort((a, b) => a.localeCompare(b));

    async function unblock(userId: string) {
        setPending(userId);
        setError("");
        try {
            await unblockUser(userId);
        } catch (unblockError) {
            setError(
                (unblockError as Error)?.message ??
                    t("blockedUsersSettings.failed"),
            );
        } finally {
            setPending(null);
        }
    }

    return (
        <View className="gap-4">
            <Text className="text-xs text-discord-textMuted">
                {t("blockedUsersSettings.messagesFromBlockedUsersAreHidden")}
            </Text>
            {error ? (
                <Text className="text-sm text-discord-danger">{error}</Text>
            ) : null}
            {userIds.length === 0 ? (
                <Text className="text-sm text-discord-textMuted text-center py-8">
                    {t("blockedUsersSettings.youHavenTBlockedAnyone")}
                </Text>
            ) : (
                <View className="gap-1">
                    {userIds.map((userId) => (
                        <View
                            key={userId}
                            className="flex-row items-center gap-3 p-2 rounded bg-discord-backgroundTertiary"
                        >
                            <Avatar
                                src={null}
                                name={userId.replace(/^@/, "")}
                                id={userId}
                                size={28}
                            />
                            <Text
                                numberOfLines={1}
                                className="flex-1 min-w-0 text-sm text-discord-textPrimary font-mono"
                            >
                                {userId}
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{
                                    disabled: pending === userId,
                                }}
                                onPress={() => {
                                    void unblock(userId);
                                }}
                                disabled={pending === userId}
                                className="px-2.5 py-1 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                            >
                                <Text className="text-xs font-semibold text-discord-textPrimary">
                                    {t("common.unblock")}
                                </Text>
                            </Pressable>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}
