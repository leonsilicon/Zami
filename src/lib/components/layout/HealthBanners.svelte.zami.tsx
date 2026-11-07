import { Portal } from "@-/com.leonsilicon.zami.rn";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// The device-health banners, stacked at the top of the window: out of
// (or low on) storage first, then encryption being off. Mounted at the
// root page so it covers the login and splash views too: storage can
// run out before the app shell ever shows.
import StorageBanner from "$lib/components/layout/StorageBanner.svelte";
import CryptoUnavailableBanner from "$lib/components/layout/CryptoUnavailableBanner.svelte";

export default function HealthBanners() {
    const insets = useSafeAreaInsets();

    // Zami: `fixed` → a Portal at the app root. The app draws under the status
    // bar, so `top-4` is measured from below it; the full-width row centres the
    // stack (`left-1/2 -translate-x-1/2`), and its side padding is
    // `max-w-[calc(100vw-2rem)]`. `pointer-events-none` on the stack with
    // `pointer-events-auto` on each banner is `box-none`.
    return (
        <Portal>
            <View
                pointerEvents="box-none"
                className="absolute inset-x-0 z-50 flex-col items-center gap-2 px-4"
                style={{ top: 16 + insets.top }}
            >
                <StorageBanner />
                <CryptoUnavailableBanner />
            </View>
        </Portal>
    );
}
