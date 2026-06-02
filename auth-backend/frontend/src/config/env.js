function removeTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

const runtimeConfig = typeof window !== 'undefined'
  ? window.__AUTH_RUNTIME_CONFIG__ || {}
  : {};

const runtimeAuthApiBaseUrl = (runtimeConfig.authApiBaseUrl || '').trim();
const viteAuthApiBaseUrl = (import.meta.env.VITE_AUTH_API_BASE_URL || '').trim();

const authApiBaseUrl = runtimeAuthApiBaseUrl
  ? removeTrailingSlash(runtimeAuthApiBaseUrl)
  : (
      viteAuthApiBaseUrl
        ? removeTrailingSlash(viteAuthApiBaseUrl)
        : '/api/auth'
    );

const recaptchaSiteKey = (
  runtimeConfig.recaptchaSiteKey ||
  import.meta.env.VITE_RECAPTCHA_SITE_KEY ||
  ''
).trim();

export { authApiBaseUrl, recaptchaSiteKey };
