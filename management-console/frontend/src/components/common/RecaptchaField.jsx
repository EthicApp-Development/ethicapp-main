import PropTypes from 'prop-types';
import { useEffect, useRef } from 'react';

const RECAPTCHA_CLASSIC_PROVIDER = 'classic';
const RECAPTCHA_ENTERPRISE_PROVIDER = 'enterprise';
const RECAPTCHA_CLASSIC_SCRIPT_URL =
  'https://www.google.com/recaptcha/api.js?render=explicit';
const RECAPTCHA_ENTERPRISE_SCRIPT_URL =
  'https://www.google.com/recaptcha/enterprise.js?render=explicit';

const recaptchaLoaders = {};

function normalizeProvider(provider) {
  return provider === RECAPTCHA_ENTERPRISE_PROVIDER
    ? RECAPTCHA_ENTERPRISE_PROVIDER
    : RECAPTCHA_CLASSIC_PROVIDER;
}

function getRecaptchaApi(provider) {
  const grecaptcha = window.grecaptcha;

  if (provider === RECAPTCHA_ENTERPRISE_PROVIDER) {
    return grecaptcha?.enterprise || null;
  }

  return grecaptcha || null;
}

function getRecaptchaScriptUrl(provider) {
  return provider === RECAPTCHA_ENTERPRISE_PROVIDER
    ? RECAPTCHA_ENTERPRISE_SCRIPT_URL
    : RECAPTCHA_CLASSIC_SCRIPT_URL;
}

function waitForRecaptchaApi(provider, resolve, reject) {
  const grecaptcha = window.grecaptcha;

  if (!grecaptcha) {
    reject(new Error('reCAPTCHA API did not initialize'));
    return;
  }

  const resolveWhenRenderable = () => {
    if (typeof getRecaptchaApi(provider)?.render === 'function') {
      resolve(window.grecaptcha);
      return;
    }

    reject(new Error('reCAPTCHA render API is not available'));
  };

  const recaptchaApi = getRecaptchaApi(provider);
  if (typeof recaptchaApi?.ready === 'function') {
    recaptchaApi.ready(resolveWhenRenderable);
    return;
  }

  resolveWhenRenderable();
}

function loadRecaptchaScript(provider) {
  const normalizedProvider = normalizeProvider(provider);
  const scriptUrl = getRecaptchaScriptUrl(normalizedProvider);

  if (typeof getRecaptchaApi(normalizedProvider)?.render === 'function') {
    console.debug(
      `[management-console] reCAPTCHA ${normalizedProvider} API already available`
    );
    return Promise.resolve(window.grecaptcha);
  }

  if (recaptchaLoaders[normalizedProvider]) {
    console.debug(
      `[management-console] reusing pending reCAPTCHA ${normalizedProvider} loader`
    );
    return recaptchaLoaders[normalizedProvider];
  }

  recaptchaLoaders[normalizedProvider] = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(
      `script[src="${scriptUrl}"]`
    );

    if (existingScript) {
      console.debug(
        `[management-console] waiting for existing reCAPTCHA ${normalizedProvider} script`
      );
      if (window.grecaptcha) {
        waitForRecaptchaApi(normalizedProvider, resolve, reject);
        return;
      }

      existingScript.addEventListener('load', () => {
        console.debug(
          `[management-console] existing reCAPTCHA ${normalizedProvider} script loaded`
        );
        waitForRecaptchaApi(normalizedProvider, resolve, reject);
      });
      existingScript.addEventListener('error', () => {
        console.warn(
          `[management-console] existing reCAPTCHA ${normalizedProvider} script failed to load`
        );
        reject(new Error('Unable to load reCAPTCHA'));
      });
      return;
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      console.debug(`[management-console] reCAPTCHA ${normalizedProvider} script loaded`);
      waitForRecaptchaApi(normalizedProvider, resolve, reject);
    };
    script.onerror = () => {
      console.warn(`[management-console] reCAPTCHA ${normalizedProvider} script failed to load`);
      reject(new Error('Unable to load reCAPTCHA'));
    };

    console.debug(`[management-console] loading reCAPTCHA ${normalizedProvider} script`);
    document.head.appendChild(script);
  });

  return recaptchaLoaders[normalizedProvider];
}

function RecaptchaField({
  provider = RECAPTCHA_CLASSIC_PROVIDER,
  siteKey,
  onChange,
  resetCounter = 0
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const normalizedProvider = normalizeProvider(provider);

  useEffect(() => {
    let isMounted = true;

    async function initializeRecaptcha() {
      console.debug('[management-console] initializing reCAPTCHA field', {
        siteKeyConfigured: Boolean(siteKey),
        containerReady: Boolean(containerRef.current)
      });

      if (!siteKey || !containerRef.current) {
        console.warn('[management-console] reCAPTCHA field skipped', {
          siteKeyConfigured: Boolean(siteKey),
          containerReady: Boolean(containerRef.current)
        });
        return;
      }

      const grecaptcha = await loadRecaptchaScript(normalizedProvider);
      if (!isMounted || !grecaptcha) {
        console.warn('[management-console] reCAPTCHA field stopped before render', {
          isMounted,
          grecaptchaAvailable: Boolean(grecaptcha)
        });
        return;
      }

      const recaptchaApi = getRecaptchaApi(normalizedProvider);
      if (widgetIdRef.current === null) {
        console.debug('[management-console] rendering reCAPTCHA widget');
        widgetIdRef.current = recaptchaApi.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onChange(token),
          'expired-callback': () => onChange(''),
          'error-callback': () => onChange('')
        });
        console.debug('[management-console] reCAPTCHA widget rendered', {
          widgetId: widgetIdRef.current
        });
      }
    }

    initializeRecaptcha().catch((error) => {
      console.warn('[management-console] reCAPTCHA initialization failed', error);
      onChange('');
    });

    return () => {
      isMounted = false;
    };
  }, [normalizedProvider, onChange, siteKey]);

  useEffect(() => {
    const recaptchaApi = getRecaptchaApi(normalizedProvider);
    if (widgetIdRef.current === null || !recaptchaApi) {
      return;
    }

    recaptchaApi.reset(widgetIdRef.current);
  }, [normalizedProvider, resetCounter]);

  if (!siteKey) {
    console.warn('[management-console] reCAPTCHA field hidden because site key is not configured');
    return null;
  }

  return <div ref={containerRef} />;
}

RecaptchaField.propTypes = {
  onChange: PropTypes.func.isRequired,
  provider: PropTypes.oneOf([
    RECAPTCHA_CLASSIC_PROVIDER,
    RECAPTCHA_ENTERPRISE_PROVIDER
  ]),
  resetCounter: PropTypes.number,
  siteKey: PropTypes.string.isRequired
};

export default RecaptchaField;
