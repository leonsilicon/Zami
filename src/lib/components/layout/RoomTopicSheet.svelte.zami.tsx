import { Html } from "@-/com.leonsilicon.zami.rn";
import { Text, View } from "react-native";
import { t } from "$lib/i18n";
import Portal from "$lib/components/ui/Portal.svelte";
import BottomSheet from "$lib/components/ui/BottomSheet.svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import { linkifyPlainText } from "$lib/utils/matrixLinks";

interface Props {
    roomId: string;
    roomName: string;
    avatarSrc?: string | null;
    topic: string;
    onClose: () => void;
}

export default function RoomTopicSheet({
    roomId,
    roomName,
    avatarSrc = null,
    topic,
    onClose,
}: Props) {
    // Topics are plain text (m.room.topic). Escape first — linkifyPlainText
    // requires escaped input — then turn URLs / matrix identifiers into
    // anchors. Newlines are kept by whitespace-pre-wrap on the container.
    const topicHtml = linkifyPlainText(
        topic
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;"),
    ).replace(
        /<a href=/g,
        '<a target="_blank" rel="noopener noreferrer" href=',
    );

    return (
        <Portal>
            <BottomSheet onClose={onClose}>
                {/* Zami: the sheet scrolls its content itself (up to 70% of the
                    screen), so this isn't a second scroll box inside it. */}
                <View className="px-4 pb-4 pt-1">
                    <View className="flex-row items-center gap-3 mb-3">
                        <Avatar
                            src={avatarSrc}
                            name={roomName}
                            id={roomId}
                            size={40}
                        />
                        {/* Zami: renderPlainTextWithTwemoji → plain text; iOS
                            draws emoji itself. */}
                        <Text
                            role="heading"
                            className="flex-shrink font-semibold text-discord-textPrimary break-words min-w-0"
                        >
                            {roomName}
                        </Text>
                    </View>
                    <Text className="text-xs font-semibold uppercase text-discord-textMuted mb-1">
                        {t("roomTopicSheet.description")}
                    </Text>
                    <Html
                        html={topicHtml}
                        className="text-sm text-discord-textPrimary whitespace-pre-wrap break-words [&_a]:text-discord-accent [&_a]:underline"
                    />
                </View>
            </BottomSheet>
        </Portal>
    );
}
