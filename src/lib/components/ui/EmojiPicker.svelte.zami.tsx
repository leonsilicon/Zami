import {
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
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
import type { Selection } from "@-/com.leonsilicon.zami.incremental";
import {
    useSelected,
    useSelection,
    useStableCallback,
} from "@-/com.leonsilicon.zami.incremental/react";
import { Image, mediaSource, SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { sameObject, useRune } from "@-/com.leonsilicon.zami.svelte-react";
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
import {
    buildGridLayout,
    rowAt,
    scrollTopToReveal,
    type GridRow,
    type GridSection,
} from "$lib/utils/virtualGrid";
import { pickerThumbUrl } from "$lib/matrix/media";

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

// Zami: the web positions the layout's rows (utils/virtualGrid.ts) absolutely
// in one scroll box and renders those near the viewport. Here they are the
// rows of a FlatList, which virtualizes them itself: each row also holds its
// options and its `length`, the space down to the next row (a section's last
// row takes the section gap), for `getItemLayout`.
type Row =
    | (Extract<GridRow, { kind: "header" }> & { length: number })
    | (Extract<GridRow, { kind: "cells" }> & {
          items: FlatItem[];
          length: number;
      });

const GAP = 4; // gap-1, between cells and between rows
const SECTION_GAP = 8; // mb-2 under each section's grid
// Custom emoji are drawn ~32px; 96 covers a 3x screen without fetching
// the original (often a 512px animation) for every cell.
// Zami: expo-image keeps the thumbnails in its disk cache, as Zam's service
// worker does (utils/pickerThumbCache.ts).
const EMOJI_THUMB_PX = 96;

// Zami: the standard emoji as options, built once: they never change, and
// building them (a spread per emoji) on every open and every sync was much of
// the picker's cost. The same objects each time also keep the rows below
// from re-rendering.
let standardItems: FlatItem[] | undefined;
function standardFlatItems(): FlatItem[] {
    return (standardItems ??= EMOJI_CATEGORIES.flatMap((cat) =>
        cat.emojis.map((e): FlatItem => ({
            kind: "standard",
            sectionId: cat.id,
            data: e,
        })),
    ));
}
let searchStandardItems: FlatItem[] | undefined;
function searchStandardFlatItems(): FlatItem[] {
    return (searchStandardItems ??= ALL_EMOJIS.map((e): FlatItem => ({
        kind: "standard",
        sectionId: "search-standard",
        data: e,
    })));
}
const NO_PACKS: CustomEmojiPack[] = [];
const NO_ITEMS: FlatItem[] = [];

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
    // The grid is virtualized (only rows near the viewport exist): the
    // standard set alone is ~1900 emoji, plus every custom pack.
    // Zami: the FlatList's width comes from onLayout; its height and scroll
    // position are kept here, outside state, as nothing renders from them.
    const listView = useRef({ y: 0, height: 0 });

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

    // Zami: no `emojiHtml` and no Twemoji sprite sheets (utils/emojiSprites.ts):
    // iOS draws emoji itself, so the grid shows them as text.

    // Pack data lives in room state that mutates in place, so this must depend
    // on the tick, not on roomsState.spaces being reassigned (it no longer is
    // when the space set has not actually changed).
    // Zami: getCustomEmojiPacks returns the same array until a pack changes,
    // so a sync that changes no pack re-renders nothing here.
    const customPacks = useRune(
        (): CustomEmojiPack[] => {
            void roomsState.roomsTick;
            if (unicodeOnly) return NO_PACKS;
            return getCustomEmojiPacks(
                roomsState.activeSpaceId,
                roomsState.spaces,
                room,
            );
        },
        [unicodeOnly, room],
        { isEqual: sameObject },
    );
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

    // Zami: each custom emoji as an option, built once per pack change, with
    // its shortcode lowercased once for the search below.
    const customItems = useMemo(() => {
        const browse: FlatItem[] = [];
        const searchable: { key: string; item: FlatItem }[] = [];
        for (const pack of customPacks) {
            for (const e of pack.emojis) {
                const data = { ...e, packId: pack.id };
                browse.push({ kind: "custom", sectionId: pack.id, data });
                searchable.push({
                    key: e.shortcode.toLowerCase(),
                    item: { kind: "custom", sectionId: "search-custom", data },
                });
            }
        }
        return { browse, searchable };
    }, [customPacks]);

    // Search results: custom first, then standard
    // Zami: as options already (`FlatItem`s), from the prebuilt lists.
    const searchCustom = useMemo((): FlatItem[] => {
        if (!search) return NO_ITEMS;
        const query = search.toLowerCase();
        return customItems.searchable
            .filter((e) => e.key.includes(query))
            .map((e) => e.item);
    }, [search, customItems]);
    const searchStandard = useMemo((): FlatItem[] => {
        if (!search) return NO_ITEMS;
        const query = search.toLowerCase();
        return searchStandardFlatItems().filter(
            (e) => e.kind === "standard" && e.data.name.includes(query),
        );
    }, [search]);

    // Reset selection, and go back to the top, when search changes
    useEffect(() => {
        moveCursor(-1);
        scrollEl.current?.scrollToOffset({ offset: 0, animated: false });
        listView.current.y = 0;
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- tracks only `search`, as upstream's effect does.
    }, [search]);

    // Zami: the browsing list on its own, so clearing a search gets the same
    // array (and rows) back rather than a new one.
    const browseItems = useMemo(
        (): FlatItem[] => [...customItems.browse, ...standardFlatItems()],
        [customItems],
    );
    const flatItems = useMemo((): FlatItem[] => {
        if (search) {
            return [...searchCustom, ...searchStandard];
        }
        return browseItems;
    }, [search, searchCustom, searchStandard, browseItems]);

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

    // ---- Virtualized layout (utils/virtualGrid.ts) ---------------------------
    // Rows are either a section header or one line of `cols` cells, each at a
    // computed `top`.
    // Zami: the header's text-xs line (16) scales with the system text size,
    // plus pt-2 (8) + pb-1 (4).
    const HEADER_H = 12 + 16 * windowSize.fontScale;

    // Zami: the grid cell (`minmax(0, 1fr)` columns).
    const cellSize = w > 0 ? (w - GAP * (cols - 1)) / cols : 0;

    const sections = useMemo((): GridSection[] => {
        const at = (id: string) => sectionOffsets.get(id) ?? 0;
        if (search) {
            const out: GridSection[] = [];
            if (searchCustom.length > 0)
                out.push({
                    id: "search-custom",
                    label: t("emojiPicker.custom"),
                    start: at("search-custom"),
                    count: searchCustom.length,
                });
            if (searchStandard.length > 0)
                out.push({
                    id: "search-standard",
                    label:
                        searchCustom.length > 0
                            ? t("emojiPicker.standard")
                            : null,
                    start: at("search-standard"),
                    count: searchStandard.length,
                });
            return out;
        }
        return [
            ...customPacks.map((p) => ({
                id: p.id,
                label: p.id === "user" ? t("emojiPicker.myEmojis2") : p.name,
                start: at(p.id),
                count: p.emojis.length,
            })),
            ...EMOJI_CATEGORIES.map((c) => ({
                id: c.id,
                label: c.name,
                start: at(c.id),
                count: c.emojis.length,
            })),
        ];
    }, [search, searchCustom, searchStandard, customPacks, sectionOffsets]);

    const layout = useMemo(
        () =>
            buildGridLayout(sections, flatItems.length, {
                cols,
                cellSize,
                gap: GAP,
                headerHeight: HEADER_H,
                sectionGap: SECTION_GAP,
            }),
        [sections, flatItems.length, cols, cellSize, HEADER_H],
    );
    // Zami: no `visibleRowRange`: the FlatList renders the rows near the
    // viewport. Its rows are the layout's (see `Row`).
    const rows = useMemo(
        (): Row[] =>
            layout.rows.map((row, i): Row => {
                const length =
                    (layout.rows[i + 1]?.top ?? layout.total) - row.top;
                return row.kind === "header"
                    ? { ...row, length }
                    : {
                          ...row,
                          items: flatItems.slice(row.start, row.end),
                          length,
                      };
            }),
        [layout, flatItems],
    );
    const getItemLayout = useCallback(
        (_: unknown, index: number) => ({
            length: rows[index].length,
            offset: rows[index].top,
            index,
        }),
        [rows],
    );

    // Scroll the selected item into view and follow it with the active tab.
    // Only `activeIndex` is tracked: reading `activeTab` or the scroll position
    // here would re-run this on every scroll and yank the view back.
    useEffect(() => {
        const idx = activeIndex;
        if (idx < 0 || idx >= flatItems.length) return;
        const item = flatItems[idx];
        if (!search && activeTab !== item.sectionId)
            setActiveTab(item.sectionId);
        const row = layout.rows[layout.itemRow[idx]];
        const view = listView.current;
        if (!scrollEl.current || !row || view.height === 0) return;
        const next = scrollTopToReveal(row, view.y, view.height);
        if (next !== null)
            scrollEl.current.scrollToOffset({ offset: next, animated: false });
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- follows the cursor, as upstream's effect does.
    }, [activeIndex]);

    function scrollToSection(id: string) {
        setActiveTab(id);
        if (!scrollEl.current) return;
        const row = layout.rows.find((r) => r.sectionId === id);
        if (row)
            scrollEl.current.scrollToOffset({
                offset: row.top,
                animated: scrollBehavior() === "smooth",
            });
    }

    function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
        const scrollTop = e.nativeEvent.contentOffset.y;
        listView.current.y = scrollTop;
        if (search) return;
        const row = layout.rows[rowAt(layout.rows, scrollTop + 8)];
        if (row && row.sectionId !== activeTab) setActiveTab(row.sectionId);
    }

    // Zami: the same function across renders (calling the latest props), so
    // the memoized rows below don't re-render when the parent does.
    const pick = useStableCallback((emoji: string) => {
        onSelect(emoji);
        onClose();
    });

    const pickCustom = useStableCallback((emoji: CustomEmoji) => {
        if (onSelectCustom) {
            onSelectCustom(emoji);
        } else {
            onSelect(`:${emoji.shortcode}:`);
        }
        onClose();
    });

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

    // Zami: an emoji glyph is about 1.2em wide, so this fills the cell's
    // padded box the way the Twemoji image did. Like the image, it follows
    // the cell, not the system text size.
    const glyphSize = Math.floor((cellSize - 8) * 0.8);

    // Zami: the option the cursor is on, outside React state: moving it
    // re-renders the cell it leaves and the one it lands on (`EmojiCell`), not
    // every row.
    const selection = useSelection<FlatItem>();
    useLayoutEffect(() => {
        selection.set(
            activeIndex >= 0 ? (flatItems[activeIndex] ?? null) : null,
        );
    }, [selection, activeIndex, flatItems]);

    const renderRow = useCallback(
        ({ item: row }: ListRenderItemInfo<Row>) => {
            if (row.kind === "header")
                return (
                    <View
                        style={{ height: row.length }}
                        className="px-1 pt-2 pb-1"
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
                <EmojiRow
                    row={row}
                    cell={cellSize}
                    glyphSize={glyphSize}
                    selection={selection}
                    pick={pick}
                    pickCustom={pickCustom}
                />
            );
        },
        [cellSize, glyphSize, selection, pick, pickCustom],
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
                getItemLayout={getItemLayout}
                onLayout={(e) => {
                    setScrollWidth(e.nativeEvent.layout.width);
                    listView.current.height = e.nativeEvent.layout.height;
                }}
                onScroll={onScroll}
                // Zami: a few screens of rows around the viewport, not the default
                // 21: opening the picker mounts a few hundred cells, not thousands.
                windowSize={7}
                scrollEventThrottle={16}
                // Zami: one tap picks an emoji even while the search field
                // holds the keyboard open.
                keyboardShouldPersistTaps="handled"
                accessibilityRole={hasOptions ? "list" : undefined}
                accessibilityLabel={hasOptions ? t("common.emoji") : undefined}
                className="relative flex-1 min-h-0"
                contentContainerClassName="px-2 pb-2"
                ListEmptyComponent={
                    search && !hasOptions ? (
                        <Text className="text-center text-discord-textMuted text-sm py-8">
                            {t("common.noResults")}
                        </Text>
                    ) : undefined
                }
            />
        </View>
    );
}

