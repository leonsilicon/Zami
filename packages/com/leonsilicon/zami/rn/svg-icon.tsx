import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Path, type NumberProp } from "react-native-svg";
import { useResolveClassNames } from "uniwind";

// As for lucide icons (@-/com.leonsilicon.zami.icons): with no color class, Zam's
// primary text color rather than black.
const FALLBACK_COLOR = "text-discord-textPrimary";

export interface SvgIconProps {
  /** The `<path d>` of a single-path icon. */
  d?: string;
  /** react-native-svg `Path`s (and the like), for an icon with more than one path. */
  children?: ReactNode;
  viewBox?: string;
  /** Width and height, in place of `w-*`/`h-*` classes. */
  size?: number;
  /** The `<svg>`'s classes: `w-*`/`h-*` size it, and its `text-*` color is `currentColor`. */
  className?: string;
  /** The `<svg>`'s `fill`: `currentColor` (the default), `none` or a color. */
  fill?: string;
  /** The `<svg>`'s `stroke`, as `fill` (none by default). */
  stroke?: string;
  strokeWidth?: NumberProp;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
}

/**
 * Zam's inline `<svg fill="currentColor" viewBox="0 0 24 24"><path d="…" /></svg>`, or a
 * stroked one (`fill="none" stroke="currentColor" stroke-width="2"`). `className` sizes
 * and places it, and its text color is `currentColor`, which the `<svg>`'s `fill` and
 * `stroke` and its paths' own can name. It's decorative: screen readers skip it, as
 * upstream marks such icons `aria-hidden`.
 */
export function SvgIcon({
  d,
  children,
  viewBox = "0 0 24 24",
  size,
  className = "",
  fill = "currentColor",
  stroke,
  strokeWidth,
  strokeLinecap,
  strokeLinejoin,
}: SvgIconProps): ReactNode {
  const fallback = useResolveClassNames(FALLBACK_COLOR);
  const { color } = useResolveClassNames(className);
  const current = (color ?? fallback.color) as string | undefined;
  const paint = (value: string | undefined) => (value === "currentColor" ? current : value);
  return (
    <View
      className={className}
      style={size === undefined ? undefined : { width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={viewBox}
        color={current}
        fill={paint(fill)}
        stroke={paint(stroke)}
        strokeWidth={strokeWidth}
        strokeLinecap={strokeLinecap}
        strokeLinejoin={strokeLinejoin}
      >
        {d === undefined ? null : <Path d={d} />}
        {children}
      </Svg>
    </View>
  );
}
