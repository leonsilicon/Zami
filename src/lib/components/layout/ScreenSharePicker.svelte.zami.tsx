import { Image, Select, mediaSource } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";
import {
    BackHandler,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import { t } from "$lib/i18n";
// Electron-only. The main process arbitrates getDisplayMedia() and pushes
// the screen/window list here; this dialog collects the choice and sends it
// back. It deliberately does NOT join the shared modal slot: it exists only
// on desktop (no mobile back button to route), it is driven by a main-process
// request rather than by app navigation, and it must be dismissable even if
// another layer holds the slot.
import Portal from "$lib/components/ui/Portal.svelte";
import {
    onScreenShareRequest,
    onScreenShareCancel,
    respondToScreenShare,
} from "$lib/desktopScreenShare";
import {
    shapeDisplaySources,
    groupDisplaySources,
    shareAudioOptions,
    defaultShareAudioChoice,
    type DisplaySource,
    type ShareAudioOption,
} from "$lib/utils/displaySources";
import { settingsState } from "$lib/stores/settings.svelte";
import ScreenShareQualityChips from "./ScreenShareQualityChips.svelte";
import { SCREEN_RESOLUTIONS } from "$lib/utils/voiceCall";

// Zami: not ported: screen sharing itself. There's no Electron main process
// (`window.desktop`) and no React Native screen capture (LiveKit's SDK isn't
// installed), so no source request ever arrives and this dialog stays closed;
// respondToScreenShare finds no bridge and does nothing. The UI is translated
// from the same stores for when a native share exists.
export default function ScreenSharePicker() {
    // Quality used to be a separate popover before this dialog; it lives
    // here now so a share is one dialog. Changes apply once the share starts
    // (setScreenShareEnabled), and live from the share's gear afterwards.
    const [showQuality, setShowQuality] = useState(false);

    const [requestId, setRequestId] = useState<number | null>(null);
    const [sources, setSources] = useState<DisplaySource[]>([]);
    // The share's audio, chosen before clicking a source (a click shares).
    const [audioOptions, setAudioOptions] = useState<ShareAudioOption[]>([]);
    const [audioChoice, setAudioChoice] = useState("none");

    const groups = groupDisplaySources(sources);
    const generalAudio = audioOptions.filter((o) => !o.app);
    const appAudio = audioOptions.filter((o) => o.app);

    const screenShareResolution = useRune(
        () => settingsState.screenShareResolution,
    );
    const screenShareFps = useRune(() => settingsState.screenShareFps);

    // Zami: the open request as of the last render, for the main process's
    // cancel, which arrives outside any render.
    const requestIdRef = useRef(requestId);
    useEffect(() => {
        requestIdRef.current = requestId;
    });

    // Subscribe once on mount; no reactive reads, so this effect never re-runs.
    useEffect(() => {
        const unsubRequest = onScreenShareRequest((req) => {
            const options = shareAudioOptions(req.audio);
            requestIdRef.current = req.requestId;
            setRequestId(req.requestId);
            setSources(shapeDisplaySources(req.sources));
            setAudioOptions(options);
            setAudioChoice(
                defaultShareAudioChoice(
                    options,
                    settingsState.shareSystemAudio,
                ),
            );
        });
        const unsubCancel = onScreenShareCancel((id) => {
            if (requestIdRef.current === id) close();
        });
        return () => {
            unsubRequest();
            unsubCancel();
        };
    }, []);

    function close() {
        requestIdRef.current = null;
        setRequestId(null);
        setSources([]);
        setAudioOptions([]);
    }

    function pick(source: DisplaySource) {
        if (requestId === null) return;
        respondToScreenShare(
            requestId,
            source.id,
            source.name,
            audioOptions.length ? audioChoice : "none",
        );
        close();
    }

    function cancel() {
        if (requestId === null) return;
        respondToScreenShare(requestId, null);
        close();
    }

    // Zami: the focus trap's Escape, as Android's back button (VoiceOver's
    // escape gesture is the dialog's onAccessibilityEscape).
    const onEscape = useEffectEvent(() => cancel());
    const isOpen = requestId !== null;
    useEffect(() => {
        if (!isOpen) return;
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                onEscape();
                return true;
            },
        );
        return () => subscription.remove();
    }, [isOpen]);

    // Zami: `grid grid-cols-2 sm:grid-cols-3` → rows of equal-width cells,
    // two to a row, or three from Tailwind's `sm` width up.
    const viewport = useWindowDimensions();
    const columns = viewport.width >= 640 ? 3 : 2;
    function rows(items: DisplaySource[]): (DisplaySource | null)[][] {
        const out: (DisplaySource | null)[][] = [];
        for (let i = 0; i < items.length; i += columns) {
            const row: (DisplaySource | null)[] = items.slice(i, i + columns);
            while (row.length < columns) row.push(null);
            out.push(row);
        }
        return out;
    }

    // Zami: Select has no <optgroup>: the applications follow the general
    // choices, each labelled with the group's name.
    const audioSelectOptions = [
        ...generalAudio.map((option) => ({
            value: option.value,
            label: option.label,
        })),
        ...appAudio.map((option) => ({
            value: option.value,
            label: `${t("screenSharePicker.audioApps")}: ${option.label}`,
        })),
    ];

    if (requestId === null) return null;
    return (
        <Portal>
            <View
                pointerEvents="box-none"
                className="absolute inset-0 z-[110] flex-row items-center justify-center p-4"
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.cancel")}
                    className="absolute inset-0 bg-black/60"
                    onPress={cancel}
                />
                <View
                    className="flex max-h-[80vh] w-full max-w-3xl shrink flex-col overflow-hidden rounded-lg bg-discord-backgroundSecondary shadow-xl"
                    role="dialog"
                    accessibilityViewIsModal
                    aria-labelledby="screenshare-picker-title"
                    onAccessibilityEscape={cancel}
                >
                    <View className="border-b border-discord-divider px-4 py-3">
                        <Text
                            nativeID="screenshare-picker-title"
                            role="heading"
                            className="text-base font-semibold text-discord-textPrimary"
                        >
                            {t("screenSharePicker.chooseWhatToShare")}
                        </Text>
                    </View>

                    <ScrollView
                        style={styles.sources}
                        contentContainerClassName="px-4 py-3"
                    >
                        {[
                            {
                                label: t("screenSharePicker.screens"),
                                items: groups.screens,
                            },
                            {
                                label: t("screenSharePicker.windows"),
                                items: groups.windows,
                            },
                        ].map((group) => (
                            <Fragment key={group.label}>
                                {group.items.length ? (
                                    <>
                                        <Text className="mb-2 mt-1 text-xs font-semibold uppercase tracking-wide text-discord-textMuted">
                                            {group.label}
                                        </Text>
                                        <View className="mb-3 gap-3">
                                            {rows(group.items).map((row) => (
                                                <View
                                                    key={row[0]!.id}
                                                    className="flex-row gap-3"
                                                >
                                                    {row.map((source, i) =>
                                                        source ? (
                                                            <Pressable
                                                                key={source.id}
                                                                accessibilityRole="button"
                                                                accessibilityLabel={
                                                                    source.name
                                                                }
                                                                className="flex-1 flex flex-col overflow-hidden rounded border border-transparent bg-discord-background hover:border-discord-accent focus:border-discord-accent active:border-discord-accent"
                                                                onPress={() =>
                                                                    pick(source)
                                                                }
                                                            >
                                                                <View className="flex aspect-video w-full items-center justify-center bg-black/40">
                                                                    {source.thumbnailDataUrl ? (
                                                                        <Image
                                                                            source={mediaSource(
                                                                                source.thumbnailDataUrl,
                                                                            )}
                                                                            contentFit="contain"
                                                                            className="h-full w-full"
                                                                        />
                                                                    ) : (
                                                                        <Text className="text-xs text-discord-textMuted">
                                                                            {t(
                                                                                "screenSharePicker.noPreview",
                                                                            )}
                                                                        </Text>
                                                                    )}
                                                                </View>
                                                                <Text
                                                                    numberOfLines={
                                                                        1
                                                                    }
                                                                    className="px-2 py-1.5 text-xs text-discord-textSecondary"
                                                                >
                                                                    {
                                                                        source.name
                                                                    }
                                                                </Text>
                                                            </Pressable>
                                                        ) : (
                                                            <View
                                                                key={`empty-${i}`}
                                                                className="flex-1"
                                                            />
                                                        ),
                                                    )}
                                                </View>
                                            ))}
                                        </View>
                                    </>
                                ) : null}
                            </Fragment>
                        ))}
                    </ScrollView>

                    {showQuality ? (
                        <ScrollView
                            nativeID="screenshare-picker-quality"
                            style={styles.quality}
                            className="border-t border-discord-divider max-h-[40vh]"
                            contentContainerClassName="px-4 py-3 gap-3"
                        >
                            <ScreenShareQualityChips />
                        </ScrollView>
                    ) : null}
                    <View className="flex-row flex-wrap items-center justify-end gap-2 border-t border-discord-divider px-4 py-3">
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => setShowQuality(!showQuality)}
                            accessibilityState={{ expanded: showQuality }}
                            className="me-auto rounded px-3 py-2 hover:bg-discord-messageHover active:bg-discord-messageHover"
                        >
                            <Text className="text-sm text-discord-textSecondary">
                                {showQuality ? "▾" : "▸"}{" "}
                                {t("screenSharePicker.quality", {
                                    quality: `${SCREEN_RESOLUTIONS.find((r) => r.key === screenShareResolution)?.label ?? screenShareResolution} · ${screenShareFps} fps`,
                                })}
                            </Text>
                        </Pressable>
                        {audioOptions.length ? (
                            <View className="flex-row min-w-0 max-w-full shrink items-center gap-2">
                                <Text className="text-sm text-discord-textSecondary">
                                    {t("screenSharePicker.audio")}
                                </Text>
                                <Select
                                    value={audioChoice}
                                    options={audioSelectOptions}
                                    onChange={setAudioChoice}
                                    accessibilityLabel={t(
                                        "screenSharePicker.audio",
                                    )}
                                    className="min-w-0 max-w-[20rem] shrink rounded bg-discord-backgroundTertiary px-3 py-2"
                                />
                            </View>
                        ) : null}
                        <Pressable
                            accessibilityRole="button"
                            className="rounded px-4 py-2"
                            onPress={cancel}
                        >
                            <Text className="text-sm text-discord-textSecondary hover:text-discord-textPrimary">
                                {t("common.cancel")}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Portal>
    );
}

const styles = StyleSheet.create({
    // `flex-1 overflow-y-auto`: takes what the panel's max height leaves the
    // list, and no more than the list needs.
    sources: { flexGrow: 0, flexShrink: 1 },
    quality: { flexGrow: 0 },
});
