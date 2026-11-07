import { useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  useTapGesture,
} from "react-native-gesture-handler";

// The thumb's diameter (`w-4`).
const THUMB = 16;
// How far a finger moves sideways before a drag takes over, and up or down before it
// leaves the touch to a scroll view instead.
const DRAG_SLOP = 4;
const SCROLL_SLOP = 8;

export interface RangeProps {
  /** `value` / `bind:value`. */
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** The value changes during a drag (`oninput`). */
  onChange: (value: number) => void;
  /** A drag, tap or VoiceOver step has finished (`onchange`). */
  onChangeEnd?: (value: number) => void;
  disabled?: boolean;
  /** `aria-label`, or the `<label for>` text. */
  accessibilityLabel?: string;
  /** The `<input>`'s classes: its width and margins. */
  className?: string;
}

function decimals(n: number): number {
  return String(n).split(".")[1]?.length ?? 0;
}

/** `raw` rounded to the nearest step from `min`, kept within `min`…`max`. */
function snap(raw: number, min: number, max: number, step: number): number {
  const stepped = min + Math.round((raw - min) / step) * step;
  // 0.1 + 0.2 is 0.30000000000000004: round off what the step and min don't have.
  const rounded = Number(stepped.toFixed(Math.max(decimals(step), decimals(min))));
  return Math.min(max, Math.max(min, rounded));
}

/**
 * `<input type="range">`: a track and thumb. A tap on the track or a sideways drag
 * sets the value (react-native-gesture-handler, so a vertical swipe still scrolls the
 * view around it), and VoiceOver and TalkBack step it by `step` (swipe up/down). The
 * defaults are the HTML element's: 0 to 100 in steps of 1.
 */
export function Range({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onChangeEnd,
  disabled = false,
  accessibilityLabel,
  className = "",
}: RangeProps): ReactNode {
  const [width, setWidth] = useState(0);
  // The last value reported, which a drag's end reports again: the parent may not have
  // re-rendered with it yet.
  const last = useRef(value);
  const span = max - min;
  const fraction = span > 0 ? Math.min(Math.max((value - min) / span, 0), 1) : 0;
  const travel = Math.max(width - THUMB, 0);

  // The value at `x` along the track: the thumb's centre follows the finger.
  function valueAt(x: number): number {
    const at = travel > 0 ? Math.min(Math.max((x - THUMB / 2) / travel, 0), 1) : 0;
    return snap(min + at * span, min, max, step);
  }

  function set(next: number): void {
    if (next === last.current) return;
    last.current = next;
    onChange(next);
  }

  const drag = usePanGesture({
    runOnJS: true,
    enabled: !disabled,
    activeOffsetX: [-DRAG_SLOP, DRAG_SLOP],
    failOffsetY: [-SCROLL_SLOP, SCROLL_SLOP],
    onActivate: (event) => {
      last.current = value;
      set(valueAt(event.x));
    },
    onUpdate: (event) => set(valueAt(event.x)),
    onDeactivate: () => onChangeEnd?.(last.current),
  });
  const tap = useTapGesture({
    runOnJS: true,
    enabled: !disabled,
    onActivate: (event) => {
      last.current = value;
      set(valueAt(event.x));
      onChangeEnd?.(last.current);
    },
  });
  const gesture = useCompetingGestures(drag, tap);

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min, max, now: value }}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          const delta = event.nativeEvent.actionName === "increment" ? step : -step;
          last.current = value;
          set(snap(value + delta, min, max, step));
          onChangeEnd?.(last.current);
        }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        className={`w-full h-6 justify-center ${disabled ? "opacity-50" : ""} ${className}`}
      >
        <View
          pointerEvents="none"
          className="h-1 rounded-full bg-discord-backgroundTertiary overflow-hidden"
        >
          <View
            className="h-1 bg-discord-accent"
            style={{ width: fraction * travel + THUMB / 2 }}
          />
        </View>
        <View
          pointerEvents="none"
          className="absolute w-4 h-4 rounded-full bg-discord-accent"
          style={{ left: fraction * travel }}
        />
      </View>
    </GestureDetector>
  );
}
