import { useI18n } from '../app/providers';
import AuthLayout from '../components/auth/AuthLayout';
import RegisterForm from '../components/auth/RegisterForm';

function RegisterPage() {
  const { t } = useI18n();

  return (
    <AuthLayout
      title={t('register.pageTitle')}
      subtitle={t('register.pageSubtitle')}
    >
      <RegisterForm />
    </AuthLayout>
  );
}

export default RegisterPage;
