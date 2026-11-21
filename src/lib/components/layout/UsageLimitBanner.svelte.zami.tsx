import { openLink, SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
// The signed-in account has hit a homeserver usage limit: a server-wide
// block (M_RESOURCE_LIMIT_EXCEEDED, or a pinned usage-limit server
// notice) or its own media upload quota (M_USER_LIMIT_EXCEEDED, e.g. a
// matrix.org plan). Dismissible; comes back if the limit changes. It lifts
// by itself once a request of the same kind goes through again (see
// usageLimits.svelte.ts). Stacked by HealthBanners.
import {
    activeUsageLimit,
    dismissUsageLimitBanner,
    usageLimitKey,
    usageLimitsState,
} from "$lib/stores/usageLimits.svelte";
import { adminContactHref, usageLimitMessageKey } from "$lib/utils/usageLimits";

export default function UsageLimitBanner() {
    const limit = useRune(() => activeUsageLimit());
    const visible = useRune(
        () => !!limit && usageLimitKey(limit) !== usageLimitsState.dismissedKey,
        [limit],
    );
    // Both links come from the server: only mailto:/https: survive.
    const contactHref = adminContactHref(limit?.adminContact);
    const infoHref = adminContactHref(limit?.infoUri);

    if (!(visible && limit)) return null;
    return (
        <View
            accessibilityRole="alert"
            className={`flex-row max-w-full items-center gap-3 rounded-lg border px-4 py-2.5 shadow-lg ${
                limit.kind === "mediaQuota"
                    ? "border-zam-warning/50"
                    : "border-zam-danger/50"
            } bg-zam-backgroundSecondary`}
        >
            <SvgIcon
                d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-2h2zm0-4h-2V7h2z"
                className={`h-5 w-5 flex-shrink-0 ${
                    limit.kind === "mediaQuota"
                        ? "text-zam-warning"
                        : "text-zam-danger"
                }`}
            />
            <View className="flex-shrink min-w-0 gap-0.5">
                <Text className="text-sm text-zam-textPrimary">
                    {t(usageLimitMessageKey(limit))}
                    {limit.canUpgrade
                        ? ` ${t("usageLimits.canUpgrade")}`
                        : null}
                </Text>
                {limit.message ? (
                    <Text className="break-words text-xs text-zam-textMuted">
                        {limit.message}
                    </Text>
                ) : null}
                {contactHref || infoHref ? (
                    <View className="flex-row flex-wrap gap-3">
                        {infoHref ? (
                            <Text
                                accessibilityRole="link"
                                onPress={() => openLink(infoHref)}
                                className="text-xs text-zam-accent hover:underline"
                            >
                                {t("usageLimits.learnMore")}
                            </Text>
                        ) : null}
                        {contactHref ? (
                            <Text
                                accessibilityRole="link"
                                onPress={() => openLink(contactHref)}
                                className="text-xs text-zam-accent hover:underline"
                            >
                                {t("usageLimits.contactAdmin")}
                            </Text>
                        ) : null}
                    </View>
                ) : null}
            </View>
            <Pressable
                accessibilityRole="button"
                onPress={dismissUsageLimitBanner}
                accessibilityLabel={t("usageLimits.dismiss")}
                className="flex-shrink-0"
            >
                <SvgIcon
                    d="M6 18L18 6M6 6l12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 text-zam-textMuted"
                />
            </Pressable>
        </View>
    );
}
