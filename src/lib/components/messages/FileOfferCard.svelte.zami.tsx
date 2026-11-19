import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import { Send } from "lucide-svelte";
import type { MatrixEvent } from "matrix-js-sdk";
import {
    acceptOffer,
    cancelTransfer,
    offerFromSenderDevice,
    withdrawOffer,
} from "$lib/matrix/fileTransfer";
import { getClient } from "$lib/matrix/runtime";
import {
    acceptedOnDevice,
    isOffered,
    transfersFor,
    type TransferFailure,
    type TransferView,
} from "$lib/stores/fileTransfers.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";
import {
    formatTransferBytes,
    offerExpiresAt,
    parseFileOffer,
} from "$lib/utils/fileTransfer";
import type { MessageKey } from "$lib/i18n/en";

interface Props {
    event: MatrixEvent;
}

const FAILURE_TEXT: Record<TransferFailure, MessageKey> = {
    offline: "fileOffer.failedOffline",
    refused: "fileOffer.failedRefused",
    "no-relay": "fileOffer.failedNoRelay",
    connection: "fileOffer.failedConnection",
    stalled: "fileOffer.failedStalled",
    corrupt: "fileOffer.failedCorrupt",
    "write-failed": "fileOffer.failedWrite",
    "storage-full": "fileOffer.failedStorageFull",
    "hash-mismatch": "fileOffer.failedHash",
    unsupported: "fileOffer.failedUnsupported",
};

