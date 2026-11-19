import { Image, Video, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { useEffect, useState } from "react";
import type { ImageStyle, ViewStyle } from "react-native";
import {
    eventFavouriteKey,
    resolveEventFavouriteUrl,
    type EventFavouriteSource,
} from "$lib/matrix/favouriteFile";

interface Props {
    source: EventFavouriteSource;
    class?: string;
    style?: string;
    /** The favourite is a video: shown as a muted looping clip. */
    video?: boolean;
}

// Zami: `style` is a CSS declaration string, as upstream's callers pass it
// (`aspect-ratio: 4 / 3`); this turns it into a React Native style. Numbers and
// `px` lengths become numbers, `a / b` ratios their quotient.
function cssStyle(style: string | undefined): ImageStyle | undefined {
    if (!style) return undefined;
    const out: Record<string, string | number> = {};
    for (const declaration of style.split(";")) {
        const colon = declaration.indexOf(":");
        if (colon < 0) continue;
        const property = declaration
            .slice(0, colon)
            .trim()
            .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        const value = declaration.slice(colon + 1).trim();
        if (!property || !value) continue;
        const ratio = /^([\d.]+)\s*\/\s*([\d.]+)$/.exec(value);
        const length = /^(-?[\d.]+)(px)?$/.exec(value);
        if (ratio && Number(ratio[2]) > 0)
            out[property] = Number(ratio[1]) / Number(ratio[2]);
        else if (length) out[property] = Number(length[1]);
        else out[property] = value;
    }
    return out as ImageStyle;
}

export default function FavouriteFileImg({
    source,
    class: className = "",
    style,
    video = false,
}: Props) {
    // The url resolved for the source it was resolved for, so a new source
    // shows nothing until its own url lands.
    const [resolved, setResolved] = useState<{
        key: string;
        url: string | null;
    } | null>(null);
    const key = eventFavouriteKey(source);
    const src = resolved?.key === key ? resolved.url : null;

    // Keyed by the pointer's ids, not the object: callers build a new one on
    // every render.
    const { roomId, eventId } = source;
    useEffect(() => {
        const s = { roomId, eventId };
        let live = true;
        void resolveEventFavouriteUrl(s).then((u) => {
            if (live) setResolved({ key: eventFavouriteKey(s), url: u });
        });
        return () => {
            live = false;
        };
    }, [roomId, eventId]);

    // Zami: `playsinline` and `disablepictureinpicture` are the player's
    // defaults here. `aria-hidden`: the Video takes no touches without
    // controls, and is decorative.
    if (video)
        return (
            <Video
                src={src ?? undefined}
                className={className}
                style={cssStyle(style) as ViewStyle | undefined}
                autoplay
                muted
                loop
            />
        );
    // `alt=""`: decorative, so hidden from screen readers.
    return (
        <Image
            source={mediaSource(src)}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no"
            className={className}
            style={cssStyle(style)}
        />
    );
}
