import { useEffect, useRef } from 'react';

const RECAPTCHA_ENTERPRISE_SCRIPT_URL =
  'https://www.google.com/recaptcha/enterprise.js?render=explicit';

let recaptchaLoader;

function waitForRecaptchaEnterpriseApi(resolve, reject) {
  const grecaptcha = window.grecaptcha;

  if (!grecaptcha) {
    reject(new Error('reCAPTCHA Enterprise API did not initialize'));
    return;
  }

  const resolveWhenRenderable = () => {
    if (typeof window.grecaptcha?.enterprise?.render === 'function') {
      resolve(window.grecaptcha);
      return;
    }

    reject(new Error('reCAPTCHA Enterprise render API is not available'));
  };

  if (typeof grecaptcha.enterprise?.ready === 'function') {
    grecaptcha.enterprise.ready(resolveWhenRenderable);
    return;
  }

  resolveWhenRenderable();
}

function loadRecaptchaScript() {
  if (typeof window.grecaptcha?.enterprise?.render === 'function') {
    return Promise.resolve(window.grecaptcha);
  }

  if (recaptchaLoader) {
    return recaptchaLoader;
  }

  recaptchaLoader = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(
      `script[src="${RECAPTCHA_ENTERPRISE_SCRIPT_URL}"]`
    );

    if (existingScript) {
      if (window.grecaptcha) {
        waitForRecaptchaEnterpriseApi(resolve, reject);
        return;
      }

      existingScript.addEventListener('load', () => {
        waitForRecaptchaEnterpriseApi(resolve, reject);
      });
      existingScript.addEventListener('error', () => {
        reject(new Error('No se pudo cargar reCAPTCHA Enterprise'));
      });
      return;
    }

    const script = document.createElement('script');
    script.src = RECAPTCHA_ENTERPRISE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => waitForRecaptchaEnterpriseApi(resolve, reject);
    script.onerror = () => reject(new Error('No se pudo cargar reCAPTCHA Enterprise'));

    document.head.appendChild(script);
  });

  return recaptchaLoader;
}

function RecaptchaField({ siteKey, onChange, resetCounter = 0, error = '' }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    async function initRecaptcha() {
      if (!siteKey || !containerRef.current) {
        return;
      }

      const grecaptcha = await loadRecaptchaScript();
      if (!isMounted || !grecaptcha) {
        return;
      }

      if (widgetIdRef.current === null) {
        widgetIdRef.current = grecaptcha.enterprise.render(containerRef.current, {
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
  }, [onChange, siteKey]);

  useEffect(() => {
    if (widgetIdRef.current === null || !window.grecaptcha?.enterprise) {
      return;
    }

    window.grecaptcha.enterprise.reset(widgetIdRef.current);
  }, [resetCounter]);

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
