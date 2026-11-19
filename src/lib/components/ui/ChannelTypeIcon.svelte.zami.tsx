// The icon in front of a channel's name, Discord style: # for text, a
// speaker for voice, and so on (kinds from utils/bridgedChannels.ts).
import { View } from "react-native";
import { t } from "$lib/i18n";
import type { ChannelIconKind } from "$lib/utils/bridgedChannels";
import {
    Hash,
    Image,
    Megaphone,
    MessageSquareLock,
    MessageSquareText,
    MessagesSquare,
    Radio,
    Video,
    Volume2,
} from "lucide-svelte";

interface Props {
    kind: ChannelIconKind;
    size?: number;
    class?: string;
    /** Zami: the icon's text color class. On the web the icon takes its
     *  parent's color; here nothing inherits, so a caller whose row sets the
     *  color passes it. `text-*` classes in `class` apply too. */
    iconClass?: string;
}

// Zami: the `text-*` classes of `class`, which on the web color the icon.
function textClasses(className: string): string {
    return className
        .split(/\s+/)
        .filter((c) => /^(?:[\w-]+:)*text-/.test(c))
        .join(" ");
}

export default function ChannelTypeIcon({
    kind,
    size = 14,
    class: className = "",
    iconClass = "",
}: Props) {
    const Icon = {
        text: Hash,
        video: Video,
        voice: Volume2,
        stage: Radio,
        announcement: Megaphone,
        forum: MessageSquareText,
        media: Image,
        thread: MessagesSquare,
        private_thread: MessageSquareLock,
    }[kind];
    // Text channels are the default and go unlabelled, as before.
    const label = {
        text: null,
        video: t("common.videoRoom"),
        voice: t("bridgedChannels.voice"),
        stage: t("bridgedChannels.stage"),
        announcement: t("bridgedChannels.announcement"),
        forum: t("bridgedChannels.forum"),
        media: t("bridgedChannels.media"),
        thread: t("bridgedThreads.thread"),
        private_thread: t("bridgedChannels.privateThread"),
    }[kind];

    // Zami: `title` has no equivalent; the label is the accessibility label.
    return (
        <View
            className={`flex-row items-center justify-center ${className}`}
            accessible={label ? true : false}
            accessibilityRole={label ? "image" : undefined}
            accessibilityLabel={label ?? undefined}
            importantForAccessibility={label ? "yes" : "no-hide-descendants"}
        >
            <Icon
                size={size}
                className={`${textClasses(className)} ${iconClass}`.trim()}
            />
        </View>
    );
}
