import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PasswordField from './PasswordField';
import { resetPassword } from '../../api/authApi';
import { useI18n } from '../../app/providers';

function ResetPasswordForm() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = searchParams.get('token') || '';

  const [formData, setFormData] = useState({
    password: '',
    password_confirmation: ''
  });

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const passwordChecks = useMemo(() => {
    const password = formData.password || '';
    const symbolCount = (password.match(/[^a-zA-Z0-9]/g) || []).length;

    return {
      minLength: password.length >= 10,
      twoSymbols: symbolCount >= 2
    };
  }, [formData.password]);

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
    setSuccessMessage('');
  }

  function validate() {
    const nextErrors = {};

    if (!token) {
      nextErrors.token = t('resetPassword.errors.invalidToken');
    }

    if (!formData.password) {
      nextErrors.password = t('resetPassword.errors.passwordRequired');
    } else if (!passwordChecks.minLength || !passwordChecks.twoSymbols) {
      nextErrors.password = t('resetPassword.errors.passwordInvalid');
    }

    if (!formData.password_confirmation) {
      nextErrors.password_confirmation = t('resetPassword.errors.passwordConfirmationRequired');
    } else if (formData.password !== formData.password_confirmation) {
      nextErrors.password_confirmation = t('resetPassword.errors.passwordMismatch');
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

      await resetPassword({
        token,
        password: formData.password,
        password_confirmation: formData.password_confirmation
      });

      setSuccessMessage(t('resetPassword.successMessage'));

      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1500);
    } catch (error) {
      const message =
        error?.response?.data?.error || error?.message || t('resetPassword.errors.genericResetError');

      setServerError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      {errors.token ? (
        <div className="alert alert-danger auth-alert" role="alert">
          {errors.token}
        </div>
      ) : null}

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

      <PasswordField
        id="password"
        name="password"
        label={t('resetPassword.passwordLabel')}
        value={formData.password}
        onChange={handleChange}
        error={errors.password}
        autoComplete="new-password"
        helpText={t('resetPassword.passwordRules.helpText')}
        required
      >
        <ul className="auth-password-rules">
          <li className={passwordChecks.minLength ? 'is-valid' : 'is-invalid'}>
            {t('resetPassword.passwordRules.minLength')}
          </li>
          <li className={passwordChecks.twoSymbols ? 'is-valid' : 'is-invalid'}>
            {t('resetPassword.passwordRules.twoSymbols')}
          </li>
        </ul>
      </PasswordField>

      <PasswordField
        id="password_confirmation"
        name="password_confirmation"
        label={t('resetPassword.passwordConfirmationLabel')}
        value={formData.password_confirmation}
        onChange={handleChange}
        error={errors.password_confirmation}
        autoComplete="new-password"
        required
      />

      <div className="auth-form-actions">
        <button
          type="submit"
          className="btn btn-primary btn-lg auth-btn-block"
          disabled={isSubmitting || !token}
        >
          {isSubmitting ? (
            <span className="auth-spinner-gap">
              <span
                className="spinner-border spinner-border-sm"
                aria-hidden="true"
              />
              <span>{t('resetPassword.submitting')}</span>
            </span>
          ) : (
            t('resetPassword.submit')
          )}
        </button>
      </div>

      <hr className="auth-divider" />

      <p className="auth-footer">
        <Link to="/login">{t('resetPassword.backToLogin')}</Link>
      </p>
    </form>
  );
}

export default ResetPasswordForm;
