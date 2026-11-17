import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useState } from "react";
import { I18nManager, Text, View, useWindowDimensions } from "react-native";
import { t } from "$lib/i18n";
import { Volume2 } from "lucide-svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import {
    countVoiceParticipants,
    VOICE_CARD_PREVIEW_COUNT,
    type SpaceVoiceSummary,
} from "$lib/utils/spaceVoice";

interface Props {
    /** The icon the card is pointing at. Zami: its on-screen box, from
     *  `anchorElement` (only `getBoundingClientRect()` is read). */
    anchor: HTMLElement;
    name: string;
    /** Read inside a $derived so the card follows live call changes. */
    getVoice: () => SpaceVoiceSummary;
}

// Zami: the summary is a new object on every read; it renders the same when
// its contents are.
const sameSummary = (a: SpaceVoiceSummary, b: SpaceVoiceSummary) =>
    JSON.stringify(a) === JSON.stringify(b);

export default function SpaceHoverCard({ anchor, name, getVoice }: Props) {
    const voice = useRune(getVoice, [getVoice], { isEqual: sameSummary });
    const count = countVoiceParticipants(voice);
    const viewport = useWindowDimensions();

    // Position beside the icon, vertically centred on it and clamped to the
    // viewport. In RTL the rail sits on the right, so the card opens leftward.
    // The notch is nudged to keep pointing at the icon when the card clamps.
    // Re-placed whenever the contents change (someone joins or leaves while
    // the card is open, or it is reused for another icon), since the card's
    // height moves its centre.
    // Zami: the card's height comes from its layout (`onLayout`) rather than
    // `offsetHeight`; it stays invisible until it has one. `start` is the
    // physical left in LTR and the right in RTL, as upstream sets each.
    const [h, setH] = useState<number | null>(null);
    const r = anchor.getBoundingClientRect();
    const rtl = I18nManager.isRTL;
    const centreY = r.top + r.height / 2;
    const top = Math.max(
        8,
        Math.min(centreY - (h ?? 0) / 2, viewport.height - (h ?? 0) - 8),
    );
    const start = rtl ? viewport.width - r.left + 12 : r.right + 12;

    return (
        <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onLayout={(e) => setH(e.nativeEvent.layout.height)}
            style={{
                top,
                start,
                maxHeight: viewport.height - 16,
                opacity: h === null ? 0 : 1,
            }}
            className="absolute z-[60] pointer-events-none min-w-44 max-w-64 bg-[#18191c] rounded-md shadow-2xl px-3 py-2"
        >
            {/* Zami: `overflow-hidden` would clip the notch, which sits outside
                the card's edge; the card has no other overflow to hide. */}
            <View
                className="absolute w-2.5 h-2.5 rotate-45 bg-[#18191c]"
                style={{ top: centreY - top - 6, start: -4 }}
            />

            <Text
                numberOfLines={1}
                className="text-sm font-semibold text-white"
            >
                {name}
            </Text>

            {voice.active ? (
                <>
                    <Text className="text-xs text-zam-textMuted mt-0.5">
                        {t("spaceSidebar.inVoiceCount", { count })}
                    </Text>

                    {voice.rooms.map((room) => {
                        const shown = room.participants.slice(
                            0,
                            VOICE_CARD_PREVIEW_COUNT,
                        );
                        const extra = room.participants.length - shown.length;
                        return (
                            <View key={room.roomId} className="mt-2">
                                <View className="flex-row items-center gap-1.5 min-w-0">
                                    <Volume2
                                        size={12}
                                        className="flex-shrink-0 text-zam-textMuted"
                                    />
                                    <Text
                                        numberOfLines={1}
                                        className="flex-shrink text-xs font-medium text-white"
                                    >
                                        {room.name}
                                    </Text>
                                </View>
                                <View className="mt-1 flex flex-col gap-1 ps-4">
                                    {shown.map((p) => (
                                        <View
                                            key={p.userId}
                                            className="flex-row items-center gap-1.5 min-w-0"
                                        >
                                            <Avatar
                                                src={p.avatar}
                                                name={p.name}
                                                id={p.userId}
                                                size={20}
                                            />
                                            <Text
                                                numberOfLines={1}
                                                className="flex-shrink text-xs text-zam-textSecondary min-w-0"
                                            >
                                                {p.name}
                                            </Text>
                                            {p.live ? (
                                                <View className="ms-auto flex-shrink-0 h-3.5 px-1 rounded-sm bg-zam-danger justify-center">
                                                    <Text className="text-white text-[9px] font-bold leading-[14px] tracking-wide">
                                                        {t(
                                                            "spaceSidebar.liveBadge",
                                                        )}
                                                    </Text>
                                                </View>
                                            ) : null}
                                        </View>
                                    ))}
                                    {extra > 0 ? (
                                        <Text className="text-xs text-zam-textMuted ps-7">
                                            {t(
                                                "spaceSidebar.moreParticipants",
                                                {
                                                    count: extra,
                                                },
                                            )}
                                        </Text>
                                    ) : null}
                                </View>
                            </View>
                        );
                    })}
                </>
            ) : null}
        </View>
    );
}
