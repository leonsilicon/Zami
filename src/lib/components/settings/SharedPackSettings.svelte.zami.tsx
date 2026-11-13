import { memo, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Image, mediaSource, pickedFile } from "@-/com.leonsilicon.zami.rn";
import {
    useProgressiveCount,
    useStableCallback,
} from "@-/com.leonsilicon.zami.incremental/react";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import {
    getJoinedRoomPacks,
    getStaleEmoteSubscriptions,
    getUserPackInfo,
    imagePackRevision,
    setPackGlobal,
    updateUserPackMeta,
    uploadContent,
    type CustomImagePack,
} from "$lib/matrix/client";
import { roomsState } from "$lib/stores/rooms.svelte";
import { packKey } from "$lib/utils/imagePacks";

// Zami: `space-y-*` (a child selector) and `grid` don't exist in React Native: the
// same `gap-*` spaces the children, and the two pack detail inputs sit side by side
// from `sm:`, as the grid's columns do.
export default function SharedPackSettings() {
    // MSC2545 sharing: packs from rooms you are in can be enabled for every
    // room (im.ponies.emote_rooms); your own pack can carry a name, avatar and
    // attribution so people who copy from it can credit you.
    // Zami: rebuilt (a scan of every joined room) only when a pack, a room or
    // the account's pack settings changed, not on every sync's roomsTick.
    const packRevision = useRune(() => imagePackRevision());
    const view = useMemo(() => {
        void packRevision;
        const packs = getJoinedRoomPacks();
        return {
            enabled: packs.filter((p) => p.global),
            available: packs.filter((p) => !p.global),
            stale: getStaleEmoteSubscriptions(),
            mine: getUserPackInfo(),
        };
    }, [packRevision]);

    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [nameDraft, setNameDraft] = useState<string | null>(null);
    const [attributionDraft, setAttributionDraft] = useState<string | null>(
        null,
    );
    const [avatarUploading, setAvatarUploading] = useState(false);

    // Zami: each pack's name and room lowercased once per rebuild, not per
    // keystroke.
    const searchable = useMemo(
        () =>
            view.available.map((pack) => ({
                pack,
                name: pack.name.toLowerCase(),
                room: (pack.sourceName ?? "").toLowerCase(),
            })),
        [view],
    );
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return searchable
            .filter((e) => !q || e.name.includes(q) || e.room.includes(q))
            .map((e) => e.pack);
    }, [searchable, query]);
    // Zami: the rows' action, the same function across renders; and the
    // available packs mounted a slice per turn of the event loop (this sits in
    // the settings panel's scroll view, so it can't be virtualized).
    const onToggle = useStableCallback(toggle);
    const shownCount = useProgressiveCount(filtered.length, 30, filtered);

    async function toggle(roomId: string, stateKey: string, enabled: boolean) {
        setBusy(`${roomId}:${stateKey}`);
        setError("");
        try {
            await setPackGlobal(roomId, stateKey, enabled);
            roomsState.roomsTick++;
        } catch (err) {
            setError(
                (err as Error)?.message ?? t("sharedPackSettings.failedToSave"),
            );
        } finally {
            setBusy(null);
        }
    }

    async function saveMine(update: Parameters<typeof updateUserPackMeta>[0]) {
        setBusy("mine");
        setError("");
        try {
            await updateUserPackMeta(update);
            setNameDraft(null);
            setAttributionDraft(null);
            roomsState.roomsTick++;
        } catch (err) {
            setError(
                (err as Error)?.message ?? t("sharedPackSettings.failedToSave"),
            );
        } finally {
            setBusy(null);
        }
    }

    async function pickAvatar() {
        // Zami: the file input's change event → expo-document-picker.
        const picked = await DocumentPicker.getDocumentAsync({
            type: "image/*",
            copyToCacheDirectory: true,
        });
        const asset = picked.assets?.[0];
        if (!asset) return;
        setAvatarUploading(true);
        try {
            await saveMine({
                avatarMxc: await uploadContent(await pickedFile(asset)),
            });
        } catch (err) {
            setError(
                (err as Error)?.message ?? t("sharedPackSettings.failedToSave"),
            );
        } finally {
            setAvatarUploading(false);
        }
    }

    function packRow(pack: CustomImagePack, enabled: boolean) {
        // Zami: memoized (PackRow, below).
        return (
            <PackRow
                key={pack.id}
                pack={pack}
                enabled={enabled}
                busy={busy === `${pack.roomId}:${packKey(pack)}`}
                onToggle={onToggle}
            />
        );
    }

    return (
        <View className="gap-6 mt-6">
            <View className="gap-2">
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                    {t("sharedPackSettings.yourPackDetails")}
                </Text>
                <View className="gap-2 sm:flex-row">
                    <TextInput
                        value={nameDraft ?? view.mine.name}
                        onChangeText={setNameDraft}
                        placeholder={t("imagePackEditor.packName")}
                        placeholderTextColorClassName="accent-discord-textMuted"
                        accessibilityLabel={t("imagePackEditor.packName")}
                        className="min-w-0 bg-discord-backgroundTertiary text-discord-textPrimary placeholder-discord-textMuted text-sm rounded px-3 py-2 outline-none border border-transparent focus:border-discord-accent/50 sm:flex-1"
                    />
                    <TextInput
                        value={attributionDraft ?? view.mine.attribution ?? ""}
                        onChangeText={setAttributionDraft}
                        placeholder={t(
                            "imagePackEditor.attributionPlaceholder",
                        )}
                        placeholderTextColorClassName="accent-discord-textMuted"
                        accessibilityLabel={t(
                            "imagePackEditor.attributionPlaceholder",
                        )}
                        className="min-w-0 bg-discord-backgroundTertiary text-discord-textPrimary placeholder-discord-textMuted text-sm rounded px-3 py-2 outline-none border border-transparent focus:border-discord-accent/50 sm:flex-1"
                    />
                </View>
                <View className="flex-row items-center gap-2">
                    {view.mine.avatarUrl ? (
                        <Image
                            source={mediaSource(view.mine.avatarUrl)}
                            contentFit="cover"
                            accessibilityIgnoresInvertColors
                            className="w-8 h-8 rounded object-cover"
                        />
                    ) : null}
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                            pickAvatar();
                        }}
                        disabled={avatarUploading}
                        className={`cursor-pointer px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover ${
                            avatarUploading
                                ? "opacity-50 pointer-events-none"
                                : ""
                        }`}
                    >
                        <Text className="text-xs text-discord-textPrimary">
                            {t("imagePackEditor.uploadPackAvatar")}
                        </Text>
                    </Pressable>
                    {view.mine.avatarUrl ? (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => saveMine({ avatarMxc: null })}
                        >
                            <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                {t("imagePackEditor.removePackAvatar")}
                            </Text>
                        </Pressable>
                    ) : null}
                    <View className="flex-1" />
                    <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                            saveMine({
                                displayName: nameDraft ?? view.mine.name,
                                attribution:
                                    attributionDraft ??
                                    view.mine.attribution ??
                                    "",
                            })
                        }
                        disabled={
                            busy === "mine" ||
                            (nameDraft === null && attributionDraft === null)
                        }
                        className="px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover disabled:opacity-50"
                    >
                        <Text className="text-white text-xs font-semibold">
                            {t("common.save")}
                        </Text>
                    </Pressable>
                </View>
            </View>

            {error ? (
                <Text className="text-sm text-discord-danger">{error}</Text>
            ) : null}

            <View className="gap-2">
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                    {t("sharedPackSettings.enabledEverywhere")}
                </Text>
                <Text className="text-xs text-discord-textMuted">
                    {t("sharedPackSettings.enabledEverywhereHint")}
                </Text>
                {view.enabled.map((pack) => packRow(pack, true))}
                {view.stale.map((ref) => (
                    <View
                        key={ref.roomId + ref.stateKey}
                        className="flex-row items-center gap-3 p-2 rounded bg-discord-backgroundTertiary"
                    >
                        <View className="flex-1 min-w-0">
                            <Text
                                numberOfLines={1}
                                className="text-sm text-discord-textPrimary truncate"
                            >
                                {ref.stateKey || ref.roomId}
                            </Text>
                            <Text
                                numberOfLines={1}
                                className="text-xs text-discord-textMuted truncate"
                            >
                                {t("sharedPackSettings.unavailable", {
                                    room: ref.roomId,
                                })}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                                toggle(ref.roomId, ref.stateKey, false)
                            }
                            disabled={busy === `${ref.roomId}:${ref.stateKey}`}
                            className="px-3 py-1.5 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover disabled:opacity-50"
                        >
                            <Text className="text-xs font-semibold text-discord-textPrimary">
                                {t("sharedPackSettings.remove")}
                            </Text>
                        </Pressable>
                    </View>
                ))}
                {view.enabled.length === 0 && view.stale.length === 0 && (
                    <Text className="text-sm text-discord-textMuted text-center py-2">
                        {t("sharedPackSettings.noneEnabled")}
                    </Text>
                )}
            </View>

            <View className="gap-2">
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                    {t("sharedPackSettings.availableInYourRooms")}
                </Text>
                <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder={t("sharedPackSettings.searchPacks")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityLabel={t("sharedPackSettings.searchPacks")}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="w-full bg-discord-backgroundTertiary text-discord-textPrimary placeholder-discord-textMuted text-sm rounded px-3 py-2 outline-none border border-transparent focus:border-discord-accent/50"
                />
                {filtered
                    .slice(0, shownCount)
                    .map((pack) => packRow(pack, false))}
                {filtered.length === 0 && (
                    <Text className="text-sm text-discord-textMuted text-center py-2">
                        {t("sharedPackSettings.noPacksFound")}
                    </Text>
                )}
            </View>
        </View>
    );
}

