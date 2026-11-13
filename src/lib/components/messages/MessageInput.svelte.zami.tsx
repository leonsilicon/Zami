// The message composer.
// Zami: upstream edits a contenteditable over a plain-text model (the text and
// a caret), which it redraws from that model with its tokens decorated
// (decorateComposerText). Here a multiline TextInput holds the same model: its
// children are the model's text, split into nested `Text`s styled as those
// decorations (see composerRuns), and the caret is tracked from what the
// TextInput reports and placed with setSelection.
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useVideoPlayer, VideoView } from "expo-video";
import {
    memo,
    useCallback,
    useDeferredValue,
    useEffect,
    useEffectEvent,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type Ref,
    type RefObject,
} from "react";
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
    type HostInstance,
    type TextInputInstance,
    type TextInputProps,
} from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
    anchorElement,
    Image,
    mediaSource,
    pickedFile,
    Portal,
    Spin,
    SvgIcon,
} from "@-/com.leonsilicon.zami.rn";
import {
    isModifierHeld,
    useHardwareKeyboard,
    useInputKeys,
} from "@-/com.leonsilicon.zami.browser";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import {
    createValueStore,
    MemberIndex,
    useValueStore,
    type ValueStore,
} from "@-/com.leonsilicon.zami.timeline";
import { t } from "$lib/i18n";
import { keybindsState, pickerForKey } from "$lib/stores/keybinds.svelte";
import type { MatrixEvent, Room, RoomMember } from "matrix-js-sdk";
import {
    sendTextMessage,
    sendFormattedMessage,
    sendSticker,
    sendFile,
    sendExistingMedia,
    getMediaUploadSizeLimit,
    getMemberName,
    getMemberAvatar,
    getRoomMembers,
    loadRoomMembersIfNeeded,
    getCustomEmojis,
    mxcToHttp,
    sendTyping,
    onTypingEvent,
    getOwnUserId,
    sendEmote,
    joinRoomByAlias,
    leaveRoom,
    inviteUser,
    setRoomTopic,
    kickUser,
    banUser,
    setOwnDisplayName,
    setUserPowerLevel,
    getOwnServerName,
    canSendMessages,
    getMyPowerLevel,
    getRoomPowerLevels,
    sendThreadReply,
    type CustomEmoji,
    type CustomSticker,
    type MediaCaption,
    type MediaRelation,
} from "$lib/matrix/client";
import { reusableMediaOfFile } from "$lib/matrix/favouriteFile";
import { sendEventContent } from "$lib/matrix/pluginHost";
import {
    buildFormattedBody as buildBody,
    mentionsFromFormatted,
} from "$lib/utils/messageBody";
import { buildReplyContent } from "$lib/utils/replyContent";
import {
    buildTextContent,
    buildFormattedContent,
} from "$lib/utils/messageContent";
import { composerInsertText } from "$lib/utils/composerInsert";
import {
    applyTextTransforms,
    applyContentTransforms,
} from "$lib/plugins/outgoingTransforms";
import { hostBridge } from "$lib/plugins/hostBridge";
import { shouldQueueSend } from "$lib/utils/sendGating";
import { queueMessage } from "$lib/stores/outbox.svelte";
import { textSymbolPresentation } from "$lib/utils/twemoji";
import {
    convertTrailingShortcode,
    replaceEmojiShortcodes,
} from "$lib/data/emojiShortcodes";
import EmojiPicker from "$lib/components/ui/EmojiPicker.svelte";
import EmojiSuggestions from "$lib/components/messages/EmojiSuggestions.svelte";
import { decorateComposerText } from "$lib/utils/composerDecorate";
import { diffCaret } from "$lib/utils/textUndo";
import {
    applyEmojiCandidate,
    findEmojiQuery,
    rankEmojiCandidates,
    type EmojiCandidate,
} from "$lib/utils/emojiAutocomplete";
import StickerPicker from "$lib/components/ui/StickerPicker.svelte";
import GifPicker from "$lib/components/ui/GifPicker.svelte";
import PickerDock, {
    markPickerSwitch,
} from "$lib/components/messages/PickerDock.svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import {
    interfaceState,
    openModal,
    closeModal,
    openComposerPicker,
    openComposerActions,
    releaseComposerActions,
} from "$lib/stores/interface.svelte";
import { pluginRegistry } from "$lib/stores/plugins.svelte";
import ComposerActionsMenu from "$lib/components/messages/ComposerActionsMenu.svelte";
import RenameAttachmentDialog from "$lib/components/messages/RenameAttachmentDialog.svelte";
import VoiceRecorder from "$lib/components/messages/VoiceRecorder.svelte";
import OutboxStrip from "$lib/components/messages/OutboxStrip.svelte";
import { openCreatePollDialog } from "$lib/stores/pollDialog.svelte";
import { openGameInviteDialog } from "$lib/stores/gameInviteDialog.svelte";
import { openShareLocationDialog } from "$lib/stores/locationDialog.svelte";
import {
    getDraft,
    setDraft,
    clearDraft,
    registerLiveComposer,
    registerDraftFlusher,
} from "$lib/stores/composerDrafts.svelte";
import {
    getFileQueue,
    addQueuedFile,
    removeQueuedFile,
    renameQueuedFile,
    markQueuedFilesDirect,
    setQueuedFileDirect,
    dropQueuedFilePreview,
    previewUrlFor,
    clearFileQueue,
    type QueuedFile,
} from "$lib/stores/composerFileQueue.svelte";
import { sendQueuedFiles } from "$lib/utils/queuedFileSend";
import { filesToRestoreAfterSend } from "$lib/utils/composerFileRestore";
import {
    shouldClearComposerAfterSend,
    shouldClearStoredDraft,
} from "$lib/utils/composerClear";
import { insertMention, appendMention } from "$lib/utils/mentionInsert";
import {
    parseSlashCommand,
    matchSlashCommands,
    usageFor,
    parseNickArg,
    parseOpArg,
    parseDeopArg,
    resolveMentionTokens,
    pluginCommandToSlash,
    type SlashCommand,
} from "$lib/utils/slashCommands";
import { parseSedCommand, type SedCommand } from "$lib/utils/sedEdit";
import type { SedEditResult } from "$lib/matrix/editMessage";
import { pluginComposerButtons } from "$lib/utils/pluginComposer";
import { resolveUserArg } from "$lib/utils/userSearch";
import {
    dismissToast,
    showErrorToast,
    showToast,
    toastsState,
} from "$lib/stores/toasts.svelte";
import { offerFile } from "$lib/matrix/fileTransfer";
import { isFileTooLargeError } from "$lib/utils/uploadLimits";
import { discardRoomSession, prepareToSend } from "$lib/matrix/crypto";
import { matrixErrorMessage } from "$lib/utils/knock";
import {
    Loader2,
    Plus,
    ImagePlay,
    Sticker,
    Smile,
    SendHorizontal,
} from "lucide-svelte";

/** Zami: what `bind:this` gave upstream's parents (`messageInputEl?.addFiles(…)`), through `ref`. */
export interface MessageInputHandle {
    focus: () => void;
    addFiles: (files: File[]) => void;
}

/** Zami: the timeline's list as the composer uses `scrollEl`: a FlatList or
 *  ScrollView ref, snapped to its newest message after a send. */
export interface TimelineScroller {
    scrollToEnd: (options?: { animated?: boolean }) => void;
}

interface Props {
    roomId: string;
    roomName: string;
    room?: Room;
    disabled?: boolean;
    replyToEvent?: MatrixEvent | null;
    onCancelReply?: () => void;
    onRequestEditLast?: () => void;
    /** `s/old/new/`: apply it to the user's last message here (the
     *  caller knows which messages that means). */
    onSedEdit?: (cmd: SedCommand) => Promise<SedEditResult>;
    /** "Create thread" (+ menu): the next sent message becomes a thread
     *  root and this fires with its event id so the caller can open it. */
    onThreadCreated?: (rootEventId: string) => void;
    /** Zami: the timeline's list (`scrollEl.scrollTop = scrollEl.scrollHeight`
     *  → `scrollToEnd`). */
    scrollEl?: TimelineScroller | null;
    /** Leave the timeline where it is after a send. Set while viewing a
     *  jumped-to context window: snapping to its bottom paged it forward
     *  all the way to live. */
    keepScrollOnSend?: boolean;
    threadRootId?: string | null;
    composerKey?: string;
    /** Bound out to the parent: true while a mention/emoji/slash suggestion
     *  list is showing, so it can hide the "jump to present" pill under it
     *  (Discord-style). */
    autocompleteOpen?: boolean;
    /** Zami: the write half of `bind:autocompleteOpen`. */
    onAutocompleteOpenChange?: (open: boolean) => void;
    ref?: Ref<MessageInputHandle>;
}

/** Zami: a `$state` that callbacks outliving a render (store hooks, sends
 *  awaiting the server) read as it is now, as Svelte's do. */
function useLiveState<T>(initial: T): [T, (next: T) => void, RefObject<T>] {
    const [value, setValue] = useState(initial);
    const ref = useRef(value);
    const set = useCallback((next: T) => {
        ref.current = next;
        setValue(next);
    }, []);
    return [value, set, ref];
}

// Zami: a caret the model just placed is reported back by the TextInput a little
// later, after its text was redrawn (keeping the caret's distance from the end,
// before setSelection moves it). Reports that soon after a programmatic change
// are those, not the user moving the caret.
const MODEL_SETTLE_MS = 250;

/** Zami: how long the text a Tab typed takes to arrive (see tabPick). */
const TAB_SETTLE_MS = 300;

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

/** Zami: `.composer-editor`'s decoration styles (app.css), by the class or tag
 *  decorateComposerText wraps a token in. Not ported: the padding and rounded
 *  corners of mention and spoiler pills, which nested text can't have. */
const DECORATIONS: Record<string, string> = {
    "composer-mention":
        "text-[rgb(var(--discord-accent-rgb)_/_1)] bg-[rgb(var(--discord-accent-rgb)_/_0.18)] font-medium",
    "composer-custom-emoji": "text-discord-textPrimary",
    "composer-link": "text-[rgb(var(--discord-accent-rgb)_/_1)] underline",
    "composer-spoiler": "text-transparent bg-[var(--discord-spoiler-bg)]",
    code: "bg-discord-backgroundTertiary text-[14px]",
    del: "line-through",
    strong: "font-bold",
    em: "italic",
    u: "underline",
};

interface ComposerRun {
    text: string;
    /** The classes and tags around it, outermost first. */
    marks: string[];
}

const ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
};
const HTML_TOKEN = /<(\/?)([a-z]+)(?:\s+class="([^"]*)")?[^>]*>|([^<]+)/g;

/**
 * Zami: decorateComposerText's HTML as runs of the model's text, each with the
 * decorations around it, for the TextInput's nested `Text`s. Its text equals
 * the model, as the contenteditable's does (see composerDom): `<br>` is a line
 * break, the placeholder `<br>` after a trailing one is dropped, and a custom
 * emote's `<img>` is left out (not ported: the image; its `:shortcode:` shows).
 * Anything that doesn't add up to the model falls back to it undecorated.
 */
function composerRuns(html: string, plain: string): ComposerRun[] {
    const runs: ComposerRun[] = [];
    const stack: string[] = [];
    const push = (text: string) => {
        const last = runs.at(-1);
        if (last && last.marks.join(" ") === stack.join(" ")) last.text += text;
        else runs.push({ text, marks: [...stack] });
    };
    for (const [, closing, tag, cls, text] of html.matchAll(HTML_TOKEN)) {
        if (text !== undefined)
            push(
                text.replace(
                    /&(amp|lt|gt|quot);/g,
                    (_, e: string) => ENTITIES[e],
                ),
            );
        else if (tag === "br") push("\n");
        else if (tag === "img") continue;
        else if (closing) stack.pop();
        else stack.push(tag === "span" ? (cls ?? "") : tag);
    }
    const last = runs.at(-1);
    if (plain.endsWith("\n") && last?.text.endsWith("\n")) {
        last.text = last.text.slice(0, -1);
        if (!last.text) runs.pop();
    }
    return runs.map((run) => run.text).join("") === plain
        ? runs
        : [{ text: plain, marks: [] }];
}

/**
 * Zami: where the caret is once the TextInput replaced `prev` with `next`:
 * onChangeText reports the text before onSelectionChange reports the caret.
 * An edit of the last reported selection leaves it after what was typed or
 * pasted there; anything else (autocorrect, or Android reporting the
 * selection first) takes the end of the changed span.
 */
function caretAfterEdit(
    prev: string,
    next: string,
    selection: { start: number; end: number },
): number {
    const { start, end } = selection;
    const inserted = next.length - (prev.length - (end - start));
    if (
        inserted >= 0 &&
        next.slice(0, start) === prev.slice(0, start) &&
        next.slice(start + inserted) === prev.slice(end)
    )
        return start + inserted;
    return diffCaret(prev, next);
}

// Zami: the composer's `<input type="file">`s, through Expo's pickers. Each
// resolves to what the input's `files` would hold: the picked files as `File`s
// (pickedFile), none when the picker is cancelled.

/** `<input type="file" multiple>`: any files, from the document picker. */
async function pickFiles(): Promise<File[]> {
    const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
    });
    if (result.canceled) return [];
    return Promise.all(result.assets.map((asset) => pickedFile(asset)));
}

/** `accept="image/*,video/*" multiple`: the photo library. */
async function pickPhotos(): Promise<File[]> {
    const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        quality: 1,
    });
    if (result.canceled) return [];
    return Promise.all(result.assets.map((asset) => pickedFile(asset)));
}

/** `accept="image/*,video/*" capture="environment"`: the back camera. */
async function takePhoto(): Promise<File[]> {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return [];
    const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images", "videos"],
        cameraType: ImagePicker.CameraType.back,
        quality: 1,
    });
    if (result.canceled) return [];
    return Promise.all(result.assets.map((asset) => pickedFile(asset)));
}

/**
 * Zami: a queued video's thumbnail, upstream's
 * `<video preload="metadata" muted playsinline>`: expo-video's player, paused
 * on the first frame. A file with no picture to show (an unsupported codec,
 * audio-only webm) falls back to the icon, as on an error or a zero
 * `videoWidth` upstream.
 */