export default function FileOfferCard({ event }: Props) {
    const offer = parseFileOffer(event.getContent());
    const sender = event.getSender() ?? "";
    const client = getClient();
    const fromThisDevice =
        !!offer &&
        sender === client?.getUserId() &&
        offer.senderDevice === client?.getDeviceId();
    const fromMyOtherDevice = sender === client?.getUserId() && !fromThisDevice;
    const transferId = offer?.transferId;
    const views = useRune(
        () => (transferId ? transfersFor(transferId) : []),
        [transferId],
    );
    const incoming = views.find((v) => v.direction === "receive");
    const outgoing = views.filter((v) => v.direction === "send");
    const stillOffered = useRune(
        () => !!transferId && isOffered(transferId),
        [transferId],
    );
    const expired =
        !!offer && offerExpiresAt(offer, event.getTs()) < Date.now();
    const eventId = event.getId();
    const acceptedElsewhere = useRune(
        () => (eventId ? acceptedOnDevice(eventId ?? "") : null),
        [eventId],
    );
    // null while the check runs; false when the device proof fails or throws.
    const [fromNamedDevice, setFromNamedDevice] = useState<boolean | null>(
        null,
    );
    useEffect(() => {
        const current = event;
        setFromNamedDevice(null);
        let stale = false;
        offerFromSenderDevice(current)
            .then((ok) => {
                if (!stale) setFromNamedDevice(ok);
            })
            .catch((err) => {
                // Not proven is not trusted: a failed check counts as false.
                console.warn("[file-transfer] offer check", err);
                if (!stale) setFromNamedDevice(false);
            });
        return () => {
            stale = true;
        };
    }, [event]);
    const untrusted = fromNamedDevice === false && !fromThisDevice;
    // Accept needs the device proof itself: while the check runs it is disabled.
    const verified = fromThisDevice || fromNamedDevice === true;
    const canAccept =
        !fromThisDevice &&
        !expired &&
        !untrusted &&
        (!incoming ||
            incoming.phase === "failed" ||
            incoming.phase === "cancelled");

    function displayName(userId: string): string {
        const room = client?.getRoom(event.getRoomId() ?? "");
        return room?.getMember(userId)?.name ?? userId;
    }

    function percent(view: TransferView): number {
        return view.total > 0 ? (view.bytes / view.total) * 100 : 0;
    }

    function isActive(view: TransferView): boolean {
        return (
            view.phase === "connecting" ||
            view.phase === "preparing" ||
            view.phase === "transferring" ||
            view.phase === "verifying"
        );
    }

    function statusText(view: TransferView): string {
        switch (view.phase) {
            case "preparing":
                return view.direction === "receive"
                    ? t("fileOffer.preparingReceive")
                    : t("fileOffer.preparingSend");
            case "connecting":
                return t("fileOffer.connecting");
            case "verifying":
                return t("fileOffer.verifying");
            case "cancelled":
                return t("fileOffer.cancelled");
            case "done":
                return view.direction === "receive"
                    ? t("fileOffer.savedDone")
                    : t("fileOffer.sentDone", {
                          peer: displayName(view.peerUserId),
                      });
            case "failed":
                return t(FAILURE_TEXT[view.failure ?? "connection"]);
            default:
                return t("fileOffer.progress", {
                    done: formatTransferBytes(view.bytes),
                    total: formatTransferBytes(view.total),
                    rate: formatTransferBytes(Math.round(view.rate)),
                });
        }
    }

    function accept() {
        if (!offer || !verified) return;
        acceptOffer(
            event.getRoomId() ?? "",
            event.getId() ?? "",
            sender,
            offer,
        ).catch((err) => {
            console.error("Failed to accept file:", err);
            showErrorToast(t("fileOffer.failedConnection"));
        });
    }

    function withdraw() {
        if (!offer) return;
        withdrawOffer(offer.transferId).catch((err) => {
            console.error("Failed to withdraw file offer:", err);
            showErrorToast(t("fileOffer.failedConnection"));
        });
    }

    function progress(view: TransferView): ReactNode {
        return (
            <View className="mt-2">
                <Text
                    className="text-xs text-zam-textMuted"
                    accessibilityLiveRegion="polite"
                >
                    {statusText(view)}
                </Text>
                {isActive(view) && (
                    <View className="mt-1 flex-row items-center gap-2">
                        <View
                            className="h-1 flex-1 rounded-full bg-zam-background overflow-hidden"
                            accessibilityRole="progressbar"
                            accessibilityValue={{
                                min: 0,
                                max: 100,
                                now: Math.round(percent(view)),
                            }}
                        >
                            <View
                                className="h-full bg-zam-accent transition-[width]"
                                style={{ width: `${percent(view)}%` }}
                            />
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                                offer &&
                                cancelTransfer(view.id, offer.transferId)
                            }
                        >
                            <Text className="text-xs text-zam-textMuted hover:text-zam-textPrimary">
                                {t("fileOffer.cancel")}
                            </Text>
                        </Pressable>
                    </View>
                )}
            </View>
        );
    }

    return (
        <View className="mt-1 max-w-md rounded-lg border border-zam-divider bg-zam-backgroundSecondary px-3 py-2.5">
            {!offer ? (
                <Text className="text-sm text-zam-textMuted">
                    {t("fileOffer.unavailable")}
                </Text>
            ) : (
                <>
                    <View className="flex-row items-center gap-2.5">
                        <Send
                            size={20}
                            className="flex-shrink-0 text-zam-textMuted"
                        />
                        {/* Zami: `title` (the full name on hover) has no React
                            Native equivalent. `flex-shrink` is the web's default
                            for a flex item, which lets the name truncate. */}
                        <View className="min-w-0 flex-shrink">
                            <Text
                                className="truncate text-sm font-semibold text-zam-textPrimary"
                                numberOfLines={1}
                            >
                                {offer.name}
                            </Text>
                            <Text className="text-xs text-zam-textMuted">
                                {t("fileOffer.details", {
                                    size: formatTransferBytes(offer.size),
                                })}
                            </Text>
                        </View>
                    </View>

                    {fromThisDevice ? (
                        <>
                            {outgoing.map((view) => (
                                <Fragment key={view.id}>
                                    <Text className="mt-2 text-xs text-zam-textPrimary">
                                        {t("fileOffer.sendingTo", {
                                            peer: displayName(view.peerUserId),
                                        })}
                                    </Text>
                                    {progress(view)}
                                </Fragment>
                            ))}
                            {stillOffered ? (
                                <>
                                    {outgoing.length === 0 && (
                                        <Text className="mt-2 text-xs text-zam-textMuted">
                                            {expired
                                                ? t("fileOffer.expired")
                                                : t("fileOffer.waiting")}
                                        </Text>
                                    )}
                                    {/* `self-start`: a <button> is only as
                                        wide as its label. */}
                                    <Pressable
                                        accessibilityRole="button"
                                        className="mt-2 self-start px-2.5 py-1 rounded bg-zam-danger hover:bg-zam-dangerHover transition-colors"
                                        onPress={withdraw}
                                    >
                                        <Text className="text-white text-xs font-semibold">
                                            {t("fileOffer.withdraw")}
                                        </Text>
                                    </Pressable>
                                </>
                            ) : (
                                <Text className="mt-2 text-xs text-zam-textMuted">
                                    {t("fileOffer.gone")}
                                </Text>
                            )}
                        </>
                    ) : (
                        <>
                            {incoming ? (
                                progress(incoming)
                            ) : fromMyOtherDevice ? (
                                <Text className="mt-2 text-xs text-zam-textMuted">
                                    {t("fileOffer.fromElsewhere")}
                                </Text>
                            ) : expired ? (
                                <Text className="mt-2 text-xs text-zam-textMuted">
                                    {t("fileOffer.expired")}
                                </Text>
                            ) : null}
                            {acceptedElsewhere &&
                                views.length === 0 &&
                                !untrusted && (
                                    <Text className="mt-2 text-xs text-zam-textMuted">
                                        {t("fileOffer.acceptedElsewhere", {
                                            device: acceptedElsewhere,
                                        })}
                                    </Text>
                                )}
                            {canAccept ? (
                                <Pressable
                                    accessibilityRole="button"
                                    className={`mt-2 self-start px-3 py-1.5 rounded bg-zam-accent hover:bg-zam-accentHover transition-colors${verified ? "" : " opacity-50"}`}
                                    disabled={!verified}
                                    accessibilityState={{ disabled: !verified }}
                                    onPress={accept}
                                >
                                    <Text className="text-white text-xs font-semibold">
                                        {incoming
                                            ? t("fileOffer.retry")
                                            : t("fileOffer.accept")}
                                    </Text>
                                </Pressable>
                            ) : untrusted ? (
                                <Text className="mt-2 text-xs text-zam-danger">
                                    {t("fileOffer.untrusted")}
                                </Text>
                            ) : null}
                        </>
                    )}
                </>
            )}
        </View>
    );
}
