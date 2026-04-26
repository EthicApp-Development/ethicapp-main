import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PasswordField from './PasswordField';
import TextField from '../common/TextField';
import SelectField from '../common/SelectField';
import { register } from '../../api/authApi';
import RecaptchaField from '../common/RecaptchaField';
import { recaptchaSiteKey } from '../../config/env';
import { useI18n } from '../../app/providers';

function RegisterForm() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    firstname: '',
    lastname: '',
    dni: '',
    email: '',
    gender: '',
    password: '',
    password_confirmation: '',
    acceptPrivacy: false,
    recaptchaToken: ''
  });

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recaptchaResetCounter, setRecaptchaResetCounter] = useState(0);

  const genderOptions = [
    { value: 'F', label: t('register.genderOptions.female') },
    { value: 'M', label: t('register.genderOptions.male') },
    { value: 'O', label: t('register.genderOptions.other') }
  ];

  const passwordChecks = useMemo(() => {
    const password = formData.password || '';
    const symbolCount = (password.match(/[^a-zA-Z0-9]/g) || []).length;

    return {
      minLength: password.length >= 10,
      twoSymbols: symbolCount >= 2
    };
  }, [formData.password]);

  function handleChange(event) {
    const { name, type, value, checked } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value
    }));

    setErrors((current) => ({
      ...current,
      [name]: ''
    }));

    setServerError('');
    setSuccessMessage('');
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validate() {
    const nextErrors = {};

    if (!formData.firstname.trim()) {
      nextErrors.firstname = t('register.errors.firstnameRequired');
    }

    if (!formData.lastname.trim()) {
      nextErrors.lastname = t('register.errors.lastnameRequired');
    }

    if (!formData.dni.trim()) {
      nextErrors.dni = t('register.errors.dniRequired');
    }

    if (!formData.email.trim()) {
      nextErrors.email = t('register.errors.emailRequired');
    } else if (!isValidEmail(formData.email.trim())) {
      nextErrors.email = t('register.errors.emailInvalid');
    }

    if (!formData.gender) {
      nextErrors.gender = t('register.errors.genderRequired');
    }

    if (!formData.password) {
      nextErrors.password = t('register.errors.passwordRequired');
    } else if (!passwordChecks.minLength || !passwordChecks.twoSymbols) {
      nextErrors.password = t('register.errors.passwordInvalid');
    }

    if (!formData.password_confirmation) {
      nextErrors.password_confirmation = t('register.errors.passwordConfirmationRequired');
    } else if (formData.password !== formData.password_confirmation) {
      nextErrors.password_confirmation = t('register.errors.passwordMismatch');
    }

    if (!formData.acceptPrivacy) {
      nextErrors.acceptPrivacy = t('register.errors.privacyAcceptanceRequired');
    }

    if (recaptchaSiteKey && !formData.recaptchaToken) {
      nextErrors.recaptcha = t('register.errors.recaptchaRequired');
    }

    return nextErrors;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationErrors = validate();
    setErrors(validationErrors);
    setServerError('');
    setSuccessMessage('');

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    try {
      setIsSubmitting(true);

      await register({
        firstname: formData.firstname.trim(),
        lastname: formData.lastname.trim(),
        dni: formData.dni.trim(),
        email: formData.email.trim(),
        gender: formData.gender,
        password: formData.password,
        password_confirmation: formData.password_confirmation,
        recaptcha_token: formData.recaptchaToken,
        preferred_locale: locale
      });

      setSuccessMessage(t('register.successMessage'));

      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1200);
    } catch (error) {
      const message =
        error?.response?.data?.error || error?.message || t('register.errors.genericRegisterError');

      setServerError(message);
    } finally {
      setIsSubmitting(false);
      setRecaptchaResetCounter((current) => current + 1);
      setFormData((current) => ({ ...current, recaptchaToken: '' }));
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      {serverError ? (
        <div className="alert alert-danger auth-alert" role="alert">
          {serverError}
        </div>
      ) : null}

      {successMessage ? (
        <div className="alert alert-success auth-alert" role="alert">
          {successMessage}
        </div>
      ) : null}

      <TextField
        id="firstname"
        name="firstname"
        label={t('register.fields.firstname')}
        value={formData.firstname}
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
        value={formData.lastname}
        onChange={handleChange}
        error={errors.lastname}
        autoComplete="family-name"
        required
      />

      <TextField
        id="dni"
        name="dni"
        label={t('register.fields.dni')}
        value={formData.dni}
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
        value={formData.email}
        onChange={handleChange}
        error={errors.email}
        autoComplete="email"
        required
      />

      <SelectField
        id="gender"
        name="gender"
        label={t('register.fields.gender')}
        value={formData.gender}
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
        value={formData.password}
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
        value={formData.password_confirmation}
        onChange={handleChange}
        error={errors.password_confirmation}
        autoComplete="new-password"
        required
      />

      <RecaptchaField
        siteKey={recaptchaSiteKey}
        onChange={(token) => {
          setFormData((current) => ({
            ...current,
            recaptchaToken: token
          }));
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
            checked={formData.acceptPrivacy}
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
