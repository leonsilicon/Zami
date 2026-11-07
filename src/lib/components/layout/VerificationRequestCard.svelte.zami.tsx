import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { ShieldQuestion } from "lucide-svelte";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import type { VerificationController } from "$lib/matrix/crypto";
import {
    verificationState,
    acceptIncoming,
    declineIncoming,
    isAcceptingRequest,
    acceptRequestError,
} from "$lib/stores/verification.svelte";

interface Props {
    controller: VerificationController;
}

export default function VerificationRequestCard({ controller }: Props) {
    // The controller mutates in place — read through the tick.
    const view = useRune(
        () => (void verificationState.verificationTick, controller.view()),
        [controller],
    );
    const heading = view.isSelfVerification
        ? t("verificationRequestCard.verifyYourOtherSession")
        : t("verificationRequestCard.verificationRequest");
    const subtitle = view.isSelfVerification
        ? (view.otherDeviceId ??
          t("verificationRequestCard.anotherOfYourSessions"))
        : view.otherUserId;

    // Accept state lives in the store, not here: it has to outlive this
    // component (the card can remount while accept() is still in flight) and
    // the in-timeline card has to agree with it.
    const busy = useRune(
        () => (
            void verificationState.verificationTick,
            isAcceptingRequest(controller)
        ),
        [controller],
    );
    const acceptError = useRune(
        () => (
            void verificationState.verificationTick,
            acceptRequestError(controller)
        ),
        [controller],
    );

    async function accept() {
        await acceptIncoming(controller);
    }

    return (
        <View className="flex-row items-center gap-3 w-80 max-w-full px-4 py-3 rounded-lg shadow-lg bg-discord-background border border-discord-divider">
            <View className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-discord-accent/20">
                <ShieldQuestion size={20} className="text-discord-accent" />
            </View>
            <View className="flex-1 min-w-0">
                <Text
                    numberOfLines={1}
                    className="text-sm font-semibold text-discord-textPrimary truncate"
                >
                    {heading}
                </Text>
                {acceptError ? (
                    <Text className="text-xs text-discord-danger">
                        {acceptError}
                    </Text>
                ) : (
                    <Text
                        numberOfLines={1}
                        className="text-xs text-discord-textMuted truncate"
                    >
                        {subtitle}
                    </Text>
                )}
            </View>
            {/* Never disabled while an accept is in flight: nothing bounds accept()
                client-side, so declining (which drops the card AND frees the store's
                one-at-a-time gate) is the only way out of a hung one short of a
                reload. */}
            <Pressable
                accessibilityRole="button"
                className="px-2.5 py-1 rounded bg-discord-messageHover hover:bg-discord-danger/20 transition-colors disabled:opacity-60"
                onPress={() => declineIncoming(controller)}
            >
                <Text className="text-xs text-discord-textPrimary">
                    {t("common.decline")}
                </Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                className="px-2.5 py-1 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-60"
                disabled={busy}
                onPress={() => void accept()}
            >
                <Text className="text-xs text-white">
                    {busy ? "…" : t("common.verify")}
                </Text>
            </Pressable>
        </View>
    );
}
