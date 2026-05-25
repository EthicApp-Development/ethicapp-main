import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PasswordField from './PasswordField';
import TextField from '../common/TextField';
import SelectField from '../common/SelectField';
import { register } from '../../api/authApi';
import RecaptchaField from '../common/RecaptchaField';
import { recaptchaSiteKey } from '../../config/env';
import { useI18n } from '../../app/i18n-context';
import { useRegisterDraft } from '../../app/register-draft-context';

function RegisterForm() {
  const { locale, t } = useI18n();
  const { draft, updateDraft, clearDraft } = useRegisterDraft();
  const navigate = useNavigate();

  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [showPasswordRecoveryLink, setShowPasswordRecoveryLink] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [redirectCountdown, setRedirectCountdown] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recaptchaResetCounter, setRecaptchaResetCounter] = useState(0);
  const successAlertRef = useRef(null);

  const genderOptions = [
    { value: 'F', label: t('register.genderOptions.female') },
    { value: 'M', label: t('register.genderOptions.male') },
    { value: 'O', label: t('register.genderOptions.other') }
  ];

  const passwordChecks = useMemo(() => {
    const password = draft.password || '';
    const symbolCount = (password.match(/[^a-zA-Z0-9]/g) || []).length;

    return {
      minLength: password.length >= 10,
      twoSymbols: symbolCount >= 2
    };
  }, [draft.password]);

  useEffect(() => {
    if (!successMessage || !successAlertRef.current) {
      return;
    }

    successAlertRef.current.focus({ preventScroll: true });
    successAlertRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }, [successMessage]);

  useEffect(() => {
    if (redirectCountdown === null) {
      return undefined;
    }

    if (redirectCountdown <= 0) {
      navigate('/login', { replace: true });
      return undefined;
    }

    const countdownTimer = window.setTimeout(() => {
      setRedirectCountdown((current) => (current === null ? null : current - 1));
    }, 1000);

    return () => window.clearTimeout(countdownTimer);
  }, [navigate, redirectCountdown]);

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
    setSuccessMessage('');
    setRedirectCountdown(null);
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

    if (!draft.dni.trim()) {
      nextErrors.dni = t('register.errors.dniRequired');
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
    } else if (!passwordChecks.minLength || !passwordChecks.twoSymbols) {
      nextErrors.password = t('register.errors.passwordInvalid');
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
    setSuccessMessage('');
    setRedirectCountdown(null);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    try {
      setIsSubmitting(true);

      await register({
        firstname: draft.firstname.trim(),
        lastname: draft.lastname.trim(),
        dni: draft.dni.trim(),
        email: draft.email.trim(),
        gender: draft.gender,
        password: draft.password,
        password_confirmation: draft.password_confirmation,
        recaptcha_token: recaptchaToken,
        preferred_locale: locale
      });

      clearDraft();
      setSuccessMessage(t('register.successMessage'));
      setRedirectCountdown(10);
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

      {successMessage ? (
        <div
          ref={successAlertRef}
          className="alert alert-success auth-alert"
          role="alert"
          tabIndex="-1"
        >
          <p className="mb-1">{successMessage}</p>
          {redirectCountdown !== null ? (
            <p className="mb-0">
              {t('register.redirectingToLoginPrefix')}
              {redirectCountdown}
              {t('register.redirectingToLoginSuffix')}
            </p>
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
        id="dni"
        name="dni"
        label={t('register.fields.dni')}
        value={draft.dni}
        onChange={handleChange}
        error={errors.dni}
        placeholder={t('register.placeholders.dni')}
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
        helpText={t('register.passwordRules.helpText')}
        required
      >
        <ul className="auth-password-rules">
          <li className={passwordChecks.minLength ? 'is-valid' : 'is-invalid'}>
            {t('register.passwordRules.minLength')}
          </li>
          <li className={passwordChecks.twoSymbols ? 'is-valid' : 'is-invalid'}>
            {t('register.passwordRules.twoSymbols')}
          </li>
        </ul>
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
          disabled={isSubmitting || redirectCountdown !== null}
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

export default RegisterForm;
