// An expired session returns the student to manual session selection after
// sign-in. Synchronous classroom activities require an explicit choice of
// session rather than automatically reopening the previous activity or code.

export const SIGN_IN_PATH = '/auth/login';
export const SESSION_EXPIRY_REDIRECT_DELAY_MS = 2500;

/**
 * @param {object} options
 * @param {(signInUrl: string) => void} options.redirect
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
    /** Starts one notice and one redirect to sign-in and manual session selection. */
    start(details = {}) {
      if (expiry) {
        return false;
      }

      expiry = Object.freeze({
        requestId: details.requestId ?? null
      });
      listeners.forEach((listener) => listener());
      schedule(() => redirect(SIGN_IN_PATH), delayMs);
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
  redirect: (signInUrl) => window.location.assign(signInUrl)
});
