import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { View } from "react-native";
import CallView from "$lib/components/layout/CallView.svelte";
import { getRoom } from "$lib/matrix/client";
import { roomsState, setActiveRoom } from "$lib/stores/rooms.svelte";
import {
    callPopoutState,
    closeCallPopout,
} from "$lib/stores/callPopout.svelte";
import { showCallView } from "$lib/stores/interface.svelte";

// Zami: the Expo app has no second window (callPopoutSupported() is false),
// so nothing mounts this view; it is kept so CallView's `popout` branch maps.
export default function CallPopoutView() {
    // Mounted into the pop-out window's document, so it renders the same call
    // as the main window and its controls drive the one call.
    const room = useRune(() => {
        void roomsState.roomsTick;
        const id = callPopoutState.roomId;
        return id ? getRoom(id) : null;
    });

    /** Show the call in the main window again, then close the pop-out. */
    function onReturn(): void {
        const id = callPopoutState.roomId;
        if (!id) return;
        setActiveRoom(id);
        showCallView(id);
        // Zami: no window.focus(): the app is its one window.
        closeCallPopout();
    }

    return room ? (
        <View className="flex-1 flex-col bg-zam-backgroundTertiary">
            <CallView room={room} popout={{ onReturn }} />
        </View>
    ) : null;
}
