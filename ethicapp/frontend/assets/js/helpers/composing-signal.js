// The teacher's composing signal from a group chat (epic #601, #1200): it
// tells the group's participants, over the teacher socket, that the teacher
// is writing. A plain ES module with no AngularJS, so the teacher frontend
// of #904 can reuse it; the chat component only feeds it the chat's target
// and the draft's edits, blurs and submits.
//
// - `composing` goes out on the first edit, and again on an edit at least
//   `intervalMs` after the last one sent; a keypress never sends more.
// - `stopped` goes out once, and only after a `composing`: `idleMs` after
//   the last edit, on `stop()` (a blur or a submit), when the target changes
//   (another group, phase or question, a chat that stops accepting
//   messages, another channel) and on `dispose()`. It goes to the target and
//   the channel the `composing` went to.
// - It knows that an edit happened, never what the draft holds: a payload
//   carries only `{ phaseId, questionId, groupId, kind }`.
// - Nothing goes out while the chat is disabled, its target is incomplete,
//   or the channel is missing or not connected. An emit that throws is
//   ignored; signals are best-effort and never affect the chat itself.
//
// Timers and the clock are injectable for tests.

// The contract's names and client timing. The server's copy is
// ethicapp/backend/helpers/composing-signal.js; ethicapp-student keeps its
// own. The tests check this copy against the server's.
export const CHAT_COMPOSING_EVENT = "chatComposing";
export const COMPOSING_KIND = "composing";
export const STOPPED_KIND = "stopped";
export const COMPOSING_CLIENT_INTERVAL_MS = 5000;
export const COMPOSING_IDLE_MS = 8000;

function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function targetOf({ phaseId, questionId, groupId }) {
    const target = {
        phaseId:    positiveInteger(phaseId),
        questionId: positiveInteger(questionId),
        groupId:    positiveInteger(groupId),
    };
    return target.phaseId && target.questionId && target.groupId ? target : null;
}

function sameTarget(left, right) {
    return Boolean(left && right)
        && left.phaseId === right.phaseId
        && left.questionId === right.questionId
        && left.groupId === right.groupId;
}

const defaultTimers = {
    setTimeout:   (callback, delay) => setTimeout(callback, delay),
    clearTimeout: id => clearTimeout(id),
};

/**
 * The composing signal of one chat composer.
 *
 * @param {Object} [options]
 * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
 * @param {() => number} [options.now] - Epoch milliseconds.
 * @param {number} [options.intervalMs=COMPOSING_CLIENT_INTERVAL_MS]
 * @param {number} [options.idleMs=COMPOSING_IDLE_MS]
 * @returns {{ update: Function, edited: Function, stop: Function,
 *     dispose: Function }}
 */
export function createComposingSignal({
    timers = defaultTimers,
    now = () => Date.now(),
    intervalMs = COMPOSING_CLIENT_INTERVAL_MS,
    idleMs = COMPOSING_IDLE_MS,
} = {}) {
    // Where signals go now: `{ channel, target }`, or null while disabled.
    let current = null;
    // Where the last `composing` went, until its `stopped`.
    let composingTo = null;
    let lastComposingAt = -Infinity;
    let lastEditAt = -Infinity;
    let idleTimer = null;
    let disposed = false;

    function isConnected(channel) {
        try {
            return channel.isConnected() === true;
        } catch {
            return false;
        }
    }

    function emit({ channel, target }, kind) {
        if (!isConnected(channel)) {
            return false;
        }
        try {
            channel.emit(CHAT_COMPOSING_EVENT, {
                phaseId:    target.phaseId,
                questionId: target.questionId,
                groupId:    target.groupId,
                kind,
            });
            return true;
        } catch {
            return false;
        }
    }

    function clearIdleTimer() {
        if (idleTimer !== null) {
            timers.clearTimeout(idleTimer);
        }
        idleTimer = null;
    }

    function sendStopped() {
        clearIdleTimer();
        if (!composingTo) {
            return;
        }
        const destination = composingTo;
        composingTo = null;
        emit(destination, STOPPED_KIND);
    }

    function scheduleIdle(delay) {
        idleTimer = timers.setTimeout(() => {
            idleTimer = null;
            if (disposed || !composingTo) {
                return;
            }
            const idleFor = now() - lastEditAt;
            if (idleFor >= idleMs) {
                sendStopped();
            } else {
                scheduleIdle(idleMs - idleFor);
            }
        }, delay);
    }

    return {
        /**
         * The chat's channel and target, whenever they may have changed. A
         * change while composing sends `stopped` to the previous target.
         *
         * @param {Object} options
         * @param {{ isConnected: () => boolean,
         *     emit: (event: string, payload: Object) => void }|null}
         *     options.channel - The teacher socket.
         * @param {number} options.phaseId
         * @param {number} options.questionId
         * @param {number} options.groupId
         * @param {boolean} options.enabled - The chat accepts the teacher's
         *     messages.
         */
        update({ channel = null, phaseId, questionId, groupId, enabled = false } = {}) {
            if (disposed) {
                return;
            }
            const target = enabled && channel ? targetOf({ phaseId, questionId, groupId }) : null;
            current = target ? { channel, target } : null;

            const stillComposingHere = current
                && current.channel === composingTo?.channel
                && sameTarget(current.target, composingTo?.target);
            if (composingTo && !stillComposingHere) {
                sendStopped();
            }
        },

        /** The draft changed; what it holds is none of this module's business. */
        edited() {
            if (disposed || !current) {
                return;
            }
            const at = now();
            lastEditAt = at;

            if (!composingTo) {
                if (emit(current, COMPOSING_KIND)) {
                    composingTo = current;
                    lastComposingAt = at;
                    scheduleIdle(idleMs);
                }
                return;
            }

            if (at - lastComposingAt >= intervalMs && emit(composingTo, COMPOSING_KIND)) {
                lastComposingAt = at;
            }
        },

        /** The composer lost focus, or its message was submitted. */
        stop() {
            if (!disposed) {
                sendStopped();
            }
        },

        /** Sends a pending `stopped` and cancels every timer. */
        dispose() {
            if (disposed) {
                return;
            }
            sendStopped();
            disposed = true;
            current = null;
        },
    };
}
