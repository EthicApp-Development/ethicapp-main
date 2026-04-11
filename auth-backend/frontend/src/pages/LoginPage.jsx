import { Link } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import LoginForm from '../components/auth/LoginForm';

function LoginPage() {
  return (
    <AuthLayout
      title="Iniciar sesión"
      subtitle="Accede con tus credenciales"
      footer={
        <>
          <span>¿No tienes cuenta? </span>
          <Link to="/register">Crear cuenta</Link>
        </>
      }
    >
      <LoginForm />
    </AuthLayout>
  );
}

export default LoginPage;