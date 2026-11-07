import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useResolveClassNames } from "uniwind";
import { t, type MessageKey } from "$lib/i18n";
import Portal from "$lib/components/ui/Portal.svelte";
import BottomSheet from "$lib/components/ui/BottomSheet.svelte";
import {
    roomHeaderMenuRows,
    type RoomHeaderMenuKey,
    type PluginHeaderMenuRow,
} from "$lib/utils/roomHeaderMenu";

interface Props {
    /** `interfaceState.sidebar` — which panel is currently open. */
    activeSidebar: string | null;
    threadMentions: number;
    threadAnyUnread: boolean;
    pinnedCount: number;
    pluginRows?: PluginHeaderMenuRow[];
    onChoose: (key: RoomHeaderMenuKey) => void;
    onChoosePlugin?: (key: string) => void;
    onClose: () => void;
}

// The same glyphs the desktop header buttons use, so the two layouts read
// as the same controls. Icon *sourcing* is chore/icon-normalization's job.
const ICONS: Record<RoomHeaderMenuKey, string> = {
    threads:
        "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2zm2 5h12V7H6v2zm0 4h9v-2H6v2z",
    pinned: "M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z",
    notifications:
        "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
    // Mirrors lucide's `Image` (the desktop media button) as a solid glyph,
    // so this sheet stays one visual family rather than mixing artwork.
    media: "M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z",
    // Mirrors lucide's `Users` (the desktop member-list button) as a solid
    // glyph. Two people, not one-person-plus: this row *opens* the member
    // list, it does not invite anyone.
    members:
        "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
};

// What each row's badge is counting, for screen readers. The visible pill
// is a bare number, which on its own announces as "Threads, 3".
const BADGE_NOUNS: Record<RoomHeaderMenuKey, MessageKey> = {
    threads: "roomHeaderOverflowMenu.badgeThreads",
    pinned: "roomHeaderOverflowMenu.badgePinned",
    notifications: "roomHeaderOverflowMenu.badgeNotifications",
    media: "roomHeaderOverflowMenu.badgeMedia",
    members: "roomHeaderOverflowMenu.badgeMembers",
};

// `badge` is pill *text*, not a count: the model caps it at "99+", so the
// only value that is ever singular is the literal "1". Comparing the string
// keeps "99+" out of Number() (which would yield NaN) without needing to
// parse anything.
function badgeAnnouncement(key: RoomHeaderMenuKey, badge: string): string {
    // The plural form is picked from the count; `badge` is shown as-is so
    // the "99+" cap survives into the announcement.
    return t(BADGE_NOUNS[key], {
        count: badge === "1" ? 1 : 2,
        badge,
    });
}

// The threads pill keeps `bg-discord-danger` because it counts unread
// *mentions* — the same thing the desktop threads badge paints red. Every
// other row's badge is a neutral total (pinned messages are not urgent), so
// it gets a plain chip: `divider` reads as a raised surface against the
// sheet's `backgroundTertiary` in both themes, and `textPrimary` on it
// clears WCAG AA in both without depending on how bright `textMuted` is.
// Zami: split into the pill's background and its text color, which here go
// on the pill's View and its Text.
const BADGE_CLASSES: Record<RoomHeaderMenuKey, [string, string]> = {
    threads: ["bg-discord-danger", "text-white"],
    pinned: ["bg-discord-divider", "text-discord-textPrimary"],
    notifications: ["bg-discord-divider", "text-discord-textPrimary"],
    media: ["bg-discord-divider", "text-discord-textPrimary"],
    members: ["bg-discord-divider", "text-discord-textPrimary"],
};

