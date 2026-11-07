import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useMemo, useState } from "react";
import {
    FlatList,
    Pressable,
    Text,
    View,
    type GestureResponderEvent,
} from "react-native";
import { t } from "$lib/i18n";
import type { Room, RoomMember } from "matrix-js-sdk";
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
import { roomsState } from "$lib/stores/rooms.svelte";
import { openProfileCard } from "$lib/stores/profileCard.svelte";
import { presenceState, presenceFor } from "$lib/stores/presence.svelte";
import {
    presenceDot,
    presenceDotClass,
    presenceLabel,
} from "$lib/utils/presence";

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
          /** The muted second line (creators, admins), if any. */
          role: string | null;
          /** Regular members' names are muted. */
          muted: boolean;
          /** The group's `mb-2`, on its last row. */
          last: boolean;
      };

// One pass and a shared collator: this re-runs on every sync response,
// and in a big room three filters (each looking up every member's power
// level) plus three localeCompare sorts were tens of ms per run.
const collator = new Intl.Collator();

export default function MemberList({ room }: Props) {
    const isMobile = useRune(() => interfaceState.isMobile);
    const [memberTick, setMemberTick] = useState(0);

    useEffect(() => {
        loadRoomMembersIfNeeded(room)
            .then(() => setMemberTick((n) => n + 1))
            .catch(() => {});
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- upstream's onMount.
    }, []);

    // Re-derive on sync updates too, or kicks/bans/joins from other
    // sessions never leave the list (same fix the room-settings members
    // tab got; live SDK Room objects mutate in place).
    const roomsTick = useRune(() => roomsState.roomsTick);
    const members = useMemo(() => {
        void memberTick;
        void roomsTick;
        return getRoomMembers(room);
    }, [memberTick, roomsTick, room]);

    const groups = useMemo(() => {
        const creators: RoomMember[] = [];
        const admins: RoomMember[] = [];
        const moderators: RoomMember[] = [];
        const regular: RoomMember[] = [];
        for (const m of members) {
            // Immutable creators sit above admins even though their written
            // level is lifted to 100 for gate purposes.
            if (hasImmutableCreatorPower(room, m.userId)) {
                creators.push(m);
                continue;
            }
            const l = getUserPowerLevel(room, m.userId);
            (l >= 100 ? admins : l >= 50 ? moderators : regular).push(m);
        }
        const byName = (a: RoomMember, b: RoomMember) =>
            collator.compare(a.name, b.name);
        creators.sort(byName);
        admins.sort(byName);
        moderators.sort(byName);
        regular.sort(byName);
        return { creators, admins, moderators, regular };
    }, [members, room]);
    const creators = groups.creators;
    const admins = groups.admins;
    const moderators = groups.moderators;
    const regularMembers = groups.regular;

    function getAvatarSrc(member: RoomMember): string | null {
        const mxc = member.getMxcAvatarUrl();
        return mxcToHttp(mxc);
    }

    // Presence dot class + tooltip per member. Depends on the presence tick
    // so dots recolor when m.presence events arrive over sync; unknown
    // presence (e.g. the server has it disabled) renders as offline.
    const presenceTick = useRune(() => presenceState.presenceTick);
    const memberPresence = useMemo(() => {
        void presenceTick;
        const map = new Map<string, { dotClass: string; label: string }>();
        for (const member of members) {
            const p = presenceFor(member.userId);
            const state = p?.state ?? "offline";
            map.set(member.userId, {
                dotClass: presenceDotClass(presenceDot(state)),
                label: p?.statusMsg
                    ? `${presenceLabel(state)} - ${p.statusMsg}`
                    : presenceLabel(state),
            });
        }
        return map;
    }, [presenceTick, members]);

    const rows = useMemo(() => {
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
            out.push({ kind: "heading", key: `heading:${id}`, label });
            list.forEach((member, i) =>
                out.push({
                    kind: "member",
                    key: member.userId,
                    member,
                    role,
                    muted,
                    last: spaced && i === list.length - 1,
                }),
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
            t("memberList.members", { length: regularMembers.length }),
            regularMembers,
            null,
            true,
            false,
        );
        return out;
    }, [creators, admins, moderators, regularMembers]);

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
                    {t("memberList.members", { length: members.length })}
                </Text>
            </View>

            <FlatList
                className="flex-1"
                contentContainerClassName="py-2"
                data={rows}
                extraData={memberPresence}
                keyExtractor={(row) => row.key}
                renderItem={({ item: row }) => {
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
                    const { member } = row;
                    const presence = memberPresence.get(member.userId);
                    // Zami: `w-[calc(100%-1rem)]` is the stretched row's
                    // width less its `mx-2`, which a column gives it.
                    return (
                        <Pressable
                            accessibilityRole="button"
                            onPress={(e) => openCard(member.userId, e)}
                            className={`flex-row items-center gap-2 px-2 py-1 mx-2 rounded hover:bg-discord-messageHover active:bg-discord-messageHover transition-colors ${
                                row.last ? "mb-2" : ""
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
                                    accessibilityLabel={presence?.label}
                                    className={`absolute bottom-0 end-0 w-2.5 h-2.5 ${
                                        presence?.dotClass ??
                                        "bg-discord-offline"
                                    } rounded-full border-2 border-discord-backgroundSecondary`}
                                />
                            </View>
                            <View className="min-w-0 flex-1">
                                <Text
                                    numberOfLines={1}
                                    className={`text-sm font-medium ${
                                        row.muted
                                            ? "text-discord-textMuted"
                                            : "text-discord-textPrimary"
                                    } transition-colors`}
                                >
                                    {memberDisplayName(member)}
                                </Text>
                                {row.role !== null ? (
                                    <Text
                                        numberOfLines={1}
                                        className="text-xs text-discord-textMuted"
                                    >
                                        {row.role}
                                    </Text>
                                ) : null}
                            </View>
                        </Pressable>
                    );
                }}
            />
        </View>
    );
}
