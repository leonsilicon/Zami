import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useResolveClassNames } from "uniwind";
import { t } from "$lib/i18n";
// Ctrl+/: every keyboard shortcut as currently bound, as in Discord.
import { KEYBIND_CATEGORIES, KEYBIND_DEFS } from "$lib/keybinds/keybinds";
import { keybindCategoryLabel, keybindLabel } from "$lib/keybinds/labels";
import { bindingFor, keybindsState } from "$lib/stores/keybinds.svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import KeyCaps from "./KeyCaps.svelte";

interface Props {
    onClose: () => void;
    /** Opens Settings > Keybinds. */
    onCustomize: () => void;
}

// Zami: the inline <svg fill="currentColor"> close icon, in its button's text color.
function CloseIcon({ className }: { className: string }) {
    const { color } = useResolveClassNames(className);
    return (
        <View
            className={className}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            <Svg
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                fill={color as string | undefined}
            >
                <Path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z" />
            </Svg>
        </View>
    );
}

// Zami: the scrolling body is a ScrollView inside the panel (the panel itself
// can't scroll), and `grid md:grid-cols-2` is a column that wraps into two
// columns from `md:`.
export default function KeyboardShortcutsDialog({
    onClose,
    onCustomize,
}: Props) {
    const groups = useRune(() => {
        void keybindsState.overrides;
        return KEYBIND_CATEGORIES.map((c) => ({
            category: c,
            rows: KEYBIND_DEFS.filter((d) => d.category === c)
                .map((d) => ({ id: d.id, binding: bindingFor(d.id) }))
                .filter((r) => r.binding !== null),
        })).filter((g) => g.rows.length > 0);
    });

    return (
        <ModalDialog
            onClose={onClose}
            labelledBy="keyboard-shortcuts-title"
            layerClass="z-50 flex items-center justify-center p-4"
            panelClass="relative w-full max-w-3xl max-h-[85vh] flex flex-col bg-discord-backgroundSecondary rounded-lg shadow-xl"
        >
            <View className="flex-row items-center gap-3 px-6 pt-5 pb-3 border-b border-discord-divider">
                <Text
                    nativeID="keyboard-shortcuts-title"
                    role="heading"
                    className="flex-1 text-lg font-bold text-discord-textPrimary"
                >
                    {t("keybinds.helpTitle")}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    onPress={onCustomize}
                    className="px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover"
                >
                    <Text className="text-sm font-medium text-white">
                        {t("keybinds.customize")}
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    onPress={onClose}
                    accessibilityLabel={t("common.closeDialog")}
                    className="p-1.5 rounded hover:bg-discord-messageHover"
                >
                    <CloseIcon className="w-5 h-5 text-discord-textMuted" />
                </Pressable>
            </View>
            <ScrollView
                style={styles.body}
                contentContainerClassName="px-6 py-4 flex-col gap-6 md:flex-row md:flex-wrap"
            >
                {groups.map((g) => (
                    <View key={g.category} className="md:w-[48%]">
                        <Text
                            role="heading"
                            className="mb-2 text-xs font-semibold text-discord-textMuted uppercase tracking-wide"
                        >
                            {keybindCategoryLabel(g.category)}
                        </Text>
                        {g.rows.map((row) => (
                            <View
                                key={row.id}
                                className="flex-row items-center gap-3 py-1.5 border-b border-discord-divider"
                            >
                                <Text className="flex-1 text-sm text-discord-textPrimary">
                                    {keybindLabel(row.id)}
                                </Text>
                                <KeyCaps binding={row.binding!} />
                            </View>
                        ))}
                    </View>
                ))}
            </ScrollView>
        </ModalDialog>
    );
}

const styles = StyleSheet.create({
    // Only as tall as its content, so the dialog sizes to it.
    body: { flexGrow: 0 },
});
