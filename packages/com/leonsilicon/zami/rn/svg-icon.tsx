import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
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
  /** The `<svg>`'s classes: `w-*`/`h-*` size it, and its `text-*` color fills it. */
  className?: string;
}

/**
 * Zam's inline `<svg fill="currentColor" viewBox="0 0 24 24"><path d="…" /></svg>`.
 * `className` sizes and places it, and its text color fills it, as `currentColor`
 * would. It's decorative: screen readers skip it, as upstream marks such icons
 * `aria-hidden`.
 */
export function SvgIcon({
  d,
  children,
  viewBox = "0 0 24 24",
  size,
  className = "",
}: SvgIconProps): ReactNode {
  const fallback = useResolveClassNames(FALLBACK_COLOR);
  const { color } = useResolveClassNames(className);
  return (
    <View
      className={className}
      style={size === undefined ? undefined : { width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width="100%" height="100%" viewBox={viewBox} fill={color ?? fallback.color}>
        {d === undefined ? null : <Path d={d} />}
        {children}
      </Svg>
    </View>
  );
}
