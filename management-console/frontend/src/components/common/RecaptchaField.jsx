import PropTypes from 'prop-types';
import { useEffect, useRef } from 'react';

let recaptchaLoader;

function waitForRecaptchaApi(resolve, reject) {
  const grecaptcha = window.grecaptcha;

  if (!grecaptcha) {
    reject(new Error('reCAPTCHA API did not initialize'));
    return;
  }

  const resolveWhenRenderable = () => {
    if (typeof window.grecaptcha?.render === 'function') {
      resolve(window.grecaptcha);
      return;
    }

    reject(new Error('reCAPTCHA render API is not available'));
  };

  if (typeof grecaptcha.ready === 'function') {
    grecaptcha.ready(resolveWhenRenderable);
    return;
  }

  resolveWhenRenderable();
}

function loadRecaptchaScript() {
  if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
    console.debug('[management-console] reCAPTCHA API already available');
    return Promise.resolve(window.grecaptcha);
  }

  if (recaptchaLoader) {
    console.debug('[management-console] reusing pending reCAPTCHA loader');
    return recaptchaLoader;
  }

  recaptchaLoader = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(
      'script[src="https://www.google.com/recaptcha/api.js?render=explicit"]'
    );

    if (existingScript) {
      console.debug('[management-console] waiting for existing reCAPTCHA script');
      if (window.grecaptcha) {
        waitForRecaptchaApi(resolve, reject);
        return;
      }

      existingScript.addEventListener('load', () => {
        console.debug('[management-console] existing reCAPTCHA script loaded');
        waitForRecaptchaApi(resolve, reject);
      });
      existingScript.addEventListener('error', () => {
        console.warn('[management-console] existing reCAPTCHA script failed to load');
        reject(new Error('Unable to load reCAPTCHA'));
      });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      console.debug('[management-console] reCAPTCHA script loaded');
      waitForRecaptchaApi(resolve, reject);
    };
    script.onerror = () => {
      console.warn('[management-console] reCAPTCHA script failed to load');
      reject(new Error('Unable to load reCAPTCHA'));
    };

    console.debug('[management-console] loading reCAPTCHA script');
    document.head.appendChild(script);
  });

  return recaptchaLoader;
}

function RecaptchaField({ siteKey, onChange, resetCounter = 0 }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

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

      const grecaptcha = await loadRecaptchaScript();
      if (!isMounted || !grecaptcha) {
        console.warn('[management-console] reCAPTCHA field stopped before render', {
          isMounted,
          grecaptchaAvailable: Boolean(grecaptcha)
        });
        return;
      }

      if (widgetIdRef.current === null) {
        console.debug('[management-console] rendering reCAPTCHA widget');
        widgetIdRef.current = grecaptcha.render(containerRef.current, {
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
  }, [onChange, siteKey]);

  useEffect(() => {
    if (widgetIdRef.current === null || !window.grecaptcha) {
      return;
    }

    window.grecaptcha.reset(widgetIdRef.current);
  }, [resetCounter]);

  if (!siteKey) {
    console.warn('[management-console] reCAPTCHA field hidden because site key is not configured');
    return null;
  }

  return <div ref={containerRef} />;
}

RecaptchaField.propTypes = {
  onChange: PropTypes.func.isRequired,
  resetCounter: PropTypes.number,
  siteKey: PropTypes.string.isRequired
};

export default RecaptchaField;
