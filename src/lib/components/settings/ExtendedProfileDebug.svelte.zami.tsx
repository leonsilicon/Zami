import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import {
    fetchOwnExtendedProfile,
    getPresence,
    getServerCapabilities,
} from "$lib/matrix/client";
import { auth } from "$lib/stores/auth.svelte";

export default function ExtendedProfileDebug() {
    // The raw profile as the server returns it, fetched fresh on demand, so a
    // missing or misnamed field can be told apart from a display problem.
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [profile, setProfile] = useState<
        Record<string, unknown> | null | undefined
    >(undefined);
    const [profileFields, setProfileFields] = useState<unknown>(undefined);
    const [presence, setPresence] = useState<unknown>(undefined);
    const userId = useRune(() => auth.userId);

    const profileJson =
        profile === undefined ? "" : JSON.stringify(profile, null, 2);

    async function load() {
        setLoading(true);
        setError("");
        try {
            const [fetched, capabilities, presenceNow] = await Promise.all([
                fetchOwnExtendedProfile(),
                getServerCapabilities().catch(() => ({})),
                userId ? getPresence(userId) : null,
            ]);
            setProfile(fetched);
            setPresence(presenceNow);
            setProfileFields(
                (capabilities as Record<string, unknown>)["m.profile_fields"],
            );
        } catch (e) {
            setProfile(undefined);
            setError(
                (e as Error)?.message ??
                    t("extendedProfileDebug.failedToFetchTheProfile"),
            );
        } finally {
            setLoading(false);
        }
    }

    async function copy() {
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(profileJson);
        } catch {
            setError(t("extendedProfileDebug.couldNotCopyToClipboard"));
        }
    }

    return (
        <View>
            <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                {t("extendedProfileDebug.extendedProfile")}
            </Text>
            <View className="flex-row gap-2 mb-2">
                <Pressable
                    accessibilityRole="button"
                    onPress={load}
                    disabled={loading}
                    className="px-3 py-1.5 bg-discord-accent rounded disabled:opacity-50"
                >
                    <Text className="text-white text-sm">
                        {loading
                            ? t("common.loading")
                            : t("extendedProfileDebug.fetchFromServer")}
                    </Text>
                </Pressable>
                {profile && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={copy}
                        className="px-3 py-1.5 bg-discord-backgroundTertiary rounded"
                    >
                        <Text className="text-discord-textPrimary text-sm">
                            {t("common.copy")}
                        </Text>
                    </Pressable>
                )}
            </View>
            {error ? (
                <Text className="text-xs text-discord-danger">{error}</Text>
            ) : null}
            {profile === null ? (
                <Text className="text-xs text-discord-textMuted">
                    {t("extendedProfileDebug.thisServerDoesNotSupportExtended")}
                </Text>
            ) : profile ? (
                <>
                    {/* Zami: <pre> → a nested ScrollView; Text keeps the JSON's
                        line breaks and indentation. */}
                    <ScrollView
                        nestedScrollEnabled
                        className="bg-discord-backgroundTertiary rounded max-h-96"
                        contentContainerClassName="p-3"
                    >
                        <Text
                            selectable
                            className="text-xs font-mono text-discord-textSecondary"
                        >
                            {profileJson}
                        </Text>
                    </ScrollView>
                    <Text className="mt-2 text-xs text-discord-textMuted">
                        {t(
                            "extendedProfileDebug.presenceGetPresenceStraightFromThe",
                            {
                                value: presence
                                    ? JSON.stringify(presence)
                                    : t(
                                          "extendedProfileDebug.noneOrTheServerRefused",
                                      ),
                            },
                        )}
                    </Text>
                    <Text className="mt-1 text-xs text-discord-textMuted">
                        {t(
                            "extendedProfileDebug.serverRulesForFieldsMProfile",
                            {
                                value:
                                    profileFields === undefined
                                        ? t(
                                              "extendedProfileDebug.notAdvertisedNoRestrictions",
                                          )
                                        : JSON.stringify(profileFields),
                            },
                        )}
                    </Text>
                </>
            ) : null}
        </View>
    );
}
