import { openLink, Portal } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";
import { t } from "$lib/i18n";
import type { Room } from "matrix-js-sdk";
import { ExternalLink } from "lucide-svelte";
import LocationMap from "$lib/components/ui/LocationMap.svelte";
import type {
    LocationMapHandle,
    MapMarkerInput,
} from "$lib/components/ui/LocationMap.svelte";
import {
    getRoomBeacons,
    getOwnUserId,
    getMemberName,
    getMemberAvatar,
} from "$lib/matrix/client";
import {
    liveLocationState,
    shareStateFor,
    stopShare,
} from "$lib/stores/liveLocation.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { remainingLabel, updatedAgoLabel } from "$lib/utils/liveLocation";
import { stopStatusLabel, stopButtonLabel } from "$lib/utils/liveShareStop";
import { timeOnly } from "$lib/utils/timeFormat";
import { beaconMarkers } from "$lib/utils/liveLocationMap";
import { mapLinkFor } from "$lib/utils/location";

interface Props {
    room: Room;
    onClose: () => void;
}

export default function LiveLocationMapView({ room, onClose }: Props) {
    const insets = useSafeAreaInsets();
    const mapEl = useRef<LocationMapHandle>(null);

    // Label clock — 5s so "updated just now" tracks incoming fixes closely.
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 5000);
        return () => clearInterval(id);
    }, []);

    const me = getOwnUserId();
    // Zami: the ticks the deriveds below read, as React state. `ownShare` and
    // `ownStop` re-read on every render (the clock's too, harmlessly); `markers`
    // and `sharers` only when a tick moves, since a fresh `markers` array makes
    // LocationMap re-fit to it.
    const beaconTick = useRune(() => liveLocationState.beaconTick);
    const roomsTick = useRune(() => roomsState.roomsTick);
    const ownShare = shareStateFor(room.roomId);
    // Derived separately from `ownShare` on purpose — see the same comment in
    // LiveLocationBanner: the ShareState object is mutated in place, so reading
    // `ownShare.stop` would never re-render, while `stop` itself is a fresh
    // object on every phase change and therefore does invalidate.
    const ownStop = shareStateFor(room.roomId)?.stop ?? null;
    const markers = useMemo((): MapMarkerInput[] => {
        void beaconTick;
        void roomsTick;
        return beaconMarkers(getRoomBeacons(room), me).map((m) => ({
            id: m.id,
            lat: m.lat,
            lon: m.lon,
            label: m.isSelf
                ? t("liveLocationMapView.you")
                : getMemberName(room, m.owner),
            avatarUrl: getMemberAvatar(room, m.owner),
            isSelf: m.isSelf,
        }));
    }, [beaconTick, roomsTick, room, me]);
    const sharers = useMemo(() => {
        void beaconTick;
        void roomsTick;
        return beaconMarkers(getRoomBeacons(room), me);
    }, [beaconTick, roomsTick, room, me]);

    // Escape and the mobile back button are handled centrally by AppShell's
    // dismissTopmost(): this view occupies the shared modal slot (see
    // $lib/stores/liveMap.svelte). Do not add a local keydown handler.
    // Zami: `position: fixed` → rendered at the app root through the Portal, and
    // padded for the safe area.
    return (
        <Portal>
            <View
                className="absolute inset-0 z-[70] flex flex-col bg-discord-background"
                style={{
                    paddingTop: insets.top,
                    paddingBottom: insets.bottom,
                }}
            >
                {/* Header */}
                <View className="h-12 px-2 flex-row items-center gap-2 border-b border-discord-divider flex-shrink-0">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("liveLocationMapView.back")}
                        onPress={onClose}
                        className="p-2 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                    >
                        <SvgIcon
                            d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"
                            className="w-5 h-5 text-discord-textMuted"
                        />
                    </Pressable>
                    <Text className="font-semibold text-discord-textPrimary">
                        {t("liveLocationMapView.liveLocation")}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("liveLocationMapView.recenter")}
                        onPress={() => mapEl.current?.recenter()}
                        className="ms-auto p-2 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                    >
                        <SvgIcon
                            d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14z"
                            className="w-5 h-5 text-discord-textMuted"
                        />
                    </Pressable>
                </View>

                {/* Map */}
                <View className="relative flex-1 min-h-0">
                    <LocationMap ref={mapEl} markers={markers} />
                    {markers.length === 0 && (
                        <View
                            pointerEvents="none"
                            className="absolute inset-0 z-[401] flex-row items-center justify-center"
                        >
                            <Text className="rounded bg-discord-backgroundSecondary/90 px-4 py-2 text-sm text-discord-textMuted overflow-hidden">
                                {t(
                                    "liveLocationMapView.waitingForALocationFix",
                                )}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Footer: own-share controls + sharer freshness */}
                <View className="flex-shrink-0 border-t border-discord-divider bg-discord-backgroundSecondary px-4 py-3 flex flex-col gap-2">
                    {ownShare && (
                        <View className="flex-row items-center gap-2">
                            <View className="h-2 w-2 flex-shrink-0 rounded-full bg-discord-danger animate-pulse" />
                            {/* Same three states as the banner: stopping / stop-failed /
                                sharing. A failed stop reads as an error because the
                                beacon really is still broadcasting. */}
                            <Text
                                className={`flex-shrink text-sm ${
                                    ownStop?.phase === "failed"
                                        ? "font-semibold text-discord-danger"
                                        : "text-discord-textPrimary"
                                }`}
                            >
                                {stopStatusLabel(ownStop) ??
                                    t(
                                        "liveLocationMapView.sharingLiveLocation",
                                    )}{" "}
                                · {remainingLabel(ownShare.expiresAt, now)}
                            </Text>
                            {ownShare.lastSentTs ? (
                                <Text className="flex-shrink text-xs text-discord-textMuted">
                                    {t("liveLocationMapView.lastUpdatedAt", {
                                        timeOnly: timeOnly(ownShare.lastSentTs),
                                        updatedAgoLabel: updatedAgoLabel(
                                            ownShare.lastSentTs,
                                            now,
                                        ),
                                    })}
                                </Text>
                            ) : null}
                            {/* Disabled only for the in-flight write, which always
                                resolves (ack, rejection, or the expiry backstop). The
                                idle label stays this view's wordier "Stop sharing". */}
                            <Pressable
                                accessibilityRole="button"
                                disabled={ownStop?.phase === "stopping"}
                                accessibilityState={{
                                    disabled: ownStop?.phase === "stopping",
                                }}
                                onPress={() => void stopShare(room.roomId)}
                                className={`ms-auto rounded bg-discord-danger px-3 py-1 transition-opacity hover:opacity-90 ${
                                    ownStop?.phase === "stopping"
                                        ? "opacity-60"
                                        : ""
                                }`}
                            >
                                <Text className="text-xs font-semibold text-white">
                                    {ownStop
                                        ? stopButtonLabel(ownStop)
                                        : t("common.stopSharing")}
                                </Text>
                            </Pressable>
                        </View>
                    )}
                    {sharers
                        .filter((s) => !s.isSelf)
                        .map((s) => (
                            <View
                                key={s.id}
                                className="flex-row items-center gap-2"
                            >
                                <Text className="text-xs font-medium text-discord-textSecondary">
                                    {getMemberName(room, s.owner)}
                                </Text>
                                {s.description ? (
                                    <Text
                                        numberOfLines={1}
                                        className="flex-shrink text-xs text-discord-textMuted"
                                    >
                                        · {s.description}
                                    </Text>
                                ) : null}
                                {s.updatedTs ? (
                                    <Text className="text-xs text-discord-textMuted">
                                        · {updatedAgoLabel(s.updatedTs, now)}
                                    </Text>
                                ) : null}
                                <Pressable
                                    accessibilityRole="link"
                                    onPress={() =>
                                        openLink(mapLinkFor(s.lat, s.lon))
                                    }
                                    className="ms-auto flex-shrink-0 flex-row items-center gap-1"
                                >
                                    <Text className="text-xs text-discord-accent hover:underline">
                                        {t("liveLocationMapView.osm")}
                                    </Text>
                                    <ExternalLink
                                        size={14}
                                        className="text-discord-accent"
                                    />
                                </Pressable>
                            </View>
                        ))}
                    {!ownShare &&
                        sharers.filter((s) => !s.isSelf).length === 0 && (
                            <Text className="text-xs text-discord-textMuted">
                                {t(
                                    "liveLocationMapView.noActiveLiveSharesInThis",
                                )}
                            </Text>
                        )}
                </View>
            </View>
        </Portal>
    );
}

/** Zami: Zam's inline `<svg fill="currentColor"><path d=…/></svg>`. `className`
 *  sizes and places it, and its text color fills it, as `currentColor` would. */
function SvgIcon({ d, className }: { d: string; className: string }) {
    const { color, ...style } = useResolveClassNames(className);
    return (
        <Svg viewBox="0 0 24 24" fill={color} style={style}>
            <Path d={d} />
        </Svg>
    );
}
