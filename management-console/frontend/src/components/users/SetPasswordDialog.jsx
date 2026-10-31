import PropTypes from 'prop-types';
import { useRef } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import PasswordRules from '../common/PasswordRules.jsx';

const TITLE_ID = 'set-password-title';
const RULES_ID = 'set-password-rules';

// The dialog where the administrator types the new password twice (#889).
// It only collects the password; the step-up confirmation follows in the
// shared dialog, and auth-backend decides whether the password is strong
// enough. `accountName` and `email` come from the account as last loaded.
function SetPasswordDialog({
  show,
  accountName,
  email,
  policy = null,
  password,
  confirmation,
  visible,
  error = '',
  canContinue,
  onPasswordChange,
  onConfirmationChange,
  onToggleVisible,
  onCancel,
  onContinue
}) {
  const { t } = useI18n();
  const passwordRef = useRef(null);
  const inputType = visible ? 'text' : 'password';
  const describedBy = policy ? RULES_ID : undefined;

  function handleSubmit(event) {
    event.preventDefault();
    // The dialog renders in a portal, but React still bubbles its submit
    // to the account form around the button; that form must not save.
    event.stopPropagation();
    if (canContinue) {
      onContinue();
    }
  }

  return (
    <Modal
      show={show}
      onHide={onCancel}
      onEntered={() => passwordRef.current?.focus()}
      centered
      aria-labelledby={TITLE_ID}
      data-testid="set-password-dialog"
    >
      <Form onSubmit={handleSubmit} noValidate data-testid="set-password-form">
        <Modal.Header closeButton closeLabel={t('pages.userSetPassword.cancel')}>
          <Modal.Title id={TITLE_ID} as="h2" className="h5">
            <i className="fa-solid fa-key text-primary me-2" aria-hidden="true" />
            {t('pages.userSetPassword.title', { name: accountName })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>{t('pages.userSetPassword.intro', { name: accountName, email })}</p>
          <Alert variant="info" className="small" data-testid="set-password-notes">
            <p className="mb-1">{t('pages.userSetPassword.sessionsNote')}</p>
            <p className="mb-0">{t('pages.userSetPassword.handOverNote')}</p>
          </Alert>

          {error ? (
            <Alert variant="danger" data-testid="set-password-error">
              {error}
            </Alert>
          ) : null}

          <Form.Group className="mb-3" controlId="set-password-new">
            <Form.Label>{t('pages.userSetPassword.fields.newPassword')}</Form.Label>
            <Form.Control
              ref={passwordRef}
              type={inputType}
              autoComplete="new-password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              aria-describedby={describedBy}
              required
            />
            {policy ? (
              <Form.Text>{t('passwordRules.helpText', policy)}</Form.Text>
            ) : null}
          </Form.Group>

          <Form.Group className="mb-2" controlId="set-password-confirmation">
            <Form.Label>{t('pages.userSetPassword.fields.passwordConfirmation')}</Form.Label>
            <Form.Control
              type={inputType}
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => onConfirmationChange(event.target.value)}
              aria-describedby={describedBy}
              required
            />
          </Form.Group>

          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0"
            aria-pressed={visible}
            data-testid="set-password-visibility"
            onClick={onToggleVisible}
          >
            <i className={`fa-solid ${visible ? 'fa-eye-slash' : 'fa-eye'} me-2`} aria-hidden="true" />
            {visible ? t('pages.userSetPassword.hide') : t('pages.userSetPassword.show')}
          </Button>

          <PasswordRules id={RULES_ID} policy={policy} password={password} confirmation={confirmation} />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onCancel} data-testid="set-password-cancel">
            {t('pages.userSetPassword.cancel')}
          </Button>
          <Button type="submit" variant="warning" disabled={!canContinue} data-testid="set-password-continue">
            {t('pages.userSetPassword.continue')}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

SetPasswordDialog.propTypes = {
  show: PropTypes.bool.isRequired,
  accountName: PropTypes.string.isRequired,
  email: PropTypes.string.isRequired,
  policy: PropTypes.shape({
    minLength: PropTypes.number.isRequired,
    minSymbols: PropTypes.number.isRequired
  }),
  password: PropTypes.string.isRequired,
  confirmation: PropTypes.string.isRequired,
  visible: PropTypes.bool.isRequired,
  error: PropTypes.string,
  canContinue: PropTypes.bool.isRequired,
  onPasswordChange: PropTypes.func.isRequired,
  onConfirmationChange: PropTypes.func.isRequired,
  onToggleVisible: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  onContinue: PropTypes.func.isRequired
};

export default SetPasswordDialog;
