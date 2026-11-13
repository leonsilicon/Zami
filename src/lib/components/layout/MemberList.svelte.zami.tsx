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
import { presenceState, presenceFor } from "$lib/stores/presence.svelte";
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

// Zami: the four `{#each}` blocks below are one FlatList: each group's
// heading, then its members, as rows.
type Row =
    | { kind: "heading"; key: string; label: string }
    | {
          kind: "member";
          key: string;
          member: RoomMember;
          /** The member's state event: a new one re-renders the row (a
           *  rename or a new avatar mutates the same RoomMember). */
          rev: MatrixEvent | undefined;
          /** The muted second line (creators, admins), if any. */
          role: string | null;
          /** Regular members' names are muted. */
          muted: boolean;
          /** The group's `mb-2`, on its last row. */
          last: boolean;
      };

type Group = "creators" | "admins" | "moderators" | "regular";

// One pass and a shared collator: this re-runs on every sync response,
// and in a big room three filters (each looking up every member's power
// level) plus three localeCompare sorts were tens of ms per run.
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

    useEffect(() => {
        loadRoomMembersIfNeeded(room)
            .then(() => setMemberTick((n) => n + 1))
            .catch(() => {});
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream's onMount.
    }, []);

    // Zami: upstream re-derives the members on every sync (`roomsTick`), or
    // kicks/bans/joins from other sessions never leave the list; here this
    // room's own state events do it, so another room's sync costs nothing.
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
        const rows = rowCache.build((row) => {
            const out: Row[] = [];
            function group(
                id: string,
                label: string,
                list: RoomMember[],
                role: string | null,
                muted: boolean,
                spaced: boolean,
            ) {
                if (list.length === 0) return;
                out.push(row({ kind: "heading", key: `heading:${id}`, label }));
                list.forEach((member, i) =>
                    out.push(
                        row({
                            kind: "member",
                            key: member.userId,
                            member,
                            rev: member.events.member,
                            role,
                            muted,
                            last: spaced && i === list.length - 1,
                        }),
                    ),
                );
            }
            group(
                "creators",
                t("memberList.creators", { length: creators.length }),
                creators,
                t("roomSettings.creatorLabel"),
                false,
                true,
            );
            group(
                "admins",
                t("memberList.admins", { length: admins.length }),
                admins,
                t("memberList.admin"),
                false,
                true,
            );
            group(
                "moderators",
                t("memberList.moderators", { length: moderators.length }),
                moderators,
                null,
                false,
                true,
            );
            group(
                "members",
                t("memberList.members", { length: regular.length }),
                regular,
                null,
                true,
                false,
            );
            return out;
        });
        // While a large room's members sort, the heading already counts them.
        const count =
            index.replacing || loadedFor.current === null
                ? getRoomMembers(room).length
                : index.entries.length;
        return { rows, count };
    }, [version, room, index, groupOf, rowCache]);

    const renderItem = useCallback(({ item: row }: ListRenderItemInfo<Row>) => {
        if (row.kind === "heading") {
            // px-4 matches the member rows' mx-2 + px-2 = 16px inset.
            return (
                <Text
                    accessibilityRole="header"
                    className="px-4 py-1 text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
                >
                    {row.label}
                </Text>
            );
        }
        return (
            <MemberRow
                member={row.member}
                rev={row.rev}
                role={row.role}
                muted={row.muted}
                last={row.last}
            />
        );
    }, []);

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
                className="flex-1"
                contentContainerClassName="py-2"
                data={groups.rows}
                keyExtractor={rowKey}
                renderItem={renderItem}
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

function getAvatarSrc(member: RoomMember): string | null {
    const mxc = member.getMxcAvatarUrl();
    return mxcToHttp(mxc);
}

// Presence dot class + tooltip per member. Depends on the presence tick
// so dots recolor when m.presence events arrive over sync; unknown
// presence (e.g. the server has it disabled) renders as offline.
// Zami: upstream's `memberPresence` map, one member at a time: each mounted
// row reads its own, so a presence change re-renders only that row.
function memberPresenceFor(userId: string): {
    dotClass: string;
    label: string;
} {
    void presenceState.presenceTick;
    const p = presenceFor(userId);
    const state = p?.state ?? "offline";
    return {
        dotClass: presenceDotClass(presenceDot(state)),
        label: p?.statusMsg
            ? `${presenceLabel(state)} - ${p.statusMsg}`
            : presenceLabel(state),
    };
}

// Plugin badges / second lines (zam.members.decorate). Re-run on every
// registry tick (members.refresh() bumps it) and member change.
// Zami: upstream's `memberDecorations` map, one member at a time, as
// memberPresenceFor: each mounted row reads its own. `member.roomId` is the
// list's room.
function memberDecorationsFor(
    member: RoomMember,
): ReturnType<typeof collectMemberDecorations> {
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
    role,
    muted,
    last,
}: {
    member: RoomMember;
    /** The member's state event: the row re-renders when it changes. */
    rev: MatrixEvent | undefined;
    role: string | null;
    muted: boolean;
    last: boolean;
}) {
    const presence = useRune(() => memberPresenceFor(member.userId), [member], {
        isEqual: shallowEqual,
    });
    // Follows the Show Matrix IDs setting too.
    const name = useRune(() => memberDisplayName(member), [member, rev]);
    const deco = useRune(() => memberDecorationsFor(member), [member, rev]);
    // Zami: `w-[calc(100%-1rem)]` is the stretched row's
    // width less its `mx-2`, which a column gives it. The row's `title`
    // (the decorations' tooltip) has no React Native equivalent.
    return (
        <Pressable
            accessibilityRole="button"
            onPress={(e) => openCard(member.userId, e)}
            className={`flex-row items-center gap-2 px-2 py-1 mx-2 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors ${
                last ? "mb-2" : ""
            }`}
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
                        className={`flex-shrink text-sm font-medium ${
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
                {role !== null ? (
                    <Text
                        numberOfLines={1}
                        className="text-xs text-discord-textMuted"
                    >
                        {role}
                    </Text>
                ) : null}
                {deco?.subtitle ? (
                    <Text
                        numberOfLines={1}
                        className="text-xs text-discord-textMuted"
                    >
                        {deco.subtitle}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );
});
