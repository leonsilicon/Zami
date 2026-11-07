import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import type { Room } from "matrix-js-sdk";
import { LocateFixed, ChevronRight } from "lucide-svelte";
import {
    getRoomBeacons,
    getOwnUserId,
    getMemberName,
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
import LiveLocationMapView from "$lib/components/layout/LiveLocationMapView.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";
import {
    liveMapState,
    openLiveLocationMap,
    closeLiveLocationMap,
} from "$lib/stores/liveMap.svelte";

interface Props {
    room: Room;
}

export default function LiveLocationBanner({ room }: Props) {
    // A slow clock so the "43 min left" label refreshes while mounted.
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 15000);
        return () => clearInterval(id);
    }, []);

    const me = getOwnUserId();

    // Double gate, matching the share-location precedent (AppShell.svelte:1042):
    // the slot says a map is open, the store says it is THIS room's.
    const mapOpen = useRune(
        () =>
            interfaceState.modal === "live-location-map" &&
            liveMapState.roomId === room.roomId,
        [room.roomId],
    );

    // The view is per-room, and it lives inside this component — release the
    // slot when the room changes or the banner unmounts, or the slot would
    // stay claimed by a map that is no longer rendered and Escape would
    // silently "dismiss" nothing. The effect depends on room.roomId alone; the
    // store read/write happens in the teardown.
    //
    // The teardown fires AFTER the prop has changed, so capture the id in the
    // body: reading room.roomId inside the closure would yield the NEW room and
    // never match the still-open map.
    const roomId = room.roomId;
    useEffect(() => {
        const openedFor = roomId;
        return () => {
            if (liveMapState.roomId === openedFor) closeLiveLocationMap();
        };
    }, [roomId]);

    // Zami: the ticks the values below depend on: a tick re-renders the banner,
    // which reads them again.
    useRune(() => liveLocationState.beaconTick);
    useRune(() => roomsState.roomsTick);
    const ownShare = shareStateFor(room.roomId);
    // The stop phase MUST be derived on its own, not read as `ownShare.stop`:
    // `shareStateFor` hands back the same ShareState object the store mutates in
    // place, so that derived stays reference-equal on every bump and Svelte
    // never invalidates its dependents (the button would sit on "Stop" while
    // the write was in flight). `stop` is replaced wholesale on each phase
    // change, so a derived over it does change identity and does propagate.
    const ownStop = shareStateFor(room.roomId)?.stop ?? null;
    const others = getRoomBeacons(room).filter(
        (b) => b.isLive && b.beaconInfoOwner !== me,
    );

    return (
        <>
            {ownShare ? (
                <View className="flex-row items-center gap-2 border-b border-discord-divider bg-discord-danger/10 px-4 py-2">
                    <View className="h-2 w-2 flex-shrink-0 rounded-full bg-discord-danger" />
                    {/* A stop that is in flight or was rejected must say so: the beacon is
                        still live on the server until it acks, and a failed stop reads as
                        an error, not as a healthy share. */}
                    {/* Zami: `title` has no React Native equivalent. */}
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => openLiveLocationMap(room.roomId)}
                        className="flex-shrink"
                    >
                        <Text
                            className={`text-sm hover:underline ${
                                ownStop?.phase === "failed"
                                    ? "font-semibold text-discord-danger"
                                    : "text-discord-textPrimary"
                            }`}
                        >
                            {stopStatusLabel(ownStop) ??
                                t(
                                    "liveLocationBanner.sharingLiveLocation",
                                )}{" "}
                            · {remainingLabel(ownShare.expiresAt, now)}
                            {ownShare.lastSentTs
                                ? t("liveLocationBanner.lastUpdatedAt", {
                                      timeOnly: timeOnly(ownShare.lastSentTs),
                                      updatedAgoLabel: updatedAgoLabel(
                                          ownShare.lastSentTs,
                                          now,
                                      ),
                                  })
                                : ""}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => openLiveLocationMap(room.roomId)}
                        className="ms-auto rounded bg-discord-backgroundSecondary px-3 py-1 transition-colors hover:bg-discord-messageHover active:bg-discord-messageHover"
                    >
                        <Text className="text-xs font-semibold text-discord-textPrimary">
                            {t("liveLocationBanner.map")}
                        </Text>
                    </Pressable>
                    {/* Disabled only while the write is genuinely in flight; that phase
                        always ends (ack, rejection, or the beacon's expiry timer), so the
                        user is never left with a dead button. A failed stop is clickable
                        again — that is the retry path. */}
                    <Pressable
                        accessibilityRole="button"
                        disabled={ownStop?.phase === "stopping"}
                        accessibilityState={{
                            disabled: ownStop?.phase === "stopping",
                        }}
                        onPress={() => void stopShare(room.roomId)}
                        className={`rounded bg-discord-danger px-3 py-1 transition-opacity hover:opacity-90 ${
                            ownStop?.phase === "stopping" ? "opacity-60" : ""
                        }`}
                    >
                        <Text className="text-xs font-semibold text-white">
                            {stopButtonLabel(ownStop)}
                        </Text>
                    </Pressable>
                </View>
            ) : others.length > 0 ? (
                <View className="border-b border-discord-divider bg-discord-backgroundSecondary">
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => openLiveLocationMap(room.roomId)}
                        className="w-full flex-row items-center gap-2 px-4 py-2 transition-colors hover:bg-discord-messageHover active:bg-discord-messageHover"
                    >
                        <LocateFixed
                            size={16}
                            className="text-discord-accent flex-shrink-0"
                        />
                        {others.length === 1 ? (
                            <Text className="flex-shrink text-sm text-discord-textPrimary">
                                {t("liveLocationBanner.isSharingLiveLocation", {
                                    getMemberName: getMemberName(
                                        room,
                                        others[0].beaconInfoOwner,
                                    ),
                                })}
                            </Text>
                        ) : (
                            <Text className="flex-shrink text-sm text-discord-textPrimary">
                                {t(
                                    "liveLocationBanner.peopleSharingLiveLocation",
                                    {
                                        length: others.length,
                                    },
                                )}
                            </Text>
                        )}
                        <View className="ms-auto flex-row items-center gap-0.5">
                            <Text className="text-xs text-discord-accent">
                                {t("liveLocationBanner.viewMap")}
                            </Text>
                            {/* Zami: `mirror:` (`:dir(rtl)`) → Uniwind's `rtl:`. */}
                            <ChevronRight
                                className="rtl:-scale-x-100 text-discord-accent"
                                size={14}
                            />
                        </View>
                    </Pressable>
                </View>
            ) : null}

            {mapOpen && (
                <LiveLocationMapView
                    room={room}
                    onClose={closeLiveLocationMap}
                />
            )}
        </>
    );
}
