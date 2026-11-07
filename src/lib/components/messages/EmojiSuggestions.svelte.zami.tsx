// The `:shortcode` suggestion list, shared by the composer and the inline
// message editor. Keyboard navigation lives with the owning input.
import { Pressable, Text, View } from "react-native";
import { Image, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";
import { USER_EMOJI_SOURCE } from "$lib/matrix/client";
import type { EmojiCandidate } from "$lib/utils/emojiAutocomplete";

export default function EmojiSuggestions({
    candidates,
    selectedIdx = 0,
    onSelectedIdxChange,
    onPick,
    class: className = "",
}: {
    candidates: EmojiCandidate[];
    selectedIdx?: number;
    /** Zami: the write half of `bind:selectedIdx`. */
    onSelectedIdxChange?: (selectedIdx: number) => void;
    onPick: (candidate: EmojiCandidate) => void;
    class?: string;
}) {
    return (
        <View
            className={`bg-discord-backgroundSecondary border border-discord-divider rounded-lg overflow-hidden shadow-lg ${className}`}
        >
            {candidates.map((candidate, i) => (
                <Pressable
                    // Upstream's `{#each}` is unkeyed: by index.
                    key={i}
                    accessibilityRole="button"
                    // Zami: `onpointerdown` → `onPressIn`, committing before the
                    // press ends as upstream does. Not ported: suppressNextClick(),
                    // since React Native retargets no trailing click.
                    onPressIn={() => onPick(candidate)}
                    onHoverIn={() => onSelectedIdxChange?.(i)}
                    className={`w-full flex-row items-center gap-2.5 px-3 py-1.5 transition-colors ${
                        i === selectedIdx ? "bg-discord-messageHover" : ""
                    }`}
                >
                    {candidate.kind === "unicode" ? (
                        <>
                            <Text className="text-xl w-6 text-center flex-shrink-0">
                                {candidate.emoji}
                            </Text>
                            <Text
                                numberOfLines={1}
                                className="flex-shrink text-sm text-discord-textPrimary truncate"
                            >
                                :{candidate.name}:
                            </Text>
                            <Text className="text-xs text-discord-textMuted">
                                {candidate.emoji}
                            </Text>
                        </>
                    ) : (
                        <>
                            <Image
                                source={mediaSource(candidate.url)}
                                accessibilityLabel={candidate.shortcode}
                                contentFit="contain"
                                className="w-6 h-6 flex-shrink-0"
                            />
                            <Text
                                numberOfLines={1}
                                className="flex-shrink text-sm text-discord-textPrimary truncate"
                            >
                                :{candidate.shortcode}:
                            </Text>
                            <Text
                                numberOfLines={1}
                                className="ms-auto ps-2 text-xs text-discord-textMuted truncate max-w-[50%]"
                            >
                                {candidate.source === USER_EMOJI_SOURCE
                                    ? t("messageInput.yourEmotes")
                                    : (candidate.source ??
                                      t("messageInput.custom"))}
                            </Text>
                        </>
                    )}
                </Pressable>
            ))}
        </View>
    );
}
