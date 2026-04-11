import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '../../api/authApi';
import TextField from '../common/TextField';
import PasswordField from './PasswordField';

function LoginForm() {
  const navigate = useNavigate();

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
      nextErrors.username = 'El usuario es obligatorio.';
    }

    if (!formData.password) {
      nextErrors.password = 'La contraseña es obligatoria.';
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
      navigate(redirectTo, { replace: true });
    } catch (error) {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'No se ha podido iniciar sesión. Verifica tus credenciales.';

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
        label="Usuario"
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
            Contraseña
          </label>
          <Link to="/forgot">¿Has olvidado tu contraseña?</Link>
        </div>

        <PasswordField
          id="password"
          name="password"
          label="Contraseña"
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
              <span>Accediendo...</span>
            </span>
          ) : (
            'Entrar'
          )}
        </button>
      </div>
    </form>
  );
}

export default LoginForm;