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

export function redirectToLogin() {
  if (typeof window === 'undefined') {
    return;
  }

  if (!LOGIN_PATHS.has(window.location.pathname)) {
    window.location.assign(LOGIN_PATH);
  }
}
