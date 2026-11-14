import {
    createRowCache,
    createSortedIndex,
    type SortedEntry,
} from "@-/com.leonsilicon.zami.lists";
import { shallowEqual, useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    FlatList,
    Pressable,
    Text,
    View,
    type GestureResponderEvent,
    type ListRenderItemInfo,
} from "react-native";
import { t } from "$lib/i18n";
import {
    EventType,
    RoomEvent,
    RoomStateEvent,
    type MatrixEvent,
    type Room,
    type RoomMember,
} from "matrix-js-sdk";
import Avatar from "$lib/components/ui/Avatar.svelte";
import {
    getRoomMembers,
    getUserPowerLevel,
    hasImmutableCreatorPower,
    loadRoomMembersIfNeeded,
    mxcToHttp,
    memberDisplayName,
} from "$lib/matrix/client";
import { interfaceState } from "$lib/stores/interface.svelte";
import { openProfileCard } from "$lib/stores/profileCard.svelte";
import { presenceFor } from "$lib/stores/presence.svelte";
import {
    presenceDot,
    presenceDotClass,
    presenceLabel,
} from "$lib/utils/presence";
import { pluginRegistry } from "$lib/stores/plugins.svelte";
import { collectMemberDecorations } from "$lib/plugins/pluginMembers";

interface Props {
    room: Room;
}

// Row geometry for the windowed list (px).
const HEADER_H = 24;
const MEMBER_H = 40;
const GROUP_GAP = 8;
const PAD_Y = 8;
// Zami: upstream's OVERSCAN (rows rendered beyond the viewport) is the
// FlatList's `windowSize` below.

// Zami: upstream's absolutely positioned rows are a FlatList's, and their
// `top`/`height` its getItemLayout.
type Row =
    | {
          kind: "header";
          key: string;
          label: string;
          top: number;
          height: number;
      }
    | {
          kind: "member";
          key: string;
          member: RoomMember;
          /** Zami: the member's state event: a new one re-renders the row
           *  (a rename or a new avatar mutates the same RoomMember). */
          rev: MatrixEvent | undefined;
          roleLabel: string | null;
          muted: boolean;
          top: number;
          height: number;
      };

type Group = "creators" | "admins" | "moderators" | "regular";

// One pass and a shared collator: a big room's three filters (each looking
// up every member's power level) plus three localeCompare sorts were tens
// of ms per run.
// Zami: on Hermes each comparison is a native call, so the members are kept
// sorted by name in an index: a member event moves one entry (a binary
// search), and only a full reload sorts, in slices (@-/com.leonsilicon.zami.lists).
const collator = new Intl.Collator();

/** Member changes in one turn past which re-sorting everything is cheaper. */
const FULL_RELOAD_AT = 256;
/** Members few enough to sort in one go (a few thousand comparisons). */
const SORT_NOW_MAX = 300;

function memberEntry(member: RoomMember): SortedEntry<RoomMember> {
    return { id: member.userId, sortKey: member.name, value: member };
}

