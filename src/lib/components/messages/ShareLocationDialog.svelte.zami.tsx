import * as Location from "expo-location";
import { useState } from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import RNSvg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";
import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import {
    locationDialogState,
    closeShareLocationDialog,
} from "$lib/stores/locationDialog.svelte";
import { sendLocation, canShareLiveBeacon, getRoom } from "$lib/matrix/client";
import { formatCoords } from "$lib/utils/location";
import { geoErrorMessage } from "$lib/utils/geoErrors";
import { LIVE_SHARE_DURATIONS } from "$lib/utils/liveLocation";
import { startShare } from "$lib/stores/liveLocation.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";

// Upstream's inline SVG icons: `w-*`/`h-*` size them, `colorClassName` is their
// `currentColor`.
const Svg = withUniwind(RNSvg);

/** A failure with the Geolocation API's codes, which geoErrorMessage reads. */
class GeoError extends Error {
    constructor(readonly code: 1 | 2 | 3) {
        super(`Geolocation failed (${code})`);
    }
}

const LOCATE_TIMEOUT_MS = 10000;

/**
 * Zami: `navigator.geolocation.getCurrentPosition` with `enableHighAccuracy`
 * and a 10s timeout, on expo-location: React Native has no Geolocation API.
 * It fails as that API does: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE,
 * 3 TIMEOUT.
 */
async function getCurrentPosition(): Promise<Location.LocationObject> {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new GeoError(1);
    if (!(await Location.hasServicesEnabledAsync())) throw new GeoError(2);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
            }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new GeoError(3)),
                    LOCATE_TIMEOUT_MS,
                );
            }),
        ]);
    } catch (err) {
        throw err instanceof GeoError ? err : new GeoError(2);
    } finally {
        clearTimeout(timer);
    }
}

