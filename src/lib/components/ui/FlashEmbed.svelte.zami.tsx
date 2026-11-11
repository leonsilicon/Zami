import { clampSize, RESIZE_STEP_PX } from "$lib/actions/resizeHandle";
import {
    clearSavedFlashSize,
    readSavedFlashSize,
    readSavedFlashVolume,
    writeSavedFlashSize,
    writeSavedFlashVolume,
    type FlashSize,
} from "$lib/utils/flashPrefs";
import { Grip } from "lucide-svelte";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import {
    Dimensions,
    I18nManager,
    PanResponder,
    Pressable,
    View,
    useWindowDimensions,
} from "react-native";
import {
    FlashSandbox,
    provideRuffleWasm,
    type FlashSandboxHandle,
} from "@-/com.leonsilicon.zami.flash";
import { SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";

interface Props {
    src: string; // URL of the SWF (a blob: URL of the fetched attachment)
}

// Ruffle's two wasm builds, the only files the sandbox may ask for.
const RUFFLE_WASM = /^[0-9a-f]{20}\.wasm$/;

export default function FlashEmbed({ src }: Props) {
    // Zami: the iframe is @-/com.leonsilicon.zami.flash's FlashSandbox, a WebView, and
    // its MessagePort is the WebView's bridge: `port` is the frame once it's "ready".
    const frame = useRef<FlashSandboxHandle | null>(null);
    const [port, setPort] = useState<FlashSandboxHandle | null>(null);
    // The frame left our page: something in it navigated, which Ruffle's
    // openUrlMode should never allow. Drop it rather than keep running it.
    const [navigatedAway, setNavigatedAway] = useState(false);
    // Zami: the frame's `load` and its port's `message` events, which the effect
    // below listens to (it sets them for each src).
    const frameEvents = useRef<{
        load(): void;
        message(msg: Record<string, unknown>): void;
    } | null>(null);

    // Ruffle runs in a WebView (static/flash-sandbox/'s page), never in this app:
    // whatever a SWF gets to execute is confined to a page with no access to the
    // session in this app's storage, its state, or the network.
    useEffect(() => {
        if (!frame.current) return;
        const target = frame.current;
        const currentSrc = src;
        let started = false;
        let disposed = false;

        const onmessage = async (msg: Record<string, unknown>) => {
            if (msg.type === "ready") {
                setPort(target);
                const volume = readSavedFlashVolume();
                if (volume !== null)
                    target.postMessage({ type: "volume", value: volume });
            } else if (msg.type === "volume") {
                writeSavedFlashVolume(msg.value);
            } else if (
                msg.type === "wasm" &&
                Number.isInteger(msg.id) &&
                typeof msg.name === "string" &&
                RUFFLE_WASM.test(msg.name)
            ) {
                // Zami: the page reads the wasm from its own directory, so the answer
                // is whether it's there now rather than its bytes.
                let available = false;
                try {
                    available = await provideRuffleWasm(msg.name);
                } catch (e) {
                    /* answered as unavailable */
                    console.warn("[flash] could not provide Ruffle's wasm", e);
                }
                if (disposed) return;
                target.postMessage({ type: "wasm", id: msg.id, available });
            } else if (msg.type === "error") {
                // Zami: the page's uncaught errors, which a WebView's console hides.
                console.warn("[flash]", msg.message);
            }
        };

        async function onLoad() {
            // Once only: a SWF that navigates the frame gets nothing more.
            if (started) {
                setNavigatedAway(true);
                return;
            }
            started = true;
            const swf = await (await fetch(currentSrc)).arrayBuffer();
            if (disposed) return;
            // Zami: the WebView's bridge carries the SWF as base64.
            target.postMessage({ type: "init", swf });
        }
        const onLoadSafe = () => void onLoad().catch(console.error);
        frameEvents.current = {
            load: onLoadSafe,
            message: (msg) => void onmessage(msg),
        };

        return () => {
            disposed = true;
            frameEvents.current = null;
            setPort(null);
        };
    }, [src]);

    const wrapperEl = useRef<ComponentRef<typeof View>>(null);
    const viewport = useWindowDimensions();
    const [parentWidth, setParentWidth] = useState(viewport.width);
    const [size, setSize] = useState<FlashSize | null>(readSavedFlashSize);
    const [dragging, setDragging] = useState(false);
    const current = useRef({ size, parentWidth, height: viewport.height });
    useEffect(() => {
        current.current = { size, parentWidth, height: viewport.height };
    });
    const drag = useRef<{ w: number; h: number } | null>(null);
    const pendingSize = useRef<FlashSize | null>(null);
    const lastTap = useRef(0);
    function resize(w: number, h: number): FlashSize {
        const next = clampSize(w, h, {
            minW: 240,
            minH: 135,
            maxW: current.current.parentWidth,
            maxH: current.current.height * 0.9,
        });
        const rounded = { w: Math.round(next.w), h: Math.round(next.h) };
        pendingSize.current = rounded;
        setSize(rounded);
        return rounded;
    }
    function resetSize() {
        setSize(null);
        clearSavedFlashSize();
    }
    // Zami: touch drag and VoiceOver steps in place of pointer capture/keys.
    const [grip] = useState(() =>
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onPanResponderGrant: () => {
                const c = current.current;
                drag.current = c.size ?? {
                    w: Math.min(c.parentWidth, 672),
                    h: (Math.min(c.parentWidth, 672) * 9) / 16,
                };
                pendingSize.current = null;
                setDragging(true);
            },
            onPanResponderMove: (_event, gesture) => {
                if (drag.current)
                    resize(
                        drag.current.w +
                            gesture.dx * (I18nManager.isRTL ? -1 : 1),
                        drag.current.h + gesture.dy,
                    );
            },
            onPanResponderRelease: () => {
                if (pendingSize.current)
                    writeSavedFlashSize(pendingSize.current);
                else {
                    const now = Date.now();
                    if (now - lastTap.current < 300) resetSize();
                    lastTap.current = now;
                }
                drag.current = null;
                setDragging(false);
            },
            onPanResponderTerminate: () => {
                if (pendingSize.current)
                    writeSavedFlashSize(pendingSize.current);
                drag.current = null;
                setDragging(false);
            },
        }),
    );

    useEffect(() => {
        if (!wrapperEl.current || !port) return;
        const el = wrapperEl.current;
        const p = port;
        // Zami: React Native has no IntersectionObserver; where the wrapper is on
        // screen is checked twice a second, and leaving the screen suspends it.
        let wasVisible: boolean | undefined;
        const check = () =>
            el.measureInWindow((x, y, width, height) => {
                const screen = Dimensions.get("window");
                const isIntersecting =
                    width > 0 &&
                    height > 0 &&
                    x < screen.width &&
                    y < screen.height &&
                    x + width > 0 &&
                    y + height > 0;
                if (!isIntersecting && wasVisible !== false)
                    p.postMessage({ type: "suspend" });
                wasVisible = isIntersecting;
            });
        check();
        const observer = setInterval(check, 500);
        return () => clearInterval(observer);
    }, [port]);

    return (
        <View
            className="w-full mt-1"
            onLayout={(e) => setParentWidth(e.nativeEvent.layout.width)}
        >
            <View
                ref={wrapperEl}
                className={`relative w-full ${size ? "" : "max-w-2xl aspect-video"}`}
                style={
                    size
                        ? {
                              width: Math.min(size.w, parentWidth),
                              height: Math.min(size.h, viewport.height * 0.9),
                          }
                        : undefined
                }
            >
                {/* No storage, network, windows or navigation: see
                @-/com.leonsilicon.zami.flash's FlashSandbox. */}
                {navigatedAway ? (
                    <View className="w-full h-full rounded-lg bg-black" />
                ) : (
                    <FlashSandbox
                        ref={frame}
                        onLoad={() => frameEvents.current?.load()}
                        onMessage={(msg) => frameEvents.current?.message(msg)}
                        // Zami: a navigation is refused before it happens, so it's
                        // reported rather than seen as a second load.
                        onNavigate={() => setNavigatedAway(true)}
                        accessibilityLabel={t("swfEmbed.adobeFlash")}
                        pointerEvents={dragging ? "none" : "auto"}
                        className="block w-full h-full rounded-lg overflow-hidden bg-black border-0"
                    />
                )}
                {port && !navigatedAway ? (
                    // Zami: touchscreens have no hover, so the button is always shown
                    // (upstream reveals it on hover: opacity-0 group-hover/flash:opacity-100).
                    <Pressable
                        onPress={() => port?.postMessage({ type: "suspend" })}
                        accessibilityRole="button"
                        accessibilityLabel={t("flashEmbed.suspend")}
                        className="absolute top-1.5 end-1.5 p-1 rounded-full bg-black/50 transition-opacity hover:bg-black/70"
                    >
                        <SvgIcon
                            d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"
                            className="w-4 h-4 text-white"
                        />
                    </Pressable>
                ) : null}
                {!navigatedAway ? (
                    <View
                        {...grip.panHandlers}
                        accessibilityRole="adjustable"
                        accessibilityLabel={t("flashEmbed.resize")}
                        accessibilityHint={t("flashEmbed.resizeHint")}
                        accessibilityActions={[
                            { name: "increment" },
                            { name: "decrement" },
                            { name: "reset", label: t("lightbox.zoomReset") },
                        ]}
                        onAccessibilityAction={(e) => {
                            if (e.nativeEvent.actionName === "reset")
                                return resetSize();
                            const base = current.current.size ?? {
                                w: Math.min(parentWidth, 672),
                                h: (Math.min(parentWidth, 672) * 9) / 16,
                            };
                            const step =
                                e.nativeEvent.actionName === "increment"
                                    ? RESIZE_STEP_PX
                                    : -RESIZE_STEP_PX;
                            writeSavedFlashSize(
                                resize(base.w + step, base.h + step),
                            );
                        }}
                        className="absolute bottom-0 end-0 p-3 rounded-ss-md bg-black/50"
                    >
                        <Grip size={14} className="text-white" />
                    </View>
                ) : null}
            </View>
        </View>
    );
}
