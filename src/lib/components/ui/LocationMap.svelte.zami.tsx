import {
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type Ref,
} from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { Image, mediaSource } from "@-/com.leonsilicon.zami.rn";

export interface MapMarkerInput {
    id: string;
    lat: number;
    lon: number;
    /** Display name — rendered via textContent, never as HTML. */
    label: string;
    avatarUrl?: string | null;
    isSelf?: boolean;
}

/** Zami: what `bind:this` gave upstream's parents (`mapEl?.recenter()`), through `ref`. */
export interface LocationMapHandle {
    recenter(): void;
}

interface Props {
    markers: MapMarkerInput[];
    /** Pan/zoom to keep markers in view until the user drags. */
    follow?: boolean;
    /** When false, disable all pan/zoom interaction (inline card use). */
    interactive?: boolean;
    ref?: Ref<LocationMapHandle>;
}

interface Size {
    width: number;
    height: number;
}

// Zami: react-native-maps (Apple Maps on iOS, no tiles or API key) in place of Leaflet
// with OpenStreetMap tiles. It speaks regions (degrees of latitude and longitude across
// the view) rather than Leaflet's zoom levels: at zoom z, Leaflet's world is
// 256 * 2^z px wide for 360 degrees of longitude.
function regionAt(lat: number, lon: number, zoom: number, size: Size): Region {
    const longitudeDelta = (360 * size.width) / (256 * 2 ** zoom);
    return {
        latitude: lat,
        longitude: lon,
        longitudeDelta,
        // Mercator stretches a degree of latitude by 1 / cos(latitude) on screen.
        latitudeDelta:
            longitudeDelta *
            (size.height / size.width) *
            Math.cos((lat * Math.PI) / 180),
    };
}

function zoomOf(region: Region, size: Size): number {
    return Math.log2((360 * size.width) / (256 * region.longitudeDelta));
}

// A sane default before the first fix arrives.
const DEFAULT_ZOOM = 2;
const DEFAULT_SIZE: Size = { width: 256, height: 256 };

export default function LocationMap({
    markers,
    follow = true,
    interactive = true,
    ref,
}: Props) {
    const map = useRef<MapView | null>(null);
    // Zami: Leaflet waits for its lazy import; react-native-maps for onMapReady and a size.
    const [ready, setReady] = useState(false);
    const size = useRef<Size | null>(null);
    const region = useRef<Region | null>(null);
    const userMoved = useRef(false);
    const didInitialFit = useRef(false);

    function onLayout(e: LayoutChangeEvent) {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) size.current = { width, height };
    }

    /** Marker view built from the input — labels/URLs are user-controlled, and
     *  React Native has no HTML to interpolate them into. */
    function buildMarkerElement(input: MapMarkerInput) {
        return (
            <View
                accessibilityLabel={input.label}
                style={[styles.llMarker, input.isSelf && styles.llMarkerSelf]}
            >
                {input.avatarUrl ? (
                    <Image
                        source={mediaSource(input.avatarUrl)}
                        accessibilityLabel={input.label}
                        contentFit="cover"
                        style={styles.llMarkerImg}
                    />
                ) : (
                    <Text style={styles.llMarkerSpan}>
                        {(input.label || "?").trim().charAt(0).toUpperCase()}
                    </Text>
                )}
            </View>
        );
    }

    // Zami: the markers prop renders declaratively as <Marker>s below, keyed by id, so
    // upstream's sync into Leaflet's layers (and its icon cache, markerKey) has no
    // counterpart. What's left of the effect is keeping them in view.
    useEffect(() => {
        const list = markers;
        if (!ready) return;

        if (
            list.length > 0 &&
            (!didInitialFit.current || (follow && !userMoved.current))
        ) {
            fitToMarkers(list, !didInitialFit.current);
            didInitialFit.current = true;
        }
    }, [markers, follow, ready]);

    function fitToMarkers(list: MapMarkerInput[], instant: boolean) {
        const m = map.current;
        const s = size.current ?? DEFAULT_SIZE;
        if (!m || list.length === 0) return;
        if (list.length === 1) {
            const zoom = region.current
                ? zoomOf(region.current, s)
                : DEFAULT_ZOOM;
            m.animateToRegion(
                regionAt(list[0].lat, list[0].lon, Math.max(zoom, 16), s),
                // Leaflet's default pan animation is 0.25s.
                instant ? 0 : 250,
            );
        } else {
            m.fitToCoordinates(
                list.map((p) => ({ latitude: p.lat, longitude: p.lon })),
                {
                    edgePadding: { top: 48, right: 48, bottom: 48, left: 48 },
                    animated: !instant,
                },
            );
        }
    }

    /** Re-fit to all markers and resume following (the recenter button). */
    useImperativeHandle(ref, () => ({
        recenter() {
            userMoved.current = false;
            fitToMarkers(markers, false);
        },
    }));

    return (
        <View
            onLayout={onLayout}
            // Zami: a map that takes no interaction lets touches through to what holds
            // it (the timeline scrolling past a location card).
            pointerEvents={interactive ? "auto" : "none"}
            className="ll-map h-full w-full"
            style={styles.llMap}
        >
            <MapView
                ref={map}
                style={StyleSheet.absoluteFill}
                initialRegion={regionAt(0, 0, DEFAULT_ZOOM, DEFAULT_SIZE)}
                // Zami: Apple Maps draws its own legal/attribution link; there are no OSM
                // tiles to credit. Its dark style stands in for upstream's inverted
                // OSM raster (iOS only; Google Maps on Android stays light).
                userInterfaceStyle="dark"
                loadingBackgroundColor="#1a1d24"
                zoomControlEnabled={interactive}
                scrollEnabled={interactive}
                zoomEnabled={interactive}
                zoomTapEnabled={interactive}
                // Leaflet neither rotates nor tilts.
                rotateEnabled={false}
                pitchEnabled={false}
                toolbarEnabled={false}
                moveOnMarkerPress={false}
                onMapReady={() => setReady(true)}
                onPanDrag={() => (userMoved.current = true)}
                onRegionChangeComplete={(r) => (region.current = r)}
            >
                {markers.map((input) => (
                    <Marker
                        key={input.id}
                        coordinate={{
                            latitude: input.lat,
                            longitude: input.lon,
                        }}
                        // iconAnchor [22, 22] of a 44x44 icon: centered.
                        anchor={{ x: 0.5, y: 0.5 }}
                    >
                        {buildMarkerElement(input)}
                    </Marker>
                ))}
            </MapView>
        </View>
    );
}

const styles = StyleSheet.create({
    llMap: {
        backgroundColor: "#1a1d24",
        position: "relative",
        zIndex: 0,
    },
    llMarker: {
        width: 44,
        height: 44,
        borderRadius: 9999,
        borderWidth: 3,
        borderColor: "#23a559",
        backgroundColor: "#313338",
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.6)",
    },
    llMarkerSelf: {
        borderColor: "#00a8fc",
    },
    llMarkerImg: {
        width: "100%",
        height: "100%",
    },
    llMarkerSpan: {
        color: "#dbdee1",
        fontWeight: "600",
        fontSize: 18,
    },
});
