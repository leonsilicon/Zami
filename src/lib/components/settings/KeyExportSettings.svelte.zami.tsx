import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
// Zami: expo-file-system's File reads (`.text()`) like the web's, and writes the export.
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { t } from "$lib/i18n";
// Export / import room keys as a passphrase-encrypted key file (the format
// Element and other clients use; see utils/keyExportFile). Lives under
// Security & Encryption, next to key backup, which covers the same ground
// server-side.
import {
    exportRoomKeysToFile,
    importRoomKeysFromFile,
} from "$lib/matrix/crypto";
import { KeyExportFileError } from "$lib/utils/keyExportFile";
import {
    restoreProgressView,
    restoreResultLabel,
    type RestoreProgress,
} from "$lib/utils/keyBackup";

const inputClass =
    "w-full rounded bg-discord-backgroundSecondary px-3 py-2 text-sm text-discord-textPrimary outline-none focus:ring-2 focus:ring-discord-accent";
// Zami: the button's text classes are on its Text (`buttonTextClass`).
const buttonClass =
    "self-start px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-50";
const buttonTextClass = "text-sm font-medium text-white";
// Zami: how much of an export file one write takes (it's ASCII, so as many
// bytes).
const EXPORT_WRITE_CHARS = 1024 * 1024;

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead.
export default function KeyExportSettings() {
    // ── Export ──
    const [exportPass, setExportPass] = useState("");
    const [exportConfirm, setExportConfirm] = useState("");
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState("");
    const [exportDone, setExportDone] = useState("");
    const mismatch = exportConfirm.length > 0 && exportPass !== exportConfirm;

    async function doExport() {
        if (exporting || !exportPass || exportPass !== exportConfirm) return;
        setExporting(true);
        setExportError("");
        setExportDone("");
        try {
            const { file, count } = await exportRoomKeysToFile(exportPass);
            // Zami: the web saves a blob URL as a download; here the file is
            // written to the cache and offered through the share sheet (Save to
            // Files, AirDrop, …), then removed.
            const day = new Date().toISOString().slice(0, 10);
            const saved = new File(Paths.cache, `zam-keys-${day}.txt`);
            saved.create({ overwrite: true });
            // Zami: a large account's file is tens of MB, and each write hands
            // its text to native code on the JS thread: it's written a megabyte
            // at a time.
            for (let at = 0; at < file.length; at += EXPORT_WRITE_CHARS) {
                await saved.write(file.slice(at, at + EXPORT_WRITE_CHARS), {
                    append: at > 0,
                });
            }
            await Sharing.shareAsync(saved.uri, {
                mimeType: "text/plain",
                UTI: "public.plain-text",
                dialogTitle: t("keyExportSettings.exportKeys"),
            });
            saved.delete();
            setExportDone(t("keyExportSettings.exported", { count }));
            setExportPass("");
            setExportConfirm("");
        } catch (err) {
            console.error("Key export failed:", err);
            setExportError(t("keyExportSettings.couldNotExportYourKeys"));
        } finally {
            setExporting(false);
        }
    }

    // ── Import ──
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importPass, setImportPass] = useState("");
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState("");
    const [importDone, setImportDone] = useState("");
    const [progress, setProgress] = useState<RestoreProgress | null>(null);
    const progressView = restoreProgressView(progress);

    function importErrorMessage(err: unknown): string {
        if (err instanceof KeyExportFileError) {
            if (err.reason === "passphrase")
                return t("keyExportSettings.wrongPassphrase");
            if (err.reason === "version")
                return t("keyExportSettings.newerFormat");
            return t("keyExportSettings.notAKeyFile");
        }
        return t("keyExportSettings.couldNotImportTheKeys");
    }

    async function doImport() {
        if (importing || !importFile || !importPass) return;
        setImporting(true);
        setImportError("");
        setImportDone("");
        setProgress(null);
        let last: RestoreProgress | null = null;
        try {
            const text = await importFile.text();
            await importRoomKeysFromFile(text, importPass, (p) => {
                setProgress(p);
                last = p;
            });
            const done = last as RestoreProgress | null;
            setImportDone(
                done && done.stage === "load_keys"
                    ? restoreResultLabel({
                          total: done.total,
                          imported: done.successes,
                      })
                    : restoreResultLabel({ total: 0, imported: 0 }),
            );
            setImportPass("");
        } catch (err) {
            console.error("Key import failed:", err);
            setImportError(importErrorMessage(err));
        } finally {
            setImporting(false);
            setProgress(null);
        }
    }

    // Zami: <input type="file"> → expo-document-picker. The picked file is
    // copied into the cache, where expo-file-system's File reads it.
    async function pickImportFile() {
        const result = await DocumentPicker.getDocumentAsync({
            type: "text/plain",
            copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        setImportFile(new File(result.assets[0].uri));
        setImportError("");
        setImportDone("");
    }

    return (
        <View className="rounded bg-discord-backgroundTertiary px-4 py-4 gap-4">
            <View>
                <Text className="text-sm font-medium text-discord-textPrimary">
                    {t("keyExportSettings.exportOrImportRoomKeys")}
                </Text>
                <Text className="text-xs text-discord-textMuted mt-1">
                    {t("keyExportSettings.aKeyFileLetsAnotherApp")}
                </Text>
            </View>

            <View className="gap-2">
                <Text className="text-xs font-bold uppercase text-discord-textSecondary tracking-wide">
                    {t("keyExportSettings.export")}
                </Text>
                <TextInput
                    secureTextEntry
                    value={exportPass}
                    onChangeText={setExportPass}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={t("keyExportSettings.passphrase")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityLabel={t("keyExportSettings.passphrase")}
                    returnKeyType="next"
                    className={inputClass}
                />
                <TextInput
                    secureTextEntry
                    value={exportConfirm}
                    onChangeText={setExportConfirm}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={t("keyExportSettings.confirmPassphrase")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityLabel={t(
                        "keyExportSettings.confirmPassphrase",
                    )}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                        doExport();
                    }}
                    className={inputClass}
                />
                {mismatch && (
                    <Text className="text-xs text-discord-danger">
                        {t("keyExportSettings.passphrasesDontMatch")}
                    </Text>
                )}
                <Pressable
                    accessibilityRole="button"
                    disabled={
                        exporting || !exportPass || exportPass !== exportConfirm
                    }
                    onPress={() => {
                        doExport();
                    }}
                    className={buttonClass}
                >
                    <Text className={buttonTextClass}>
                        {exporting
                            ? t("keyExportSettings.exporting")
                            : t("keyExportSettings.exportKeys")}
                    </Text>
                </Pressable>
                {exportDone ? (
                    <Text className="text-sm text-discord-online" role="status">
                        {exportDone}
                    </Text>
                ) : null}
                {exportError ? (
                    <Text className="text-sm text-discord-danger" role="alert">
                        {exportError}
                    </Text>
                ) : null}
            </View>

            <View className="gap-2">
                <Text className="text-xs font-bold uppercase text-discord-textSecondary tracking-wide">
                    {t("keyExportSettings.import")}
                </Text>
                {/* Zami: the file input's own button (`file:` classes) and the
                    chosen file's name, which the browser draws. */}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("keyExportSettings.keyFile")}
                    onPress={() => {
                        pickImportFile();
                    }}
                    className="flex-row items-center w-full"
                >
                    <View className="me-3 rounded bg-discord-messageHover px-3 py-1.5">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("midiSoundBank.chooseFile")}
                        </Text>
                    </View>
                    <Text
                        numberOfLines={1}
                        className="flex-1 text-sm text-discord-textMuted"
                    >
                        {importFile?.name ?? t("keyExportSettings.keyFile")}
                    </Text>
                </Pressable>
                <TextInput
                    secureTextEntry
                    value={importPass}
                    onChangeText={setImportPass}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={t("keyExportSettings.passphrase")}
                    placeholderTextColorClassName="accent-discord-textMuted"
                    accessibilityLabel={t("keyExportSettings.passphrase")}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                        doImport();
                    }}
                    className={inputClass}
                />
                <Pressable
                    accessibilityRole="button"
                    disabled={importing || !importFile || !importPass}
                    onPress={() => {
                        doImport();
                    }}
                    className={buttonClass}
                >
                    <Text className={buttonTextClass}>
                        {importing
                            ? progressView.label
                            : t("keyExportSettings.importKeys")}
                    </Text>
                </Pressable>
                {importing && progressView.percent !== null && (
                    <View className="h-1.5 w-full rounded bg-discord-backgroundSecondary overflow-hidden">
                        <View
                            className="h-full bg-discord-accent transition-[width]"
                            style={{ width: `${progressView.percent}%` }}
                        />
                    </View>
                )}
                {importDone ? (
                    <Text className="text-sm text-discord-online" role="status">
                        {importDone}
                    </Text>
                ) : null}
                {importError ? (
                    <Text className="text-sm text-discord-danger" role="alert">
                        {importError}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}
