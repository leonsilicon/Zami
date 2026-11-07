import { Image, mediaSource, openLink } from "@-/com.leonsilicon.zami.rn";
import { useEffect, useEffectEvent, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { t } from "$lib/i18n";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import { fetchOpenIdToken, mxcToHttp } from "$lib/matrix/client";
import {
    fillOpenidPlaceholder,
    type RpcButton,
    type RpcEntry,
} from "$lib/utils/richPresence";

// What a user is doing, from the entries in their `m.rpc` profile field
// (MSC4544). Buttons never open on their own: each click asks first, with
// the full address shown.

interface Props {
    entries: RpcEntry[];
}

export default function RichPresenceCard({ entries }: Props) {
    // Elapsed and remaining times tick once a second, but only while an entry
    // has a time to count.
    const [now, setNow] = useState(Date.now());
    const needsClock = entries.some((e) =>
        e.kind === "activity"
            ? e.since !== undefined || e.until !== undefined
            : e.progress !== undefined,
    );
    const tick = useEffectEvent(() => {
        if (needsClock) setNow(Date.now());
    });
    useEffect(() => {
        const timer = setInterval(() => {
            tick();
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    function clock(ms: number): string {
        const total = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const pad = (n: number) => String(n).padStart(2, "0");
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    }

    function bounds(
        e: RpcEntry,
    ): { since?: number; until?: number } | undefined {
        if (e.kind === "music") return e.progress;
        return { since: e.since, until: e.until };
    }

    function fraction(since: number, until: number): number {
        return Math.min(1, Math.max(0, (now - since) / (until - since)));
    }

    const [pending, setPending] = useState<{
        appName: string;
        url: string;
        openid: boolean;
    } | null>(null);
    const [failed, setFailed] = useState(false);

    async function onButton(entry: RpcEntry, button: RpcButton): Promise<void> {
        setFailed(false);
        let url = button.url;
        if (button.requestOpenid) {
            try {
                url = fillOpenidPlaceholder(url, await fetchOpenIdToken());
            } catch {
                setFailed(true);
                return;
            }
        }
        setPending({
            appName: entry.kind === "activity" ? entry.name : entry.track,
            url,
            openid: button.requestOpenid,
        });
    }

    function confirmOpen(): void {
        // Zami: window.open(url, "_blank") → the system opens the link.
        if (pending) openLink(pending.url);
        setPending(null);
    }

    return (
        <>
            {entries.map((entry) => {
                const span = bounds(entry);
                const art =
                    entry.kind === "activity"
                        ? entry.largeIconUrl
                        : entry.coverUrl;
                return (
                    <View
                        key={entry.id}
                        className="mt-2 flex-row gap-2 rounded bg-discord-backgroundTertiary p-2"
                    >
                        {art && (
                            <View className="relative h-12 w-12 flex-shrink-0">
                                {/* Zami: `title` (the icon tooltips) has no React
                                    Native equivalent. */}
                                <Image
                                    className="h-12 w-12 rounded"
                                    contentFit="cover"
                                    source={mediaSource(
                                        mxcToHttp(art, 96, 96, "crop"),
                                    )}
                                />
                                {entry.kind === "activity" &&
                                    entry.smallIconUrl && (
                                        <Image
                                            className="absolute -bottom-1 -end-1 h-5 w-5 rounded-full border-2 border-discord-backgroundTertiary"
                                            contentFit="cover"
                                            source={mediaSource(
                                                mxcToHttp(
                                                    entry.smallIconUrl,
                                                    40,
                                                    40,
                                                    "crop",
                                                ),
                                            )}
                                        />
                                    )}
                            </View>
                        )}
                        <View className="min-w-0 flex-1">
                            {entry.kind === "activity" ? (
                                <>
                                    <Text
                                        numberOfLines={1}
                                        className="text-xs font-semibold text-discord-textPrimary"
                                    >
                                        {t("richPresenceCard.playing", {
                                            name: entry.name,
                                        })}
                                    </Text>
                                    {entry.details && (
                                        <Text
                                            numberOfLines={1}
                                            className="text-xs text-discord-textSecondary"
                                        >
                                            {entry.details}
                                        </Text>
                                    )}
                                    {entry.state && (
                                        <Text
                                            numberOfLines={1}
                                            className="text-xs text-discord-textSecondary"
                                        >
                                            {entry.state}
                                        </Text>
                                    )}
                                </>
                            ) : (
                                <>
                                    <Text
                                        numberOfLines={1}
                                        className="text-xs font-semibold text-discord-textPrimary"
                                    >
                                        {entry.track}
                                    </Text>
                                    {entry.artist && (
                                        <Text
                                            numberOfLines={1}
                                            className="text-xs text-discord-textSecondary"
                                        >
                                            {entry.artist}
                                        </Text>
                                    )}
                                    {entry.album && (
                                        <Text
                                            numberOfLines={1}
                                            className="text-xs text-discord-textSecondary"
                                        >
                                            {entry.album}
                                        </Text>
                                    )}
                                    {entry.playerName && (
                                        <Text
                                            numberOfLines={1}
                                            className="text-xs text-discord-textMuted"
                                        >
                                            {t("richPresenceCard.listening", {
                                                name: entry.playerName,
                                            })}
                                        </Text>
                                    )}
                                </>
                            )}

                            {span?.since !== undefined &&
                            span?.until !== undefined ? (
                                <View
                                    className="mt-1 h-1 overflow-hidden rounded bg-discord-backgroundSecondary"
                                    role="progressbar"
                                    accessibilityValue={{
                                        min: 0,
                                        max: 100,
                                        now: Math.round(
                                            fraction(span.since, span.until) *
                                                100,
                                        ),
                                    }}
                                >
                                    <View
                                        className="h-full bg-discord-accent"
                                        style={{
                                            width: `${fraction(span.since, span.until) * 100}%`,
                                        }}
                                    />
                                </View>
                            ) : span?.since !== undefined ? (
                                <Text className="text-xs text-discord-textMuted">
                                    {t("richPresenceCard.elapsed", {
                                        time: clock(now - span.since),
                                    })}
                                </Text>
                            ) : span?.until !== undefined ? (
                                <Text className="text-xs text-discord-textMuted">
                                    {t("richPresenceCard.remaining", {
                                        time: clock(span.until - now),
                                    })}
                                </Text>
                            ) : null}

                            {entry.buttons.length > 0 && (
                                <View className="mt-1 flex-row flex-wrap gap-1">
                                    {entry.buttons.map((button) => (
                                        <Pressable
                                            key={button.label + button.url}
                                            accessibilityRole="button"
                                            className="rounded bg-discord-backgroundSecondary px-2 py-0.5 hover:bg-discord-backgroundSecondaryAlt active:bg-discord-backgroundSecondaryAlt"
                                            onPress={() =>
                                                void onButton(entry, button)
                                            }
                                        >
                                            <Text className="text-xs text-discord-textPrimary">
                                                {button.label}
                                            </Text>
                                        </Pressable>
                                    ))}
                                </View>
                            )}
                        </View>
                    </View>
                );
            })}

            {failed && (
                <Text className="mt-1 text-xs text-discord-danger">
                    {t("richPresenceCard.openFailed")}
                </Text>
            )}

            {pending && (
                <ModalDialog
                    onClose={() => setPending(null)}
                    labelledBy="rpc-open-title"
                    panelClass="relative w-full max-w-sm mx-4 rounded-lg bg-discord-backgroundSecondary p-4 shadow-xl"
                >
                    <Text
                        nativeID="rpc-open-title"
                        role="heading"
                        className="mb-2 text-base font-semibold text-discord-textPrimary"
                    >
                        {t("richPresenceCard.openLinkTitle")}
                    </Text>
                    <Text className="text-sm text-discord-textSecondary">
                        {t("richPresenceCard.openLinkBody", {
                            name: pending.appName,
                        })}
                    </Text>
                    <ScrollView
                        className="my-2 max-h-32 flex-grow-0 rounded bg-discord-backgroundTertiary"
                        contentContainerClassName="p-2"
                    >
                        <Text className="break-all text-xs text-discord-textPrimary">
                            {pending.url}
                        </Text>
                    </ScrollView>
                    {pending.openid && (
                        <Text className="mb-2 text-xs text-discord-danger">
                            {t("richPresenceCard.openidWarning")}
                        </Text>
                    )}
                    <View className="flex-row justify-end gap-2">
                        <Pressable
                            accessibilityRole="button"
                            className="px-3 py-1"
                            onPress={() => setPending(null)}
                        >
                            <Text className="text-sm text-discord-textMuted hover:text-discord-textPrimary">
                                {t("common.cancel")}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            className="rounded bg-discord-accent px-3 py-1"
                            onPress={confirmOpen}
                        >
                            <Text className="text-sm text-white">
                                {t("richPresenceCard.open")}
                            </Text>
                        </Pressable>
                    </View>
                </ModalDialog>
            )}
        </>
    );
}
