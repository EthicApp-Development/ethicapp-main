/**
 * When the student app loads the published external-service results of an
 * activity (epic #1123, #1128): when the activity opens, after a phase
 * transition and after the socket reconnects. Socket.IO does not replay
 * room emits, so a reconnect load catches up with results published while
 * the socket was down.
 */

/**
 * Whether the current phase moved from one phase of a session to another of
 * the same session. The first phase seen, and a change of session, are
 * covered by the load made when the activity opens.
 * @param {{ sessionId: number, phaseId: number|null }|null} previous
 * @param {{ sessionId: number, phaseId: number|null }} next
 * @returns {boolean}
 */
export function isPhaseTransition(previous, next) {
  const previousPhaseId = Number(previous?.phaseId);
  const nextPhaseId = Number(next?.phaseId);

  return Number.isInteger(previousPhaseId)
    && previousPhaseId > 0
    && Number.isInteger(nextPhaseId)
    && nextPhaseId > 0
    && previousPhaseId !== nextPhaseId
    && Number(previous?.sessionId) === Number(next?.sessionId);
}

/**
 * Tells a reconnect from the first connection of a socket. A socket that is
 * already connected when the tracker is created has had its first
 * connection, so its next `connect` is a reconnect.
 * @param {{ connected?: boolean }} [options]
 */
export function createReconnectTracker({ connected = false } = {}) {
  let hasConnected = Boolean(connected);

  return {
    /** @returns {boolean} whether this `connect` is a reconnect. */
    handleConnect() {
      const isReconnect = hasConnected;
      hasConnected = true;
      return isReconnect;
    }
  };
}

/**
 * Orders the answers of overlapping loads. Each load takes a ticket when it
 * starts; its answer is applied only when no later load has been applied
 * already, so a slow older answer never replaces a newer one. `reset()`
 * discards every load in flight, for a change of activity.
 */
export function createLoadSequencer() {
  let issued = 0;
  let applied = 0;

  return {
    begin() {
      issued += 1;
      return issued;
    },
    /** @returns {boolean} whether the answer of `ticket` may be applied. */
    accept(ticket) {
      if (!Number.isInteger(ticket) || ticket <= applied) {
        return false;
      }

      applied = ticket;
      return true;
    },
    reset() {
      applied = issued;
    }
  };
}

function sameTarget(left, right) {
  return Number(left?.sessionId) === Number(right?.sessionId)
    && Number(left?.userId) === Number(right?.userId);
}

/**
 * Loads a student's results of one activity on each trigger, in order.
 *
 * - `open(target)` when the activity can be loaded (`{ sessionId, userId }`),
 *   or `open(null)` when it cannot (signed out, not started yet). A new
 *   target loads at once; another activity, or none, discards the loads in
 *   flight.
 * - `phaseChanged({ sessionId, phaseId })` with the current phase of an
 *   activity, whenever it is known; a transition of the open activity loads.
 * - `reconnected()` after the socket reconnects; it loads.
 *
 * `applyResults(results)` receives the answer of a load unless a later load
 * was applied first. `reportFailure(error, target)` receives a failed load;
 * nothing is applied, so the results already shown stay.
 *
 * @param {object} options
 * @param {(target: { sessionId: number, userId: number }) => Promise<object[]>}
 *     options.fetchResults
 * @param {(results: object[]) => void} options.applyResults
 * @param {(error: unknown, target: object) => void} [options.reportFailure]
 */
export function createExternalResultsLoader({
  fetchResults,
  applyResults,
  reportFailure = () => {}
}) {
  const sequencer = createLoadSequencer();
  let target = null;
  let lastPhase = null;

  function load() {
    if (!target) {
      return;
    }

    const loadTarget = target;
    const ticket = sequencer.begin();

    Promise.resolve()
      .then(() => fetchResults(loadTarget))
      .then((results) => {
        if (sequencer.accept(ticket)) {
          applyResults(results);
        }
      }, (error) => {
        reportFailure(error, loadTarget);
      });
  }

  return {
    open(nextTarget) {
      const next = nextTarget && Number(nextTarget.sessionId) > 0 && Number(nextTarget.userId) > 0
        ? { sessionId: Number(nextTarget.sessionId), userId: Number(nextTarget.userId) }
        : null;

      if (!next || !target || !sameTarget(target, next)) {
        sequencer.reset();
      }

      target = next;
      load();
    },
    phaseChanged({ sessionId, phaseId } = {}) {
      const next = { sessionId: Number(sessionId), phaseId: Number(phaseId) };

      if (!Number.isInteger(next.phaseId) || next.phaseId <= 0) {
        return;
      }

      const previous = lastPhase;
      lastPhase = next;

      if (isPhaseTransition(previous, next) && target?.sessionId === next.sessionId) {
        load();
      }
    },
    reconnected() {
      load();
    }
  };
}
