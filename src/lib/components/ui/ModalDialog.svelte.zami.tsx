import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useEffect, useEffectEvent, type ReactNode } from "react";
import { BackHandler, Pressable, StyleSheet, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { Easing, FadeIn, Keyframe } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "$lib/i18n";
import { motionOK } from "$lib/utils/motionPreference";

interface Props {
    /** Dismiss the dialog. Wired to the backdrop and (by default) Escape. */
    onClose: () => void;
    /**
     * id of the element that names the dialog — normally its `<h2>`.
     * Prefer this over `label` whenever there is a visible title.
     */
    labelledBy?: string;
    /** Accessible name for a dialog with no visible title element. */
    label?: string;
    /**
     * Set false for a dialog with internal navigation state that AppShell's
     * global `dismissTopmost()` must pop first — the AppSettings /
     * RoomSettings precedent. The trap then lets Escape bubble.
     */
    handlesEscape?: boolean;
    /** Extra classes for the full-viewport layer (positioning of children). */
    layerClass?: string;
    /** Backdrop skin. Pass "" for an invisible click-catcher. */
    backdropClass?: string;
    /**
     * The panel's own classes — sizing, skin AND its position utility.
     * Deliberately not defaulted to a position utility beyond `relative`:
     * `relative` and `absolute` are the same Tailwind group, so a baked-in
     * one would fight a caller's override on CSS source order rather than
     * attribute order.
     */
    panelClass?: string;
    /** Accessible name of the backdrop close control. */
    closeLabel?: string;
    /**
     * Key handler on the panel, for dialogs that submit on Enter. Escape
     * does NOT reach it while `handlesEscape` is true: the trap calls
     * `stopPropagation()` and Svelte delegates `keydown`, so the delegated
     * listener never runs for that key. Handle Escape via `onClose`.
     */
    onKeydown?: (event: KeyboardEvent) => void;
    children?: ReactNode;
}

// Svelte's `scale` transition with `start: 0.96, opacity: 0` (cubicOut).
function scaleIn(duration: number) {
    return new Keyframe({
        0: { opacity: 0, transform: [{ scale: 0.96 }] },
        100: {
            opacity: 1,
            transform: [{ scale: 1 }],
            easing: Easing.out(Easing.cubic),
        },
    }).duration(duration);
}

// Zami: `onKeydown` (Enter to submit) has no iOS equivalent; text inputs submit with
// `onSubmitEditing` in the caller. Escape is Android's back button and VoiceOver's
// escape gesture here.
export default function ModalDialog({
    onClose,
    labelledBy = undefined,
    label = undefined,
    handlesEscape = true,
    layerClass = "z-50 flex items-center justify-center",
    backdropClass = "bg-black/60",
    panelClass = "relative",
    closeLabel = t("common.closeDialog"),
    children,
}: Props) {
    // The focus trap's Escape, as Android's back button. Only while
    // `handlesEscape`: otherwise the back press reaches whatever registered
    // before this dialog (AppShell's `dismissTopmost()` precedent).
    const onEscape = useEffectEvent(() => onClose());
    useEffect(() => {
        if (!handlesEscape) return;
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                onEscape();
                return true;
            },
        );
        return () => subscription.remove();
    }, [handlesEscape]);

    const duration = motionOK() ? 150 : 0;
    // Zami: the viewport a browser lays the panel out in excludes the status
    // bar, the notch and the home indicator; here the layer is the whole
    // screen, so the panel is laid out within the safe area.
    const insets = useSafeAreaInsets();

    // Zam's layer is `position: fixed`; here it is rendered at the app root
    // through the Portal, as an absolute-fill layer. Only the layer's z-index
    // classes go on it: it is what orders this dialog among the other layers
    // there.
    const layerZ = layerClass
        .split(/\s+/)
        .filter((c) => /^-?z-/.test(c))
        .join(" ");

    return (
        <Portal>
            {/*
              The one shared dialog shell, extracted from the idiom nine dialogs already
              hand-roll correctly (InviteModal, CreatePollDialog, …): a full-viewport
              layer, a backdrop button that is a SIBLING of the panel, and a panel
              carrying the dialog's role, modality and name.
            */}
            <View
                pointerEvents="box-none"
                className={`absolute inset-0 ${layerZ}`}
            >
                {/*
                  The backdrop comes first, so the panel paints above it whatever
                  `panelClass` says (upstream sends it to `-z-10` for the same
                  reason). It fills the whole layer, under the keyboard too.
                */}
                <Animated.View
                    entering={duration ? FadeIn.duration(duration) : undefined}
                    pointerEvents="box-none"
                    className={`absolute inset-0 ${backdropClass}`}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={closeLabel}
                        className="absolute inset-0"
                        onPress={onClose}
                    />
                </Animated.View>
                {/*
                  `layerClass` positions the panel within the layer, as on the web,
                  where the layer is a `flex` row. The keyboard view keeps a dialog
                  with a text input above the on-screen keyboard: it pads the layer's
                  bottom by the keyboard's height, so the panel recentres in what is
                  left.
                */}
                <KeyboardAvoidingView
                    behavior="padding"
                    pointerEvents="box-none"
                    style={StyleSheet.absoluteFill}
                >
                    <View
                        pointerEvents="box-none"
                        style={{
                            flex: 1,
                            paddingTop: insets.top,
                            paddingBottom: insets.bottom,
                            paddingLeft: insets.left,
                            paddingRight: insets.right,
                        }}
                    >
                        <View
                            pointerEvents="box-none"
                            className={`flex-1 flex-row ${layerClass}`}
                        >
                            {/*
                          `shrink`: a web flex item shrinks to fit by default, so a
                          `w-full mx-4` panel keeps its margins; React Native's
                          don't.
                        */}
                            <Animated.View
                                role="dialog"
                                accessibilityViewIsModal
                                aria-labelledby={labelledBy}
                                accessibilityLabel={label}
                                onAccessibilityEscape={
                                    handlesEscape ? onClose : undefined
                                }
                                entering={
                                    duration ? scaleIn(duration) : undefined
                                }
                                className={`z-10 shrink ${panelClass}`}
                            >
                                {children}
                            </Animated.View>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </View>
        </Portal>
    );
}
