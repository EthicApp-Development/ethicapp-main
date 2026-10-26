const LOGIN_PATH = '/auth/login';
const LOGIN_PATHS = new Set([LOGIN_PATH, '/login']);

function getResponsePath(response) {
  if (!response?.url || typeof window === 'undefined') {
    return '';
  }

  try {
    return new URL(response.url, window.location.origin).pathname;
  } catch {
    return '';
  }
}

export function isLoginResponse(response) {
  return LOGIN_PATHS.has(getResponsePath(response));
}

// The edge answers an API call without a valid session with
// 401 {"status":"expired"} (nginx @auth_redirect), or the browser follows a
// redirect to the login page. A 401 whose JSON body carries an `error` comes
// from the console backend instead: a refused step-up confirmation (wrong
// password or passkey, PASSKEY_REQUIRED), which the page must show in place.
export function isSessionExpiredResponse(response, body) {
  if (isLoginResponse(response)) {
    return true;
  }

  return response.status === 401 && typeof body?.error !== 'string';
}

export function redirectToLogin({ notice = '' } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!LOGIN_PATHS.has(window.location.pathname)) {
    const loginUrl = new URL(LOGIN_PATH, window.location.origin);

    if (notice) {
      loginUrl.searchParams.set('notice', notice);
    }

    window.location.assign(`${loginUrl.pathname}${loginUrl.search}`);
  }
}