export default function RoomHeaderOverflowMenu({
    activeSidebar,
    threadMentions,
    threadAnyUnread,
    pinnedCount,
    pluginRows = [],
    onChoose,
    onChoosePlugin,
    onClose,
}: Props) {
    const rows = roomHeaderMenuRows({
        activeSidebar,
        threadMentions,
        threadAnyUnread,
        pinnedCount,
    });

    function choose(key: RoomHeaderMenuKey) {
        // Close this sheet FIRST, mirroring ComposerActionsMenu. Today every
        // key opens a *sidebar*, which `closeModal` never touches, so the
        // order is not load-bearing — it is kept as a defensive invariant for
        // any future row that opens something in the single modal slot, which
        // closing afterwards would immediately tear back down.
        onClose();
        onChoose(key);
    }

    function choosePlugin(key: string) {
        onClose();
        onChoosePlugin?.(key);
    }

    return (
        <Portal>
            <BottomSheet onClose={onClose}>
                <View
                    accessibilityRole="menu"
                    accessibilityLabel={t(
                        "roomHeaderOverflowMenu.moreRoomOptions",
                    )}
                    className="pb-1"
                >
                    {rows.map((row) => (
                        // menuitemcheckbox, not menuitem: each row toggles a panel, and
                        // `aria-checked` is what carries "this one is open" to anything
                        // that cannot see the accent colour (WCAG 1.4.1).
                        // Zami: React Native has no menuitemcheckbox role; a menu item
                        // with a checked state carries the same.
                        <Pressable
                            key={row.key}
                            accessibilityRole="menuitem"
                            accessibilityState={{ checked: row.active }}
                            // The pill and the dot are both hidden from assistive tech
                            // and re-announced by an adjacent sr-only span: `aria-label`
                            // is not valid on a generic-role span (it only ever worked
                            // here by accident), and an unlabelled "3" says nothing
                            // about what was counted.
                            // Zami: there's no sr-only text; the row's label carries
                            // what the span says.
                            accessibilityLabel={
                                row.badge
                                    ? `${row.label}, ${badgeAnnouncement(row.key, row.badge)}`
                                    : row.dot
                                      ? `${row.label}, ${t("roomHeaderOverflowMenu.unread")}`
                                      : row.label
                            }
                            onPress={() => choose(row.key)}
                            className="w-full flex-row items-center gap-3 px-4 py-3 transition-colors active:bg-discord-messageHover hover:bg-discord-messageHover"
                        >
                            <SvgIcon
                                d={ICONS[row.key]}
                                className={`w-5 h-5 flex-shrink-0 ${
                                    row.active
                                        ? "text-discord-accent"
                                        : "text-discord-textMuted"
                                }`}
                            />
                            <Text
                                numberOfLines={1}
                                className={`flex-1 text-sm ${
                                    row.active
                                        ? "text-discord-accent"
                                        : "text-discord-textPrimary"
                                }`}
                            >
                                {row.label}
                            </Text>
                            {row.badge ? (
                                <View
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                    className={`flex-shrink-0 ${
                                        BADGE_CLASSES[row.key][0]
                                    } rounded-full min-w-[16px] h-4 px-1 flex-row items-center justify-center`}
                                >
                                    <Text
                                        className={`${
                                            BADGE_CLASSES[row.key][1]
                                        } text-[10px] leading-none font-bold`}
                                    >
                                        {row.badge}
                                    </Text>
                                </View>
                            ) : row.dot ? (
                                <View
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                    className="flex-shrink-0 w-2 h-2 rounded-full bg-discord-accent"
                                />
                            ) : null}
                        </Pressable>
                    ))}
                    {pluginRows.map((row) => (
                        <Pressable
                            key={row.key}
                            accessibilityRole="menuitem"
                            accessibilityState={{ checked: row.active }}
                            onPress={() => choosePlugin(row.key)}
                            className="w-full flex-row items-center gap-3 px-4 py-3 transition-colors active:bg-discord-messageHover hover:bg-discord-messageHover"
                        >
                            <SvgIcon
                                d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 4v10h16V8H4z"
                                className={`w-5 h-5 flex-shrink-0 ${
                                    row.active
                                        ? "text-discord-accent"
                                        : "text-discord-textMuted"
                                }`}
                            />
                            <Text
                                numberOfLines={1}
                                className={`flex-1 text-sm ${
                                    row.active
                                        ? "text-discord-accent"
                                        : "text-discord-textPrimary"
                                }`}
                            >
                                {row.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </BottomSheet>
        </Portal>
    );
}

/** Zami: Zam's inline `<svg fill="currentColor"><path d=…/></svg>`. `className`
 *  sizes and places it, and its text color fills it, as `currentColor` would. */
function SvgIcon({ d, className }: { d: string; className: string }) {
    const { color, ...style } = useResolveClassNames(className);
    return (
        <Svg viewBox="0 0 24 24" fill={color} style={style}>
            <Path d={d} />
        </Svg>
    );
}
