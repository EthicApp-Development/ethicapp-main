import { useState } from 'react';
import { Link } from 'react-router-dom';
import TextField from '../common/TextField';
import { forgotPassword } from '../../api/authApi';

function ForgotPasswordForm() {
  const [formData, setFormData] = useState({
    email: ''
  });

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
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
    setSuccessMessage('');
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validate() {
    const nextErrors = {};

    if (!formData.email.trim()) {
      nextErrors.email = 'El correo electrónico es obligatorio.';
    } else if (!isValidEmail(formData.email.trim())) {
      nextErrors.email = 'Introduce un correo electrónico válido.';
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

      await forgotPassword({
        email: formData.email.trim()
      });

      setSuccessMessage(
        'Si existe una cuenta asociada a ese correo, recibirás instrucciones para restablecer la contraseña.'
      );
    } catch (error) {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'No se ha podido procesar la solicitud. Inténtalo de nuevo.';

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

      {successMessage ? (
        <div className="alert alert-success auth-alert" role="alert">
          {successMessage}
        </div>
      ) : null}

      <TextField
        id="email"
        name="email"
        label="Correo electrónico"
        type="email"
        value={formData.email}
        onChange={handleChange}
        error={errors.email}
        autoComplete="email"
        autoFocus
        required
      />

      <div className="auth-form-text">
        Introduce el correo asociado a tu cuenta y te enviaremos un enlace para
        restablecer tu contraseña.
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
              <span>Enviando...</span>
            </span>
          ) : (
            'Enviar instrucciones'
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

export default ForgotPasswordForm;