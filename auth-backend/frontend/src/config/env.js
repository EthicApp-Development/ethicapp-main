function removeTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

const viteAuthApiBaseUrl = (import.meta.env.VITE_AUTH_API_BASE_URL || '').trim();
const viteAuthPublicUrl = (import.meta.env.VITE_AUTH_PUBLIC_URL || '').trim();

const authApiBaseUrl = viteAuthApiBaseUrl
  ? removeTrailingSlash(viteAuthApiBaseUrl)
  : viteAuthPublicUrl
    ? `${removeTrailingSlash(viteAuthPublicUrl)}/api/auth`
    : '/api/auth';

const recaptchaSiteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY || '').trim();

export { authApiBaseUrl, recaptchaSiteKey };
