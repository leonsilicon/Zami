import { Text, View } from "react-native";
import { t } from "$lib/i18n";
import type { Room } from "matrix-js-sdk";
import { Phone, PhoneMissed, PhoneCall } from "lucide-svelte";
import { formatCallDuration, type CallSummary } from "$lib/utils/callSummary";
import { getMemberName } from "$lib/matrix/client";

export default function CallEventCard({
    summary,
    room,
}: {
    summary: CallSummary;
    room: Room;
}) {
    const names = summary.participants.map(
        (id) => getMemberName(room, id) || id,
    );
    const label =
        summary.outcome === "missed"
            ? t("callEventCard.missedCall")
            : summary.outcome === "ongoing"
              ? t("callEventCard.ongoingCall")
              : t("callEventCard.callEnded");
    const duration = formatCallDuration(summary.durationMs);

    // Zami: the card's `text-sm` and (for a missed call) danger color, on the
    // text and icon that inherit them on the web. `inline-flex` → `self-start`.
    const tone =
        summary.outcome === "missed"
            ? "text-discord-danger"
            : "text-discord-textPrimary";

    return (
        <View className="mt-1 flex-row self-start items-center gap-2 rounded-lg border border-discord-backgroundTertiary bg-discord-backgroundSecondary px-3 py-2">
            {summary.outcome === "missed" ? (
                <PhoneMissed size={16} className={`flex-shrink-0 ${tone}`} />
            ) : summary.outcome === "ongoing" ? (
                <PhoneCall
                    size={16}
                    className="flex-shrink-0 text-discord-online"
                />
            ) : (
                <Phone
                    size={16}
                    className="flex-shrink-0 text-discord-textMuted"
                />
            )}
            <Text className={`text-sm font-medium ${tone}`}>{label}</Text>
            {names.length > 0 && (
                <Text className="flex-shrink text-sm text-discord-textMuted">
                    · {names.join(", ")}
                </Text>
            )}
            {duration ? (
                <Text className="text-sm text-discord-textMuted">
                    · {duration}
                </Text>
            ) : null}
        </View>
    );
}
