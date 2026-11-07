import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
    Checkbox,
    Image,
    mediaSource,
    pickedFile,
} from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";
import {
    addUserEmoji,
    addUserEmote,
    addUserSticker,
    getUserEmojiPack,
    getUserEmotePack,
    getUserStickerPack,
    mxcToHttp,
    removeUserEmoji,
    removeUserEmoteImage,
    removeUserSticker,
    setUserEmoteUsage,
    uploadContent,
    validateEmojiShortcode,
    type ImageUsage,
} from "$lib/matrix/client";
import { X } from "lucide-svelte";
import { roomsState } from "$lib/stores/rooms.svelte";

type PackKind = "emotes" | "emojis" | "stickers";
interface Props {
    kind: PackKind;
}
interface PackItem {
    shortcode: string;
    mxcUrl: string;
    url: string;
    canEmoji?: boolean;
    canSticker?: boolean;
}

// Zami: `space-y-*` (a child selector) and `grid` don't exist in React Native: the
// same `gap-*` spaces the children, and the add row is a column that becomes a row
// from `sm:`, as the grid's columns do.
export default function CustomPackSettings({ kind }: Props) {
    const [items, setItems] = useState<PackItem[]>([]);
    const [shortcode, setShortcode] = useState("");
    const [uploading, setUploading] = useState(false);
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [asEmoji, setAsEmoji] = useState(true);
    const [asSticker, setAsSticker] = useState(false);

    const singular =
        kind === "emotes"
            ? t("customPackSettings.image")
            : kind === "emojis"
              ? t("common.emoji")
              : t("customPackSettings.sticker");

    function sort(values: PackItem[]): PackItem[] {
        return [...values].sort((a, b) =>
            a.shortcode.localeCompare(b.shortcode),
        );
    }

    function load() {
        setItems(
            sort(
                kind === "emotes"
                    ? getUserEmotePack()
                    : kind === "emojis"
                      ? getUserEmojiPack()
                      : getUserStickerPack(),
            ),
        );
    }

    function usage(emoji: boolean, sticker: boolean): ImageUsage[] {
        return [
            ...(emoji ? (["emoticon"] as ImageUsage[]) : []),
            ...(sticker ? (["sticker"] as ImageUsage[]) : []),
        ];
    }

    async function upload() {
        // Zami: the file input's change event → expo-document-picker.
        const picked = await DocumentPicker.getDocumentAsync({
            type: "image/*",
            copyToCacheDirectory: true,
        });
        const asset = picked.assets?.[0];
        if (!asset) return;
        let nextError = validateEmojiShortcode(shortcode) ?? "";
        const selectedUsage = usage(asEmoji, asSticker);
        if (kind === "emotes" && selectedUsage.length === 0) {
            nextError = t("customPackSettings.chooseAtLeastOneUsage");
        }
        setError(nextError);
        if (nextError) {
            return;
        }
        setUploading(true);
        try {
            const mxcUrl = await uploadContent(await pickedFile(asset));
            const normalized =
                kind === "emotes"
                    ? await addUserEmote(shortcode, mxcUrl, selectedUsage)
                    : kind === "emojis"
                      ? await addUserEmoji(shortcode, mxcUrl)
                      : await addUserSticker(shortcode, mxcUrl);
            const url = mxcToHttp(mxcUrl);
            if (url) {
                setItems((items) =>
                    sort([
                        ...items.filter(
                            (item) => item.shortcode !== normalized,
                        ),
                        {
                            shortcode: normalized,
                            mxcUrl,
                            url,
                            canEmoji: selectedUsage.includes("emoticon"),
                            canSticker: selectedUsage.includes("sticker"),
                        },
                    ]),
                );
            }
            setShortcode("");
            roomsState.roomsTick++;
        } catch (uploadError) {
            setError(
                (uploadError as Error)?.message ??
                    t("customPackSettings.uploadFailed"),
            );
        } finally {
            setUploading(false);
        }
    }

    async function remove(item: PackItem) {
        setPending(`${item.shortcode}:remove`);
        setError("");
        try {
            if (kind === "emotes") await removeUserEmoteImage(item.shortcode);
            else if (kind === "emojis") await removeUserEmoji(item.shortcode);
            else await removeUserSticker(item.shortcode);
            setItems((items) =>
                items.filter(
                    (existing) => existing.shortcode !== item.shortcode,
                ),
            );
            roomsState.roomsTick++;
        } catch (removeError) {
            setError(
                (removeError as Error)?.message ??
                    t("customPackSettings.failedToRemove", { singular }),
            );
        } finally {
            setPending(null);
        }
    }

    async function setUsage(
        item: PackItem,
        changed: ImageUsage,
        enabled: boolean,
    ) {
        const next = usage(
            changed === "emoticon" ? enabled : !!item.canEmoji,
            changed === "sticker" ? enabled : !!item.canSticker,
        );
        if (next.length === 0) {
            setError(t("customPackSettings.chooseAtLeastOneUsage"));
            return;
        }
        setPending(`${item.shortcode}:${changed}`);
        setError("");
        try {
            await setUserEmoteUsage(item.shortcode, next);
            setItems((items) =>
                items.map((existing) =>
                    existing.shortcode === item.shortcode
                        ? {
                              ...existing,
                              canEmoji: next.includes("emoticon"),
                              canSticker: next.includes("sticker"),
                          }
                        : existing,
                ),
            );
            roomsState.roomsTick++;
        } catch (usageError) {
            setError(
                (usageError as Error)?.message ??
                    t("customPackSettings.failedToUpdateUsage"),
            );
        } finally {
            setPending(null);
        }
    }

    useEffect(() => {
        load();
    }, [kind]);

    return (
        <View className="gap-4">
            <View className="gap-2">
                <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                    {t("customPackSettings.add", { singular })}
                </Text>
                <View className="gap-2 sm:flex-row">
                    <View className="flex-row items-center bg-discord-backgroundTertiary rounded border border-transparent focus-within:border-discord-accent/50 sm:flex-1">
                        <Text className="ps-3 text-sm text-discord-textMuted">
                            :
                        </Text>
                        <TextInput
                            nativeID={`user-${kind}-shortcode`}
                            accessibilityLabel={t("customPackSettings.add", {
                                singular,
                            })}
                            value={shortcode}
                            onChangeText={setShortcode}
                            editable={!uploading}
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholder={t("customPackSettings.shortcode")}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            className="min-w-0 flex-1 bg-transparent text-discord-textPrimary text-sm py-2 outline-none"
                        />
                        <Text className="pe-3 text-sm text-discord-textMuted">
                            :
                        </Text>
                    </View>
                    {kind === "emotes" && (
                        <View className="flex-row items-center gap-3 px-3 py-2 rounded bg-discord-backgroundTertiary">
                            <Checkbox
                                checked={asEmoji}
                                onChange={setAsEmoji}
                                disabled={uploading}
                                label={t("common.emoji")}
                                labelClassName="text-xs text-discord-textPrimary"
                                className="items-center gap-1.5"
                            />
                            <Checkbox
                                checked={asSticker}
                                onChange={setAsSticker}
                                disabled={uploading}
                                label={t("customPackSettings.sticker")}
                                labelClassName="text-xs text-discord-textPrimary"
                                className="items-center gap-1.5"
                            />
                        </View>
                    )}
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                            upload();
                        }}
                        disabled={uploading}
                        className={`cursor-pointer px-3 py-2 rounded bg-discord-accent ${
                            uploading ? "opacity-50 pointer-events-none" : ""
                        }`}
                    >
                        <Text className="text-white text-sm font-semibold text-center">
                            {uploading
                                ? t("common.uploading")
                                : t("common.uploadImage")}
                        </Text>
                    </Pressable>
                </View>
            </View>

            {error ? (
                <Text className="text-sm text-discord-danger">{error}</Text>
            ) : null}
            <View className="gap-1.5">
                {items.map((item) => (
                    <View
                        key={item.shortcode}
                        className="flex-row items-center gap-3 p-2 rounded bg-discord-backgroundTertiary"
                    >
                        <View className="w-12 h-12 rounded bg-discord-backgroundSecondary flex-shrink-0 overflow-hidden flex-row items-center justify-center">
                            <Image
                                source={mediaSource(item.url)}
                                contentFit="contain"
                                accessibilityIgnoresInvertColors
                                className="w-full h-full max-w-full max-h-full"
                            />
                        </View>
                        <View className="flex-1 min-w-0">
                            <Text
                                numberOfLines={1}
                                className="text-sm font-medium text-discord-textPrimary truncate"
                            >
                                :{item.shortcode}:
                            </Text>
                            <Text
                                numberOfLines={1}
                                className="text-xs text-discord-textMuted truncate"
                            >
                                {item.mxcUrl}
                            </Text>
                        </View>
                        {kind === "emotes" && (
                            <>
                                <Checkbox
                                    checked={!!item.canEmoji}
                                    onChange={(checked) =>
                                        setUsage(item, "emoticon", checked)
                                    }
                                    disabled={
                                        pending === `${item.shortcode}:emoticon`
                                    }
                                    label={t("common.emoji")}
                                    labelClassName="text-xs text-discord-textPrimary"
                                    className="items-center gap-1.5"
                                />
                                <Checkbox
                                    checked={!!item.canSticker}
                                    onChange={(checked) =>
                                        setUsage(item, "sticker", checked)
                                    }
                                    disabled={
                                        pending === `${item.shortcode}:sticker`
                                    }
                                    label={t("customPackSettings.sticker")}
                                    labelClassName="text-xs text-discord-textPrimary"
                                    className="items-center gap-1.5"
                                />
                            </>
                        )}
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("customPackSettings.remove", {
                                toLowerCase: singular.toLowerCase(),
                            })}
                            onPress={() => remove(item)}
                            disabled={pending === `${item.shortcode}:remove`}
                            className="p-1 rounded hover:bg-discord-messageHover disabled:opacity-50"
                        >
                            <X size={14} className="text-discord-textMuted" />
                        </Pressable>
                    </View>
                ))}
                {items.length === 0 && (
                    <Text className="text-sm text-discord-textMuted text-center py-4">
                        {kind === "emotes"
                            ? t("customPackSettings.noCustomImages")
                            : kind === "emojis"
                              ? t("customPackSettings.noCustomEmojis")
                              : t("customPackSettings.noCustomStickers")}
                    </Text>
                )}
            </View>
        </View>
    );
}
