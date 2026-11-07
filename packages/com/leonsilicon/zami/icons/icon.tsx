import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react-native";
import { useResolveClassNames } from "uniwind";

// On the web an icon is `currentColor`, its parent's text color. React Native has no
// inheritance, so an icon without a color class falls back to Zam's primary text color
// rather than black.
const FALLBACK_COLOR = "text-discord-textPrimary";

/**
 * A lucide-react-native icon that also takes a `className`: `w-*`/`h-*`/`size-*` set its
 * size (unless `size` is given) and a `text-*` color its stroke (unless `color` is).
 */
export function withClassName(name: string, Icon: ComponentType<LucideProps>) {
  function Wrapped({ className, size, color, style, ...rest }: LucideProps): ReactNode {
    const fallback = useResolveClassNames(FALLBACK_COLOR);
    const {
      color: classColor,
      width,
      height,
      ...classStyle
    } = useResolveClassNames(className ?? "");
    return (
      <Icon
        {...rest}
        size={size ?? (width as number | undefined) ?? (height as number | undefined) ?? 24}
        color={color ?? (classColor as string | undefined) ?? (fallback.color as string)}
        style={[classStyle, style]}
      />
    );
  }
  Wrapped.displayName = name;
  return Wrapped;
}
