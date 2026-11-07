// The inline message editor: a small rich contenteditable on the same
// model as the composer (plain text, decorated so custom emotes show their
// image), with the composer's `:shortcode` suggestions and conversion.
// Zami: a multiline TextInput holding the same plain-text model.
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import {
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type Ref,
} from "react";
import {
    Keyboard,
    TextInput,
    View,
    useWindowDimensions,
    type HostInstance,
    type TextInputInstance,
} from "react-native";
import type { Room } from "matrix-js-sdk";
import { t } from "$lib/i18n";
import { getCustomEmojis } from "$lib/matrix/client";
import { roomsState } from "$lib/stores/rooms.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import type { EmojiSubstitution } from "$lib/utils/messageBody";
import { convertTrailingShortcode } from "$lib/data/emojiShortcodes";
import { diffCaret } from "$lib/utils/textUndo";
import {
    applyEmojiCandidate,
    findEmojiQuery,
    rankEmojiCandidates,
    type EmojiCandidate,
    type EmojiQuery,
} from "$lib/utils/emojiAutocomplete";
import EmojiSuggestions from "$lib/components/messages/EmojiSuggestions.svelte";

// The list floats over the timeline rather than pushing it around:
// above the editor when it fits in the scroller, else below.
const ROW_PX = 36;

