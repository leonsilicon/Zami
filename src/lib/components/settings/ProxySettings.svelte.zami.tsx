import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Check } from "lucide-svelte";
import { t } from "$lib/i18n";

const selectClass =
    "w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none border border-transparent focus:border-discord-accent/50";
const inputClass =
    "w-full px-3 py-2 rounded text-sm bg-discord-backgroundTertiary text-discord-textPrimary placeholder:text-discord-textMuted focus:outline-none focus:ring-1 focus:ring-discord-accent";
// Zami: `block` dropped; a Text is a block in a column already.
const labelClass = "text-sm text-discord-textPrimary mb-1";
const hintClass = "text-xs text-discord-textMuted mt-1";

interface SelectOption<T extends string> {
    value: T;
    label: string;
}

// Zami: React Native has no <select>; its options are listed as a radio group in
// the select's box instead.
function Select<T extends string>({
    nativeID,
    label,
    value,
    onChange,
    options,
}: {
    nativeID: string;
    label: string;
    value: T;
    onChange: (value: T) => void;
    options: readonly SelectOption<T>[];
}) {
    return (
        <View
            nativeID={nativeID}
            accessibilityRole="radiogroup"
            accessibilityLabel={label}
            className={selectClass}
        >
            {options.map((option) => (
                <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: value === option.value }}
                    onPress={() => onChange(option.value)}
                    className="flex-row items-center justify-between gap-2 py-1"
                >
                    <Text className="shrink text-sm text-discord-textPrimary">
                        {option.label}
                    </Text>
                    {value === option.value && (
                        <Check size={14} className="text-discord-accent" />
                    )}
                </Pressable>
            ))}
        </View>
    );
}

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. `data-setting-anchor` (settings search scrolls to it)
// is not ported.
export default function ProxySettings() {
    // Desktop only: Zam's own proxy and how calls treat it
    // (electron/proxy.cjs). Applied by main on Save, no restart needed.
    const bridge = typeof window !== "undefined" ? window.desktop?.proxy : null;

    const [info, setInfo] = useState<DesktopProxyInfo | null>(null);
    const [draft, setDraft] = useState<DesktopProxyPrefs>({
        mode: "system",
        rules: "",
        bypass: "",
        pacUrl: "",
        calls: "default",
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [loadError, setLoadError] = useState("");

    function adopt(next: DesktopProxyInfo): void {
        setInfo(next);
        setDraft({
            mode: next.mode,
            rules: next.rules,
            bypass: next.bypass,
            pacUrl: next.pacUrl,
            calls: next.calls,
        });
    }

    useEffect(() => {
        bridge
            ?.info()
            .then(adopt)
            .catch((e) => setLoadError(String(e)));
    }, []);

    const dirty =
        !!info &&
        (draft.mode !== info.mode ||
            draft.rules !== info.rules ||
            draft.bypass !== info.bypass ||
            draft.pacUrl !== info.pacUrl ||
            draft.calls !== info.calls);

    async function save(): Promise<void> {
        if (!bridge) return;
        setSaving(true);
        setSaved(false);
        try {
            const next = await bridge.set({ ...draft });
            adopt(next);
            setSaved(!next.error);
        } catch (e) {
            setLoadError(String(e));
        } finally {
            setSaving(false);
        }
    }

    function update(patch: Partial<DesktopProxyPrefs>): void {
        setDraft((current) => ({ ...current, ...patch }));
    }

    // Calls can only bypass Zam's own proxy or the launch flags' (not the
    // OS settings), judged on the draft so the note shows before saving.
    const bypassUnavailable =
        draft.calls === "direct" &&
        draft.mode === "system" &&
        (info?.launchFlags.length ?? 0) === 0;

    if (!bridge) return null;
    return (
        <View className="gap-4">
            <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                {t("proxySettings.network")}
            </Text>

            <View>
                <Text className={labelClass}>{t("proxySettings.proxy")}</Text>
                <Select
                    nativeID="proxy-mode"
                    label={t("proxySettings.proxy")}
                    value={draft.mode}
                    onChange={(mode) => update({ mode })}
                    options={[
                        {
                            value: "system",
                            label: t("proxySettings.modeSystem"),
                        },
                        {
                            value: "direct",
                            label: t("proxySettings.modeDirect"),
                        },
                        {
                            value: "manual",
                            label: t("proxySettings.modeManual"),
                        },
                        { value: "pac", label: t("proxySettings.modePac") },
                    ]}
                />
                {draft.mode === "system" && info?.launchFlags.length ? (
                    <Text className={hintClass}>
                        {t("proxySettings.launchFlagsInUse")}{" "}
                        <Text className="text-xs text-discord-textMuted font-mono">
                            {info.launchFlags.join(" ")}
                        </Text>
                    </Text>
                ) : null}
            </View>

            {draft.mode === "manual" ? (
                <>
                    <View>
                        <Text className={labelClass}>
                            {t("proxySettings.server")}
                        </Text>
                        <TextInput
                            nativeID="proxy-rules"
                            accessibilityLabel={t("proxySettings.server")}
                            className={inputClass}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            spellCheck={false}
                            autoCorrect={false}
                            autoCapitalize="none"
                            autoComplete="off"
                            placeholder="socks5://127.0.0.1:9050"
                            value={draft.rules}
                            onChangeText={(rules) => update({ rules })}
                        />
                        <Text className={hintClass}>
                            {t("proxySettings.serverHint")}
                        </Text>
                    </View>
                    <View>
                        <Text className={labelClass}>
                            {t("proxySettings.bypass")}
                        </Text>
                        <TextInput
                            nativeID="proxy-bypass"
                            accessibilityLabel={t("proxySettings.bypass")}
                            className={inputClass}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            spellCheck={false}
                            autoCorrect={false}
                            autoCapitalize="none"
                            autoComplete="off"
                            placeholder="example.org, 192.168.0.0/16"
                            value={draft.bypass}
                            onChangeText={(bypass) => update({ bypass })}
                        />
                    </View>
                </>
            ) : draft.mode === "pac" ? (
                <View>
                    <Text className={labelClass}>
                        {t("proxySettings.pacUrl")}
                    </Text>
                    <TextInput
                        nativeID="proxy-pac"
                        accessibilityLabel={t("proxySettings.pacUrl")}
                        className={inputClass}
                        placeholderTextColorClassName="accent-discord-textMuted"
                        spellCheck={false}
                        autoCorrect={false}
                        autoCapitalize="none"
                        autoComplete="off"
                        placeholder="file:///home/me/proxy.pac"
                        value={draft.pacUrl}
                        onChangeText={(pacUrl) => update({ pacUrl })}
                    />
                </View>
            ) : null}

            <View>
                <Text className={labelClass}>{t("proxySettings.calls")}</Text>
                <Select
                    nativeID="proxy-calls"
                    label={t("proxySettings.calls")}
                    value={draft.calls}
                    onChange={(calls) => update({ calls })}
                    options={[
                        {
                            value: "default",
                            label: t("proxySettings.callsDefault"),
                        },
                        {
                            value: "direct",
                            label: t("proxySettings.callsDirect"),
                        },
                        {
                            value: "proxy",
                            label: t("proxySettings.callsProxy"),
                        },
                    ]}
                />
                <Text className={hintClass}>
                    {draft.calls === "direct"
                        ? t("proxySettings.callsDirectHint")
                        : draft.calls === "proxy"
                          ? t("proxySettings.callsProxyHint")
                          : t("proxySettings.callsDefaultHint")}
                </Text>
                {bypassUnavailable && (
                    <Text className="text-xs text-discord-warning mt-1">
                        {t("proxySettings.callsDirectUnavailable")}
                    </Text>
                )}
                {info?.calls === "direct" && info.callBypassAddresses.length ? (
                    <Text className={hintClass}>
                        {t("proxySettings.callsDirectAddresses")}{" "}
                        <Text className="text-xs text-discord-textMuted font-mono">
                            {info.callBypassAddresses.join(", ")}
                        </Text>
                    </Text>
                ) : null}
            </View>

            <View className="flex-row items-center gap-3">
                <Pressable
                    accessibilityRole="button"
                    className="px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover disabled:opacity-50"
                    disabled={!dirty || saving}
                    onPress={() => void save()}
                >
                    <Text className="text-sm font-medium text-white">
                        {t("proxySettings.save")}
                    </Text>
                </Pressable>
                {info?.error ? (
                    <Text className="shrink text-xs text-discord-danger">
                        {t("proxySettings.applyFailed", { error: info.error })}
                    </Text>
                ) : saved && !dirty ? (
                    <Text className="shrink text-xs text-discord-textMuted">
                        {t("proxySettings.saved")}
                    </Text>
                ) : null}
                {loadError ? (
                    <Text className="shrink text-xs text-discord-danger">
                        {loadError}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}
