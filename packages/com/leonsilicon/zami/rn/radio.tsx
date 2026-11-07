import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useResolveClassNames } from "uniwind";

export interface RadioProps<T> {
  /** The `<input>`'s `value`. */
  value: T;
  /** `bind:group`: the group's selected value. The radio is checked when it's `value`. */
  group: T;
  /** It was chosen (`onchange`), with its `value`. Pressing a checked radio does nothing. */
  onChange: (value: T) => void;
  /**
   * The `<label>`'s content after the circle: a string is a `Text` with `labelClassName`;
   * anything else renders as it is.
   */
  label?: ReactNode;
  /** The label text's classes (the `<label>`'s or `<span>`'s `text-*`). */
  labelClassName?: string;
  /** `aria-label`, for a radio whose label isn't its text. */
  accessibilityLabel?: string;
  disabled?: boolean;
  /** The `<label>`'s layout classes. It's a row; `flex` is implied. */
  className?: string;
  /**
   * The `<input>`'s own classes: its size and margins (`mt-0.5 w-4 h-4`). By default the
   * browser's circle, `w-3.5 h-3.5`. It's always round.
   */
  inputClassName?: string;
}

/**
 * `<label><input type="radio" bind:group {value}> text</label>`, drawn as `Checkbox`
 * draws a checkbox: a circle that shows a dot while checked, then the label. Pressing
 * anywhere on it selects it. A disabled circle is dimmed, as the browser dims a disabled
 * radio. Put a group's radios in a `View` with `accessibilityRole="radiogroup"`.
 */
export function Radio<T>({
  value,
  group,
  onChange,
  label,
  labelClassName = "text-sm text-discord-textPrimary",
  accessibilityLabel,
  disabled = false,
  className = "items-center gap-2",
  inputClassName = "w-3.5 h-3.5",
}: RadioProps<T>): ReactNode {
  const checked = Object.is(group, value);
  // The dot fills the circle as the browser's does: 8 in the default 14.
  const { width } = useResolveClassNames(inputClassName);
  const dotSize = typeof width === "number" ? Math.round((width * 4) / 7) : 8;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => {
        if (!checked) onChange(value);
      }}
      className={`flex-row ${className}`}
    >
      <View
        className={`${inputClassName} rounded-full border items-center justify-center ${
          checked ? "border-discord-accent" : "border-discord-textMuted"
        } ${disabled ? "opacity-50" : ""}`}
      >
        {checked ? (
          <View
            className="rounded-full bg-discord-accent"
            style={{ width: dotSize, height: dotSize }}
          />
        ) : null}
      </View>
      {typeof label === "string" || typeof label === "number" ? (
        <Text className={`shrink ${labelClassName}`}>{label}</Text>
      ) : (
        label
      )}
    </Pressable>
  );
}
