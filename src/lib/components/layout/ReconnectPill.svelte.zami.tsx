import { Portal, Pulse } from "@-/com.leonsilicon.zami.rn";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { syncStateLabel } from "$lib/utils/syncStatus";

interface Props {
    /** Raw matrix-js-sdk sync state (auth.syncState). */
    syncState: string | null | undefined;
}

export default function ReconnectPill({ syncState }: Props) {
    const insets = useSafeAreaInsets();

    const status = syncStateLabel(syncState);
    const disconnected = status.tone !== "ok";
    const offline = syncState === "STOPPED";

    // Debounce: only surface the pill once a disconnect has PERSISTED, so a
    // brief transient RECONNECTING/CATCHUP blip (normal on any sync) never
    // flashes it. Cleared the instant we reconnect. The pill is
    // pointer-events-none and never covers the columns, so it can't imply the
    // app is locked - offline stays fully usable.
    const APPEAR_DELAY_MS = 2000;
    const [show, setShow] = useState(false);
    useEffect(() => {
        if (!disconnected) {
            setShow(false);
            return;
        }
        const timer = setTimeout(() => setShow(true), APPEAR_DELAY_MS);
        return () => clearTimeout(timer);
    }, [disconnected]);

    if (!show) return null;
    // Top centre, just under the room header (the same 3.5rem + safe-area
    // clearance CallPipOverlay uses). A bottom corner sat on the profile
    // footer on desktop and on the composer on mobile.
    // Zami: `fixed` → a Portal at the app root; the full-width row centres the
    // pill, as `left-1/2 -translate-x-1/2` does. `role="status"` has no React
    // Native role; a polite live region announces it on Android.
    return (
        <Portal>
            <View
                pointerEvents="none"
                className="absolute inset-x-0 z-50 flex-row justify-center"
                style={{ top: 56 + insets.top }}
            >
                <View
                    accessibilityLiveRegion="polite"
                    className="flex-row items-center gap-2 rounded-full bg-discord-backgroundTertiary/95 px-3 py-1.5 shadow-lg ring-1 ring-black/20"
                >
                    {offline ? (
                        <View className="h-2 w-2 flex-shrink-0 rounded-full bg-discord-danger" />
                    ) : (
                        <Pulse className="h-2 w-2 flex-shrink-0 rounded-full bg-discord-warning" />
                    )}
                    <Text className="text-xs font-medium text-discord-textSecondary">
                        {status.label}
                    </Text>
                </View>
            </View>
        </Portal>
    );
}
