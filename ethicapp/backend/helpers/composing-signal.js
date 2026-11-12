// The composing signal (epic #601, #654): a participant or the activity's
// teacher tells the server they are writing in a group chat, the server tells
// the group's other members, and participants' signals reach the AI services
// that declare the `participant-activity` hook. The signal never carries draft
// text, keys or input length.
//
// This module is the server's one copy of the contract's names and timing.
// The student socket handler (#655), the teacher socket handler (#1200) and
// the ephemeral hook dispatch import it; ethicapp-student keeps its own
// mirror of the client timing (#656).

// Client -> server, on `/student` and on `/teacher`.
export const CHAT_COMPOSING_EVENT = "chatComposing";

// The only fields a `chatComposing` payload may carry. A payload with any
// other field is dropped; the user is always `socket.data.uid`.
export const CHAT_COMPOSING_PAYLOAD_FIELDS = Object.freeze([
    "phaseId",
    "questionId",
    "groupId",
    "kind",
]);

// Server -> room `group-<groupId>` on `/student`, to every member but the
// writer: `{ groupId, questionId, userId, role, name, kind }`, where
// `{ userId, role, name }` comes from helpers/chat-author-label.js.
export const CHAT_COMPOSING_NOTICE_EVENT = "onChatComposing";

// `composing` while the writer edits; `stopped` once they submit, blur, stay
// idle, navigate away or unmount, and only after a `composing`.
export const COMPOSING_KIND = "composing";
export const STOPPED_KIND = "stopped";
export const COMPOSING_KINDS = Object.freeze([COMPOSING_KIND, STOPPED_KIND]);

// Client timing, the same for both clients: `composing` on the first edit and
// again at most every COMPOSING_CLIENT_INTERVAL_MS while edits continue;
// `stopped` after COMPOSING_IDLE_MS without edits.
export const COMPOSING_CLIENT_INTERVAL_MS = 5000;
export const COMPOSING_IDLE_MS = 8000;

// How long a client shows a `composing` notice without a newer one. A
// `stopped` notice clears it at once.
export const COMPOSING_NOTICE_TTL_MS = 10000;

// AI services receive at most one `composing` per participant every
// COMPOSING_SERVICE_INTERVAL_MS. A service counts a participant as active for
// `ttlSeconds` (COMPOSING_SERVICE_TTL_SECONDS by default) after the receipt
// of their last `composing`, and never past max(receivedAt) + ttlSeconds.
// The upper bound is the one the Polyadic activity route accepts
// (ethicapp-ai-additions#177).
export const COMPOSING_SERVICE_INTERVAL_MS = 12000;
export const COMPOSING_SERVICE_TTL_SECONDS = 30;
export const COMPOSING_SERVICE_TTL_MAX_SECONDS = 120;

// At most COMPOSING_SIGNALS_PER_WINDOW signals per socket within
// COMPOSING_RATE_WINDOW_MS (helpers/sliding-window-throttle.js); signals over
// the limit are dropped silently. The client timing above sends at most 13
// per minute.
export const COMPOSING_SIGNALS_PER_WINDOW = 20;
export const COMPOSING_RATE_WINDOW_MS = 60000;

/**
 * Whether `kind` is one of COMPOSING_KINDS.
 * @param {unknown} kind
 * @returns {boolean}
 */
export function isComposingKind(kind) {
    return COMPOSING_KINDS.includes(kind);
}
