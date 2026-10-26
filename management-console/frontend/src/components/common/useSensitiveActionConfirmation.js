import { startAuthentication } from '@simplewebauthn/browser';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchPasskeys, startPasskeyAuthentication } from '../../api/profileApi.js';
import { recaptchaProvider, recaptchaSiteKey } from '../../config/env.js';
import {
  CONFIRMATION_METHODS,
  attemptConfirmation,
  canSubmitConfirmation,
  passkeysSupported
} from './sensitiveActionConfirmation.js';

async function requestPasskeyAssertion() {
  const options = await startPasskeyAuthentication();
  return startAuthentication({ optionsJSON: options });
}

const CANCELLED = Object.freeze({ confirmed: false });

// Asks the administrator to confirm a sensitive action in a dialog: with
// their passkey when they have one, otherwise with their password and
// reCAPTCHA. Render <SensitiveActionConfirmModal {...modalProps} /> once.
//
// requestConfirmation({ title, description, details, confirmLabel,
// confirmVariant, action }) opens the dialog and resolves to
// { confirmed: true, result } once `action(stepUp)` succeeded, or to
// { confirmed: false } when the administrator cancels; nothing is sent then.
// `stepUp` holds the fields to merge into the request body. A refused
// confirmation stays in the dialog for another try; any other error of the
// action closes it and rejects, for the caller to report.
//
// `loadPasskeys` must be a stable function (it is read on mount).
export function useSensitiveActionConfirmation({ loadPasskeys = fetchPasskeys } = {}) {
  const [method, setMethod] = useState(CONFIRMATION_METHODS.loading);
  const [show, setShow] = useState(false);
  // Kept after closing, so the dialog keeps its text while it fades out.
  const [texts, setTexts] = useState({});
  const [password, setPassword] = useState('');
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [recaptchaResetCounter, setRecaptchaResetCounter] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState('');
  const pendingRef = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let active = true;

    loadPasskeys()
      .then((result) => {
        if (active) {
          const hasPasskeys = (result?.passkeys || []).length > 0;
          setMethod(hasPasskeys ? CONFIRMATION_METHODS.passkey : CONFIRMATION_METHODS.password);
        }
      })
      .catch(() => {
        // The backend still enforces the passkey: PASSKEY_REQUIRED switches
        // the dialog to it.
        if (active) {
          setMethod(CONFIRMATION_METHODS.password);
        }
      });

    return () => {
      active = false;
    };
  }, [loadPasskeys]);

  const resetFields = useCallback(() => {
    setPassword('');
    setRecaptchaToken('');
    setRecaptchaResetCounter((counter) => counter + 1);
  }, []);

  const close = useCallback(() => {
    pendingRef.current = null;
    setShow(false);
  }, []);

  const requestConfirmation = useCallback(({ action, ...dialogTexts }) => new Promise((resolve, reject) => {
    pendingRef.current?.resolve(CANCELLED);
    pendingRef.current = { action, resolve, reject };
    setTexts(dialogTexts);
    setErrorKey('');
    resetFields();
    setShow(true);
  }), [resetFields]);

  const onCancel = useCallback(() => {
    if (busyRef.current) {
      return;
    }
    pendingRef.current?.resolve(CANCELLED);
    close();
  }, [close]);

  const passkeySupport = passkeysSupported(typeof window === 'undefined' ? undefined : window);
  const canConfirm = canSubmitConfirmation({
    method,
    busy,
    password,
    recaptchaToken,
    recaptchaRequired: Boolean(recaptchaSiteKey),
    passkeySupport
  });

  const onConfirm = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending || busyRef.current || !canConfirm) {
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setErrorKey('');

    try {
      const outcome = await attemptConfirmation({
        method,
        password,
        recaptchaToken,
        getPasskeyAssertion: requestPasskeyAssertion,
        action: pending.action
      });

      if (outcome.status === 'done') {
        close();
        pending.resolve({ confirmed: true, result: outcome.result });
        return;
      }

      setErrorKey(outcome.errorKey);
      setMethod(outcome.method);
      resetFields();
    } catch (error) {
      close();
      pending.reject(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [canConfirm, close, method, password, recaptchaToken, resetFields]);

  return {
    requestConfirmation,
    modalProps: {
      show,
      title: texts.title || '',
      description: texts.description || '',
      details: texts.details || '',
      confirmLabel: texts.confirmLabel || '',
      confirmVariant: texts.confirmVariant || 'primary',
      method,
      passkeySupport,
      password,
      onPasswordChange: setPassword,
      recaptchaProvider,
      recaptchaSiteKey,
      recaptchaResetCounter,
      onRecaptchaChange: setRecaptchaToken,
      busy,
      errorKey,
      canConfirm,
      onCancel,
      onConfirm
    }
  };
}
