import { Pressable, Text, View } from "react-native";

interface SelectorOption<T extends string> {
    value: T;
    label: string;
    title?: string;
    disabled?: boolean;
}

interface Props<T extends string> {
    value: T;
    options: readonly SelectorOption<T>[];
    onChange: (value: T) => void;
    ariaLabel: string;
}

// Zami: an option's `title` (a hover tooltip) has no React Native equivalent, so it
// isn't used. `aria-pressed` is `accessibilityState.selected`.
export default function OptionSelector<T extends string>({
    value,
    options,
    onChange,
    ariaLabel,
}: Props<T>) {
    return (
        <View
            className="flex-row gap-1 flex-shrink-0"
            role="group"
            accessibilityLabel={ariaLabel}
        >
            {options.map((option) => {
                const selected = value === option.value;
                return (
                    <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityState={{
                            selected,
                            disabled: !!option.disabled,
                        }}
                        onPress={() => onChange(option.value)}
                        disabled={option.disabled}
                        className={`px-2.5 py-1 rounded transition-colors ${
                            option.disabled ? "opacity-40" : ""
                        } ${
                            selected
                                ? "bg-discord-accent"
                                : `bg-discord-backgroundTertiary ${
                                      option.disabled
                                          ? ""
                                          : "hover:bg-discord-messageHover"
                                  }`
                        }`}
                    >
                        <Text
                            className={`text-xs font-medium ${
                                selected
                                    ? "text-white"
                                    : "text-discord-textMuted"
                            }`}
                        >
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}
