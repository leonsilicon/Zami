import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { t } from "$lib/i18n";
import { getClient } from "$lib/matrix/client";
import {
    pushDebug,
    verifyPushGateways,
    PUSH_GATEWAY_NOTIFY_URL,
} from "$lib/push";
import type { PusherGatewayStatus } from "$lib/utils/pusherVerification";

// Zami: `data-setting-anchor` (settings search scrolls to it) is not ported.
export default function PushDiagnostics() {
    // SEC-L4: after login, re-read the pushers the homeserver actually kept and
    // report whether it honoured our gateway URL. null while the check is in
    // flight or when there is no client to ask.
    const [gatewayStatus, setGatewayStatus] =
        useState<PusherGatewayStatus | null>(null);
    useEffect(() => {
        (async () => {
            const client = getClient();
            if (!client) return;
            setGatewayStatus(
                await verifyPushGateways(client).catch(() => null),
            );
        })();
    }, []);

    return (
        <View>
            <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                {t("pushDiagnostics.pushGateway")}
            </Text>
            <View className="py-2 border-b border-discord-divider">
                <Text className="text-sm text-discord-textPrimary">
                    {t("pushDiagnostics.notificationRelay")}
                </Text>
                <Text className="text-xs text-discord-textMuted mb-1">
                    {t(
                        "pushDiagnostics.pushNotificationsAreRelayedThroughThis",
                    )}
                </Text>
                <Text className="text-xs font-mono text-discord-textMuted break-all">
                    {pushDebug.provider === "unifiedpush" && pushDebug.upGateway
                        ? pushDebug.upGateway
                        : PUSH_GATEWAY_NOTIFY_URL}
                </Text>
                {gatewayStatus?.status === "mismatch" ? (
                    <Text className="text-xs text-discord-danger mt-1">
                        {t(
                            "pushDiagnostics.warningYourHomeserverIsRoutingThis",
                            {
                                join: gatewayStatus.mismatchedUrls.join(", "),
                            },
                        )}
                    </Text>
                ) : gatewayStatus?.status === "verified" ? (
                    <Text className="text-xs text-discord-textPositive mt-1">
                        {t(
                            "pushDiagnostics.verifiedYourHomeserverRoutesNotificationsTo",
                        )}
                    </Text>
                ) : gatewayStatus?.status === "none" ? (
                    <Text className="text-xs text-discord-textMuted mt-1 italic">
                        {t(
                            "pushDiagnostics.noPushNotificationsAreRegisteredOn",
                        )}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}
