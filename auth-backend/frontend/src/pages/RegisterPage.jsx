import AuthLayout from '../components/auth/AuthLayout';
import RegisterForm from '../components/auth/RegisterForm';

function RegisterPage() {
  return (
    <AuthLayout
      title="Crear cuenta"
      subtitle="Completa tus datos para registrarte"
    >
      <RegisterForm />
    </AuthLayout>
  );
}

export default RegisterPage;