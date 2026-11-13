import { keepFocus, useInputKeys } from "@-/com.leonsilicon.zami.browser";
import { roomStateRevision } from "@-/com.leonsilicon.zami.incremental";
import { Spin } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    FlatList,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
    type TextInputInstance,
} from "react-native";
import { t } from "$lib/i18n";
import type { Room, ISearchResults, MatrixEvent } from "matrix-js-sdk";
import {
    searchRoomMessages,
    searchRoomMessagesMore,
    searchLocalIndex,
    isEventIndexActive,
    getMemberName,
    getMemberAvatar,
    getRoomMembers,
} from "$lib/matrix/client";
import {
    buildSnippetSegments,
    isSearchUnsupportedError,
    parseSearchQuery,
    buildServerSearchFilter,
    matchesParsedQuery,
    parsedQueryNeedsClientRefine,
    type ParsedSearchQuery,
    type SearchEventMeta,
} from "$lib/utils/messageSearch";
import {
    activeSearchToken,
    filterMemberSuggestions,
    hasValueSuggestions,
    operatorSuggestions,
    applySuggestion,
    type ActiveSearchToken,
} from "$lib/utils/searchAutocomplete";
import { createStaleGuard } from "$lib/utils/staleGuard";
import { searchState } from "$lib/stores/search.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";
import Avatar from "$lib/components/ui/Avatar.svelte";
import { compactDateTime } from "$lib/utils/timeFormat";

interface Props {
    room: Room;
    onClose: () => void;
    onJumpTo: (eventId: string) => void;
}