function QueuedVideoPreview({
    url,
    onNoPicture,
}: {
    url: string;
    onNoPicture: () => void;
}) {
    const player = useVideoPlayer(url, (p) => {
        p.muted = true;
    });
    const drop = useEffectEvent(onNoPicture);
    useEffect(() => {
        const loaded = player.addListener("sourceLoad", (e) => {
            if (e.availableVideoTracks.length === 0) drop();
        });
        const status = player.addListener("statusChange", (e) => {
            if (e.status === "error") drop();
        });
        return () => {
            loaded.remove();
            status.remove();
        };
    }, [player]);
    return (
        <VideoView
            player={player}
            nativeControls={false}
            contentFit="cover"
            allowsPictureInPicture={false}
            pointerEvents="none"
            style={styles.fill}
        />
    );
}

// Zami: what keeps typing from re-rendering this whole component (B5).
// The draft lives in a value store that only the editor (ComposerEditor)
// reads as it changes, and each suggestion list's query in one only that list
// (SuggestionsView) reads; the composer re-renders only when the draft turns
// empty or not, or a list opens or closes.

/** Zami: `useCallback` for callbacks whose closures change every render: one
 *  identity, always calling the latest, so the memo'd editor skips renders. */
function useStableCallback<A extends unknown[], R>(
    fn: (...args: A) => R,
): (...args: A) => R {
    const latest = useRef(fn);
    useLayoutEffect(() => {
        latest.current = fn;
    });
    return useCallback((...args: A) => latest.current(...args), []);
}

/** Zami: an autocomplete list's query (null: closed) and highlighted row. */
interface SuggestionState {
    query: string | null;
    selected: number;
}
const SUGGESTIONS_CLOSED: SuggestionState = { query: null, selected: 0 };

/** Zami: an autocomplete list (see useSuggestions). */
interface Suggestions<C> {
    store: ValueStore<SuggestionState>;
    /** A query's candidates, remembered for the latest query. */
    candidatesOf: (query: string | null) => C[];
    /** Whether the list shows (for rendering). */
    open: boolean;
    query: () => string | null;
    setQuery: (query: string | null) => void;
    /** Whether the list shows now (for handlers). */
    isOpen: () => boolean;
    candidates: () => C[];
    selectedIndex: () => number;
    setSelected: (index: number) => void;
    /** Move the highlight, wrapping around. */
    move: (by: number) => void;
}

/**
 * Zami: an autocomplete list held outside React state, so typing its query
 * re-renders only the list, not the composer. `of` turns a query into the
 * list's candidates. As upstream, a highlighted row past the end of a list
 * that shrank is the first.
 */
function useSuggestions<C>(of: (query: string) => C[]): Suggestions<C> {
    const [store] = useState(() => createValueStore(SUGGESTIONS_CLOSED));
    const memo = useRef<{
        of: (query: string) => C[];
        query: string;
        candidates: C[];
    } | null>(null);
    const candidatesOf = useCallback(
        (query: string | null): C[] => {
            if (query === null) return [];
            const last = memo.current;
            if (last && last.of === of && last.query === query)
                return last.candidates;
            const candidates = of(query);
            memo.current = { of, query, candidates };
            return candidates;
        },
        [of],
    );
    const open = useValueStore(
        store,
        useCallback(
            (state: SuggestionState) => candidatesOf(state.query).length > 0,
            [candidatesOf],
        ),
    );
    return useMemo(() => {
        const candidates = () => candidatesOf(store.get().query);
        const selectedIndex = () => {
            const { selected } = store.get();
            return selected < candidates().length ? selected : 0;
        };
        return {
            store,
            candidatesOf,
            open,
            query: () => store.get().query,
            setQuery: (query) => {
                const state = store.get();
                if (state.query === query) return;
                // As upstream's clamp: a list that shrank past the
                // highlighted row starts over at the first.
                const selected =
                    state.selected < candidatesOf(query).length
                        ? state.selected
                        : 0;
                store.set({ query, selected });
            },
            isOpen: () => candidates().length > 0,
            candidates,
            selectedIndex,
            setSelected: (selected) => {
                const state = store.get();
                if (state.selected !== selected)
                    store.set({ query: state.query, selected });
            },
            move: (by) => {
                const n = candidates().length;
                if (n === 0) return;
                const selected = (selectedIndex() + by + n) % n;
                store.set({ query: store.get().query, selected });
            },
        };
    }, [store, candidatesOf, open]);
}

const sameSuggestionState = (a: SuggestionState, b: SuggestionState) =>
    a.query === b.query && a.selected === b.selected;
const wholeState = (state: SuggestionState) => state;

/**
 * Zami: a suggestion list as its query changes (upstream's `{#if query !==
 * null && candidates.length > 0}` around it). A new query's candidates are
 * worked out at a lower priority than the typing (useDeferredValue); a closed
 * list hides at once.
 */
function SuggestionsView<C>({
    suggestions,
    children,
}: {
    suggestions: Suggestions<C>;
    children: (candidates: C[], selectedIdx: number) => ReactNode;
}) {
    const state = useValueStore(
        suggestions.store,
        wholeState,
        sameSuggestionState,
    );
    const deferred = useDeferredValue(state.query);
    const query = state.query === null ? null : (deferred ?? state.query);
    const candidates = suggestions.candidatesOf(query);
    if (candidates.length === 0) return null;
    return (
        <>
            {children(
                candidates,
                state.selected < candidates.length ? state.selected : 0,
            )}
        </>
    );
}

const wholeText = (text: string) => text;

/**
 * Zami: the composer's TextInput and its decorated text (composerRuns, from
 * `decorate`): the only part of the composer that re-renders per keystroke.
 * Memo'd: the composer passes stable callbacks. A member's name changing
 * (roomsTick) can change which `@words` are mentions.
 */
const ComposerEditor = memo(function ComposerEditor({
    textStore,
    decorate,
    ref,
    ...input
}: Omit<TextInputProps, "children"> & {
    textStore: ValueStore<string>;
    decorate: (plain: string) => string;
    ref: Ref<TextInputInstance>;
}) {
    const text = useValueStore(textStore, wholeText);
    const roomsTick = useRune(() => roomsState.roomsTick);
    const runs = useMemo(
        () => (void roomsTick, composerRuns(decorate(text), text)),
        [text, decorate, roomsTick],
    );
    return (
        <TextInput ref={ref} {...input}>
            {text !== "" ? (
                <Text>
                    {runs.map((run, i) =>
                        run.marks.length === 0 ? (
                            run.text
                        ) : (
                            <Text
                                key={i}
                                className={run.marks
                                    .map((mark) => DECORATIONS[mark] ?? "")
                                    .join(" ")}
                                style={
                                    run.marks.includes("code")
                                        ? styles.mono
                                        : undefined
                                }
                            >
                                {run.text}
                            </Text>
                        ),
                    )}
                </Text>
            ) : null}
        </TextInput>
    );
});

/** Zami: whether two lists of custom emotes are the same emotes. */
function sameCustomEmojis(a: CustomEmoji[], b: CustomEmoji[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (e, i) =>
                e.shortcode === b[i].shortcode &&
                e.mxcUrl === b[i].mxcUrl &&
                e.url === b[i].url &&
                e.source === b[i].source &&
                e.body === b[i].body,
        )
    );
}

const isEmptyText = (text: string) => text === "";
const isBlankText = (text: string) => text.trim().length === 0;

