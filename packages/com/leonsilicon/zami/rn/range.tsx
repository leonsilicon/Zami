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
  /**
   * A drag, tap or VoiceOver step that changed the value has finished (`onchange`,
   * which doesn't fire when the value ends where it started).
   */
  onChangeEnd?: (value: number) => void;
  disabled?: boolean;
  /** `aria-label`, or the `<label for>` text. */
  accessibilityLabel?: string;
  /** `aria-valuetext`: the value as screen readers announce it, such as "2.5 Mbps". */
  accessibilityValueText?: string;
  /** The values a `<datalist list>` lists, each marked with a tick under the track. */
  ticks?: readonly number[];
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
 * defaults are the HTML element's: 0 to 100 in steps of 1. `ticks` marks values under
 * the track, as browsers mark a `<datalist>`'s options.
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
  accessibilityValueText,
  ticks = [],
  className = "",
}: RangeProps): ReactNode {
  const [width, setWidth] = useState(0);
  // The value when a drag or tap began, and the last one reported, which its end
  // reports again if they differ: the parent may not have re-rendered with it yet.
  const start = useRef(value);
  const last = useRef(value);
  const span = max - min;
  const fractionOf = (v: number) => (span > 0 ? Math.min(Math.max((v - min) / span, 0), 1) : 0);
  const fraction = fractionOf(value);
  const travel = Math.max(width - THUMB, 0);

  // The value at `x` along the track: the thumb's centre follows the finger.
  function valueAt(x: number): number {
    const at = travel > 0 ? Math.min(Math.max((x - THUMB / 2) / travel, 0), 1) : 0;
    return snap(min + at * span, min, max, step);
  }

  function begin(): void {
    start.current = value;
    last.current = value;
  }

  function set(next: number): void {
    if (next === last.current) return;
    last.current = next;
    onChange(next);
  }

  function end(): void {
    if (last.current !== start.current) onChangeEnd?.(last.current);
  }

  const drag = usePanGesture({
    runOnJS: true,
    enabled: !disabled,
    activeOffsetX: [-DRAG_SLOP, DRAG_SLOP],
    failOffsetY: [-SCROLL_SLOP, SCROLL_SLOP],
    onActivate: (event) => {
      begin();
      set(valueAt(event.x));
    },
    onUpdate: (event) => set(valueAt(event.x)),
    onDeactivate: end,
  });
  const tap = useTapGesture({
    runOnJS: true,
    enabled: !disabled,
    onActivate: (event) => {
      begin();
      set(valueAt(event.x));
      end();
    },
  });
  const gesture = useCompetingGestures(drag, tap);

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={
          accessibilityValueText === undefined
            ? { min, max, now: value }
            : { min, max, now: value, text: accessibilityValueText }
        }
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          const delta = event.nativeEvent.actionName === "increment" ? step : -step;
          begin();
          set(snap(value + delta, min, max, step));
          end();
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
        {ticks.map((tick) => (
          <View
            key={tick}
            pointerEvents="none"
            className="absolute bottom-0 w-px h-1.5 bg-discord-textMuted"
            style={{ left: fractionOf(tick) * travel + THUMB / 2 }}
          />
        ))}
        <View
          pointerEvents="none"
          className="absolute w-4 h-4 rounded-full bg-discord-accent"
          style={{ left: fraction * travel }}
        />
      </View>
    </GestureDetector>
  );
}
