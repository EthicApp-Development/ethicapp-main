/**
 * Keeps an activity view current when its Socket.IO connection fails (#626).
 *
 * Phase transitions reach the student only as socket events, so a socket
 * that is down, or never connected (as inside an LMS iframe whose handshake
 * the browser or the edge refuses), used to leave the view frozen with no
 * sign of it. This controller:
 *
 * - reports the connection's status: `connecting` until the first connect,
 *   `connected`, `reconnecting` as soon as the connection is lost, and
 *   `disconnected` once it has stayed lost for `noticeDelayMs`, so a short
 *   reconnect on a classroom Wi-Fi never shows a notice;
 * - while the connection is lost, probes the activity on a throttled,
 *   backing-off schedule with jitter, and on the page becoming visible or
 *   focused, and refreshes it when the probe reports a change. A lost socket
 *   means slower updates, never a frozen view;
 * - refreshes the activity when the socket connects after having been lost,
 *   which recovers a transition missed meanwhile;
 * - updates it on demand (`updateNow`), for the view's "Update activity"
 *   action: it probes first, so the refresh flushes the server's caches only
 *   when the activity changed, and then holds further updates for
 *   `cooldownMs` (`failureCooldownMs` after a failure), so a student who
 *   keeps clicking costs one update per hold, and sees it confirmed.
 *
 * `refresh(request)` receives `{ invalidate }`: true when the activity
 * changed or may have (a reconnect, a probe that saw a change), which flushes
 * the server's caches as the socket's onPhaseTransition handler does; false
 * for an update with no change, which reloads from them. Those caches are
 * shared by the whole session's students, so they are flushed only when
 * needed.
 *
 * Refreshes never overlap: refreshes requested while one runs run once more
 * after it, however many were requested, flushing the caches if any of them
 * asked to. A probe is skipped while a refresh or another probe runs. Failed
 * probes and refreshes are left to the next attempt; `onError` receives
 * them.
 *
 * Timers, the clock and the random source are injectable for tests.
 */
export const REALTIME_STATUS = Object.freeze({
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  DISCONNECTED: 'disconnected'
});

export const REALTIME_FALLBACK_DEFAULTS = Object.freeze({
  noticeDelayMs: 8000,
  pollDelaysMs: Object.freeze([15000, 30000, 60000]),
  jitter: 0.2,
  minProbeGapMs: 5000,
  cooldownMs: 10000,
  failureCooldownMs: 3000
});

/**
 * @param {object} options
 * @param {(request: { invalidate: boolean }) => Promise<unknown>} options.refresh
 *     Reloads the activity.
 * @param {() => Promise<boolean>} options.probe - Whether the activity changed.
 * @param {(status: string) => void} [options.onStatus]
 * @param {(error: unknown, operation: string) => void} [options.onError]
 */