// Zami: a pack of the lists above, memoized on what it shows.
const PackRow = memo(function PackRow({
    pack,
    enabled,
    busy,
    onToggle,
}: {
    pack: CustomImagePack;
    enabled: boolean;
    busy: boolean;
    onToggle: (roomId: string, stateKey: string, enabled: boolean) => void;
}) {
    return (
        <View className="flex-row items-center gap-3 p-2 rounded bg-discord-backgroundTertiary">
            {pack.avatarUrl ? (
                <Image
                    source={mediaSource(pack.avatarUrl)}
                    contentFit="cover"
                    accessibilityIgnoresInvertColors
                    className="w-8 h-8 rounded object-cover flex-shrink-0"
                />
            ) : null}
            <View className="flex-1 min-w-0">
                <Text
                    numberOfLines={1}
                    className="text-sm text-discord-textPrimary truncate"
                >
                    {pack.name}
                </Text>
                <Text
                    numberOfLines={1}
                    className="text-xs text-discord-textMuted truncate"
                >
                    {t("sharedPackSettings.packSummary", {
                        room: pack.sourceName ?? "",
                        count: pack.images.length,
                    })}
                </Text>
                {pack.attribution ? (
                    <Text
                        numberOfLines={1}
                        className="text-xs text-discord-textMuted truncate"
                    >
                        {t("imagePackEditor.attribution", {
                            value: pack.attribution,
                        })}
                    </Text>
                ) : null}
            </View>
            <Pressable
                accessibilityRole="button"
                onPress={() =>
                    onToggle(pack.roomId ?? "", packKey(pack), !enabled)
                }
                disabled={busy}
                className={`px-3 py-1.5 rounded disabled:opacity-50 ${
                    enabled
                        ? "bg-discord-backgroundSecondary hover:bg-discord-messageHover"
                        : "bg-discord-accent hover:bg-discord-accentHover"
                }`}
            >
                <Text
                    className={`text-xs font-semibold ${
                        enabled ? "text-discord-textPrimary" : "text-white"
                    }`}
                >
                    {enabled
                        ? t("sharedPackSettings.disable")
                        : t("sharedPackSettings.enable")}
                </Text>
            </Pressable>
        </View>
    );
});
