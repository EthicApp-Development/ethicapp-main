import {
    CHAT_COMPOSING_PAYLOAD_FIELDS,
    COMPOSING_RATE_WINDOW_MS,
    COMPOSING_SIGNALS_PER_WINDOW,
    isComposingKind,
} from "./composing-signal.js";
import { createSlidingWindowThrottle } from "./sliding-window-throttle.js";

// The parts of receiving a composing signal (epic #601) that do not depend on
// who sends it: the per-socket rate limit, the payload check and the group
// notice. The student socket (#655) and the teacher socket (#1200) share them.

const ID_FIELDS = Object.freeze(["phaseId", "questionId", "groupId"]);

function isPositiveId(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * The rate limit of one socket's composing signals: at most
 * COMPOSING_SIGNALS_PER_WINDOW within COMPOSING_RATE_WINDOW_MS. Create one per
 * socket; it is dropped with the socket.
 *
 * @param {{ now?: () => number }} [options]
 * @returns {{ tryAcquire: () => boolean }} `tryAcquire()` counts a signal and
 *     tells whether it is within the limit.
 */
export function createComposingRateLimit({ now = () => Date.now() } = {}) {
    const throttle = createSlidingWindowThrottle({
        limit:    COMPOSING_SIGNALS_PER_WINDOW,
        windowMs: COMPOSING_RATE_WINDOW_MS,
        now,
    });
    return {
        tryAcquire: () => throttle.tryAcquire("chatComposing").allowed,
    };
}

/**
 * A `chatComposing` payload as the server accepts it: an object with exactly
 * CHAT_COMPOSING_PAYLOAD_FIELDS, positive integer ids and a known `kind`.
 * Anything else, such as a payload with `content`, `text` or `length`, is
 * refused whole.
 *
 * @param {unknown} payload
 * @returns {Readonly<{ phaseId: number, questionId: number, groupId: number,
 *     kind: "composing"|"stopped" }> | null} null for a refused payload.
 */
export function parseChatComposingPayload(payload) {
    if (!isPlainObject(payload)) {
        return null;
    }

    const fields = Object.keys(payload);
    if (fields.length !== CHAT_COMPOSING_PAYLOAD_FIELDS.length
        || !fields.every(field => CHAT_COMPOSING_PAYLOAD_FIELDS.includes(field))) {
        return null;
    }
    if (!ID_FIELDS.every(field => isPositiveId(payload[field]))) {
        return null;
    }
    if (!isComposingKind(payload.kind)) {
        return null;
    }

    return Object.freeze({
        phaseId:    payload.phaseId,
        questionId: payload.questionId,
        groupId:    payload.groupId,
        kind:       payload.kind,
    });
}

/**
 * The `onChatComposing` notice for a group: the signal's group, question and
 * kind with the writer's label (helpers/chat-author-label.js), and nothing
 * else.
 *
 * @param {{ userId: number, role: "A"|"P", name: string|null }} label
 * @param {{ groupId: number, questionId: number,
 *     kind: "composing"|"stopped" }} signal
 * @returns {{ groupId: number, questionId: number, userId: number,
 *     role: "A"|"P", name: string|null, kind: "composing"|"stopped" }}
 */
export function chatComposingNotice(label, { groupId, questionId, kind }) {
    return {
        groupId,
        questionId,
        userId: label.userId,
        role:   label.role,
        name:   label.name,
        kind,
    };
}
