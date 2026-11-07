// A key combination as key caps: Ctrl + Shift + M.
import { Text, View } from "react-native";
import { bindingParts, type Binding } from "$lib/keybinds/keybinds";
import { IS_MAC } from "$lib/stores/keybinds.svelte";

interface Props {
    binding: Binding;
}

export default function KeyCaps({ binding }: Props) {
    const parts = bindingParts(binding, IS_MAC);

    return (
        <View
            className="flex-row items-center gap-1 flex-wrap"
            style={{ direction: "ltr" }}
        >
            {parts.map((part, i) => (
                <Text
                    key={i}
                    className="min-w-[1.5rem] px-1.5 py-0.5 rounded border border-discord-divider bg-discord-backgroundTertiary text-xs font-mono text-discord-textPrimary text-center shadow-[0_1px_0_var(--discord-divider)]"
                >
                    {part}
                </Text>
            ))}
        </View>
    );
}
