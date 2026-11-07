import {
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type Ref,
} from "react";
import {
    Pressable,
    Text,
    TextInput,
    View,
    type HostInstance,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useResolveClassNames } from "uniwind";
import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import { deleteMessage } from "$lib/matrix/client";
import {
    clearModalIfOwner,
    closeModal,
    interfaceState,
    openModal,
} from "$lib/stores/interface.svelte";
import { normalizeRedactionReason } from "$lib/utils/redaction";
import { matrixErrorMessage } from "$lib/utils/knock";

/** Zami: what `bind:this` gave upstream's parent (`redactComp?.show()`), through `ref`. */
export interface MessageRedactActionHandle {
    show: () => void;
}

interface Props {
    roomId: string;
    eventId: string;
    keyboardOffset: number;
    open?: boolean;
    /** Zami: the write half of `bind:open`. */
    onOpenChange?: (open: boolean) => void;
    /**
     * Render the inline trigger button. False on touch, where the mobile
     * overflow sheet drives this dialog via the exported `show()` instead —
     * the component then renders only its dialog.
     */
    showTrigger?: boolean;
    ref?: Ref<MessageRedactActionHandle>;
}

export default function MessageRedactAction({
    roomId,
    eventId,
    keyboardOffset,
    open: openProp,
    onOpenChange,
    showTrigger = true,
    ref,
}: Props) {
    // Zami: `open = $bindable(false)`: the parent's value when it passes one,
    // else this component's own.
    const [ownOpen, setOwnOpen] = useState(false);
    const open = openProp ?? ownOpen;
    function setOpen(value: boolean) {
        setOwnOpen(value);
        onOpenChange?.(value);
    }
    // Zami: `open` as of the last render, for the delete that outlives one.
    const openRef = useRef(open);
    useEffect(() => {
        openRef.current = open;
    });
    // Zami: only the open dialog reads it, so a closed one (one per timeline
    // row on touch) subscribes to nothing.
    const isTouchscreen = useRune(
        () => (open ? interfaceState.isTouchscreen : false),
        [open],
    );

    const buttonEl = useRef<HostInstance>(null);
    const [below, setBelow] = useState(false);
    const [reason, setReason] = useState("");
    const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
    const [error, setError] = useState("");
    const token = useRef(0);

    function show() {
        // Zami: measured asynchronously, so `below` settles just after the
        // dialog opens (only the desktop dialog reads it).
        setBelow(false);
        buttonEl.current?.measureInWindow((_x, top) => setBelow(top < 400));
        // Claim first - a same-id handover runs the outgoing close.
        token.current = openModal("redact-message", () => setOpen(false));
        setReason("");
        setStatus("idle");
        setError("");
        setOpen(true);
        // Zami: the textarea mounts with the dialog, so its `autoFocus` stands
        // in for focusing it on the next tick.
    }
    useImperativeHandle(ref, () => ({ show }));

    async function submit() {
        if (status === "sending") return;
        setStatus("sending");
        setError("");
        try {
            await deleteMessage(
                roomId,
                eventId,
                normalizeRedactionReason(reason),
            );
            if (openRef.current) closeModal();
        } catch (deleteError) {
            setStatus("error");
            setError(
                matrixErrorMessage(
                    deleteError,
                    t("messageRedactAction.failedToRemoveMessage"),
                ),
            );
        }
    }

    // Zami: not ported: closing the desktop dialog on a mousedown outside it
    // (a `document` listener). Touch closes it with the backdrop, as upstream.

    // Zami: onDestroy. `token` holds the latest claim, as upstream's plain `let` does.
    useEffect(() => () => void clearModalIfOwner(token.current), []);

    const dialog = open && (
        <View
            className={`${
                isTouchscreen
                    ? "absolute start-2 end-2 z-50"
                    : below
                      ? "absolute top-full end-0 mt-1 z-50 w-72"
                      : "absolute bottom-full end-0 mb-1 z-50 w-72"
            } bg-discord-backgroundTertiary border border-discord-divider rounded-lg shadow-xl p-3`}
            style={isTouchscreen ? { bottom: keyboardOffset + 8 } : undefined}
        >
            <Text className="text-xs font-semibold uppercase text-discord-textMuted mb-2">
                {t("messageRedactAction.removeThisMessage")}
            </Text>
            <TextInput
                autoFocus
                multiline
                value={reason}
                onChangeText={setReason}
                placeholder={t("common.reasonOptional")}
                placeholderTextColorClassName="accent-discord-textMuted"
                editable={status !== "sending"}
                textAlignVertical="top"
                // Zami: `rows="2"`: two 20px lines, the padding and the border.
                className="w-full min-h-[58px] resize-none rounded bg-discord-backgroundSecondary border border-discord-divider p-2 text-sm text-discord-textPrimary focus:outline-none focus:border-discord-accent"
            />
            {status === "error" && (
                <Text className="text-xs text-discord-danger mt-2">
                    {error}
                </Text>
            )}
            <View className="flex-row justify-end gap-2 mt-2">
                <Pressable
                    accessibilityRole="button"
                    onPress={closeModal}
                    className="px-2 py-1 rounded hover:bg-discord-messageHover transition-colors"
                >
                    <Text className="text-xs font-semibold text-discord-textMuted hover:text-discord-textPrimary">
                        {t("common.cancel")}
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: status === "sending" }}
                    onPress={() => void submit()}
                    disabled={status === "sending"}
                    className="px-2 py-1 rounded bg-discord-danger hover:bg-discord-dangerHover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Text className="text-xs font-semibold text-white">
                        {status === "sending"
                            ? t("messageRedactAction.removing")
                            : t("common.remove")}
                    </Text>
                </Pressable>
            </View>
        </View>
    );

    return (
        <View className="relative">
            {/*
                `data-message-action` enlists this trigger in MessageItem's roving
                toolbar (the bar's arrow-key navigation); the popover's own controls
                stay out of it deliberately.
                Zami: not ported: `data-message-action` (arrow-key navigation).
            */}
            {showTrigger && (
                <Pressable
                    ref={buttonEl}
                    accessibilityRole="button"
                    accessibilityLabel={t("messageRedactAction.removeMessage")}
                    accessibilityState={{ expanded: open }}
                    onPress={() => (open ? closeModal() : show())}
                    className="p-1.5 rounded hover:bg-discord-messageHover transition-colors"
                >
                    <SvgIcon
                        d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                        className="w-4 h-4 text-discord-textMuted"
                    />
                </Pressable>
            )}
            {open &&
                (isTouchscreen ? (
                    // Zami: `position: fixed` → the root's portal layer.
                    <Portal>
                        <Pressable
                            accessible={false}
                            onPress={closeModal}
                            className="absolute inset-0 z-40"
                        />
                        {dialog}
                    </Portal>
                ) : (
                    dialog
                ))}
        </View>
    );
}

/** Zami: Zam's inline `<svg fill="currentColor"><path d=…/></svg>`. `className`
 *  sizes and places it, and its text color fills it, as `currentColor` would. */
function SvgIcon({ d, className }: { d: string; className: string }) {
    const { color, ...style } = useResolveClassNames(className);
    return (
        <Svg viewBox="0 0 24 24" fill={color} style={style}>
            <Path d={d} />
        </Svg>
    );
}
