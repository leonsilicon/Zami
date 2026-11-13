import { Checkbox } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "$lib/i18n";
// Asks before a call opens peer-to-peer connections, which show the
// user's IP address to the other end (stores/meshConsent). Rendered once
// in AppShell.
import ModalDialog from "$lib/components/ui/ModalDialog.svelte";
import {
    meshConsentState,
    resolveMeshConsent,
} from "$lib/stores/meshConsent.svelte";
import { settingsState, setMeshPublicStun } from "$lib/stores/settings.svelte";

export default function MeshConsentDialog() {
    const pending = useRune(() => meshConsentState.pending);
    const meshRelayOnly = useRune(() => settingsState.meshRelayOnly);
    const meshPublicStun = useRune(() => settingsState.meshPublicStun);
    /** Through a TURN relay: by default when the homeserver has one, and
     *  always when the user requires it (no relay then means no connection). */
    const relayOnly = !!pending?.relayed || meshRelayOnly;
    /** The public STUN choice, saved only when the user connects. */
    const [publicStun, setPublicStun] = useState(false);
    useEffect(() => {
        if (pending) setPublicStun(meshPublicStun);
    }, [pending, meshPublicStun]);
    const allow = () => {
        if (pending?.offerPublicStun && !relayOnly)
            setMeshPublicStun(publicStun);
        resolveMeshConsent("allow");
    };
    /** Closing the dialog takes the choice that opens nothing. */
    const dismiss = () =>
        resolveMeshConsent(pending?.joining ? "cancel" : "deny");

    useEffect(() => {
        // A request left over from a session that ended in place.
        resolveMeshConsent("cancel");
    }, []);

    if (!pending) return null;
    return (
        <ModalDialog
            onClose={dismiss}
            labelledBy="mesh-consent-title"
            panelClass="relative z-10 w-[min(30rem,calc(100vw-2rem))] rounded-lg bg-discord-backgroundSecondary p-5 shadow-xl"
        >
            <Text
                nativeID="mesh-consent-title"
                role="heading"
                className="mb-2 text-lg font-semibold text-discord-textPrimary"
            >
                {pending.fileTransfer
                    ? t("meshConsent.titleFileTransfer")
                    : pending.joining
                      ? t("meshConsent.titleJoining")
                      : t("meshConsent.titleNewcomer")}
            </Text>
            <Text className="mb-3 text-sm text-discord-textMuted">
                {pending.fileTransfer
                    ? t("meshConsent.fileTransferDirect")
                    : pending.publishing
                      ? t("meshConsent.noCallServer")
                      : t("meshConsent.someoneWithoutCallServer")}
            </Text>
            {relayOnly ? (
                <Text className="mb-3 rounded border border-discord-divider px-3 py-2 text-sm text-discord-textMuted">
                    {pending.relayed
                        ? t("meshConsent.relayed")
                        : t("meshConsent.relayRequired")}
                </Text>
            ) : (
                <Text
                    className="mb-3 rounded border border-discord-danger/40 bg-discord-danger/10 px-3 py-2 text-sm text-discord-danger"
                    accessibilityRole="alert"
                >
                    {t("meshConsent.ipVisible")}
                </Text>
            )}
            {pending.offerPublicStun && !relayOnly && (
                <Checkbox
                    checked={publicStun}
                    onChange={setPublicStun}
                    className="mb-3 items-start gap-2"
                    inputClassName="mt-0.5 h-3.5 w-3.5 rounded-sm"
                    label={
                        <Text className="flex-1 text-sm text-discord-textMuted">
                            <Text className="font-medium text-discord-textPrimary">
                                {t("meshConsent.usePublicStun")}
                            </Text>{" "}
                            {t("meshConsent.usePublicStunHint")}
                        </Text>
                    }
                    accessibilityLabel={t("meshConsent.usePublicStun")}
                />
            )}
            <View className="mt-4 flex-row flex-wrap justify-end gap-2">
                {pending.joining && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => resolveMeshConsent("cancel")}
                        className="rounded px-4 py-2"
                    >
                        <Text className="text-sm font-medium text-discord-textSecondary hover:text-discord-textPrimary hover:underline transition-colors">
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                )}
                {!pending.publishing && (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => resolveMeshConsent("deny")}
                        className="rounded px-4 py-2"
                    >
                        <Text className="text-sm font-medium text-discord-textSecondary hover:text-discord-textPrimary hover:underline transition-colors">
                            {pending.joining
                                ? t("meshConsent.joinWithoutThem")
                                : t("meshConsent.notNow")}
                        </Text>
                    </Pressable>
                )}
                <Pressable
                    accessibilityRole="button"
                    onPress={allow}
                    className="rounded bg-discord-accent px-4 py-2 hover:opacity-90"
                >
                    <Text className="text-sm font-medium text-white">
                        {pending.joining &&
                        pending.publishing &&
                        !pending.fileTransfer
                            ? t("meshConsent.join")
                            : t("meshConsent.connectDirectly")}
                    </Text>
                </Pressable>
            </View>
        </ModalDialog>
    );
}