export default function MemberList({ room }: Props) {
    const isMobile = useRune(() => interfaceState.isMobile);
    const [memberTick, setMemberTick] = useState(0);

    const scroller = useRef<FlatList<Row>>(null);

    // MessageArea keeps this component mounted across room switches and only
    // swaps `room`, so the load, the subscription and the scroll position all
    // follow it rather than running once on mount.
    useEffect(() => {
        const r = room;
        let live = true;
        loadRoomMembersIfNeeded(r)
            .then(() => {
                if (live) setMemberTick((n) => n + 1);
            })
            .catch(() => {});
        scroller.current?.scrollToOffset({ offset: 0, animated: false });
        return () => {
            live = false;
        };
    }, [room]);

    // Zami: upstream regroups everything when onRoomMembersChanged fires
    // (kicks/bans/joins from other sessions included); here this room's own
    // state events move just the members they name, below.
    // The joined members by name; a small room's are sorted before the first
    // render, as upstream's `$derived` is.
    const [index] = useState(() => {
        const index = createSortedIndex<RoomMember>({
            compare: collator.compare,
        });
        const members = getRoomMembers(room);
        if (members.length <= SORT_NOW_MAX)
            index.replaceNow(members.map(memberEntry));
        return index;
    });
    // Each member's group, until a power level or the member changes.
    const [groupOf] = useState(() => new Map<string, Group>());
    const [version, setVersion] = useState(0);
    const loadedFor = useRef<{ room: Room; memberTick: number } | null>(
        index.version > 0 ? { room, memberTick } : null,
    );
    useEffect(() => {
        let alive = true;
        const changed = new Set<string>();
        let reloadAll = false;
        let flushTimer: ReturnType<typeof setTimeout> | undefined;
        const publish = () => {
            if (alive) setVersion((v) => v + 1);
        };
        const flush = () => {
            flushTimer = undefined;
            if (reloadAll || changed.size > FULL_RELOAD_AT) {
                reloadAll = false;
                changed.clear();
                groupOf.clear();
                const entries = getRoomMembers(room).map(memberEntry);
                if (entries.length <= SORT_NOW_MAX) index.replaceNow(entries);
                else
                    void index.replace(entries).then((applied) => {
                        if (applied) publish();
                    });
                publish();
                return;
            }
            for (const userId of changed) {
                groupOf.delete(userId);
                const member = room.getMember(userId);
                if (member?.membership === "join")
                    index.set(userId, member.name, member);
                else index.delete(userId);
            }
            changed.clear();
            publish();
        };
        // Coalesced: a sync's state (or a member list load) is many events.
        const schedule = () => {
            flushTimer ??= setTimeout(flush, 0);
        };
        const onMembers = (_e: MatrixEvent, _s: unknown, m: RoomMember) => {
            changed.add(m.userId);
            schedule();
        };
        const onEvents = (event: MatrixEvent) => {
            const type = event.getType();
            if (
                type === EventType.RoomPowerLevels ||
                type === EventType.RoomCreate
            ) {
                // Anyone may change group; nobody's name order changes.
                groupOf.clear();
                schedule();
            }
        };
        const onStateReplaced = () => {
            reloadAll = true;
            schedule();
        };
        room.on(RoomStateEvent.Members, onMembers);
        room.on(RoomStateEvent.Events, onEvents);
        room.on(RoomEvent.CurrentStateUpdated, onStateReplaced);
        // A new room, or a fresh member list (memberTick): load them all.
        const loaded = loadedFor.current;
        if (loaded?.room !== room || loaded.memberTick !== memberTick) {
            loadedFor.current = { room, memberTick };
            reloadAll = true;
            flush();
        }
        return () => {
            alive = false;
            clearTimeout(flushTimer);
            room.off(RoomStateEvent.Members, onMembers);
            room.off(RoomStateEvent.Events, onEvents);
            room.off(RoomEvent.CurrentStateUpdated, onStateReplaced);
        };
    }, [room, memberTick, index, groupOf]);

    // Zami: the groups, as FlatList rows, rebuilt only when a member or a
    // power level changed (`version`); unchanged rows keep their objects.
    const [rowCache] = useState(() => createRowCache<Row>());
    const groups = useMemo(() => {
        void version;
        const creators: RoomMember[] = [];
        const admins: RoomMember[] = [];
        const moderators: RoomMember[] = [];
        const regular: RoomMember[] = [];
        const lists = { creators, admins, moderators, regular };
        for (const { id, value: m } of index.entries) {
            let group = groupOf.get(id);
            if (group === undefined) {
                // Immutable creators sit above admins even though their written
                // level is lifted to 100 for gate purposes.
                if (hasImmutableCreatorPower(room, m.userId))
                    group = "creators";
                else {
                    const l = getUserPowerLevel(room, m.userId);
                    group =
                        l >= 100
                            ? "admins"
                            : l >= 50
                              ? "moderators"
                              : "regular";
                }
                groupOf.set(id, group);
            }
            lists[group].push(m);
        }
        // Flat, sorted row list: header then members for each non-empty group.
        const sections: {
            key: string;
            label: string;
            members: RoomMember[];
            roleLabel: string | null;
            muted: boolean;
        }[] = [];
        if (creators.length > 0)
            sections.push({
                key: "creators",
                label: t("memberList.creators", { length: creators.length }),
                members: creators,
                roleLabel: t("roomSettings.creatorLabel"),
                muted: false,
            });
        if (admins.length > 0)
            sections.push({
                key: "admins",
                label: t("memberList.admins", { length: admins.length }),
                members: admins,
                roleLabel: t("memberList.admin"),
                muted: false,
            });
        if (moderators.length > 0)
            sections.push({
                key: "moderators",
                label: t("memberList.moderators", {
                    length: moderators.length,
                }),
                members: moderators,
                roleLabel: null,
                muted: false,
            });
        if (regular.length > 0)
            sections.push({
                key: "regular",
                label: t("memberList.members", { length: regular.length }),
                members: regular,
                roleLabel: null,
                muted: true,
            });

        const rows = rowCache.build((row) => {
            const out: Row[] = [];
            let top = PAD_Y;
            sections.forEach((s, i) => {
                if (i > 0) top += GROUP_GAP;
                out.push(
                    row({
                        kind: "header",
                        key: `h:${s.key}`,
                        label: s.label,
                        top,
                        height: HEADER_H,
                    }),
                );
                top += HEADER_H;
                for (const m of s.members) {
                    out.push(
                        row({
                            kind: "member",
                            key: `m:${m.userId}`,
                            member: m,
                            rev: m.events.member,
                            roleLabel: s.roleLabel,
                            muted: s.muted,
                            top,
                            height: MEMBER_H,
                        }),
                    );
                    top += MEMBER_H;
                }
            });
            return out;
        });
        // While a large room's members sort, the heading already counts them.
        const count =
            index.replacing || loadedFor.current === null
                ? getRoomMembers(room).length
                : index.entries.length;
        return { rows, count };
    }, [version, room, index, groupOf, rowCache]);

    const renderItem = useCallback(
        ({ item: row, index }: ListRenderItemInfo<Row>) => {
            if (row.kind === "header") {
                // Zami: the gap above a group is part of its header's cell.
                return (
                    <View
                        style={{
                            height: row.height,
                            marginTop: index > 0 ? GROUP_GAP : 0,
                        }}
                        className="px-4 flex-row items-center"
                    >
                        <Text
                            accessibilityRole="header"
                            numberOfLines={1}
                            className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
                        >
                            {row.label}
                        </Text>
                    </View>
                );
            }
            return (
                <MemberRow
                    member={row.member}
                    rev={row.rev}
                    roleLabel={row.roleLabel}
                    muted={row.muted}
                />
            );
        },
        [],
    );

    // Zami: not ported: `data-zam-region="member-list"` (plugins' DOM region
    // hook; there's no DOM here).
    return (
        <View
            className={`${
                isMobile ? "" : "w-72"
            } h-full bg-discord-backgroundSecondary flex flex-col flex-shrink-0 overflow-hidden border-l border-discord-divider`}
        >
            <View className="h-12 px-4 flex-row items-center border-b border-discord-divider flex-shrink-0">
                <Text
                    accessibilityRole="header"
                    className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
                >
                    {t("memberList.members", { length: groups.count })}
                </Text>
            </View>

            <FlatList
                ref={scroller}
                className="flex-1"
                contentContainerClassName="py-2"
                data={groups.rows}
                keyExtractor={rowKey}
                renderItem={renderItem}
                getItemLayout={rowLayout}
                // Zami: a screen or two either side, not FlatList's ten:
                // each member row watches its own presence.
                windowSize={5}
            />
        </View>
    );
}

