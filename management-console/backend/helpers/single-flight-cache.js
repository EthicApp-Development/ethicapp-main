// Wraps an async task so that concurrent callers share one in-flight run and
// callers within `cooldownMs` of the last successful run get its cached result.
// Failed runs are not cached, so the next call retries immediately.
export function createSingleFlightCache(task, { cooldownMs, now = Date.now }) {
  let inFlight = null;
  let lastResult = null;
  let lastCompletedAt = -Infinity;

  return function run() {
    if (inFlight) {
      return inFlight;
    }

    if (lastResult && now() - lastCompletedAt < cooldownMs) {
      return Promise.resolve(lastResult);
    }

    inFlight = Promise.resolve()
      .then(task)
      .then((result) => {
        lastResult = result;
        lastCompletedAt = now();
        return result;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };
}
