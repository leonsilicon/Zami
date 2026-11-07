// The inline message editor: a small rich contenteditable on the same
// model as the composer (plain text, decorated so custom emotes show their
// image), with the composer's `:shortcode` suggestions and conversion.
// Zami: a multiline TextInput holding the same plain-text model.
import { isModifierHeld, useInputKeys } from "@-/com.leonsilicon.zami.browser";
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
    // Zami: where the selection the TextInput last reported starts (upstream's
    // selectedLength), for replaceSelection.
    const selectionStartRef = useRef(text.length);
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
        selectionStartRef.current = pos;
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

    function replaceSelection(insert: string) {
        const end = caret();
        const start = Math.min(selectionStartRef.current, end);
        setText(
            textRef.current.slice(0, start) +
                insert +
                textRef.current.slice(end),
            start + insert.length,
        );
    }

    // Zami: not ported: IME composition tracking (`composing`). The TextInput
    // owns its marked text, and onChangeText reports the text with it.

    /** Read the editor into the model. */
    function syncFromEditor(next: string) {
        // Zami: a hardware Tab the suggestion list took (onKeydown) types a
        // tab, after accepting any autocorrection of the shortcode being
        // completed. The autocorrection is dropped, and the tab picks from
        // the list as it stood.
        const prev = textRef.current;
        const tab = tabPick.current;
        if (tab && Date.now() - tab.at < 300) {
            const tabs = (value: string) => value.split("\t").length;
            if (tabs(next) <= tabs(prev)) return;
            clearTimeout(tab.timer);
            tabPick.current = null;
            const candidate = emojiCandidates[emojiIdx];
            if (emojiQueryRef.current && candidate) {
                commitEmoji(candidate);
                return;
            }
        }
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
        selectionStartRef.current = pos;
        onTextChange?.(value);
        detectEmojiQuery(value, pos);
    }

    // Zami: hardware key presses are observed, not intercepted (see
    // @-/com.leonsilicon.zami.browser), so the TextInput has taken each key by
    // the time onKeydown runs. Enter is the return key, which submits rather
    // than adding a line (`submitBehavior="submit"`), as Enter saves here on
    // every platform: onSubmitEditing saves, picks from the suggestion list,
    // or with Shift held adds a line. Tab in the suggestion list types a tab
    // (after accepting any autocorrection), which picks instead of landing
    // (syncFromEditor), and the arrow keys
    // there also move the caret, which is put back (onSelectionChange).
    // Escape is also VoiceOver's escape gesture (onEscape). Not ported:
    // Ctrl+Z/Ctrl+Y through TextUndoHistory (see above).

    /** Zami: a Tab the suggestion list took, until the text it typed arrives
     *  (syncFromEditor), or with none, until it picks on its own. */
    const tabPick = useRef<{
        at: number;
        timer: ReturnType<typeof setTimeout>;
    } | null>(null);

    /** Zami: a caret an arrow key moved while the suggestion list had it. */
    const arrowCaret = useRef<{
        start: number;
        end: number;
        at: number;
    } | null>(null);

    function onKeydown(e: KeyboardEvent) {
        if (e.isComposing) return;
        // An open suggestion list takes the keys first: Enter/Tab pick and
        // Escape closes it before a second Escape cancels the edit.
        if (emojiQuery && emojiCandidates.length > 0) {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                arrowCaret.current = {
                    start: selectionStartRef.current,
                    end: caretRef.current,
                    at: Date.now(),
                };
                const step = e.key === "ArrowUp" ? -1 : 1;
                setEmojiIdx(
                    (emojiIdx + step + emojiCandidates.length) %
                        emojiCandidates.length,
                );
                return;
            }
            if (e.key === "Tab") {
                e.preventDefault();
                const candidate = emojiCandidates[emojiIdx];
                if (tabPick.current) clearTimeout(tabPick.current.timer);
                tabPick.current = {
                    at: Date.now(),
                    timer: setTimeout(() => {
                        tabPick.current = null;
                        if (candidate) commitEmoji(candidate);
                    }, 300),
                };
                return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                emojiQueryRef.current = null;
                setEmojiQuery(null);
                return;
            }
        }
        if (e.key === "Enter") {
            e.preventDefault();
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
        }
    }

    // Zami: `onkeydown={onKeydown}` on the editor.
    useInputKeys(inputEl, { onKeydown });

    function onSubmitEditing() {
        // Zami: Shift+Enter on a hardware keyboard: a line break.
        if (isModifierHeld("Shift")) {
            replaceSelection("\n");
            return;
        }
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
                    const { start, end } = e.nativeEvent.selection;
                    // Zami: an arrow key the suggestion list took moved the
                    // caret too: put it back (see onKeydown).
                    const held = arrowCaret.current;
                    if (held && Date.now() - held.at < 250) {
                        arrowCaret.current = null;
                        if (start !== held.start || end !== held.end)
                            inputEl.current?.setSelection(held.start, held.end);
                        return;
                    }
                    caretRef.current = end;
                    selectionStartRef.current = start;
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