// Zami: `use:focusTrap` (Tab cycling, Escape to close) has no React Native
// equivalent; the backdrop closes the dialog, as it does upstream.
export default function ShareLocationDialog() {
    const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(
        null,
    );
    const [description, setDescription] = useState("");
    const [locating, setLocating] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<"once" | "live">("once");
    const [durationMs, setDurationMs] = useState(LIVE_SHARE_DURATIONS[0].ms);

    const roomId = useRune(() => locationDialogState.roomId);
    const room = roomId ? getRoom(roomId) : null;
    const canLive = room ? canShareLiveBeacon(room) : false;

    // Zami: expo-location is always there (upstream checks for
    // `navigator.geolocation`), and an app is a secure context.
    function locate() {
        setLocating(true);
        setError(null);
        getCurrentPosition().then(
            (pos) => {
                setCoords({
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                });
                setLocating(false);
            },
            (err: unknown) => {
                setError(
                    geoErrorMessage(err instanceof GeoError ? err : null, true),
                );
                setLocating(false);
            },
        );
    }

    async function share() {
        const roomId = locationDialogState.roomId;
        if (!roomId || sending) return;
        if (mode === "live") {
            // Zami: not ported: startShare tracks the position with
            // navigator.geolocation, which React Native lacks, so it only
            // toasts that location needs HTTPS (no `window.isSecureContext`).
            setSending(true);
            try {
                await startShare(roomId, durationMs);
                closeShareLocationDialog();
            } catch (err) {
                showErrorToast(
                    err instanceof Error
                        ? err.message
                        : t("shareLocationDialog.failedToStartLiveLocation"),
                );
                setSending(false);
            }
            return;
        }
        if (!coords) return;
        setSending(true);
        try {
            await sendLocation(roomId, {
                ...coords,
                description: description.trim() || undefined,
            });
            closeShareLocationDialog();
        } catch (err) {
            showErrorToast(
                err instanceof Error
                    ? err.message
                    : t("shareLocationDialog.failedToShareLocation"),
            );
            setSending(false);
        }
    }

    return (
        <Portal>
            <View className="absolute inset-0 z-50">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.closeDialog")}
                    className="absolute inset-0 bg-black/60"
                    onPress={closeShareLocationDialog}
                />
                {/* Zami: the dialog stays above the keyboard. Centred in a column,
                    it shrinks (and scrolls) to fit the space left. */}
                <KeyboardAvoidingView
                    behavior="padding"
                    pointerEvents="box-none"
                    style={StyleSheet.absoluteFill}
                >
                    <View
                        pointerEvents="box-none"
                        className="flex-1 items-center justify-center p-4"
                    >
                        <View
                            accessibilityViewIsModal
                            className="relative z-10 bg-discord-backgroundSecondary rounded-lg shadow-xl w-full max-w-md max-h-[85vh] flex-shrink overflow-hidden"
                        >
                            <ScrollView
                                keyboardShouldPersistTaps="handled"
                                style={styles.content}
                                contentContainerClassName="flex-col gap-4 p-6"
                            >
                                <Text
                                    accessibilityRole="header"
                                    className="text-lg font-bold text-discord-textPrimary"
                                >
                                    {t("shareLocationDialog.shareLocation")}
                                </Text>

                                {canLive && (
                                    <View className="flex-row gap-2">
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                selected: mode === "once",
                                            }}
                                            onPress={() => setMode("once")}
                                            className={`flex-1 rounded px-3 py-2 transition-colors ${
                                                mode === "once"
                                                    ? "bg-discord-accent"
                                                    : "bg-discord-backgroundTertiary"
                                            }`}
                                        >
                                            <Text
                                                className={`text-sm font-medium text-center ${
                                                    mode === "once"
                                                        ? "text-white"
                                                        : "text-discord-textSecondary hover:text-discord-textPrimary"
                                                }`}
                                            >
                                                {t(
                                                    "shareLocationDialog.sendOnce",
                                                )}
                                            </Text>
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                selected: mode === "live",
                                            }}
                                            onPress={() => setMode("live")}
                                            className={`flex-1 rounded px-3 py-2 transition-colors ${
                                                mode === "live"
                                                    ? "bg-discord-accent"
                                                    : "bg-discord-backgroundTertiary"
                                            }`}
                                        >
                                            <Text
                                                className={`text-sm font-medium text-center ${
                                                    mode === "live"
                                                        ? "text-white"
                                                        : "text-discord-textSecondary hover:text-discord-textPrimary"
                                                }`}
                                            >
                                                {t(
                                                    "shareLocationDialog.shareLive",
                                                )}
                                            </Text>
                                        </Pressable>
                                    </View>
                                )}

                                {mode === "once" ? (
                                    <>
                                        {/* Locate */}
                                        <View className="flex-col gap-2">
                                            <Pressable
                                                accessibilityRole="button"
                                                onPress={locate}
                                                disabled={locating}
                                                className="self-start flex-row items-center gap-2 rounded bg-discord-backgroundTertiary px-3 py-2 hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                                            >
                                                <Svg
                                                    className="w-4 h-4 flex-shrink-0"
                                                    colorClassName="accent-discord-accent"
                                                    fill="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <Path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
                                                </Svg>
                                                <Text className="text-sm font-medium text-discord-textPrimary">
                                                    {locating
                                                        ? t(
                                                              "shareLocationDialog.locating",
                                                          )
                                                        : t(
                                                              "shareLocationDialog.useMyCurrentLocation",
                                                          )}
                                                </Text>
                                            </Pressable>
                                            {coords && (
                                                <Text className="text-xs text-discord-textMuted">
                                                    {formatCoords(
                                                        coords.lat,
                                                        coords.lon,
                                                    )}
                                                </Text>
                                            )}
                                        </View>

                                        {/* Description */}
                                        <View className="flex-col gap-1.5">
                                            <Text className="text-xs font-semibold uppercase tracking-wide text-discord-textMuted">
                                                {t(
                                                    "shareLocationDialog.descriptionOptional",
                                                )}
                                            </Text>
                                            <TextInput
                                                accessibilityLabel={t(
                                                    "shareLocationDialog.descriptionOptional",
                                                )}
                                                value={description}
                                                onChangeText={setDescription}
                                                placeholder={t(
                                                    "shareLocationDialog.eGHomeTheCafOn",
                                                )}
                                                maxLength={340}
                                                className="w-full rounded bg-discord-backgroundTertiary px-3 py-2 text-sm text-discord-textPrimary placeholder:text-discord-textMuted focus:outline-none focus:ring-2 focus:ring-discord-accent"
                                                placeholderTextColorClassName="accent-discord-textMuted"
                                            />
                                        </View>
                                    </>
                                ) : (
                                    /* Live duration */
                                    <View className="flex-col gap-1.5">
                                        <Text className="text-xs font-semibold uppercase tracking-wide text-discord-textMuted">
                                            {t("shareLocationDialog.duration")}
                                        </Text>
                                        {/* Zami: no <select>; its options are
                                            a row of choices. */}
                                        <View
                                            accessibilityRole="radiogroup"
                                            accessibilityLabel={t(
                                                "shareLocationDialog.duration",
                                            )}
                                            className="w-full flex-row gap-1 rounded bg-discord-backgroundTertiary p-1"
                                        >
                                            {LIVE_SHARE_DURATIONS.map((d) => (
                                                <Pressable
                                                    key={d.ms}
                                                    accessibilityRole="radio"
                                                    accessibilityState={{
                                                        checked:
                                                            durationMs === d.ms,
                                                    }}
                                                    onPress={() =>
                                                        setDurationMs(d.ms)
                                                    }
                                                    className={`flex-1 rounded px-3 py-1.5 ${
                                                        durationMs === d.ms
                                                            ? "bg-discord-accent"
                                                            : ""
                                                    }`}
                                                >
                                                    <Text
                                                        className={`text-sm text-center ${
                                                            durationMs === d.ms
                                                                ? "text-white"
                                                                : "text-discord-textPrimary"
                                                        }`}
                                                    >
                                                        {d.label}
                                                    </Text>
                                                </Pressable>
                                            ))}
                                        </View>
                                        <Text className="text-xs text-discord-textMuted">
                                            {t(
                                                "shareLocationDialog.yourLiveLocationIsSharedWith",
                                            )}
                                        </Text>
                                    </View>
                                )}

                                {/* Footer */}
                                <View className="flex-row items-center justify-end gap-3 pt-1">
                                    {error && (
                                        <Text className="me-auto flex-shrink text-xs text-discord-danger">
                                            {error}
                                        </Text>
                                    )}
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={closeShareLocationDialog}
                                        className="px-4 py-2 rounded"
                                    >
                                        <Text className="text-sm font-medium text-discord-textSecondary hover:text-discord-textPrimary hover:underline transition-colors">
                                            {t("common.cancel")}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void share()}
                                        disabled={
                                            sending ||
                                            (mode === "once" && !coords)
                                        }
                                        className="px-4 py-2 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-50"
                                    >
                                        <Text className="text-white text-sm font-semibold">
                                            {mode === "live"
                                                ? sending
                                                    ? t("common.starting")
                                                    : t(
                                                          "shareLocationDialog.shareLive",
                                                      )
                                                : sending
                                                  ? t(
                                                        "shareLocationDialog.sharing",
                                                    )
                                                  : t(
                                                        "shareLocationDialog.share",
                                                    )}
                                        </Text>
                                    </Pressable>
                                </View>
                            </ScrollView>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </View>
        </Portal>
    );
}

const styles = StyleSheet.create({
    // Only as tall as its content, so the dialog sizes to it.
    content: { flexGrow: 0 },
});
