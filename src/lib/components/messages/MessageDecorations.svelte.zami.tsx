// Additive per-message badges from plugins (zam.messages.decorate).
// INTEROP (spec §2): overlay only — never replaces body rendering. Badge
// and tooltip are plugin strings rendered as ESCAPED TEXT ({...}), never
// {@html}.
import { Text, View } from "react-native";
import type { MessageDecoration } from "$lib/utils/pluginMessageActions";

// Zami: `title` (the hover tooltip) has no React Native equivalent; the info
// dot keeps the tooltip as its accessible name, as upstream does.
export default function MessageDecorations({
    decorations,
}: {
    decorations: MessageDecoration[];
}) {
    return decorations.map((d) =>
        d.badge ? (
            <View
                key={d.key}
                className="flex-row items-center px-1.5 py-0.5 rounded bg-discord-backgroundSecondary border border-discord-divider"
            >
                <Text className="text-[10px] font-semibold leading-none text-discord-textMuted">
                    {d.badge}
                </Text>
            </View>
        ) : d.tooltip ? (
            <View
                key={d.key}
                accessible
                accessibilityLabel={d.tooltip}
                className="flex-row items-center justify-center w-3.5 h-3.5 rounded-full bg-discord-backgroundSecondary border border-discord-divider"
            >
                <Text className="text-[9px] font-semibold text-discord-textMuted">
                    i
                </Text>
            </View>
        ) : null,
    );
}
