import { View } from "react-native";
import { ShieldAlert, ShieldX } from "lucide-svelte";
import type { ShieldView } from "$lib/utils/eventShield";

interface Props {
    shield: ShieldView;
}

export default function EventShield({ shield }: Props) {
    // Grey shields are advisory, red ones are a security warning.
    const toneClass =
        shield.tone === "danger"
            ? "text-discord-danger"
            : "text-discord-textMuted";

    // Icon-only on purpose: a text label on every warning message is noise in a
    // room full of unverified devices. The reason travels in the tooltip and the
    // accessible name instead.
    // Zami: there's no tooltip (`title`); the tone colors the icon, which
    // doesn't inherit it.
    return (
        <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={shield.label}
            className="flex-row flex-shrink-0 self-center"
        >
            {shield.icon === "shield-x" ? (
                <ShieldX size={14} className={toneClass} />
            ) : (
                <ShieldAlert size={14} className={toneClass} />
            )}
        </View>
    );
}
