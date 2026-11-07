import { useEffect, useRef, type ReactNode } from "react";
import { View, type HostInstance, type ViewProps } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

// Zam's settings search scrolls a result's `[data-setting-anchor="…"]` element into view
// and flashes it (`.message-highlight`). Here the element is a SettingAnchor, which
// registers itself under its anchor while it's mounted, and revealSettingAnchor does the
// scrolling and the flash.

interface Anchor {
  view(): HostInstance | null;
  flash(): void;
}

const anchors = new Map<string, Anchor>();

export interface SettingAnchorProps extends ViewProps {
  /** The `data-setting-anchor` value. */
  anchor: string;
  /** The element's classes. */
  className?: string;
  children?: ReactNode;
}

/**
 * `<div data-setting-anchor={anchor}>`: a View that settings search can scroll to and
 * flash with `.message-highlight`'s wash (held for 70% of 2s, then faded out; under
 * reduced motion Reanimated skips it, as the web's collapsed animation never shows).
 */
export function SettingAnchor({ anchor, children, ...props }: SettingAnchorProps): ReactNode {
  const ref = useRef<HostInstance>(null);
  const opacity = useSharedValue(0);
  useEffect(() => {
    const entry: Anchor = {
      view: () => ref.current,
      flash() {
        opacity.value = 1;
        opacity.value = withDelay(
          1400,
          withTiming(0, { duration: 600, easing: Easing.bezier(0, 0, 0.58, 1) }),
        );
      },
    };
    anchors.set(anchor, entry);
    return () => {
      if (anchors.get(anchor) === entry) anchors.delete(anchor);
    };
  }, [anchor, opacity]);
  const wash = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <View ref={ref} {...props}>
      {/* Beneath the content, as the web's background is. */}
      <Animated.View
        pointerEvents="none"
        style={wash}
        className="absolute inset-0 bg-[rgb(var(--discord-mention-highlight-rgb)_/_0.35)]"
      />
      {children}
    </View>
  );
}

/** The part of a ScrollView (or a KeyboardAwareScrollView's) that revealing uses. */
export interface AnchorScrollView {
  scrollTo(options: { x?: number; y?: number; animated?: boolean }): void;
  getInnerViewRef?(): unknown;
  getNativeScrollRef?(): unknown;
}

/**
 * Scrolls `scrollView` so the mounted SettingAnchor `anchor` is at its top, and flashes
 * it. Returns false when no such anchor is mounted (the control isn't rendered, so
 * landing on its tab is enough, as on the web).
 */
export function revealSettingAnchor(anchor: string, scrollView: AnchorScrollView | null): boolean {
  const entry = anchors.get(anchor);
  const view = entry?.view();
  if (!entry || !view || !scrollView) return false;
  const content = scrollView.getInnerViewRef?.() ?? scrollView.getNativeScrollRef?.() ?? scrollView;
  view.measureLayout(
    content as never,
    (_x, y) => {
      scrollView.scrollTo({ y: Math.max(0, y), animated: true });
      entry.flash();
    },
    () => entry.flash(),
  );
  return true;
}
