// The composing signal's names and client timing (epic #601, #654), as the
// student app uses them. This is a mirror: the server's copy is
// ethicapp/backend/helpers/composing-signal.js, which this app cannot import;
// utils/__tests__/composingSignalContract.node-test.mjs compares the two.

// Client -> server on `/student`: `{ phaseId, questionId, groupId, kind }`,
// exactly those fields. The server takes the user from the socket.
export const CHAT_COMPOSING_EVENT = 'chatComposing';

// Server -> the group's other members on `/student`.
export const CHAT_COMPOSING_NOTICE_EVENT = 'onChatComposing';

// `composing` while the writer edits; `stopped` once they submit, blur, stay
// idle, navigate away or unmount, and only after a `composing`.
export const COMPOSING_KIND = 'composing';
export const STOPPED_KIND = 'stopped';

// `composing` on the first edit and again at most every
// COMPOSING_CLIENT_INTERVAL_MS while edits continue; `stopped` after
// COMPOSING_IDLE_MS without edits.
export const COMPOSING_CLIENT_INTERVAL_MS = 5000;
export const COMPOSING_IDLE_MS = 8000;

// How long a `composing` notice is shown without a newer one.
export const COMPOSING_NOTICE_TTL_MS = 10000;
