import { Image, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    BackHandler,
    FlatList,
    I18nManager,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "$lib/i18n";
import {
    X,
    ArrowLeft,
    Search,
    Image as ImageIcon,
    FileText,
} from "lucide-svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import Portal from "$lib/components/ui/Portal.svelte";
import {
    getRooms,
    getRoomAvatar,
    getRoomDisplayName,
    getRoomTags,
} from "$lib/matrix/client";
import { sortRoomsByTag } from "$lib/utils/roomOrdering";
import { shareFileRows } from "$lib/utils/shareFileRows";
import {
    SHARE_MAX_FILES,
    SHARE_MAX_FILE_BYTES,
    SHARE_MAX_TOTAL_BYTES,
} from "$lib/utils/shareTargetGuard";
import {
    shareInboxState,
    deliverShareToRoom,
    clearShare,
} from "$lib/stores/shareInbox.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";

// Send button calls deliverShareToRoom with send:true, which sends via
// sendShare (bypassing the composer) when online, or stages into the
// composer with a toast when offline. Never leaks the user's draft/files.
const ONE_STEP_SEND = true;

// Preview rows + object-URL thumbnails for image files. Created once per
// payload; revoked on payload change / unmount so nothing leaks.
type PreviewRow = {
    name: string;
    sizeLabel: string;
    isImage: boolean;
    url: string | null;
};

// Zami: React Native's URL makes a `blob:` URL only for its own native Blobs, and
// throws without its blob module; a file it can't make one for shows the file icon.
function objectUrl(file: File): string | null {
    try {
        return URL.createObjectURL(file);
    } catch {
        return null;
    }
}

export default function ShareTargetSheet() {
    const insets = useSafeAreaInsets();
    const isTouchscreen = useRune(() => interfaceState.isTouchscreen);
    const payload = useRune(() => shareInboxState.payload);

    const [query, setQuery] = useState("");
    const [caption, setCaption] = useState("");
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

    // Initialise the caption from the incoming payload text, once per payload.
    const lastPayloadRef = useRef<unknown>(null);
    useEffect(() => {
        const p = payload;
        if (p && p !== lastPayloadRef.current) {
            lastPayloadRef.current = p;
            setCaption(p.text);
            setSelectedRoomId(null);
            setQuery("");
        }
    }, [payload]);

    const [previews, setPreviews] = useState<PreviewRow[]>([]);
    useEffect(() => {
        const p = payload;
        const files =
            p && p.kind === "files" ? (p.files as File[]) : ([] as File[]);
        const rows = shareFileRows(files);
        const built: PreviewRow[] = rows.map((r, i) => ({
            ...r,
            url:
                r.isImage && files[i] instanceof File
                    ? objectUrl(files[i])
                    : null,
        }));
        setPreviews(built);
        return () => {
            for (const b of built) if (b.url) URL.revokeObjectURL(b.url);
        };
    }, [payload]);

    const roomsTick = useRune(() => roomsState.roomsTick);
    const rooms = useMemo(() => {
        void roomsTick; // refresh when rooms update
        const needle = query.trim().toLocaleLowerCase();
        const ordered = sortRoomsByTag(
            getRooms().filter((room) => !room.isSpaceRoom()),
            (room) => getRoomTags(room.roomId),
        );
        return ordered.filter(
            (room) =>
                !needle ||
                getRoomDisplayName(room).toLocaleLowerCase().includes(needle) ||
                room.roomId.toLocaleLowerCase().includes(needle),
        );
    }, [roomsTick, query]);

    // Nothing to send: a text share whose caption was cleared. Send would
    // close the sheet with no message, so it stays disabled instead.
    const empty = !caption.trim() && previews.length === 0;

    function submit() {
        if (!selectedRoomId || empty) return;
        void deliverShareToRoom(selectedRoomId, {
            caption: caption.trim() ? caption : "",
            send: ONE_STEP_SEND,
        }).catch((err) => console.error("Share delivery failed:", err));
    }

    // The touch page's focus trap: its Escape, as Android's back button.
    const touchPage = !!payload && isTouchscreen;
    useEffect(() => {
        if (!touchPage) return;
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                clearShare();
                return true;
            },
        );
        return () => subscription.remove();
    }, [touchPage]);

    const fileList = () => (
        <>
            {previews.length > 0 && (
                <ScrollView
                    className="max-h-40 flex-grow-0 border-b border-discord-divider"
                    contentContainerClassName="flex-col gap-2 px-4 py-3"
                >
                    {previews.map((row, i) => (
                        <View key={i} className="flex-row items-center gap-3">
                            {row.isImage && row.url ? (
                                <Image
                                    source={mediaSource(row.url)}
                                    contentFit="cover"
                                    className="h-10 w-10 flex-shrink-0 rounded"
                                />
                            ) : (
                                <View className="flex-row h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-discord-backgroundTertiary">
                                    {row.isImage ? (
                                        <ImageIcon
                                            size={18}
                                            className="text-discord-textMuted"
                                        />
                                    ) : (
                                        <FileText
                                            size={18}
                                            className="text-discord-textMuted"
                                        />
                                    )}
                                </View>
                            )}
                            <View className="min-w-0 flex-1">
                                <Text
                                    numberOfLines={1}
                                    className="text-sm text-discord-textPrimary"
                                >
                                    {row.name}
                                </Text>
                                {row.sizeLabel ? (
                                    <Text className="text-xs text-discord-textMuted">
                                        {row.sizeLabel}
                                    </Text>
                                ) : null}
                            </View>
                        </View>
                    ))}
                </ScrollView>
            )}
            {payload?.droppedFiles && payload.droppedFiles > 0 ? (
                <View
                    role="status"
                    className="border-b border-discord-divider px-4 py-3"
                >
                    <Text className="text-sm text-discord-textMuted">
                        {t("shareTargetSheet.fileSWerenTAddedShares", {
                            droppedFiles: payload.droppedFiles,
                            SHARE_MAX_FILES,
                            value: SHARE_MAX_FILE_BYTES / 1024 / 1024,
                            value2: SHARE_MAX_TOTAL_BYTES / 1024 / 1024,
                        })}
                    </Text>
                </View>
            ) : null}
        </>
    );

    const captionField = () => (
        <View className="border-b border-discord-divider px-4 py-3">
            {/* Zami: `rows="2"`: two 20px lines and the padding. */}
            <TextInput
                multiline
                value={caption}
                onChangeText={setCaption}
                placeholder={t("shareTargetSheet.addAMessage")}
                placeholderTextColorClassName="accent-discord-textMuted"
                accessibilityLabel={t("shareTargetSheet.addAMessage")}
                textAlignVertical="top"
                className="w-full min-h-[56px] rounded bg-discord-backgroundTertiary px-3 py-2 text-sm text-discord-textPrimary focus:ring-1 focus:ring-discord-accent"
            />
        </View>
    );

    const roomSearch = () => (
        <View className="px-3 pb-2 pt-3">
            <View className="relative justify-center">
                <View pointerEvents="none" className="absolute start-3 z-10">
                    <Search size={16} className="text-discord-textMuted" />
                </View>
                <TextInput
                    autoFocus
                    value={query}
                    onChangeText={setQuery}
                    placeholder={t("shareTargetSheet.searchRooms")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityLabel={t("shareTargetSheet.searchRooms")}
                    autoCorrect={false}
                    returnKeyType="search"
                    className="w-full rounded bg-discord-backgroundTertiary py-2 ps-9 pe-3 text-sm text-discord-textPrimary focus:ring-1 focus:ring-discord-accent"
                />
            </View>
        </View>
    );

    // Zami: `min-h-0 flex-1` → `grow shrink`: the list fills the touch page, and
    // in the dialog it is sized by its rooms up to what the panel leaves, as
    // `flex-1` is on the web inside a panel sized by its content.
    const roomList = () => (
        <FlatList
            data={rooms}
            keyExtractor={(room) => room.roomId}
            keyboardShouldPersistTaps="handled"
            className="min-h-0 grow shrink"
            contentContainerClassName="px-2 pb-2"
            renderItem={({ item: room }) => (
                <Pressable
                    accessibilityRole="button"
                    onPress={() => setSelectedRoomId(room.roomId)}
                    accessibilityState={{
                        selected: selectedRoomId === room.roomId,
                    }}
                    // Zami: the selected room's `ring-1` → a 1px border (in
                    // every row, so selecting one doesn't shift it).
                    className={`flex-row w-full items-center gap-3 rounded px-2 py-2 transition-colors hover:bg-discord-messageHover active:bg-discord-messageHover ${
                        selectedRoomId === room.roomId
                            ? "bg-discord-messageHover border border-discord-accent"
                            : "border border-transparent"
                    }`}
                >
                    <Avatar
                        src={getRoomAvatar(room)}
                        name={getRoomDisplayName(room)}
                        id={room.roomId}
                        size={36}
                    />
                    <Text
                        numberOfLines={1}
                        className="min-w-0 flex-shrink text-sm font-medium text-discord-textPrimary"
                    >
                        {getRoomDisplayName(room)}
                    </Text>
                </Pressable>
            )}
            ListEmptyComponent={
                <Text className="px-3 py-8 text-center text-sm text-discord-textMuted">
                    {t("shareTargetSheet.noJoinedRoomsFound")}
                </Text>
            }
        />
    );

    const footer = () => (
        <View className="flex-row justify-end gap-2 border-t border-discord-divider p-3">
            <Pressable
                accessibilityRole="button"
                onPress={clearShare}
                className="px-3 py-2"
            >
                <Text className="text-sm font-semibold text-discord-textMuted hover:text-discord-textPrimary">
                    {t("common.cancel")}
                </Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                onPress={submit}
                disabled={!selectedRoomId || empty}
                accessibilityState={{ disabled: !selectedRoomId || empty }}
                className={`rounded bg-discord-accent px-4 py-2 transition-colors hover:bg-discord-accentHover ${
                    !selectedRoomId || empty ? "opacity-50" : ""
                }`}
            >
                <Text className="text-sm font-semibold text-white">
                    {t("shareTargetSheet.send")}
                </Text>
            </Pressable>
        </View>
    );

    if (!payload) return null;
    if (isTouchscreen) {
        return (
            <Portal>
                {/* Zami: the page spans the safe area, and the keyboard view keeps
                    the footer above the on-screen keyboard. */}
                <KeyboardAvoidingView
                    behavior="padding"
                    // `z-[90]`.
                    style={[StyleSheet.absoluteFill, { zIndex: 90 }]}
                >
                    <View
                        className="flex-1 flex-col bg-discord-background"
                        style={{
                            paddingTop: insets.top,
                            paddingBottom: insets.bottom,
                        }}
                        role="dialog"
                        accessibilityViewIsModal
                        aria-labelledby="share-target-title"
                        onAccessibilityEscape={clearShare}
                    >
                        <View className="flex-row items-center gap-2 border-b border-discord-divider px-2 py-3">
                            <Pressable
                                accessibilityRole="button"
                                onPress={clearShare}
                                className="rounded p-1.5 hover:bg-discord-messageHover"
                                accessibilityLabel={t("common.close")}
                            >
                                {/* Zami: `mirror:-scale-x-100`, from I18nManager. */}
                                <ArrowLeft
                                    size={20}
                                    className="text-discord-textMuted hover:text-discord-textPrimary"
                                    style={
                                        I18nManager.isRTL
                                            ? { transform: [{ scaleX: -1 }] }
                                            : undefined
                                    }
                                />
                            </Pressable>
                            <Text
                                nativeID="share-target-title"
                                role="heading"
                                className="text-base font-semibold text-discord-textPrimary"
                            >
                                {t("shareTargetSheet.shareToARoom")}
                            </Text>
                        </View>
                        {fileList()}
                        {captionField()}
                        {roomSearch()}
                        {roomList()}
                        {footer()}
                    </View>
                </KeyboardAvoidingView>
            </Portal>
        );
    }
    return (
        <Portal>
            {/* Zami: `max-h-[min(680px,90dvh)]` → the panel's `max-h-[90%]` (of the
                layer, which the keyboard shrinks) around a `max-h-[680px]`
                column: React Native has no `min()`. */}
            <ModalDialog
                onClose={clearShare}
                labelledBy="share-target-title"
                layerClass="z-[90] flex items-center justify-center p-3"
                panelClass="relative flex max-h-[90%] w-full max-w-md flex-col overflow-hidden rounded-lg border border-discord-divider bg-discord-backgroundSecondary shadow-2xl"
            >
                <View className="max-h-[680px] shrink flex-col">
                    <View className="flex-row items-center justify-between border-b border-discord-divider px-4 py-3">
                        <Text
                            nativeID="share-target-title"
                            role="heading"
                            className="text-base font-semibold text-discord-textPrimary"
                        >
                            {t("shareTargetSheet.shareToARoom")}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            onPress={clearShare}
                            className="ms-2 rounded p-1.5 hover:bg-discord-messageHover"
                            accessibilityLabel={t("common.close")}
                        >
                            <X
                                size={20}
                                className="text-discord-textMuted hover:text-discord-textPrimary"
                            />
                        </Pressable>
                    </View>
                    {fileList()}
                    {captionField()}
                    {roomSearch()}
                    {roomList()}
                    {footer()}
                </View>
            </ModalDialog>
        </Portal>
    );
}
