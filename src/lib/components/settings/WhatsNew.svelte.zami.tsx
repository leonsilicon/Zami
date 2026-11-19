import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Details, openLink } from "@-/com.leonsilicon.zami.rn";
import { intlLocale, t } from "$lib/i18n";
import { APP_VERSION, fetchReleaseList } from "$lib/update";
import {
    pickReleaseForVersion,
    type ChangelogRelease,
} from "$lib/utils/changelog";
import { GITHUB_OWNER, GITHUB_REPO } from "$lib/utils/androidUpdate";
import ReleaseNotesBody from "./ReleaseNotesBody.svelte";

export default function WhatsNew() {
    const [releases, setReleases] = useState<ChangelogRelease[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const current = pickReleaseForVersion(releases, APP_VERSION);
    const older = current ? releases.filter((r) => r !== current) : releases;

    useEffect(() => {
        (async () => {
            try {
                setReleases(await fetchReleaseList(10));
            } catch {
                setFailed(true);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    function formatDate(iso: string): string {
        if (!iso) return "";
        const d = new Date(iso);
        return Number.isNaN(d.getTime())
            ? ""
            : d.toLocaleDateString(intlLocale());
    }

    return (
        <View>
            <Text className="text-xs font-semibold text-zam-textMuted uppercase tracking-wide mb-2">
                {t("whatsNew.whatSNew")}
            </Text>

            {loading ? (
                <Text className="text-sm text-zam-textMuted">
                    {t("whatsNew.loadingReleaseNotes")}
                </Text>
            ) : failed || releases.length === 0 ? (
                <Text className="text-sm text-zam-textMuted">
                    {t("whatsNew.releaseNotesUnavailable")}{" "}
                    {/* Zami: openReleasePage() calls window.open; the link opens
                        with the system instead. */}
                    <Text
                        accessibilityRole="button"
                        className="text-sm underline text-zam-accent hover:text-zam-textPrimary"
                        onPress={() =>
                            openLink(
                                `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
                            )
                        }
                    >
                        {t("whatsNew.viewOnGithub")}
                    </Text>
                </Text>
            ) : (
                <>
                    {current && (
                        <View className="py-2 border-b border-zam-divider">
                            <Text className="text-sm font-semibold text-zam-textPrimary mb-1">
                                {current.name}
                                {formatDate(current.published_at) ? (
                                    <Text className="text-xs text-zam-textMuted font-normal">
                                        {" "}
                                        · {formatDate(current.published_at)}
                                    </Text>
                                ) : null}
                            </Text>
                            <ReleaseNotesBody body={current.body} />
                        </View>
                    )}
                    {older.map((r) => (
                        <Details
                            key={r.tag_name}
                            className="py-2 border-b border-zam-divider"
                            summary={
                                <Text className="shrink text-sm text-zam-textPrimary cursor-pointer select-none">
                                    {r.name}
                                    {formatDate(r.published_at) ? (
                                        <Text className="text-xs text-zam-textMuted">
                                            {" "}
                                            · {formatDate(r.published_at)}
                                        </Text>
                                    ) : null}
                                </Text>
                            }
                        >
                            <View className="mt-1">
                                <ReleaseNotesBody body={r.body} />
                            </View>
                        </Details>
                    ))}
                </>
            )}
        </View>
    );
}
