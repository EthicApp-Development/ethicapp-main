import { resolveChatAuthorLabel } from "../helpers/chat-author-label.js";
import {
    CHAT_COMPOSING_EVENT,
    COMPOSING_KIND,
    STOPPED_KIND,
} from "../helpers/composing-signal.js";
import {
    chatComposingNotice,
    createComposingRateLimit,
    parseChatComposingPayload,
} from "../helpers/composing-signal-intake.js";
import { resolveOpenGroupChatContext } from "../helpers/group-chat-access.js";
import { describeError } from "../helpers/log-safety.js";

// Receives the composing signal (`chatComposing`, epic #601) on one socket.
// For each signal, in this order:
//
// 1. the socket's rate limit, which drops a signal over it;
// 2. the payload check, which drops a payload with any field beyond the
//    contract;
// 3. the access check, read on every signal: the writer may post in the
//    group's chat right now;
// 4. the writer's label, and the `onChatComposing` notice to the group;
// 5. for participants, the coalesced dispatch to AI services, after the
//    notice.
//
// Signals of one socket are handled one after another, so the notices keep
// the order the writer sent them in. On disconnect, the group is told
// `stopped` for every chat the writer was still composing in.
//
// Nothing beyond the contract's fields is read, logged or forwarded.

function chatKey({ groupId, questionId }) {
    return `${groupId}:${questionId}`;
}

/**
 * Registers the `chatComposing` handler on a socket whose user is
 * `socket.data.uid`.
 *
 * @param {import("socket.io").Socket} socket
 * @param {Object} options
 * @param {"A"|"P"} options.role - The writer's role in the chat.
 * @param {(groupId: number, notice: Object) => void} options.emitNotice -
 *     Sends `onChatComposing` to the group's members but the writer.
 * @param {(request: { groupId: number, phaseId: number, questionId: number,
 *     userId: number, role: "A"|"P" }) => Promise<{ sessionId: number }|null>}
 *     [options.checkAccess=resolveOpenGroupChatContext] - The context of a
 *     chat the writer may post in now, or null.
 * @param {(author: { groupId: number, userId: number, role: "A"|"P" }) =>
 *     Promise<{ userId: number, role: string, name: string|null }|null>}
 *     [options.resolveLabel=resolveChatAuthorLabel]
 * @param {{ forward: (signal: Object) => Promise<void>,
 *     forget: (participant: Object) => void }|null} [options.activity] - The
 *     AI services' forwarder (helpers/participant-activity-helper.js), for
 *     participants only.
 * @param {{ tryAcquire: () => boolean }} [options.rateLimit] - A new
 *     per-socket limit by default.
 * @param {() => number} [options.now] - Epoch milliseconds.
 * @param {{ error: Function }} [options.logger=console]
 * @returns {{ idle: () => Promise<void> }} `idle()` settles once the signals
 *     received so far and their dispatches are handled; for tests.
 */
export function registerChatComposing(socket, {
    role,
    emitNotice,
    checkAccess = resolveOpenGroupChatContext,
    resolveLabel = resolveChatAuthorLabel,
    activity = null,
    now = () => Date.now(),
    rateLimit = createComposingRateLimit({ now }),
    logger = console,
}) {
    const userId = socket.data.uid;
    // Chats with a `composing` notice and no `stopped` yet, with the label
    // the notice carried.
    const composingChats = new Map();
    const dispatches = new Set();
    let queue = Promise.resolve();
    let closed = false;

    // Dispatches run after the notice and are not awaited by the next
    // signal; a failure is logged and goes no further.
    function track(dispatch, ids) {
        const settled = Promise.resolve(dispatch).catch((error) => {
            logger.error("[composing] Could not forward a composing signal.", {
                ...ids,
                error: describeError(error),
            });
        });
        dispatches.add(settled);
        settled.finally(() => dispatches.delete(settled));
    }

    async function handle(signal, receivedAt) {
        const { phaseId, questionId, groupId, kind } = signal;
        const access = await checkAccess({ groupId, phaseId, questionId, userId, role });
        if (!access || closed) {
            return;
        }
        const label = await resolveLabel({ groupId, userId, role });
        if (!label || closed) {
            return;
        }

        emitNotice(groupId, chatComposingNotice(label, signal));
        if (kind === COMPOSING_KIND) {
            composingChats.set(chatKey(signal), { groupId, questionId, label });
        } else {
            composingChats.delete(chatKey(signal));
        }

        if (activity) {
            track(activity.forward({
                kind,
                sessionId: access.sessionId,
                phaseId,
                questionId,
                groupId,
                userId,
                receivedAt,
            }), { userId, phaseId, groupId });
        }
    }

    function enqueue(task) {
        queue = queue.then(task);
    }

    socket.on(CHAT_COMPOSING_EVENT, (payload) => {
        if (closed || !rateLimit.tryAcquire()) {
            return;
        }
        const signal = parseChatComposingPayload(payload);
        if (!signal) {
            return;
        }
        const receivedAt = now();

        enqueue(async () => {
            if (closed) {
                return;
            }
            try {
                await handle(signal, receivedAt);
            } catch (error) {
                logger.error("[composing] Could not handle a composing signal.", {
                    userId,
                    phaseId: signal.phaseId,
                    groupId: signal.groupId,
                    error:   describeError(error),
                });
            }
        });
    });

    // The writer's chats lose their `composing` notice at once rather than
    // after the clients' TTL. The label is the one the notice carried, so
    // nothing is read; the coalescing state is dropped without telling the
    // services, which let the participant expire after the TTL. Signals still
    // queued are dropped; one being handled stops at its next step, and the
    // cleanup runs after it.
    socket.on("disconnect", () => {
        closed = true;
        enqueue(() => {
            for (const { groupId, questionId, label } of composingChats.values()) {
                try {
                    emitNotice(groupId, chatComposingNotice(label, {
                        groupId,
                        questionId,
                        kind: STOPPED_KIND,
                    }));
                } catch (error) {
                    logger.error("[composing] Could not send a stopped notice on disconnect.", {
                        userId,
                        groupId,
                        error: describeError(error),
                    });
                }
                activity?.forget({ userId, groupId, questionId });
            }
            composingChats.clear();
        });
    });

    return {
        idle: async () => {
            await queue;
            await Promise.all([...dispatches]);
        },
    };
}
