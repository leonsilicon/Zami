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
import {
    lastIndexAtOrBefore,
    type Selection,
} from "@-/com.leonsilicon.zami.incremental";
import {
    useSelected,
    useSelection,
    useStableCallback,
} from "@-/com.leonsilicon.zami.incremental/react";
import { Image, mediaSource, SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { sameObject, useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import {
    getCustomStickerPacks,
    getOwnAvatarUrl,
    getRoom,
    type CustomSticker,
} from "$lib/matrix/client";
import { roomsState } from "$lib/stores/rooms.svelte";

import { interfaceState } from "$lib/stores/interface.svelte";
import { COMPOSER_PICKER_SIZE } from "$lib/utils/pickerSize";
import { scrollBehavior } from "$lib/utils/motionPreference";
import { nextActiveIndex } from "$lib/utils/listboxNavigation";
import { anchoredActiveIndex } from "$lib/utils/listboxAnchor";
import { stickerOptionKeys } from "$lib/utils/pickerOptionKeys";

interface Props {
    roomId?: string | null;
    onSelect: (sticker: CustomSticker) => void;
    onClose: () => void;
    onSwitchToEmoji?: () => void;
    onSwitchToGif?: () => void;
}

// Zami: the web renders every pack into one scroll box and reveals each
// pack's grid lazily (`lazySection`). Here one FlatList holds the packs as
// rows, a header row and then rows of `cols` cells, and virtualizes them.
// Every row's height is known, so `getItemLayout` and the pack scrolling
// below work from these offsets instead of measuring elements.
type Row =
    | {
          kind: "header";
          key: string;
          sectionId: string;
          label: string;
          length: number;
          offset: number;
      }
    | {
          kind: "cells";
          key: string;
          items: CustomSticker[];
          paddingTop: number;
          length: number;
          offset: number;
      };

/** `grid gap-1`. */
const GAP = 4;

const NO_STICKERS: CustomSticker[] = [];

export default function StickerPicker({
    roomId = null,
    onSelect,
    onClose,
    onSwitchToEmoji,
    onSwitchToGif,
}: Props) {
    const isTouchscreen = useRune(() => interfaceState.isTouchscreen);
    const windowSize = useWindowDimensions();

    // The picker reads the room's own sticker packs; resolve the live Room
    // from the id so plugin callers (which only hold a roomId string) work.
    const room = useMemo(() => (roomId ? getRoom(roomId) : null), [roomId]);

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
    // Zami: no `revealedSections`: the FlatList only renders the rows near
    // the viewport, which is what the IntersectionObserver reveal did.

    // Responsive columns: fit as many ~68px cells as the width allows, so
    // widening the panel shows MORE stickers instead of spreading 4 apart.
    const CELL = 68;
    const [scrollWidth, setScrollWidth] = useState(0);
    const w = scrollWidth - 16; // minus the px-2 padding
    const cols = w > 0 ? Math.max(4, Math.floor(w / CELL)) : 4;
    // Zami: the grid cell (`aspect-square`, `minmax(0, 1fr)` columns).
    const cell = w > 0 ? (w - (cols - 1) * GAP) / cols : 0;

    useEffect(() => {
        if (!isTouchscreen) searchEl.current?.focus();
    }, [isTouchscreen]);

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

    // Zami: getCustomStickerPacks returns the same array until a pack
    // changes, so nothing below is rebuilt for an unrelated update.
    const stickerPacks = useRune(
        () => getCustomStickerPacks(roomsState.activeSpaceId, room),
        [room],
        { isEqual: sameObject },
    );
    const ownAvatarUrl = getOwnAvatarUrl();

    useEffect(() => {
        if (!activeTab && stickerPacks.length > 0)
            setActiveTab(stickerPacks[0].id);
    }, [activeTab, stickerPacks]);

    // Zami: every sticker with its shortcode lowercased once per pack change,
    // for the search below.
    const searchable = useMemo(
        () =>
            stickerPacks.flatMap((p) =>
                p.stickers.map((s) => ({
                    key: s.shortcode.toLowerCase(),
                    sticker: s,
                })),
            ),
        [stickerPacks],
    );
    const searchResults = useMemo(() => {
        if (!search) return NO_STICKERS;
        const query = search.toLowerCase();
        return searchable
            .filter((s) => s.key.includes(query))
            .map((s) => s.sticker);
    }, [search, searchable]);

    // Reset selection when search changes
    useEffect(() => {
        moveCursor(-1);
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- tracks only `search`, as upstream's effect does.
    }, [search]);

    // Flat ordered list of every sticker
    // Zami: the browsing list on its own, so clearing a search gets the same
    // array (and rows) back.
    const browseItems = useMemo(
        () => stickerPacks.flatMap((p) => p.stickers),
        [stickerPacks],
    );
    const flatItems = useMemo((): CustomSticker[] => {
        if (search) return searchResults;
        return browseItems;
    }, [search, searchResults, browseItems]);

    // Identity of every option, in render order — the anchor's key list.
    const activeKeys = useMemo(() => stickerOptionKeys(flatItems), [flatItems]);

    // Start index of each section in the flat list (non-search mode only)
    const sectionOffsets = useMemo((): Map<string, number> => {
        const offsets = new Map<string, number>();
        if (search) {
            offsets.set("search", 0);
            return offsets;
        }
        let offset = 0;
        for (const pack of stickerPacks) {
            offsets.set(pack.id, offset);
            offset += pack.stickers.length;
        }
        return offsets;
    }, [search, stickerPacks]);

    // The cursor, but only while the option it was placed on is still sitting
    // at that index (see upstream's comment on `activeIndex`).
    const activeIndex = anchoredActiveIndex(
        selectedIndex,
        selectedKey,
        activeKeys,
    );

    // True exactly when the box below is really rendering options. With no
    // options (a search that matches nothing) it is a plain view, so its
    // "No results" line reads as ordinary content instead of an empty list.
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
        // Zami: a binary search over the header offsets (`headers`, below).
        const current =
            headers.sectionIds[lastIndexAtOrBefore(headers.offsets, top + 8)] ??
            "";
        if (current && current !== activeTab) setActiveTab(current);
    }

    // Zami: the same function across renders (calling the latest props), so
    // the memoized rows below don't re-render when the parent does.
    const pick = useStableCallback((sticker: CustomSticker) => {
        onSelect(sticker);
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
            // with `loop: false`, because walking off the last sticker has
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
            // left past the end by a shrinking pack reads `undefined` here.
            e.preventDefault();
            const sticker = flatItems[activeIndex];
            if (sticker) pick(sticker);
        }
    }

    // Zami: the search field's `onkeydown`.
    useInputKeys(searchEl, { onKeydown: onSearchKeydown });

    // Zami: the rows the FlatList renders, with their heights and offsets.
    // Header text is `text-xs` (a 16px line, scaled with the system text
    // size) plus its `pt-2 pb-1`; a grid row is a cell plus the `gap-1`
    // below it, or the grid's `mb-2` below the last row.
    const fontScale = windowSize.fontScale;
    const rows = useMemo((): Row[] => {
        const out: Row[] = [];
        if (cell <= 0) return out;
        let offset = 0;
        const grid = (
            sectionId: string,
            count: number,
            marginTop: number,
            marginBottom: number,
        ) => {
            const start = sectionOffsets.get(sectionId) ?? 0;
            const rowCount = Math.ceil(count / cols);
            for (let r = 0; r < rowCount; r++) {
                const paddingTop = r === 0 ? marginTop : 0;
                const length =
                    paddingTop +
                    cell +
                    (r === rowCount - 1 ? marginBottom : GAP);
                out.push({
                    kind: "cells",
                    key: `row:${sectionId}:${r}`,
                    items: flatItems.slice(
                        start + r * cols,
                        start + Math.min((r + 1) * cols, count),
                    ),
                    paddingTop,
                    length,
                    offset,
                });
                offset += length;
            }
        };
        if (search) {
            grid("search", searchResults.length, 4, 0);
        } else {
            for (const pack of stickerPacks) {
                const length = 12 + 16 * fontScale;
                out.push({
                    kind: "header",
                    key: `header:${pack.id}`,
                    sectionId: pack.id,
                    label:
                        pack.id === "user"
                            ? t("stickerPicker.myStickers2")
                            : pack.name,
                    length,
                    offset,
                });
                offset += length;
                grid(pack.id, pack.stickers.length, 0, 8);
            }
        }
        return out;
    }, [
        cell,
        cols,
        fontScale,
        search,
        searchResults,
        stickerPacks,
        flatItems,
        sectionOffsets,
    ]);
    // Zami: the header rows' offsets and packs, for onScroll's search.
    const headers = useMemo(() => {
        const offsets: number[] = [];
        const sectionIds: string[] = [];
        for (const row of rows) {
            if (row.kind !== "header") continue;
            offsets.push(row.offset);
            sectionIds.push(row.sectionId);
        }
        return { offsets, sectionIds };
    }, [rows]);
    const getItemLayout = useCallback(
        (_: unknown, index: number) => ({
            length: rows[index].length,
            offset: rows[index].offset,
            index,
        }),
        [rows],
    );

    // Update the active tab and scroll the selected item into view.
    // Zami: the FlatList renders every row near the viewport, so there's no
    // pack to reveal; `scrollIntoView({ block: "nearest" })` is worked out
    // from the row offsets and the list's own scroll position.
    const listView = useRef({ y: 0, height: 0 });
    useEffect(() => {
        const idx = activeIndex;
        if (idx < 0 || idx >= flatItems.length) return;

        if (!search) {
            for (const pack of stickerPacks) {
                const start = sectionOffsets.get(pack.id) ?? 0;
                if (idx >= start && idx < start + pack.stickers.length) {
                    if (activeTab !== pack.id) setActiveTab(pack.id);
                    break;
                }
            }
        }

        const item = flatItems[idx];
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

    // Zami: the sticker the cursor is on, outside React state: moving it
    // re-renders the cell it leaves and the one it lands on (`StickerCell`),
    // not every row.
    const selection = useSelection<CustomSticker>();
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
                <StickerRow
                    row={row}
                    cell={cell}
                    selection={selection}
                    pick={pick}
                />
            );
        },
        [cell, selection, pick],
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
            {isTouchscreen && (onSwitchToEmoji || onSwitchToGif) ? (
                <View className="flex-row border-b border-discord-divider flex-shrink-0">
                    {onSwitchToEmoji ? (
                        <Pressable
                            onPress={onSwitchToEmoji}
                            accessibilityRole="button"
                            className="flex-1 py-2 items-center"
                        >
                            <Text className="text-sm font-medium text-discord-textMuted">
                                {t("common.emoji")}
                            </Text>
                        </Pressable>
                    ) : null}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: true }}
                        className="flex-1 py-2 items-center border-b-2 border-discord-accent"
                    >
                        <Text className="text-sm font-semibold text-discord-textPrimary">
                            {t("common.stickers")}
                        </Text>
                    </Pressable>
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
                    rewrite a half-typed shortcode the search filters on. */}
                <TextInput
                    ref={searchEl}
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t("stickerPicker.searchStickers")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityRole="search"
                    accessibilityLabel={t("stickerPicker.searchStickers2")}
                    accessibilityState={{ expanded: hasOptions }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    // Zami: Enter picks the selected sticker (onSearchKeydown)
                    // and otherwise does nothing, rather than blurring.
                    submitBehavior="submit"
                    className="w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded-lg px-3 py-1.5 border border-transparent focus:border-discord-accent/30"
                />
            </View>

            {stickerPacks.length === 0 ? (
                // flex-1 so the empty state centres in the now fixed-height
                // touch drawer instead of hugging the top of a half-empty box.
                <View className="flex-1 items-center justify-center py-8 px-4">
                    <Text className="text-center text-discord-textMuted text-sm">
                        {t("stickerPicker.noStickerPacksAvailable")}
                    </Text>
                </View>
            ) : (
                <>
                    {/* Tab bar */}
                    {!search ? (
                        <ScrollView
                            ref={tabBarEl}
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                            onLayout={(e) => {
                                tabBarView.current.width =
                                    e.nativeEvent.layout.width;
                            }}
                            onScroll={(e) => {
                                tabBarView.current.x =
                                    e.nativeEvent.contentOffset.x;
                            }}
                            scrollEventThrottle={16}
                            className="flex-shrink-0 flex-grow-0"
                            contentContainerClassName="flex-row items-center gap-0.5 px-2 pb-1"
                        >
                            {stickerPacks.map((pack) => (
                                <Pressable
                                    key={pack.id}
                                    onLayout={(e) => {
                                        tabLayouts.current.set(
                                            pack.id,
                                            e.nativeEvent.layout,
                                        );
                                        if (pack.id === activeTab)
                                            scrollTabIntoView(pack.id);
                                    }}
                                    onPress={() => scrollToSection(pack.id)}
                                    accessibilityRole="button"
                                    accessibilityLabel={pack.name}
                                    accessibilityState={{
                                        selected: activeTab === pack.id,
                                    }}
                                    className={`flex-shrink-0 p-1.5 rounded transition-colors ${
                                        activeTab === pack.id
                                            ? "bg-discord-messageHover"
                                            : "opacity-40"
                                    }`}
                                >
                                    {pack.id === "user" && ownAvatarUrl ? (
                                        <Image
                                            source={mediaSource(ownAvatarUrl)}
                                            accessibilityLabel={t(
                                                "stickerPicker.myStickers",
                                            )}
                                            className="w-5 h-5 rounded-full"
                                            contentFit="cover"
                                        />
                                    ) : pack.id === "user" ? (
                                        <SvgIcon
                                            d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
                                            className="w-5 h-5 text-discord-textPrimary"
                                        />
                                    ) : pack.avatarUrl ? (
                                        <Image
                                            source={mediaSource(pack.avatarUrl)}
                                            accessibilityLabel={pack.name}
                                            className="w-5 h-5 rounded-full"
                                            contentFit="cover"
                                        />
                                    ) : (
                                        <View className="w-5 h-5 rounded-full bg-discord-accent flex items-center justify-center">
                                            <Text className="text-white text-xs font-bold">
                                                {pack.name[0]?.toUpperCase() ??
                                                    "?"}
                                            </Text>
                                        </View>
                                    )}
                                </Pressable>
                            ))}
                        </ScrollView>
                    ) : null}

                    {/* Scrollable area. One list owns every pack, so the
                        grids stay one list. It is labelled as one only while
                        it holds options: a search that matches nothing leaves
                        its "No results" line as plain content. */}
                    <FlatList
                        ref={scrollEl}
                        data={rows}
                        keyExtractor={(row) => row.key}
                        renderItem={renderRow}
                        getItemLayout={getItemLayout}
                        onLayout={(e) => {
                            setScrollWidth(e.nativeEvent.layout.width);
                            listView.current.height =
                                e.nativeEvent.layout.height;
                        }}
                        onScroll={onScroll}
                        // Zami: a few screens of rows around the viewport, not the default
                        // 21: opening the picker mounts a few hundred cells, not thousands.
                        windowSize={7}
                        scrollEventThrottle={16}
                        // Zami: one tap picks a sticker even while the search
                        // field holds the keyboard open.
                        keyboardShouldPersistTaps="handled"
                        accessibilityRole={hasOptions ? "list" : undefined}
                        accessibilityLabel={
                            hasOptions ? t("common.stickers") : undefined
                        }
                        className="relative flex-1 min-h-0"
                        contentContainerClassName="px-2 pb-2"
                        ListEmptyComponent={
                            search && searchResults.length === 0 ? (
                                <Text className="text-center text-discord-textMuted text-sm py-8">
                                    {t("common.noResults")}
                                </Text>
                            ) : undefined
                        }
                    />
                </>
            )}
        </View>
    );
}

