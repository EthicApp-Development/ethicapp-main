import { useEffect, useRef } from 'react';

let recaptchaLoader;

function loadRecaptchaScript() {
  if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
    return Promise.resolve(window.grecaptcha);
  }

  if (recaptchaLoader) {
    return recaptchaLoader;
  }

  recaptchaLoader = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(
      'script[src="https://www.google.com/recaptcha/api.js?render=explicit"]'
    );

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.grecaptcha));
      existingScript.addEventListener('error', () => reject(new Error('No se pudo cargar reCAPTCHA')));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.grecaptcha);
    script.onerror = () => reject(new Error('No se pudo cargar reCAPTCHA'));

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
        widgetIdRef.current = grecaptcha.render(containerRef.current, {
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
    if (widgetIdRef.current === null || !window.grecaptcha) {
      return;
    }

    window.grecaptcha.reset(widgetIdRef.current);
  }, [resetCounter]);

  if (!siteKey) {
    return null;
  }

  return (
    <div className="mb-3">
      <div ref={containerRef} />
      {error ? <div className="invalid-feedback d-block">{error}</div> : null}
    </div>
  );
}

export default RecaptchaField;
