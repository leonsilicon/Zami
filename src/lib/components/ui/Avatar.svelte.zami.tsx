import { Image, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { useState } from "react";
import { PixelRatio, Text, View } from "react-native";
import { getAvatarColor, getAvatarInitials } from "$lib/utils/colors";
import { isAuthedMediaUrl, thumbnailUrl } from "$lib/stores/mediaAuth.svelte";

interface Props {
    src?: string | null;
    name?: string;
    id?: string | null;
    size?: number;
    rounded?: "full" | "lg" | "md" | "xl" | "2xl" | "none";
    class?: string;
}

export default function Avatar({
    src = null,
    name = "?",
    id = null,
    size = 40,
    rounded = "full",
    class: extraClass = "",
}: Props) {
    const resolvedSrc = src ?? null;
    const initials = getAvatarInitials(name);
    const bgColor = getAvatarColor(id ?? name);

    const roundedClass = () => {
        if (rounded === "none") return "";
        if (rounded === "full") return "rounded-full";
        if (rounded === "2xl") return "rounded-2xl";
        if (rounded === "xl") return "rounded-xl";
        if (rounded === "lg") return "rounded-lg";
        return "rounded-md";
    };

    // Avatars load over authenticated media (/_matrix/client/v1/media), whose
    // token `mediaSource` sends with the request.
    // Zami: no createMediaRetry: it heals an <img> the service worker didn't
    // authenticate, by re-fetching it into a blob URL. Here the image request
    // carries the token, so a failure is genuine and falls back to initials.
    // The clean initials show while the image loads, instead of an empty box.
    // Avatars are asked of the homeserver at the size this box needs at this
    // screen's density, in power-of-two steps so sizes share copies, with
    // `animated=true` so animated ones keep animating where the server can
    // (MSC2705). If the server can't thumbnail it, the original is used.
    const boxPx = Math.max(
        32,
        2 ** Math.ceil(Math.log2(size * (PixelRatio.get() || 1))),
    );
    const thumbSrc =
        resolvedSrc && isAuthedMediaUrl(resolvedSrc)
            ? thumbnailUrl(resolvedSrc, boxPx, boxPx, "crop")
            : resolvedSrc;
    // The src whose thumbnail failed, so it is shown in the original; reset
    // when the src changes.
    const [originalFor, setOriginalFor] = useState<string | null>(null);
    const useOriginal = originalFor !== null && originalFor === resolvedSrc;
    const imgSrc = useOriginal ? resolvedSrc : thumbSrc;
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
    const failed = !!imgSrc && failedSrc === imgSrc;
    const showImage = !!imgSrc && !failed;
    const loaded = showImage && loadedSrc === imgSrc;

    function onError() {
        if (!useOriginal && thumbSrc !== resolvedSrc)
            setOriginalFor(resolvedSrc);
        else setFailedSrc(imgSrc);
    }

    return (
        <View
            className={`flex-shrink-0 flex-row items-center justify-center overflow-hidden ${roundedClass()} ${extraClass}`}
            style={{
                width: size,
                height: size,
                backgroundColor: loaded ? "transparent" : bgColor,
            }}
        >
            {!loaded && (
                <Text
                    className="text-white font-semibold select-none"
                    style={{ fontSize: size * 0.4 }}
                >
                    {initials}
                </Text>
            )}
            {showImage && (
                <Image
                    source={mediaSource(imgSrc)}
                    accessibilityLabel={name}
                    contentFit="cover"
                    className={`absolute inset-0 w-full h-full ${roundedClass()}`}
                    onLoad={() => setLoadedSrc(imgSrc)}
                    onError={onError}
                />
            )}
        </View>
    );
}