export default function MessageEditBox({
    text = "",
    onTextChange,
    editorEl,
    room,
    messageEmotes = [],
    onSave,
    onCancel,
}: {
    text?: string;
    /** Zami: the write half of `bind:text`. */
    onTextChange?: (text: string) => void;
    /** Zami: `bind:editorEl`, as a ref to the TextInput (MessageItem focuses it). */
    editorEl?: Ref<TextInputInstance>;
    room: Room;
    /** The edited message's own emotes, which survive a removed pack. */
    messageEmotes?: EmojiSubstitution[];
    onSave: () => void;
    onCancel: () => void;
}) {
    const inputEl = useRef<TextInputInstance>(null);
    useImperativeHandle(editorEl, () => inputEl.current as TextInputInstance);
    const windowSize = useWindowDimensions();
    const spellCheckEnabled = useRune(() => settingsState.spellCheckEnabled);

    const packEmojis = useRune(
        () => getCustomEmojis(room, roomsState.activeSpaceId),
        [room],
    );

    // Shortcode → mxc for every emote the edit can use; the packs win on a
    // clash, as in sendMessageEdit.
    const emoteMxc = useMemo(
        () =>
            new Map(
                [...messageEmotes, ...packEmojis].map((e) => [
                    e.shortcode,
                    e.mxcUrl,
                ]),
            ),
        [messageEmotes, packEmojis],
    );

    // Zami: not ported: render(), which redraws the editor from the model with
    // custom emotes as their images (decorateComposerText's HTML). A TextInput
    // holds plain text, so an emote shows as its `:shortcode:`. What's left of it
    // is placing the caret: the text and caret the TextInput last reported, and
    // the caret to restore once a text the model changed has rendered.
    const textRef = useRef(text);
    const caretRef = useRef(text.length);
    const pendingCaret = useRef<number | null>(null);
    const [caretTick, setCaretTick] = useState(0);
    useLayoutEffect(() => {
        textRef.current = text;
    }, [text]);
    useEffect(() => {
        const pos = pendingCaret.current;
        if (pos === null) return;
        pendingCaret.current = null;
        caretRef.current = pos;
        inputEl.current?.setSelection(pos, pos);
    }, [caretTick]);
    function render(nextCaret: number) {
        pendingCaret.current = nextCaret;
        setCaretTick((n) => n + 1);
    }

    function caret(): number {
        return caretRef.current;
    }

    function setText(next: string, nextCaret: number) {
        textRef.current = next;
        onTextChange?.(next);
        render(nextCaret);
        detectEmojiQuery(next, nextCaret);
    }

    // onMount: render(text.length).
    // Zami: this caret is also where the first focus() finds it, which stands
    // in for upstream's onFocus: "A plain focus() leaves the caret at the start;
    // editing usually continues at the end, as a textarea's first focus did."
    useEffect(() => {
        render(textRef.current.length);
    }, []);

    // Zami: not ported: the model's undo history (TextUndoHistory). It stands in
    // for the native undo stack that render() wipes, and backs Ctrl+Z/Ctrl+Y and
    // `historyUndo`; the TextInput keeps its own undo (shake to undo on iOS).

    // `:shortcode` suggestions.
    const [emojiQuery, setEmojiQuery] = useState<EmojiQuery | null>(null);
    const emojiQueryRef = useRef<EmojiQuery | null>(null);
    const [emojiIdx, setEmojiIdx] = useState(0);
    const emojiCandidates = useMemo(
        (): EmojiCandidate[] =>
            emojiQuery ? rankEmojiCandidates(emojiQuery.query, packEmojis) : [],
        [emojiQuery, packEmojis],
    );
    useEffect(() => {
        if (emojiIdx >= emojiCandidates.length) setEmojiIdx(0);
    }, [emojiIdx, emojiCandidates.length]);

    const [emojiBelow, setEmojiBelow] = useState(false);
    const boxEl = useRef<HostInstance>(null);

    // Zami: the editor's place in the window stands in for its rect within the
    // scroller (the timeline, which this can't find); the keyboard's top, when
    // it is up, is the bottom.
    function placeEmojiList(rows: number) {
        boxEl.current?.measureInWindow((_x, y, _width, height) => {
            const top = 0;
            const bottom = Keyboard.metrics()?.screenY ?? windowSize.height;
            const needed = rows * ROW_PX + 8;
            const above = y - top;
            const below = bottom - (y + height);
            setEmojiBelow(above < needed && below > above);
        });
    }

    function detectEmojiQuery(current = textRef.current, at = caret()) {
        const wasOpen = emojiQueryRef.current !== null;
        const query = findEmojiQuery(current, at);
        emojiQueryRef.current = query;
        setEmojiQuery(query);
        if (query && !wasOpen) placeEmojiList(8);
    }

    function commitEmoji(candidate: EmojiCandidate) {
        if (!emojiQuery) return;
        const next = applyEmojiCandidate(
            textRef.current,
            emojiQuery,
            candidate,
        );
        emojiQueryRef.current = null;
        setEmojiQuery(null);
        inputEl.current?.focus();
        textRef.current = next.text;
        onTextChange?.(next.text);
        render(next.caret);
    }

    // Zami: not ported: IME composition tracking (`composing`). The TextInput
    // owns its marked text, and onChangeText reports the text with it.

    /** Read the editor into the model. */
    function syncFromEditor(next: string) {
        // Zami: the caret after the edit, from what changed: onChangeText
        // fires before onSelectionChange reports it.
        let pos = diffCaret(textRef.current, next);
        let value = next;
        // Typing the closing colon of a unicode shortcode converts it, like
        // the composer (":tm:" → ™️). Custom emotes keep their token.
        const converted = convertTrailingShortcode(
            value.slice(0, pos),
            (code) => emoteMxc.has(code),
        );
        if (converted !== null) {
            value = converted + value.slice(pos);
            pos = converted.length;
            setText(value, pos);
            return;
        }
        textRef.current = value;
        caretRef.current = pos;
        onTextChange?.(value);
        detectEmojiQuery(value, pos);
    }

    // Zami: onKeydown, for the keys a TextInput reports. Enter is the return
    // key, which submits rather than adding a line (`submitBehavior="submit"`),
    // as Enter saves here on every platform; Escape is VoiceOver's escape
    // gesture. Not ported: Shift+Enter for a line break, Ctrl+Z/Ctrl+Y, and the
    // arrow keys and Tab in the suggestion list: hardware-keyboard keys a
    // TextInput doesn't report.
    function onSubmitEditing() {
        // An open suggestion list takes the keys first: Enter/Tab pick and
        // Escape closes it before a second Escape cancels the edit.
        if (emojiQuery && emojiCandidates.length > 0) {
            const candidate = emojiCandidates[emojiIdx];
            if (candidate) commitEmoji(candidate);
            return;
        }
        onSave();
    }
    function onEscape() {
        if (emojiQuery && emojiCandidates.length > 0) {
            emojiQueryRef.current = null;
            setEmojiQuery(null);
            return;
        }
        onCancel();
    }

    return (
        <View ref={boxEl} onAccessibilityEscape={onEscape} className="relative">
            <TextInput
                ref={inputEl}
                multiline
                value={text}
                onChangeText={syncFromEditor}
                onSelectionChange={(e) => {
                    caretRef.current = e.nativeEvent.selection.end;
                    // Upstream re-reads the query on a click, which moves the caret.
                    detectEmojiQuery();
                }}
                onSubmitEditing={onSubmitEditing}
                submitBehavior="submit"
                onBlur={() => {
                    emojiQueryRef.current = null;
                    setEmojiQuery(null);
                }}
                accessibilityLabel={t("messageItem.editMessage")}
                autoCapitalize="sentences"
                spellCheck={spellCheckEnabled}
                {...(spellCheckEnabled ? {} : { autoCorrect: false })}
                textAlignVertical="top"
                // Zami: `.composer-editor`'s min-height (1.625rem).
                className="w-full min-h-[26px] max-h-[200px] bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-2 py-1.5 focus:ring-1 focus:ring-discord-accent/50"
            />
            {emojiQuery && emojiCandidates.length > 0 && (
                <EmojiSuggestions
                    class={`absolute inset-x-0 z-20 ${
                        emojiBelow ? "top-full mt-1" : "bottom-full mb-1"
                    }`}
                    candidates={emojiCandidates}
                    selectedIdx={emojiIdx}
                    onSelectedIdxChange={setEmojiIdx}
                    onPick={commitEmoji}
                />
            )}
        </View>
    );
}
