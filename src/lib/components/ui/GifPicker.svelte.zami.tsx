import { useEffect, useMemo, useRef, useState } from "react";
import {
    FlatList,
    Pressable,
    Text,
    TextInput,
    View,
    useWindowDimensions,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    type TextInputInstance,
    type ListViewToken,
} from "react-native";
import { useInputKeys, useKeyScope } from "@-/com.leonsilicon.zami.browser";
import { Image, SvgIcon, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import FavouriteFileImg from "$lib/components/ui/FavouriteFileImg.svelte";
import {
    eventFavouriteFile,
    parseEventFavouriteSource,
} from "$lib/matrix/favouriteFile";
import {
    favouritesState,
    addFavouriteGif,
    removeFavouriteGif,
    isFavouriteGif,
    setFavouriteGifTags,
    upgradeFavouriteGifs,
    type FavouriteGif,
} from "$lib/stores/favourites.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import { gifSendUrl, type GifKind, type GifResult } from "$lib/utils/klipy";
import {
    gifSearchState,
    loadGifs,
    queueSearch,
    loadMore,
} from "$lib/stores/gifSearch.svelte";
import { Star } from "lucide-svelte";
import { COMPOSER_PICKER_SIZE } from "$lib/utils/pickerSize";
import { safeAspectRatio } from "$lib/utils/mediaDimensions";
import {
    favouriteAspectStyle,
    learnGifAspect,
} from "$lib/utils/gifAspect.svelte";
import { overlayActionClass } from "$lib/utils/touchTargets";
import { masonryColumnCount } from "$lib/utils/masonry";
import { scrollBehavior } from "$lib/utils/motionPreference";
import { nextActiveIndex, type NavKey } from "$lib/utils/listboxNavigation";
import { anchoredActiveIndex } from "$lib/utils/listboxAnchor";

interface Props {
    onSelect: (url: string) => void;
    /** Picked a favourite that has no URL (an encrypted GIF): attach it. */
    onSelectFile?: (file: File) => void;
    onClose: () => void;
    onSwitchToEmoji?: () => void;
    onSwitchToSticker?: () => void;
}

type Tab = "gifs" | "favourites";

const STAR =
    "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";
const PENCIL =
    "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z";

/** `gap-x-1` between the columns. */
const GAP = 4;

/** Zami: an `aspect-ratio: <w> / <h>` style (from safeAspectRatio) as a number. */
function cssAspectRatio(style: string | undefined): number | undefined {
    const m = /aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(style ?? "");
    if (!m) return undefined;
    const w = Number(m[1]);
    const h = Number(m[2]);
    return w > 0 && h > 0 ? w / h : undefined;
}

export default function GifPicker({
    onSelect,
    onSelectFile,
    onClose,
    onSwitchToEmoji,
    onSwitchToSticker,
}: Props) {
    const isTouchscreen = useRune(() => interfaceState.isTouchscreen);
    const windowSize = useWindowDimensions();

    // Land on the configured tab ("gifs" or "favourites").
    const [tab, setTab] = useState<Tab>(() =>
        settingsState.gifDefaultTab === "favourites" ? "favourites" : "gifs",
    );

    const [search, setSearch] = useState("");
    const searchEl = useRef<TextInputInstance>(null);

    useEffect(() => {
        if (!isTouchscreen) searchEl.current?.focus();
    }, [isTouchscreen]);

    // Tab change → immediate KLIPY load. `search` is read untracked so
    // typing does NOT retrigger this effect; typing is debounced in
    // onSearchInput instead. This avoids a wasted request on switch.
    useEffect(() => {
        const t = tab;
        if (t === "favourites") return;
        const kind: GifKind = "gifs";
        loadGifs(kind, search);
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- `search` is read untracked.
    }, [tab]);

    function onSearchInput(value: string) {
        setSearch(value);
        // Typing is text editing, not list navigation: drop the cursor so the
        // caret gets Left/Right/Home/End back, and so the KLIPY results that
        // land 350ms later cannot inherit a selection made against the ones
        // they replace.
        moveCursor(-1);
        if (tab !== "favourites") {
            const kind: GifKind = "gifs";
            queueSearch(kind, value);
        }
    }

    // Favourites tab: local text filter over the URL and the user's tags.
    const favourites = useRune(() => favouritesState.gifs);
    const visibleFavourites = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return favourites;
        return favourites.filter(
            (g) =>
                g.url.toLowerCase().includes(q) ||
                (g.tags ?? []).some((t) => t.includes(q)),
        );
    }, [favourites, search]);

    // Masonry columns (see utils/masonry). Favourites round-robin so the top
    // row is always the newest few and nothing but the list itself decides
    // where a tile sits; KLIPY results carry dimensions, so they balance by
    // height, and appending a page never moves the tiles already shown.
    // Zami: a FlatList with `numColumns` instead, which virtualizes the
    // endless KLIPY list (and its animated previews). It places tiles in rows
    // in list order, as the round-robin does, but doesn't balance the
    // columns' heights: a row is as tall as its tallest tile.
    const [masonryWidth, setMasonryWidth] = useState(0);
    const columnCount = masonryColumnCount(masonryWidth, 165, GAP);
    const tileWidth =
        masonryWidth > 0
            ? (masonryWidth - (columnCount - 1) * GAP) / columnCount
            : 0;

    const items = useRune(() => gifSearchState.items);
    const loading = useRune(() => gifSearchState.loading);
    const error = useRune(() => gifSearchState.error);
    const exhausted = useRune(() => gifSearchState.exhausted);

    // The keyboard cursor: the index of the arrow-selected GIF, and the GIF
    // it was put on (see upstream's comment: the list is replaced wholesale
    // by a debounced KLIPY response or a tab flip, so the index alone could
    // send a GIF the user never saw).
    // Zami: not ported: the combobox/listbox ARIA ids it drives, which React
    // Native has no equivalent of.
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

    // The flat list of options actually on screen -- whichever tab is
    // rendering.
    const activeKeys: string[] =
        tab === "favourites"
            ? visibleFavourites.map((g) => g.url)
            : items.map(gifSendUrl);

    // True exactly when the box below is really rendering options. With no
    // options the box is a plain view, which is what lets its empty states
    // ("No favourite GIFs yet…", "No results", the KLIPY error retry button)
    // be read as ordinary content.
    const hasOptions = activeKeys.length > 0;

    // Re-clamped and anchored, so a cursor is only ever active while it still
    // sits on the GIF it was put on. Everything downstream -- the ring, Enter
    // -- reads this rather than `selectedIndex`.
    const activeIndex = anchoredActiveIndex(
        selectedIndex,
        selectedUrl,
        activeKeys,
    );

    function moveCursor(next: number) {
        setSelectedIndex(next);
        setSelectedUrl(next >= 0 ? (activeKeys[next] ?? null) : null);
    }

    // Tag editor: the URL of the favourite currently being edited, plus its
    // draft (comma-separated) tag text.
    const [editingUrl, setEditingUrl] = useState<string | null>(null);
    // Zami: also kept in a ref, so the blur that follows Enter (as the input
    // unmounts) doesn't save a second time from a render that predates it.
    const editing = useRef<string | null>(null);
    const [tagDraft, setTagDraft] = useState("");

    function startEditing(gif: FavouriteGif) {
        editing.current = gif.url;
        setEditingUrl(gif.url);
        setTagDraft((gif.tags ?? []).join(", "));
        // Zami: the input focuses itself and selects its text
        // (autoFocus, selectTextOnFocus).
    }

    async function saveTags() {
        const url = editing.current;
        if (!url) return;
        editing.current = null;
        setEditingUrl(null);
        await setFavouriteGifTags(url, tagDraft.split(","));
    }

    // The picker closes on Escape; while editing, Escape only cancels.
    // Zami: Enter saves (onSubmitEditing); the tile's tag field takes the
    // rest of onTagKeydown.
    function onTagKeydown(e: KeyboardEvent) {
        e.stopPropagation();
        if (e.key === "Escape") {
            editing.current = null;
            setEditingUrl(null);
        }
    }

    // These sit on top of the full-bleed "send this GIF" button, so anything
    // missed by a fat finger sends the GIF instead of acting on it. Sized to
    // the WCAG target-size minimums rather than by eye.
    const favBtnClass = overlayActionClass(isTouchscreen);

    function pickUrl(url: string) {
        onSelect(url);
        onClose();
    }

    // Zami: unused upstream too (a favourite's tile sends pickUrl(gif.url)).
    // oxlint-disable-next-line no-unused-vars -- kept so upstream's diffs map.
    async function pickFavourite(gif: FavouriteGif) {
        const source = parseEventFavouriteSource(gif.source);
        if (!source) return pickUrl(gif.url);
        const file = await eventFavouriteFile(source).catch(() => null);
        if (!file) return;
        onSelectFile?.(file);
        onClose();
    }

    // Favourites starred before the picker sent klipy.com page links are keyed
    // by the static CDN URL, which carries no slug. When one of them turns up
    // in the results, move it onto the page link so it is sent as one too.
    useEffect(() => {
        void favourites; // isFavouriteGif reads it
        const upgrades = items
            .filter((r) => r.pageUrl && isFavouriteGif(r.url))
            .map((r) => ({
                from: r.url,
                to: r.pageUrl!,
                previewVideoUrl: r.previewVideoUrl,
            }));
        if (upgrades.length) void upgradeFavouriteGifs(upgrades);
    }, [items, favourites]);

    function toggleStar(r: GifResult) {
        const url = gifSendUrl(r);
        if (isFavouriteGif(url)) void removeFavouriteGif(url);
        else
            void addFavouriteGif({
                url,
                previewUrl: r.previewUrl,
                ...(r.previewVideoUrl
                    ? { previewVideoUrl: r.previewVideoUrl }
                    : {}),
                ...(r.width > 0 && r.height > 0
                    ? { width: r.width, height: r.height }
                    : {}),
            });
    }

    function onGridScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
        if (tab === "favourites") return;
        const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
        const nearBottom =
            contentOffset.y + layoutMeasurement.height >=
            contentSize.height - 200;
        if (nearBottom) loadMore();
    }

    // Keep the grid filled. If the results don't overflow the scroll area (few
    // results, or the panel was resized bigger / wider = more columns = shorter
    // content), there's nothing to scroll, so scroll-based pagination never
    // fires and you're stuck on page 1. Load more until it overflows or KLIPY
    // is exhausted. Zami: the box's onLayout and the list's
    // onContentSizeChange stand in for the ResizeObserver and scrollHeight.
    const [gridHeight, setGridHeight] = useState(0);
    const [listHeight, setListHeight] = useState(0);
    const resultsListed =
        tab !== "favourites" &&
        !(error && items.length === 0) &&
        !(items.length === 0 && !loading);
    const scrollHeight = resultsListed ? listHeight : 0;
    useEffect(() => {
        // re-run when results change or the panel resizes
        void items.length;
        if (tab === "favourites" || !gridHeight) return;
        if (!loading && !exhausted && scrollHeight <= gridHeight + 8) {
            loadMore();
        }
    }, [items.length, loading, exhausted, tab, gridHeight, scrollHeight]);

    // Keep the arrow-selected GIF in view. `block: "nearest"` leaves an option
    // that is already fully visible alone, so arrowing around inside the
    // viewport never touches the scroll position.
    // Zami: the FlatList reports which tiles are fully visible; a row it
    // hasn't measured scrolls by the average row's height.
    const gridList = useRef<FlatList<unknown>>(null);
    const fullyVisible = useRef(new Set<number>());
    const [onViewableItemsChanged] = useState(
        () =>
            ({ viewableItems }: { viewableItems: ListViewToken[] }) => {
                fullyVisible.current = new Set(
                    viewableItems.map((v) => v.index ?? -1),
                );
            },
    );
    const [viewabilityConfig] = useState({ itemVisiblePercentThreshold: 100 });
    const lastIndex = useRef(-1);
    useEffect(() => {
        const index = activeIndex;
        const previous = lastIndex.current;
        lastIndex.current = index;
        if (index < 0 || fullyVisible.current.has(index)) return;
        gridList.current?.scrollToIndex({
            index: Math.floor(index / columnCount),
            viewPosition: index > previous ? 1 : 0,
            animated: scrollBehavior() === "smooth",
        });
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- follows the cursor, as upstream's effect does.
    }, [activeIndex]);

    // Zami: hardware keys are observed, not intercepted, so the arrow keys
    // also move the search field's caret, as they do there with nothing
    // selected.
    function onSearchKeydown(e: KeyboardEvent) {
        // On a one-dimensional list ArrowLeft/ArrowRight are the same single
        // step as ArrowUp/ArrowDown, so they map onto the two keys the shared
        // navigation helper knows about.
        let key: NavKey | null = null;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") key = "ArrowDown";
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") key = "ArrowUp";
        else if (e.key === "Home" || e.key === "End") key = e.key;

        if (key) {
            // ArrowUp/ArrowDown enter the list from the text field the way any
            // combobox does. The rest only steer it once the user is already
            // navigating.
            const entersList = e.key === "ArrowDown" || e.key === "ArrowUp";
            if (!entersList && activeIndex < 0) return;
            if (!activeKeys.length) return;
            e.preventDefault();
            // `loop: false`: walking off the end of the paginated KLIPY list
            // scrolls its last tile into view, which loads the next page.
            moveCursor(
                nextActiveIndex(activeIndex, activeKeys.length, key, {
                    loop: false,
                }),
            );
            return;
        }

        // `activeIndex`, never `selectedIndex`. Escape is deliberately not
        // handled here -- it bubbles to the panel's own onkeydown, which
        // closes the picker.
        if (e.key === "Enter" && activeIndex >= 0) {
            e.preventDefault();
            pickUrl(activeKeys[activeIndex]);
        }
    }

    // Zami: the search field's `onkeydown`.
    useInputKeys(searchEl, { onKeydown: onSearchKeydown });

    function onKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") onClose();
    }

    // Zami: the panel's `onkeydown`: its keys, with focus in the search field
    // or nowhere.
    useKeyScope({ onKeydown }, [searchEl]);

    function selectTab(next: Tab) {
        // The two tabs are different lists, so a cursor carried across would
        // land on an unrelated GIF that happens to share its index.
        moveCursor(-1);
        // The $effect above performs the immediate load when `tab` changes.
        setTab(next);
    }

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
            {isTouchscreen ? (
                // Outer picker tabs (Emoji / Stickers / GIFs)
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
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: true }}
                        className="flex-1 py-2 items-center border-b-2 border-discord-accent"
                    >
                        <Text className="text-sm font-semibold text-discord-textPrimary">
                            {t("common.gifs")}
                        </Text>
                    </Pressable>
                </View>
            ) : null}

            {/* Inner content tabs */}
            <View className="flex-row gap-1 px-2 pt-2 flex-shrink-0">
                {(
                    [
                        ["gifs", "GIFs"],
                        ["favourites", "Favourites"],
                    ] as const
                ).map(([value, label]) => (
                    <Pressable
                        key={value}
                        onPress={() => selectTab(value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: tab === value }}
                        className={`flex-1 py-1.5 rounded transition-colors ${
                            tab === value ? "bg-discord-backgroundTertiary" : ""
                        }`}
                    >
                        <View className="flex-row items-center justify-center gap-1">
                            {value === "favourites" ? (
                                <Star
                                    size={14}
                                    className={
                                        tab === value
                                            ? "text-discord-textPrimary"
                                            : "text-discord-textMuted"
                                    }
                                />
                            ) : null}
                            <Text
                                className={`text-xs font-semibold ${
                                    tab === value
                                        ? "text-discord-textPrimary"
                                        : "text-discord-textMuted"
                                }`}
                            >
                                {label}
                            </Text>
                        </View>
                    </Pressable>
                ))}
            </View>

            {/* Search */}
            <View className="px-3 pt-3 pb-2 flex-shrink-0">
                {/* Zami: no autocapitalization or autocorrect, which would
                    rewrite a half-typed search. */}
                <TextInput
                    ref={searchEl}
                    value={search}
                    onChangeText={onSearchInput}
                    placeholder={
                        tab === "favourites"
                            ? t("gifPicker.searchFavourites")
                            : t("gifPicker.searchKlipy")
                    }
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityRole="search"
                    accessibilityLabel={
                        tab === "favourites"
                            ? t("gifPicker.searchFavourites2")
                            : t("gifPicker.searchGifs")
                    }
                    accessibilityState={{ expanded: hasOptions }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    // Zami: Enter picks the selected GIF (onSearchKeydown) and
                    // otherwise does nothing, rather than blurring.
                    submitBehavior="submit"
                    className="w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded-lg px-3 py-1.5 border border-transparent focus:border-discord-accent/30"
                />
            </View>

            {/* Grid. This scroll box is rendered on both tabs and in every
                empty state, and it is labelled as a list only while it is
                really holding options. */}
            <View
                className="flex-1 min-h-0"
                onLayout={(e) => {
                    // minus the px-2 padding
                    setMasonryWidth(e.nativeEvent.layout.width - 16);
                    setGridHeight(e.nativeEvent.layout.height);
                }}
            >
                {tab === "favourites" ? (
                    visibleFavourites.length === 0 ? (
                        <Text className="text-center text-discord-textMuted text-sm py-8 px-4">
                            {favourites.length === 0
                                ? t("gifPicker.noFavouriteGifsYetStarA")
                                : t("common.noResults")}
                        </Text>
                    ) : (
                        <FlatList
                            ref={gridList as never}
                            // A FlatList can't change its column count in place.
                            key={`favourites:${columnCount}`}
                            data={visibleFavourites}
                            numColumns={columnCount}
                            keyExtractor={(gif) => gif.url}
                            columnWrapperStyle={
                                columnCount > 1
                                    ? { gap: GAP, alignItems: "flex-start" }
                                    : undefined
                            }
                            extraData={[
                                editingUrl,
                                tagDraft,
                                tileWidth,
                                activeIndex,
                            ]}
                            onViewableItemsChanged={onViewableItemsChanged}
                            viewabilityConfig={viewabilityConfig}
                            onScrollToIndexFailed={(info) =>
                                gridList.current?.scrollToOffset({
                                    offset: info.averageItemLength * info.index,
                                })
                            }
                            renderItem={({ item: gif, index: idx }) => (
                                <FavouriteTile
                                    gif={gif}
                                    idx={idx}
                                    selected={activeIndex === idx}
                                    onTagKeydown={onTagKeydown}
                                    width={tileWidth}
                                    isTouchscreen={isTouchscreen}
                                    favBtnClass={favBtnClass}
                                    editing={editingUrl === gif.url}
                                    tagDraft={tagDraft}
                                    onTagDraftChange={setTagDraft}
                                    onPick={() => pickUrl(gif.url)}
                                    onStartEditing={() => startEditing(gif)}
                                    onSaveTags={() => void saveTags()}
                                />
                            )}
                            // Zami: one tap picks a GIF even while the search
                            // field holds the keyboard open.
                            keyboardShouldPersistTaps="handled"
                            accessibilityRole="list"
                            accessibilityLabel={t("gifPicker.favourites")}
                            className="flex-1"
                            contentContainerClassName="px-2 pb-2 pt-1"
                        />
                    )
                ) : // KLIPY GIFs
                error && items.length === 0 ? (
                    <Pressable
                        onPress={() => loadGifs("gifs", search)}
                        accessibilityRole="button"
                        className="w-full py-8 px-4"
                    >
                        <Text className="text-center text-discord-textMuted text-sm">
                            {error}
                        </Text>
                    </Pressable>
                ) : items.length === 0 && !loading ? (
                    <Text className="text-center text-discord-textMuted text-sm py-8 px-4">
                        {t("common.noResults")}
                    </Text>
                ) : (
                    <FlatList
                        ref={gridList as never}
                        key={`results:${columnCount}`}
                        data={items}
                        numColumns={columnCount}
                        keyExtractor={(r) => r.id}
                        columnWrapperStyle={
                            columnCount > 1
                                ? { gap: GAP, alignItems: "flex-start" }
                                : undefined
                        }
                        extraData={[tileWidth, activeIndex]}
                        onViewableItemsChanged={onViewableItemsChanged}
                        viewabilityConfig={viewabilityConfig}
                        onScrollToIndexFailed={(info) =>
                            gridList.current?.scrollToOffset({
                                offset: info.averageItemLength * info.index,
                            })
                        }
                        renderItem={({ item: r, index: idx }) => (
                            <ResultTile
                                r={r}
                                idx={idx}
                                selected={activeIndex === idx}
                                width={tileWidth}
                                favBtnClass={favBtnClass}
                                onPick={() => pickUrl(gifSendUrl(r))}
                                onToggleStar={() => toggleStar(r)}
                            />
                        )}
                        onScroll={onGridScroll}
                        scrollEventThrottle={16}
                        onContentSizeChange={(_, h) => setListHeight(h)}
                        keyboardShouldPersistTaps="handled"
                        accessibilityRole={hasOptions ? "list" : undefined}
                        accessibilityLabel={
                            hasOptions
                                ? search.trim()
                                    ? t("common.searchResults")
                                    : t("gifPicker.trending")
                                : undefined
                        }
                        className="flex-1"
                        contentContainerClassName="px-2 pb-2 pt-1"
                        ListFooterComponent={
                            <>
                                {loading ? (
                                    <Text className="text-center text-discord-textMuted text-xs py-3">
                                        {t("common.loading")}
                                    </Text>
                                ) : null}
                                {error ? (
                                    <Pressable
                                        onPress={() => loadMore()}
                                        accessibilityRole="button"
                                        className="w-full py-3"
                                    >
                                        <Text className="text-center text-discord-textMuted text-xs">
                                            {error}
                                        </Text>
                                    </Pressable>
                                ) : null}
                            </>
                        }
                    />
                )}
            </View>

            {tab !== "favourites" ? (
                <View className="px-3 py-1.5 flex-shrink-0 border-t border-discord-divider">
                    <Text className="text-[10px] text-discord-textMuted text-right">
                        {t("gifPicker.poweredByKlipy")}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

/** Zami: one favourite's tile, a component of its own so it can read the
 *  aspect ratio gifAspect learns (a rune) as the list renders it. */
function FavouriteTile({
    gif,
    idx,
    selected,
    onTagKeydown,
    width,
    isTouchscreen,
    favBtnClass,
    editing,
    tagDraft,
    onTagDraftChange,
    onPick,
    onStartEditing,
    onSaveTags,
}: {
    gif: FavouriteGif;
    idx: number;
    /** Zami: the keyboard cursor is on it (`activeIndex === idx`). */
    selected: boolean;
    /** Zami: the tag field's `onkeydown`. */
    onTagKeydown: (e: KeyboardEvent) => void;
    width: number;
    isTouchscreen: boolean;
    favBtnClass: string;
    editing: boolean;
    tagDraft: string;
    onTagDraftChange: (value: string) => void;
    onPick: () => void;
    onStartEditing: () => void;
    onSaveTags: () => void;
}) {
    const source = parseEventFavouriteSource(gif.source);
    const { previewUrl, width: gifWidth, height: gifHeight } = gif;
    const aspectStyle = useRune(
        () =>
            favouriteAspectStyle({
                previewUrl,
                width: gifWidth,
                height: gifHeight,
            }),
        [previewUrl, gifWidth, gifHeight],
    );
    const tags = gif.tags ?? [];
    const tagInput = useRef<TextInputInstance>(null);
    useInputKeys(tagInput, { onKeydown: onTagKeydown }, editing);
    return (
        <View className="relative mb-1" style={{ width }}>
            {/* The <img> is alt="", so without a label this button announces
                as bare "button". The user's own tags are the only
                human-readable thing a favourite carries. */}
            <Pressable
                onPress={onPick}
                accessibilityRole="button"
                accessibilityLabel={
                    tags.length
                        ? t("gifPicker.gifTagged", { join: tags.join(", ") })
                        : t("gifPicker.favouriteGif", { value: idx + 1 })
                }
                accessibilityState={{ selected }}
                className={`w-full rounded overflow-hidden active:opacity-80 transition-opacity${
                    selected ? " border-2 border-discord-accent" : ""
                }`}
            >
                {source ? (
                    <FavouriteFileImg
                        source={source}
                        class="w-full rounded bg-discord-backgroundTertiary"
                        style={aspectStyle}
                    />
                ) : (
                    // Zami: the preview itself, which expo-image animates
                    // (GIF and WebP), where upstream plays `previewVideoUrl`
                    // in a muted looping <video> when there is one.
                    <Image
                        source={mediaSource(gif.previewUrl)}
                        accessible={false}
                        className="w-full rounded bg-discord-backgroundTertiary"
                        style={{ aspectRatio: cssAspectRatio(aspectStyle) }}
                        onLoad={(e) =>
                            learnGifAspect(
                                gif.previewUrl,
                                e.source.width,
                                e.source.height,
                            )
                        }
                    />
                )}
            </Pressable>
            {/* Touchscreens have no hover, so the controls stay visible there
                instead of revealing on hover. The selected tile reveals its
                controls too, or a keyboard user gets a selection ring and
                nothing to act on. */}
            <View
                className={`absolute top-1 end-1 flex-row gap-1 transition-opacity ${
                    isTouchscreen || selected
                        ? "opacity-100"
                        : "opacity-0 group-hover/gif:opacity-100 group-focus-within/gif:opacity-100"
                }`}
            >
                <Pressable
                    onPress={onStartEditing}
                    accessibilityRole="button"
                    accessibilityLabel={t("gifPicker.editTags")}
                    className={favBtnClass}
                >
                    <SvgIcon d={PENCIL} className="w-3.5 h-3.5 text-white" />
                </Pressable>
                <Pressable
                    onPress={() => void removeFavouriteGif(gif.url)}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.removeFromFavourites")}
                    className={favBtnClass}
                >
                    <SvgIcon
                        d={STAR}
                        className="w-3.5 h-3.5 text-discord-warning"
                    />
                </Pressable>
            </View>
            {tags.length && !editing ? (
                <View
                    pointerEvents="none"
                    className="absolute bottom-0 inset-x-0 px-1 py-0.5 rounded-b bg-black/60"
                >
                    <Text numberOfLines={1} className="text-[10px] text-white">
                        {tags.join(", ")}
                    </Text>
                </View>
            ) : null}
            {editing ? (
                <View className="absolute inset-0 rounded bg-black/80 flex flex-col justify-center gap-1 p-1.5">
                    <TextInput
                        ref={tagInput}
                        value={tagDraft}
                        onChangeText={onTagDraftChange}
                        onSubmitEditing={onSaveTags}
                        onBlur={onSaveTags}
                        autoFocus
                        selectTextOnFocus
                        placeholder={t("gifPicker.catFunny")}
                        placeholderTextColorClassName="accent-discord-textMuted"
                        autoCapitalize="none"
                        returnKeyType="done"
                        className="w-full bg-discord-backgroundTertiary text-discord-textPrimary text-xs rounded px-1.5 py-1 border border-transparent focus:border-discord-accent/30"
                    />
                    <Text className="text-[10px] text-discord-textMuted">
                        {t("gifPicker.commaSeparatedEnterToSave")}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

/** Zami: one KLIPY result's tile, which reads whether it's a favourite. */
function ResultTile({
    r,
    idx,
    selected,
    width,
    favBtnClass,
    onPick,
    onToggleStar,
}: {
    r: GifResult;
    idx: number;
    /** Zami: the keyboard cursor is on it (`activeIndex === idx`). */
    selected: boolean;
    width: number;
    favBtnClass: string;
    onPick: () => void;
    onToggleStar: () => void;
}) {
    const sendUrl = gifSendUrl(r);
    const favourited = useRune(() => isFavouriteGif(sendUrl), [sendUrl]);
    return (
        <View className="relative mb-1" style={{ width }}>
            {/* The <img> is alt="", so without a label this button announces
                as bare "button". A normalized KLIPY result carries no title,
                slug or tags to name it with (see utils/klipy.ts), so the
                position is the only honest name available -- which still
                beats nameless. */}
            <Pressable
                onPress={onPick}
                accessibilityRole="button"
                accessibilityLabel={t("gifPicker.gifResult", {
                    value: idx + 1,
                })}
                accessibilityState={{ selected }}
                className={`w-full rounded overflow-hidden active:opacity-80 transition-opacity${
                    selected ? " border-2 border-discord-accent" : ""
                }`}
            >
                {/* Zami: the animated preview through expo-image, rather than
                    one muted looping player per tile for `previewVideoUrl`.
                    Without dimensions the tile is square. */}
                <Image
                    source={mediaSource(r.previewUrl)}
                    accessible={false}
                    className="w-full rounded bg-discord-backgroundTertiary"
                    style={{
                        aspectRatio:
                            cssAspectRatio(
                                gifAspectRatioStyle(r.width, r.height),
                            ) ?? 1,
                    }}
                />
            </Pressable>
            <Pressable
                onPress={onToggleStar}
                accessibilityRole="button"
                accessibilityLabel={t("gifPicker.favourite")}
                accessibilityState={{ selected: favourited }}
                className={`absolute top-1 end-1 transition-opacity ${favBtnClass} ${
                    favourited || selected
                        ? "opacity-100"
                        : "opacity-0 group-hover/gif:opacity-100 group-focus-within/gif:opacity-100"
                }`}
            >
                <SvgIcon
                    d={STAR}
                    className={`w-3.5 h-3.5 ${
                        favourited ? "text-discord-warning" : "text-white"
                    }`}
                />
            </Pressable>
        </View>
    );
}

// KLIPY's width/height are typed as numbers but arrive as third-party JSON,
// so they are untrusted style input exactly like a remote event's info.w/h.
// No dimensions → no style at all (the grid falls back to natural size).
function gifAspectRatioStyle(w: unknown, h: unknown): string | undefined {
    const ratio = safeAspectRatio(w, h, "");
    return ratio ? `aspect-ratio: ${ratio}` : undefined;
}