export default function MessageInput({
    roomId,
    roomName,
    room,
    disabled: disabledProp = false,
    replyToEvent = null,
    onCancelReply,
    onRequestEditLast,
    onSedEdit,
    onThreadCreated,
    scrollEl,
    keepScrollOnSend = false,
    threadRootId = null,
    composerKey,
    autocompleteOpen = false,
    onAutocompleteOpenChange,
    ref,
}: Props) {
    const isMobile = useRune(() => interfaceState.isMobile);
    const isTouchscreen = useRune(() => interfaceState.isTouchscreen);
    // Zami: whether the user types on a hardware keyboard, whose Enter sends.
    const hardwareKeyboard = useHardwareKeyboard();
    const spellCheckEnabled = useRune(() => settingsState.spellCheckEnabled);
    // Zami: read where it's used (the reply target's name, the editor's
    // mentions), so a sync doesn't re-render the whole composer.
    const windowSize = useWindowDimensions();
    const insets = useSafeAreaInsets();

    const effComposerKey = composerKey ?? roomId;
    const isThread = threadRootId != null;

    // Zami: the props as they are now, for the callbacks that outlive a render
    // (a send awaiting its upload, the hooks the stores call back).
    const live = useRef({
        room,
        effComposerKey,
        replyToEvent,
        onCancelReply,
        scrollEl,
        keepScrollOnSend,
    });
    useLayoutEffect(() => {
        live.current = {
            room,
            effComposerKey,
            replyToEvent,
            onCancelReply,
            scrollEl,
            keepScrollOnSend,
        };
    });

    // Zami: upstream awaits `tick()` before each call, so the input has shrunk
    // and the list has rendered the send: here, the next frame.
    function snapTimelineToBottom() {
        requestAnimationFrame(() => {
            const { scrollEl, keepScrollOnSend } = live.current;
            if (scrollEl && !keepScrollOnSend)
                scrollEl.scrollToEnd({ animated: false });
        });
    }

    // Zami: the draft, outside React state (see ComposerEditor): this
    // component reads only whether it's empty or blank.
    const [textStore] = useState(() => createValueStore(""));
    const textRef = useMemo(
        () => ({
            get current() {
                return textStore.get();
            },
        }),
        [textStore],
    );
    const setText = textStore.set;
    const textEmpty = useValueStore(textStore, isEmptyText);
    const textBlank = useValueStore(textStore, isBlankText);
    const [isSending, setIsSending, isSendingRef] = useLiveState(false);
    // In-flight attachment send, scoped to the room the send targeted so a
    // room switch mid-upload doesn't show room A's "sending" note in room B.
    const [sendingFileCount, setSendingFileCount] = useState(0);
    // Percent of the batch's bytes sent; null before the first progress event.
    // Shows whether a slow send is the upload or what follows. Files upload in
    // parallel, so this sums every file, each counted at its own size until
    // its upload reports a real total.
    const [uploadPercent, setUploadPercent] = useState<number | null>(null);
    const uploadLoaded = useRef<number[]>([]);
    const uploadTotal = useRef<number[]>([]);
    const onUploadProgress = (i: number) => (loaded: number, total: number) => {
        if (total <= 0) return;
        uploadLoaded.current[i] = loaded;
        uploadTotal.current[i] = total;
        const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);
        const all = sum(uploadTotal.current);
        if (all > 0)
            setUploadPercent(
                Math.floor((sum(uploadLoaded.current) / all) * 100),
            );
    };
    const [sendingRoomId, setSendingRoomId] = useState<string | null>(null);
    // Queued attachments live in a per-room store, not here: this component
    // stays mounted across room switches, so a local queue followed the user
    // into the next room and Send posted the file there (audit UX-01).
    const fileQueue = useRune(
        () => getFileQueue(effComposerKey),
        [effComposerKey],
    );
    const textareaEl = useRef<TextInputInstance>(null);
    // Zami: the selection the TextInput last reported (or the model placed),
    // which upstream reads from the DOM selection (caretOffset, selectedLength).
    const selectionRef = useRef({ start: 0, end: 0 });
    const modelSetAt = useRef(0);
    const [focused, setFocused] = useState(false);

    // Voice messages: only offer the recorder when the browser can actually
    // record audio (feature-detected once — codec support doesn't change).
    // Zami: VoiceRecorder records with expo-audio, which every device here
    // can, where pickAudioMimeType() finds no MediaRecorder.
    const voiceSupported = true;
    const [voiceRecorderOpen, setVoiceRecorderOpen] = useState(false);

    // "+ → Create thread": armed until the next plain message is sent, which
    // becomes the thread root (a Matrix thread needs a root event, so
    // "create" means "start a thread on what I'm about to say").
    const [createThreadArmed, setCreateThreadArmed, createThreadArmedRef] =
        useLiveState(false);

    // Expose a focus hook so the global "type to focus" shortcut (+page) can
    // focus this composer. Only the main composer claims the global hook.
    useEffect(() => {
        if (!isThread) {
            // Zami: AppShell's type-to-focus passes the key it saw: with
            // nothing focused it typed nothing, so the composer types it.
            interfaceState.focusComposer = (typed?: string) => {
                textareaEl.current?.focus();
                if (!typed) return;
                const prev = textRef.current;
                const { start, end } = selectionRef.current;
                setComposerText(
                    prev.slice(0, start) + typed + prev.slice(end),
                    start + typed.length,
                );
            };
            interfaceState.composerUpload = () =>
                chooseFiles(pickFiles, onFileSelected);
            return () => {
                if (interfaceState.focusComposer)
                    interfaceState.focusComposer = null;
                interfaceState.composerUpload = null;
            };
        }
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- the callbacks read the live model.
    }, [isThread]);

    // Background text restores (a failed notification quick reply) reach the
    // composer that is open for this draft key, main or thread. Same shape as
    // the insertText hook below: `text` is read inside the callback, so the
    // effect depends only on the key.
    useEffect(() => {
        const key = effComposerKey;
        return registerLiveComposer(key, (t) =>
            setComposerText(composerInsertText(textRef.current, t)),
        );
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- the callback reads the live model.
    }, [effComposerKey]);

    // Lets a reload the app triggers itself keep what's typed here
    // (backgroundRelease.ts). `text` is read when flushed, not now.
    useEffect(() => {
        const key = effComposerKey;
        return registerDraftFlusher(key, () =>
            setDraft(key, textRef.current, pendingMentionsRef.current),
        );
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- the callback reads the live model.
    }, [effComposerKey]);

    // Images committed by the Android keyboard (Gboard stickers, Emoji
    // Kitchen) arrive through AppShell's __matrixKeyboardContent bridge. Only
    // the composer that has focus takes them.
    // Zami: not ported: that bridge (`matrix-keyboard-content` and
    // `MatrixKeyboard.setComposerFocused`) is the Android WebView's; a
    // TextInput takes no images from the keyboard.

    // Plugin composer.insertText → append to THIS (main) composer's text.
    // Only the main composer claims the global slot (mirrors focusComposer).
    // roomId-guarded so a stale handler from a previous room drops silently.
    // `text` is read inside the handler (a user-action callback), NOT the
    // effect body, so the effect depends only on roomId.
    useEffect(() => {
        if (isThread) return;
        const rid = roomId;
        const handler = (ctx: { roomId: string; text: string }) => {
            if (ctx.roomId !== rid) return false;
            setComposerText(composerInsertText(textRef.current, ctx.text));
            textareaEl.current?.focus();
            return true;
        };
        hostBridge.insertText = handler;
        return () => {
            if (hostBridge.insertText === handler) hostBridge.insertText = null;
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- the handler reads the live model.
    }, [isThread, roomId]);

    // Plugin/call-menu insertMention → append an @mention to THIS (main) composer.
    // Same structure as insertText: main composer only, roomId-guarded, no effect
    // deps on `text`/`pendingMentions` — the handler reads+writes them.
    useEffect(() => {
        if (isThread) return;
        const rid = roomId;
        const handler = (ctx: { roomId: string; userId: string }) => {
            if (ctx.roomId !== rid) return;
            const { room } = live.current;
            const member = (room &&
                getRoomMembers(room).find((m) => m.userId === ctx.userId)) || {
                userId: ctx.userId,
                rawDisplayName: undefined,
            };
            const label = mentionLabelFor(member);
            const inserted = appendMention(textRef.current, label);
            setText(inserted.text);
            setPendingMentions(
                new Map([
                    ...pendingMentionsRef.current,
                    ["@" + label, ctx.userId],
                ]),
            );
            if (
                hostBridge.pendingMention &&
                hostBridge.pendingMention.roomId === ctx.roomId &&
                hostBridge.pendingMention.userId === ctx.userId
            ) {
                hostBridge.pendingMention = null;
            }
            renderComposer(inserted.caret);
            textareaEl.current?.focus();
        };
        hostBridge.insertMention = handler;
        // Drain a mention queued before this composer mounted (call→chat flip).
        // Deferred one tick so it runs AFTER the per-room draft-restore effect's
        // synchronous body (which sets `text = draft.text`) — otherwise draft
        // restore clobbers the just-inserted mention. Re-checked at drain time
        // so it stays idempotent (the direct-call path may have cleared it).
        const q = hostBridge.pendingMention;
        if (q && q.roomId === rid) {
            void Promise.resolve().then(() => {
                const q2 = hostBridge.pendingMention;
                if (q2 && q2.roomId === rid && q2.userId === q.userId) {
                    handler(q2);
                }
            });
        }
        return () => {
            if (hostBridge.insertMention === handler)
                hostBridge.insertMention = null;
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- the handler reads the live model.
    }, [isThread, roomId]);

    // Zami: upstream's three file inputs (any files, photos and videos, the
    // camera) and the direct-send one are Expo's pickers, opened on demand.
    // Touch web only (not the desktop app): Zam offers Camera / Photos / Files
    // itself instead of the OS chooser a bare file input would raise.
    const mobileMediaPicker =
        isTouchscreen && typeof window !== "undefined" && !window.desktop;
    // Zami: expo-image-picker opens the camera wherever an `<input
    // capture>` has none to test for.
    const cameraSupported = true;
    const [typingUsers, setTypingUsers] = useState<string[]>([]);
    const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastTypingSentAt = useRef(0);

    // Mention autocomplete
    // Zami: its query (null = picker closed) and highlighted row are the
    // `mention` suggestions below (useSuggestions).
    const mentionStart = useRef(0); // index of the @ in `text`
    // Map of displayName → userId for mentions inserted in the current message
    const [pendingMentions, setPendingMentions, pendingMentionsRef] =
        useLiveState(new Map<string, string>());
    // Bumped once the room's full member list is loaded so the autocomplete can
    // re-derive with it. With lazy-loaded members, getRoomMembers only returns
    // members already seen in sync (e.g. anyone who has spoken) — so a bridge
    // ghost or quiet member is missing from @-autocomplete until we ask the SDK
    // to load the rest. Idempotent: loadMembersIfNeeded no-ops once loaded.
    const [memberTick, setMemberTick] = useState(0);

    // Zami: the room's members with their ids and names lowercased once, for
    // the mention search and for deciding which `@words` are mentions: each
    // lowercased every member per keystroke (and per `@word`). Rebuilt when
    // the members may have changed (a sync, the full list loaded).
    const memberIndexCache = useRef<{
        room: Room;
        key: string;
        index: MemberIndex<RoomMember>;
    } | null>(null);
    const memberTickRef = useRef(memberTick);
    useLayoutEffect(() => {
        memberTickRef.current = memberTick;
    });
    function memberIndexOf(r: Room): MemberIndex<RoomMember> {
        const key = `${roomsState.roomsTick}:${memberTickRef.current}`;
        const cached = memberIndexCache.current;
        if (cached && cached.room === r && cached.key === key)
            return cached.index;
        const index = new MemberIndex(getRoomMembers(r));
        memberIndexCache.current = { room: r, key, index };
        return index;
    }

    const mention = useSuggestions(
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- memberTick re-reads the members.
        useCallback(
            (query: string) =>
                room
                    ? memberIndexOf(room).search(query, getOwnUserId(), 8)
                    : [],
            [memberTick, room],
        ),
    );
    // Zami: once when the picker opens, not per keystroke of its query.
    const mentionActive = useValueStore(
        mention.store,
        (state) => state.query !== null,
    );
    useEffect(() => {
        if (!mentionActive || !room) return;
        const r = room;
        loadRoomMembersIfNeeded(r)
            .then(() => setMemberTick((n) => n + 1))
            .catch(() => {});
    }, [mentionActive, room]);

    // Zami: getComposerText() is onChangeText's text (see syncFromEditor).

    function getCaretOffset(): number {
        return Math.min(selectionRef.current.end, textRef.current.length);
    }

    function setCaretOffset(offset: number): void {
        selectionRef.current = { start: offset, end: offset };
        const input = textareaEl.current;
        if (!input) return;
        // Creating a selection inside an unfocused contenteditable can make
        // mobile browsers focus it and reopen the soft keyboard. An unfocused
        // mobile composer does not need a programmatic caret; the user's next
        // tap will place it naturally.
        if (interfaceState.isMobile && !input.isFocused()) return;
        input.setSelection(offset, offset);
    }

    function detectMentionQuery() {
        const pos = getCaretOffset();
        const before = textRef.current.slice(0, pos);
        const match = before.match(/@(\S*)$/);
        if (match) {
            mention.setQuery(match[1]);
            mentionStart.current = pos - match[0].length;
        } else {
            mention.setQuery(null);
        }
    }

    // The text shown after "@" for a mention. Normally the display name, but if
    // another member in the room shares that display name (e.g. same username on
    // a different homeserver) it's ambiguous, so fall back to the full Matrix ID
    // — that way the inserted "@<token>" uniquely identifies the right person.
    function mentionLabelFor(member: {
        userId: string;
        rawDisplayName?: string;
    }): string {
        const { room } = live.current;
        const name = member.rawDisplayName?.trim();
        if (name && room) {
            // Zami: counted in the member index.
            const sharing = memberIndexOf(room).countSharingName(name);
            if (sharing <= 1) return name;
        } else if (name) {
            return name;
        }
        // Ambiguous (or no display name): use the MXID without its leading "@",
        // since the caller prepends one.
        return member.userId.replace(/^@/, "");
    }

    function commitMention(member: {
        userId: string;
        rawDisplayName?: string;
    }) {
        const label = mentionLabelFor(member);
        // Splice the pill in, consuming the partly-typed name and keeping exactly
        // one space before any following text (no double space mid-sentence).
        const inserted = insertMention({
            text: textRef.current,
            mentionStart: mentionStart.current,
            queryLength: mention.query()?.length ?? 0,
            label,
        });
        setText(inserted.text);
        // Record keyed by the full inserted token (incl. "@") so distinct users
        // who happen to share a display name map to distinct, unambiguous keys.
        setPendingMentions(
            new Map([
                ...pendingMentionsRef.current,
                ["@" + label, member.userId],
            ]),
        );
        mention.setQuery(null);
        renderComposer(inserted.caret);
        textareaEl.current?.focus();
    }

    // Emoji autocomplete
    // Zami: its query and highlighted row are the `emoji` suggestions.
    const emojiStart = useRef(0);

    // Zami: a new list each read; the same emotes render (and decorate) the
    // same, so only a change re-renders the composer.
    const customEmojis = useRune(
        () => getCustomEmojis(room, roomsState.activeSpaceId),
        [room],
        { isEqual: sameCustomEmojis },
    );
    const emoji = useSuggestions(
        useCallback(
            (query: string): EmojiCandidate[] =>
                rankEmojiCandidates(query, customEmojis),
            [customEmojis],
        ),
    );

    // Slash-command autocomplete
    // Zami: its query (null = popup closed) and highlighted row are the
    // `slash` suggestions below.

    // Plugin-contributed slash commands, adapted to SlashCommand and re-derived
    // whenever the registry mutates (enable/disable). void the tick so the
    // $derived tracks registry changes (see plugins.svelte.ts reactivity note).
    const pluginSlashCommands = useRune((): SlashCommand[] => {
        void pluginRegistry.tick;
        return pluginRegistry.commands.map((e) =>
            pluginCommandToSlash(e.value, e.pluginId),
        );
    });

    const pluginComposerButtonViews = useRune(() => {
        void pluginRegistry.tick;
        return pluginComposerButtons(
            pluginRegistry.composerButtons,
            roomId,
            isThread ? (threadRootId ?? null) : null,
        );
    }, [roomId, isThread, threadRootId]);
    // Zami: each plugin button's view, which its onClick gets as its anchor.
    const pluginButtonEls = useRef(new Map<number, HostInstance>());

    const slash = useSuggestions(
        useCallback(
            (query: string): SlashCommand[] =>
                matchSlashCommands(query, pluginSlashCommands),
            [pluginSlashCommands],
        ),
    );

    // True while any suggestion list (mention/emoji/slash) is actually showing.
    // Bound out so the parent hides the "jump to present" pill under it.
    const anyAutocompleteOpen = mention.open || emoji.open || slash.open;
    useEffect(() => {
        if (autocompleteOpen !== anyAutocompleteOpen)
            onAutocompleteOpenChange?.(anyAutocompleteOpen);
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- a binding: only a change is written back.
    }, [anyAutocompleteOpen]);

    function detectSlashQuery() {
        // The popup shows only while the whole composer is one "/word" token (the
        // command name, no space yet) and nothing is queued — never for a
        // mid-message slash or a pending caption.
        if (getFileQueue(live.current.effComposerKey).length > 0) {
            slash.setQuery(null);
            return;
        }
        const match = textRef.current.match(/^\/(\w*)$/);
        slash.setQuery(match ? match[1] : null);
    }

    function commitSlashCommand(command: SlashCommand) {
        setComposerText(`/${command.name} `);
        slash.setQuery(null);
        textareaEl.current?.focus();
    }

    function detectEmojiQuery() {
        const q = findEmojiQuery(textRef.current, getCaretOffset());
        emoji.setQuery(q?.query ?? null);
        emojiStart.current = q?.start ?? 0;
    }

    function commitEmoji(candidate: EmojiCandidate) {
        const query = emoji.query();
        if (query === null) return;
        const next = applyEmojiCandidate(
            textRef.current,
            { query, start: emojiStart.current },
            candidate,
        );
        setText(next.text);
        renderComposer(next.caret);
        textareaEl.current?.focus();
        emoji.setQuery(null);
    }

    // Subscribe to typing events for the current room
    useEffect(() => {
        if (!room) return;
        const currentRoom = room;
        setTypingUsers([]);
        return onTypingEvent(currentRoom, (userIds) => {
            setTypingUsers(userIds);
        });
    }, [room]);

    // Stop broadcasting our own typing when the composer unmounts or the room
    // switches. With the 25s server timeout a missed stop leaves a stale "…is
    // typing" indicator lingering for other users, so this is required.
    useEffect(() => {
        const currentRoom = room;
        if (!currentRoom) return;
        return () => {
            if (typingStopTimer.current) {
                clearTimeout(typingStopTimer.current);
                typingStopTimer.current = null;
            }
            lastTypingSentAt.current = 0;
            sendTyping(currentRoom.roomId, false);
        };
    }, [room]);

    function typingText(): string {
        if (!room || typingUsers.length === 0) return "";
        const names = typingUsers
            .slice(0, 3)
            .map((id) => getMemberName(room, id));
        if (typingUsers.length === 1)
            return t("messageInput.isTyping", { value: names[0] });
        if (typingUsers.length === 2)
            return t("messageInput.andAreTyping", {
                value: names[0],
                value2: names[1],
            });
        if (typingUsers.length === 3)
            return t("messageInput.andAreTyping2", {
                value: names[0],
                value2: names[1],
                value3: names[2],
            });
        return t("messageInput.severalPeopleAreTyping");
    }

    function focus() {
        textareaEl.current?.focus();
    }

    function addFiles(files: File[]) {
        if (disabled) return;
        for (const file of files) enqueueFile(file);
    }
    useImperativeHandle(ref, () => ({ focus, addFiles }));

    // Composer pickers share the single interfaceState.modal "composer-picker"
    // slot; pickerKind says which one is shown.
    const modal = useRune(() => interfaceState.modal);
    const composerPicker = useRune(() => interfaceState.composerPicker);
    const composerPickerOwner = useRune(
        () => interfaceState.composerPickerOwner,
    );
    const composerActionsOwner = useRune(
        () => interfaceState.composerActionsOwner,
    );
    const composerPickerOpen = modal === "composer-picker";
    const showActionsMenu =
        modal === "composer-actions" && composerActionsOwner === effComposerKey;
    // Release our "+" menu when this composer unmounts (thread panel closed)
    // or its key changes (room switch).
    useEffect(() => {
        const key = effComposerKey;
        return () => releaseComposerActions(key);
    }, [effComposerKey]);
    const showEmojiPicker =
        composerPickerOpen &&
        composerPicker === "emoji" &&
        composerPickerOwner === effComposerKey;
    const showStickerPicker =
        composerPickerOpen &&
        composerPicker === "sticker" &&
        composerPickerOwner === effComposerKey;
    const showGifPicker =
        composerPickerOpen &&
        composerPicker === "gif" &&
        composerPickerOwner === effComposerKey;
    // Read-only room: the user's power level is below what posting needs
    // (announcement channels). Locks the composer like `disabled` does.
    const noSendPermission = useRune(() => {
        void roomsState.roomsTick;
        return !!room && !canSendMessages(room);
    }, [room]);
    const disabled = disabledProp || noSendPermission;

    // Mirrors the send button's own disabled condition so the button can go
    // accent-coloured the moment the message becomes sendable.
    const canSend =
        (!textBlank || fileQueue.length > 0) && !isSending && !disabled;
    const textareaFocusedBeforePicker = useRef(false);

    // Track keyboard height on mobile so pickers stay above it
    // Zami: react-native-keyboard-controller's keyboard height, for the
    // visualViewport arithmetic.
    const keyboardHeight = useKeyboardState((state) =>
        state.isVisible ? state.height : 0,
    );
    const keyboardOffset = isTouchscreen ? Math.max(0, keyboardHeight) : 0;

    function anyPickerOpen() {
        return composerPickerOpen;
    }

    function openPicker(which: "emoji" | "sticker" | "gif") {
        if (!anyPickerOpen()) {
            textareaFocusedBeforePicker.current =
                textareaEl.current?.isFocused() ?? false;
        } else {
            markPickerSwitch();
        }
        openComposerPicker(which, effComposerKey);
    }

    function closePicker(
        _which: "emoji" | "sticker" | "gif",
        refocus: boolean,
    ) {
        closeModal();
        if (refocus && textareaFocusedBeforePicker.current)
            textareaEl.current?.focus();
    }

    // roomsTick so a late member load / display-name change re-resolves the
    // name — a live Room mutation in place won't otherwise re-run this and
    // the preview would be stuck on the raw @mxid.
    // Zami: a rune read, so only a change of the name re-renders.
    const replyTargetName = useRune(() => {
        void roomsState.roomsTick;
        if (!replyToEvent) return null;
        const sender = replyToEvent.getSender() ?? "";
        return room ? getMemberName(room, sender) : sender;
    }, [replyToEvent, room]);
    const composerPlaceholder = noSendPermission
        ? t("messageInput.noPermissionToSend")
        : disabled
          ? t("messageInput.selectARoomToStartChatting")
          : isThread
            ? t("messageInput.replyInThread")
            : replyToEvent
              ? t("messageInput.replyTo", { replyTargetName })
              : t("messageInput.message", { roomName });

    // Focus textarea when reply is set
    useEffect(() => {
        if (replyToEvent) {
            textareaEl.current?.focus();
        }
    }, [replyToEvent]);

    function buildFormattedBody(plain: string): {
        html: string | null;
        mentionedUserIds: string[];
        mentionsRoom: boolean;
    } {
        return buildBody(plain, {
            mentions: pendingMentionsRef.current,
            customEmojis: getCustomEmojis(room, roomsState.activeSpaceId),
            memberIds: room
                ? new Set(getRoomMembers(room).map((m) => m.userId))
                : undefined,
        });
    }

    function isMentionToken(token: string): boolean {
        if (!token.startsWith("@") || token.length < 2) return false;
        // Keys include the leading "@" (e.g. "@alice" or "@alice:hs").
        if (pendingMentions.has(token)) return true;
        if (!room) return false;
        // Zami: the member index's match (as upstream's scan), remembered per
        // token.
        return memberIndexOf(room).matchesToken(token);
    }

    function decorateInline(plain: string): string {
        const emojis = customEmojis;
        return decorateComposerText(plain, {
            emojiSrc: (shortcode) => {
                const emoji = emojis.find((e) => e.shortcode === shortcode);
                return emoji ? mxcToHttp(emoji.mxcUrl) : null;
            },
            isMention: isMentionToken,
        });
    }

    // Zami: renderComposer's redraw (`innerHTML = decorateInline(text)`) is the
    // TextInput's children, derived from the model on every render (by
    // ComposerEditor, which re-renders on its own as the draft changes).
    const decorate = useCallback(
        (plain: string) => decorateInline(plain),
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- decorateInline reads these.
        [customEmojis, pendingMentions, room, memberTick],
    );

    // Zami: what's left of renderComposer is placing the caret, once the text
    // the model changed has rendered.
    const pendingCaret = useRef<number | null>(null);
    const [caretTick, setCaretTick] = useState(0);
    useEffect(() => {
        const pos = pendingCaret.current;
        if (pos === null) return;
        pendingCaret.current = null;
        modelSetAt.current = Date.now();
        setCaretOffset(pos);
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs once per renderComposer.
    }, [caretTick]);

    function renderComposer(caretOffset = getCaretOffset()): void {
        pendingCaret.current = caretOffset;
        selectionRef.current = { start: caretOffset, end: caretOffset };
        modelSetAt.current = Date.now();
        setCaretTick((n) => n + 1);
    }

    function setComposerText(next: string, caretOffset = next.length): void {
        setText(next);
        renderComposer(caretOffset);
    }

    // Undo/redo history, driven from the model (see textUndo.ts).
    // Zami: not ported: TextUndoHistory. It backs Ctrl+Z/Ctrl+Y and the
    // context menu's `historyUndo`, which a TextInput doesn't report; the
    // TextInput keeps its own undo (shake to undo), which redrawing a
    // decorated text clears, as innerHTML did upstream.

    // Per-room draft. Keyed on effComposerKey so it re-runs both when the room switches
    // (this component stays mounted) and when it unmounts/remounts (flipping to
    // the call view unmounts MessageArea), AND when switching between main/thread.
    // The body loads the incoming composer instance's draft; the cleanup saves the
    // outgoing instance's draft (the cleanup runs before the re-run, so leaving
    // A saves A before B loads, and unmounting saves the current instance).
    useEffect(() => {
        const key = effComposerKey;
        // A channel switch should close the mobile keyboard. The same
        // composer stays mounted across rooms, so otherwise it can
        // retain focus while the incoming room's draft is restored.
        if (interfaceState.isMobile) textareaEl.current?.blur();
        // Close any open voice recorder when the room changes — this component
        // stays mounted across room switches, so an open recorder would otherwise
        // persist and send its audio to the newly-selected room.
        setVoiceRecorderOpen(false);
        // An armed "create thread" must not carry over to another room either.
        setCreateThreadArmed(false);
        const draft = getDraft(key);
        const restored = draft?.text ?? "";
        setText(restored);
        setPendingMentions(new Map(draft?.mentions ?? []));
        renderComposer(restored.length);
        return () => setDraft(key, textRef.current, pendingMentionsRef.current);
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- tracks only the key, as upstream's untrack() does.
    }, [effComposerKey]);

    function splitUserAndReason(arg: string): {
        user: string;
        reason?: string;
    } {
        const trimmed = arg.trim();
        const idx = trimmed.search(/\s/);
        if (idx === -1) return { user: trimmed };
        return {
            user: trimmed.slice(0, idx),
            reason: trimmed.slice(idx + 1).trim() || undefined,
        };
    }

    // A user token from a slash command: a full mxid, a mention pill's
    // display name (unique members only), or a localpart for our homeserver.
    function resolveUserOrThrow(token: string): string {
        const userId = resolveUserArg(
            token,
            getOwnServerName(),
            room ? getRoomMembers(room) : [],
        );
        if (!userId)
            throw new Error(t("messageInput.isNotAValidUser", { token }));
        return userId;
    }

    async function applyPowerLevel(token: string, level: number) {
        if (!room) throw new Error(t("messageInput.noRoomSelected"));
        const userId = resolveUserOrThrow(token);
        if (!room.getMember(userId))
            throw new Error(t("messageInput.isNotInThisRoom", { userId }));
        const pl = getRoomPowerLevels(room);
        const required = pl.events["m.room.power_levels"] ?? pl.state_default;
        if (getMyPowerLevel(room) < required)
            throw new Error(t("messageInput.youDonTHavePermissionTo"));
        await setUserPowerLevel(room, userId, level);
    }

    async function runSlashAction(command: SlashCommand, arg: string) {
        switch (command.name) {
            case "join":
                await joinRoomByAlias(arg.trim());
                break;
            case "part":
                await leaveRoom(roomId);
                break;
            case "invite":
                await inviteUser(roomId, resolveUserOrThrow(arg.trim()));
                break;
            case "topic":
                await setRoomTopic(roomId, arg);
                break;
            case "kick": {
                const { user, reason } = splitUserAndReason(arg);
                await kickUser(roomId, resolveUserOrThrow(user), reason);
                break;
            }
            case "ban": {
                const { user, reason } = splitUserAndReason(arg);
                await banUser(roomId, resolveUserOrThrow(user), reason);
                break;
            }
            case "nick": {
                const r = parseNickArg(arg);
                if ("error" in r) throw new Error(r.error);
                await setOwnDisplayName(r.name);
                break;
            }
            case "op": {
                const r = parseOpArg(arg);
                if ("error" in r) throw new Error(r.error);
                await applyPowerLevel(r.user, r.level);
                break;
            }
            case "deop": {
                const r = parseDeopArg(arg);
                if ("error" in r) throw new Error(r.error);
                await applyPowerLevel(r.user, 0);
                break;
            }
            case "discardsession":
                await discardRoomSession(roomId);
                showToast(t("crypto.roomKeyDiscarded"), { tone: "accent" });
                break;
            default:
                throw new Error(
                    t("messageInput.unhandledCommand", { name: command.name }),
                );
        }
    }

    async function dispatchSlashCommand(command: SlashCommand, arg: string) {
        if (command.requiresArg && !arg) {
            showErrorToast(usageFor(command));
            return;
        }

        // Mention pills put display names in the text ("@Ann"), not mxids —
        // swap them back before a user-arg command parses its argument.
        if (command.argKind === "user")
            arg = resolveMentionTokens(arg, pendingMentionsRef.current);

        // Stop our typing indicator — send() does this too, but command dispatch
        // returns before reaching that point.
        if (typingStopTimer.current) {
            clearTimeout(typingStopTimer.current);
            typingStopTimer.current = null;
        }
        if (room) sendTyping(room.roomId, false);
        // Reset the refresh gate so the next keystroke re-broadcasts typing
        // immediately rather than waiting out the 20s window.
        lastTypingSentAt.current = 0;

        // Plugin-provided command: run its handler instead of the core switch.
        // Mirrors the action branch — no local echo, clear on success only.
        if (command.pluginRun) {
            setIsSending(true);
            try {
                await command.pluginRun({ roomId, arg });
                setText("");
                slash.setQuery(null);
                mention.setQuery(null);
                setPendingMentions(new Map());
                clearDraft(live.current.effComposerKey);
                renderComposer(0);
            } catch (err) {
                console.error(`Plugin command /${command.name} failed:`, err);
                showErrorToast(
                    matrixErrorMessage(err, t("messageInput.commandFailed")),
                );
            } finally {
                setIsSending(false);
                textareaEl.current?.focus();
            }
            return;
        }

        // Action commands call a client.ts wrapper; they aren't messages, so no
        // local echo. Clear the composer only on success.
        if (command.kind === "action") {
            setIsSending(true);
            try {
                await runSlashAction(command, arg);
                setText("");
                slash.setQuery(null);
                mention.setQuery(null);
                setPendingMentions(new Map());
                clearDraft(live.current.effComposerKey);
                renderComposer(0);
            } catch (err) {
                showErrorToast(
                    matrixErrorMessage(err, t("messageInput.commandFailed")),
                );
            } finally {
                setIsSending(false);
                textareaEl.current?.focus();
            }
            return;
        }

        // Dialog commands open a modal instead of sending anything; clear the
        // "/poll" text out of the composer first.
        if (command.kind === "dialog") {
            setText("");
            slash.setQuery(null);
            clearDraft(effComposerKey);
            renderComposer(0);
            if (command.name === "poll") openCreatePollDialog(roomId);
            else if (command.name === "location")
                openShareLocationDialog(roomId);
            textareaEl.current?.focus();
            return;
        }

        // emote + text-transform both produce a message body sent like a normal
        // message (markdown + mentions), except /plain which bypasses markdown.
        // The transform is pure app code for core commands, but the transform
        // command flavor is public (plugins), so guard a throwing transform.
        let body: string;
        try {
            body = command.kind === "emote" ? arg : command.transform!(arg);
        } catch (err) {
            console.error(`Command /${command.name} transform threw:`, err);
            showErrorToast(
                matrixErrorMessage(err, t("messageInput.commandFailed")),
            );
            return;
        }
        const usePlain = command.kind === "text-transform" && !!command.plain;
        // Resolve formatting before clearing the composer (buildFormattedBody
        // reads pendingMentions, reset below).
        const formatted = usePlain ? null : buildFormattedBody(body);
        const replyTarget = replyToEvent;
        // A text command (/shrug, /tableflip, /plain…) answers the open reply
        // like a normal message would; /me still goes out on its own.
        const replyId =
            command.kind === "emote"
                ? undefined
                : (replyTarget?.getId() ?? undefined);

        setIsSending(true);
        setText("");
        mention.setQuery(null);
        emoji.setQuery(null);
        slash.setQuery(null);
        setPendingMentions(new Map());
        clearDraft(effComposerKey);
        renderComposer(0);

        try {
            const mentions = formatted
                ? mentionsFromFormatted(formatted)
                : undefined;
            if (command.kind === "emote") {
                await sendEmote(
                    roomId,
                    body,
                    formatted?.html ?? undefined,
                    mentions,
                    isThread ? { rootEventId: threadRootId! } : undefined,
                );
            } else if (isThread) {
                // In a thread, every message-producing slash command must land
                // in the thread — otherwise /plain, /shrug, /spoiler etc. would
                // silently escape to the main timeline. usePlain bypasses
                // markdown (no formatted body).
                await sendThreadReply(
                    roomId,
                    threadRootId!,
                    body,
                    mentions,
                    usePlain ? undefined : (formatted?.html ?? undefined),
                    undefined,
                    replyId,
                );
            } else if (replyId) {
                await sendEventContent(
                    roomId,
                    buildReplyContent({
                        replyEventId: replyId,
                        text: body,
                        formattedText: usePlain
                            ? undefined
                            : (formatted?.html ?? undefined),
                        mentions,
                    }) as unknown as Record<string, unknown>,
                );
            } else if (usePlain) {
                await sendTextMessage(roomId, body);
            } else if (formatted?.html) {
                await sendFormattedMessage(
                    roomId,
                    body,
                    formatted.html,
                    mentions,
                );
            } else {
                await sendTextMessage(roomId, body);
            }
            // The reply was used (or, for /me, dropped) — clear it so the
            // banner doesn't leak onto the user's next message.
            if (replyTarget) live.current.onCancelReply?.();
            snapTimelineToBottom();
        } catch (err) {
            console.error("Slash command failed:", err);
            showErrorToast(
                matrixErrorMessage(err, t("messageInput.failedToSend")),
            );
        } finally {
            setIsSending(false);
            textareaEl.current?.focus();
        }
    }

    /** Clear the composer after a send lands. `forRoomId` is the room the send
     *  targeted and `textAtSend` is the text it captured at entry — a caption
     *  resolves when its upload finishes, which can be long after Send with the
     *  composer still editable in the meantime.
     *
     *  Both halves are conditional, for the same reason: neither the stored
     *  draft nor the visible buffer is ours to wipe once the user has moved on
     *  from the text we sent. See shouldClearStoredDraft and
     *  shouldClearComposerAfterSend. */
    async function sendSedEdit(sed: SedCommand) {
        const forKey = effComposerKey;
        const textAtSend = textRef.current;
        setIsSending(true);
        try {
            const result = await onSedEdit!(sed);
            if (result === "edited") clearComposerAfterSend(forKey, textAtSend);
            else if (result === "no-message")
                showErrorToast(t("messageInput.sedNoMessage"));
            else if (result === "no-match")
                showErrorToast(
                    t("messageInput.sedNoMatch", { pattern: sed.pattern }),
                );
            else showErrorToast(t("messageInput.sedEmpty"));
        } catch (err) {
            console.error("Failed to edit message:", err);
            showErrorToast(t("messageInput.sedFailed"));
        } finally {
            setIsSending(false);
        }
    }

    function clearComposerAfterSend(forKey: string, textAtSend: string) {
        // `forKey` is the composer INSTANCE key (roomId for the main composer,
        // the thread key for a thread composer): drafts are stored per instance,
        // and the "did the user move on" identity check compares the current
        // instance key against the one the send captured. For the main composer
        // effComposerKey === roomId, so this is identical to keying on roomId.
        if (
            shouldClearStoredDraft({
                storedText: getDraft(forKey)?.text ?? null,
                textAtSend,
            })
        )
            clearDraft(forKey);
        if (
            !shouldClearComposerAfterSend({
                currentRoomId: live.current.effComposerKey,
                targetRoomId: forKey,
                currentText: textRef.current,
                textAtSend,
            })
        )
            return;
        setText("");
        mention.setQuery(null);
        emoji.setQuery(null);
        setPendingMentions(new Map());
        renderComposer(0);
    }

    // The unknown `/word` the last send refused, while its toast is up: sending
    // the same text again (Enter, or the send button) posts it as a message.
    const heldUnknown = useRef<{
        text: string;
        key: string;
        toastId: number;
    } | null>(null);

    // Sends one queued file as media. A starred GIF re-uses its existing media
    // instead of uploading the bytes again; when the room can't take that media
    // (an encrypted one in a plaintext room) the bytes are uploaded as usual.
    async function sendQueuedMedia(
        item: QueuedFile,
        roomId: string,
        caption: MediaCaption | undefined,
        relation: MediaRelation | undefined,
        transform:
            | ((c: Record<string, unknown>) => Record<string, unknown>)
            | undefined,
        onProgress: ((loaded: number, total: number) => void) | undefined,
        ready: () => Promise<void>,
    ): Promise<void> {
        if (
            item.reuse &&
            (await sendExistingMedia(
                roomId,
                item.reuse,
                item.name,
                caption,
                relation,
                transform,
                ready,
            ))
        )
            return;
        await sendFile(
            roomId,
            item.file,
            caption,
            relation,
            transform,
            onProgress,
            ready,
        );
    }

    async function send() {
        // `s/old/new/` edits the last message instead of sending one. Not with
        // files queued: then the text is a caption.
        if (
            !isSendingRef.current &&
            !disabled &&
            fileQueue.length === 0 &&
            onSedEdit
        ) {
            const sed = parseSedCommand(textRef.current);
            if (sed) {
                await sendSedEdit(sed);
                return;
            }
        }

        // Slash-command dispatch — only when no files are queued (with files the
        // text is a caption, not a command).
        if (!isSendingRef.current && !disabled && fileQueue.length === 0) {
            const text = textRef.current;
            const parsed = parseSlashCommand(text, pluginSlashCommands);
            // A command this client does not implement may be a typo of one it
            // does, or a bot's own (`/model`, `/new`, ...), which the composer
            // cannot know. The first send only warns, so a typo never posts by
            // accident; sending the same text again posts it. Editing the text
            // or switching room/thread starts over.
            const held = heldUnknown.current;
            heldUnknown.current = null;
            if (parsed && "unknown" in parsed) {
                if (
                    held?.text === text &&
                    held.key === effComposerKey &&
                    toastsState.toasts.some(
                        (toast) => toast.id === held.toastId,
                    )
                ) {
                    dismissToast(held.toastId);
                } else {
                    const toastId = showToast(
                        t(
                            interfaceState.isMobile
                                ? "messageInput.unknownCommandTapAgain"
                                : "messageInput.unknownCommandEnterAgain",
                            { unknown: parsed.unknown },
                        ),
                        { tone: "danger" },
                    );
                    heldUnknown.current = {
                        text,
                        key: effComposerKey,
                        toastId,
                    };
                    return;
                }
            }
            if (parsed && "command" in parsed) {
                await dispatchSlashCommand(parsed.command, parsed.arg);
                return;
            }
            // A bare "/" (popup dismissed, no command name typed) is not a
            // message — don't post a literal slash via the send button.
            if (/^\s*\/\s*$/.test(text)) return;
            // "//text" escape → strip one leading slash and send as a literal
            // message that starts with a single slash.
            if (/^\s*\/\//.test(text)) {
                setText(text.replace("/", ""));
            }
        }

        // Sender-side text transforms (plugins, e.g. the text-replacer). Applied
        // to a LOCAL copy so the composer text and the draft-restore snapshot
        // (textAtSend) stay what the user typed; `trimmed` and the formatted body
        // built below both derive from the transformed text.
        // Unicode `:shortcode:`s that weren't converted while typing (pasted,
        // restored drafts) still go out as emoji.
        const outgoingText = applyTextTransforms(
            replaceEmojiShortcodes(textRef.current, isCustomShortcode),
            pluginRegistry.outgoingTextTransforms.map((e) => e.value),
            { roomId },
        );
        const trimmed = outgoingText.trim();
        if (
            (!trimmed && fileQueue.length === 0) ||
            isSendingRef.current ||
            disabled
        )
            return;

        if (typingStopTimer.current) {
            clearTimeout(typingStopTimer.current);
            typingStopTimer.current = null;
        }
        if (room) sendTyping(room.roomId, false);
        // Reset the refresh gate so the next keystroke re-broadcasts typing
        // immediately rather than waiting out the 20s window.
        lastTypingSentAt.current = 0;

        setIsSending(true);
        // Everything below targets the room the user pressed Send in — a room
        // or thread switch mid-upload must not retarget a send, a queue removal,
        // or a draft write.
        const targetRoomId = roomId;
        const targetComposerKey = effComposerKey;
        // Sender-side content transforms (plugins), run over each fully-built
        // event this send produces: text, reply, thread reply, caption.
        const transformOutgoingContent = (content: Record<string, unknown>) =>
            applyContentTransforms(
                content,
                pluginRegistry.outgoingContentTransforms.map((e) => e.value),
                { roomId: targetRoomId },
            );
        // Snapshot the composer text too, before anything can mutate it: a
        // caption commit that lands after the user typed on must not wipe the
        // new sentence (nor yank the caret back to 0).
        const textAtSend = textRef.current;
        const filesToSend = fileQueue.slice();
        // Clear the drawer up front so in-flight attachments don't look
        // attached to the next message the user starts composing. The files
        // are already snapshotted in filesToSend; a failure restores only the
        // unsent ones below. clearFileQueue revokes the preview URLs it owns —
        // restore recreates fresh ones.
        if (filesToSend.length > 0) {
            // Key on the COMPOSER (thread or room), matching getFileQueue above —
            // a thread send must clear the thread's drawer, not the room's.
            clearFileQueue(targetComposerKey);
            setSendingRoomId(targetRoomId);
            setSendingFileCount(filesToSend.length);
            setUploadPercent(null);
            uploadLoaded.current = filesToSend.map(() => 0);
            // A direct file reports no upload progress, so it can't count here.
            uploadTotal.current = filesToSend.map((item) =>
                item.direct ? 0 : item.file.size,
            );
        }
        // Resolve mentions before clearing the composer below (buildFormattedBody
        // reads pendingMentions, which we reset up front).
        const formatted = trimmed ? buildFormattedBody(trimmed) : null;

        // When files are queued alongside text, attach the text to the first
        // file as a caption (MSC2530) rather than sending it as a separate
        // message. A direct file's offer can't carry formatted text, so there
        // it does go as a message, just ahead of the offer.
        const firstIsDirect = filesToSend[0]?.direct ?? false;
        const useCaption =
            !!trimmed &&
            !!formatted &&
            filesToSend.length > 0 &&
            !firstIsDirect;
        // A reply rides on the first file whenever no separate text message
        // carries it (caption, or attachments alone). Snapshotted so a reply
        // picked mid-upload isn't retargeted or cancelled by this send.
        const replyTarget = replyToEvent;
        const fileReplyToId =
            replyTarget &&
            filesToSend.length > 0 &&
            !firstIsDirect &&
            (useCaption || !trimmed)
                ? (replyTarget.getId() ?? undefined)
                : undefined;
        const fileRelation = (i: number) =>
            isThread || (i === 0 && fileReplyToId)
                ? {
                      rootEventId: isThread ? threadRootId! : undefined,
                      replyToEventId: i === 0 ? fileReplyToId : undefined,
                  }
                : undefined;

        // The SDK creates the local echo synchronously, so a text message shows
        // in the timeline the moment we send it — with a retry/delete affordance
        // there if it fails (see MessageItem). Clear the composer up front so the
        // message isn't shown in two places and can't be sent twice by accident.
        // A caption has no local echo until its upload finishes, so that case
        // clears on success instead (below) and the text survives a failure.
        if (trimmed && !useCaption)
            clearComposerAfterSend(targetComposerKey, textAtSend);

        const sentIds = new Set<string>();

        // Offline: queue the text message in the app-level outbox instead of
        // letting the SDK create a room-blocking NOT_SENT echo. Non-thread,
        // no-attachment text/reply only (threads + files keep their existing
        // paths). The composer was already cleared up front (above), matching a
        // normal send's UX.
        if (
            trimmed &&
            formatted &&
            !useCaption &&
            filesToSend.length === 0 &&
            !isThread &&
            shouldQueueSend({
                syncState: auth.syncState,
                online: navigator.onLine,
            })
        ) {
            const { html } = formatted;
            const mentions = mentionsFromFormatted(formatted);
            const baseContent: Record<string, unknown> = replyToEvent
                ? (buildReplyContent({
                      replyEventId: replyToEvent.getId()!,
                      text: trimmed,
                      formattedText: html ?? undefined,
                      mentions,
                  }) as unknown as Record<string, unknown>)
                : html
                  ? buildFormattedContent(trimmed, html, mentions)
                  : buildTextContent(trimmed, mentions);
            const content = transformOutgoingContent(baseContent);
            queueMessage(targetRoomId, content);
            if (replyToEvent) onCancelReply?.();
            setCreateThreadArmed(false);
            setIsSending(false);
            textareaEl.current?.focus();
            return;
        }

        // Plain text (no attachments: text + files always goes out as a
        // caption). The SDK puts the local echo in the timeline synchronously,
        // with its own retry/delete affordance on failure, so the composer must
        // NOT wait for the server's ack: on a slow homeserver (matrix.org) or a
        // first send that has to share room keys, that ack takes seconds and
        // blocked the next message behind a spinner. Reported in issue #40.
        if (trimmed && formatted && !useCaption) {
            const { html } = formatted;
            const mentions = mentionsFromFormatted(formatted);
            const replyId = replyToEvent?.getId() ?? undefined;
            const threadArmed = createThreadArmedRef.current;
            setCreateThreadArmed(false);
            let sent: Promise<unknown>;
            if (isThread) {
                // Thread replies always route via sendThreadReply; a reply to
                // a specific thread message rides along as its quote target.
                sent = sendThreadReply(
                    targetRoomId,
                    threadRootId!,
                    trimmed,
                    mentions,
                    html ?? undefined,
                    transformOutgoingContent,
                    replyId,
                );
            } else {
                // Build the content in-component (byte-identical to the
                // sendReply/sendFormattedMessage/sendTextMessage wrappers, see
                // utils/messageContent.ts), apply plugin content transforms,
                // then send. Thread replies + captions keep their own send
                // paths, which apply the same transforms.
                const baseContent: Record<string, unknown> = replyId
                    ? (buildReplyContent({
                          replyEventId: replyId,
                          text: trimmed,
                          formattedText: html ?? undefined,
                          mentions,
                      }) as unknown as Record<string, unknown>)
                    : html
                      ? buildFormattedContent(trimmed, html, mentions)
                      : buildTextContent(trimmed, mentions);
                const content = transformOutgoingContent(baseContent);
                sent = sendEventContent(targetRoomId, content).then(
                    (sentEventId) => {
                        if (threadArmed) onThreadCreated?.(sentEventId);
                    },
                );
            }
            if (replyToEvent) onCancelReply?.();
            sent.catch((err) => {
                console.error("Failed to send:", err);
                showErrorToast(
                    matrixErrorMessage(err, t("messageInput.failedToSend")),
                );
            });
            if (filesToSend.length === 0) {
                setIsSending(false);
                snapTimelineToBottom();
                textareaEl.current?.focus();
                return;
            }
        }

        try {
            // Upload in parallel, post in queue order, and commit each file as
            // it lands. A failed file doesn't stop the rest (their uploads
            // would be orphaned); only the failed files are restored below,
            // so a retry sends just those (audit MEDIA-03).
            await sendQueuedFiles(
                filesToSend,
                (item, i, ready) => {
                    if (item.direct)
                        return ready().then(() =>
                            offerFile(targetRoomId, item.file),
                        );
                    if (useCaption && i === 0 && formatted) {
                        const { html } = formatted;
                        return sendQueuedMedia(
                            item,
                            targetRoomId,
                            {
                                body: trimmed,
                                formattedBody: html ?? undefined,
                                mentions: mentionsFromFormatted(formatted),
                            },
                            fileRelation(i),
                            transformOutgoingContent,
                            onUploadProgress(i),
                            ready,
                        );
                    }
                    return sendQueuedMedia(
                        item,
                        targetRoomId,
                        undefined,
                        fileRelation(i),
                        undefined,
                        onUploadProgress(i),
                        ready,
                    );
                },
                (item, i) => {
                    // The drawer was already cleared optimistically; just record
                    // the success so a later failure won't restore this file.
                    sentIds.add(item.id);
                    if (
                        i === 0 &&
                        fileReplyToId &&
                        live.current.replyToEvent === replyTarget
                    )
                        live.current.onCancelReply?.();
                    // The caption rode on the first file — it's only safely
                    // sent once that file is.
                    if (useCaption && i === 0)
                        clearComposerAfterSend(targetComposerKey, textAtSend);
                },
            );
            // Snap scroll to bottom after input shrinks — prevents content from drifting up
            snapTimelineToBottom();
        } catch (err) {
            console.error("Failed to send:", err);
            showErrorToast(
                matrixErrorMessage(err, t("messageInput.failedToSend")),
                isFileTooLargeError(err) && !isThread
                    ? {
                          label: t("messageInput.sendDirectly"),
                          run: () =>
                              markQueuedFilesDirect(
                                  targetComposerKey,
                                  (q) => q.file.size > err.limit,
                              ),
                      }
                    : undefined,
            );
            // Restore ONLY the files that were not successfully sent — an
            // already-sent file must never come back (would duplicate on the
            // next send: audit MEDIA-03). The optimistic clear revoked the
            // originals' preview URLs, so recreate them the same way enqueueFile
            // does. Restore targets the COMPOSER the send was for (thread or
            // room), not the one the user may have switched to.
            const toRestore = filesToRestoreAfterSend(filesToSend, sentIds);
            for (const item of toRestore) {
                addQueuedFile(
                    targetComposerKey,
                    item.file,
                    item.name,
                    previewUrlFor(item.file),
                    item.direct,
                    item.reuse,
                );
            }
        } finally {
            setIsSending(false);
            setSendingFileCount(0);
            setUploadPercent(null);
            setSendingRoomId(null);
            textareaEl.current?.focus();
        }
    }

    // Zami: hardware key presses are observed, not intercepted (see
    // @-/com.leonsilicon.zami.browser): the TextInput has taken each key by the
    // time onKeydown runs, so preventDefault() can't stop it. So:
    //   - Enter is the TextInput's return key: on a phone (isMobile) typing on
    //     its own keyboard it adds a line, as upstream's touch branch has it,
    //     and the send button sends; with a hardware keyboard, or off a phone,
    //     it submits (`submitBehavior`), sending as a physical Enter does, or
    //     with Shift held adding a line (onSubmitEditing). Either way an open
    //     suggestion list takes it first (pickSuggestion).
    //   - Tab in a suggestion list types a tab (after accepting any
    //     autocorrection), which picks instead of landing (syncFromEditor), as
    //     the return key does on a phone.
    //   - ArrowUp/ArrowDown in a suggestion list also move the caret, which
    //     is put back (onSelectionChange).
    // Escape is also VoiceOver's escape gesture (onEscape).
    // Not ported: Ctrl+Z/Ctrl+Y through the model's history, since the
    // TextInput's own undo takes them (see TextUndoHistory below); and
    // PageUp/PageDown scrolling the timeline, which `scrollEl` (a
    // TimelineScroller) can't page.

    /** Zami: a caret an arrow key moved while a suggestion list had it: the
     *  selection to put back, and when the key was pressed. */
    const arrowCaret = useRef<{
        selection: { start: number; end: number };
        at: number;
    } | null>(null);
    /** Zami: a Tab a suggestion list took, until the text it typed arrives
     *  (syncFromEditor), or with none, until it picks on its own. */
    const tabPick = useRef<{
        at: number;
        timer: ReturnType<typeof setTimeout>;
    } | null>(null);

    /** Zami: an arrow key a suggestion list takes: its caret move is undone. */
    function holdCaret() {
        arrowCaret.current = {
            selection: { ...selectionRef.current },
            at: Date.now(),
        };
    }

    /** Zami: a Tab a suggestion list takes: it picks once the text it types
     *  arrives, or on its own if none does. */
    function pickOnTab() {
        if (tabPick.current) clearTimeout(tabPick.current.timer);
        tabPick.current = {
            at: Date.now(),
            timer: setTimeout(() => {
                tabPick.current = null;
                pickSuggestion();
            }, TAB_SETTLE_MS),
        };
    }

    function onKeydown(e: KeyboardEvent) {
        // Ctrl/Cmd chords: undo/redo through the model history, and the
        // picker shortcuts. Handled here (not only in AppShell) so they open
        // THIS composer's picker, e.g. the thread composer's when focused;
        // AppShell skips events already defaultPrevented.
        // Zami: not ported: undo/redo (see above).
        // Picker shortcuts (Settings > Keybinds).
        if (!keybindsState.recording) {
            const picker = pickerForKey(e);
            if (picker) {
                e.preventDefault();
                openPicker(picker);
                return;
            }
        }

        // Slash-command picker navigation
        // Zami: the lists' state is read from their stores (useSuggestions).
        if (slash.isOpen()) {
            if (e.key === "ArrowUp") {
                e.preventDefault();
                holdCaret();
                slash.move(-1);
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                holdCaret();
                slash.move(1);
                return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                // Zami: picks through the text the key types (pickOnTab,
                // onSubmitEditing).
                if (e.key === "Tab") pickOnTab();
                return;
            }
            if (e.key === "Escape") {
                slash.setQuery(null);
                return;
            }
        }

        // Mention picker navigation
        if (mention.isOpen()) {
            if (e.key === "ArrowUp") {
                e.preventDefault();
                holdCaret();
                mention.move(-1);
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                holdCaret();
                mention.move(1);
                return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                // Zami: picks through the text the key types (pickOnTab,
                // onSubmitEditing).
                if (e.key === "Tab") pickOnTab();
                return;
            }
            if (e.key === "Escape") {
                mention.setQuery(null);
                return;
            }
        }

        // Emoji picker navigation
        if (emoji.isOpen()) {
            if (e.key === "ArrowUp") {
                e.preventDefault();
                holdCaret();
                emoji.move(-1);
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                holdCaret();
                emoji.move(1);
                return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                // Zami: picks through the text the key types (pickOnTab,
                // onSubmitEditing).
                if (e.key === "Tab") pickOnTab();
                return;
            }
            if (e.key === "Escape") {
                emoji.setQuery(null);
                return;
            }
        }

        // Zami: Shift+Enter and the physical Enter are onSubmitEditing's.

        // Picker dismissal is handled centrally (+page Escape/back). Here we
        // only cancel an in-progress reply, and only when nothing else is open.
        if (
            e.key === "Escape" &&
            !interfaceState.modal &&
            !interfaceState.sidebar &&
            replyToEvent
        ) {
            onCancelReply?.();
        }
        // Ctrl+E / Ctrl+S (open pickers) are global shortcuts handled
        // centrally in AppShell.
        if (
            e.key === "ArrowUp" &&
            !textRef.current &&
            !e.altKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.shiftKey
        ) {
            e.preventDefault();
            onRequestEditLast?.();
        }
    }

    // Zami: `onkeydown={onKeydown}` on the editor.
    useInputKeys(textareaEl, { onKeydown });

    /** The suggestion lists' Enter/Tab: pick the highlighted entry. */
    function pickSuggestion(): boolean {
        // Slash-command picker navigation
        if (slash.isOpen()) {
            const command = slash.candidates()[slash.selectedIndex()];
            if (command) commitSlashCommand(command);
            return true;
        }
        // Mention picker navigation
        if (mention.isOpen()) {
            const member = mention.candidates()[mention.selectedIndex()];
            if (member) commitMention(member);
            return true;
        }
        // Emoji picker navigation
        if (emoji.isOpen()) {
            const candidate = emoji.candidates()[emoji.selectedIndex()];
            if (candidate) commitEmoji(candidate);
            return true;
        }
        return false;
    }

    function onSubmitEditing() {
        // Zami: Shift+Enter on a hardware keyboard: a line break, through the
        // model (upstream's insertLineBreakAtCaret).
        if (isModifierHeld("Shift")) {
            insertLineBreakAtCaret();
            return;
        }
        if (pickSuggestion()) return;
        void send();
    }

    /** Zami: upstream's insertLineBreakAtCaret, on the model's selection. */
    function insertLineBreakAtCaret() {
        const prev = textRef.current;
        const { start, end } = selectionRef.current;
        setComposerText(
            prev.slice(0, start) + "\n" + prev.slice(end),
            start + 1,
        );
        detectMentionQuery();
        detectEmojiQuery();
        detectSlashQuery();
    }

    function onEscape() {
        if (slash.isOpen()) {
            slash.setQuery(null);
            return;
        }
        if (mention.isOpen()) {
            mention.setQuery(null);
            return;
        }
        if (emoji.isOpen()) {
            emoji.setQuery(null);
            return;
        }
        // Picker dismissal is handled centrally (+page Escape/back). Here we
        // only cancel an in-progress reply, and only when nothing else is open.
        if (!interfaceState.modal && !interfaceState.sidebar && replyToEvent) {
            onCancelReply?.();
        }
    }

    function insertEmoji(emoji: string) {
        setComposerText(textRef.current + textSymbolPresentation(emoji));
        closeModal();
        textareaEl.current?.focus();
    }

    function insertCustomEmoji(emoji: CustomEmoji) {
        setComposerText(textRef.current + `:${emoji.shortcode}:`);
        closeModal();
        textareaEl.current?.focus();
    }

    function insertGif(url: string) {
        const current = textRef.current;
        const next = current ? current + " " + url : url;
        setComposerText(next);
        closeModal();
        textareaEl.current?.focus();
    }

    async function sendStickerMessage(sticker: CustomSticker) {
        if (isSendingRef.current || disabled) return;
        setIsSending(true);
        const replyTarget = replyToEvent;
        try {
            await sendSticker(
                roomId,
                sticker,
                isThread ? { rootEventId: threadRootId! } : undefined,
                replyTarget?.getId() ?? undefined,
            );
            if (replyTarget) live.current.onCancelReply?.();
        } catch (err) {
            console.error("Failed to send sticker:", err);
        } finally {
            setIsSending(false);
            textareaEl.current?.focus();
        }
    }

    function enqueueFile(file: File, defaultName?: string, direct = false) {
        const name = file.name || defaultName || "file";
        addQueuedFile(
            live.current.effComposerKey,
            file,
            name,
            previewUrlFor(file),
            direct,
            reusableMediaOfFile(file),
        );
        // Look up the upload size limit now, while the user is still writing,
        // so its round trip isn't added to the send (slow links: Tor).
        void getMediaUploadSizeLimit();
        textareaEl.current?.focus();
    }

    function removeFromQueue(id: string) {
        removeQueuedFile(effComposerKey, id);
    }

    // Tap a queued attachment to rename it before sending.
    const [renamingItem, setRenamingItem] = useState<QueuedFile | null>(null);
    function openRename(item: QueuedFile) {
        openModal("rename-attachment", () => setRenamingItem(null));
        setRenamingItem(item);
    }

    // Zami: not ported: onBeforeInput, which routes the browser's line breaks
    // through the model; the TextInput inserts its own "\n", which is the
    // model's line break. Nor onPaste's images (a
    // pasted screenshot attaching itself): a TextInput only pastes text, which
    // arrives through onChangeText like typing, its line endings normalised
    // there as pastedPlainText does.

    // Zami: the file inputs' `onchange`, for the files a picker gives.
    function onDirectFileSelected(files: File[]) {
        for (const file of files) enqueueFile(file, undefined, true);
    }

    function onFileSelected(files: File[]) {
        for (const file of files) enqueueFile(file);
    }

    // Zami: `inputEl.click()`: opens a picker, then hands what it picked on.
    function chooseFiles(
        pick: () => Promise<File[]>,
        onSelected: (files: File[]) => void,
    ) {
        pick().then(onSelected, (err) =>
            console.error("[zam] file picker failed", err),
        );
    }

    // Custom emotes keep their `:shortcode:` token (sent as an <img>), so a
    // unicode shortcode with the same name must not replace them.
    function isCustomShortcode(code: string): boolean {
        return getCustomEmojis(
            live.current.room,
            roomsState.activeSpaceId,
        ).some((e) => e.shortcode === code);
    }

    // Zami: not ported: IME composition tracking (`composing`, onInput's
    // deferral and onCompositionEnd). The TextInput owns its marked text and
    // leaves it alone when the model's text is drawn over it; onChangeText
    // reports the text with it.
    // Zami: not ported: commitPendingComposition (the blur()+focus() that makes
    // a mobile WebView's keyboard commit its pending word before a send): the
    // TextInput reports the text with its marked text, and blurring it would
    // dismiss the keyboard.
    async function sendFromButton() {
        await send();
    }

    /** Read the editor into the model.
     *  Zami: `next` is what the TextInput now holds (onChangeText). */
    function syncFromEditor(next: string) {
        const prev = textRef.current;
        const selection = selectionRef.current;
        // Zami: a Tab a suggestion list took (onKeydown) types a tab, after
        // accepting any autocorrection of the word being completed. The
        // autocorrection is dropped, and the tab picks from the list as it
        // stood.
        const tab = tabPick.current;
        if (tab && Date.now() - tab.at < TAB_SETTLE_MS) {
            const tabs = (value: string) => value.split("\t").length;
            if (tabs(next) <= tabs(prev)) return;
            clearTimeout(tab.timer);
            tabPick.current = null;
            if (pickSuggestion()) return;
        }
        // Zami: the return key on a phone adds a line rather than reporting a
        // keydown, so the suggestion lists' Enter is a line break typed over
        // the selection while one is open: it picks instead of landing. So
        // does a hardware Tab, which types a tab.
        if (
            (next ===
                prev.slice(0, selection.start) +
                    "\n" +
                    prev.slice(selection.end) ||
                next ===
                    prev.slice(0, selection.start) +
                        "\t" +
                        prev.slice(selection.end)) &&
            pickSuggestion()
        )
            return;
        let caret = caretAfterEdit(prev, next, selection);
        let value = next;
        // Zami: pastedPlainText's line endings: Windows clipboards carry "\r\n",
        // and a stray "\r" renders (and sends) as a second line break.
        let redraw = false;
        if (value.includes("\r")) {
            const before = value.slice(0, caret).replace(/\r\n?/g, "\n");
            value = before + value.slice(caret).replace(/\r\n?/g, "\n");
            caret = before.length;
            redraw = true;
        }
        // Typing the closing colon of a unicode shortcode converts it, like
        // Discord (":tm:" → ™️).
        const converted = convertTrailingShortcode(
            value.slice(0, caret),
            isCustomShortcode,
        );
        if (converted !== null) {
            value = converted + value.slice(caret);
            caret = converted.length;
            redraw = true;
        }
        setText(value);
        selectionRef.current = { start: caret, end: caret };
        if (redraw) renderComposer(caret);
        detectMentionQuery();
        detectEmojiQuery();
        detectSlashQuery();

        if (room) {
            const now = Date.now();
            // Refresh the typing notification 5s before the 25s server timeout
            // (see sendTyping in client.ts) so the indicator never flickers off
            // between keystrokes.
            if (now - lastTypingSentAt.current >= 20_000) {
                lastTypingSentAt.current = now;
                sendTyping(room.roomId, true);
                // Zami: share the room key while the user writes (Element's
                // prepareToEncrypt), so sending in a large encrypted room
                // doesn't do it inside sendMessage. Throttled per room.
                void prepareToSend(room.roomId, {
                    delayMs: 0,
                    composing: true,
                });
            }
            // Idle-stop timer (UX): stop showing typing ~5s after the user
            // pauses. Separate from the wire timeout above.
            if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
            typingStopTimer.current = setTimeout(() => {
                const { room } = live.current;
                if (room) sendTyping(room.roomId, false);
                lastTypingSentAt.current = 0;
            }, 5000);
        }
    }

    // Zami: the editor's onclick, which re-reads the queries where a tap put
    // the caret. The TextInput reports every caret move; one that only echoes
    // a caret the model just placed is skipped (MODEL_SETTLE_MS).
    function onSelectionChange(selection: { start: number; end: number }) {
        // Zami: an arrow key a suggestion list took moved the caret too: put
        // it back (see onKeydown).
        const held = arrowCaret.current;
        if (held && Date.now() - held.at < MODEL_SETTLE_MS) {
            arrowCaret.current = null;
            if (
                selection.start !== held.selection.start ||
                selection.end !== held.selection.end
            ) {
                modelSetAt.current = Date.now();
                selectionRef.current = held.selection;
                textareaEl.current?.setSelection(
                    held.selection.start,
                    held.selection.end,
                );
            }
            return;
        }
        if (Date.now() - modelSetAt.current < MODEL_SETTLE_MS) return;
        selectionRef.current = selection;
        detectMentionQuery();
        detectEmojiQuery();
        detectSlashQuery();
    }

    function getReplyPreview(): string {
        if (!replyToEvent) return "";
        const content = replyToEvent.getContent();
        const body: string = content?.body ?? "";
        // Strip nested fallback quote prefix if present
        const parts = body.split("\n\n");
        const actual =
            parts.length >= 2 && parts[0].startsWith(">")
                ? parts.slice(1).join("\n\n")
                : body;
        return actual.length > 80 ? actual.slice(0, 80) + "…" : actual;
    }

    // Zami: `pb-[calc(1rem+env(safe-area-inset-bottom))]` (0.5rem from `md:`).
    // The keyboard covers the home indicator, so the inset only pads while
    // it's down: the parent lifts the composer by the keyboard's height.
    const paddingBottom =
        (windowSize.width >= 768 ? 8 : 16) +
        (keyboardHeight > 0 ? 0 : insets.bottom);

    // Zami: the editor's handlers, stable so it re-renders only for the text.
    const onChangeText = useStableCallback(syncFromEditor);
    const onEditorSelectionChange = useStableCallback(
        (e: { nativeEvent: { selection: { start: number; end: number } } }) =>
            onSelectionChange(e.nativeEvent.selection),
    );
    const onEditorSubmitEditing = useStableCallback(onSubmitEditing);
    const onEditorFocus = useCallback(() => setFocused(true), []);
    const onEditorBlur = useCallback(() => setFocused(false), []);

    // Zami: both of upstream's "+" menus (touch and desktop) take these props.
    function renderComposerActionsMenu() {
        return (
            <ComposerActionsMenu
                roomId={roomId}
                onClose={closeModal}
                onUpload={() => chooseFiles(pickFiles, onFileSelected)}
                onPickPhotos={
                    mobileMediaPicker
                        ? () => chooseFiles(pickPhotos, onFileSelected)
                        : undefined
                }
                onTakePhoto={
                    mobileMediaPicker && cameraSupported
                        ? () => chooseFiles(takePhoto, onFileSelected)
                        : undefined
                }
                onSendDirectly={
                    isThread
                        ? undefined
                        : () => chooseFiles(pickFiles, onDirectFileSelected)
                }
                onCreatePoll={() => openCreatePollDialog(roomId)}
                onRecordVoice={
                    voiceSupported && !isThread
                        ? () => {
                              closeModal();
                              setVoiceRecorderOpen(true);
                          }
                        : undefined
                }
                onShareLocation={() => openShareLocationDialog(roomId)}
                onCreateThread={
                    onThreadCreated && !isThread
                        ? () => setCreateThreadArmed(true)
                        : undefined
                }
                onInviteToGame={() => openGameInviteDialog(roomId)}
            />
        );
    }

    const closeIcon =
        "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";

    // Zami: not ported: `data-zam-region="composer"`, the DOM hook plugins
    // find the composer by (pluginDom.ts); there's no DOM for them to query.
    return (
        <View
            onAccessibilityEscape={onEscape}
            className="px-4 pt-2 flex-shrink-0 relative"
            style={{ paddingBottom }}
        >
            {/* Typing indicator: a reserved (fixed-height) row ABOVE the input, in
                flow within the composer's own space, so it never overlays the last
                message and never shifts the timeline when it appears or clears. */}
            <View className="h-4 mb-1 px-1">
                {typingUsers.length > 0 && (
                    <Text
                        numberOfLines={1}
                        className="text-xs leading-4 text-discord-textMuted"
                    >
                        {typingText()}
                    </Text>
                )}
            </View>
            {/* Reply preview bar */}
            {replyToEvent && (
                <View className="flex-row items-center gap-2 mb-1 px-3 py-1.5 bg-discord-backgroundTertiary rounded-t-lg border-s-2 border-discord-accent">
                    <SvgIcon
                        d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
                        className="w-4 h-4 text-discord-accent flex-shrink-0"
                    />
                    <View className="flex-1 min-w-0 flex-row items-baseline gap-2">
                        <Text className="text-xs text-discord-accent font-semibold flex-shrink-0">
                            {t("messageInput.replyingTo", { replyTargetName })}
                        </Text>
                        <Text
                            numberOfLines={1}
                            className="text-xs text-discord-textMuted min-w-0 flex-shrink"
                        >
                            {getReplyPreview()}
                        </Text>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("messageInput.cancelReplyEsc")}
                        onPress={() => onCancelReply?.()}
                        className="flex-shrink-0 p-0.5 rounded transition-colors"
                    >
                        <SvgIcon
                            d={closeIcon}
                            className="w-4 h-4 text-discord-textMuted"
                        />
                    </Pressable>
                </View>
            )}

            {/* In-flight attachment send indicator (drawer was cleared optimistically) */}
            {sendingRoomId === roomId && sendingFileCount > 0 && (
                <View className="flex-row items-center gap-2 mb-2">
                    <Spin>
                        <Loader2 className="w-3.5 h-3.5 text-discord-textMuted" />
                    </Spin>
                    <Text className="text-xs text-discord-textMuted">
                        {t("messageInput.sendingAttachments", {
                            count: sendingFileCount,
                        })}
                    </Text>
                    {uploadPercent !== null && (
                        <Text className="text-xs text-discord-textMuted tabular-nums">
                            {uploadPercent}%
                        </Text>
                    )}
                </View>
            )}
            {/* Outbox strip */}
            <OutboxStrip roomId={roomId} />
            {/* File queue preview */}
            {fileQueue.length > 0 && (
                <ScrollView
                    horizontal
                    keyboardShouldPersistTaps="handled"
                    showsHorizontalScrollIndicator={false}
                    className="mb-2"
                    contentContainerClassName="flex-row gap-2 pb-1"
                >
                    {fileQueue.map((item) => (
                        <View
                            key={item.id}
                            className="relative flex-shrink-0 flex-col items-center gap-1 w-20 p-2"
                        >
                            {/* Thumbnail or file icon (tap to rename) */}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t(
                                    "messageInput.editAttachment2",
                                    { name: item.name },
                                )}
                                onPress={() => openRename(item)}
                                className="w-20 h-20 rounded-lg bg-discord-backgroundTertiary flex-row items-center justify-center overflow-hidden border border-discord-divider hover:border-discord-accent transition-colors"
                            >
                                {item.previewUrl &&
                                item.file.type.startsWith("video/") ? (
                                    <QueuedVideoPreview
                                        url={item.previewUrl}
                                        onNoPicture={() =>
                                            dropQueuedFilePreview(
                                                effComposerKey,
                                                item.id,
                                            )
                                        }
                                    />
                                ) : item.previewUrl ? (
                                    <Image
                                        source={mediaSource(item.previewUrl)}
                                        accessibilityLabel={item.name}
                                        contentFit="cover"
                                        className="w-full h-full"
                                    />
                                ) : (
                                    <SvgIcon
                                        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"
                                        className="w-8 h-8 text-discord-textMuted"
                                    />
                                )}
                            </Pressable>
                            {/* Filename */}
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => openRename(item)}
                                className="w-full px-0.5"
                            >
                                <Text
                                    numberOfLines={1}
                                    className="text-[10px] text-discord-textMuted text-center leading-tight"
                                >
                                    {item.name}
                                </Text>
                            </Pressable>
                            {item.direct && (
                                <Text className="text-[10px] font-semibold text-discord-accent">
                                    {t("messageInput.directFile")}
                                </Text>
                            )}
                            {/* Remove button */}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t("common.remove")}
                                onPress={() => removeFromQueue(item.id)}
                                className="absolute -top-0 -end-1.5 w-5 h-5 rounded-full bg-discord-backgroundSecondary border border-discord-divider hover:bg-discord-messageHover flex-row items-center justify-center transition-colors"
                            >
                                <SvgIcon
                                    d={closeIcon}
                                    className="w-3 h-3 text-discord-textMuted"
                                />
                            </Pressable>
                        </View>
                    ))}
                </ScrollView>
            )}
            {renamingItem && modal === "rename-attachment" && (
                <RenameAttachmentDialog
                    name={renamingItem.name}
                    previewUrl={renamingItem.previewUrl}
                    video={renamingItem.file.type.startsWith("video/")}
                    direct={renamingItem.direct}
                    onSave={(name) =>
                        renameQueuedFile(effComposerKey, renamingItem.id, name)
                    }
                    onDirectChange={
                        isThread
                            ? undefined
                            : (direct) =>
                                  setQueuedFileDirect(
                                      effComposerKey,
                                      renamingItem.id,
                                      direct,
                                  )
                    }
                    onClose={closeModal}
                />
            )}
            {/* Emoji autocomplete picker */}
            {/* Zami: each list re-renders on its own as its query changes
                (SuggestionsView). */}
            <SuggestionsView suggestions={emoji}>
                {(emojiCandidates, emojiSelectedIdx) => (
                    <EmojiSuggestions
                        class="mb-1"
                        candidates={emojiCandidates}
                        selectedIdx={emojiSelectedIdx}
                        onSelectedIdxChange={emoji.setSelected}
                        onPick={commitEmoji}
                    />
                )}
            </SuggestionsView>

            {/* Mention autocomplete picker */}
            <SuggestionsView suggestions={mention}>
                {(mentionCandidates, mentionSelectedIdx) => (
                    <View className="mb-1 bg-discord-backgroundSecondary border border-discord-divider rounded-lg overflow-hidden shadow-lg">
                        {mentionCandidates.map((member, i) => (
                            <Pressable
                                // Upstream's `{#each}` is unkeyed: by index.
                                key={i}
                                accessibilityRole="button"
                                // Zami: `onpointerdown` → `onPressIn`, committing
                                // before the press ends as upstream does. Not
                                // ported: suppressNextClick(), since React Native
                                // retargets no trailing click.
                                onPressIn={() => commitMention(member)}
                                onHoverIn={() => mention.setSelected(i)}
                                className={`w-full flex-row items-center gap-2.5 px-3 py-1.5 transition-colors ${
                                    i === mentionSelectedIdx
                                        ? "bg-discord-messageHover"
                                        : ""
                                }`}
                            >
                                <Avatar
                                    src={getMemberAvatar(room!, member.userId)}
                                    name={
                                        member.rawDisplayName || member.userId
                                    }
                                    id={member.userId}
                                    size={24}
                                />
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-sm text-discord-textPrimary font-medium truncate"
                                >
                                    {member.rawDisplayName || member.userId}
                                </Text>
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-xs text-discord-textMuted truncate"
                                >
                                    {member.userId}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                )}
            </SuggestionsView>

            {/* Slash-command autocomplete picker */}
            <SuggestionsView suggestions={slash}>
                {(slashCandidates, slashSelectedIdx) => (
                    <View className="mb-1 bg-discord-backgroundSecondary border border-discord-divider rounded-lg overflow-hidden shadow-lg">
                        {slashCandidates.map((command, i) => (
                            <Pressable
                                key={i}
                                accessibilityRole="button"
                                // See the mention picker: committed on the press's
                                // start.
                                onPressIn={() => commitSlashCommand(command)}
                                onHoverIn={() => slash.setSelected(i)}
                                className={`w-full flex-row items-center gap-2.5 px-3 py-1.5 transition-colors ${
                                    i === slashSelectedIdx
                                        ? "bg-discord-messageHover"
                                        : ""
                                }`}
                            >
                                <Text
                                    style={styles.mono}
                                    className="text-sm text-discord-textPrimary flex-shrink-0"
                                >
                                    /{command.name}
                                </Text>
                                {command.argHint && (
                                    <Text
                                        style={styles.mono}
                                        className="text-xs text-discord-textMuted flex-shrink-0"
                                    >
                                        {command.argHint}
                                    </Text>
                                )}
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-xs text-discord-textMuted truncate ms-auto"
                                >
                                    {command.description}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                )}
            </SuggestionsView>

            {/* Armed "create thread" banner: mirrors the reply banner pattern */}
            {createThreadArmed && !isThread && (
                <View className="flex-row items-center justify-between gap-2 px-3 py-1.5 bg-discord-backgroundSecondary rounded-t-lg">
                    <Text className="flex-shrink text-xs text-discord-textMuted">
                        {t("messageInput.yourNextMessageWillStartA")}{" "}
                        <Text className="text-xs font-bold text-discord-textMuted">
                            {t("messageInput.thread")}
                        </Text>
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t(
                            "messageInput.cancelThreadCreation",
                        )}
                        onPress={() => setCreateThreadArmed(false)}
                        className="p-0.5 rounded transition-colors"
                    >
                        <SvgIcon
                            d={closeIcon}
                            className="w-3.5 h-3.5 text-discord-textMuted"
                        />
                    </Pressable>
                </View>
            )}

            {voiceRecorderOpen ? (
                <VoiceRecorder
                    roomId={roomId}
                    getRelation={() => {
                        const { replyToEvent } = live.current;
                        return isThread || replyToEvent
                            ? {
                                  rootEventId: isThread
                                      ? threadRootId!
                                      : undefined,
                                  replyToEventId:
                                      replyToEvent?.getId() ?? undefined,
                              }
                            : undefined;
                    }}
                    onSent={(relation) => {
                        if (
                            relation?.replyToEventId &&
                            live.current.replyToEvent?.getId() ===
                                relation.replyToEventId
                        )
                            live.current.onCancelReply?.();
                    }}
                    onClose={() => setVoiceRecorderOpen(false)}
                />
            ) : (
                // Zami: `.input-box:focus-within`'s border, from the TextInput's
                // focus.
                <View
                    className={`relative flex-row items-end gap-2 bg-discord-backgroundSecondary rounded-lg px-2.5 py-2.5 border transition-colors ${
                        focused
                            ? "border-discord-accent/30"
                            : "border-transparent"
                    } ${replyToEvent ? "rounded-ss-none" : ""}`}
                >
                    {/* "+" actions menu */}
                    <View className="flex-shrink-0 relative">
                        {/* Double-click: straight to the file picker, as if "Upload a
                            file" had been chosen from the menu the first click
                            opened.
                            Zami: not ported: the double click, which a touch has
                            no `detail` count for. */}
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("common.add")}
                            accessibilityState={{
                                disabled,
                                expanded: showActionsMenu,
                            }}
                            onPress={() => {
                                if (showActionsMenu) {
                                    closeModal();
                                } else {
                                    openComposerActions(effComposerKey);
                                }
                            }}
                            disabled={disabled}
                            className={`relative p-1.5 rounded hover:bg-discord-messageHover transition-colors disabled:opacity-40 ${
                                showActionsMenu ? "z-50" : ""
                            }`}
                        >
                            <Plus
                                size={20}
                                className="text-discord-textMuted"
                            />
                        </Pressable>
                        {showActionsMenu &&
                            (isTouchscreen ? (
                                // Zami: `position: fixed` → the root's portal
                                // layer, its backdrop filling it.
                                <Portal>
                                    <Pressable
                                        accessible={false}
                                        onPress={closeModal}
                                        className="absolute inset-0 z-40"
                                    />
                                    <View
                                        className="absolute start-2 z-50"
                                        style={{ bottom: keyboardOffset + 8 }}
                                    >
                                        {renderComposerActionsMenu()}
                                    </View>
                                </Portal>
                            ) : (
                                // Zami: not ported: the desktop menu's backdrop
                                // (it would cover the menu, which stays in
                                // place beside its button).
                                <View className="absolute bottom-full start-0 mb-2 z-50">
                                    {renderComposerActionsMenu()}
                                </View>
                            ))}
                    </View>

                    {/* autocapitalize/spellcheck: Android IMEs (Samsung One UI
                        especially) suppress the suggestion strip on a bare
                        contenteditable that sets neither, so a rich-composer div
                        needs them spelled out to get the word suggestions a plain
                        <textarea> would get for free. spellcheck follows the
                        "Check spelling" setting; autocorrect is the Safari name for
                        the same keyboard behaviour. */}
                    <View className="flex-1 min-w-0 relative">
                        {/* Zami: `.composer-editor:empty::before`, the placeholder
                            as one line that ellipsizes: a long room name must never
                            wrap and grow the composer (a TextInput's own
                            placeholder would). */}
                        {textEmpty && (
                            <View
                                pointerEvents="none"
                                className="absolute inset-x-0 top-0 py-[6px]"
                            >
                                <Text
                                    numberOfLines={1}
                                    className="text-[16px] text-discord-textMuted"
                                >
                                    {composerPlaceholder}
                                </Text>
                            </View>
                        )}
                        {/* Zami: the TextInput and its decorated text, which
                            re-render on their own per keystroke. */}
                        <ComposerEditor
                            ref={textareaEl}
                            textStore={textStore}
                            decorate={decorate}
                            multiline
                            onChangeText={onChangeText}
                            onSelectionChange={onEditorSelectionChange}
                            submitBehavior={
                                isMobile && !hardwareKeyboard
                                    ? "newline"
                                    : "submit"
                            }
                            onSubmitEditing={onEditorSubmitEditing}
                            onFocus={onEditorFocus}
                            onBlur={onEditorBlur}
                            accessibilityLabel={composerPlaceholder}
                            editable={!disabled}
                            autoCapitalize="sentences"
                            spellCheck={spellCheckEnabled}
                            {...(spellCheckEnabled
                                ? {}
                                : { autoCorrect: false })}
                            textAlignVertical="top"
                            // Zami: `.composer-editor`'s min-height and the 26px
                            // line upstream's `leading-relaxed` gives it, as
                            // padding around the TextInput's own line.
                            className="w-full min-h-[32px] max-h-48 bg-transparent text-discord-textPrimary text-[16px] py-[6px]"
                        />
                    </View>

                    {/* GIF picker button */}
                    {/* `hidden` goes on the WRAPPER too: hiding only the button leaves
                        an empty flex item behind, and the row's gap-2 then reserves 8px
                        of dead space on touchscreens. Gated on the picker being CLOSED
                        because the GIF picker is also reachable on touch via another
                        picker's tab strip (onSwitchToGif), and display:none on the
                        wrapper would hide that picker's subtree with it. The button
                        keeps its own `hidden` so it never becomes visible on touch. */}
                    <View
                        className={`flex-shrink-0 ${
                            isTouchscreen && !showGifPicker ? "hidden" : ""
                        }`}
                    >
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("messageInput.favouriteGifs")}
                            onPress={() => openPicker("gif")}
                            disabled={disabled}
                            className={`${
                                isTouchscreen ? "hidden" : ""
                            } p-1.5 rounded hover:bg-discord-messageHover transition-colors disabled:opacity-40`}
                        >
                            <ImagePlay
                                size={20}
                                className="text-discord-textMuted"
                            />
                        </Pressable>
                        {showGifPicker &&
                            (isTouchscreen ? (
                                <PickerDock
                                    onClose={closeModal}
                                    keyboardOffset={keyboardOffset}
                                >
                                    <GifPicker
                                        onSelect={insertGif}
                                        onSelectFile={(f) => addFiles([f])}
                                        onClose={() => closePicker("gif", true)}
                                        onSwitchToEmoji={() =>
                                            openPicker("emoji")
                                        }
                                        onSwitchToSticker={() =>
                                            openPicker("sticker")
                                        }
                                    />
                                </PickerDock>
                            ) : (
                                // Zami: not ported: the backdrop, as for the "+" menu.
                                <View className="absolute bottom-full end-0 mb-2 z-50">
                                    <GifPicker
                                        onSelect={insertGif}
                                        onSelectFile={(f) => addFiles([f])}
                                        onClose={() => closePicker("gif", true)}
                                        onSwitchToEmoji={() =>
                                            openPicker("emoji")
                                        }
                                        onSwitchToSticker={() =>
                                            openPicker("sticker")
                                        }
                                    />
                                </View>
                            ))}
                    </View>

                    {/* Sticker button */}
                    {/* Wrapper `hidden` on touch mirrors the button's own `hidden` so no dead flex gap remains. */}
                    <View
                        className={`flex-shrink-0 ${
                            isTouchscreen && !showStickerPicker ? "hidden" : ""
                        }`}
                    >
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("common.stickers")}
                            onPress={() => openPicker("sticker")}
                            className={`${
                                isTouchscreen ? "hidden" : ""
                            } p-1.5 rounded hover:bg-discord-messageHover transition-colors disabled:opacity-40`}
                            disabled={disabled}
                        >
                            <Sticker
                                size={20}
                                className="text-discord-textMuted"
                            />
                        </Pressable>
                        {showStickerPicker &&
                            (isTouchscreen ? (
                                <PickerDock
                                    onClose={closeModal}
                                    keyboardOffset={keyboardOffset}
                                >
                                    <StickerPicker
                                        roomId={roomId}
                                        onSelect={sendStickerMessage}
                                        onClose={() =>
                                            closePicker("sticker", true)
                                        }
                                        onSwitchToEmoji={() =>
                                            openPicker("emoji")
                                        }
                                        onSwitchToGif={() => openPicker("gif")}
                                    />
                                </PickerDock>
                            ) : (
                                <View className="absolute bottom-full end-0 mb-2 z-50">
                                    <StickerPicker
                                        roomId={roomId}
                                        onSelect={sendStickerMessage}
                                        onClose={() =>
                                            closePicker("sticker", true)
                                        }
                                        onSwitchToEmoji={() =>
                                            openPicker("emoji")
                                        }
                                        onSwitchToGif={() => openPicker("gif")}
                                    />
                                </View>
                            ))}
                    </View>

                    {/* Emoji button */}
                    <View className="flex-shrink-0">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("common.emoji")}
                            onPress={() => openPicker("emoji")}
                            className="p-1.5 rounded hover:bg-discord-messageHover transition-colors disabled:opacity-40"
                            disabled={disabled}
                        >
                            <Smile
                                size={20}
                                className="text-discord-textMuted"
                            />
                        </Pressable>
                        {showEmojiPicker &&
                            (isTouchscreen ? (
                                <PickerDock
                                    onClose={closeModal}
                                    keyboardOffset={keyboardOffset}
                                >
                                    <EmojiPicker
                                        room={room}
                                        onSelect={insertEmoji}
                                        onSelectCustom={insertCustomEmoji}
                                        onClose={() =>
                                            closePicker("emoji", true)
                                        }
                                        onSwitchToSticker={() =>
                                            openPicker("sticker")
                                        }
                                        onSwitchToGif={() => openPicker("gif")}
                                    />
                                </PickerDock>
                            ) : (
                                <View className="absolute bottom-full end-0 mb-2 z-50">
                                    <EmojiPicker
                                        room={room}
                                        onSelect={insertEmoji}
                                        onSelectCustom={insertCustomEmoji}
                                        onClose={() =>
                                            closePicker("emoji", true)
                                        }
                                        onSwitchToSticker={() =>
                                            openPicker("sticker")
                                        }
                                        onSwitchToGif={() => openPicker("gif")}
                                    />
                                </View>
                            ))}
                    </View>

                    {/* Plugin composer buttons */}
                    {pluginComposerButtonViews.map((btn) => (
                        <View key={btn.entryId} className="flex-shrink-0">
                            <Pressable
                                ref={(el) => {
                                    if (!el) return;
                                    pluginButtonEls.current.set(
                                        btn.entryId,
                                        el,
                                    );
                                    return () => {
                                        pluginButtonEls.current.delete(
                                            btn.entryId,
                                        );
                                    };
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={btn.label}
                                onPress={() => {
                                    // Zami: `e.currentTarget`, the anchor a plugin
                                    // places its popover by, as anchorElement
                                    // measures the button.
                                    void anchorElement(
                                        pluginButtonEls.current.get(
                                            btn.entryId,
                                        ) ?? null,
                                    ).then((anchor) => {
                                        try {
                                            const r = btn.onClick(anchor);
                                            if (
                                                r &&
                                                typeof r.then === "function"
                                            )
                                                r.catch((err) =>
                                                    console.error(
                                                        "[zam] plugin composer button threw",
                                                        err,
                                                    ),
                                                );
                                        } catch (err) {
                                            console.error(
                                                "[zam] plugin composer button threw",
                                                err,
                                            );
                                        }
                                    });
                                }}
                                disabled={disabled}
                                className="p-1.5 rounded hover:bg-discord-messageHover transition-colors disabled:opacity-40"
                            >
                                {btn.icon ? (
                                    <SvgIcon
                                        d={btn.icon}
                                        className="w-5 h-5 text-discord-textMuted"
                                    />
                                ) : (
                                    <Text className="text-xs font-semibold text-discord-textMuted">
                                        {btn.label.slice(0, 2)}
                                    </Text>
                                )}
                            </Pressable>
                        </View>
                    ))}

                    {/* Zami: upstream's `onpointerdown` preventDefault keeps the
                        editor focused (and the keyboard up) through the tap; a
                        Pressable takes no focus from it. */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("messageInput.sendMessage")}
                        onPress={() => void sendFromButton()}
                        disabled={
                            (textBlank && fileQueue.length === 0) ||
                            isSending ||
                            disabled
                        }
                        className="flex-shrink-0 p-1.5 rounded transition-colors hover:bg-discord-messageHover disabled:opacity-40"
                    >
                        {isSending ? (
                            // Zami: `border-current` → the button's text color.
                            <Spin
                                className={`w-5 h-5 border-2 ${
                                    canSend
                                        ? "border-discord-accent"
                                        : "border-discord-textMuted"
                                } border-t-transparent rounded-full`}
                            />
                        ) : (
                            <SendHorizontal
                                size={20}
                                className={
                                    canSend
                                        ? "text-discord-accent"
                                        : "text-discord-textMuted"
                                }
                            />
                        )}
                    </Pressable>
                </View>
            )}
            {/* Typing indicator now floats ABOVE the input (see the overlay at the top
                of this container); the "Enter to send" hint was dropped for a cleaner,
                flush composer. */}
        </View>
    );
}

const styles = StyleSheet.create({
    fill: { width: "100%", height: "100%" },
    mono: { fontFamily: MONO },
});
