import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useEffect } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { t } from "$lib/i18n";
import InvitePanel from "./InvitePanel.svelte";
import { closeModal } from "$lib/stores/interface.svelte";

export default function InviteModal({ roomId }: { roomId: string }) {
    // The focus trap's Escape, as Android's back button.
    useEffect(() => {
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                closeModal();
                return true;
            },
        );
        return () => subscription.remove();
    }, []);

    // Zam's layer is `position: fixed`; here it is rendered at the app root
    // through a Portal. The keyboard view keeps the panel (and its search
    // field) above the on-screen keyboard; the backdrop stays full-screen.
    return (
        <Portal>
            <View pointerEvents="box-none" className="absolute inset-0 z-50">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.closeDialog")}
                    className="absolute inset-0 bg-black/60"
                    onPress={closeModal}
                />
                <KeyboardAvoidingView
                    behavior="padding"
                    pointerEvents="box-none"
                    style={StyleSheet.absoluteFill}
                >
                    <View
                        pointerEvents="box-none"
                        className="flex-1 flex-row items-center justify-center"
                    >
                        <View
                            role="dialog"
                            accessibilityViewIsModal
                            aria-labelledby="invite-modal-title"
                            onAccessibilityEscape={closeModal}
                            className="relative z-10 shrink bg-discord-background rounded-lg shadow-xl w-full max-w-md mx-4 p-6 flex flex-col gap-4"
                        >
                            <Text
                                nativeID="invite-modal-title"
                                role="heading"
                                className="text-lg font-bold text-discord-textPrimary"
                            >
                                {t("common.invitePeople")}
                            </Text>
                            <InvitePanel roomId={roomId} onClose={closeModal} />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </View>
        </Portal>
    );
}