export default function MessageSearchPanel({ room, onClose, onJumpTo }: Props) {
    const isMobile = useRune(() => interfaceState.isMobile);

    const [term, setTerm] = useState("");
    const [searched, setSearched] = useState<string | null>(null);
    const [searching, setSearching] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // The SDK mutates the results object in place on pagination (same
    // reference), so hold it raw and bump a tick for reactivity.
    const [results, setResults] = useState<ISearchResults | null>(null);
    const [resultsTick, setResultsTick] = useState(0);
    const inputEl = useRef<TextInputInstance>(null);
    const [searchedQuery, setSearchedQuery] =
        useState<ParsedSearchQuery | null>(null);
    const [activeToken, setActiveToken] = useState<ActiveSearchToken | null>(
        null,
    );
    // Encrypted rooms: matches from the on-device index (the server can't
    // read those messages). The server search still runs alongside, for the
    // plaintext history from before the room was encrypted that the index
    // hasn't reached yet; the two are merged.
    const [localEvents, setLocalEvents] = useState<MatrixEvent[]>([]);
    const [usedLocal, setUsedLocal] = useState(false);
    // Bumped per search and per room switch: only the latest local search
    // may write its results.
    const localGen = useRef(0);
    const [selectedIdx, setSelectedIdx] = useState(0);
    // Zami: what `inputEl.value` and `inputEl.selectionStart` read on the
    // web: the text and caret the TextInput last reported. onChangeText fires
    // before onSelectionChange, so the token is right once both have run.
    const inputValue = useRef("");
    const inputCaret = useRef(0);
    // Zami: the caret `commit` restores once the completed text is rendered,
    // and a tick that schedules it (the text may not have changed).
    const pendingCaret = useRef<number | null>(null);
    const [commitTick, setCommitTick] = useState(0);

    // The panel is NOT keyed by room (MessageArea passes `room` as a plain
    // prop), so a room switch leaves the previous room's /search in flight.
    // One guard covers both the search and its pagination: whichever request
    // starts last is the only one allowed to write.
    const [requests] = useState(createStaleGuard);

    // Reset when switching rooms. Cancelling the guard is what stops the old
    // room's in-flight response from painting itself into the new room; the
    // spinner flags are cleared here because that superseded run will report
    // nothing at all.
    useEffect(() => {
        void room.roomId;
        requests.cancel();
        setTerm("");
        inputValue.current = "";
        setSearched(null);
        setResults(null);
        setError(null);
        setSearching(false);
        setLoadingMore(false);
        setSearchedQuery(null);
        setActiveToken(null);
        setLocalEvents([]);
        setUsedLocal(false);
        localGen.current++;
    }, [room.roomId, requests]);

    // Zami: focusing the input when the panel opens is its `autoFocus`
    // (upstream passes preventScroll so the mobile slide-in doesn't scroll
    // MessageArea's root sideways; a native input never scrolls its parent).

    async function runSearch() {
        const query = term.trim();
        const parsed = parseSearchQuery(query);
        // Block only if the WHOLE query is empty (no term, no operators), or already searching.
        if (
            parsed.term === "" &&
            parsed.senders.length === 0 &&
            parsed.has.length === 0
        )
            return;
        if (searching) return;
        setSearching(true);
        setError(null);
        setResults(null);
        // A new search discards the page `loadMore` was extending, and the
        // shared guard makes that pagination stale — so it will report nothing
        // and can no longer clear its own flag. Clear it here, next to the
        // results it belonged to, or the "Load more" button comes back
        // permanently stuck on "Loading…".
        setLoadingMore(false);
        setLocalEvents([]);
        const gen = ++localGen.current;
        const isLocal = isEventIndexActive() && room.hasEncryptionStateEvent();
        setUsedLocal(isLocal);
        // Local hits can paint before the server answers.
        if (isLocal) {
            setSearched(query);
            setSearchedQuery(parsed);
        }
        const local = isLocal
            ? searchLocalIndex(room.roomId, parsed, (partial) => {
                  if (gen === localGen.current) setLocalEvents(partial);
              }).then(
                  (r) => {
                      if (gen === localGen.current) setLocalEvents(r.events);
                  },
                  (e) => console.warn("Local search failed", e),
              )
            : Promise.resolve();
        const outcome = await requests.run(() =>
            searchRoomMessages(
                room.roomId,
                parsed.term,
                buildServerSearchFilter(room.roomId, parsed),
            ),
        );
        await local;
        // Superseded by a room switch or a newer request — the run that
        // replaced us owns `searching`, `results` and `error` now.
        if (outcome.status === "stale") return;
        setSearching(false);
        if (outcome.status === "ok") {
            setResults(outcome.value);
            setSearched(query);
            setSearchedQuery(parsed);
            setResultsTick((n) => n + 1);
            return;
        }
        const e = outcome.error;
        // The index answered: a server that can't search (or failed) only
        // costs the pre-encryption history, so show what we have.
        if (isLocal) {
            console.warn("Server search failed; showing local results", e);
            setSearched(query);
            setSearchedQuery(parsed);
            setResultsTick((n) => n + 1);
            return;
        }
        if (isSearchUnsupportedError(e)) {
            console.warn(
                "Message search: homeserver does not support /search - hiding the feature",
            );
            searchState.unsupported = true;
            onClose();
        } else {
            console.error("Message search failed", e);
            setError(
                e instanceof Error
                    ? e.message
                    : t("messageSearchPanel.searchFailed"),
            );
        }
    }

    async function loadMore() {
        if (!results || loadingMore) return;
        const page = results;
        setLoadingMore(true);
        const outcome = await requests.run(() => searchRoomMessagesMore(page));
        if (outcome.status === "stale") return;
        setLoadingMore(false);
        if (outcome.status === "ok") {
            setResultsTick((n) => n + 1);
            return;
        }
        console.error("Message search pagination failed", outcome.error);
        setError(
            outcome.error instanceof Error
                ? outcome.error.message
                : t("messageSearchPanel.searchFailed"),
        );
    }

    function metaOf(e: any): SearchEventMeta {
        const content = e.getContent();
        return {
            sender: e.getSender() ?? "",
            msgtype: content.msgtype ?? "",
            body: content.body ?? "",
            isVoice:
                "org.matrix.msc3245.voice" in content || "m.voice" in content,
        };
    }

    const rows = useMemo(() => {
        void resultsTick;
        if (!results && localEvents.length === 0) return [];
        const seen = new Set<string>();
        const server = (results?.results ?? []).map((r) =>
            r.context.getEvent(),
        );
        const merged = usedLocal
            ? [...server, ...localEvents].sort((a, b) => b.getTs() - a.getTs())
            : server;
        return merged.filter((e) => {
            const id = e.getId();
            if (
                !id ||
                seen.has(id) ||
                typeof e.getContent()?.body !== "string" ||
                e.isRedacted()
            )
                return false;
            seen.add(id);
            // Client-side refinement when the server can't fully honor the query.
            if (searchedQuery && parsedQueryNeedsClientRefine(searchedQuery)) {
                if (!matchesParsedQuery(metaOf(e), searchedQuery)) return false;
            }
            return true;
        });
    }, [resultsTick, results, localEvents, usedLocal, searchedQuery]);
    const highlights = useMemo(() => {
        void resultsTick;
        const server = results ? results.highlights : [];
        if (!usedLocal || !searchedQuery) return server;
        return [...server, ...searchedQuery.term.split(/\s+/).filter(Boolean)];
    }, [resultsTick, results, usedLocal, searchedQuery]);
    // Zami: computed each render, which every `resultsTick` bump is.
    const hasMore = results?.next_batch !== undefined;
    const resultCount =
        usedLocal ||
        (searchedQuery && parsedQueryNeedsClientRefine(searchedQuery))
            ? rows.length
            : (results?.count ?? rows.length);

    function jumpTo(eventId: string) {
        onJumpTo(eventId);
        // The panel overlays the whole chat on mobile — close it so the
        // jumped-to message is visible. Desktop keeps it open for browsing.
        if (interfaceState.isMobile) onClose();
    }

    // Autocomplete suggestions for operators and values.
    // Zami: the room's members as "from:" candidates, read again only when its
    // state changes (and only while a "from:" value is being typed), not on
    // every sync; a keystroke then only filters them.
    const fromCandidates = activeToken?.kind === "from";
    const memberRevision = useRune(
        () => (fromCandidates ? roomStateRevision(room) : -1),
        [fromCandidates, room],
    );
    const memberCandidates = useMemo(() => {
        void memberRevision;
        if (!fromCandidates) return [];
        return getRoomMembers(room).map((m) => ({
            userId: m.userId,
            displayName: m.rawDisplayName || m.userId,
        }));
    }, [memberRevision, fromCandidates, room]);
    const suggestions = useMemo((): {
        label: string;
        completion: string;
        sub?: string;
    }[] => {
        if (!activeToken) return [];
        const { kind, query } = activeToken;
        if (kind === "operator") {
            return operatorSuggestions(query).map((op) => ({
                label: op,
                completion: op,
            }));
        }
        if (kind === "has") {
            return hasValueSuggestions(query).map((v) => ({
                label: `has:${v}`,
                completion: `has:${v}`,
            }));
        }
        // kind === "from"
        return filterMemberSuggestions(memberCandidates, query).map((m) => ({
            label: m.displayName,
            sub: m.userId,
            completion: `from:${m.userId}`,
        }));
    }, [activeToken, memberCandidates]);

    // Clamp selectedIdx when suggestions shrink (mirror MessageInput's mention clamp).
    useEffect(() => {
        if (selectedIdx >= suggestions.length) setSelectedIdx(0);
    }, [selectedIdx, suggestions.length]);

    function commit(s: { completion: string }) {
        if (!activeToken) return;
        const spaceAfter = activeToken.kind !== "operator";
        const r = applySuggestion(
            inputValue.current,
            activeToken,
            s.completion,
            spaceAfter,
        );
        setTerm(r.text);
        inputValue.current = r.text;
        setActiveToken(null);
        // Restore focus + caret after the autocomplete cycle.
        pendingCaret.current = r.caret;
        setCommitTick((n) => n + 1);
    }

    // Zami: the caret is placed once the completed text has rendered (a
    // microtask would run before the TextInput has it). Upstream's
    // setSelectionRange then fires `selectionchange`, which re-reads the
    // token; setSelection may not report one, so the token is re-read here.
    useEffect(() => {
        const caret = pendingCaret.current;
        if (caret === null) return;
        pendingCaret.current = null;
        inputCaret.current = caret;
        inputEl.current?.focus();
        inputEl.current?.setSelection(caret, caret);
        setActiveToken(activeSearchToken(inputValue.current, caret));
    }, [commitTick]);

    function updateActiveToken() {
        setActiveToken(
            activeSearchToken(inputValue.current, inputCaret.current),
        );
    }

    // Zami: the input's `onkeydown`. Hardware keys are observed, not
    // intercepted: Enter is the TextInput's return key (onSubmitEditing
    // commits), ArrowUp/ArrowDown also move its caret, which is put back so
    // the token being completed stays active, and Tab also moves focus on.
    const arrowCaret = useRef<{ caret: number; at: number } | null>(null);
    function onKeydown(e: KeyboardEvent) {
        if (activeToken && suggestions.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                arrowCaret.current = {
                    caret: inputCaret.current,
                    at: Date.now(),
                };
                setSelectedIdx((selectedIdx + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                arrowCaret.current = {
                    caret: inputCaret.current,
                    at: Date.now(),
                };
                setSelectedIdx(
                    (selectedIdx - 1 + suggestions.length) % suggestions.length,
                );
            } else if (e.key === "Tab") {
                e.preventDefault();
                commit(suggestions[selectedIdx]);
                // Zami: Tab also moved focus to the next field.
                keepFocus(inputEl);
            } else if (e.key === "Enter") {
                e.preventDefault();
            } else if (e.key === "Escape") {
                e.preventDefault();
                setActiveToken(null);
            }
        }
    }
    useInputKeys(inputEl, { onKeydown });

    // Zami: the form's submit (Enter in the input).
    function onSubmitEditing() {
        if (activeToken && suggestions.length > 0) {
            commit(suggestions[selectedIdx]);
            return;
        }
        void runSearch();
    }

    const showRows =
        !(searching && rows.length === 0) &&
        !error &&
        searched !== null &&
        rows.length > 0;

    return (
        <View
            className={`${
                isMobile ? "" : "w-72"
            } h-full flex flex-col bg-discord-backgroundSecondary border-l border-discord-divider`}
        >
            <View className="h-12 flex-row items-center gap-2 px-4 py-3 border-b border-discord-divider flex-shrink-0">
                <Text
                    accessibilityRole="header"
                    className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide flex-1"
                >
                    {t("messageSearchPanel.searchMessages")}
                </Text>
            </View>

            <View className="p-2 border-b border-discord-divider flex-shrink-0">
                <TextInput
                    ref={inputEl}
                    value={term}
                    onChangeText={(value) => {
                        setTerm(value);
                        inputValue.current = value;
                        updateActiveToken();
                    }}
                    onSelectionChange={(e) => {
                        // Zami: an arrow key the suggestions took moved the
                        // caret too: put it back (see onKeydown).
                        const held = arrowCaret.current;
                        if (held && Date.now() - held.at < 250) {
                            arrowCaret.current = null;
                            if (e.nativeEvent.selection.start !== held.caret)
                                inputEl.current?.setSelection(
                                    held.caret,
                                    held.caret,
                                );
                            return;
                        }
                        inputCaret.current = e.nativeEvent.selection.start;
                        updateActiveToken();
                    }}
                    onSubmitEditing={onSubmitEditing}
                    submitBehavior="submit"
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={t(
                        "messageSearchPanel.searchTryFromOrHasImage",
                    )}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityLabel={t(
                        "messageSearchPanel.searchTryFromOrHasImage",
                    )}
                    className="w-full px-2 py-1.5 text-sm rounded bg-discord-backgroundTertiary text-discord-textPrimary border border-transparent focus:border-discord-accent"
                />
                {activeToken && suggestions.length > 0 ? (
                    <ScrollView
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                        className="mt-1 max-h-64 flex-grow-0 bg-discord-backgroundSecondary border border-discord-divider rounded-lg"
                    >
                        {suggestions.map((s, i) => (
                            <Pressable
                                key={s.completion}
                                accessibilityRole="button"
                                accessibilityState={{
                                    selected: i === selectedIdx,
                                }}
                                className={`w-full px-3 py-2 transition-colors ${
                                    i === selectedIdx
                                        ? "bg-discord-messageHover"
                                        : ""
                                }`}
                                onPress={() => commit(s)}
                                onHoverIn={() => setSelectedIdx(i)}
                            >
                                <Text className="text-sm text-discord-textPrimary">
                                    {s.label}
                                </Text>
                                {s.sub ? (
                                    <Text className="text-xs text-discord-textMuted">
                                        {s.sub}
                                    </Text>
                                ) : null}
                            </Pressable>
                        ))}
                    </ScrollView>
                ) : null}
            </View>

            <FlatList
                className="flex-1"
                contentContainerClassName={showRows ? "p-2" : undefined}
                keyboardShouldPersistTaps="handled"
                data={showRows ? rows : []}
                extraData={highlights}
                keyExtractor={(event) => event.getId()!}
                ListHeaderComponent={
                    showRows ? (
                        // `px-4 mt-2` outside the rows' `p-2` box.
                        <Text className="text-xs text-discord-textMuted px-2 mb-2">
                            {t("messageSearchPanel.resultCount", {
                                count: resultCount,
                            })}
                        </Text>
                    ) : undefined
                }
                // `space-y-1`
                ItemSeparatorComponent={RowGap}
                renderItem={({ item: event }) => {
                    const sender = event.getSender() ?? "";
                    const avatarUrl = getMemberAvatar(room, sender);
                    const name = getMemberName(room, sender);
                    return (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => jumpTo(event.getId()!)}
                            className="w-full p-2 rounded-lg hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
                        >
                            <View className="flex-row items-center gap-2 mb-1">
                                <Avatar
                                    src={avatarUrl}
                                    name={name}
                                    id={sender}
                                    size={18}
                                />
                                <Text
                                    numberOfLines={1}
                                    className="flex-shrink text-xs font-semibold text-discord-textPrimary"
                                >
                                    {name}
                                </Text>
                                <Text className="text-xs text-discord-textMuted ms-auto flex-shrink-0">
                                    {compactDateTime(event.getTs())}
                                </Text>
                            </View>
                            <Text
                                numberOfLines={3}
                                className="text-xs text-discord-textMuted"
                            >
                                {buildSnippetSegments(
                                    event.getContent().body,
                                    highlights,
                                ).map((segment, i) =>
                                    segment.highlight ? (
                                        <Text
                                            key={i}
                                            className="bg-discord-accent/40 text-discord-textPrimary rounded-sm px-px"
                                        >
                                            {segment.text}
                                        </Text>
                                    ) : (
                                        <Text key={i}>{segment.text}</Text>
                                    ),
                                )}
                            </Text>
                        </Pressable>
                    );
                }}
                ListFooterComponent={
                    showRows && hasMore ? (
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => void loadMore()}
                            disabled={loadingMore}
                            accessibilityState={{ disabled: loadingMore }}
                            className={`mt-1 w-full py-1.5 ${
                                loadingMore ? "opacity-50" : ""
                            }`}
                        >
                            <Text className="text-xs text-discord-accent text-center">
                                {loadingMore
                                    ? t("common.loading")
                                    : t("common.loadMore")}
                            </Text>
                        </Pressable>
                    ) : undefined
                }
                ListEmptyComponent={
                    searching && rows.length === 0 ? (
                        <View className="flex-row justify-center mt-8">
                            <Spin className="w-5 h-5 border-2 border-discord-accent border-t-transparent rounded-full" />
                        </View>
                    ) : error ? (
                        <Text className="text-sm text-discord-danger text-center mt-8 px-4">
                            {error}
                        </Text>
                    ) : searched === null ? (
                        <Text className="text-sm text-discord-textMuted text-center mt-8 px-4">
                            {t(
                                "messageSearchPanel.searchForMessagesInThisRoom",
                            )}
                        </Text>
                    ) : rows.length === 0 ? (
                        <>
                            <Text className="text-sm text-discord-textMuted text-center mt-8 px-4">
                                {hasMore
                                    ? t(
                                          "messageSearchPanel.noMatchesInTheResultsLoaded",
                                      )
                                    : t("messageSearchPanel.noResultsFor", {
                                          searched,
                                      })}
                            </Text>
                            {hasMore ? (
                                <View className="p-2">
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => void loadMore()}
                                        disabled={loadingMore}
                                        accessibilityState={{
                                            disabled: loadingMore,
                                        }}
                                        className={`w-full py-1.5 ${
                                            loadingMore ? "opacity-50" : ""
                                        }`}
                                    >
                                        <Text className="text-xs text-discord-accent text-center">
                                            {loadingMore
                                                ? t("common.loading")
                                                : t("common.loadMore")}
                                        </Text>
                                    </Pressable>
                                </View>
                            ) : null}
                        </>
                    ) : undefined
                }
            />
        </View>
    );
}

function RowGap() {
    return <View className="h-1" />;
}
