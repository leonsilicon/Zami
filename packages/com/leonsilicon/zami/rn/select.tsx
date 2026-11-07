import { withClassName } from "@-/com.leonsilicon.zami.icons";
import { Check, ChevronDown } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type HostInstance,
} from "react-native";
import { Portal } from "#portal";

const CheckIcon = withClassName("Check", Check);
const ChevronDownIcon = withClassName("ChevronDown", ChevronDown);

// How far the list keeps from the trigger and from the window's edges, and the height
// of one option (`py-2` around a `text-sm` line), for choosing where the list fits.
const GAP = 4;
const MARGIN = 8;
const OPTION_HEIGHT = 36;
const MIN_LIST_HEIGHT = 5 * OPTION_HEIGHT;

/** An `<option>`: its `value` and its text. `key` defaults to the value. */
export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  key?: string;
}

export interface SelectProps<T extends string = string> {
  /** The selected option's value, as `<select value>` / `bind:value`. */
  value: T;
  /** The `<option>`s, in order. */
  options: readonly SelectOption<T>[];
  /** An option was picked (`onchange`). */
  onChange: (value: T) => void;
  disabled?: boolean;
  /** `aria-label`, or the `<label for>` text. */
  accessibilityLabel?: string;
  /** `id`, for a label that points at it. */
  nativeID?: string;
  /** The `<select>`'s classes: its box (background, border, padding, width). */
  className?: string;
}

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A `<select>`. It shows the selected option's label; a press opens the options in a
 * list above the app (through `Portal`), beneath the box or above it, wherever more of
 * the list fits. Picking one, or pressing outside the list, closes it.
 */
export function Select<T extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  accessibilityLabel,
  nativeID,
  className = "",
}: SelectProps<T>): ReactNode {
  const box = useRef<HostInstance>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const { height: windowHeight } = useWindowDimensions();
  const selected = options.find((option) => option.value === value);
  const open = anchor !== null && !disabled;

  function close(): void {
    setAnchor(null);
  }

  // Android's back button closes the list rather than the screen.
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setAnchor(null);
      return true;
    });
    return () => subscription.remove();
  }, [open]);

  function toggle(): void {
    if (anchor) return close();
    box.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  }

  let placement = null;
  if (anchor) {
    const below = windowHeight - (anchor.y + anchor.height) - GAP - MARGIN;
    const above = anchor.y - GAP - MARGIN;
    const wanted = Math.min(options.length * OPTION_HEIGHT, MIN_LIST_HEIGHT);
    placement =
      below >= wanted || below >= above
        ? { top: anchor.y + anchor.height + GAP, maxHeight: Math.max(below, OPTION_HEIGHT) }
        : { bottom: windowHeight - anchor.y + GAP, maxHeight: above };
  }

  return (
    <>
      <Pressable
        ref={box}
        nativeID={nativeID}
        accessibilityRole="combobox"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: selected?.label }}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={toggle}
        className={`flex-row items-center gap-2 ${className}`}
      >
        <Text numberOfLines={1} className="flex-1 text-sm text-discord-textPrimary">
          {selected?.label ?? ""}
        </Text>
        <ChevronDownIcon size={16} className="text-discord-textMuted" />
      </Pressable>
      {open && anchor && placement ? (
        <Portal>
          <View
            style={StyleSheet.absoluteFill}
            accessibilityViewIsModal
            onAccessibilityEscape={close}
          >
            <Pressable style={StyleSheet.absoluteFill} accessible={false} onPress={close} />
            <View
              className="absolute rounded bg-discord-backgroundSecondary border border-discord-divider overflow-hidden"
              style={{ left: anchor.x, width: anchor.width, ...placement }}
            >
              <ScrollView keyboardShouldPersistTaps="handled">
                {options.map((option) => (
                  <Pressable
                    key={option.key ?? option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.value === value }}
                    onPress={() => {
                      close();
                      onChange(option.value);
                    }}
                    className={`flex-row items-center gap-2 px-3 py-2 ${
                      option.value === value ? "bg-discord-accent/20" : ""
                    }`}
                  >
                    <Text numberOfLines={1} className="flex-1 text-sm text-discord-textPrimary">
                      {option.label}
                    </Text>
                    {option.value === value ? (
                      <CheckIcon size={14} className="text-discord-accent" />
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        </Portal>
      ) : null}
    </>
  );
}
