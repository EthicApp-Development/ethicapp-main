export const APP_BASE_PATH = '/mng';
export const recaptchaSiteKey = (
  window.__MNG_RUNTIME_CONFIG__?.recaptchaSiteKey ||
  import.meta.env.VITE_RECAPTCHA_SITE_KEY ||
  ''
).trim();
