import { useI18n } from '../app/providers';
import AuthLayout from '../components/auth/AuthLayout';
import ForgotPasswordForm from '../components/auth/ForgotPasswordForm';

function ForgotPasswordPage() {
  const { t } = useI18n();

  return (
    <AuthLayout
      title={t('forgotPassword.pageTitle')}
      subtitle={t('forgotPassword.pageSubtitle')}
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}

export default ForgotPasswordPage;
