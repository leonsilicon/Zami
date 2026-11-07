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
import { Check } from "lucide-svelte";
import { Portal } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import { reportEvent } from "$lib/matrix/client";
import {
    closeModal,
    interfaceState,
    openModal,
} from "$lib/stores/interface.svelte";
import {
    buildReport,
    canSubmitReport,
    reportErrorMessage,
} from "$lib/utils/reportMessage";

/** Zami: what `bind:this` gave upstream's parent (`reportComp?.show()`), through `ref`. */
export interface MessageReportActionHandle {
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
    ref?: Ref<MessageReportActionHandle>;
}

export default function MessageReportAction({
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
    // Zami: `open` as of the last render, for the timer that outlives one.
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
    const [offensive, setOffensive] = useState(false);
    const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
        "idle",
    );
    const [error, setError] = useState("");

    function show() {
        // Zami: measured asynchronously, so `below` settles just after the
        // dialog opens (only the desktop dialog reads it).
        setBelow(false);
        buttonEl.current?.measureInWindow((_x, top) => setBelow(top < 400));
        // Claim first — a same-id handover runs the outgoing close.
        openModal("report-message", () => setOpen(false));
        setReason("");
        setOffensive(false);
        setStatus("idle");
        setError("");
        setOpen(true);
        // Zami: the textarea mounts with the dialog, so its `autoFocus` stands
        // in for focusing it on the next tick.
    }
    useImperativeHandle(ref, () => ({ show }));

    async function submit() {
        if (!canSubmitReport(reason) || status === "sending") return;
        setStatus("sending");
        setError("");
        try {
            const report = buildReport(reason, offensive);
            await reportEvent(roomId, eventId, report.score, report.reason);
            setStatus("sent");
            setTimeout(() => {
                if (openRef.current) closeModal();
            }, 1200);
        } catch (submitError) {
            setStatus("error");
            setError(reportErrorMessage(submitError));
        }
    }

    // Zami: not ported: closing the desktop dialog on a mousedown outside it
    // (a `document` listener). Touch closes it with the backdrop, as upstream.

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
            {status === "sent" ? (
                <Text className="text-sm text-discord-textPrimary">
                    {t("messageReportAction.reportSent")}
                </Text>
            ) : (
                <>
                    <Text className="text-xs font-semibold uppercase text-discord-textMuted mb-2">
                        {t("messageReportAction.reportMessage")}
                    </Text>
                    <TextInput
                        autoFocus
                        multiline
                        value={reason}
                        onChangeText={setReason}
                        placeholder={t(
                            "messageReportAction.whyAreYouReportingThisMessage",
                        )}
                        placeholderTextColorClassName="accent-discord-textMuted"
                        editable={status !== "sending"}
                        textAlignVertical="top"
                        // Zami: `rows="3"`: three 20px lines, the padding and the border.
                        className="w-full min-h-[78px] resize-none rounded bg-discord-backgroundSecondary border border-discord-divider p-2 text-sm text-discord-textPrimary focus:outline-none focus:border-discord-accent"
                    />
                    {/* Zami: React Native has no checkbox input; a box that
                        shows a check stands in for it. */}
                    <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{
                            checked: offensive,
                            disabled: status === "sending",
                        }}
                        onPress={() => setOffensive(!offensive)}
                        disabled={status === "sending"}
                        className="flex-row items-center gap-2 mt-2 select-none cursor-pointer"
                    >
                        <View
                            className={`w-3.5 h-3.5 items-center justify-center rounded-sm border ${
                                offensive
                                    ? "bg-discord-accent border-discord-accent"
                                    : "border-discord-textMuted"
                            }`}
                        >
                            {offensive && (
                                <Check size={10} className="text-white" />
                            )}
                        </View>
                        <Text className="text-xs text-discord-textMuted">
                            {t("messageReportAction.markAsExtremelyOffensive")}
                        </Text>
                    </Pressable>
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
                            accessibilityState={{
                                disabled:
                                    !canSubmitReport(reason) ||
                                    status === "sending",
                            }}
                            onPress={() => void submit()}
                            disabled={
                                !canSubmitReport(reason) || status === "sending"
                            }
                            className="px-2 py-1 rounded bg-discord-danger hover:bg-discord-dangerHover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Text className="text-xs font-semibold text-white">
                                {status === "sending"
                                    ? t("messageReportAction.reporting")
                                    : t("messageReportAction.report")}
                            </Text>
                        </Pressable>
                    </View>
                </>
            )}
        </View>
    );

    return (
        <View className="relative">
            {/*
                `data-message-action` enlists this trigger in MessageItem's roving
                toolbar (the bar's arrow-key navigation); the report dialog's own
                controls stay out of it deliberately.
                Zami: not ported: `data-message-action` (arrow-key navigation).
            */}
            {showTrigger && (
                <Pressable
                    ref={buttonEl}
                    accessibilityRole="button"
                    accessibilityLabel={t("messageReportAction.reportMessage")}
                    accessibilityState={{ expanded: open }}
                    onPress={() => (open ? closeModal() : show())}
                    className="p-1.5 rounded hover:bg-discord-messageHover transition-colors"
                >
                    <SvgIcon
                        d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"
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
