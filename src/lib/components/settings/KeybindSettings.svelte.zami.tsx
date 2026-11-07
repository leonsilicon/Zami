import { addCaptureKeyListener } from "@-/com.leonsilicon.zami.browser";
import { SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
// Settings > Keybinds: every keyboard shortcut, Discord's defaults, and
// a recorder to change them. Push to talk / push to mute also take a bare
// modifier or a mouse side button.
import {
    KEYBIND_CATEGORIES,
    KEYBIND_DEFS,
    bindingAllowed,
    eventToBinding,
    isModifierKey,
    eventKey,
    isKeybindAction,
    type Binding,
    type KeybindAction,
} from "$lib/keybinds/keybinds";
import { keybindCategoryLabel, keybindLabel } from "$lib/keybinds/labels";
import {
    bindingFor,
    isDefaultBinding,
    keybindsState,
    resetAllKeybinds,
    resetKeybind,
    setGlobalVoiceKeybinds,
    setKeybind,
} from "$lib/stores/keybinds.svelte";
import {
    globalHotkeysState,
    configureGlobalShortcuts,
    requestGlobalHotkeyPermission,
} from "$lib/keybinds/desktopHotkeys.svelte";
import { GLOBAL_ACTIONS } from "$lib/keybinds/globalHotkeys";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import { refreshMicGate } from "$lib/stores/voiceCall.svelte";
import { setPushToTalk } from "$lib/stores/settings.svelte";
import KeyCaps from "$lib/components/keybinds/KeyCaps.svelte";

const smallButtonClass =
    "px-3 py-1.5 rounded bg-discord-backgroundTertiary hover:bg-discord-messageHover";
const smallButtonTextClass = "text-sm font-medium text-discord-textPrimary";

// Zami: `data-setting-anchor` (settings search scrolls to it) is not ported.
export default function KeybindSettings() {
    const [recordingId, setRecordingId] = useState<KeybindAction | null>(null);
    /** A modifier pressed on its own while recording a hold action. */
    const pendingModifier = useRef<string | null>(null);
    const [notice, setNotice] = useState("");

    const globalVoice = useRune(() => keybindsState.globalVoice);
    const globalStatus = useRune(() => globalHotkeysState.status);

    const groups = useRune(() => {
        void keybindsState.overrides;
        return KEYBIND_CATEGORIES.map((c) => ({
            category: c,
            rows: KEYBIND_DEFS.filter((d) => d.category === c).map((d) => ({
                def: d,
                binding: bindingFor(d.id),
                isDefault: isDefaultBinding(d.id),
            })),
        }));
    });

    /** A voice action on a mouse button, which the Wayland portal can't
     *  bind. */
    const hasMouseVoiceBinding = useRune(() => {
        void keybindsState.overrides;
        return GLOBAL_ACTIONS.some((id) =>
            bindingFor(id)?.key.startsWith("mouse"),
        );
    });

    function hint(id: KeybindAction): string | null {
        if (id === "pushToTalk") return t("keybinds.pushToTalkHint");
        if (id === "pushToMute") return t("keybinds.pushToMuteHint");
        return null;
    }

    function isHold(id: KeybindAction): boolean {
        return !!KEYBIND_DEFS.find((d) => d.id === id)?.hold;
    }

    function startRecording(id: KeybindAction) {
        stopRecording();
        setRecordingId(id);
        pendingModifier.current = null;
        setNotice("");
        keybindsState.recording = true;
        // Capture phase, so nothing else in the app sees the keys.
        // Zami: the listeners are the effect below, which follows
        // `recordingId`.
    }

    function stopRecording() {
        setRecordingId(null);
        pendingModifier.current = null;
        keybindsState.recording = false;
    }

    // Zami: startRecording's and stopRecording's `window` listeners
    // (`addEventListener(type, listener, true)`), while a binding is being
    // recorded. Not ported: `onRecordMouse` (a mouse side button for push to
    // talk); React Native reports no mouse buttons.
    useEffect(() => {
        if (!recordingId) return;
        const removeDown = addCaptureKeyListener("keydown", onRecordKeydown);
        const removeUp = addCaptureKeyListener("keyup", onRecordKeyup);
        return () => {
            removeDown();
            removeUp();
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- the handlers read only `recordingId`, refs and stores.
    }, [recordingId]);

    // onDestroy.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `stopRecording` touches only state setters and the store.
    useEffect(() => stopRecording, []);

    function commit(id: KeybindAction, b: Binding | null) {
        const cleared = setKeybind(id, b);
        if (id === "pushToTalk") {
            // Binding a key switches push to talk on, as the hint says.
            if (b) setPushToTalk(true);
            refreshMicGate();
        }
        setNotice(
            cleared.length
                ? t("keybinds.removedFrom", {
                      actions: cleared.map(keybindLabel).join(", "),
                  })
                : "",
        );
        stopRecording();
    }

    function onRecordKeydown(e: KeyboardEvent) {
        const id = recordingId;
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        const key = eventKey(e);
        // Escape on its own cancels; with a modifier it's a binding.
        if (
            key === "escape" &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.metaKey &&
            !e.shiftKey
        ) {
            stopRecording();
            return;
        }
        if (isModifierKey(key)) {
            pendingModifier.current = key;
            return;
        }
        pendingModifier.current = null;
        const b = eventToBinding(e);
        if (bindingAllowed(b, isHold(id))) commit(id, b);
    }

    function onRecordKeyup(e: KeyboardEvent) {
        const id = recordingId;
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        // A modifier pressed and released on its own: hold actions take it.
        const key = eventKey(e);
        if (
            pendingModifier.current &&
            key === pendingModifier.current &&
            isHold(id)
        ) {
            commit(id, {
                ctrl: false,
                shift: false,
                alt: false,
                meta: false,
                key,
            });
        }
        pendingModifier.current = null;
    }

    function clear(id: KeybindAction) {
        commit(id, null);
    }

    function reset(id: KeybindAction) {
        resetKeybind(id);
        if (id === "pushToTalk") refreshMicGate();
        setNotice("");
    }

    function resetAll() {
        stopRecording();
        resetAllKeybinds();
        refreshMicGate();
        setNotice("");
    }

    function globalVoiceStatus() {
        const status = globalStatus;
        if (!status) return null;
        return (
            <View className="py-2 border-b border-discord-divider">
                {status.state === "wayland" ? (
                    <>
                        <Text className="text-sm text-discord-textPrimary">
                            {t("keybinds.globalVoice")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("keybinds.globalWayland")}
                        </Text>
                    </>
                ) : (
                    <>
                        <View className="flex-row items-center gap-3">
                            <View className="flex-1">
                                <Text className="text-sm text-discord-textPrimary">
                                    {t("keybinds.globalVoice")}
                                </Text>
                                <Text className="text-xs text-discord-textMuted">
                                    {status.backend === "portal"
                                        ? t("keybinds.globalPortalHint")
                                        : t("keybinds.globalVoiceHint")}
                                </Text>
                            </View>
                            <ToggleSwitch
                                checked={globalVoice}
                                onChange={setGlobalVoiceKeybinds}
                                label={t("keybinds.globalVoice")}
                            />
                        </View>
                        {globalVoice && status.state === "permission" ? (
                            <View
                                className="mt-2 flex-row flex-wrap items-center gap-2"
                                role="status"
                            >
                                <Text className="flex-1 min-w-[12rem] text-xs text-discord-warning">
                                    {t("keybinds.globalPermission")}
                                </Text>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() =>
                                        void requestGlobalHotkeyPermission()
                                    }
                                    className={smallButtonClass}
                                >
                                    <Text className={smallButtonTextClass}>
                                        {t("keybinds.globalOpenSettings")}
                                    </Text>
                                </Pressable>
                            </View>
                        ) : globalVoice && status.state === "error" ? (
                            <Text
                                className="mt-2 text-xs text-discord-warning"
                                role="status"
                            >
                                {t(
                                    status.backend === "portal"
                                        ? "keybinds.globalPortalError"
                                        : "keybinds.globalError",
                                    { error: status.error ?? "" },
                                )}
                            </Text>
                        ) : globalVoice &&
                          status.state === "active" &&
                          status.backend === "portal" ? (
                            <View className="mt-2 flex-col gap-1" role="status">
                                <Text className="text-xs text-discord-textMuted">
                                    {t("keybinds.globalPortalAssigned")}
                                </Text>
                                {(status.shortcuts ?? []).map((s) => (
                                    <Text
                                        key={s.id}
                                        className="text-xs text-discord-textPrimary"
                                    >
                                        {isKeybindAction(s.id)
                                            ? keybindLabel(s.id)
                                            : s.id}
                                        :{" "}
                                        <Text
                                            className={
                                                s.trigger
                                                    ? "font-medium"
                                                    : "text-discord-textMuted"
                                            }
                                        >
                                            {s.trigger || t("keybinds.notSet")}
                                        </Text>
                                    </Text>
                                ))}
                                {hasMouseVoiceBinding ? (
                                    <Text className="text-xs text-discord-warning">
                                        {t("keybinds.globalPortalMouse")}
                                    </Text>
                                ) : null}
                                {status.configurable ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={configureGlobalShortcuts}
                                        className={`self-start mt-1 ${smallButtonClass}`}
                                    >
                                        <Text className={smallButtonTextClass}>
                                            {t(
                                                "keybinds.globalPortalConfigure",
                                            )}
                                        </Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        ) : null}
                    </>
                )}
            </View>
        );
    }

    return (
        <View className="flex-col gap-6">
            <View>
                <View className="flex-row items-start gap-3">
                    <Text className="flex-1 text-sm text-discord-textMuted">
                        {t("keybinds.intro")}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={resetAll}
                        className={`flex-shrink-0 ${smallButtonClass}`}
                    >
                        <Text className={smallButtonTextClass}>
                            {t("keybinds.resetAll")}
                        </Text>
                    </Pressable>
                </View>
                {notice ? (
                    <Text
                        className="mt-2 text-xs text-discord-warning"
                        role="status"
                    >
                        {notice}
                    </Text>
                ) : null}
            </View>

            {groups.map((g) => (
                <View key={g.category}>
                    <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide mb-2">
                        {keybindCategoryLabel(g.category)}
                    </Text>
                    {g.category === "voice" ? globalVoiceStatus() : null}
                    {g.rows.map((row) => {
                        const id = row.def.id;
                        const recording = recordingId === id;
                        return (
                            <View
                                key={id}
                                className="flex-row flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b border-discord-divider"
                            >
                                <View className="flex-1 min-w-[10rem]">
                                    <Text className="text-sm text-discord-textPrimary">
                                        {keybindLabel(id)}
                                    </Text>
                                    {hint(id) ? (
                                        <Text className="text-xs text-discord-textMuted">
                                            {hint(id)}
                                        </Text>
                                    ) : null}
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() =>
                                        recording
                                            ? stopRecording()
                                            : startRecording(id)
                                    }
                                    accessibilityLabel={t(
                                        "keybinds.changeFor",
                                        {
                                            action: keybindLabel(id),
                                        },
                                    )}
                                    accessibilityState={{ selected: recording }}
                                    className={`min-w-[9rem] px-2 py-1 rounded border ${
                                        recording
                                            ? "border-discord-accent bg-discord-backgroundTertiary"
                                            : "border-transparent bg-discord-backgroundTertiary hover:border-discord-divider"
                                    }`}
                                >
                                    {recording ? (
                                        <Text className="text-xs text-discord-accent">
                                            {isHold(id)
                                                ? t("keybinds.pressKeyOrButton")
                                                : t("keybinds.pressKey")}
                                        </Text>
                                    ) : row.binding ? (
                                        <KeyCaps binding={row.binding} />
                                    ) : (
                                        <Text className="text-xs text-discord-textMuted">
                                            {t("keybinds.notSet")}
                                        </Text>
                                    )}
                                </Pressable>
                                <View className="flex-row items-center gap-1 w-[4.5rem] justify-end">
                                    {row.binding ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() => clear(id)}
                                            accessibilityLabel={t(
                                                "keybinds.clearFor",
                                                { action: keybindLabel(id) },
                                            )}
                                            className="p-1 rounded hover:bg-discord-messageHover"
                                        >
                                            <SvgIcon
                                                d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"
                                                className="w-4 h-4 text-discord-textMuted"
                                            />
                                        </Pressable>
                                    ) : null}
                                    {!row.isDefault ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() => reset(id)}
                                            accessibilityLabel={t(
                                                "keybinds.resetFor",
                                                { action: keybindLabel(id) },
                                            )}
                                            className="p-1 rounded hover:bg-discord-messageHover"
                                        >
                                            <SvgIcon
                                                d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"
                                                className="w-4 h-4 text-discord-textMuted"
                                            />
                                        </Pressable>
                                    ) : null}
                                </View>
                            </View>
                        );
                    })}
                </View>
            ))}
        </View>
    );
}
