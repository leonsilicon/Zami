import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import {
    Pressable,
    ScrollView,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import { t } from "$lib/i18n";
import type { MatrixEvent } from "matrix-js-sdk";
import { Check, Copy, X } from "lucide-svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import Portal from "$lib/components/ui/Portal.svelte";
import { closeModal } from "$lib/stores/interface.svelte";

interface Props {
    event: MatrixEvent;
}

// Zami: `max-h-[min(720px,90dvh)]` → the panel's `max-h-[90%]` (of the layer)
// around a `max-h-[720px]` column, as in ForwardMessageDialog: React Native
// has no `min()`. Each `<pre>` (`max-h-[40vh] overflow-auto whitespace-pre`) is
// a vertical ScrollView capped at 40% of the window around a horizontal one.
export default function ViewSourceDialog({ event }: Props) {
    const windowSize = useWindowDimensions();

    // The clear view (decrypted for an encrypted event, the plain event
    // otherwise) and the wire event as the server delivered it. Both are shown
    // as text, never as HTML, so event content cannot inject markup here.
    const decryptedJson = JSON.stringify(event.getEffectiveEvent(), null, 2);
    const encrypted = event.isEncrypted();
    const encryptedJson = encrypted ? JSON.stringify(event.event, null, 2) : "";

    const [copied, setCopied] = useState<"decrypted" | "encrypted" | null>(
        null,
    );
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );
    useEffect(() => () => clearTimeout(copiedTimer.current), []);

    async function copy(which: "decrypted" | "encrypted", text: string) {
        try {
            // Zami: navigator.clipboard → expo-clipboard.
            await Clipboard.setStringAsync(text);
            setCopied(which);
            clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopied(null), 1500);
        } catch {
            /* clipboard denied (permissions / insecure context): stay silent */
        }
    }

    function renderSection(
        which: "decrypted" | "encrypted",
        title: string,
        json: string,
    ) {
        return (
            <View>
                <View className="mb-1.5 flex-row items-center justify-between gap-2">
                    <Text
                        role="heading"
                        className="text-xs font-bold uppercase text-discord-textSecondary"
                    >
                        {title}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => void copy(which, json)}
                        className="flex-row items-center gap-1 rounded px-2 py-1 hover:bg-discord-messageHover"
                    >
                        {copied === which ? (
                            <Check
                                size={14}
                                className="text-discord-textMuted"
                            />
                        ) : (
                            <Copy
                                size={14}
                                className="text-discord-textMuted"
                            />
                        )}
                        <Text className="text-xs font-medium text-discord-textMuted">
                            {copied === which
                                ? t("viewSource.copied")
                                : t("common.copy")}
                        </Text>
                    </Pressable>
                </View>
                <ScrollView
                    nestedScrollEnabled
                    className="grow-0 rounded bg-discord-backgroundTertiary"
                    style={{ maxHeight: windowSize.height * 0.4 }}
                >
                    <ScrollView horizontal contentContainerClassName="p-3">
                        <Text
                            selectable
                            className="font-mono text-xs leading-relaxed text-discord-textPrimary"
                        >
                            {json}
                        </Text>
                    </ScrollView>
                </ScrollView>
            </View>
        );
    }

    return (
        <Portal>
            <ModalDialog
                onClose={closeModal}
                labelledBy="view-source-title"
                layerClass="z-[90] flex items-center justify-center p-3"
                panelClass="relative flex max-h-[90%] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-discord-divider bg-discord-backgroundSecondary shadow-2xl"
            >
                <View className="max-h-[720px] shrink flex-col">
                    <View className="flex-row items-center justify-between border-b border-discord-divider px-4 py-3">
                        <Text
                            nativeID="view-source-title"
                            role="heading"
                            className="text-base font-semibold text-discord-textPrimary"
                        >
                            {t("viewSource.title")}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            onPress={closeModal}
                            className="p-1.5 rounded hover:bg-discord-messageHover"
                            accessibilityLabel={t("common.close")}
                        >
                            <X
                                size={20}
                                className="text-discord-textMuted hover:text-discord-textPrimary"
                            />
                        </Pressable>
                    </View>

                    <ScrollView
                        className="min-h-0 shrink grow-0"
                        contentContainerClassName="gap-4 p-4"
                    >
                        {renderSection(
                            "decrypted",
                            t("viewSource.decrypted"),
                            decryptedJson,
                        )}

                        {encrypted &&
                            renderSection(
                                "encrypted",
                                t("viewSource.encrypted"),
                                encryptedJson,
                            )}
                    </ScrollView>
                </View>
            </ModalDialog>
        </Portal>
    );
}
