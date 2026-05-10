export const APP_BASE_PATH = '/mng';
export const recaptchaSiteKey = (
  window.__MNG_RUNTIME_CONFIG__?.recaptchaSiteKey ||
  import.meta.env.VITE_RECAPTCHA_SITE_KEY ||
  ''
).trim();

console.debug('[management-console] recaptcha configuration', {
  runtimeConfigPresent: Boolean(window.__MNG_RUNTIME_CONFIG__),
  runtimeSiteKeyConfigured: Boolean(window.__MNG_RUNTIME_CONFIG__?.recaptchaSiteKey),
  viteSiteKeyConfigured: Boolean(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
  effectiveSiteKeyConfigured: Boolean(recaptchaSiteKey)
});
