import PropTypes from 'prop-types';
import { useEffect, useRef } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import RecaptchaField from './RecaptchaField.jsx';
import { CONFIRMATION_METHODS } from './sensitiveActionConfirmation.js';

const TITLE_ID = 'sensitive-action-title';
const DESCRIPTION_ID = 'sensitive-action-description';
const PASSWORD_ID = 'sensitive-action-password';

function ConfirmationFields({
  method,
  passkeySupport,
  password,
  onPasswordChange,
  passwordRef,
  busy,
  recaptchaProvider,
  recaptchaSiteKey,
  recaptchaResetCounter,
  onRecaptchaChange
}) {
  const { t } = useI18n();

  if (method === CONFIRMATION_METHODS.loading) {
    return (
      <div className="d-flex align-items-center gap-2" role="status">
        <Spinner size="sm" />
        <span>{t('sensitiveAction.loading')}</span>
      </div>
    );
  }

  if (method === CONFIRMATION_METHODS.passkey) {
    return passkeySupport ? (
      <p className="mb-0" data-testid="sensitive-action-passkey-help">
        <i className="fa-solid fa-fingerprint me-2" aria-hidden="true" />
        {t('sensitiveAction.passkeyHelp')}
      </p>
    ) : (
      <Alert variant="warning" className="mb-0" data-testid="sensitive-action-passkey-unsupported">
        {t('sensitiveAction.passkeyUnsupported')}
      </Alert>
    );
  }

  return (
    <>
      <Form.Group className="mb-3" controlId={PASSWORD_ID}>
        <Form.Label>{t('sensitiveAction.fields.adminPassword')}</Form.Label>
        <Form.Control
          ref={passwordRef}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          disabled={busy}
          required
          aria-describedby={`${PASSWORD_ID}-help`}
        />
        <Form.Text id={`${PASSWORD_ID}-help`}>{t('sensitiveAction.passwordHelp')}</Form.Text>
      </Form.Group>
      <div className="d-flex justify-content-center" data-testid="sensitive-action-recaptcha">
        <RecaptchaField
          provider={recaptchaProvider}
          siteKey={recaptchaSiteKey}
          resetCounter={recaptchaResetCounter}
          onChange={onRecaptchaChange}
        />
      </div>
    </>
  );
}

ConfirmationFields.propTypes = {
  method: PropTypes.oneOf(Object.values(CONFIRMATION_METHODS)).isRequired,
  passkeySupport: PropTypes.bool.isRequired,
  password: PropTypes.string.isRequired,
  onPasswordChange: PropTypes.func.isRequired,
  passwordRef: PropTypes.oneOfType([PropTypes.func, PropTypes.shape({ current: PropTypes.any })]),
  busy: PropTypes.bool.isRequired,
  recaptchaProvider: PropTypes.string,
  recaptchaSiteKey: PropTypes.string.isRequired,
  recaptchaResetCounter: PropTypes.number.isRequired,
  onRecaptchaChange: PropTypes.func.isRequired
};

// The dialog's content, rendered inside <Modal>. Exported for tests: a
// <Modal> renders through a portal, which static rendering skips.
export function SensitiveActionConfirmContent({
  title,
  description,
  details,
  confirmLabel,
  confirmVariant,
  method,
  busy,
  errorKey,
  canConfirm,
  onCancel,
  onConfirm,
  ...fieldProps
}) {
  const { t } = useI18n();

  function handleSubmit(event) {
    event.preventDefault();
    onConfirm();
  }

  const confirmText = method === CONFIRMATION_METHODS.passkey
    ? t('sensitiveAction.actions.confirmWithPasskey')
    : confirmLabel || t('sensitiveAction.actions.confirm');

  return (
    <Form
      onSubmit={handleSubmit}
      noValidate
      data-testid="sensitive-action-form"
      data-confirmation-method={method}
    >
      <Modal.Header closeButton={!busy} closeLabel={t('sensitiveAction.actions.close')}>
        <Modal.Title id={TITLE_ID} as="h2" className="h5">
          <i className="fa-solid fa-shield-halved text-primary me-2" aria-hidden="true" />
          {title || t('sensitiveAction.defaultTitle')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div id={DESCRIPTION_ID}>
          {description ? <p>{description}</p> : null}
          {details ? <p className="text-body-secondary small">{details}</p> : null}
          <p className="text-body-secondary small">
            {t(method === CONFIRMATION_METHODS.passkey ? 'sensitiveAction.passkeyIntro' : 'sensitiveAction.passwordIntro')}
          </p>
        </div>

        {errorKey ? (
          <Alert variant="danger" data-testid="sensitive-action-error">
            {t(errorKey)}
          </Alert>
        ) : null}

        <ConfirmationFields method={method} busy={busy} {...fieldProps} />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel} disabled={busy} data-testid="sensitive-action-cancel">
          {t('sensitiveAction.actions.cancel')}
        </Button>
        <Button type="submit" variant={confirmVariant} disabled={!canConfirm} data-testid="sensitive-action-confirm">
          {busy ? <Spinner size="sm" className="me-2" aria-hidden="true" /> : null}
          {confirmText}
        </Button>
      </Modal.Footer>
    </Form>
  );
}

SensitiveActionConfirmContent.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  details: PropTypes.string,
  confirmLabel: PropTypes.string,
  confirmVariant: PropTypes.string,
  method: PropTypes.oneOf(Object.values(CONFIRMATION_METHODS)).isRequired,
  busy: PropTypes.bool.isRequired,
  errorKey: PropTypes.string,
  canConfirm: PropTypes.bool.isRequired,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired
};

// Step-up confirmation dialog; its props come from
// useSensitiveActionConfirmation().modalProps.
function SensitiveActionConfirmModal({ show, onCancel, busy, ...contentProps }) {
  const passwordRef = useRef(null);
  const { errorKey, recaptchaResetCounter, method } = contentProps;

  // After a refused attempt the fields are cleared; take the administrator
  // back to the password field (absent with a passkey, then a no-op).
  useEffect(() => {
    if (show && errorKey) {
      passwordRef.current?.focus();
    }
  }, [show, errorKey, recaptchaResetCounter]);

  return (
    <Modal
      show={show}
      onHide={busy ? undefined : onCancel}
      onEntered={() => passwordRef.current?.focus()}
      backdrop={busy ? 'static' : true}
      keyboard={!busy}
      // The reCAPTCHA image challenge opens in an iframe outside the dialog;
      // a focus trap would pull focus back from it.
      enforceFocus={method !== CONFIRMATION_METHODS.password}
      centered
      aria-labelledby={TITLE_ID}
      aria-describedby={DESCRIPTION_ID}
      data-testid="sensitive-action-modal"
    >
      <SensitiveActionConfirmContent
        {...contentProps}
        busy={busy}
        onCancel={onCancel}
        passwordRef={passwordRef}
      />
    </Modal>
  );
}

SensitiveActionConfirmModal.propTypes = {
  show: PropTypes.bool.isRequired,
  onCancel: PropTypes.func.isRequired,
  busy: PropTypes.bool.isRequired
};

export default SensitiveActionConfirmModal;