interface EmojiCellProps {
    cell: number;
    glyphSize: number;
    selection: Selection<FlatItem>;
    pick: (emoji: string) => void;
    pickCustom: (emoji: CustomEmoji) => void;
}

// Zami: a grid row, memoized: rows are rebuilt only when the packs, the
// search or the width change, and the callbacks keep their identity.
const EmojiRow = memo(function EmojiRow({
    row,
    ...cellProps
}: EmojiCellProps & { row: Extract<Row, { kind: "cells" }> }) {
    return (
        <View style={{ height: row.length }} className="flex-row gap-1">
            {row.items.map((item) => (
                <EmojiCell
                    key={
                        item.kind === "custom"
                            ? item.data.packId + ":" + item.data.shortcode
                            : item.data.name
                    }
                    item={item}
                    {...cellProps}
                />
            ))}
        </View>
    );
});

const EmojiCell = memo(function EmojiCell({
    item,
    cell,
    glyphSize,
    selection,
    pick,
    pickCustom,
}: EmojiCellProps & { item: FlatItem }) {
    // Zami: `class:ring-2` / `class:ring-discord-accent` on the option the
    // cursor is on.
    const selected = useSelected(selection, item);
    const ring = selected ? " border-2 border-discord-accent" : "";
    return item.kind === "custom" ? (
        <Pressable
            onPress={() => pickCustom(item.data)}
            accessibilityRole="button"
            accessibilityLabel={item.data.shortcode}
            accessibilityState={{ selected }}
            style={{ width: cell, height: cell }}
            className={`p-1 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors flex items-center justify-center${ring}`}
        >
            <Image
                source={mediaSource(
                    pickerThumbUrl(item.data.mxcUrl, EMOJI_THUMB_PX) ??
                        item.data.url,
                )}
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
});
