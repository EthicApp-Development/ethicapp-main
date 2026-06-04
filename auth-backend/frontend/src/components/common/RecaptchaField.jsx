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
    return Promise.resolve(window.grecaptcha);
  }

  if (recaptchaLoaders[normalizedProvider]) {
    return recaptchaLoaders[normalizedProvider];
  }

  recaptchaLoaders[normalizedProvider] = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(
      `script[src="${scriptUrl}"]`
    );

    if (existingScript) {
      if (window.grecaptcha) {
        waitForRecaptchaApi(normalizedProvider, resolve, reject);
        return;
      }

      existingScript.addEventListener('load', () => {
        waitForRecaptchaApi(normalizedProvider, resolve, reject);
      });
      existingScript.addEventListener('error', () => {
        reject(new Error('No se pudo cargar reCAPTCHA'));
      });
      return;
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.defer = true;
    script.onload = () => waitForRecaptchaApi(normalizedProvider, resolve, reject);
    script.onerror = () => reject(new Error('No se pudo cargar reCAPTCHA'));

    document.head.appendChild(script);
  });

  return recaptchaLoaders[normalizedProvider];
}

function RecaptchaField({
  provider = RECAPTCHA_CLASSIC_PROVIDER,
  siteKey,
  onChange,
  resetCounter = 0,
  error = ''
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const normalizedProvider = normalizeProvider(provider);

  useEffect(() => {
    let isMounted = true;

    async function initRecaptcha() {
      if (!siteKey || !containerRef.current) {
        return;
      }

      const grecaptcha = await loadRecaptchaScript(normalizedProvider);
      if (!isMounted || !grecaptcha) {
        return;
      }

      const recaptchaApi = getRecaptchaApi(normalizedProvider);
      if (widgetIdRef.current === null) {
        widgetIdRef.current = recaptchaApi.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onChange(token),
          'expired-callback': () => onChange(''),
          'error-callback': () => onChange('')
        });
      }
    }

    initRecaptcha().catch(() => {
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
    return null;
  }

  return (
    <div className="mb-3 text-center">
      <div
        ref={containerRef}
        style={{ display: 'inline-block', margin: '1rem 0' }}
      />
      {error ? <div className="invalid-feedback d-block">{error}</div> : null}
    </div>
  );
}

export default RecaptchaField;
