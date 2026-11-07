import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Lock, LockOpen, ShieldAlert } from "lucide-svelte";
import { Text, View } from "react-native";
import { t } from "$lib/i18n";
import { voiceCallState } from "$lib/stores/voiceCall.svelte";
import { getRoom } from "$lib/matrix/client";

// Whether the call we're in is end-to-end encrypted, and who in it isn't
// (an app without encryption: we play their media, they can't play ours).
// The full explanation is in the tooltip and the accessible name.
interface Props {
    roomId: string;
    /** Show a short word next to the icon. */
    showLabel?: boolean;
    /** Sit inside a line of text (the voice panel's status). */
    inline?: boolean;
}

export default function CallEncryptionBadge({
    roomId,
    showLabel = false,
    inline = false,
}: Props) {
    const encryption = useRune(() => voiceCallState.encryption);

    function names(userIds: string[]): string {
        const room = getRoom(roomId);
        return userIds.map((id) => room?.getMember(id)?.name ?? id).join(", ");
    }

    const view = (() => {
        if (!encryption) return null;
        if (!encryption.encrypted) {
            return {
                icon: LockOpen,
                tone: "text-discord-textMuted",
                short: "",
                text: t("callEncryption.notEncrypted"),
            };
        }
        if (encryption.unencrypted.length > 0) {
            return {
                icon: ShieldAlert,
                tone: "text-discord-warning",
                short: t("callEncryption.partialShort"),
                text: t("callEncryption.partial", {
                    names: names(encryption.unencrypted),
                }),
            };
        }
        return {
            icon: Lock,
            tone: "text-discord-textPositive",
            short: t("callEncryption.encryptedShort"),
            text: t("callEncryption.encrypted"),
        };
    })();

    if (!view) return null;
    const Icon = view.icon;
    // Zami: `title` (the tooltip) has no React Native equivalent; the text is
    // the accessible name. Inline, the badge is a row in the status line's row
    // (VoiceCallPanel), so `align-text-bottom` has nothing to align to.
    return (
        <View
            className={`${
                inline ? "flex-row ms-1" : "flex-row flex-shrink-0"
            } items-center gap-1`}
            accessible
            accessibilityRole="image"
            accessibilityLabel={view.text}
        >
            <Icon size={inline ? 12 : 16} className={view.tone} />
            {showLabel && !!view.short && (
                <Text className={`text-xs ${view.tone}`}>{view.short}</Text>
            )}
        </View>
    );
}
