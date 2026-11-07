import { useEffect, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
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

interface AnimationProps {
  /** The animated element's classes (minus the `animate-*` one), as upstream has them. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** What to animate instead of a styled box, such as an icon. */
  children?: ReactNode;
}

/**
 * `animate-spin`: one turn per second, forever. Give it the spinner's classes
 * (`<Spin className="w-4 h-4 border-2 … rounded-full" />`) or wrap what spins
 * (`<Spin><Loader2 size={16} /></Spin>`).
 */
export function Spin({ className, style, children }: AnimationProps): ReactNode {
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1);
  }, [turn]);
  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  return (
    <Animated.View style={[{ alignSelf: "flex-start" }, animated, style]}>
      {children ?? <View className={className} />}
    </Animated.View>
  );
}

/** `animate-pulse`: fades to half opacity and back every two seconds. */
export function Pulse({ className, style, children }: AnimationProps): ReactNode {
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
    <Animated.View style={[animated, style]}>
      {children ?? <View className={className} />}
    </Animated.View>
  );
}
