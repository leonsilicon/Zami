import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { AudioLines } from "lucide-svelte";
import type { Room } from "matrix-js-sdk";
import { useRef, useState } from "react";
import { Pressable, type PressableInstance } from "react-native";
import { t } from "$lib/i18n";
import SoundboardPopover from "./SoundboardPopover.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";

interface Props {
    room: Room;
    size?: number;
    /** Padding and shape, which differ between the call view, the sidebar
     *  panel and the banner. */
    buttonClass: string;
    /** Colour while the popover is closed. */
    idleClass: string;
}

export default function SoundboardButton({
    room,
    size = 20,
    buttonClass,
    idleClass,
}: Props) {
    const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
    const closedAt = useRef(0);
    const buttonRef = useRef<PressableInstance>(null);
    const touch = useRune(() => interfaceState.isTouchscreen);

    function close(): void {
        setAnchor(null);
        closedAt.current = performance.now();
    }

    // Zami: a press doesn't bubble to an enclosing Pressable, so there's no
    // stopPropagation; the button's window position stands in for
    // getBoundingClientRect().
    function toggle(): void {
        if (anchor) return close();
        // The popover dismisses itself on the pointerdown that precedes this
        // click, so a click on the button while it was open arrives here with
        // it already closed: leave it closed rather than reopening.
        if (performance.now() - closedAt.current < 300) return;
        buttonRef.current?.measureInWindow((x, y) => setAnchor({ x, y }));
    }

    const colorClass = anchor ? "text-discord-accent" : idleClass;
    return (
        <>
            <Pressable
                ref={buttonRef}
                onPress={toggle}
                className={`${buttonClass} ${colorClass}`}
                accessibilityRole="button"
                accessibilityLabel={t("soundboard.title")}
                accessibilityState={{ expanded: !!anchor }}
            >
                {/* Zami: the icon takes the button's colour, which it would inherit
                    on the web. */}
                <AudioLines size={size} className={colorClass} />
            </Pressable>
            {anchor && (
                <SoundboardPopover
                    room={room}
                    x={anchor.x}
                    y={anchor.y}
                    touch={touch}
                    onClose={close}
                />
            )}
        </>
    );
}
