import { withClassName } from "@-/com.leonsilicon.zami.icons";
import { Check } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

const CheckIcon = withClassName("Check", Check);

export interface CheckboxProps {
  /** `checked` / `bind:checked`. */
  checked: boolean;
  /** It was toggled (`onchange`), with the new state. */
  onChange: (checked: boolean) => void;
  /**
   * The `<label>`'s content after the box: a string is a `Text` with `labelClassName`;
   * anything else renders as it is.
   */
  label?: ReactNode;
  /** The label text's classes (the `<label>`'s or `<span>`'s `text-*`). */
  labelClassName?: string;
  /** `aria-label`, for a checkbox whose label isn't its text. */
  accessibilityLabel?: string;
  disabled?: boolean;
  /** The `<label>`'s layout classes. It's a row; `flex` is implied. */
  className?: string;
}

/**
 * `<label><input type="checkbox"> text</label>`: a box that shows a check mark, then
 * the label. Pressing anywhere on it toggles it. A disabled box is dimmed, as the
 * browser dims a disabled checkbox.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  labelClassName = "text-sm text-discord-textPrimary",
  accessibilityLabel,
  disabled = false,
  className = "items-center gap-2",
}: CheckboxProps): ReactNode {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      className={`flex-row ${className}`}
    >
      <View
        className={`w-3.5 h-3.5 rounded-sm border items-center justify-center ${
          checked ? "bg-discord-accent border-discord-accent" : "border-discord-textMuted"
        } ${disabled ? "opacity-50" : ""}`}
      >
        {checked ? <CheckIcon size={10} className="text-white" /> : null}
      </View>
      {typeof label === "string" || typeof label === "number" ? (
        <Text className={labelClassName}>{label}</Text>
      ) : (
        label
      )}
    </Pressable>
  );
}
