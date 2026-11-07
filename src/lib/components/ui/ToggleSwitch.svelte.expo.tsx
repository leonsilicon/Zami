import { Pressable, View } from "react-native";

interface Props {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    title?: string;
}

// Zami: `title` (a hover tooltip) has no React Native equivalent, so it isn't used.
export default function ToggleSwitch({ checked, onChange, label }: Props) {
    return (
        <Pressable
            accessibilityRole="switch"
            accessibilityLabel={label}
            accessibilityState={{ checked }}
            onPress={() => onChange(!checked)}
            className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors ${
                checked ? "bg-discord-accent" : "bg-discord-backgroundTertiary"
            }`}
        >
            {/* The knob is placed with a logical inset (not translate-x) so it slides
                toward the end edge in either direction without an RTL override:
                off = 0.125rem from the start, on = 1.375rem (track 2.5rem - knob
                1rem - 0.125rem gap). */}
            <View
                className={`absolute top-0.5 w-4 h-4 rounded-full shadow transition-[inset-inline-start,background-color] ${
                    checked
                        ? "start-[1.375rem] bg-white"
                        : "start-0.5 bg-discord-textPrimary"
                }`}
            />
        </Pressable>
    );
}