interface StickerCellProps {
    cell: number;
    selection: Selection<CustomSticker>;
    pick: (sticker: CustomSticker) => void;
}

// Zami: a grid row, memoized: rows are rebuilt only when the packs, the
// search or the width change, and the callback keeps its identity.
const StickerRow = memo(function StickerRow({
    row,
    ...cellProps
}: StickerCellProps & { row: Extract<Row, { kind: "cells" }> }) {
    return (
        <View
            style={{ height: row.length, paddingTop: row.paddingTop }}
            className="flex-row gap-1"
        >
            {row.items.map((s) => (
                <StickerCell key={s.shortcode} sticker={s} {...cellProps} />
            ))}
        </View>
    );
});

const StickerCell = memo(function StickerCell({
    sticker: s,
    cell,
    selection,
    pick,
}: StickerCellProps & { sticker: CustomSticker }) {
    // Zami: `class:ring-2` / `class:ring-discord-accent` on the option the
    // cursor is on.
    const selected = useSelected(selection, s);
    return (
        <Pressable
            onPress={() => pick(s)}
            accessibilityRole="button"
            accessibilityLabel={s.shortcode}
            accessibilityState={{ selected }}
            style={{ width: cell, height: cell }}
            className={`p-1 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors flex items-center justify-center${
                selected ? " border-2 border-discord-accent" : ""
            }`}
        >
            <Image
                source={mediaSource(s.url)}
                accessibilityLabel={s.shortcode}
                className="w-14 h-14"
                contentFit="contain"
            />
        </Pressable>
    );
});
