import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { SvgIcon, openLink } from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";
import {
    parseGeoUri,
    formatCoords,
    mapLinkFor,
    googleMapsLinkFor,
} from "$lib/utils/location";
import { ExternalLink } from "lucide-svelte";
import LocationMap, {
    type MapMarkerInput,
} from "$lib/components/ui/LocationMap.svelte";

interface Props {
    content: Record<string, unknown>;
    senderName?: string;
    senderAvatarUrl?: string | null;
    isSelf?: boolean;
}

export default function LocationBody({
    content,
    senderName,
    senderAvatarUrl,
    isSelf,
}: Props) {
    const loc = (content["org.matrix.msc3488.location"] ?? null) as {
        uri?: string;
        description?: string;
    } | null;
    const geoUri =
        typeof loc?.uri === "string"
            ? loc.uri
            : typeof content.geo_uri === "string"
              ? content.geo_uri
              : "";
    const coords = geoUri ? parseGeoUri(geoUri) : null;
    // Only a real MSC3488 description goes on the card — the interop `body`
    // fallback ("Location (geo:…)") would just echo the coords line below.
    const description =
        typeof loc?.description === "string" ? loc.description : "";

    // Render the map only once the card is (nearly) on screen, then keep it —
    // bounds simultaneous Leaflet instances to roughly what's visible and defers
    // the leaflet JS chunk until a location card is actually seen.
    // Zami: no IntersectionObserver: the timeline's FlatList only mounts the
    // rows near the viewport, which is what it did, so the map shows at once.
    const mapVisible = true;

    // Zami: one markers array per position and label, so LocationMap doesn't
    // re-fit to a fresh array on every render.
    const lat = coords?.lat;
    const lon = coords?.lon;
    const markerLabel = senderName || description || "Location";
    const markers = useMemo(
        () =>
            lat === undefined || lon === undefined
                ? []
                : ([
                      {
                          id: "loc",
                          lat,
                          lon,
                          label: markerLabel,
                          avatarUrl: senderAvatarUrl,
                          isSelf,
                      },
                  ] as MapMarkerInput[]),
        [lat, lon, markerLabel, senderAvatarUrl, isSelf],
    );

    if (coords)
        return (
            <View className="mt-1 max-w-sm rounded-lg border border-discord-divider bg-discord-backgroundSecondary px-3 py-2.5">
                {mapVisible ? (
                    <View className="mb-2 h-40 w-full overflow-hidden rounded-lg">
                        <LocationMap
                            markers={markers}
                            interactive={false}
                            follow={false}
                        />
                    </View>
                ) : null}
                <View className="flex-row items-start gap-2">
                    <SvgIcon
                        d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"
                        className="w-5 h-5 mt-0.5 text-discord-accent flex-shrink-0"
                    />
                    <View className="min-w-0 flex-1">
                        {description ? (
                            <Text className="text-sm text-discord-textPrimary">
                                {description}
                            </Text>
                        ) : null}
                        <Text className="text-xs text-discord-textMuted">
                            {formatCoords(coords.lat, coords.lon)}
                        </Text>
                        <View className="mt-0.5 flex-row flex-wrap gap-x-3 gap-y-0.5">
                            <Pressable
                                accessibilityRole="link"
                                onPress={() =>
                                    openLink(mapLinkFor(coords.lat, coords.lon))
                                }
                                className="flex-row items-center gap-1"
                            >
                                <Text className="text-xs text-discord-accent">
                                    {t("locationBody.openstreetmap")}
                                </Text>
                                <ExternalLink
                                    size={14}
                                    className="text-discord-accent"
                                />
                            </Pressable>
                            <Pressable
                                accessibilityRole="link"
                                onPress={() =>
                                    openLink(
                                        googleMapsLinkFor(
                                            coords.lat,
                                            coords.lon,
                                        ),
                                    )
                                }
                                className="flex-row items-center gap-1"
                            >
                                <Text className="text-xs text-discord-accent">
                                    {t("locationBody.googleMaps")}
                                </Text>
                                <ExternalLink
                                    size={14}
                                    className="text-discord-accent"
                                />
                            </Pressable>
                        </View>
                    </View>
                </View>
            </View>
        );
    if (typeof content.body === "string")
        return (
            <Text className="text-sm text-discord-textPrimary">
                {content.body}
            </Text>
        );
    return null;
}
