import { useEffect, useEffectEvent, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { t } from "$lib/i18n";
import {
    APP_VERSION,
    fetchReleaseList,
    fetchReleaseNotes,
    openReleasePage,
} from "$lib/update";
import { releasesBetween, normalizeVersion } from "$lib/utils/changelog";
import { GITHUB_OWNER, GITHUB_REPO } from "$lib/utils/androidUpdate";
import ReleaseNotesBody from "$lib/components/settings/ReleaseNotesBody.svelte";
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import { openModal, clearModalIfOwner } from "$lib/stores/interface.svelte";

// Zami: the scrolling body is a ScrollView inside the panel (the panel itself
// can't scroll); `first:mt-0` is the first section's heading.
export default function WhatsNewModal({
    onClose,
    lastSeen = null,
}: {
    onClose: () => void;
    lastSeen?: string | null;
}) {
    // Every release since the one last seen, newest first; empty when only
    // the current version's notes could be had.
    const [sections, setSections] = useState<
        { version: string; body: string }[]
    >([]);
    const [body, setBody] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const close = useEffectEvent(() => onClose());
    useEffect(() => {
        const token = openModal("whats-new", () => close());

        void (async () => {
            let found: { version: string; body: string }[] = [];
            try {
                try {
                    found = releasesBetween(
                        await fetchReleaseList(30),
                        lastSeen,
                        APP_VERSION,
                    ).map((r) => ({
                        version: normalizeVersion(r.tag_name),
                        body: r.body,
                    }));
                    setSections(found);
                } catch {
                    // Fall back to just this version's notes below.
                }
                if (found.length === 0) {
                    setBody(await fetchReleaseNotes(APP_VERSION));
                }
            } catch {
                setFailed(true);
            } finally {
                setLoading(false);
            }
        })();

        return () => {
            clearModalIfOwner(token);
        };
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as onMount.
    }, []);

    return (
        <ModalDialog
            onClose={onClose}
            label={t("whatsNewModal.whatSNew")}
            layerClass="z-[60] flex items-center justify-center p-4"
            backdropClass="bg-black/50"
            panelClass="relative w-full max-w-lg rounded-lg bg-discord-backgroundSecondary shadow-xl flex flex-col max-h-[80vh]"
        >
            <View className="flex-row items-center justify-between border-b border-discord-divider px-4 py-3 flex-shrink-0">
                <Text
                    role="heading"
                    className="shrink text-base font-semibold text-discord-textPrimary"
                >
                    {sections.length > 1 && lastSeen
                        ? t("whatsNewModal.whatSNewSince", {
                              from: normalizeVersion(lastSeen),
                              APP_VERSION,
                          })
                        : t("whatsNewModal.whatSNewInV", { APP_VERSION })}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    onPress={onClose}
                    accessibilityLabel={t("common.close")}
                    className="px-1"
                >
                    <Text className="text-discord-textMuted hover:text-discord-textPrimary text-lg leading-none">
                        ✕
                    </Text>
                </Pressable>
            </View>
            <ScrollView
                style={styles.body}
                contentContainerClassName="px-4 py-3"
            >
                {loading ? (
                    <Text className="text-sm text-discord-textMuted">
                        {t("common.loading")}
                    </Text>
                ) : failed ? (
                    <Text className="text-sm text-discord-textMuted">
                        {t("whatsNewModal.releaseNotesUnavailable")}{" "}
                        <Text
                            accessibilityRole="button"
                            className="text-sm text-discord-textMuted underline"
                            onPress={() =>
                                openReleasePage(
                                    `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
                                )
                            }
                        >
                            {t("whatsNewModal.viewOnGithub")}
                        </Text>
                    </Text>
                ) : sections.length > 0 ? (
                    sections.map((section, i) => (
                        <View key={section.version}>
                            {sections.length > 1 && (
                                <Text
                                    role="heading"
                                    className={`text-sm font-semibold text-discord-textPrimary ${
                                        i === 0 ? "mt-0" : "mt-3"
                                    } mb-1`}
                                >
                                    v{section.version}
                                </Text>
                            )}
                            <ReleaseNotesBody body={section.body} />
                        </View>
                    ))
                ) : (
                    <ReleaseNotesBody body={body ?? ""} />
                )}
            </ScrollView>
            <View className="flex-row justify-end border-t border-discord-divider px-4 py-3 flex-shrink-0">
                <Pressable
                    accessibilityRole="button"
                    onPress={onClose}
                    className="px-4 py-2 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors"
                >
                    <Text className="text-sm font-semibold text-white">
                        {t("whatsNewModal.gotIt")}
                    </Text>
                </Pressable>
            </View>
        </ModalDialog>
    );
}

const styles = StyleSheet.create({
    // The body takes what the header and footer leave (`flex-1 min-h-0`), and
    // no more, so the dialog sizes to its notes.
    body: { flexGrow: 0, flexShrink: 1 },
});
