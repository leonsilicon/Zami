import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import {
    getServerCapabilities,
    getServerVersions,
    probeCallingSupport,
} from "$lib/matrix/client";
import { auth } from "$lib/stores/auth.svelte";
import {
    labelUnstableFeature,
    serverSupports,
    specAtLeast,
    type GatedFeature,
} from "$lib/utils/serverCapabilities";

type Support = "yes" | "no" | "unknown";
interface FeatureRow {
    label: string;
    support: Support;
}

// Zami: `space-y-*` (a child selector) does nothing in React Native; the sections and
// rows are spaced with the same `gap-*` instead.
export default function ServerSettings() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [specVersions, setSpecVersions] = useState<string[]>([]);
    const [features, setFeatures] = useState<FeatureRow[]>([]);
    const [roomVersion, setRoomVersion] = useState("");
    const [unstableLabels, setUnstableLabels] = useState<string[]>([]);
    const [callingFeatures, setCallingFeatures] = useState<FeatureRow[]>([]);
    const homeserverUrl = useRune(() => auth.homeserverUrl);

    function badge(support: Support): { text: string; cls: string } {
        if (support === "yes") {
            return {
                text: t("serverSettings.supported"),
                cls: "text-discord-textPositive",
            };
        }
        if (support === "no") {
            return {
                text: t("serverSettings.notSupported"),
                cls: "text-discord-danger",
            };
        }
        return {
            text: t("serverSettings.unknown"),
            cls: "text-discord-textMuted",
        };
    }

    async function load() {
        setLoading(true);
        setError("");
        try {
            const [versions, capabilities, calling] = await Promise.all([
                getServerVersions(),
                getServerCapabilities(),
                probeCallingSupport(),
            ]);
            setSpecVersions(versions.versions);
            const gate = (feature: GatedFeature): Support =>
                serverSupports(feature, capabilities) ? "yes" : "no";
            setFeatures([
                {
                    label: t("serverSettings.changePassword"),
                    support: gate("changePassword"),
                },
                {
                    label: t("serverSettings.changeDisplayName"),
                    support: gate("setDisplayName"),
                },
                {
                    label: t("serverSettings.changeAvatar"),
                    support: gate("setAvatarUrl"),
                },
                {
                    label: t("serverSettings.manageEmailsPhoneNumbers"),
                    support: gate("change3pid"),
                },
                {
                    label: t("serverSettings.threads"),
                    support: specAtLeast(versions.versions, "v1.4")
                        ? "yes"
                        : "unknown",
                },
                {
                    label: t("serverSettings.privateReadReceipts"),
                    support:
                        specAtLeast(versions.versions, "v1.4") ||
                        versions.unstableFeatures["org.matrix.msc2285.stable"]
                            ? "yes"
                            : "unknown",
                },
            ]);
            setRoomVersion(
                (capabilities["m.room_versions"] as { default?: string })
                    ?.default ?? "",
            );
            setUnstableLabels(
                Object.entries(versions.unstableFeatures)
                    .filter(([, enabled]) => enabled)
                    .map(([name]) => labelUnstableFeature(name))
                    .sort((a, b) => a.localeCompare(b)),
            );
            const asSupport = (ok: boolean): Support => (ok ? "yes" : "no");
            setCallingFeatures([
                {
                    label: t("serverSettings.sfuDiscoveryRtcFoci"),
                    support: asSupport(calling.rtcFoci),
                },
                {
                    label: t("serverSettings.delayedEventsCallCleanup"),
                    support: asSupport(calling.delayedEvents),
                },
            ]);
        } catch (loadError) {
            setError(
                (loadError as Error)?.message ??
                    t("serverSettings.failedToReadServerCapabilities"),
            );
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    return (
        <View className="gap-6">
            {loading ? (
                <Text className="text-sm text-discord-textMuted">
                    {t("serverSettings.scanningServer")}
                </Text>
            ) : error ? (
                <View className="gap-2">
                    <Text className="text-sm text-discord-danger">{error}</Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={load}
                        className="self-start px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover"
                    >
                        <Text className="text-sm text-discord-textPrimary">
                            {t("common.retry")}
                        </Text>
                    </Pressable>
                </View>
            ) : (
                <>
                    <Text className="text-xs text-discord-textMuted">
                        {t("serverSettings.what")}{" "}
                        <Text className="text-xs text-discord-textSecondary">
                            {homeserverUrl}
                        </Text>{" "}
                        {t("serverSettings.advertisesItemsMarkedUnknownArenT")}
                    </Text>

                    <View>
                        <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                            {t("serverSettings.accountMessaging")}
                        </Text>
                        {features.map((feature, i) => {
                            const status = badge(feature.support);
                            return (
                                <View
                                    key={i}
                                    className="flex-row justify-between items-center gap-2 py-2 border-b border-discord-divider"
                                >
                                    <Text className="shrink text-sm text-discord-textSecondary">
                                        {feature.label}
                                    </Text>
                                    <Text className={`text-xs ${status.cls}`}>
                                        {status.text}
                                    </Text>
                                </View>
                            );
                        })}
                    </View>

                    <View>
                        <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                            {t("serverSettings.voiceVideoCallingMatrixrtc")}
                        </Text>
                        {callingFeatures.map((feature, i) => {
                            const status = badge(feature.support);
                            return (
                                <View
                                    key={i}
                                    className="flex-row justify-between items-center gap-2 py-2 border-b border-discord-divider"
                                >
                                    <Text className="shrink text-sm text-discord-textSecondary">
                                        {feature.label}
                                    </Text>
                                    <Text className={`text-xs ${status.cls}`}>
                                        {status.text}
                                    </Text>
                                </View>
                            );
                        })}
                    </View>

                    <View>
                        <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                            {t("serverSettings.server")}
                        </Text>
                        <View className="flex-row justify-between items-center gap-2 py-2 border-b border-discord-divider">
                            <Text className="shrink text-sm text-discord-textMuted">
                                {t("serverSettings.latestSpecVersion")}
                            </Text>
                            <Text className="text-discord-textPrimary text-xs font-mono">
                                {specVersions.at(-1) ?? "-"}
                            </Text>
                        </View>
                        {roomVersion ? (
                            <View className="flex-row justify-between items-center gap-2 py-2 border-b border-discord-divider">
                                <Text className="shrink text-sm text-discord-textMuted">
                                    {t("serverSettings.defaultRoomVersion")}
                                </Text>
                                <Text className="text-discord-textPrimary text-xs font-mono">
                                    {roomVersion}
                                </Text>
                            </View>
                        ) : null}
                    </View>

                    {unstableLabels.length > 0 && (
                        <View>
                            <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-3">
                                {t("serverSettings.advertisedFeatures", {
                                    length: unstableLabels.length,
                                })}
                            </Text>
                            <View className="flex-row flex-wrap gap-1.5">
                                {unstableLabels.map((feature, i) => (
                                    <Text
                                        key={i}
                                        className="px-2 py-0.5 rounded text-xs bg-discord-backgroundTertiary text-discord-textSecondary border border-discord-divider"
                                    >
                                        {feature}
                                    </Text>
                                ))}
                            </View>
                        </View>
                    )}
                </>
            )}
        </View>
    );
}
