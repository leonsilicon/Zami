import { Image, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { useState } from "react";
import { Text, View } from "react-native";
import { mxcToHttp } from "$lib/matrix/client";
import { isAuthedMediaUrl, thumbnailUrl } from "$lib/stores/mediaAuth.svelte";
import {
    isMxcIcon,
    safeTagColor,
    type PowerLevelTag,
} from "$lib/utils/powerLevelTags";

interface Props {
    tag: PowerLevelTag;
    showName?: boolean;
    size?: "sm" | "md";
}

export default function PowerLevelTagBadge({
    tag,
    showName = true,
    size = "sm",
}: Props) {
    const iconPx = size === "md" ? 18 : 14;
    const color = safeTagColor(tag.color);
    const icon = tag.icon;
    const isImage = isMxcIcon(icon);

    // An image icon loads over authenticated media like Avatar does, so it
    // uses the same thumbnail path.
    const iconSrc = ((): string | null => {
        if (!icon || !isImage) return null;
        const src = mxcToHttp(icon.key, iconPx * 2, iconPx * 2, "crop");
        if (!src) return null;
        return isAuthedMediaUrl(src)
            ? thumbnailUrl(src, iconPx * 2, iconPx * 2, "crop")
            : src;
    })();
    // Zami: no createMediaRetry (as in Avatar): `mediaSource` sends the
    // account's token with the request, so a failure is genuine and hides
    // the image, as upstream does once its retry gives up.
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const showImage = !!iconSrc && failedSrc !== iconSrc;

    // Zami: the web badge inherits its font size and colour from the line it
    // sits in; text doesn't inherit here, so the name takes the size of the
    // lines that show it (`text-xs`) and, without a tag colour, their muted
    // colour.
    return (
        <View
            className="flex-row items-center gap-1 min-w-0 shrink"
            accessibilityLabel={showName ? undefined : tag.name}
            accessibilityRole={showName ? undefined : "image"}
        >
            {icon ? (
                isImage ? (
                    showImage ? (
                        <Image
                            source={mediaSource(iconSrc)}
                            accessibilityLabel={tag.name}
                            contentFit="cover"
                            className="flex-shrink-0 rounded-sm"
                            style={{ width: iconPx, height: iconPx }}
                            onError={() => setFailedSrc(iconSrc)}
                        />
                    ) : null
                ) : (
                    <Text
                        className="flex-shrink-0 leading-none select-none"
                        style={{ fontSize: iconPx }}
                        accessibilityElementsHidden={showName}
                        importantForAccessibility={
                            showName ? "no-hide-descendants" : undefined
                        }
                    >
                        {icon.key}
                    </Text>
                )
            ) : null}
            {showName && (
                <Text
                    numberOfLines={1}
                    className={`shrink font-medium text-xs ${color ? "" : "text-zam-textMuted"}`}
                    style={color ? { color } : undefined}
                >
                    {tag.name}
                </Text>
            )}
        </View>
    );
}
