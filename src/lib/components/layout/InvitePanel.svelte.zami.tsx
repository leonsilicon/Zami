import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { t } from "$lib/i18n";
import UserPicker from "$lib/components/ui/UserPicker.svelte";
import { Check, X } from "lucide-svelte";
import {
    inviteUser,
    getRoomMemberIds,
    getRoom,
    inviteEmailToRoom,
    getIdentityServer,
} from "$lib/matrix/client";
import { matrixErrorMessage } from "$lib/utils/knock";
import {
    isValidEmail,
    getThreePidInviteState,
} from "$lib/utils/threePidInvite";

export default function InvitePanel({
    roomId,
    onClose,
}: {
    roomId: string;
    onClose?: () => void;
}) {
    const room = getRoom(roomId);
    const isSpace = room?.isSpaceRoom() ?? false;
    // Effectively a snapshot: roomId is the only reactive dependency and it is
    // stable for the dialog's life, so membership changes over sync don't reshuffle it.
    const excludeUserIds = useMemo(() => getRoomMemberIds(roomId), [roomId]);

    const [selected, setSelected] = useState<string[]>([]);
    const [inviting, setInviting] = useState(false);
    const [outcomes, setOutcomes] = useState<
        { userId: string; ok: boolean; error?: string }[]
    >([]);

    const emailState = getThreePidInviteState({
        hasIdentityServer: !!getIdentityServer(),
        canInvite: true,
    });

    const [emailAddress, setEmailAddress] = useState("");
    const [emailInviting, setEmailInviting] = useState(false);
    const [emailError, setEmailError] = useState("");
    const [emailOutcome, setEmailOutcome] = useState<{
        ok: boolean;
        address: string;
        error?: string;
    } | null>(null);

    async function doEmailInvite() {
        if (emailInviting) return;
        const addr = emailAddress.trim();
        if (!isValidEmail(addr)) {
            setEmailError(t("invitePanel.enterAValidEmailAddress"));
            return;
        }
        setEmailError("");
        setEmailInviting(true);
        try {
            await inviteEmailToRoom(roomId, addr);
            setEmailOutcome({ ok: true, address: addr });
            setEmailAddress("");
        } catch (e) {
            setEmailOutcome({
                ok: false,
                address: addr,
                error: matrixErrorMessage(
                    e,
                    t("invitePanel.couldNotSendTheEmailInvite"),
                ),
            });
        }
        setEmailInviting(false);
    }

    async function doInvite() {
        if (!selected.length || inviting) return;
        setInviting(true);
        const done: { userId: string; ok: boolean; error?: string }[] = [];
        for (const userId of selected) {
            try {
                await inviteUser(roomId, userId);
                done.push({ userId, ok: true });
            } catch (e) {
                done.push({
                    userId,
                    ok: false,
                    error: matrixErrorMessage(
                        e,
                        t("invitePanel.couldNotSendTheInvite"),
                    ),
                });
            }
        }
        setOutcomes(done);
        // Keep only the ones that failed, so the user can retry them.
        setSelected(done.filter((d) => !d.ok).map((d) => d.userId));
        setInviting(false);
    }

    return (
        <View className="gap-3">
            <Text className="text-sm text-discord-textSecondary">
                {t("invitePanel.invitePeopleTo")}{" "}
                <Text className="text-discord-textPrimary font-medium">
                    {room?.name ??
                        (isSpace
                            ? t("invitePanel.thisSpace")
                            : t("invitePanel.thisRoom"))}
                </Text>
                .
            </Text>

            <UserPicker
                mode="multi"
                selected={selected}
                onSelectedChange={setSelected}
                excludeUserIds={excludeUserIds}
                autofocus
            />

            {outcomes.length ? (
                <View accessibilityRole="list" className="gap-1">
                    {outcomes.map((o) => (
                        <View
                            key={o.userId}
                            className="flex-row items-center gap-2"
                        >
                            <View
                                accessible
                                accessibilityRole="image"
                                accessibilityLabel={
                                    o.ok
                                        ? t("invitePanel.invited")
                                        : t("invitePanel.failed")
                                }
                                className="flex-row items-center"
                            >
                                {o.ok ? (
                                    <Check
                                        size={14}
                                        className="text-discord-textPositive"
                                    />
                                ) : (
                                    <X
                                        size={14}
                                        className="text-discord-danger"
                                    />
                                )}
                            </View>
                            <Text
                                numberOfLines={1}
                                className="shrink text-sm text-discord-textSecondary"
                            >
                                {o.userId}
                            </Text>
                            {!o.ok && o.error ? (
                                <Text
                                    numberOfLines={1}
                                    className="shrink text-sm text-discord-textMuted"
                                >
                                    - {o.error}
                                </Text>
                            ) : null}
                        </View>
                    ))}
                </View>
            ) : null}

            <View className="border-t border-discord-backgroundTertiary pt-3 gap-2">
                <Text className="text-xs font-semibold uppercase text-discord-textMuted">
                    {t("invitePanel.inviteByEmail")}
                </Text>
                {emailState.available ? (
                    <>
                        <View className="flex-row gap-2">
                            {/* Zami: `type="email"` → the email keyboard, with
                                no autocapitalization or autocorrect. */}
                            <TextInput
                                value={emailAddress}
                                onChangeText={setEmailAddress}
                                placeholder={t("invitePanel.nameExampleCom")}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                accessibilityLabel={t(
                                    "invitePanel.inviteByEmail",
                                )}
                                onSubmitEditing={() => void doEmailInvite()}
                                submitBehavior="submit"
                                returnKeyType="send"
                                keyboardType="email-address"
                                autoComplete="email"
                                textContentType="emailAddress"
                                autoCapitalize="none"
                                autoCorrect={false}
                                className="flex-1 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 border border-transparent focus:border-discord-accent/50"
                            />
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => void doEmailInvite()}
                                disabled={!emailAddress.trim() || emailInviting}
                                accessibilityState={{
                                    disabled:
                                        !emailAddress.trim() || emailInviting,
                                }}
                                className="justify-center px-4 py-2 bg-discord-accent hover:bg-discord-accentHover active:bg-discord-accentHover rounded transition-colors disabled:opacity-50"
                            >
                                <Text className="text-white font-medium text-sm">
                                    {emailInviting
                                        ? t("invitePanel.inviting")
                                        : t("invitePanel.invite")}
                                </Text>
                            </Pressable>
                        </View>
                        {emailError ? (
                            <Text className="text-xs text-discord-danger">
                                {emailError}
                            </Text>
                        ) : null}
                        {emailOutcome ? (
                            <View className="flex-row items-center gap-2">
                                <View
                                    accessible
                                    accessibilityRole="image"
                                    accessibilityLabel={
                                        emailOutcome.ok
                                            ? t("invitePanel.invited")
                                            : t("invitePanel.failed")
                                    }
                                    className="flex-row items-center"
                                >
                                    {emailOutcome.ok ? (
                                        <Check
                                            size={14}
                                            className="text-discord-textPositive"
                                        />
                                    ) : (
                                        <X
                                            size={14}
                                            className="text-discord-danger"
                                        />
                                    )}
                                </View>
                                <Text
                                    numberOfLines={1}
                                    className="shrink text-sm text-discord-textSecondary"
                                >
                                    {emailOutcome.address}
                                </Text>
                                {!emailOutcome.ok && emailOutcome.error ? (
                                    <Text
                                        numberOfLines={1}
                                        className="shrink text-sm text-discord-textMuted"
                                    >
                                        - {emailOutcome.error}
                                    </Text>
                                ) : null}
                            </View>
                        ) : null}
                    </>
                ) : (
                    <Text className="text-sm text-discord-textMuted">
                        {emailState.reason}
                    </Text>
                )}
            </View>

            <View className="flex-row justify-end gap-2">
                {onClose ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={onClose}
                        className="px-4 py-2"
                    >
                        <Text className="text-sm text-discord-textSecondary hover:text-discord-textPrimary transition-colors">
                            {t("common.close")}
                        </Text>
                    </Pressable>
                ) : null}
                <Pressable
                    accessibilityRole="button"
                    onPress={() => void doInvite()}
                    disabled={!selected.length || inviting}
                    accessibilityState={{
                        disabled: !selected.length || inviting,
                    }}
                    className="px-4 py-2 bg-discord-accent hover:bg-discord-accentHover active:bg-discord-accentHover rounded transition-colors disabled:opacity-50"
                >
                    <Text className="text-white font-medium text-sm">
                        {inviting
                            ? t("invitePanel.inviting")
                            : selected.length > 1
                              ? t("invitePanel.invite2", {
                                    length: selected.length,
                                })
                              : t("invitePanel.invite")}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}
