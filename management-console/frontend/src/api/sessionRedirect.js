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
