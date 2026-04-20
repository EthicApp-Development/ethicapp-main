import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PasswordField from './PasswordField';
import { resetPassword } from '../../api/authApi';

function ResetPasswordForm() {
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
      nextErrors.token = 'El enlace de recuperación no es válido.';
    }

    if (!formData.password) {
      nextErrors.password = 'La nueva contraseña es obligatoria.';
    } else {
      if (!passwordChecks.minLength || !passwordChecks.twoSymbols) {
        nextErrors.password =
          'La contraseña debe tener al menos 10 caracteres y 2 símbolos.';
      }
    }

    if (!formData.password_confirmation) {
      nextErrors.password_confirmation = 'Debes confirmar la contraseña.';
    } else if (formData.password !== formData.password_confirmation) {
      nextErrors.password_confirmation = 'Las contraseñas no coinciden.';
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

      setSuccessMessage(
        'La contraseña se ha actualizado correctamente. Serás redirigido para iniciar sesión.'
      );

      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1500);
    } catch (error) {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'No se ha podido restablecer la contraseña. Solicita un nuevo enlace.';

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
        label="Nueva contraseña"
        value={formData.password}
        onChange={handleChange}
        error={errors.password}
        autoComplete="new-password"
        helpText="Mínimo 10 caracteres y al menos 2 símbolos."
        required
      >
        <ul className="auth-password-rules">
          <li className={passwordChecks.minLength ? 'is-valid' : 'is-invalid'}>
            Mínimo 10 caracteres
          </li>
          <li className={passwordChecks.twoSymbols ? 'is-valid' : 'is-invalid'}>
            Al menos 2 símbolos
          </li>
        </ul>
      </PasswordField>

      <PasswordField
        id="password_confirmation"
        name="password_confirmation"
        label="Confirmar nueva contraseña"
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
              <span>Actualizando...</span>
            </span>
          ) : (
            'Actualizar contraseña'
          )}
        </button>
      </div>

      <hr className="auth-divider" />

      <p className="auth-footer">
        <Link to="/login">Volver a iniciar sesión</Link>
      </p>
    </form>
  );
}

export default ResetPasswordForm;