function rowKey(row: Row): string {
    return row.key;
}

// Zami: a cell runs from the previous row's end (the gap above a header
// included) to its row's; `top` already counts the list's PAD_Y (`py-2`).
function rowLayout(data: ArrayLike<Row> | null | undefined, index: number) {
    const row = data![index];
    const prev = index > 0 ? data![index - 1] : undefined;
    const offset = prev ? prev.top + prev.height : row.top;
    return { length: row.top + row.height - offset, offset, index };
}

function getAvatarSrc(member: RoomMember): string | null {
    const mxc = member.getMxcAvatarUrl();
    return mxcToHttp(mxc);
}

// Presence dot class + tooltip for one member. Called from the row
// template, so only rendered (visible) rows ask presenceFor, which keeps
// each dot recoloring when that user's m.presence arrives. An unknown
// presence (e.g. the server has it disabled) renders as offline.
// Zami: FlatList renders a window of rows; each reads its own through useRune.
function presenceOf(userId: string): { dotClass: string; label: string } {
    const p = presenceFor(userId);
    const state = p?.state ?? "offline";
    return {
        dotClass: presenceDotClass(presenceDot(state)),
        label: p?.statusMsg
            ? `${presenceLabel(state)} - ${p.statusMsg}`
            : presenceLabel(state),
    };
}

