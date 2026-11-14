import { Text } from "react-native";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { presenceFor } from "$lib/stores/presence.svelte";

interface Props {
    ids: string[];
    onRender: (id: string) => void;
    // Read through one getter over every id, as RoomList's DM presence
    // map does, instead of per row.
    viaDerived?: boolean;
}

function PresenceRow({
    id,
    onRender,
}: {
    id: string;
    onRender: (id: string) => void;
}) {
    const state = useRune(() => {
        onRender(id);
        return presenceFor(id)?.state ?? "offline";
    }, [id, onRender]);
    return <Text testID={id}>{state}</Text>;
}

function DerivedRows({ ids, onRender }: Omit<Props, "viaDerived">) {
    const states = useRune(() => {
        const map = new Map<string, string>();
        for (const id of ids) {
            onRender(id);
            map.set(id, presenceFor(id)?.state ?? "offline");
        }
        return map;
    }, [ids, onRender]);
    return (
        <>
            {ids.map((id) => (
                <Text key={id} testID={id}>
                    {states.get(id)}
                </Text>
            ))}
        </>
    );
}

export default function PresenceProbe({
    ids,
    onRender,
    viaDerived = false,
}: Props) {
    if (viaDerived) return <DerivedRows ids={ids} onRender={onRender} />;
    return (
        <>
            {ids.map((id) => (
                <PresenceRow key={id} id={id} onRender={onRender} />
            ))}
        </>
    );
}
