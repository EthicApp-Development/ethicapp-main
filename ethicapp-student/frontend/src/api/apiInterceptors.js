import { API_ERROR_KINDS, classifyApiError, isHtmlResponse } from './apiErrors.js';

// Sign-in and auth API calls handle their own 401s; reacting to them would
// loop back into the sign-in flow.
const AUTH_PATH_PATTERN = /^\/(?:api\/)?auth(?:\/|$)/;

export function resolveRequestPath(config) {
  const base = new URL(config?.baseURL || '/', 'http://localhost');
  return new URL(String(config?.url ?? ''), base).pathname;
}

export function isAuthEndpoint(config) {
  return AUTH_PATH_PATTERN.test(resolveRequestPath(config));
}

function createHtmlResponseError(response) {
  const error = new Error('The API call received an HTML page instead of JSON.');
  error.name = 'HtmlResponseError';
  error.code = 'ERR_HTML_RESPONSE';
  error.isAxiosError = true;
  error.config = response.config;
  error.response = response;
  return error;
}

/**
 * Adds the shared error handling to an Axios instance. Every failure still
 * reaches the caller; an expired session additionally calls `onExpired`, with
 * the request's `expiryReturnTo` config option as the place to come back to
 * after signing in.
 * A successful response with an HTML body is turned into a failure, because
 * an API call only receives a page when the session was redirected away.
 * @param {import('axios').AxiosInstance} instance
 * @param {{ onExpired: (details: { requestId: string|null, returnTo: string|null }) => void }} handlers
 */
export function installApiErrorInterceptors(instance, { onExpired }) {
  const handleError = (error) => {
    const { kind, requestId } = classifyApiError(error);

    if (kind === API_ERROR_KINDS.EXPIRED && !isAuthEndpoint(error?.config)) {
      onExpired({ requestId, returnTo: error?.config?.expiryReturnTo ?? null });
    }

    return Promise.reject(error);
  };

  instance.interceptors.response.use((response) => {
    if (isHtmlResponse(response) && !isAuthEndpoint(response.config)) {
      return handleError(createHtmlResponseError(response));
    }

    return response;
  }, handleError);

  return instance;
}
