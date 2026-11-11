import {
    Checkbox,
    confirmAlert,
    Image,
    mediaSource,
    pickedFile,
    Select,
} from "@-/com.leonsilicon.zami.rn";
import * as ImagePicker from "expo-image-picker";
import { X } from "lucide-svelte";
import type { Room } from "matrix-js-sdk";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import {
    FlatList,
    Pressable,
    Text,
    TextInput,
    View,
    type ListRenderItemInfo,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { createKeyedMemo } from "@-/com.leonsilicon.zami.incremental";
import { useStableCallback } from "@-/com.leonsilicon.zami.incremental/react";
import { t } from "$lib/i18n";
import {
    getAvailableRoomEmotePacks,
    addRoomEmote,
    setRoomEmoteUsage,
    removeRoomEmoteImage,
    setPackGlobal,
    updateRoomPackMeta,
    deleteRoomPack,
    importImagesToUserPack,
    validateEmojiShortcode,
    uploadContent,
    mxcToHttp,
    getRoomStateAvatar,
    imagePackRevision,
    type CustomImagePack,
    type CustomPackImage,
    type ImageUsage,
} from "$lib/matrix/client";
import { roomsState } from "$lib/stores/rooms.svelte";
import { readImageInfo } from "$lib/utils/emotePacks";
import { packKey, usageFromFlags, sortEmotePacks } from "$lib/utils/imagePacks";

interface Props {
    room: Room;
    /** May create packs here (power level for m.room.image_pack or
     *  im.ponies.room_emotes). Existing packs carry their own `editable`,
     *  from the levels of the events an edit to them writes. */
    canEdit: boolean;
    onUpdate?: () => void;
    /** Zami: shown above the add form, in the list's scroll (the trust banner). */
    header?: ReactNode;
    /** Zami: shown below the packs (the soundboard). */
    footer?: ReactNode;
}

// Zami: each room's packs, read again only when pack state changes (a reopened
// Emotes tab, or a re-read after an edit that hasn't echoed back yet).
const roomPacksMemo = createKeyedMemo<CustomImagePack[]>();

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. Text classes sit on each Text, and `title` tooltips
// are dropped.
export default function ImagePackEditor({
    room,
    canEdit,
    onUpdate,
    header,
    footer,
}: Props) {
    const [emotePacks, setEmotePacks] = useState<CustomImagePack[]>([]);
    const [selectedEmotePackKey, setSelectedEmotePackKey] = useState("");
    const [newEmotePackName, setNewEmotePackName] = useState("");
    const [emoteShortcode, setEmoteShortcode] = useState("");
    const [emoteUploading, setEmoteUploading] = useState(false);
    const [emoteActionPending, setEmoteActionPending] = useState<string | null>(
        null,
    );
    const [emoteError, setEmoteError] = useState("");
    const [newEmoteAsEmoji, setNewEmoteAsEmoji] = useState(true);
    const [newEmoteAsSticker, setNewEmoteAsSticker] = useState(false);
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [editAttribution, setEditAttribution] = useState("");
    const [editAvatarMxc, setEditAvatarMxc] = useState<
        string | null | undefined
    >(undefined);
    const [packBusy, setPackBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState("");

    const currentAvatarUrl = getRoomStateAvatar(room);

    // Zami: these take the packs to read (the current state by default), since a
    // state update isn't visible until the next render.
    function currentEmotePacks(packs = emotePacks): CustomImagePack[] {
        return packs.filter((pack) => !pack.inherited);
    }

    function canEditPack(pack: CustomImagePack): boolean {
        return !pack.inherited && !!pack.editable;
    }

    // Packs the add form can target: this room's, where we may write.
    function editableEmotePacks(packs = emotePacks): CustomImagePack[] {
        return currentEmotePacks(packs).filter(canEditPack);
    }

    const canAdd = canEdit || emotePacks.some(canEditPack);

    function loadEmotes() {
        const packs = roomPacksMemo([room, imagePackRevision()], () =>
            sortEmotePacks(getAvailableRoomEmotePacks(room)),
        );
        setEmotePacks(packs);
        const editablePacks = editableEmotePacks(packs);
        setSelectedEmotePackKey((selected) =>
            selected !== "__new" &&
            !editablePacks.some((pack) => packKey(pack) === selected)
                ? editablePacks[0]
                    ? packKey(editablePacks[0])
                    : "__new"
                : selected,
        );
    }

    // Mount == tab-activation (component lives inside {:else if activeTab === "emotes"}).
    // Only `room` re-runs the load: what loadEmotes reads and writes must not make
    // this effect self-retrigger (mirrors the original untrack-wrapped effect in
    // RoomSettings).
    useEffect(() => {
        loadEmotes();
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream untracks the load.
    }, [room]);

    // "New pack" is only offered with canEdit, which settles once the room's
    // power levels have loaded: move off it to a pack we can still add to.
    useEffect(() => {
        if (canEdit || selectedEmotePackKey !== "__new") return;
        const first = editableEmotePacks()[0];
        if (first) setSelectedEmotePackKey(packKey(first));
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream untracks the packs.
    }, [canEdit, selectedEmotePackKey]);

    function selectedEmotePackName(): string {
        if (selectedEmotePackKey === "__new") {
            return (
                newEmotePackName.trim() ||
                t("imagePackEditor.emotes", {
                    value: room.name || t("imagePackEditor.room"),
                })
            );
        }
        return (
            currentEmotePacks().find(
                (pack) => packKey(pack) === selectedEmotePackKey,
            )?.name ||
            t("imagePackEditor.emotes", {
                value: room.name || t("imagePackEditor.room"),
            })
        );
    }

    function selectedEmoteStateKey(): string {
        if (selectedEmotePackKey !== "__new") return selectedEmotePackKey;
        return newEmotePackName.trim() || "";
    }

    function updateEmoteLocal(
        stateKey: string,
        shortcode: string,
        usage: ImageUsage[],
    ) {
        setEmotePacks((emotePacks) =>
            sortEmotePacks(
                emotePacks.map((pack) =>
                    !pack.inherited &&
                    pack.roomId === room.roomId &&
                    packKey(pack) === stateKey
                        ? {
                              ...pack,
                              images: pack.images.map((item) =>
                                  item.shortcode === shortcode
                                      ? {
                                            ...item,
                                            usage,
                                            canEmoji:
                                                usage.includes("emoticon"),
                                            canSticker:
                                                usage.includes("sticker"),
                                        }
                                      : item,
                              ),
                          }
                        : pack,
                ),
            ),
        );
    }

    async function handleEmoteUpload() {
        // Zami: <input type="file" accept="image/*"> → the photo library.
        const picked = await pickImage();
        const file = picked?.file;
        if (!picked || !file) return;

        let error = validateEmojiShortcode(emoteShortcode) ?? "";
        const usage = usageFromFlags(newEmoteAsEmoji, newEmoteAsSticker);
        if (!error && usage.length === 0) {
            error = t("imagePackEditor.chooseAtLeastOneUsage");
        }
        if (
            !error &&
            selectedEmotePackKey === "__new" &&
            currentEmotePacks().length > 0 &&
            !newEmotePackName.trim()
        ) {
            error = t("imagePackEditor.enterAPackName");
        }
        setEmoteError(error);
        if (error) return;

        setEmoteUploading(true);
        try {
            const [mxcUrl, info] = await Promise.all([
                uploadContent(file),
                readImageInfo(file),
            ]);
            // Zami: readImageInfo measures with createImageBitmap, which React
            // Native lacks; the picker measured the image.
            info.w ??= picked.width;
            info.h ??= picked.height;
            const stateKey = selectedEmoteStateKey();
            const normalized = await addRoomEmote(
                room.roomId,
                stateKey,
                emoteShortcode,
                mxcUrl,
                selectedEmotePackName(),
                usage,
                { info },
            );
            const httpUrl = mxcToHttp(mxcUrl);
            const nextImage = {
                shortcode: normalized,
                mxcUrl,
                url: httpUrl ?? "",
                usage,
                canEmoji: usage.includes("emoticon"),
                canSticker: usage.includes("sticker"),
                info,
            };
            const packName = selectedEmotePackName();
            setEmotePacks((emotePacks) => {
                const existingPack = currentEmotePacks(emotePacks).find(
                    (pack) => packKey(pack) === stateKey,
                );
                const updatedPack: CustomImagePack = {
                    ...(existingPack ?? {
                        id: `${room.roomId}:${stateKey}`,
                        roomId: room.roomId,
                        stateKey,
                        name: packName,
                        sourceName: room.name || room.roomId,
                        avatarUrl: currentAvatarUrl ?? undefined,
                        editable: true,
                        images: [],
                    }),
                    images: [
                        ...(existingPack?.images ?? []).filter(
                            (item) => item.shortcode !== normalized,
                        ),
                        nextImage,
                    ].filter((item) => item.url),
                };
                return sortEmotePacks([
                    ...emotePacks.filter(
                        (pack) =>
                            pack.inherited ||
                            pack.roomId !== room.roomId ||
                            packKey(pack) !== stateKey,
                    ),
                    updatedPack,
                ]);
            });
            setEmoteShortcode("");
            setSelectedEmotePackKey(stateKey);
            roomsState.roomsTick++;
            onUpdate?.();
        } catch (err: any) {
            setEmoteError(err?.message ?? t("imagePackEditor.uploadFailed"));
        } finally {
            setEmoteUploading(false);
        }
    }

    async function setRoomEmoteFlag(
        pack: CustomImagePack,
        item: CustomPackImage,
        kind: ImageUsage,
        enabled: boolean,
    ) {
        const stateKey = packKey(pack);
        const usage = usageFromFlags(
            kind === "emoticon" ? enabled : item.canEmoji,
            kind === "sticker" ? enabled : item.canSticker,
        );
        if (usage.length === 0) {
            setEmoteError(t("imagePackEditor.chooseAtLeastOneUsage"));
            return;
        }
        setEmoteActionPending(`${stateKey}:${item.shortcode}:${kind}`);
        setEmoteError("");
        try {
            await setRoomEmoteUsage(
                room.roomId,
                stateKey,
                item.shortcode,
                usage,
            );
            updateEmoteLocal(stateKey, item.shortcode, usage);
            roomsState.roomsTick++;
            onUpdate?.();
        } catch (err: any) {
            setEmoteError(
                err?.message ?? t("imagePackEditor.failedToUpdateUsage"),
            );
        } finally {
            setEmoteActionPending(null);
        }
    }

    async function doRemoveEmote(pack: CustomImagePack, shortcode: string) {
        const stateKey = packKey(pack);
        setEmoteActionPending(`${stateKey}:${shortcode}:remove`);
        setEmoteError("");
        try {
            await removeRoomEmoteImage(room.roomId, stateKey, shortcode);
            setEmotePacks((emotePacks) =>
                sortEmotePacks(
                    emotePacks
                        .map((p) =>
                            !p.inherited &&
                            p.roomId === room.roomId &&
                            packKey(p) === stateKey
                                ? {
                                      ...p,
                                      images: p.images.filter(
                                          (item) =>
                                              item.shortcode !== shortcode,
                                      ),
                                  }
                                : p,
                        )
                        .filter((p) => p.inherited || p.images.length > 0),
                ),
            );
            roomsState.roomsTick++;
            onUpdate?.();
        } catch (err: any) {
            setEmoteError(
                err?.message ?? t("imagePackEditor.failedToRemoveImage"),
            );
        } finally {
            setEmoteActionPending(null);
        }
    }

    function packBusyKey(pack: CustomImagePack, action: string): string {
        return `${pack.id}:${action}`;
    }

    async function toggleGlobal(pack: CustomImagePack, enabled: boolean) {
        if (!pack.roomId) return;
        setPackBusy(packBusyKey(pack, "global"));
        setEmoteError("");
        setNotice("");
        try {
            await setPackGlobal(pack.roomId, packKey(pack), enabled);
            setEmotePacks((emotePacks) =>
                emotePacks.map((p) =>
                    p.id === pack.id ? { ...p, global: enabled } : p,
                ),
            );
            roomsState.roomsTick++;
        } catch (err: any) {
            setEmoteError(
                err?.message ?? t("imagePackEditor.failedToUpdatePack"),
            );
        } finally {
            setPackBusy(null);
        }
    }

    async function addToMine(pack: CustomImagePack, only?: CustomPackImage) {
        setPackBusy(
            packBusyKey(pack, only ? `mine:${only.shortcode}` : "mine"),
        );
        setEmoteError("");
        setNotice("");
        try {
            const added = await importImagesToUserPack(
                (only ? [only] : pack.images).map((item) => ({
                    shortcode: item.shortcode,
                    mxcUrl: item.mxcUrl,
                    info: item.info,
                    body: item.body,
                    usage: item.usage,
                })),
            );
            setNotice(
                added.length > 0
                    ? t("imagePackEditor.addedToYourPack", {
                          count: added.length,
                      })
                    : t("imagePackEditor.alreadyInYourPack"),
            );
            roomsState.roomsTick++;
        } catch (err: any) {
            setEmoteError(
                err?.message ?? t("imagePackEditor.failedToUpdatePack"),
            );
        } finally {
            setPackBusy(null);
        }
    }

    function startEdit(pack: CustomImagePack) {
        setEditingKey(pack.id);
        setEditName(pack.name);
        setEditAttribution(pack.attribution ?? "");
        setEditAvatarMxc(undefined);
    }

    async function pickPackAvatar() {
        // Zami: <input type="file" accept="image/*"> → the photo library.
        const file = (await pickImage())?.file;
        if (!file) return;
        try {
            setEditAvatarMxc(await uploadContent(file));
        } catch (err: any) {
            setEmoteError(err?.message ?? t("imagePackEditor.uploadFailed"));
        }
    }

    async function saveEdit(pack: CustomImagePack) {
        if (!pack.roomId) return;
        setPackBusy(packBusyKey(pack, "edit"));
        setEmoteError("");
        try {
            await updateRoomPackMeta(pack.roomId, packKey(pack), {
                displayName: editName,
                attribution: editAttribution,
                ...(editAvatarMxc !== undefined
                    ? { avatarMxc: editAvatarMxc }
                    : {}),
            });
            setEditingKey(null);
            // The state event round-trips through sync; re-read shortly after.
            setTimeout(() => {
                loadEmotes();
                roomsState.roomsTick++;
            }, 600);
            onUpdate?.();
        } catch (err: any) {
            setEmoteError(
                err?.message ?? t("imagePackEditor.failedToUpdatePack"),
            );
        } finally {
            setPackBusy(null);
        }
    }

    async function doDeletePack(pack: CustomImagePack) {
        if (!pack.roomId) return;
        if (
            // Zami: confirm() → a native alert.
            !(await confirmAlert(
                t("imagePackEditor.confirmDeletePack", { name: pack.name }),
                {
                    confirmText: t("common.delete"),
                    cancelText: t("common.cancel"),
                    destructive: true,
                },
            ))
        )
            return;
        setPackBusy(packBusyKey(pack, "delete"));
        setEmoteError("");
        try {
            await deleteRoomPack(pack.roomId, packKey(pack));
            setEmotePacks((emotePacks) =>
                emotePacks.filter((p) => p.id !== pack.id),
            );
            if (selectedEmotePackKey === packKey(pack)) {
                setSelectedEmotePackKey("__new");
            }
            roomsState.roomsTick++;
            onUpdate?.();
        } catch (err: any) {
            setEmoteError(
                err?.message ?? t("imagePackEditor.failedToUpdatePack"),
            );
        } finally {
            setPackBusy(null);
        }
    }

    // Zami: one FlatList, which RoomSettings shows as the Emotes tab's scroll
    // box, so a pack of hundreds of images renders only the rows on screen. A
    // pack's card is a "pack" row (its header, the all-rooms toggle and the
    // edit form) and then a row per image (`ImageRow`, memoized: an edit
    // re-renders the rows it changed); the add form above is the list's header.
    const rows = useMemo(() => {
        const out: PackRow[] = [];
        emotePacks.forEach((pack, index) => {
            out.push({ kind: "pack", key: pack.id, pack, first: index === 0 });
            pack.images.forEach((item, i) =>
                out.push({
                    kind: "image",
                    key: pack.id + ":" + item.shortcode,
                    pack,
                    item,
                    first: i === 0,
                    last: i === pack.images.length - 1,
                }),
            );
        });
        return out;
    }, [emotePacks]);

    // Zami: the image rows' actions, the same functions across renders.
    const packById = (packId: string) =>
        emotePacks.find((pack) => pack.id === packId);
    const onSetFlag = useStableCallback(
        (
            packId: string,
            item: CustomPackImage,
            kind: ImageUsage,
            checked: boolean,
        ) => {
            const pack = packById(packId);
            if (pack) setRoomEmoteFlag(pack, item, kind, checked);
        },
    );
    const onAddToMine = useStableCallback(
        (packId: string, item: CustomPackImage) => {
            const pack = packById(packId);
            if (pack) addToMine(pack, item);
        },
    );
    const onRemove = useStableCallback((packId: string, shortcode: string) => {
        const pack = packById(packId);
        if (pack) doRemoveEmote(pack, shortcode);
    });

    function renderRow({ item: row }: ListRenderItemInfo<PackRow>) {
        const pack = row.pack;
        if (row.kind === "image") {
            const item = row.item;
            const action = `${packKey(pack)}:${item.shortcode}`;
            return (
                <View
                    className={`bg-discord-backgroundTertiary px-2 ${
                        row.first ? "pt-2" : ""
                    } ${row.last ? "pb-2 rounded-b" : "pb-1"}`}
                >
                    <ImageRow
                        packId={pack.id}
                        item={item}
                        editable={canEditPack(pack)}
                        pendingEmoji={
                            emoteActionPending === `${action}:emoticon`
                        }
                        pendingSticker={
                            emoteActionPending === `${action}:sticker`
                        }
                        pendingRemove={
                            emoteActionPending === `${action}:remove`
                        }
                        mineBusy={
                            packBusy ===
                            packBusyKey(pack, `mine:${item.shortcode}`)
                        }
                        onSetFlag={onSetFlag}
                        onAddToMine={onAddToMine}
                        onRemove={onRemove}
                    />
                </View>
            );
        }
        return (
            <View
                className={`rounded-t bg-discord-backgroundTertiary overflow-hidden ${
                    row.first ? "" : "mt-3"
                }`}
            >
                <View className="flex-row items-center gap-2 px-3 py-2 border-b border-discord-divider">
                    {pack.avatarUrl ? (
                        <Image
                            source={mediaSource(pack.avatarUrl)}
                            contentFit="cover"
                            className="w-5 h-5 rounded flex-shrink-0"
                        />
                    ) : null}
                    <View className="min-w-0 flex-1">
                        <Text
                            numberOfLines={1}
                            className="text-sm font-semibold text-discord-textPrimary"
                        >
                            {pack.name}
                        </Text>
                        <Text
                            numberOfLines={1}
                            className="text-xs text-discord-textMuted"
                        >
                            {pack.inherited
                                ? t("imagePackEditor.inheritedFrom", {
                                      sourceName: pack.sourceName,
                                  })
                                : pack.sourceName}
                        </Text>
                        {pack.attribution ? (
                            <Text
                                numberOfLines={1}
                                className="text-xs text-discord-textMuted"
                            >
                                {t("imagePackEditor.attribution", {
                                    value: pack.attribution,
                                })}
                            </Text>
                        ) : null}
                    </View>
                    <View className="flex-row items-center gap-1 flex-shrink-0">
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                                addToMine(pack);
                            }}
                            disabled={packBusy === packBusyKey(pack, "mine")}
                            className="px-2 py-1 rounded hover:bg-discord-messageHover disabled:opacity-50"
                        >
                            <Text className="text-xs text-discord-textPrimary">
                                {t("imagePackEditor.addToMine")}
                            </Text>
                        </Pressable>
                        {canEditPack(pack) && (
                            <>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() =>
                                        editingKey === pack.id
                                            ? setEditingKey(null)
                                            : startEdit(pack)
                                    }
                                    className="px-2 py-1 rounded hover:bg-discord-messageHover"
                                >
                                    <Text className="text-xs text-discord-textPrimary">
                                        {t("imagePackEditor.editDetails")}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => {
                                        doDeletePack(pack);
                                    }}
                                    disabled={
                                        packBusy === packBusyKey(pack, "delete")
                                    }
                                    className="px-2 py-1 rounded hover:bg-discord-messageHover disabled:opacity-50"
                                >
                                    <Text className="text-xs text-discord-danger">
                                        {t("imagePackEditor.deletePack")}
                                    </Text>
                                </Pressable>
                            </>
                        )}
                    </View>
                </View>
                <Checkbox
                    checked={!!pack.global}
                    onChange={(checked) => {
                        toggleGlobal(pack, checked);
                    }}
                    disabled={packBusy === packBusyKey(pack, "global")}
                    className="items-center gap-2 px-3 py-2 border-b border-discord-divider"
                    label={
                        <Text className="flex-1 min-w-0 text-xs text-discord-textPrimary">
                            {t("imagePackEditor.useInAllRooms")}{" "}
                            <Text className="text-xs text-discord-textMuted">
                                {t("imagePackEditor.useInAllRoomsHint")}
                            </Text>
                        </Text>
                    }
                />
                {editingKey === pack.id && (
                    <View className="gap-2 px-3 py-2 border-b border-discord-divider">
                        {/* Zami: the grid's two columns from sm up
                        (sm:grid-cols-2): the fields share a row there,
                        and the actions (sm:col-span-2) have their own. */}
                        <View className="gap-2 sm:flex-row">
                            <TextInput
                                value={editName}
                                onChangeText={setEditName}
                                placeholder={t("imagePackEditor.packName")}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                className="min-w-0 sm:flex-1 bg-discord-backgroundSecondary text-discord-textPrimary text-sm rounded px-3 py-2 border border-transparent focus:border-discord-accent/50"
                            />
                            <TextInput
                                value={editAttribution}
                                onChangeText={setEditAttribution}
                                placeholder={t(
                                    "imagePackEditor.attributionPlaceholder",
                                )}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                className="min-w-0 sm:flex-1 bg-discord-backgroundSecondary text-discord-textPrimary text-sm rounded px-3 py-2 border border-transparent focus:border-discord-accent/50"
                            />
                        </View>
                        <View className="flex-row items-center gap-2">
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => {
                                    pickPackAvatar();
                                }}
                                className="px-3 py-1.5 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover"
                            >
                                <Text className="text-xs text-discord-textPrimary">
                                    {t("imagePackEditor.uploadPackAvatar")}
                                </Text>
                            </Pressable>
                            {editAvatarMxc ? (
                                <Text className="text-xs text-discord-textMuted">
                                    {t("imagePackEditor.avatarReady")}
                                </Text>
                            ) : null}
                            {pack.avatarUrl || editAvatarMxc ? (
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => setEditAvatarMxc(null)}
                                >
                                    <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                        {t("imagePackEditor.removePackAvatar")}
                                    </Text>
                                </Pressable>
                            ) : null}
                            <View className="flex-1" />
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => {
                                    saveEdit(pack);
                                }}
                                disabled={
                                    packBusy === packBusyKey(pack, "edit")
                                }
                                className="px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover disabled:opacity-50"
                            >
                                <Text className="text-white text-xs font-semibold">
                                    {t("common.save")}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                )}
            </View>
        );
    }

    return (
        <FlatList
            className="flex-1 min-w-0"
            contentContainerClassName="p-4 md:p-6"
            data={rows}
            keyExtractor={(row) => row.key}
            keyboardShouldPersistTaps="handled"
            renderScrollComponent={(props) => (
                <KeyboardAwareScrollView {...props} />
            )}
            renderItem={renderRow}
            ListHeaderComponent={
                <>
                    {header}
                    {canAdd || emoteError || notice ? (
                        <View className="gap-4 mb-4">
                            {canAdd && (
                                <View className="gap-2">
                                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                                        {t("imagePackEditor.addImage")}
                                    </Text>
                                    {/* Zami: the grid (sm:grid-cols-[1fr_auto]) as a column, and a
                                    row from sm up. */}
                                    <View className="gap-2 sm:flex-row">
                                        <View className="gap-2 min-w-0 sm:flex-1">
                                            <Select
                                                value={selectedEmotePackKey}
                                                onChange={
                                                    setSelectedEmotePackKey
                                                }
                                                disabled={
                                                    !canAdd || emoteUploading
                                                }
                                                options={[
                                                    ...editableEmotePacks().map(
                                                        (pack) => ({
                                                            key: pack.id,
                                                            value: packKey(
                                                                pack,
                                                            ),
                                                            label: pack.name,
                                                        }),
                                                    ),
                                                    ...(canEdit
                                                        ? [
                                                              {
                                                                  key: "__new",
                                                                  value: "__new",
                                                                  label: t(
                                                                      "imagePackEditor.newPack",
                                                                  ),
                                                              },
                                                          ]
                                                        : []),
                                                ]}
                                                className="w-full bg-discord-backgroundTertiary rounded px-3 py-2 border border-transparent focus:border-discord-accent/50 disabled:opacity-50"
                                            />
                                            {selectedEmotePackKey ===
                                                "__new" && (
                                                <TextInput
                                                    value={newEmotePackName}
                                                    onChangeText={
                                                        setNewEmotePackName
                                                    }
                                                    editable={
                                                        !(
                                                            !canAdd ||
                                                            emoteUploading
                                                        )
                                                    }
                                                    placeholder={t(
                                                        "imagePackEditor.packName",
                                                    )}
                                                    placeholderTextColorClassName="accent-discord-textMuted"
                                                    className="w-full min-w-0 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 border border-transparent focus:border-discord-accent/50 disabled:opacity-50"
                                                />
                                            )}
                                            <View className="flex-row items-center bg-discord-backgroundTertiary rounded border border-transparent">
                                                <Text className="ps-3 text-sm text-discord-textMuted">
                                                    :
                                                </Text>
                                                <TextInput
                                                    value={emoteShortcode}
                                                    onChangeText={
                                                        setEmoteShortcode
                                                    }
                                                    editable={
                                                        !(
                                                            !canAdd ||
                                                            emoteUploading
                                                        )
                                                    }
                                                    placeholder={t(
                                                        "imagePackEditor.shortcode",
                                                    )}
                                                    placeholderTextColorClassName="accent-discord-textMuted"
                                                    accessibilityLabel={t(
                                                        "imagePackEditor.addImage",
                                                    )}
                                                    autoCapitalize="none"
                                                    autoCorrect={false}
                                                    className="min-w-0 flex-1 bg-transparent text-discord-textPrimary text-sm py-2 disabled:opacity-50"
                                                />
                                                <Text className="pe-3 text-sm text-discord-textMuted">
                                                    :
                                                </Text>
                                            </View>
                                        </View>
                                        {canAdd && (
                                            <Pressable
                                                accessibilityRole="button"
                                                onPress={() => {
                                                    handleEmoteUpload();
                                                }}
                                                disabled={emoteUploading}
                                                className={`shrink-0 self-start px-3 py-2 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors ${
                                                    emoteUploading
                                                        ? "opacity-50"
                                                        : ""
                                                }`}
                                            >
                                                <Text className="text-white text-sm font-semibold text-center">
                                                    {emoteUploading
                                                        ? t("common.uploading")
                                                        : t(
                                                              "common.uploadImage",
                                                          )}
                                                </Text>
                                            </Pressable>
                                        )}
                                    </View>
                                    <View className="flex-row items-center gap-3 px-3 py-2 rounded bg-discord-backgroundTertiary">
                                        <Checkbox
                                            checked={newEmoteAsEmoji}
                                            onChange={setNewEmoteAsEmoji}
                                            disabled={!canAdd || emoteUploading}
                                            label={t(
                                                "imagePackEditor.useAsEmoji",
                                            )}
                                            labelClassName="text-xs text-discord-textPrimary"
                                            className="items-center gap-1.5"
                                        />
                                        <Checkbox
                                            checked={newEmoteAsSticker}
                                            onChange={setNewEmoteAsSticker}
                                            disabled={!canAdd || emoteUploading}
                                            label={t(
                                                "imagePackEditor.useAsSticker",
                                            )}
                                            labelClassName="text-xs text-discord-textPrimary"
                                            className="items-center gap-1.5"
                                        />
                                    </View>
                                </View>
                            )}

                            {emoteError ? (
                                <Text className="text-sm text-discord-danger">
                                    {emoteError}
                                </Text>
                            ) : null}
                            {notice ? (
                                <Text className="text-sm text-discord-textMuted">
                                    {notice}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}
                </>
            }
            ListEmptyComponent={
                <Text className="text-sm text-discord-textMuted text-center py-4">
                    {t("imagePackEditor.noCustomImages")}
                </Text>
            }
            ListFooterComponent={<>{footer}</>}
        />
    );
}

type PackRow =
    | { kind: "pack"; key: string; pack: CustomImagePack; first: boolean }
    | {
          kind: "image";
          key: string;
          pack: CustomImagePack;
          item: CustomPackImage;
          first: boolean;
          last: boolean;
      };

// Zami: one image of a pack. Memoized on what it shows, so a list of hundreds
// re-renders only the rows an action changed.
const ImageRow = memo(function ImageRow({
    packId,
    item,
    editable,
    pendingEmoji,
    pendingSticker,
    pendingRemove,
    mineBusy,
    onSetFlag,
    onAddToMine,
    onRemove,
}: {
    packId: string;
    item: CustomPackImage;
    editable: boolean;
    pendingEmoji: boolean;
    pendingSticker: boolean;
    pendingRemove: boolean;
    mineBusy: boolean;
    onSetFlag: (
        packId: string,
        item: CustomPackImage,
        kind: ImageUsage,
        checked: boolean,
    ) => void;
    onAddToMine: (packId: string, item: CustomPackImage) => void;
    onRemove: (packId: string, shortcode: string) => void;
}) {
    return (
        <View className="flex-row items-center gap-3 p-2 rounded bg-discord-backgroundSecondary">
            <View className="w-12 h-12 rounded bg-discord-backgroundTertiary flex-shrink-0 overflow-hidden items-center justify-center">
                <Image
                    source={mediaSource(item.url)}
                    contentFit="contain"
                    className="w-12 h-12"
                />
            </View>
            <View className="flex-1 min-w-0">
                <Text
                    numberOfLines={1}
                    className="text-sm font-medium text-discord-textPrimary"
                >
                    :{item.shortcode}:
                </Text>
                <Text
                    numberOfLines={1}
                    className="text-xs text-discord-textMuted"
                >
                    {item.mxcUrl}
                </Text>
            </View>
            <View className="flex-row items-center gap-3">
                {editable ? (
                    <Checkbox
                        checked={item.canEmoji}
                        onChange={(checked) => {
                            onSetFlag(packId, item, "emoticon", checked);
                        }}
                        disabled={!editable || pendingEmoji}
                        label={t("common.emoji")}
                        labelClassName="text-xs text-discord-textPrimary"
                        className="items-center gap-1.5"
                    />
                ) : item.canEmoji ? (
                    <Text className="px-1.5 py-0.5 rounded bg-discord-backgroundTertiary text-xs text-discord-textMuted">
                        {t("common.emoji")}
                    </Text>
                ) : null}
                {editable ? (
                    <Checkbox
                        checked={item.canSticker}
                        onChange={(checked) => {
                            onSetFlag(packId, item, "sticker", checked);
                        }}
                        disabled={!editable || pendingSticker}
                        label={t("imagePackEditor.sticker")}
                        labelClassName="text-xs text-discord-textPrimary"
                        className="items-center gap-1.5"
                    />
                ) : item.canSticker ? (
                    <Text className="px-1.5 py-0.5 rounded bg-discord-backgroundTertiary text-xs text-discord-textMuted">
                        {t("imagePackEditor.sticker")}
                    </Text>
                ) : null}
            </View>
            <Pressable
                accessibilityRole="button"
                onPress={() => {
                    onAddToMine(packId, item);
                }}
                disabled={mineBusy}
                className="px-2 py-1 rounded hover:bg-discord-messageHover disabled:opacity-50"
            >
                <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                    {t("imagePackEditor.addToMine")}
                </Text>
            </Pressable>
            {editable && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("imagePackEditor.removeImage")}
                    onPress={() => {
                        onRemove(packId, item.shortcode);
                    }}
                    disabled={pendingRemove}
                    className="p-1 rounded hover:bg-discord-messageHover transition-colors disabled:opacity-50"
                >
                    <X size={16} className="text-discord-textMuted" />
                </Pressable>
            )}
        </View>
    );
});

// Zami: <input type="file" accept="image/*"> → expo-image-picker's photo library.
// Resolves to the picked image as a `File` with its size, or null when cancelled.
async function pickImage(): Promise<{
    file: File;
    width: number;
    height: number;
} | null> {
    const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return null;
    const file = await pickedFile(asset);
    return { file, width: asset.width, height: asset.height };
}
