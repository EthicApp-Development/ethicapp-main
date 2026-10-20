// What happens when an API call finds the session expired: one notice for the
// student, then a redirect to sign-in, however many calls fail at once.

export const SIGN_IN_PATH = '/auth/login';
export const SESSION_EXPIRY_REDIRECT_DELAY_MS = 2500;

/**
 * @param {object} options
 * @param {() => void} options.redirect
 * @param {(callback: () => void, delayMs: number) => unknown} [options.schedule]
 * @param {number} [options.delayMs]
 */
export function createSessionExpiryFlow({
  redirect,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  delayMs = SESSION_EXPIRY_REDIRECT_DELAY_MS
}) {
  let expiry = null;
  const listeners = new Set();

  return {
    /** Starts the flow; later calls are ignored. Returns whether this call started it. */
    start(details = {}) {
      if (expiry) {
        return false;
      }

      expiry = Object.freeze({ requestId: details.requestId ?? null });
      listeners.forEach((listener) => listener());
      schedule(redirect, delayMs);
      return true;
    },
    getSnapshot() {
      return expiry;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export const sessionExpiryFlow = createSessionExpiryFlow({
  redirect: () => window.location.assign(SIGN_IN_PATH)
});
