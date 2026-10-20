// What happens when an API call finds the session expired: one notice for the
// student, then a redirect to sign-in, however many calls fail at once.
// Sign-in receives a returnTo so the student comes back to what they were
// doing; auth-backend validates it against its allowlist.

export const SIGN_IN_PATH = '/auth/login';
export const SESSION_EXPIRY_REDIRECT_DELAY_MS = 2500;

export function buildSignInUrl(returnTo) {
  return returnTo ? `${SIGN_IN_PATH}?returnTo=${encodeURIComponent(returnTo)}` : SIGN_IN_PATH;
}

/** Current location when it is inside the student app, otherwise null. */
export function currentStudentLocation(location = globalThis.window?.location) {
  const path = `${location?.pathname ?? ''}${location?.search ?? ''}`;
  return path.startsWith('/student/') ? path : null;
}

/**
 * @param {object} options
 * @param {(signInUrl: string) => void} options.redirect
 * @param {() => string|null} [options.currentLocation] Return target when the
 *   failed call did not name one.
 * @param {(callback: () => void, delayMs: number) => unknown} [options.schedule]
 * @param {number} [options.delayMs]
 */
export function createSessionExpiryFlow({
  redirect,
  currentLocation = () => null,
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

      const returnTo = details.returnTo ?? currentLocation();
      expiry = Object.freeze({
        requestId: details.requestId ?? null,
        returnTo,
        signInUrl: buildSignInUrl(returnTo)
      });
      listeners.forEach((listener) => listener());
      schedule(() => redirect(expiry.signInUrl), delayMs);
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
  redirect: (signInUrl) => window.location.assign(signInUrl),
  currentLocation: () => currentStudentLocation()
});
