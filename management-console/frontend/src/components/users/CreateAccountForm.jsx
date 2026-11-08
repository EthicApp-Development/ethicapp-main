import PropTypes from 'prop-types';
import { Alert, Button, Col, Form, Row } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import PasswordRules from '../common/PasswordRules.jsx';

const RULES_ID = 'create-account-password-rules';
const GENERATED_HINT_ID = 'create-account-generated-hint';

// The fields of a new student or teacher account (#1170): the sign-up
// fields, the role, the account's language, the password and the
// administrator's confirmation that they informed the person of the privacy
// policy and the terms of use. The page holds the values and submits them.
function CreateAccountForm({
  values,
  policy = null,
  passwordVisible,
  passwordGenerated,
  passwordCopied,
  canCopy,
  error = '',
  busy,
  canSubmit,
  onFieldChange,
  onToggleVisible,
  onGeneratePassword,
  onCopyPassword,
  onSubmit
}) {
  const { t } = useI18n();
  const passwordType = passwordVisible ? 'text' : 'password';
  const passwordDescribedBy = [policy ? RULES_ID : null, passwordGenerated ? GENERATED_HINT_ID : null]
    .filter(Boolean)
    .join(' ') || undefined;

  function handleSubmit(event) {
    event.preventDefault();
    if (canSubmit) {
      onSubmit();
    }
  }

  return (
    <Form onSubmit={handleSubmit} noValidate data-testid="create-account-form">
      {error ? (
        <Alert variant="danger" data-testid="create-account-error">
          {error}
        </Alert>
      ) : null}

      <Row as="fieldset" className="g-3" disabled={busy}>
        <Col md={6}>
          <Form.Group controlId="create-account-firstname">
            <Form.Label>{t('pages.userCreate.fields.firstname')}</Form.Label>
            <Form.Control
              value={values.firstname}
              autoComplete="off"
              onChange={(event) => onFieldChange('firstname', event.target.value)}
              required
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group controlId="create-account-lastname">
            <Form.Label>{t('pages.userCreate.fields.lastname')}</Form.Label>
            <Form.Control
              value={values.lastname}
              autoComplete="off"
              onChange={(event) => onFieldChange('lastname', event.target.value)}
              required
            />
          </Form.Group>
        </Col>

        <Col md={6}>
          <Form.Group controlId="create-account-email">
            <Form.Label>{t('pages.userCreate.fields.email')}</Form.Label>
            <Form.Control
              type="email"
              value={values.email}
              autoComplete="off"
              onChange={(event) => onFieldChange('email', event.target.value)}
              required
            />
            <Form.Text>{t('pages.userCreate.emailHelp')}</Form.Text>
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group controlId="create-account-gender">
            <Form.Label>{t('pages.userCreate.fields.gender')}</Form.Label>
            <Form.Select
              value={values.gender}
              onChange={(event) => onFieldChange('gender', event.target.value)}
              required
            >
              <option value="" disabled>{t('pages.userCreate.choose')}</option>
              <option value="F">{t('genders.F')}</option>
              <option value="M">{t('genders.M')}</option>
              <option value="O">{t('genders.O')}</option>
            </Form.Select>
          </Form.Group>
        </Col>

        <Col md={6}>
          <Form.Group controlId="create-account-role">
            <Form.Label>{t('pages.userCreate.fields.role')}</Form.Label>
            <Form.Select
              value={values.role}
              onChange={(event) => onFieldChange('role', event.target.value)}
              required
              data-testid="create-account-role"
            >
              <option value="" disabled>{t('pages.userCreate.choose')}</option>
              <option value="P">{t('roles.P')}</option>
              <option value="A">{t('roles.A')}</option>
            </Form.Select>
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group controlId="create-account-locale">
            <Form.Label>{t('pages.userCreate.fields.locale')}</Form.Label>
            <Form.Select
              value={values.preferred_locale}
              onChange={(event) => onFieldChange('preferred_locale', event.target.value)}
            >
              <option value="es_CL">{t('pages.userCreate.locales.es_CL')}</option>
              <option value="en_US">{t('pages.userCreate.locales.en_US')}</option>
            </Form.Select>
            <Form.Text>{t('pages.userCreate.localeHelp')}</Form.Text>
          </Form.Group>
        </Col>

        <Col md={6}>
          <Form.Group controlId="create-account-password">
            <Form.Label>{t('pages.userCreate.fields.password')}</Form.Label>
            <Form.Control
              type={passwordType}
              value={values.password}
              autoComplete="new-password"
              onChange={(event) => onFieldChange('password', event.target.value)}
              aria-describedby={passwordDescribedBy}
              required
              data-testid="create-account-password"
            />
            {policy ? <Form.Text>{t('passwordRules.helpText', policy)}</Form.Text> : null}
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group controlId="create-account-password-confirmation">
            <Form.Label>{t('pages.userCreate.fields.passwordConfirmation')}</Form.Label>
            <Form.Control
              type={passwordType}
              value={values.password_confirmation}
              autoComplete="new-password"
              onChange={(event) => onFieldChange('password_confirmation', event.target.value)}
              aria-describedby={passwordDescribedBy}
              required
              data-testid="create-account-password-confirmation"
            />
          </Form.Group>
        </Col>

        <Col xs={12}>
          <div className="d-flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline-secondary"
              size="sm"
              onClick={onGeneratePassword}
              data-testid="create-account-generate-password"
            >
              <i className="fa-solid fa-wand-magic-sparkles me-2" aria-hidden="true" />
              {t('pages.userCreate.generatePassword')}
            </Button>
            {canCopy ? (
              <Button
                type="button"
                variant="outline-secondary"
                size="sm"
                disabled={!values.password}
                onClick={onCopyPassword}
                data-testid="create-account-copy-password"
              >
                <i className={`fa-solid ${passwordCopied ? 'fa-check' : 'fa-copy'} me-2`} aria-hidden="true" />
                {passwordCopied ? t('pages.userCreate.passwordCopied') : t('pages.userCreate.copyPassword')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-0"
              aria-pressed={passwordVisible}
              onClick={onToggleVisible}
              data-testid="create-account-password-visibility"
            >
              <i className={`fa-solid ${passwordVisible ? 'fa-eye-slash' : 'fa-eye'} me-2`} aria-hidden="true" />
              {passwordVisible ? t('pages.userCreate.hidePassword') : t('pages.userCreate.showPassword')}
            </Button>
          </div>
          {passwordGenerated ? (
            <Form.Text id={GENERATED_HINT_ID} className="d-block mt-2" data-testid="create-account-generated-hint">
              {t('pages.userCreate.generatedHint')}
            </Form.Text>
          ) : null}
          <PasswordRules
            id={RULES_ID}
            policy={policy}
            password={values.password}
            confirmation={values.password_confirmation}
          />
        </Col>

        <Col xs={12}>
          <Alert variant="info" className="small mb-2" data-testid="create-account-notes">
            <p className="mb-1">{t('pages.userCreate.confirmedNote')}</p>
            <p className="mb-1">{t('pages.userCreate.welcomeEmailNote')}</p>
            <p className="mb-0">{t('pages.userCreate.handOverNote')}</p>
          </Alert>
          <Form.Check
            type="checkbox"
            id="create-account-privacy-notice"
            checked={values.privacy_notice_confirmed}
            onChange={(event) => onFieldChange('privacy_notice_confirmed', event.target.checked)}
            label={t('pages.userCreate.privacyNotice')}
            data-testid="create-account-privacy-notice"
          />
        </Col>
      </Row>

      <div className="d-flex justify-content-end mt-4">
        <Button type="submit" variant="primary" disabled={!canSubmit} data-testid="create-account-submit">
          <i className="fa-solid fa-user-plus me-2" aria-hidden="true" />
          {t('pages.userCreate.submit')}
        </Button>
      </div>
    </Form>
  );
}

CreateAccountForm.propTypes = {
  values: PropTypes.shape({
    firstname: PropTypes.string.isRequired,
    lastname: PropTypes.string.isRequired,
    email: PropTypes.string.isRequired,
    gender: PropTypes.string.isRequired,
    role: PropTypes.string.isRequired,
    preferred_locale: PropTypes.string.isRequired,
    password: PropTypes.string.isRequired,
    password_confirmation: PropTypes.string.isRequired,
    privacy_notice_confirmed: PropTypes.bool.isRequired
  }).isRequired,
  policy: PropTypes.shape({
    minLength: PropTypes.number.isRequired,
    minSymbols: PropTypes.number.isRequired
  }),
  passwordVisible: PropTypes.bool.isRequired,
  passwordGenerated: PropTypes.bool.isRequired,
  passwordCopied: PropTypes.bool.isRequired,
  canCopy: PropTypes.bool.isRequired,
  error: PropTypes.string,
  busy: PropTypes.bool.isRequired,
  canSubmit: PropTypes.bool.isRequired,
  onFieldChange: PropTypes.func.isRequired,
  onToggleVisible: PropTypes.func.isRequired,
  onGeneratePassword: PropTypes.func.isRequired,
  onCopyPassword: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired
};

export default CreateAccountForm;
