import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
// Consent gate before a click-to-join (audit SEC-M3). Rendered once in
// AppShell; shows when the join-consent store has a pending request. Text
// only — the identifiers are plain strings, never {@html}.
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import {
    joinConsentState,
    resolveJoinConsent,
} from "$lib/stores/joinConsent.svelte";

// Zami: `w-[min(28rem,calc(100vw-2rem))]` → `w-full max-w-[28rem] mx-4`: React
// Native has no `min()`, and the dialog's panel shrinks to keep its margins.
export default function JoinConsentDialog() {
    const pending = useRune(() => joinConsentState.pending);
    // The resolved room id is only worth showing separately when it differs
    // from what the user clicked (i.e. an alias link).
    const showResolved =
        !!pending && pending.display !== pending.resolvedRoomId;

    // Clear any stale pending consent from an in-place-expired prior session.
    // requestJoinConsent is only called from timeline link clicks, which happen
    // AFTER AppShell mounts, so pending is always null in a healthy flow.
    useEffect(() => {
        resolveJoinConsent(false);
    }, []);

    if (!pending) return null;
    return (
        <ModalDialog
            onClose={() => resolveJoinConsent(false)}
            labelledBy="join-consent-title"
            panelClass="relative z-10 w-full max-w-[28rem] mx-4 rounded-lg bg-discord-backgroundSecondary p-5 shadow-xl"
        >
            <Text
                nativeID="join-consent-title"
                role="heading"
                className="mb-2 text-lg font-semibold text-discord-textPrimary"
            >
                {t("joinConsentDialog.joinThisRoom")}
            </Text>
            <Text className="mb-3 text-sm text-discord-textMuted">
                {t("joinConsentDialog.youClickedALinkTo")}{" "}
                <Text className="break-all font-medium text-sm text-discord-textPrimary">
                    {pending.display}
                </Text>
                {t("joinConsentDialog.joiningSharesYourMatrixIdWith")}
            </Text>
            {showResolved && (
                <Text className="mb-3 text-sm text-discord-textMuted">
                    {t("joinConsentDialog.thisOpensRoom")}{" "}
                    <Text className="break-all font-medium text-sm text-discord-textPrimary">
                        {pending.resolvedRoomId}
                    </Text>
                    .
                </Text>
            )}
            {pending.serverMismatch && (
                <Text
                    className="mb-3 rounded border border-discord-danger/40 bg-discord-danger/10 px-3 py-2 text-sm text-discord-danger"
                    role="alert"
                >
                    {t("joinConsentDialog.warningThisLinkPointsAtA")}
                </Text>
            )}
            <View className="mt-4 flex-row justify-end gap-2">
                <Pressable
                    accessibilityRole="button"
                    onPress={() => resolveJoinConsent(false)}
                    className="rounded px-4 py-2 transition-colors"
                >
                    <Text className="text-sm font-medium text-discord-textSecondary hover:text-discord-textPrimary hover:underline">
                        {t("common.cancel")}
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => resolveJoinConsent(true)}
                    className="rounded bg-discord-accent px-4 py-2 hover:opacity-90"
                >
                    <Text className="text-sm font-medium text-white">
                        {t("joinConsentDialog.joinRoom")}
                    </Text>
                </Pressable>
            </View>
        </ModalDialog>
    );
}
