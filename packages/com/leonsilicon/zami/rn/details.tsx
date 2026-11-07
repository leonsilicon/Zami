import { withClassName } from "@-/com.leonsilicon.zami.icons";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useResolveClassNames } from "uniwind";

const ChevronDownIcon = withClassName("ChevronDown", ChevronDown);
const ChevronRightIcon = withClassName("ChevronRight", ChevronRight);

export interface DetailsProps {
  /**
   * The `<summary>`'s content: a string is a `Text` with `summaryTextClassName`; anything
   * else renders as it is.
   */
  summary: ReactNode;
  /**
   * The summary's text classes (the `<summary>`'s `text-*`/`font-*`). Its color is also the
   * disclosure triangle's, and its font size the triangle's size, as the browser draws the
   * marker in the summary's font.
   */
  summaryTextClassName?: string;
  /** The `<summary>`'s layout classes (padding, gap). It's a row; `flex` is implied. */
  summaryClassName?: string;
  /**
   * Whether to draw the disclosure triangle. Upstream drops it with a `<summary>` it lays
   * out as `flex`, which is no longer a list item.
   */
  marker?: boolean;
  /**
   * `open` (`bind:open`), for a caller that controls it, with `onToggle`. Without it the
   * element keeps its own state, starting closed.
   */
  open?: boolean;
  /** It was opened or closed (`ontoggle`), with its new state. */
  onToggle?: (open: boolean) => void;
  /** The `<details>`'s classes. */
  className?: string;
  /** The content after the `<summary>`. */
  children?: ReactNode;
}

/**
 * `<details><summary>…</summary>…</details>`: pressing the summary, with its disclosure
 * triangle, shows or hides the rest. As with `<details>`, a closed body stays mounted
 * (hidden), so what's in it keeps its state.
 */
export function Details({
  summary,
  summaryTextClassName = "text-sm text-discord-textPrimary",
  summaryClassName = "items-center gap-1",
  marker = true,
  open,
  onToggle,
  className,
  children,
}: DetailsProps): ReactNode {
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const { color, fontSize } = useResolveClassNames(summaryTextClassName);
  const markerSize = typeof fontSize === "number" ? fontSize : 14;
  function toggle() {
    const next = !isOpen;
    if (open === undefined) setOwnOpen(next);
    onToggle?.(next);
  }
  return (
    <View className={className}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        onPress={toggle}
        className={`flex-row ${summaryClassName}`}
      >
        {!marker ? null : isOpen ? (
          <ChevronDownIcon size={markerSize} color={color as string | undefined} />
        ) : (
          <ChevronRightIcon
            size={markerSize}
            color={color as string | undefined}
            className="rtl:-scale-x-100"
          />
        )}
        {typeof summary === "string" || typeof summary === "number" ? (
          <Text className={`shrink ${summaryTextClassName}`}>{summary}</Text>
        ) : (
          summary
        )}
      </Pressable>
      <View className={isOpen ? undefined : "hidden"}>{children}</View>
    </View>
  );
}
