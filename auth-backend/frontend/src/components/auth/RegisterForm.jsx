import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PasswordField from './PasswordField';
import TextField from '../common/TextField';
import SelectField from '../common/SelectField';
import { register } from '../../api/authApi';

function RegisterForm() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    lastname: '',
    dni: '',
    email: '',
    gender: '',
    password: '',
    password_confirmation: ''
  });

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const genderOptions = [
    { value: 'F', label: 'Femenino' },
    { value: 'M', label: 'Masculino' },
    { value: 'O', label: 'Otro' }
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

    if (!formData.name.trim()) {
      nextErrors.name = 'El nombre es obligatorio.';
    }

    if (!formData.lastname.trim()) {
      nextErrors.lastname = 'El apellido es obligatorio.';
    }

    if (!formData.dni.trim()) {
      nextErrors.dni = 'El identificador es obligatorio.';
    }

    if (!formData.email.trim()) {
      nextErrors.email = 'El correo electrónico es obligatorio.';
    } else if (!isValidEmail(formData.email.trim())) {
      nextErrors.email = 'Introduce un correo electrónico válido.';
    }

    if (!formData.gender) {
      nextErrors.gender = 'Debes seleccionar una opción.';
    }

    if (!formData.password) {
      nextErrors.password = 'La contraseña es obligatoria.';
    } else if (!passwordChecks.minLength || !passwordChecks.twoSymbols) {
      nextErrors.password =
        'La contraseña debe tener al menos 10 caracteres y 2 símbolos.';
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

      await register({
        name: formData.name.trim(),
        lastname: formData.lastname.trim(),
        dni: formData.dni.trim(),
        email: formData.email.trim(),
        gender: formData.gender,
        password: formData.password,
        password_confirmation: formData.password_confirmation
      });

      setSuccessMessage('Cuenta creada correctamente. Ya puedes iniciar sesión.');

      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1200);
    } catch (error) {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'No se ha podido completar el registro. Inténtalo de nuevo.';

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
        id="name"
        name="name"
        label="Nombre"
        value={formData.name}
        onChange={handleChange}
        error={errors.name}
        autoComplete="given-name"
        autoFocus
        required
      />

      <TextField
        id="lastname"
        name="lastname"
        label="Apellido"
        value={formData.lastname}
        onChange={handleChange}
        error={errors.lastname}
        autoComplete="family-name"
        required
      />

      <TextField
        id="dni"
        name="dni"
        label="DNI / RUT"
        value={formData.dni}
        onChange={handleChange}
        error={errors.dni}
        placeholder="Sin puntos, con guión"
        required
      />

      <TextField
        id="email"
        name="email"
        label="Correo electrónico"
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
        label="Género"
        value={formData.gender}
        onChange={handleChange}
        error={errors.gender}
        options={genderOptions}
        placeholder="Selecciona una opción"
        required
      />

      <PasswordField
        id="password"
        name="password"
        label="Contraseña"
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
        label="Confirmar contraseña"
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
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <span className="auth-spinner-gap">
              <span
                className="spinner-border spinner-border-sm"
                aria-hidden="true"
              />
              <span>Registrando...</span>
            </span>
          ) : (
            'Crear cuenta'
          )}
        </button>
      </div>

      <hr className="auth-divider" />

      <p className="auth-footer">
        <span>¿Ya tienes cuenta? </span>
        <Link to="/login">Iniciar sesión</Link>
      </p>
    </form>
  );
}

export default RegisterForm;