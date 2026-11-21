import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Eye } from "lucide-svelte";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
import Avatar from "$lib/components/ui/Avatar.svelte";
import { watcherSlots } from "$lib/utils/shareWatchers";
import { voiceCallState } from "$lib/stores/voiceCall.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { getMemberAvatar, getMemberName, getRoom } from "$lib/matrix/client";

interface Props {
    /** User ids of whoever is watching the share, sorted. */
    viewers: string[];
    /** Avatars drawn before collapsing the rest into "+N". */
    max?: number;
    /** Avatar diameter in px. */
    size?: number;
}

export default function WatcherStack({ viewers, max = 3, size = 16 }: Props) {
    const slots = watcherSlots(viewers, max);
    const roomsTick = useRune(() => roomsState.roomsTick);
    const callRoomId = useRune(() => voiceCallState.roomId);
    void roomsTick;
    const room = callRoomId ? getRoom(callRoomId) : null;
    function nameOf(userId: string): string {
        return room ? getMemberName(room, userId) : userId;
    }
    function avatarOf(userId: string): string | null {
        return room ? getMemberAvatar(room, userId) : null;
    }

    // The full list lives in the tooltip: a stack this small can't show it,
    // and a hover card would be clipped by the tile it sits on.
    // Zami: no tooltips (`title`); a press on the stack toggles the list
    // under it instead.
    const fullList =
        viewers.length === 0
            ? t("videoTile.noWatchers")
            : [t("videoTile.watchers"), ...viewers.map(nameOf)].join("\n");
    const countLabel = t("videoTile.watchingCount", { count: viewers.length });
    const [listOpen, setListOpen] = useState(false);

    // min-w-0 and the flex row let a parent that is narrower than the stack
    // clip it instead of pushing its neighbours off.
    return (
        <View className="items-end min-w-0 max-w-full">
            <Pressable
                accessibilityRole="image"
                accessibilityLabel={countLabel}
                testID="watcher-stack"
                onPress={() => setListOpen((open) => !open)}
                className="flex-row items-center gap-1 min-w-0 max-w-full px-1 py-0.5 rounded bg-black/60"
            >
                {viewers.length === 0 ? (
                    <>
                        <Eye size={12} className="text-white" />
                        <Text className="tabular-nums text-white text-xs">
                            0
                        </Text>
                    </>
                ) : (
                    <>
                        <Eye size={12} className="shrink-0 text-white" />
                        {/* Zami: `-space-x-1.5` → a negative start margin on
                            every avatar after the first. */}
                        <View className="flex-row items-center shrink-0">
                            {slots.shown.map((userId, i) => (
                                <View
                                    key={userId}
                                    className={`rounded-full border border-black/60 ${i > 0 ? "-ms-1.5" : ""}`}
                                >
                                    <Avatar
                                        src={avatarOf(userId)}
                                        name={nameOf(userId)}
                                        id={userId}
                                        size={size}
                                    />
                                </View>
                            ))}
                        </View>
                        {slots.extra > 0 && (
                            <Text className="tabular-nums shrink-0 text-white text-xs">
                                +{slots.extra}
                            </Text>
                        )}
                    </>
                )}
            </Pressable>
            {listOpen && (
                <View className="mt-1 min-w-[10rem] max-w-[14rem] rounded bg-black/85 p-2 shadow-lg">
                    <Text className="text-xs text-white">{fullList}</Text>
                </View>
            )}
        </View>
    );
}
