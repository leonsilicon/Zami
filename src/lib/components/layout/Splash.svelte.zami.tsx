import { Spin } from "@-/com.leonsilicon.zami.rn";
import {
    currentStartupStep,
    subscribeStartup,
} from "@-/com.leonsilicon.zami.startup";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import Animated, {
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import { t } from "$lib/i18n";

// Shown while a stored session is being silently restored, on the same
// tertiary background as the login card so the restore reads as one
// continuous surface — no login-card flash before the shell appears.
//
// The spinner keeps turning under reduced motion (app.css carves out
// .animate-spin on purpose: a still spinner looks like a hung app). The
// progress bar is the one that stops: with reduced motion it sits as a
// static segment instead of sweeping.
export default function Splash({
    message = null,
}: {
    message?: string | null;
}) {
    return (
        <View className="flex-1 items-center justify-center gap-4 bg-zam-backgroundTertiary p-4">
            {/* Zami: a column, so the launch step can go under the message. */}
            <View className="items-center">
                <View className="flex-row items-center gap-3">
                    <Spin
                        className="w-5 h-5 border-2 border-zam-textMuted border-t-transparent rounded-full"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                    />
                    <Text
                        className="text-zam-textMuted"
                        accessibilityLiveRegion="polite"
                    >
                        {message ?? t("splash.restoringSession")}
                    </Text>
                </View>
                <StartupStep />
            </View>
            <SplashBar />
        </View>
    );
}

/**
 * Zami: once a launch has taken more than a second, the step it is on and how long
 * it has taken (@-/com.leonsilicon.zami.startup). If the JS thread is blocked, the
 * count stops, so the step shown is the one blocking it.
 */
function StartupStep() {
    const step = useSyncExternalStore(
        subscribeStartup,
        () => currentStartupStep().step,
    );
    const [elapsed, setElapsed] = useState(() => currentStartupStep().elapsed);
    useEffect(() => {
        const timer = setInterval(
            () => setElapsed(currentStartupStep().elapsed),
            250,
        );
        return () => clearInterval(timer);
    }, []);
    if (elapsed < 1000) return null;
    return (
        <Text className="mt-3 text-xs text-zam-textMuted">
            {`${step} · ${(elapsed / 1000).toFixed(1)} s`}
        </Text>
    );
}

/**
 * The sweeping bar under the message (upstream's `.splash-bar` keyframes:
 * from translateX(-100%) to translateX(250%) of the bar's own width, 1.6 s,
 * ease-in-out, forever). Uniwind has no keyframes, so Reanimated runs it; with
 * reduced motion the bar rests at its base position.
 */
function SplashBar() {
    const reduceMotion = useReducedMotion();
    const [trackWidth, setTrackWidth] = useState(0);
    const progress = useSharedValue(0);
    useEffect(() => {
        if (reduceMotion) return;
        progress.value = withRepeat(
            withTiming(1, {
                duration: 1600,
                easing: Easing.inOut(Easing.ease),
            }),
            -1,
        );
    }, [progress, reduceMotion]);
    const barWidth = trackWidth * 0.4;
    const animated = useAnimatedStyle(() => ({
        transform: [
            {
                translateX: reduceMotion
                    ? 0
                    : barWidth * (-1 + 3.5 * progress.value),
            },
        ],
    }));
    return (
        <View
            className="relative h-0.5 w-48 max-w-[70vw] overflow-hidden rounded-full bg-zam-accent/20"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        >
            <Animated.View
                className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-zam-accent"
                style={animated}
            />
        </View>
    );
}
