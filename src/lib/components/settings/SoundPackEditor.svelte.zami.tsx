import { confirmAlert, pickedFile, Select } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as DocumentPicker from "expo-document-picker";
import { Play, X } from "lucide-svelte";
import type { Room } from "matrix-js-sdk";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import {
    USER_SOUND_PACK_NAME,
    addRoomSound,
    addUserSound,
    canEditRoomSounds,
    deleteRoomSoundPack,
    getManageableSoundPacks,
    getUserSounds,
    importSoundsToUserPack,
    removeRoomSound,
    removeUserSound,
    setSoundPackGlobal,
    uploadSoundFile,
} from "$lib/matrix/soundboard";
import { fetchMediaBytes, mxcToHttp } from "$lib/matrix/media";
import { roomsState } from "$lib/stores/rooms.svelte";
import {
    MAX_SOUND_BYTES,
    MAX_SOUND_SECONDS,
    isValidSoundName,
    normalizeSoundName,
    soundNameFromText,
    type Sound,
    type SoundPack,
} from "$lib/utils/soundboard";

interface Props {
    /** A room or space to edit the packs of; the user's own pack when
     *  absent. */
    room?: Room;
}

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. Text classes sit on each Text, and `title` tooltips
// are dropped.
export default function SoundPackEditor({ room }: Props) {
    const [packs, setPacks] = useState<SoundPack[]>([]);
    const [name, setName] = useState("");
    const [selectedKey, setSelectedKey] = useState("");
    const [newPackName, setNewPackName] = useState("");
    const [uploading, setUploading] = useState(false);
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const roomsTick = useRune(() => roomsState.roomsTick);

    const canCreate = room ? canEditRoomSounds(room) : true;
    const editablePacks = packs.filter((pack) => pack.editable);
    const canAdd = !room || canCreate || editablePacks.length > 0;

    function load() {
        const next = room
            ? getManageableSoundPacks(room)
            : [
                  {
                      id: "user",
                      name: USER_SOUND_PACK_NAME,
                      editable: true,
                      sounds: getUserSounds(),
                  },
              ];
        setPacks(next);
        // Zami: the editable packs of what was just loaded, as upstream's
        // `editablePacks` reads after `packs` changes.
        const editable = next.filter((pack) => pack.editable);
        if (room) {
            setSelectedKey((selected) =>
                selected !== "__new" &&
                !editable.some((pack) => pack.stateKey === selected)
                    ? (editable[0]?.stateKey ?? "__new")
                    : selected,
            );
        }
    }

    useEffect(() => {
        // load() reads what it writes; keep that out of the effect's deps.
        load();
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- `room` and the tick are the deps.
    }, [room, roomsTick]);

    async function upload() {
        // Zami: <input type="file" accept="audio/*"> → expo-document-picker.
        const file = await pickAudio();
        if (!file) return;
        setError("");
        setNotice("");
        // The typed (or file) name becomes a shortcode; when that had to
        // change it, the original is kept as the sound's description.
        const typed = normalizeSoundName(
            name || file.name.replace(/\.[^.]+$/, ""),
        );
        const wanted = soundNameFromText(typed);
        if (!isValidSoundName(wanted)) {
            setError(t("soundboard.badName"));
            return;
        }
        const body = typed !== wanted ? typed : undefined;
        const stateKey =
            selectedKey === "__new" ? newPackName.trim() : selectedKey;
        if (room && !stateKey) {
            setError(t("soundboard.enterAPackName"));
            return;
        }
        setUploading(true);
        try {
            const { mxcUrl, info } = await uploadSoundFile(file);
            if (room) {
                const packName =
                    packs.find((pack) => pack.stateKey === stateKey)?.name ||
                    stateKey;
                await addRoomSound(
                    room,
                    stateKey,
                    wanted,
                    mxcUrl,
                    packName,
                    info,
                    body,
                );
                setSelectedKey(stateKey);
            } else {
                await addUserSound(wanted, mxcUrl, info, body);
            }
            setName("");
            setNewPackName("");
            roomsState.roomsTick++;
            load();
        } catch (err) {
            setError((err as Error)?.message ?? t("soundboard.uploadFailed"));
        } finally {
            setUploading(false);
        }
    }

    async function remove(pack: SoundPack, sound: Sound) {
        setPending(`${pack.id}:${sound.name}`);
        setError("");
        setNotice("");
        try {
            if (room && pack.stateKey !== undefined)
                await removeRoomSound(room, pack.stateKey, sound.name);
            else await removeUserSound(sound.name);
            roomsState.roomsTick++;
            load();
        } catch (err) {
            setError((err as Error)?.message ?? t("soundboard.removeFailed"));
        } finally {
            setPending(null);
        }
    }

    async function deletePack(pack: SoundPack) {
        if (!room || pack.stateKey === undefined) return;
        if (
            // Zami: confirm() → a native alert.
            !(await confirmAlert(
                t("soundboard.confirmDeletePack", { name: pack.name }),
                {
                    confirmText: t("common.delete"),
                    cancelText: t("common.cancel"),
                    destructive: true,
                },
            ))
        )
            return;
        setPending(`${pack.id}:pack`);
        setError("");
        try {
            await deleteRoomSoundPack(room, pack.stateKey);
            roomsState.roomsTick++;
            load();
        } catch (err) {
            setError((err as Error)?.message ?? t("soundboard.removeFailed"));
        } finally {
            setPending(null);
        }
    }

    async function toggleGlobal(pack: SoundPack) {
        if (!pack.roomId || pack.stateKey === undefined) return;
        setPending(`${pack.id}:global`);
        setError("");
        setNotice("");
        try {
            await setSoundPackGlobal(pack.roomId, pack.stateKey, !pack.global);
            roomsState.roomsTick++;
            load();
        } catch (err) {
            setError((err as Error)?.message ?? t("soundboard.globalFailed"));
        } finally {
            setPending(null);
        }
    }

    /** A stored duration (milliseconds) as seconds, e.g. "2.4s". */
    function formatDuration(ms: number): string {
        return `${Math.round(ms / 100) / 10}s`;
    }

    async function addToMine(sounds: Sound[]) {
        setError("");
        setNotice("");
        try {
            const added = await importSoundsToUserPack(sounds);
            setNotice(
                added.length > 0
                    ? t("soundboard.addedToYours", { count: added.length })
                    : t("soundboard.alreadyYours"),
            );
            roomsState.roomsTick++;
        } catch (err) {
            setError((err as Error)?.message ?? t("soundboard.uploadFailed"));
        }
    }

    const preview = useRef<HTMLAudioElement | null>(null);
    async function previewSound(sound: Sound) {
        setError("");
        try {
            const url = mxcToHttp(sound.mxcUrl);
            if (!url) return;
            const bytes = await fetchMediaBytes(url, MAX_SOUND_BYTES);
            preview.current?.pause();
            if (preview.current) URL.revokeObjectURL(preview.current.src);
            preview.current = new Audio(
                URL.createObjectURL(
                    new Blob([bytes], { type: sound.info?.mimetype }),
                ),
            );
            await preview.current.play();
        } catch {
            setError(t("soundboard.previewFailed"));
        }
    }
    // Zami: closing the editor stops the preview and deletes its file (a blob
    // URL is a file here).
    useEffect(
        () => () => {
            preview.current?.pause();
            if (preview.current) URL.revokeObjectURL(preview.current.src);
        },
        [],
    );

    return (
        <View className="gap-4">
            {canAdd && (
                <View className="gap-2">
                    <Text
                        accessibilityRole="header"
                        className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
                    >
                        {t("soundboard.add")}
                    </Text>
                    <Text className="text-xs text-discord-textMuted">
                        {t("soundboard.limits", {
                            seconds: MAX_SOUND_SECONDS,
                            kb: Math.round(MAX_SOUND_BYTES / 1024),
                        })}
                    </Text>
                    {/* Zami: the grid (sm:grid-cols-[1fr_auto]) as a column, and a
                        row from sm up. */}
                    <View className="gap-2 sm:flex-row">
                        <View className="gap-2 min-w-0 sm:flex-1">
                            {room && (
                                <>
                                    <Select
                                        value={selectedKey}
                                        onChange={setSelectedKey}
                                        disabled={uploading}
                                        accessibilityLabel={t(
                                            "soundboard.pack",
                                        )}
                                        options={[
                                            ...editablePacks.map((pack) => ({
                                                key: pack.id,
                                                value: pack.stateKey ?? "",
                                                label: pack.name,
                                            })),
                                            ...(canCreate
                                                ? [
                                                      {
                                                          key: "__new",
                                                          value: "__new",
                                                          label: t(
                                                              "soundboard.newPack",
                                                          ),
                                                      },
                                                  ]
                                                : []),
                                        ]}
                                        className="w-full bg-discord-backgroundTertiary rounded px-3 py-2 border border-transparent focus:border-discord-accent/50"
                                    />
                                    {selectedKey === "__new" && (
                                        <TextInput
                                            value={newPackName}
                                            onChangeText={setNewPackName}
                                            editable={!uploading}
                                            placeholder={t(
                                                "soundboard.packName",
                                            )}
                                            placeholderTextColorClassName="accent-discord-textMuted"
                                            className="min-w-0 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 border border-transparent focus:border-discord-accent/50"
                                        />
                                    )}
                                </>
                            )}
                            <TextInput
                                value={name}
                                onChangeText={setName}
                                editable={!uploading}
                                placeholder={t("soundboard.name")}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                accessibilityLabel={t("soundboard.name")}
                                autoCapitalize="none"
                                autoCorrect={false}
                                className="min-w-0 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 border border-transparent focus:border-discord-accent/50"
                            />
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                                upload();
                            }}
                            disabled={
                                uploading ||
                                (!!room &&
                                    editablePacks.length === 0 &&
                                    !canCreate)
                            }
                            className={`px-3 py-2 rounded bg-discord-accent self-start ${
                                uploading ||
                                (room &&
                                    editablePacks.length === 0 &&
                                    !canCreate)
                                    ? "opacity-50"
                                    : ""
                            }`}
                        >
                            <Text className="text-white text-sm font-semibold text-center">
                                {uploading
                                    ? t("common.uploading")
                                    : t("soundboard.upload")}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            )}

            {error ? (
                <Text className="text-sm text-discord-danger">{error}</Text>
            ) : null}
            {notice ? (
                <Text className="text-sm text-discord-textMuted">{notice}</Text>
            ) : null}

            <View className="gap-3">
                {packs.map((pack) => (
                    <View
                        key={pack.id}
                        className="rounded bg-discord-backgroundTertiary overflow-hidden"
                    >
                        <View className="flex-row items-center gap-2 px-3 py-2 border-b border-discord-divider">
                            <View className="min-w-0 flex-1">
                                <Text
                                    numberOfLines={1}
                                    className="text-sm font-semibold text-discord-textPrimary"
                                >
                                    {pack.name}
                                </Text>
                                {pack.sourceName ? (
                                    <Text
                                        numberOfLines={1}
                                        className="text-xs text-discord-textMuted"
                                    >
                                        {pack.inherited
                                            ? t("soundboard.inheritedFrom", {
                                                  sourceName: pack.sourceName,
                                              })
                                            : pack.sourceName}
                                    </Text>
                                ) : null}
                            </View>
                            {room && (
                                <>
                                    <Pressable
                                        accessibilityRole="togglebutton"
                                        accessibilityState={{
                                            checked: !!pack.global,
                                        }}
                                        onPress={() => {
                                            toggleGlobal(pack);
                                        }}
                                        disabled={
                                            pending === `${pack.id}:global`
                                        }
                                        className="px-2 py-1 rounded hover:bg-discord-messageHover disabled:opacity-50"
                                    >
                                        <Text
                                            className={`text-xs ${
                                                pack.global
                                                    ? "text-discord-accent font-semibold"
                                                    : "text-discord-textPrimary"
                                            }`}
                                        >
                                            {pack.global
                                                ? t("soundboard.usedEverywhere")
                                                : t("soundboard.useEverywhere")}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => {
                                            addToMine(pack.sounds);
                                        }}
                                        className="px-2 py-1 rounded hover:bg-discord-messageHover"
                                    >
                                        <Text className="text-xs text-discord-textPrimary">
                                            {t("soundboard.addToMine")}
                                        </Text>
                                    </Pressable>
                                    {pack.editable && (
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() => {
                                                deletePack(pack);
                                            }}
                                            disabled={
                                                pending === `${pack.id}:pack`
                                            }
                                            className="px-2 py-1 rounded hover:bg-discord-messageHover disabled:opacity-50"
                                        >
                                            <Text className="text-xs text-discord-danger">
                                                {t("soundboard.deletePack")}
                                            </Text>
                                        </Pressable>
                                    )}
                                </>
                            )}
                        </View>
                        <View className="gap-1 p-2">
                            {pack.sounds.map((sound) => (
                                <View
                                    key={sound.name}
                                    className="flex-row items-center gap-3 p-2 rounded bg-discord-backgroundSecondary"
                                >
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={t(
                                            "soundboard.preview",
                                        )}
                                        onPress={() => previewSound(sound)}
                                        className="p-2 rounded-full hover:bg-discord-messageHover"
                                    >
                                        <Play
                                            size={14}
                                            className="text-discord-textPrimary"
                                        />
                                    </Pressable>
                                    <View className="flex-1 min-w-0">
                                        <Text
                                            numberOfLines={1}
                                            className="text-sm font-medium text-discord-textPrimary"
                                        >
                                            {sound.name}
                                        </Text>
                                        {sound.info?.duration !== undefined ? (
                                            <Text className="text-xs text-discord-textMuted">
                                                {formatDuration(
                                                    sound.info.duration,
                                                )}
                                            </Text>
                                        ) : null}
                                    </View>
                                    {room && (
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() => {
                                                addToMine([sound]);
                                            }}
                                            className="px-2 py-1 rounded hover:bg-discord-messageHover"
                                        >
                                            <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                                {t("soundboard.addToMine")}
                                            </Text>
                                        </Pressable>
                                    )}
                                    {pack.editable && (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={t(
                                                "soundboard.remove",
                                            )}
                                            onPress={() => {
                                                remove(pack, sound);
                                            }}
                                            disabled={
                                                pending ===
                                                `${pack.id}:${sound.name}`
                                            }
                                            className="p-1 rounded hover:bg-discord-messageHover disabled:opacity-50"
                                        >
                                            <X
                                                size={14}
                                                className="text-discord-textMuted"
                                            />
                                        </Pressable>
                                    )}
                                </View>
                            ))}
                            {pack.sounds.length === 0 ? (
                                <Text className="text-sm text-discord-textMuted text-center py-2">
                                    {t("soundboard.noSounds")}
                                </Text>
                            ) : null}
                        </View>
                    </View>
                ))}
            </View>
        </View>
    );
}

// Zami: <input type="file" accept="audio/*"> → expo-document-picker. Resolves to
// the picked file, or null when cancelled.
async function pickAudio(): Promise<File | null> {
    const result = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        copyToCacheDirectory: true,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return null;
    return pickedFile(asset);
}
