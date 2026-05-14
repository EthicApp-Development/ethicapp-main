import { useState } from 'react';
import { Link } from 'react-router-dom';
import { login } from '../../api/authApi';
import { useI18n } from '../../app/i18n-context';
import TextField from '../common/TextField';
import PasswordField from './PasswordField';

function LoginForm() {
  const { t } = useI18n();

  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value
    }));

    setErrors((current) => ({
      ...current,
      [name]: ''
    }));

    setServerError('');
  }

  function validate() {
    const nextErrors = {};

    if (!formData.username.trim()) {
      nextErrors.username = t('login.errors.usernameRequired');
    }

    if (!formData.password) {
      nextErrors.password = t('login.errors.passwordRequired');
    }

    return nextErrors;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationErrors = validate();
    setErrors(validationErrors);
    setServerError('');

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    try {
      setIsSubmitting(true);

      const response = await login({
        username: formData.username.trim(),
        password: formData.password
      });

      const redirectTo = response?.redirectTo || '/';
      window.location.assign(redirectTo);
    } catch (error) {
      const message =
        error?.response?.data?.error || error?.message || t('login.errors.genericLoginError');

      setServerError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      {serverError ? (
        <div className="alert alert-danger auth-alert" role="alert">
          {serverError}
        </div>
      ) : null}

      <TextField
        id="username"
        name="username"
        label={t('login.usernameLabel')}
        value={formData.username}
        onChange={handleChange}
        error={errors.username}
        autoComplete="username"
        autoFocus
        required
      />

      <div className="mb-3">
        <div className="auth-link-row mb-2">
          <label htmlFor="password" className="form-label mb-0">
            {t('login.passwordLabel')}
          </label>
          <Link to="/forgot">{t('login.forgotPassword')}</Link>
        </div>

        <PasswordField
          id="password"
          name="password"
          label={t('login.passwordLabel')}
          showLabel={false}
          value={formData.password}
          onChange={handleChange}
          error={errors.password}
          autoComplete="current-password"
          required
        />
      </div>

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
              <span>{t('login.submitting')}</span>
            </span>
          ) : (
            t('login.submit')
          )}
        </button>
        <div className="text-center mt-3">
          <p className="small text-muted mb-0">
            {t('login.continuePolicyPrefix')}{' '}
            <Link to="/privacy">{t('login.privacyPolicy')}</Link> {t('login.continuePolicyConnector')}{' '}
            <Link to="/terms">{t('login.termsOfUse')}</Link>
            {t('login.continuePolicySuffix')}
          </p>
        </div>
      </div>
    </form>
  );
}

export default LoginForm;
