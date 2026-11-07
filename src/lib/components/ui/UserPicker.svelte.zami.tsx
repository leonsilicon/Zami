import { useEffect, useMemo, useRef, useState } from "react";
import {
    AccessibilityInfo,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native";
import { t } from "$lib/i18n";
import { searchUserDirectory, getOwnServerName } from "$lib/matrix/client";
import type { UserSearchResult } from "$lib/matrix/client";
import { isValidUserId, debounce } from "$lib/utils/userSearch";
import { X } from "lucide-svelte";
import Avatar from "./Avatar.svelte";

// Zami: stable empty defaults, so a caller that passes neither doesn't hand
// the memos below a new array on every render.
const NO_USERS: string[] = [];

export default function UserPicker({
    mode = "single",
    selected: selectedProp = NO_USERS,
    onSelectedChange,
    excludeUserIds = NO_USERS,
    autofocus = false,
    placeholder = t("userPicker.searchForPeople"),
    disabled = false,
    onpick,
}: {
    mode?: "single" | "multi";
    selected?: string[];
    /** Zami: `bind:selected`. The picker reports its new selection here. */
    onSelectedChange?: (selected: string[]) => void;
    excludeUserIds?: string[];
    autofocus?: boolean;
    placeholder?: string;
    disabled?: boolean;
    onpick?: (userId: string) => void;
}) {
    // Zami: `selected` is `$bindable`. With `onSelectedChange` the caller
    // owns the list (`bind:selected`); without it the picker keeps its own,
    // as an unbound `$bindable` prop does.
    const [ownSelected, setOwnSelected] = useState(selectedProp);
    const selected = onSelectedChange ? selectedProp : ownSelected;
    function setSelected(next: string[]) {
        if (onSelectedChange) onSelectedChange(next);
        else setOwnSelected(next);
    }

    const [input, setInput] = useState("");
    const [results, setResults] = useState<UserSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [searched, setSearched] = useState(false);
    const [searchError, setSearchError] = useState("");
    const seq = useRef(0);

    // Zami: not ported: the virtual cursor (`activeIndexRaw`, `activeIndex`,
    // `pickAt`, the arrow/Home/End/Escape handling and the effect keeping
    // the active option scrolled into view). A TextInput reports no arrow
    // keys, so nothing could move it; options are picked by touch, and
    // Enter keeps its no-cursor behavior below. The combobox/listbox ARIA
    // ids it drove (`listId`, aria-activedescendant) have no React Native
    // equivalent either.

    const excluded = useMemo(
        () => new Set([...excludeUserIds, ...selected]),
        [excludeUserIds, selected],
    );
    const visibleResults = results.filter((u) => !excluded.has(u.userId));

    // The homeserver's user directory doesn't index everyone (private/local
    // accounts often aren't searchable), so let the raw input resolve to a
    // pickable user id: a full typed `@user:server`, or a bare localpart
    // assumed to be on your OWN homeserver — so you don't have to guess the
    // server name from the homeserver URL.
    const [ownDomain] = useState(getOwnServerName);
    function toCandidate(raw: string): string | null {
        const term = raw.trim();
        if (!term) return null;
        if (isValidUserId(term)) return term;
        if (ownDomain && /^[^\s:@]+$/.test(term))
            return `@${term}:${ownDomain}`;
        return null;
    }
    const candidate = toCandidate(input);
    // Hide the candidate row when a search result already offers the same id.
    const candidateShown =
        candidate && !visibleResults.some((u) => u.userId === candidate)
            ? candidate
            : null;
    const candidateExcluded = candidateShown
        ? excluded.has(candidateShown)
        : false;

    // The flat option list: the candidate row comes first when it is shown,
    // then the search results.
    const resultOffset = candidateShown ? 1 : 0;
    const optionCount = resultOffset + visibleResults.length;

    const debouncedRun = useMemo(() => {
        async function run(term: string) {
            const mine = ++seq.current;
            try {
                const res = await searchUserDirectory(term, 10);
                if (mine !== seq.current) return;
                setResults(res.users);
                setSearchError("");
                setSearched(true);
            } catch {
                if (mine !== seq.current) return;
                setResults([]);
                setSearchError(t("userPicker.userSearchFailedYouCanStill"));
                setSearched(true);
            } finally {
                if (mine === seq.current) setSearching(false);
            }
        }
        return debounce((t: string) => void run(t), 300);
    }, []);

    useEffect(() => {
        const term = input.trim();
        if (term.length < 2) {
            debouncedRun.cancel();
            seq.current++;
            setResults([]);
            setSearching(false);
            setSearched(false);
            setSearchError("");
            return;
        }
        setSearching(true);
        setSearched(false);
        debouncedRun(term);
    }, [input, debouncedRun]);

    function pick(userId: string) {
        if (disabled || excluded.has(userId)) return;
        if (mode === "multi") {
            setSelected([...selected, userId]);
            setInput("");
        }
        // single mode: parent acts on the pick; multi mode: optional observer.
        onpick?.(userId);
    }

    function remove(userId: string) {
        setSelected(selected.filter((id) => id !== userId));
    }

    // Zami: Enter (`onKeydown`), with no option arrow-selected: the
    // candidate, else the first result.
    function onSubmitEditing() {
        if (candidate) pick(candidate);
        else if (visibleResults.length) pick(visibleResults[0].userId);
    }

    // Zami: the `sr-only` live region → an announcement whenever its text
    // changes.
    const status = searching
        ? t("userPicker.searching")
        : searched && optionCount === 0
          ? t("userPicker.noMatchingUsers")
          : optionCount > 0
            ? t("userPicker.available", { optionCount })
            : "";
    useEffect(() => {
        if (status) AccessibilityInfo.announceForAccessibility(status);
    }, [status]);

    return (
        <View className="gap-2">
            {mode === "multi" && selected.length ? (
                <View className="flex-row flex-wrap gap-1.5">
                    {selected.map((userId) => (
                        <View
                            key={userId}
                            className="flex-row items-center gap-1 bg-discord-backgroundTertiary rounded px-2 py-1"
                        >
                            <Text className="text-discord-textPrimary text-xs">
                                {userId}
                            </Text>
                            <Pressable
                                onPress={() => remove(userId)}
                                accessibilityRole="button"
                                accessibilityLabel={t("userPicker.remove", {
                                    userId,
                                })}
                                hitSlop={8}
                                className="flex-row items-center"
                            >
                                <X
                                    size={14}
                                    className="text-discord-textMuted"
                                />
                            </Pressable>
                        </View>
                    ))}
                </View>
            ) : null}

            {/* Zami: no autocapitalization or autocorrect, which would
                rewrite a typed user id. "submit" keeps the keyboard up after
                Enter, as the web field keeps focus. */}
            <TextInput
                value={input}
                onChangeText={setInput}
                onSubmitEditing={onSubmitEditing}
                submitBehavior="submit"
                autoFocus={autofocus}
                placeholder={placeholder}
                placeholderTextColorClassName="accent-discord-textMuted"
                accessibilityLabel={placeholder}
                accessibilityState={{ expanded: optionCount > 0 }}
                autoCapitalize="none"
                autoCorrect={false}
                className="w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 border border-transparent focus:border-discord-accent/50"
            />

            {searchError ? (
                <Text
                    accessibilityRole="alert"
                    className="text-xs text-discord-textMuted"
                >
                    {searchError}
                </Text>
            ) : null}

            {/* One list owns every option. The candidate row sits outside the
                results' scroll box visually, so the list is this wrapper
                rather than the scroll box itself. */}
            {optionCount > 0 ? (
                <View
                    accessibilityRole="list"
                    accessibilityLabel={t("common.searchResults")}
                    className="gap-2"
                >
                    {candidateShown ? (
                        <Pressable
                            onPress={() => pick(candidateShown)}
                            disabled={disabled || candidateExcluded}
                            accessibilityRole="button"
                            accessibilityState={{
                                disabled: disabled || candidateExcluded,
                            }}
                            className={`w-full flex-row items-center gap-2.5 px-2.5 py-2 rounded bg-discord-backgroundSecondary hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors ${
                                disabled || candidateExcluded
                                    ? "opacity-50"
                                    : ""
                            }`}
                        >
                            <View className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-discord-backgroundTertiary">
                                <Text className="text-discord-textMuted text-sm">
                                    @
                                </Text>
                            </View>
                            <View className="min-w-0 shrink">
                                <Text
                                    numberOfLines={1}
                                    className="text-sm text-discord-textPrimary"
                                >
                                    {t("userPicker.invite", { candidateShown })}
                                </Text>
                                <Text
                                    numberOfLines={1}
                                    className="text-xs text-discord-textMuted"
                                >
                                    {candidateExcluded
                                        ? selected.includes(candidateShown)
                                            ? t("userPicker.alreadyAdded")
                                            : t("userPicker.alreadyInThisRoom")
                                        : t(
                                              "userPicker.sendAnInviteToThisExact",
                                          )}
                                </Text>
                            </View>
                        </Pressable>
                    ) : null}

                    {visibleResults.length ? (
                        // Zami: a ScrollView, not a FlatList: the directory
                        // search returns at most 10 users, and the picker
                        // sits inside scrolling panels, where a nested
                        // FlatList would lose virtualization anyway.
                        <ScrollView
                            nestedScrollEnabled
                            keyboardShouldPersistTaps="handled"
                            className="max-h-56 flex-grow-0 rounded bg-discord-backgroundSecondary"
                        >
                            {visibleResults.map((user, i) => (
                                <Pressable
                                    key={user.userId}
                                    onPress={() => pick(user.userId)}
                                    disabled={disabled}
                                    accessibilityRole="button"
                                    accessibilityState={{ disabled }}
                                    // `divide-y divide-discord-divider`
                                    className={`w-full flex-row items-center gap-2.5 px-2.5 py-2 hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors ${
                                        i > 0
                                            ? "border-t border-discord-divider"
                                            : ""
                                    } ${disabled ? "opacity-50" : ""}`}
                                >
                                    <Avatar
                                        src={user.avatarUrl}
                                        name={user.displayName ?? user.userId}
                                        id={user.userId}
                                        size={28}
                                    />
                                    <View className="min-w-0 shrink">
                                        <Text
                                            numberOfLines={1}
                                            className="text-sm text-discord-textPrimary"
                                        >
                                            {user.displayName ?? user.userId}
                                        </Text>
                                        {user.displayName ? (
                                            <Text
                                                numberOfLines={1}
                                                className="text-xs text-discord-textMuted"
                                            >
                                                {user.userId}
                                            </Text>
                                        ) : null}
                                    </View>
                                </Pressable>
                            ))}
                        </ScrollView>
                    ) : null}
                </View>
            ) : null}

            {optionCount === 0 &&
            searched &&
            !searching &&
            input.trim().length >= 2 ? (
                <Text className="text-xs text-discord-textMuted">
                    {t("userPicker.noMatchesTypeAFullUser")}{" "}
                    <Text className="text-discord-textSecondary">
                        {t("userPicker.userServer")}
                    </Text>{" "}
                    {t("userPicker.toInviteSomeoneTheDirectoryDoesn")}
                </Text>
            ) : null}
        </View>
    );
}
