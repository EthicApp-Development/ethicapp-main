// The phase clock as the teacher's dashboard keeps it (#1116, epic #1105).
//
// The server sends the clock in the answer of GET /activities/:id/clock and
// in the `onPhaseClock` socket event, with the shape documented in
// backend/helpers/phase-clock.js:
//
//     { sessionId, timeMode, finished, phaseId, phaseNumber, startedAt,
//       endsAt, isLastPhase, serverNow }
//
// The dashboard keeps the latest one per activity (ActivityStateService
// .getPhaseClock), with two fields of its own:
//
//     offsetMs:   Date.parse(serverNow) - the local time when it arrived,
//                 so `Date.now() + offsetMs` estimates the server's time;
//     receivedAt: the local time when it arrived, in ms.
//
// A clock that arrives late is ignored: one of another activity, one of an
// earlier phase than the clock already kept, one of a phase of an activity
// already finished, and one read before the clock already kept (its
// `serverNow` is earlier), such as a GET that resolves after the
// `onPhaseClock` of a "+1 min".

function timeMs(value) {
    if (typeof value !== "string" || value === "") {
        return null;
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
}

/**
 * The server's time minus the local time, in ms; 0 when `serverNow` is not
 * a valid time.
 *
 * @param {string} serverNow ISO 8601.
 * @param {number} localNowMs
 * @returns {number}
 */
export function clockOffsetMs(serverNow, localNowMs) {
    const serverMs = timeMs(serverNow);
    return serverMs === null ? 0 : serverMs - localNowMs;
}

/**
 * The server's time estimated from the local clock and a kept clock's
 * offset.
 *
 * @param {Object|null} phaseClock A kept clock, or null for no offset.
 * @param {number} localNowMs
 * @returns {number}
 */
export function serverTimeMs(phaseClock, localNowMs) {
    const offset = Number(phaseClock?.offsetMs);
    return localNowMs + (Number.isFinite(offset) ? offset : 0);
}

/**
 * Whether `payload` belongs to the activity of `sessionId`; the teacher's
 * socket may be in the rooms of several activities.
 *
 * @param {Object} payload An event with a `sessionId`.
 * @param {number|string} sessionId
 * @returns {boolean}
 */
export function isSessionEvent(payload, sessionId) {
    const eventSession = Number(payload?.sessionId);
    return Number.isInteger(eventSession) && eventSession > 0
        && eventSession === Number(sessionId);
}

// How far the activity has gone: its phase number, 0 before the first
// phase, and past every phase once finished.
function progress(clock) {
    if (clock.finished === true) {
        return Number.POSITIVE_INFINITY;
    }
    const number = Number(clock.phaseNumber);
    return Number.isFinite(number) ? number : 0;
}

/**
 * The clock to keep after `incoming` arrives: `incoming` with its offset,
 * or `current` when `incoming` is not for this activity or is older.
 *
 * @param {Object|null} current The clock kept so far.
 * @param {Object} incoming A clock from the server.
 * @param {Object} options
 * @param {number|string} options.sessionId The dashboard's activity.
 * @param {number} options.localNowMs The local time when it arrived.
 * @returns {{ accepted: boolean, clock: Object|null }}
 */
export function nextPhaseClock(current, incoming, { sessionId, localNowMs }) {
    const rejected = { accepted: false, clock: current ?? null };
    if (!incoming || typeof incoming !== "object" || !isSessionEvent(incoming, sessionId)) {
        return rejected;
    }

    if (current) {
        const incomingProgress = progress(incoming);
        const currentProgress = progress(current);
        if (incomingProgress < currentProgress) {
            return rejected;
        }
        const incomingRead = timeMs(incoming.serverNow);
        const currentRead = timeMs(current.serverNow);
        if (incomingProgress === currentProgress && incomingRead !== null
            && currentRead !== null && incomingRead < currentRead) {
            return rejected;
        }
    }

    return {
        accepted: true,
        clock:    {
            ...incoming,
            offsetMs:   clockOffsetMs(incoming.serverNow, localNowMs),
            receivedAt: localNowMs,
        },
    };
}

/**
 * Whether the deadline of a kept clock has passed, by the server's time.
 * False without a deadline.
 *
 * @param {Object|null} phaseClock
 * @param {number} localNowMs
 * @returns {boolean}
 */
export function deadlinePassed(phaseClock, localNowMs) {
    const endsAt = timeMs(phaseClock?.endsAt);
    return endsAt !== null && endsAt <= serverTimeMs(phaseClock, localNowMs);
}
