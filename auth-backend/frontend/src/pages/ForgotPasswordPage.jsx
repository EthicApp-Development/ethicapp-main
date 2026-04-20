import AuthLayout from '../components/auth/AuthLayout';
import ForgotPasswordForm from '../components/auth/ForgotPasswordForm';

function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Recuperar contraseña"
      subtitle="Te ayudaremos a restablecer el acceso a tu cuenta"
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}

export default ForgotPasswordPage;