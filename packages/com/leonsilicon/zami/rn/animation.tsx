import { useEffect, type ReactNode } from "react";
import type { ViewProps, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

// Tailwind's `animate-spin` and `animate-pulse`, which Uniwind doesn't support: the
// keyframes run on Reanimated instead.

interface AnimationProps extends ViewProps {
  /**
   * The animated element's classes (minus the `animate-*` one), as upstream has them:
   * without `children`, they style the box that animates, so its size, margins and
   * flex classes lay it out as the web element. Around `children`, they place the
   * wrapper (margins, `self-*`).
   */
  className?: string;
  /** What to animate instead of a styled box, such as an icon. */
  children?: ReactNode;
}

// A wrapper that a `stretch` parent widens (or heightens) keeps what it wraps at its
// centre, so it turns about its own centre rather than orbiting the wrapper's.
const CENTRED: ViewStyle = { alignItems: "center", justifyContent: "center" };

/**
 * `animate-spin`: one turn per second, forever. Give it the spinner's classes
 * (`<Spin className="w-4 h-4 border-2 … rounded-full" />`), which style the box that
 * turns, or wrap what spins (`<Spin><Loader2 size={16} /></Spin>`). It takes no
 * touches (a turning wrapper would sweep over its neighbours), and passes other view
 * props (accessibility) on.
 */
export function Spin({ className, style, children, ...props }: AnimationProps): ReactNode {
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1);
  }, [turn]);
  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  return (
    <Animated.View
      pointerEvents="none"
      {...props}
      className={className}
      style={[children === undefined ? undefined : CENTRED, animated, style]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * `animate-pulse`: fades to half opacity and back every two seconds. Its classes style
 * the box that fades, or place the wrapper around `children`, as for `Spin`.
 */
export function Pulse({ className, style, children, ...props }: AnimationProps): ReactNode {
  const opacity = useSharedValue(1);
  useEffect(() => {
    const ease = Easing.bezier(0.4, 0, 0.6, 1);
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.5, { duration: 1000, easing: ease }),
        withTiming(1, { duration: 1000, easing: ease }),
      ),
      -1,
    );
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View {...props} className={className} style={[animated, style]}>
      {children}
    </Animated.View>
  );
}
