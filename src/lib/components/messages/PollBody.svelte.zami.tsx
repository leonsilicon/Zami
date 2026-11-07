import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import {
    getPollView,
    fetchPollRelations,
    sendPollResponse,
    sendPollEnd,
} from "$lib/matrix/client";
import { messagesState, bumpReactionTick } from "$lib/stores/messages.svelte";
import { roomsState } from "$lib/stores/rooms.svelte";
import { showErrorToast } from "$lib/stores/toasts.svelte";

interface Props {
    event: MatrixEvent;
    room: Room;
}

export default function PollBody({ event, room }: Props) {
    // Full vote history, fetched once per poll from /relations. The SDK only
    // aggregates relations it saw in the loaded timeline window, so without
    // this fetch votes older than the window would be missing from tallies.
    const [fetchedRelations, setFetchedRelations] = useState<MatrixEvent[]>([]);

    useEffect(() => {
        const roomId = room.roomId;
        const pollId = event.getId();
        if (!pollId) return;
        let cancelled = false;
        fetchPollRelations(roomId, pollId)
            .then((events) => {
                if (!cancelled) setFetchedRelations(events);
            })
            .catch(() => {
                // Tallies fall back to locally-known relations only.
            });
        return () => {
            cancelled = true;
        };
    }, [room.roomId, event]);

    // reactionTick bumps when poll responses/ends arrive over sync (see
    // MessageArea); roomsTick covers power-level changes that affect whose
    // end events count.
    const reactionTick = useRune(() => messagesState.reactionTick);
    const roomsTick = useRune(() => roomsState.roomsTick);
    const view = useMemo(() => {
        void reactionTick;
        void roomsTick;
        return getPollView(room, event, fetchedRelations);
    }, [reactionTick, roomsTick, room, event, fetchedRelations]);

    const [draftAnswers, setDraftAnswers] = useState<string[] | null>(null);
    const [isVoting, setIsVoting] = useState(false);
    const selectedAnswers = draftAnswers ?? view?.myAnswers ?? [];

    function toggleAnswer(answerId: string) {
        if (!view || view.ended || isVoting) return;
        if (view.poll.maxSelections === 1) {
            const next = selectedAnswers.includes(answerId) ? [] : [answerId];
            setDraftAnswers(next);
            void submitVote(next);
            return;
        }
        const current = selectedAnswers;
        setDraftAnswers(
            current.includes(answerId)
                ? current.filter((id) => id !== answerId)
                : current.length < view.poll.maxSelections
                  ? [...current, answerId]
                  : current,
        );
    }

    async function submitVote(selection = selectedAnswers) {
        if (!view || view.ended || isVoting) return;
        setIsVoting(true);
        try {
            await sendPollResponse(room.roomId, event, selection);
            bumpReactionTick();
            setDraftAnswers(null);
        } catch (err) {
            showErrorToast(
                err instanceof Error
                    ? err.message
                    : t("pollBody.failedToSubmitVote"),
            );
            setIsVoting(false);
            return;
        }

        const pollId = event.getId();
        if (pollId) {
            try {
                setFetchedRelations(
                    await fetchPollRelations(room.roomId, pollId),
                );
            } catch (err) {
                console.warn("[poll] vote sent but refresh failed", err);
            }
        }
        setIsVoting(false);
    }

    function pct(count: number, total: number): number {
        return total === 0 ? 0 : Math.round((count / total) * 100);
    }

    const [confirmingEnd, setConfirmingEnd] = useState(false);
    const [endingPoll, setEndingPoll] = useState(false);
    async function endPoll() {
        if (endingPoll) return;
        setEndingPoll(true);
        try {
            await sendPollEnd(room.roomId, event);
            bumpReactionTick();
            setConfirmingEnd(false);
        } catch (err) {
            showErrorToast(
                err instanceof Error
                    ? err.message
                    : t("pollBody.failedToClosePoll"),
            );
        } finally {
            setEndingPoll(false);
        }
    }

    return view ? (
        <View className="mt-1 max-w-md rounded-lg border border-discord-divider bg-discord-backgroundSecondary px-3 py-2.5">
            <View className="flex-row items-start gap-2">
                <SvgIcon
                    d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z"
                    className="w-4 h-4 mt-0.5 text-discord-textMuted flex-shrink-0"
                />
                <View className="min-w-0 flex-shrink">
                    <Text className="text-sm font-semibold text-discord-textPrimary break-words">
                        {view.poll.question}
                    </Text>
                    <Text className="text-xs text-discord-textMuted">
                        {view.ended
                            ? t("pollBody.finalResults")
                            : view.showResults
                              ? t("pollBody.livePoll")
                              : t("pollBody.resultsAreRevealedWhenThePoll")}
                        {view.poll.maxSelections > 1 &&
                            ` ${t("pollBody.chooseUpTo", {
                                maxSelections: view.poll.maxSelections,
                            })}`}
                    </Text>
                </View>
            </View>

            <View className="mt-2 flex-col gap-1.5">
                {view.poll.answers.map((answer) => {
                    const count = view.counts[answer.id] ?? 0;
                    const isWinner =
                        view.ended && view.winners.includes(answer.id);
                    const isMine = selectedAnswers.includes(answer.id);
                    return (
                        <Pressable
                            key={answer.id}
                            accessibilityRole="button"
                            accessibilityState={{
                                selected: isMine,
                                disabled: view.ended || isVoting,
                            }}
                            onPress={() => toggleAnswer(answer.id)}
                            disabled={view.ended || isVoting}
                            className={`rounded border px-2.5 py-1.5 ${
                                isWinner
                                    ? "border-discord-accent bg-discord-accent/10"
                                    : isMine
                                      ? "border-discord-accent bg-discord-accent/10"
                                      : "border-discord-divider bg-discord-backgroundTertiary"
                            } transition-colors disabled:cursor-default enabled:hover:border-discord-accent/60`}
                        >
                            <View className="flex-row items-center justify-between gap-2">
                                <Text className="flex-shrink text-sm text-discord-textPrimary break-words min-w-0">
                                    {answer.text}
                                    {isMine && (
                                        <>
                                            {" "}
                                            <Text className="text-xs text-discord-accent font-semibold">
                                                {t("pollBody.selected")}
                                            </Text>
                                        </>
                                    )}
                                </Text>
                                {view.showResults && (
                                    <Text className="text-xs text-discord-textMuted flex-shrink-0">
                                        {count} · {pct(count, view.totalVotes)}%
                                    </Text>
                                )}
                            </View>
                            {view.showResults && (
                                <View className="mt-1 h-1 rounded-full bg-discord-background overflow-hidden">
                                    <View
                                        className={`h-full rounded-full ${
                                            isWinner
                                                ? "bg-discord-accent"
                                                : "bg-discord-divider"
                                        }`}
                                        style={{
                                            width: `${pct(count, view.totalVotes)}%`,
                                        }}
                                    />
                                </View>
                            )}
                        </Pressable>
                    );
                })}
            </View>

            {!view.ended && view.poll.maxSelections > 1 && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                        disabled: isVoting || draftAnswers === null,
                    }}
                    onPress={() => void submitVote()}
                    disabled={isVoting || draftAnswers === null}
                    className="mt-2 self-start px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Text className="text-white text-xs font-semibold">
                        {isVoting
                            ? t("pollBody.submitting")
                            : t("pollBody.submitVote")}
                    </Text>
                </Pressable>
            )}

            <Text className="mt-2 text-xs text-discord-textMuted">
                {view.showResults
                    ? t("pollBody.voteCount", { count: view.totalVotes })
                    : t("pollBody.votesAreHidden")}
                {!view.ended && isVoting && ` ${t("pollBody.savingVote")}`}
            </Text>

            {view.canEnd &&
                (confirmingEnd ? (
                    <View className="mt-2 flex-row items-center gap-2">
                        <Text className="text-xs text-discord-textMuted">
                            {t("pollBody.closeThisPoll")}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: endingPoll }}
                            onPress={() => void endPoll()}
                            disabled={endingPoll}
                            className="px-2.5 py-1 rounded bg-discord-danger hover:bg-discord-dangerHover transition-colors disabled:opacity-50"
                        >
                            <Text className="text-white text-xs font-semibold">
                                {endingPoll
                                    ? t("pollBody.closing")
                                    : t("pollBody.closePoll")}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => setConfirmingEnd(false)}
                            className="px-2.5 py-1 rounded"
                        >
                            <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary">
                                {t("common.cancel")}
                            </Text>
                        </Pressable>
                    </View>
                ) : (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => setConfirmingEnd(true)}
                        className="mt-2 self-start"
                    >
                        <Text className="text-xs text-discord-textMuted hover:text-discord-textPrimary underline">
                            {t("pollBody.closePoll")}
                        </Text>
                    </Pressable>
                ))}
        </View>
    ) : (
        <Text className="text-xs text-discord-textMuted italic">
            {t("pollBody.pollUnsupportedFormat")}
        </Text>
    );
}
