import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import PasswordField from './PasswordField';
import PasswordRules from './PasswordRules';
import RegisterSentNotice from './RegisterSentNotice';
import TextField from '../common/TextField';
import SelectField from '../common/SelectField';
import { register } from '../../api/authApi';
import RecaptchaField from '../common/RecaptchaField';
import { recaptchaProvider, recaptchaSiteKey } from '../../config/env';
import { useI18n } from '../../app/i18n-context';
import { emptyRegisterDraft, useRegisterDraft } from '../../app/register-draft-context';
import { usePasswordPolicy } from '../../hooks/usePasswordPolicy';
import { checkPassword } from '../../utils/passwordPolicy';

function RegisterForm({ onSentChange = () => {} }) {
  const { locale, t } = useI18n();
  const { draft, updateDraft, clearDraft } = useRegisterDraft();

  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [showPasswordRecoveryLink, setShowPasswordRecoveryLink] = useState(false);
  // The address the confirmation message went to; set, it replaces the form
  // with RegisterSentNotice (#1090).
  const [sentEmail, setSentEmail] = useState('');
  // The name and gender of the last sign-up, kept so "Corregir mi correo"
  // brings the person back with only the email and passwords to fill again.
  const [lastSubmission, setLastSubmission] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recaptchaResetCounter, setRecaptchaResetCounter] = useState(0);

  const genderOptions = [
    { value: 'F', label: t('register.genderOptions.female') },
    { value: 'M', label: t('register.genderOptions.male') },
    { value: 'O', label: t('register.genderOptions.other') }
  ];

  const passwordPolicy = usePasswordPolicy();
  const passwordChecks = useMemo(
    () => checkPassword(draft.password, passwordPolicy),
    [draft.password, passwordPolicy]
  );

  function handleChange(event) {
    const { name, type, value, checked } = event.target;

    updateDraft((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value
    }));

    setErrors((current) => ({
      ...current,
      [name]: ''
    }));

    setServerError('');
    setShowPasswordRecoveryLink(false);
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validate() {
    const nextErrors = {};

    if (!draft.firstname.trim()) {
      nextErrors.firstname = t('register.errors.firstnameRequired');
    }

    if (!draft.lastname.trim()) {
      nextErrors.lastname = t('register.errors.lastnameRequired');
    }

    if (!draft.email.trim()) {
      nextErrors.email = t('register.errors.emailRequired');
    } else if (!isValidEmail(draft.email.trim())) {
      nextErrors.email = t('register.errors.emailInvalid');
    }

    if (!draft.gender) {
      nextErrors.gender = t('register.errors.genderRequired');
    }

    if (!draft.password) {
      nextErrors.password = t('register.errors.passwordRequired');
    } else if (passwordChecks && !passwordChecks.satisfied) {
      nextErrors.password = t('register.errors.passwordInvalid', passwordPolicy);
    }

    if (!draft.password_confirmation) {
      nextErrors.password_confirmation = t('register.errors.passwordConfirmationRequired');
    } else if (draft.password !== draft.password_confirmation) {
      nextErrors.password_confirmation = t('register.errors.passwordMismatch');
    }

    if (!draft.acceptPrivacy) {
      nextErrors.acceptPrivacy = t('register.errors.privacyAcceptanceRequired');
    }

    if (recaptchaSiteKey && !recaptchaToken) {
      nextErrors.recaptcha = t('register.errors.recaptchaRequired');
    }

    return nextErrors;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationErrors = validate();
    setErrors(validationErrors);
    setServerError('');
    setShowPasswordRecoveryLink(false);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    try {
      setIsSubmitting(true);

      await register({
        firstname: draft.firstname.trim(),
        lastname: draft.lastname.trim(),
        email: draft.email.trim(),
        gender: draft.gender,
        password: draft.password,
        password_confirmation: draft.password_confirmation,
        recaptcha_token: recaptchaToken,
        preferred_locale: locale
      });

      setLastSubmission({
        firstname: draft.firstname,
        lastname:  draft.lastname,
        gender:    draft.gender
      });
      setSentEmail(draft.email.trim());
      onSentChange(true);
      clearDraft();
    } catch (error) {
      const responseData = error?.response?.data || {};
      const isEmailAlreadyRegistered = responseData.code === 'email_already_registered';
      const message = isEmailAlreadyRegistered
        ? t('register.errors.emailAlreadyRegistered')
        : responseData.error || error?.message || t('register.errors.genericRegisterError');

      setServerError(message);
      setShowPasswordRecoveryLink(isEmailAlreadyRegistered);
    } finally {
      setIsSubmitting(false);
      setRecaptchaResetCounter((current) => current + 1);
      setRecaptchaToken('');
    }
  }

  // Back to the form with the name and gender kept, and the email, passwords
  // and privacy acceptance to give again. The account with the wrong address
  // stays unconfirmed, and nothing can sign in to it.
  function handleCorrectEmail() {
    updateDraft(() => ({ ...emptyRegisterDraft, ...lastSubmission }));
    setErrors({});
    setSentEmail('');
    onSentChange(false);
    window.requestAnimationFrame(() => document.getElementById('email')?.focus());
  }

  if (sentEmail) {
    return <RegisterSentNotice email={sentEmail} onCorrectEmail={handleCorrectEmail} />;
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      {serverError ? (
        <div className="alert alert-danger auth-alert" role="alert">
          {serverError}
          {showPasswordRecoveryLink ? (
            <>
              {' '}
              <Link className="alert-link" to="/forgot">
                {t('register.recoverPasswordLink')}
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <TextField
        id="firstname"
        name="firstname"
        label={t('register.fields.firstname')}
        value={draft.firstname}
        onChange={handleChange}
        error={errors.firstname}
        autoComplete="given-name"
        autoFocus
        required
      />

      <TextField
        id="lastname"
        name="lastname"
        label={t('register.fields.lastname')}
        value={draft.lastname}
        onChange={handleChange}
        error={errors.lastname}
        autoComplete="family-name"
        required
      />

      <TextField
        id="email"
        name="email"
        label={t('register.fields.email')}
        type="email"
        value={draft.email}
        onChange={handleChange}
        error={errors.email}
        autoComplete="email"
        required
        helpText={t('register.emailHelpText')}
      />

      <SelectField
        id="gender"
        name="gender"
        label={t('register.fields.gender')}
        value={draft.gender}
        onChange={handleChange}
        error={errors.gender}
        options={genderOptions}
        placeholder={t('register.placeholders.gender')}
        required
      />

      <PasswordField
        id="password"
        name="password"
        label={t('register.fields.password')}
        value={draft.password}
        onChange={handleChange}
        error={errors.password}
        autoComplete="new-password"
        helpText={passwordPolicy ? t('register.passwordRules.helpText', passwordPolicy) : ''}
        required
      >
        <PasswordRules policy={passwordPolicy} checks={passwordChecks} keyPrefix="register.passwordRules" />
      </PasswordField>

      <PasswordField
        id="password_confirmation"
        name="password_confirmation"
        label={t('register.fields.passwordConfirmation')}
        value={draft.password_confirmation}
        onChange={handleChange}
        error={errors.password_confirmation}
        autoComplete="new-password"
        required
      />

      <RecaptchaField
        provider={recaptchaProvider}
        siteKey={recaptchaSiteKey}
        onChange={(token) => {
          setRecaptchaToken(token);
          setErrors((current) => ({
            ...current,
            recaptcha: ''
          }));
        }}
        resetCounter={recaptchaResetCounter}
        error={errors.recaptcha}
      />

      <div className="auth-form-actions">
        <button
          type="submit"
          className="btn btn-primary btn-lg auth-btn-block"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <span className="auth-spinner-gap">
              <span
                className="spinner-border spinner-border-sm"
                aria-hidden="true"
              />
              <span>{t('register.submitting')}</span>
            </span>
          ) : (
            t('register.submit')
          )}
        </button>

        <div className="form-check mt-3">
          <input
            className={`form-check-input ${errors.acceptPrivacy ? 'is-invalid' : ''}`}
            type="checkbox"
            id="acceptPrivacy"
            name="acceptPrivacy"
            checked={draft.acceptPrivacy}
            onChange={handleChange}
          />
          <label className="form-check-label" htmlFor="acceptPrivacy">
            {t('register.privacyAcceptancePrefix')}{' '}
            <Link to="/privacy">{t('register.privacyPolicy')}</Link>
            {t('register.privacyAcceptanceSuffix')}
          </label>
          {errors.acceptPrivacy ? (
            <div className="invalid-feedback d-block">
              {errors.acceptPrivacy}
            </div>
          ) : null}
          <p className="small text-muted">
            {t('register.privacyNoticePartOne')}
            {' '}
            {t('register.privacyNoticePartTwo')}
            {' '}
            {t('register.privacyNoticePartThreePrefix')}{' '}
            <Link to="/privacy">{t('register.privacyPolicy')}</Link>
            {t('register.privacyNoticePartThreeSuffix')}
          </p>
        </div>
      </div>

      <hr className="auth-divider" />

      <p className="auth-footer">
        <span>{t('register.alreadyHaveAccount')} </span>
        <Link to="/login">{t('register.signInLink')}</Link>
      </p>
    </form>
  );
}

RegisterForm.propTypes = {
  // Told when the form is replaced by the "check your email" notice, and back.
  onSentChange: PropTypes.func
};

export default RegisterForm;
