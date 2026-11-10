import { DomMount, Portal } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { View } from "react-native";
import { pluginMount } from "$lib/plugins/pluginMount";
import { pluginRegistry } from "$lib/stores/plugins.svelte";

// Full-window overlays a plugin adds with zam.ui.addOverlay. Each one is a
// fixed layer over the app. Click-through unless the plugin asks to be
// interactive, so a non-interactive overlay never blocks Zam underneath.
// Zami: the `fixed inset-0` layers are rendered at the app root through the
// Portal, and the plugin builds DOM into each one (pluginMount), which DomView
// shows.
export default function PluginOverlayHost() {
    // Zami: the registry's arrays mutate in place; `tick` bumps on each change.
    useRune(() => pluginRegistry.tick);
    const overlays = pluginRegistry.overlays;
    if (overlays.length === 0) return null;
    return (
        <Portal>
            {overlays.map((entry) => (
                <View
                    key={entry.entryId}
                    className="absolute inset-0 z-[60]"
                    // Zami: not ported: React Native's `pointerEvents="none"`
                    // covers the whole subtree, so a child the plugin sets to
                    // `pointer-events: auto` doesn't take touches either.
                    pointerEvents={entry.value.interactive ? "auto" : "none"}
                >
                    <DomMount
                        className="flex-1"
                        document={document}
                        mount={(el) => {
                            el.setAttribute("data-zam-plugin", entry.pluginId);
                            el.setAttribute("data-zam-overlay", "");
                            return pluginMount(el, (el) =>
                                entry.value.render(el),
                            ).destroy;
                        }}
                    />
                </View>
            ))}
        </Portal>
    );
}
