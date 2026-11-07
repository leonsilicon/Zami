import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Dimensions, Pressable, View } from "react-native";
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
            ref={wrapperEl}
            className="relative w-full max-w-sm mt-1 group/flash"
        >
            {/* No storage, network, windows or navigation: see
                @-/com.leonsilicon.zami.flash's FlashSandbox. */}
            {navigatedAway ? (
                <View className="w-full aspect-video rounded-lg bg-black" />
            ) : (
                <FlashSandbox
                    ref={frame}
                    onLoad={() => frameEvents.current?.load()}
                    onMessage={(msg) => frameEvents.current?.message(msg)}
                    // Zami: a navigation is refused before it happens, so it's
                    // reported rather than seen as a second load.
                    onNavigate={() => setNavigatedAway(true)}
                    accessibilityLabel={t("swfEmbed.adobeFlash")}
                    className="block w-full aspect-video rounded-lg overflow-hidden bg-black border-0"
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
        </View>
    );
}
