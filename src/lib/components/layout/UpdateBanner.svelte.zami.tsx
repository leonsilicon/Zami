import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { X } from "lucide-svelte";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useResolveClassNames } from "uniwind";
import { t } from "$lib/i18n";
// A subtle, dismissible "update ready" prompt (fed by the updateBanner
// store's app-shell watch), so a found/downloaded update doesn't wait for
// the user to open Settings → About. Renders nothing on web or when there's
// no actionable update. Mounted inline above the desktop sidebar's profile
// footer — NOT over the message composer; mobile uses a toast instead
// (see UpdateToastWatch).
import {
    bannerVisible,
    bannerView,
    runBannerAction,
    dismissUpdateBanner,
} from "$lib/stores/updateBanner.svelte";

// The download arrow in a filled circle upstream draws as an inline
// <svg fill="currentColor">.
function UpdateIcon({ className }: { className: string }) {
    const { color } = useResolveClassNames(className);
    return (
        <View
            className={className}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            <Svg
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                fill={color as string | undefined}
            >
                <Path
                    d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-2h2zm0-4h-2V7h2z"
                    transform="rotate(180 12 12)"
                />
                <Path d="M12 16l4-5h-3V7h-2v4H8z" />
            </Svg>
        </View>
    );
}

export default function UpdateBanner() {
    const visible = useRune(() => bannerVisible());
    const view = useRune(() => bannerView());

    const [acting, setActing] = useState(false);
    async function onAction() {
        if (acting) return;
        setActing(true);
        try {
            await runBannerAction();
        } finally {
            setActing(false);
        }
    }

    if (!visible) return null;
    // Stacked layout: the sidebar column is narrow (~19.5rem), so the label
    // gets its own row (wraps, never truncates to "Update a…") and the action
    // + dismiss sit on a row below.
    // Zami: `role="status"` has no React Native role; a polite live region
    // announces it on Android.
    return (
        <View
            accessibilityLiveRegion="polite"
            className="mx-2 mb-2 rounded-lg border border-discord-divider bg-discord-backgroundSecondary px-3 py-2 shadow-sm"
        >
            <View className="flex-row items-start gap-2">
                <UpdateIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-discord-accent" />
                <Text className="min-w-0 flex-1 text-sm text-discord-textPrimary">
                    {view.label}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    onPress={dismissUpdateBanner}
                    accessibilityLabel={t(
                        "updateBanner.dismissUpdateNotification",
                    )}
                    className="-me-1 flex-shrink-0"
                >
                    <X size={16} className="text-discord-textMuted" />
                </Pressable>
            </View>
            {view.action !== "none" && !!view.actionLabel && (
                <View className="mt-2 flex-row justify-end">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: acting || view.busy }}
                        onPress={() => void onAction()}
                        disabled={acting || view.busy}
                        className="rounded bg-discord-accent px-3 py-1 hover:opacity-90 disabled:opacity-60"
                    >
                        <Text className="text-sm font-medium text-white">
                            {view.actionLabel}
                        </Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
}