export function createRealtimeFallback({
  refresh,
  probe,
  onStatus = () => {},
  onError = () => {},
  timers = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (id) => clearTimeout(id) },
  now = () => Date.now(),
  random = () => Math.random(),
  options = {}
}) {
  const {
    noticeDelayMs, pollDelaysMs, jitter, minProbeGapMs, cooldownMs, failureCooldownMs
  } = { ...REALTIME_FALLBACK_DEFAULTS, ...options };

  let status = REALTIME_STATUS.CONNECTING;
  let lost = false;
  let disposed = false;
  let noticeTimer = null;
  let pollTimer = null;
  let pollStep = 0;
  let lastProbeAt = -Infinity;
  let probing = false;
  let refreshing = null;
  let queuedRequest = null;
  let updating = null;
  let updatesHeldUntil = -Infinity;

  function setStatus(next) {
    if (status !== next) {
      status = next;
      onStatus(next);
    }
  }

  function clearTimers() {
    if (noticeTimer !== null) timers.clearTimeout(noticeTimer);
    if (pollTimer !== null) timers.clearTimeout(pollTimer);
    noticeTimer = null;
    pollTimer = null;
  }

  // Resolves to whether the last refresh it ran succeeded.
  function runRefresh(request = { invalidate: true }) {
    if (disposed) return Promise.resolve(false);
    if (refreshing) {
      queuedRequest = { invalidate: Boolean(queuedRequest?.invalidate || request.invalidate) };
      return refreshing;
    }

    refreshing = (async () => {
      let succeeded = false;
      let next = { invalidate: Boolean(request.invalidate) };
      while (next && !disposed) {
        const current = next;
        try {
          await refresh(current);
          succeeded = true;
        } catch (error) {
          succeeded = false;
          onError(error, 'refresh');
        }
        next = queuedRequest;
        queuedRequest = null;
      }
      refreshing = null;
      return succeeded;
    })();
    return refreshing;
  }

  async function runProbe() {
    if (disposed || probing || refreshing) return;
    probing = true;
    lastProbeAt = now();
    let changed = false;
    try {
      changed = await probe();
    } catch (error) {
      onError(error, 'probe');
    } finally {
      probing = false;
    }
    if (changed && !disposed) {
      await runRefresh({ invalidate: true });
    }
  }

  function schedulePoll() {
    const base = pollDelaysMs[Math.min(pollStep, pollDelaysMs.length - 1)];
    const delay = Math.round(base * (1 + jitter * (2 * random() - 1)));
    pollStep += 1;
    pollTimer = timers.setTimeout(() => {
      pollTimer = null;
      if (!lost || disposed) return;
      runProbe().finally(() => {
        if (lost && !disposed && pollTimer === null) schedulePoll();
      });
    }, delay);
  }

  return {
    status: () => status,

    /** The socket connected: the first connect, or a reconnect. */
    connected() {
      if (disposed) return;
      const wasLost = lost;
      lost = false;
      pollStep = 0;
      clearTimers();
      setStatus(REALTIME_STATUS.CONNECTED);
      if (wasLost) {
        runRefresh({ invalidate: true });
      }
    },

    /** The connection failed or dropped (`disconnect`, `connect_error`). */
    lost() {
      if (disposed || lost) return;
      lost = true;
      pollStep = 0;
      setStatus(REALTIME_STATUS.RECONNECTING);
      noticeTimer = timers.setTimeout(() => {
        noticeTimer = null;
        if (lost && !disposed) setStatus(REALTIME_STATUS.DISCONNECTED);
      }, noticeDelayMs);
      schedulePoll();
    },

    /** The page became visible or focused. */
    pageVisible() {
      if (disposed || !lost || now() - lastProbeAt < minProbeGapMs) return;
      runProbe();
    },

    /**
     * The "Update activity" action. Resolves to `{ ok, changed, heldUntil }`:
     * whether the update succeeded, whether the activity had changed, and
     * the time until which further updates are held. An update requested
     * while one runs shares it; one requested while updates are held does
     * nothing and resolves to `{ ok: true, held: true, heldUntil }`. A probe
     * that fails counts as a change, so the update still reloads everything.
     */
    updateNow() {
      if (disposed) return Promise.resolve({ ok: false, changed: false, heldUntil: now() });
      if (updating) return updating;
      if (now() < updatesHeldUntil) {
        return Promise.resolve({ ok: true, changed: false, held: true, heldUntil: updatesHeldUntil });
      }

      updating = (async () => {
        let changed = true;
        try {
          changed = Boolean(await probe());
        } catch (error) {
          onError(error, 'probe');
        }
        lastProbeAt = now();
        const ok = await runRefresh({ invalidate: changed });
        updatesHeldUntil = now() + (ok ? cooldownMs : failureCooldownMs);
        updating = null;
        return { ok, changed, heldUntil: updatesHeldUntil };
      })();
      return updating;
    },

    /** Reloads the activity now, flushing the caches; resolves to whether it succeeded. */
    refreshNow() {
      return runRefresh({ invalidate: true });
    },

    dispose() {
      disposed = true;
      clearTimers();
    }
  };
}
