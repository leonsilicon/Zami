import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    FlatList,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
    useWindowDimensions,
    type LayoutRectangle,
    type ListRenderItemInfo,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    type ScrollViewInstance,
    type TextInputInstance,
} from "react-native";
import { useInputKeys, useKeyScope } from "@-/com.leonsilicon.zami.browser";
import { Image, mediaSource, SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import type { Room } from "matrix-js-sdk";
import { EMOJI_CATEGORIES, ALL_EMOJIS } from "$lib/data/emojis";
import {
    getCustomEmojiPacks,
    getOwnAvatarUrl,
    type CustomEmoji,
    type CustomEmojiPack,
} from "$lib/matrix/client";
import { roomsState } from "$lib/stores/rooms.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";
import { COMPOSER_PICKER_SIZE } from "$lib/utils/pickerSize";
import { scrollBehavior } from "$lib/utils/motionPreference";
import { nextActiveIndex } from "$lib/utils/listboxNavigation";
import { anchoredActiveIndex } from "$lib/utils/listboxAnchor";
import { emojiOptionKeys } from "$lib/utils/pickerOptionKeys";

interface Props {
    room?: Room | null;
    onSelect: (emoji: string) => void;
    onSelectCustom?: (emoji: CustomEmoji) => void;
    onClose: () => void;
    onSwitchToSticker?: () => void;
    onSwitchToGif?: () => void;
    /** Hide custom emoji packs, for fields that can only hold unicode. */
    unicodeOnly?: boolean;
}

// Flat ordered list of all items
type FlatItem =
    | {
          kind: "custom";
          sectionId: string;
          data: CustomEmoji & { packId: string };
      }
    | {
          kind: "standard";
          sectionId: string;
          data: { emoji: string; name: string };
      };

// Zami: the web renders every section into one scroll box and reveals each
// section's grid lazily (`lazySection`). Here one FlatList holds the sections
// as rows, a header row and then rows of `cols` cells, and virtualizes them.
// Every row's height is known, so `getItemLayout` and the section scrolling
// below work from these offsets instead of measuring elements.
type Row =
    | {
          kind: "header";
          key: string;
          sectionId: string;
          label: string;
          className: string;
          length: number;
          offset: number;
      }
    | {
          kind: "cells";
          key: string;
          items: FlatItem[];
          paddingTop: number;
          length: number;
          offset: number;
      };

/** `grid gap-1`. */
const GAP = 4;

export default function EmojiPicker({
    room = null,
    onSelect,
    onSelectCustom,
    onClose,
    onSwitchToSticker,
    onSwitchToGif,
    unicodeOnly = false,
}: Props) {
    const isTouchscreen = useRune(() => interfaceState.isTouchscreen);
    const windowSize = useWindowDimensions();

    const [search, setSearch] = useState("");
    const [activeTab, setActiveTab] = useState("");
    const scrollEl = useRef<FlatList<Row>>(null);
    const tabBarEl = useRef<ScrollViewInstance>(null);
    const searchEl = useRef<TextInputInstance>(null);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    // The identity of the option `selectedIndex` was placed on. See
    // `moveCursor` below and utils/listboxAnchor.ts for why an index alone is
    // not enough.
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    // Zami: not ported: the combobox/listbox ARIA ids the cursor drives
    // (`listId`, aria-activedescendant), which React Native has no
    // equivalent of.

    // Responsive columns: fit as many ~40px cells as the width allows, so
    // widening the panel shows MORE emojis instead of spreading 6 apart.
    const CELL = 40;
    const [scrollWidth, setScrollWidth] = useState(0);
    const w = scrollWidth - 16; // minus the px-2 padding
    const cols = w > 0 ? Math.max(6, Math.floor(w / CELL)) : 6;
    // Zami: the grid cell (`aspect-square`, `minmax(0, 1fr)` columns).
    const cell = w > 0 ? (w - (cols - 1) * GAP) / cols : 0;

    // Zami: no `revealedSections`: the FlatList only renders the rows near
    // the viewport, which is what the IntersectionObserver reveal did.

    useEffect(() => {
        if (!isTouchscreen) searchEl.current?.focus();
    }, [isTouchscreen]);

    // Scroll the tab bar so the active tab button is visible
    const tabLayouts = useRef(new Map<string, LayoutRectangle>());
    const tabBarView = useRef({ x: 0, width: 0 });
    function scrollTabIntoView(id: string) {
        const btn = tabLayouts.current.get(id);
        if (!id || !tabBarEl.current || !btn) return;
        // `inline: "nearest"`
        const view = tabBarView.current;
        if (view.width === 0) return; // not laid out yet
        let x: number | null = null;
        if (btn.x < view.x) x = btn.x;
        else if (btn.x + btn.width > view.x + view.width)
            x = btn.x + btn.width - view.width;
        if (x !== null)
            tabBarEl.current.scrollTo({
                x,
                animated: scrollBehavior() === "smooth",
            });
    }
    useEffect(() => scrollTabIntoView(activeTab), [activeTab]);
    // Zami: a search unmounts the tab bar; it comes back scrolled to the
    // start, and its active tab scrolls into view as it lays out (below).
    useEffect(() => {
        if (search) tabBarView.current.x = 0;
    }, [search]);

    // Zami: no `emojiHtml`: iOS draws emoji itself, so the grid shows them as
    // text rather than Twemoji images.

    // Pack data lives in room state that mutates in place, so this must depend
    // on the tick, not on roomsState.spaces being reassigned (it no longer is
    // when the space set has not actually changed).
    const customPacks = useRune((): CustomEmojiPack[] => {
        void roomsState.roomsTick;
        if (unicodeOnly) return [];
        return getCustomEmojiPacks(
            roomsState.activeSpaceId,
            roomsState.spaces,
            room,
        );
    }, [unicodeOnly, room]);
    const ownAvatarUrl = getOwnAvatarUrl();

    const tabs = useMemo(
        () => [
            ...customPacks.map((p) => ({
                id: p.id,
                label: p.name,
                avatarUrl: p.avatarUrl,
                isCustom: true as const,
            })),
            ...EMOJI_CATEGORIES.map((c) => ({
                id: c.id,
                label: c.label,
                avatarUrl: undefined,
                isCustom: false as const,
            })),
        ],
        [customPacks],
    );

    useEffect(() => {
        if (!activeTab && tabs.length > 0) setActiveTab(tabs[0].id);
    }, [activeTab, tabs]);

    // Search results: custom first, then standard
    const searchCustom = useMemo(
        () =>
            search
                ? customPacks.flatMap((p) =>
                      p.emojis
                          .filter((e) =>
                              e.shortcode
                                  .toLowerCase()
                                  .includes(search.toLowerCase()),
                          )
                          .map((e) => ({ ...e, packId: p.id })),
                  )
                : [],
        [search, customPacks],
    );
    const searchStandard = useMemo(
        () =>
            search
                ? ALL_EMOJIS.filter((e) =>
                      e.name.includes(search.toLowerCase()),
                  )
                : [],
        [search],
    );

    // Reset selection when search changes
    useEffect(() => {
        moveCursor(-1);
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- tracks only `search`, as upstream's effect does.
    }, [search]);

    const flatItems = useMemo((): FlatItem[] => {
        if (search) {
            return [
                ...searchCustom.map((e): FlatItem => ({
                    kind: "custom",
                    sectionId: "search-custom",
                    data: e,
                })),
                ...searchStandard.map((e): FlatItem => ({
                    kind: "standard",
                    sectionId: "search-standard",
                    data: e,
                })),
            ];
        }
        const items: FlatItem[] = [];
        for (const pack of customPacks) {
            for (const e of pack.emojis) {
                items.push({
                    kind: "custom",
                    sectionId: pack.id,
                    data: { ...e, packId: pack.id },
                });
            }
        }
        for (const cat of EMOJI_CATEGORIES) {
            for (const e of cat.emojis) {
                items.push({ kind: "standard", sectionId: cat.id, data: e });
            }
        }
        return items;
    }, [search, searchCustom, searchStandard, customPacks]);

    // Identity of every option, in render order — the anchor's key list.
    const activeKeys = useMemo(() => emojiOptionKeys(flatItems), [flatItems]);

    // Start index of each section in the flat list
    const sectionOffsets = useMemo((): Map<string, number> => {
        const offsets = new Map<string, number>();
        if (search) {
            offsets.set("search-custom", 0);
            offsets.set("search-standard", searchCustom.length);
            return offsets;
        }
        let offset = 0;
        for (const pack of customPacks) {
            offsets.set(pack.id, offset);
            offset += pack.emojis.length;
        }
        for (const cat of EMOJI_CATEGORIES) {
            offsets.set(cat.id, offset);
            offset += cat.emojis.length;
        }
        return offsets;
    }, [search, searchCustom, customPacks]);

    // The cursor, but only while the option it was placed on is still sitting
    // at that index (see upstream's comment on `activeIndex`: a list rewritten
    // within range must read as "nothing active", not as a stranger).
    const activeIndex = anchoredActiveIndex(
        selectedIndex,
        selectedKey,
        activeKeys,
    );

    // True exactly when the box below is really rendering options. With no
    // options it is a plain view, so its "No results" text reads as ordinary
    // content instead of an empty list.
    const hasOptions = flatItems.length > 0;

    function scrollToSection(id: string) {
        setActiveTab(id);
        if (!scrollEl.current) return;
        const el = rows.find(
            (row) => row.kind === "header" && row.sectionId === id,
        );
        if (el)
            scrollEl.current.scrollToOffset({
                offset: Math.max(0, el.offset - 4),
                animated: scrollBehavior() === "smooth",
            });
    }

    function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
        listView.current.y = e.nativeEvent.contentOffset.y;
        if (search) return;
        const top = e.nativeEvent.contentOffset.y;
        let current = "";
        for (const header of rows) {
            if (header.kind !== "header") continue;
            if (header.offset <= top + 8) current = header.sectionId;
            else break;
        }
        if (current && current !== activeTab) setActiveTab(current);
    }

    const pick = useCallback(
        (emoji: string) => {
            onSelect(emoji);
            onClose();
        },
        [onSelect, onClose],
    );

    const pickCustom = useCallback(
        (emoji: CustomEmoji) => {
            if (onSelectCustom) {
                onSelectCustom(emoji);
            } else {
                onSelect(`:${emoji.shortcode}:`);
            }
            onClose();
        },
        [onSelect, onSelectCustom, onClose],
    );

    function onKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            onClose();
            return;
        }
        // Ctrl+E/S/G picker switching is handled globally in +page.svelte.
    }

    // Zami: the panel's `onkeydown`: its keys, with focus in the search field
    // or nowhere.
    useKeyScope({ onKeydown }, [searchEl]);

    /** The ONLY place `selectedIndex` may be assigned. See `activeIndex`. */
    function moveCursor(next: number) {
        setSelectedIndex(next);
        setSelectedKey(next >= 0 ? (activeKeys[next] ?? null) : null);
    }

    // Zami: hardware keys are observed, not intercepted, so the arrow keys
    // also move the search field's caret, as they do there with nothing
    // selected.
    function onSearchKeydown(e: KeyboardEvent) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (activeIndex === -1) {
                if (flatItems.length > 0) moveCursor(0);
            } else {
                moveCursor(Math.min(activeIndex + cols, flatItems.length - 1));
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (activeIndex < cols) {
                moveCursor(-1);
            } else {
                moveCursor(activeIndex - cols);
            }
        } else if (e.key === "ArrowRight" && activeIndex >= 0) {
            // A step of one along the flat list is exactly a listbox's
            // ArrowDown, so the horizontal keys borrow that arithmetic --
            // with `loop: false`, because walking off the last emoji has
            // always stopped there rather than wrapping to the first.
            e.preventDefault();
            moveCursor(
                nextActiveIndex(activeIndex, flatItems.length, "ArrowDown", {
                    loop: false,
                }),
            );
        } else if (e.key === "ArrowLeft" && activeIndex >= 0) {
            e.preventDefault();
            moveCursor(
                nextActiveIndex(activeIndex, flatItems.length, "ArrowUp", {
                    loop: false,
                }),
            );
        } else if ((e.key === "Home" || e.key === "End") && activeIndex >= 0) {
            // Only once the user is actually navigating the grid: this is an
            // editable text field, so with nothing selected Home/End still
            // belong to the caret.
            e.preventDefault();
            moveCursor(nextActiveIndex(activeIndex, flatItems.length, e.key));
        } else if (e.key === "Enter" && activeIndex >= 0) {
            // `activeIndex`, like every branch above: a raw `selectedIndex`
            // left past the end by a shrinking pack indexes `undefined` here.
            e.preventDefault();
            const item = flatItems[activeIndex];
            if (item.kind === "custom") pickCustom(item.data);
            else pick(item.data.emoji);
        }
    }

    // Zami: the search field's `onkeydown`.
    useInputKeys(searchEl, { onKeydown: onSearchKeydown });

    // Zami: the rows the FlatList renders, with their heights and offsets.
    // Header text is `text-xs` (a 16px line, scaled with the system text
    // size) plus its padding; a grid row is a cell plus the `gap-1` below it,
    // or the grid's `mb-2` below the last row.
    const fontScale = windowSize.fontScale;
    const rows = useMemo((): Row[] => {
        const out: Row[] = [];
        if (cell <= 0) return out;
        let offset = 0;
        const header = (
            sectionId: string,
            label: string,
            className: string,
            padding: number,
        ) => {
            const length = padding + 16 * fontScale;
            out.push({
                kind: "header",
                key: `header:${sectionId}`,
                sectionId,
                label,
                className,
                length,
                offset,
            });
            offset += length;
        };
        const grid = (
            sectionId: string,
            count: number,
            marginBottom: number,
        ) => {
            const start = sectionOffsets.get(sectionId) ?? 0;
            const rowCount = Math.ceil(count / cols);
            for (let r = 0; r < rowCount; r++) {
                const length = cell + (r === rowCount - 1 ? marginBottom : GAP);
                out.push({
                    kind: "cells",
                    key: `row:${sectionId}:${r}`,
                    items: flatItems.slice(
                        start + r * cols,
                        start + Math.min((r + 1) * cols, count),
                    ),
                    paddingTop: 0,
                    length,
                    offset,
                });
                offset += length;
            }
        };
        if (search) {
            if (searchCustom.length > 0) {
                header(
                    "search-custom",
                    t("emojiPicker.custom"),
                    "px-1 py-1",
                    8,
                );
                grid("search-custom", searchCustom.length, 8);
            }
            if (searchStandard.length > 0) {
                if (searchCustom.length > 0)
                    header(
                        "search-standard",
                        t("emojiPicker.standard"),
                        "px-1 py-1",
                        8,
                    );
                grid("search-standard", searchStandard.length, 0);
            }
        } else {
            // All custom packs
            for (const pack of customPacks) {
                header(
                    pack.id,
                    pack.id === "user" ? t("emojiPicker.myEmojis2") : pack.name,
                    "px-1 pt-2 pb-1",
                    12,
                );
                grid(pack.id, pack.emojis.length, 8);
            }
            // All standard categories
            for (const cat of EMOJI_CATEGORIES) {
                header(cat.id, cat.name, "px-1 pt-2 pb-1", 12);
                grid(cat.id, cat.emojis.length, 8);
            }
        }
        return out;
    }, [
        cell,
        cols,
        fontScale,
        search,
        searchCustom,
        searchStandard,
        customPacks,
        flatItems,
        sectionOffsets,
    ]);

    // Scroll the selected item into view, and follow it with the active tab.
    // Zami: the FlatList renders every row near the viewport, so there's no
    // section to reveal; `scrollIntoView({ block: "nearest" })` is worked out
    // from the row offsets and the list's own scroll position.
    const listView = useRef({ y: 0, height: 0 });
    useEffect(() => {
        const idx = activeIndex;
        if (idx < 0 || idx >= flatItems.length) return;
        const item = flatItems[idx];

        // Update active tab when navigating
        if (!search && activeTab !== item.sectionId)
            setActiveTab(item.sectionId);

        const row = rows.find(
            (r) => r.kind === "cells" && r.items.includes(item),
        );
        const view = listView.current;
        if (!row || !scrollEl.current || view.height === 0) return;
        let y: number | null = null;
        if (row.offset < view.y) y = row.offset;
        else if (row.offset + row.length > view.y + view.height)
            y = row.offset + row.length - view.height;
        if (y !== null)
            scrollEl.current.scrollToOffset({ offset: y, animated: false });
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- follows the cursor, as upstream's effect does.
    }, [activeIndex]);

    // Zami: an emoji glyph is about 1.2em wide, so this fills the cell's
    // padded box the way the Twemoji image did. Like the image, it follows
    // the cell, not the system text size.
    const glyphSize = Math.floor((cell - 8) * 0.8);

    const renderRow = useCallback(
        ({ item: row }: ListRenderItemInfo<Row>) => {
            if (row.kind === "header")
                return (
                    <View
                        style={{ height: row.length }}
                        className={row.className}
                    >
                        <Text
                            numberOfLines={1}
                            className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
                        >
                            {row.label}
                        </Text>
                    </View>
                );
            return (
                <View
                    style={{ height: row.length, paddingTop: row.paddingTop }}
                    className="flex-row gap-1"
                >
                    {row.items.map((item) => {
                        // Zami: `class:ring-2` / `class:ring-discord-accent`
                        // on the option the cursor is on.
                        const selected =
                            activeIndex >= 0 && flatItems[activeIndex] === item;
                        const ring = selected
                            ? " border-2 border-discord-accent"
                            : "";
                        return item.kind === "custom" ? (
                            <Pressable
                                key={
                                    item.data.packId + ":" + item.data.shortcode
                                }
                                onPress={() => pickCustom(item.data)}
                                accessibilityRole="button"
                                accessibilityLabel={item.data.shortcode}
                                accessibilityState={{ selected }}
                                style={{ width: cell, height: cell }}
                                className={`p-1 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors flex items-center justify-center${ring}`}
                            >
                                <Image
                                    source={mediaSource(item.data.url)}
                                    accessibilityLabel={item.data.shortcode}
                                    style={{
                                        width: cell - 8,
                                        height: cell - 8,
                                    }}
                                    contentFit="contain"
                                />
                            </Pressable>
                        ) : (
                            <Pressable
                                key={item.data.name}
                                onPress={() => pick(item.data.emoji)}
                                accessibilityRole="button"
                                accessibilityLabel={item.data.name}
                                accessibilityState={{ selected }}
                                style={{ width: cell, height: cell }}
                                className={`p-1 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors flex items-center justify-center${ring}`}
                            >
                                <Text
                                    allowFontScaling={false}
                                    style={{
                                        fontSize: glyphSize,
                                        includeFontPadding: false,
                                    }}
                                    className="text-center"
                                >
                                    {item.data.emoji}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            );
        },
        [cell, glyphSize, pick, pickCustom, activeIndex, flatItems],
    );

    // Zami: `height: 50dvh` on touch. The desktop panel keeps the composer
    // pickers' shared default size.
    // Zami: not ported: resizing the desktop panel (`resizeHandle` is
    // pointer-drag and arrow-key DOM code), so the grip isn't rendered.
    const panelStyle = isTouchscreen
        ? { height: windowSize.height * 0.5 }
        : {
              width: COMPOSER_PICKER_SIZE.defaultW,
              height: COMPOSER_PICKER_SIZE.defaultH,
          };

    return (
        <View
            className={`${
                isTouchscreen ? "w-full rounded-t-xl" : "rounded-xl"
            } relative bg-discord-backgroundSecondary border border-discord-divider shadow-2xl flex flex-col`}
            style={panelStyle}
        >
            {isTouchscreen && (onSwitchToSticker || onSwitchToGif) ? (
                <View className="flex-row border-b border-discord-divider flex-shrink-0">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: true }}
                        className="flex-1 py-2 items-center border-b-2 border-discord-accent"
                    >
                        <Text className="text-sm font-semibold text-discord-textPrimary">
                            {t("common.emoji")}
                        </Text>
                    </Pressable>
                    {onSwitchToSticker ? (
                        <Pressable
                            onPress={onSwitchToSticker}
                            accessibilityRole="button"
                            className="flex-1 py-2 items-center"
                        >
                            <Text className="text-sm font-medium text-discord-textMuted">
                                {t("common.stickers")}
                            </Text>
                        </Pressable>
                    ) : null}
                    {onSwitchToGif ? (
                        <Pressable
                            onPress={onSwitchToGif}
                            accessibilityRole="button"
                            className="flex-1 py-2 items-center"
                        >
                            <Text className="text-sm font-medium text-discord-textMuted">
                                {t("common.gifs")}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}
            {/* Search */}
            <View className="px-3 pt-3 pb-2 flex-shrink-0">
                {/* Zami: no autocapitalization or autocorrect, which would
                    rewrite a half-typed name the search filters on. */}
                <TextInput
                    ref={searchEl}
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t("emojiPicker.searchEmoji")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityRole="search"
                    accessibilityLabel={t("emojiPicker.searchEmoji2")}
                    accessibilityState={{ expanded: hasOptions }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    // Zami: Enter picks the selected emoji (onSearchKeydown)
                    // and otherwise does nothing, rather than blurring.
                    submitBehavior="submit"
                    className="w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded-lg px-3 py-1.5 border border-transparent focus:border-discord-accent/30"
                />
            </View>

            {/* Category tabs — always shown, scroll to section on click */}
            {!search ? (
                <ScrollView
                    ref={tabBarEl}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    onLayout={(e) => {
                        tabBarView.current.width = e.nativeEvent.layout.width;
                    }}
                    onScroll={(e) => {
                        tabBarView.current.x = e.nativeEvent.contentOffset.x;
                    }}
                    scrollEventThrottle={16}
                    className="flex-shrink-0 flex-grow-0"
                    contentContainerClassName="flex-row items-center gap-0.5 px-2 pb-1"
                >
                    {tabs.map((tab) => (
                        <Pressable
                            key={tab.id}
                            onLayout={(e) => {
                                tabLayouts.current.set(
                                    tab.id,
                                    e.nativeEvent.layout,
                                );
                                if (tab.id === activeTab)
                                    scrollTabIntoView(tab.id);
                            }}
                            onPress={() => scrollToSection(tab.id)}
                            accessibilityRole="button"
                            accessibilityLabel={tab.label}
                            accessibilityState={{
                                selected: activeTab === tab.id,
                            }}
                            className={`flex-shrink-0 p-1.5 rounded transition-colors ${
                                activeTab === tab.id
                                    ? "bg-discord-messageHover"
                                    : "opacity-40"
                            }`}
                        >
                            {tab.isCustom ? (
                                tab.id === "user" && ownAvatarUrl ? (
                                    <Image
                                        source={mediaSource(ownAvatarUrl)}
                                        accessibilityLabel={t(
                                            "emojiPicker.myEmojis",
                                        )}
                                        className="w-5 h-5 rounded-full"
                                        contentFit="cover"
                                    />
                                ) : tab.id === "user" ? (
                                    <SvgIcon
                                        d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
                                        className="w-5 h-5 text-discord-textPrimary"
                                    />
                                ) : tab.avatarUrl ? (
                                    <Image
                                        source={mediaSource(tab.avatarUrl)}
                                        accessibilityLabel={tab.label}
                                        className="w-5 h-5 rounded-full"
                                        contentFit="cover"
                                    />
                                ) : (
                                    <View className="w-5 h-5 rounded-full bg-discord-accent flex items-center justify-center">
                                        <Text className="text-white text-xs font-bold">
                                            {tab.label[0]?.toUpperCase() ?? "?"}
                                        </Text>
                                    </View>
                                )
                            ) : (
                                // Zami: native emoji, sized to the w-5 box
                                // the custom pack tabs have.
                                <View className="w-5 h-5 items-center justify-center">
                                    <Text
                                        allowFontScaling={false}
                                        style={{
                                            fontSize: 16,
                                            includeFontPadding: false,
                                        }}
                                    >
                                        {tab.label}
                                    </Text>
                                </View>
                            )}
                        </Pressable>
                    ))}
                </ScrollView>
            ) : null}

            {/* Scrollable area. One list owns every section, so the grids stay
                one list. It is labelled as one only while it holds options: a
                search that matches no emoji leaves its "No results" line as
                plain content. */}
            <FlatList
                ref={scrollEl}
                data={rows}
                keyExtractor={(row) => row.key}
                renderItem={renderRow}
                getItemLayout={(_, index) => ({
                    length: rows[index].length,
                    offset: rows[index].offset,
                    index,
                })}
                onLayout={(e) => {
                    setScrollWidth(e.nativeEvent.layout.width);
                    listView.current.height = e.nativeEvent.layout.height;
                }}
                onScroll={onScroll}
                scrollEventThrottle={16}
                // Zami: one tap picks an emoji even while the search field
                // holds the keyboard open.
                keyboardShouldPersistTaps="handled"
                accessibilityRole={hasOptions ? "list" : undefined}
                accessibilityLabel={hasOptions ? t("common.emoji") : undefined}
                className="relative flex-1 min-h-0"
                contentContainerClassName="px-2 pb-2"
                ListEmptyComponent={
                    search &&
                    searchCustom.length === 0 &&
                    searchStandard.length === 0 ? (
                        <Text className="text-center text-discord-textMuted text-sm py-8">
                            {t("common.noResults")}
                        </Text>
                    ) : undefined
                }
            />
        </View>
    );
}
