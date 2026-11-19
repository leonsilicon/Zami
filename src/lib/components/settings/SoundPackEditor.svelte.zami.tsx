import { confirmAlert, pickedFile, Select } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import * as DocumentPicker from "expo-document-picker";
import { Play, X } from "lucide-svelte";
import EmojiPicker from "$lib/components/ui/EmojiPicker.svelte";
import type { Room } from "matrix-js-sdk";
import { Fragment, useEffect, useRef, useState } from "react";
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
    normalizeSoundEmoji,
    normalizeSoundName,
    soundFileProblem,
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
    const [selectedKey, setSelectedKey] = useState("");
    const [newPackName, setNewPackName] = useState("");
    const [uploading, setUploading] = useState(false);
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    // A picked file waits here until Add or Cancel decides its fate.
    const [stagedFile, setStagedFile] = useState<File | null>(null);
    const [stagedUrl, setStagedUrl] = useState("");
    const [stagedName, setStagedName] = useState("");
    const [stagedEmoji, setStagedEmoji] = useState("");
    const [stagedPicker, setStagedPicker] = useState(false);

    // The sound whose emoji picker is open, as `soundKey(pack, sound)`.
    const [emojiEditKey, setEmojiEditKey] = useState<string | null>(null);
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

    // Zami: the staged URL in a ref too, for the unmount cleanup.
    const stagedUrlRef = useRef("");
    useEffect(
        () => () => {
            if (stagedUrlRef.current) URL.revokeObjectURL(stagedUrlRef.current);
        },
        [],
    );

    function clearStaged() {
        if (stagedUrlRef.current) URL.revokeObjectURL(stagedUrlRef.current);
        stagedUrlRef.current = "";
        setStagedUrl("");
        setStagedFile(null);
        setStagedName("");
        setStagedEmoji("");
        setStagedPicker(false);
    }

    /** Pick a file: check it and stage it for review. Nothing is uploaded
     *  until Add. */
    async function stageFile() {
        // Zami: <input type="file" accept="audio/*"> → expo-document-picker.
        const file = await pickAudio();
        if (!file) return;
        setError("");
        setNotice("");
        const problem = soundFileProblem(file);
        if (problem === "notAudio") {
            setError(t("soundboard.notAudio"));
            return;
        }
        if (problem === "tooBig") {
            setError(t("soundboard.tooBig"));
            return;
        }
        clearStaged();
        setStagedFile(file);
        const url = URL.createObjectURL(file);
        stagedUrlRef.current = url;
        setStagedUrl(url);
        setStagedName(soundNameFromText(file.name.replace(/\.[^.]+$/, "")));
    }

    function cancelStaged() {
        setError("");
        clearStaged();
    }

    /** Upload the staged file and add it. The typed name becomes a shortcode;
     *  when that had to change it, the original is kept as the description. */
    async function addStaged() {
        const file = stagedFile;
        if (!file) return;
        setError("");
        setNotice("");
        const typed = normalizeSoundName(
            stagedName || file.name.replace(/\.[^.]+$/, ""),
        );
        const wanted = soundNameFromText(typed);
        if (!isValidSoundName(wanted)) {
            setError(t("soundboard.badName"));
            return;
        }
        const body = typed !== wanted ? typed : undefined;
        const emoji = normalizeSoundEmoji(stagedEmoji);
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
                    emoji,
                );
                setSelectedKey(stateKey);
            } else {
                await addUserSound(wanted, mxcUrl, info, body, emoji);
            }
            clearStaged();
            setNewPackName("");
            roomsState.roomsTick++;
            load();
        } catch (err) {
            setError((err as Error)?.message ?? t("soundboard.uploadFailed"));
        } finally {
            setUploading(false);
        }
    }

    function soundKey(pack: SoundPack, sound: Sound): string {
        return `${pack.id}:${sound.name}`;
    }

    function toggleEmojiEdit(pack: SoundPack, sound: Sound) {
        const key = soundKey(pack, sound);
        setEmojiEditKey((current) => (current === key ? null : key));
    }

    /** Replace a sound's emoji (undefined clears it). Re-adding under the same
     *  name keeps the rest of the entry. */
    async function setSoundEmoji(
        pack: SoundPack,
        sound: Sound,
        emoji: string | undefined,
    ) {
        setPending(soundKey(pack, sound));
        setError("");
        setNotice("");
        try {
            if (room && pack.stateKey !== undefined)
                await addRoomSound(
                    room,
                    pack.stateKey,
                    sound.name,
                    sound.mxcUrl,
                    pack.name,
                    sound.info,
                    sound.body,
                    emoji,
                );
            else
                await addUserSound(
                    sound.name,
                    sound.mxcUrl,
                    sound.info,
                    sound.body,
                    emoji,
                );
            setEmojiEditKey(null);
            roomsState.roomsTick++;
            load();
        } catch (err) {
            setError((err as Error)?.message ?? t("soundboard.emojiFailed"));
        } finally {
            setPending(null);
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
    // Zami: stops the preview and deletes its blob file, unless that's the
    // staged file's (clearStaged deletes that one).
    function releasePreview() {
        preview.current?.pause();
        if (preview.current && preview.current.src !== stagedUrlRef.current)
            URL.revokeObjectURL(preview.current.src);
    }
    // Zami: plays the staged file, upstream's <audio controls src={stagedUrl}>.
    // It's the staged file's own URL, which clearStaged revokes.
    async function playUrl(url: string) {
        if (!url) return;
        try {
            releasePreview();
            preview.current = new Audio(url);
            await preview.current.play();
        } catch {
            setError(t("soundboard.previewFailed"));
        }
    }
    async function previewSound(sound: Sound) {
        setError("");
        try {
            const url = mxcToHttp(sound.mxcUrl);
            if (!url) return;
            const bytes = await fetchMediaBytes(url, MAX_SOUND_BYTES);
            releasePreview();
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
            releasePreview();
        },
        [],
    );

    return (
        <View className="gap-4">
            {canAdd && (
                <View className="gap-2">
                    <Text
                        accessibilityRole="header"
                        className="text-xs font-semibold text-zam-textMuted uppercase tracking-wide"
                    >
                        {t("soundboard.add")}
                    </Text>
                    <Text className="text-xs text-zam-textMuted">
                        {t("soundboard.limits", {
                            seconds: MAX_SOUND_SECONDS,
                            kb: Math.round(MAX_SOUND_BYTES / 1024),
                        })}
                    </Text>
                    {room && (
                        <View className="gap-2 min-w-0">
                            <Select
                                value={selectedKey}
                                onChange={setSelectedKey}
                                disabled={uploading}
                                accessibilityLabel={t("soundboard.pack")}
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
                                className="w-full bg-zam-backgroundTertiary rounded px-3 py-2 border border-transparent focus:border-zam-accent/50"
                            />
                            {selectedKey === "__new" && (
                                <TextInput
                                    value={newPackName}
                                    onChangeText={setNewPackName}
                                    editable={!uploading}
                                    placeholder={t("soundboard.packName")}
                                    placeholderTextColorClassName="accent-zam-textMuted"
                                    className="min-w-0 bg-zam-backgroundTertiary text-zam-textPrimary text-sm rounded px-3 py-2 border border-transparent focus:border-zam-accent/50"
                                />
                            )}
                        </View>
                    )}
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                            void stageFile();
                        }}
                        disabled={
                            uploading ||
                            (!!room && editablePacks.length === 0 && !canCreate)
                        }
                        className={`self-start px-3 py-2 rounded bg-zam-accent ${
                            uploading ||
                            (room && editablePacks.length === 0 && !canCreate)
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

                    {stagedFile && (
                        <View className="gap-2 rounded bg-zam-backgroundTertiary p-3">
                            <Text
                                numberOfLines={1}
                                className="text-xs text-zam-textMuted truncate"
                            >
                                {stagedFile.name}
                            </Text>
                            {/* Zami: <audio controls> → a play button for
                                the staged file. */}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t("soundboard.preview")}
                                onPress={() => void playUrl(stagedUrl)}
                                className="self-start p-2 rounded-full bg-zam-backgroundSecondary hover:bg-zam-messageHover"
                            >
                                <Play
                                    size={14}
                                    className="text-zam-textPrimary"
                                />
                            </Pressable>
                            <View className="gap-1">
                                <Text
                                    nativeID="sound-staged-name"
                                    className="text-xs font-semibold text-zam-textMuted uppercase tracking-wide"
                                >
                                    {t("soundboard.name")}
                                </Text>
                                <TextInput
                                    value={stagedName}
                                    onChangeText={setStagedName}
                                    editable={!uploading}
                                    accessibilityLabelledBy="sound-staged-name"
                                    accessibilityLabel={t("soundboard.name")}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    className="min-w-0 bg-zam-backgroundSecondary text-zam-textPrimary text-sm rounded px-3 py-2 border border-transparent focus:border-zam-accent/50"
                                />
                            </View>
                            <View className="flex-row items-center gap-2">
                                <Text className="text-xs font-semibold text-zam-textMuted uppercase tracking-wide">
                                    {t("soundboard.emoji")}
                                </Text>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() =>
                                        setStagedPicker((open) => !open)
                                    }
                                    disabled={uploading}
                                    accessibilityState={{
                                        expanded: stagedPicker,
                                        disabled: uploading,
                                    }}
                                    accessibilityLabel={t("soundboard.emoji")}
                                    className="min-w-[2.5rem] items-center px-2 py-1 rounded bg-zam-backgroundSecondary hover:bg-zam-messageHover disabled:opacity-50"
                                >
                                    {stagedEmoji ? (
                                        <Text className="text-xl leading-none text-zam-textPrimary">
                                            {stagedEmoji}
                                        </Text>
                                    ) : (
                                        <Text className="text-xs text-zam-textMuted">
                                            {t("soundboard.noEmoji")}
                                        </Text>
                                    )}
                                </Pressable>
                                {stagedEmoji ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => setStagedEmoji("")}
                                        disabled={uploading}
                                        className="px-2 py-1 rounded hover:bg-zam-messageHover disabled:opacity-50"
                                    >
                                        <Text className="text-xs text-zam-textMuted">
                                            {t("soundboard.clearEmoji")}
                                        </Text>
                                    </Pressable>
                                ) : null}
                            </View>
                            {stagedPicker && (
                                <EmojiPicker
                                    unicodeOnly
                                    onSelect={(picked) =>
                                        setStagedEmoji(picked)
                                    }
                                    onClose={() => setStagedPicker(false)}
                                />
                            )}
                            <View className="flex-row justify-end gap-2">
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={cancelStaged}
                                    disabled={uploading}
                                    className="px-3 py-1.5 rounded hover:bg-zam-messageHover disabled:opacity-50"
                                >
                                    <Text className="text-sm text-zam-textPrimary">
                                        {t("common.cancel")}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => void addStaged()}
                                    disabled={uploading}
                                    className="px-3 py-1.5 rounded bg-zam-accent disabled:opacity-50"
                                >
                                    <Text className="text-white text-sm font-semibold">
                                        {uploading
                                            ? t("common.uploading")
                                            : t("soundboard.addStaged")}
                                    </Text>
                                </Pressable>
                            </View>
                        </View>
                    )}
                </View>
            )}

            {error ? (
                <Text className="text-sm text-zam-danger">{error}</Text>
            ) : null}
            {notice ? (
                <Text className="text-sm text-zam-textMuted">{notice}</Text>
            ) : null}

            <View className="gap-3">
                {packs.map((pack) => (
                    <View
                        key={pack.id}
                        className="rounded bg-zam-backgroundTertiary overflow-hidden"
                    >
                        <View className="flex-row items-center gap-2 px-3 py-2 border-b border-zam-divider">
                            <View className="min-w-0 flex-1">
                                <Text
                                    numberOfLines={1}
                                    className="text-sm font-semibold text-zam-textPrimary"
                                >
                                    {pack.name}
                                </Text>
                                {pack.sourceName ? (
                                    <Text
                                        numberOfLines={1}
                                        className="text-xs text-zam-textMuted"
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
                                        className="px-2 py-1 rounded hover:bg-zam-messageHover disabled:opacity-50"
                                    >
                                        <Text
                                            className={`text-xs ${
                                                pack.global
                                                    ? "text-zam-accent font-semibold"
                                                    : "text-zam-textPrimary"
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
                                        className="px-2 py-1 rounded hover:bg-zam-messageHover"
                                    >
                                        <Text className="text-xs text-zam-textPrimary">
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
                                            className="px-2 py-1 rounded hover:bg-zam-messageHover disabled:opacity-50"
                                        >
                                            <Text className="text-xs text-zam-danger">
                                                {t("soundboard.deletePack")}
                                            </Text>
                                        </Pressable>
                                    )}
                                </>
                            )}
                        </View>
                        <View className="gap-1 p-2">
                            {pack.sounds.map((sound) => (
                                <Fragment key={sound.name}>
                                    <View className="flex-row items-center gap-3 p-2 rounded bg-zam-backgroundSecondary">
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={t(
                                                "soundboard.preview",
                                            )}
                                            onPress={() => previewSound(sound)}
                                            className="p-2 rounded-full hover:bg-zam-messageHover"
                                        >
                                            <Play
                                                size={14}
                                                className="text-zam-textPrimary"
                                            />
                                        </Pressable>
                                        <View className="flex-1 min-w-0">
                                            <Text
                                                numberOfLines={1}
                                                className="text-sm font-medium text-zam-textPrimary"
                                            >
                                                {sound.emoji ? (
                                                    <Text
                                                        importantForAccessibility="no"
                                                        accessibilityElementsHidden
                                                    >
                                                        {sound.emoji}{" "}
                                                    </Text>
                                                ) : null}
                                                {sound.name}
                                            </Text>
                                            {sound.info?.duration !==
                                            undefined ? (
                                                <Text className="text-xs text-zam-textMuted">
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
                                                className="px-2 py-1 rounded hover:bg-zam-messageHover"
                                            >
                                                <Text className="text-xs text-zam-textMuted hover:text-zam-textPrimary">
                                                    {t("soundboard.addToMine")}
                                                </Text>
                                            </Pressable>
                                        )}
                                        {pack.editable && (
                                            <>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() =>
                                                        toggleEmojiEdit(
                                                            pack,
                                                            sound,
                                                        )
                                                    }
                                                    disabled={
                                                        pending ===
                                                        soundKey(pack, sound)
                                                    }
                                                    accessibilityState={{
                                                        expanded:
                                                            emojiEditKey ===
                                                            soundKey(
                                                                pack,
                                                                sound,
                                                            ),
                                                    }}
                                                    className="px-2 py-1 rounded hover:bg-zam-messageHover disabled:opacity-50"
                                                >
                                                    <Text className="text-xs text-zam-textMuted">
                                                        {t(
                                                            "soundboard.editEmoji",
                                                        )}
                                                    </Text>
                                                </Pressable>
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
                                                    className="p-1 rounded hover:bg-zam-messageHover disabled:opacity-50"
                                                >
                                                    <X
                                                        size={14}
                                                        className="text-zam-textMuted"
                                                    />
                                                </Pressable>
                                            </>
                                        )}
                                    </View>
                                    {pack.editable &&
                                        emojiEditKey ===
                                            soundKey(pack, sound) && (
                                            <View className="gap-2 px-2 pb-2">
                                                {sound.emoji ? (
                                                    <Pressable
                                                        accessibilityRole="button"
                                                        onPress={() =>
                                                            void setSoundEmoji(
                                                                pack,
                                                                sound,
                                                                undefined,
                                                            )
                                                        }
                                                        disabled={
                                                            pending ===
                                                            soundKey(
                                                                pack,
                                                                sound,
                                                            )
                                                        }
                                                        className="self-start px-2 py-1 rounded hover:bg-zam-messageHover disabled:opacity-50"
                                                    >
                                                        <Text className="text-xs text-zam-danger">
                                                            {t(
                                                                "soundboard.clearEmoji",
                                                            )}
                                                        </Text>
                                                    </Pressable>
                                                ) : null}
                                                <EmojiPicker
                                                    unicodeOnly
                                                    onSelect={(picked) =>
                                                        void setSoundEmoji(
                                                            pack,
                                                            sound,
                                                            picked,
                                                        )
                                                    }
                                                    onClose={() =>
                                                        setEmojiEditKey(null)
                                                    }
                                                />
                                            </View>
                                        )}
                                </Fragment>
                            ))}
                            {pack.sounds.length === 0 ? (
                                <Text className="text-sm text-zam-textMuted text-center py-2">
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
