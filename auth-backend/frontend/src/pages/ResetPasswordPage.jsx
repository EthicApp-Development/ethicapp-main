import AuthLayout from '../components/auth/AuthLayout';
import ResetPasswordForm from '../components/auth/ResetPasswordForm';

function ResetPasswordPage() {
  return (
    <AuthLayout
      title="Nueva contraseña"
      subtitle="Introduce tu nueva contraseña para recuperar el acceso"
    >
      <ResetPasswordForm />
    </AuthLayout>
  );
}

export default ResetPasswordPage;