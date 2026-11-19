import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Details } from "@-/com.leonsilicon.zami.rn";
import { t } from "$lib/i18n";
import {
    createTelegramTransport,
    importTelegramStickerSet,
    TelegramApiError,
} from "$lib/matrix/telegramImport";
import { roomsState } from "$lib/stores/rooms.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import { parseStickerSetName } from "$lib/utils/telegramSticker";
import {
    chooseTelegramSource,
    shouldOfferOwnToken,
    telegramProxyConfig,
    TelegramProxyError,
} from "$lib/utils/telegramProxy";

interface Props {
    onImported?: () => void;
}

// Build-time proxy settings. Null when the proxy is turned off.
const proxy = telegramProxyConfig();

// Zami: `space-y-*` (a child selector) doesn't exist in React Native: the
// same `gap-*` spaces the children.
export default function TelegramImport({ onImported }: Props) {
    const [link, setLink] = useState("");
    // Kept in component memory only: never stored, logged, or shown back.
    const [token, setToken] = useState("");
    // With no proxy configured the token is the only route, so open it.
    const [tokenOpen, setTokenOpen] = useState(proxy === null);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<{
        done: number;
        total: number;
    } | null>(null);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const controller = useRef<AbortController | null>(null);

    const percent =
        progress && progress.total > 0
            ? Math.round((progress.done / progress.total) * 100)
            : 0;

    /** Proxy unreachable or key rejected: say so and offer the own-token path. */
    function offerOwnToken() {
        const failure = t("telegramImport.proxyUnavailable");
        setError(failure);
        setTokenOpen(true);
        showErrorToast(failure);
    }

    async function run() {
        setError("");
        setMessage("");
        const setName = parseStickerSetName(link);
        if (!setName) {
            setError(t("telegramImport.invalidLink"));
            return;
        }
        const source = chooseTelegramSource(token, proxy);
        if (!source) {
            setError(t("telegramImport.tokenRequired"));
            setTokenOpen(true);
            return;
        }

        setRunning(true);
        setProgress(null);
        const abort = new AbortController();
        controller.current = abort;
        try {
            const result = await importTelegramStickerSet({
                transport: createTelegramTransport(source),
                setName,
                signal: abort.signal,
                onProgress: (next) => {
                    setProgress(next);
                },
            });
            if (
                shouldOfferOwnToken({
                    mode: source.mode,
                    proxyFailed: result.proxyFailed,
                    imported: result.imported,
                    cancelled: result.cancelled,
                })
            ) {
                offerOwnToken();
                return;
            }
            if (result.total === 0) {
                setMessage(t("telegramImport.empty"));
            } else if (result.cancelled) {
                setMessage(
                    t("telegramImport.cancelled", {
                        imported: result.imported,
                        total: result.total,
                    }),
                );
            } else if (result.failed > 0) {
                setMessage(
                    t("telegramImport.doneWithFailures", {
                        imported: result.imported,
                        total: result.total,
                        failed: result.failed,
                        title: result.title,
                    }),
                );
            } else {
                setMessage(
                    t("telegramImport.done", {
                        imported: result.imported,
                        total: result.total,
                        title: result.title,
                    }),
                );
            }
            if (result.imported > 0) {
                roomsState.roomsTick++;
                onImported?.();
            }
        } catch (err) {
            if (
                err instanceof TelegramProxyError &&
                shouldOfferOwnToken({
                    mode: source.mode,
                    proxyFailed: true,
                    imported: 0,
                    cancelled: abort.signal.aborted,
                })
            ) {
                offerOwnToken();
                return;
            }
            const failure =
                err instanceof TelegramApiError
                    ? t("telegramImport.failed", { message: err.description })
                    : t("telegramImport.failedGeneric");
            setError(failure);
            showErrorToast(failure);
        } finally {
            setRunning(false);
            setProgress(null);
            controller.current = null;
        }
    }

    function cancel() {
        controller.current?.abort();
    }

    // Stop an in-flight import when the settings panel goes away.
    useEffect(() => () => controller.current?.abort(), []);

    return (
        <View className="gap-2 pt-2 border-t border-zam-backgroundTertiary">
            <Text
                accessibilityRole="header"
                className="text-xs font-semibold text-zam-textMuted uppercase tracking-wide"
            >
                {t("telegramImport.title")}
            </Text>
            <Text
                nativeID="telegram-import-link-label"
                className="text-xs text-zam-textMuted"
            >
                {t("telegramImport.linkLabel")}
            </Text>
            <TextInput
                nativeID="telegram-import-link"
                accessibilityLabelledBy="telegram-import-link-label"
                accessibilityLabel={t("telegramImport.linkLabel")}
                value={link}
                onChangeText={setLink}
                editable={!running}
                placeholder={t("telegramImport.linkPlaceholder")}
                placeholderTextColorClassName="accent-zam-textMuted"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                className="w-full bg-zam-backgroundTertiary text-zam-textPrimary text-sm px-3 py-2 rounded outline-none border border-transparent focus:border-zam-accent/50"
            />

            <Details
                className="gap-2"
                open={tokenOpen}
                onToggle={setTokenOpen}
                summary={t("telegramImport.useOwnToken")}
                summaryTextClassName="text-xs text-zam-textMuted"
            >
                <View className="gap-2 pt-2">
                    <Text
                        nativeID="telegram-import-token-label"
                        className="text-xs text-zam-textMuted"
                    >
                        {t("telegramImport.tokenLabel")}
                    </Text>
                    <TextInput
                        nativeID="telegram-import-token"
                        accessibilityLabelledBy="telegram-import-token-label"
                        accessibilityLabel={t("telegramImport.tokenLabel")}
                        secureTextEntry
                        value={token}
                        onChangeText={setToken}
                        editable={!running}
                        placeholder={t("telegramImport.tokenPlaceholder")}
                        placeholderTextColorClassName="accent-zam-textMuted"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect={false}
                        spellCheck={false}
                        className="w-full bg-zam-backgroundTertiary text-zam-textPrimary text-sm px-3 py-2 rounded outline-none border border-transparent focus:border-zam-accent/50"
                    />
                    <Text className="text-xs text-zam-textMuted">
                        {t("telegramImport.tokenHelp")}
                    </Text>
                </View>
            </Details>

            <View className="flex-row items-center gap-2">
                <Pressable
                    accessibilityRole="button"
                    onPress={() => void run()}
                    disabled={running}
                    accessibilityState={{ disabled: running }}
                    className="px-3 py-2 rounded bg-zam-accent disabled:opacity-50"
                >
                    <Text className="text-white text-sm font-semibold">
                        {running
                            ? t("telegramImport.importing")
                            : t("telegramImport.import")}
                    </Text>
                </Pressable>
                {running && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={cancel}
                        className="px-3 py-2 rounded hover:bg-zam-messageHover active:bg-zam-messageHover"
                    >
                        <Text className="text-sm text-zam-textMuted">
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                )}
            </View>

            {progress && (
                <>
                    <View
                        className="h-2 rounded bg-zam-backgroundTertiary overflow-hidden"
                        accessibilityRole="progressbar"
                        accessibilityValue={{
                            min: 0,
                            max: progress.total,
                            now: progress.done,
                        }}
                    >
                        <View
                            className="h-full bg-zam-accent"
                            style={{ width: `${percent}%` }}
                        />
                    </View>
                    <Text className="text-xs text-zam-textMuted">
                        {t("telegramImport.progress", {
                            done: progress.done,
                            total: progress.total,
                        })}
                    </Text>
                </>
            )}

            {error ? (
                <Text className="text-sm text-zam-danger">{error}</Text>
            ) : null}
            {message ? (
                <Text className="text-sm text-zam-textPrimary">{message}</Text>
            ) : null}
        </View>
    );
}