// Plugin badges / second lines (zam.members.decorate), computed lazily for
// visible rows only.
// Zami: each mounted row reads its own through useRune, which re-runs it on a
// registry tick or a change to the member; upstream's cache across scrolling
// isn't kept. `member.roomId` is the list's room.
type Decoration = ReturnType<typeof collectMemberDecorations>;
function decorationsOf(member: RoomMember): Decoration {
    void pluginRegistry.tick;
    const decorators = pluginRegistry.memberDecorators.map((e) => e.value);
    if (decorators.length === 0) return null;
    return collectMemberDecorations(decorators, {
        roomId: member.roomId,
        userId: member.userId,
    });
}

// Zami: openProfileCard() anchors the card to the element's
// getBoundingClientRect(); the pressed row's window rect stands in.
function openCard(userId: string, e: GestureResponderEvent) {
    const target = e.currentTarget;
    const { pageX, pageY } = e.nativeEvent;
    const open = (left: number, top: number, width = 0, height = 0) => {
        const rect = {
            top,
            left,
            right: left + width,
            bottom: top + height,
        };
        openProfileCard(userId, {
            getBoundingClientRect: () => rect,
        } as unknown as HTMLElement);
    };
    if (typeof target === "number") open(pageX, pageY);
    else target.measureInWindow(open);
}

const MemberRow = memo(function MemberRow({
    member,
    rev,
    roleLabel,
    muted,
}: {
    member: RoomMember;
    /** The member's state event: the row re-renders when it changes. */
    rev: MatrixEvent | undefined;
    roleLabel: string | null;
    muted: boolean;
}) {
    const presence = useRune(() => presenceOf(member.userId), [member], {
        isEqual: shallowEqual,
    });
    // Follows the Show Matrix IDs setting too.
    const name = useRune(() => memberDisplayName(member), [member, rev]);
    const deco = useRune(() => decorationsOf(member), [member, rev]);
    const secondLine = [roleLabel, deco?.subtitle].filter(Boolean).join(" · ");
    // Zami: `w-[calc(100%-1rem)]` is the stretched row's
    // width less its `mx-2`, which a column gives it. The row's `title`
    // (the decorations' tooltip) has no React Native equivalent.
    return (
        <Pressable
            accessibilityRole="button"
            onPress={(e) => openCard(member.userId, e)}
            style={{ height: MEMBER_H }}
            className="flex-row items-center gap-2 px-2 mx-2 rounded overflow-hidden hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors"
        >
            <View className="relative flex-shrink-0">
                <Avatar
                    src={getAvatarSrc(member)}
                    name={member.name}
                    id={member.userId}
                    size={32}
                />
                {/* Zami: the dot's `title` is its
                    accessibility label, which the row reads
                    out with the rest of its content. */}
                <View
                    accessibilityLabel={presence.label}
                    className={`absolute bottom-0 end-0 w-2.5 h-2.5 ${
                        presence.dotClass
                    } rounded-full border-2 border-discord-backgroundSecondary`}
                />
            </View>
            <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-1 min-w-0">
                    <Text
                        numberOfLines={1}
                        className={`flex-shrink text-sm leading-5 font-medium ${
                            muted
                                ? "text-discord-textMuted"
                                : "text-discord-textPrimary"
                        } transition-colors`}
                    >
                        {name}
                    </Text>
                    {(deco?.badges ?? []).map((badge, i) => (
                        <View
                            key={i}
                            className="flex-shrink-0 px-1 rounded bg-discord-backgroundTertiary"
                        >
                            <Text className="text-[10px] font-semibold uppercase text-discord-textMuted">
                                {badge}
                            </Text>
                        </View>
                    ))}
                </View>
                {secondLine ? (
                    <Text
                        numberOfLines={1}
                        className="text-xs leading-4 text-discord-textMuted"
                    >
                        {secondLine}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );
});
