function removeTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

const viteAuthApiBaseUrl = (import.meta.env.VITE_AUTH_API_BASE_URL || '').trim();

// Siempre fallback a ruta relativa
const authApiBaseUrl = viteAuthApiBaseUrl
  ? removeTrailingSlash(viteAuthApiBaseUrl)
  : '/api/auth';

const recaptchaSiteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY || '').trim();

export { authApiBaseUrl, recaptchaSiteKey };