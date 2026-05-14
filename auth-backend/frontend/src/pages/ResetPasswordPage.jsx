import { useI18n } from '../app/i18n-context';
import AuthLayout from '../components/auth/AuthLayout';
import ResetPasswordForm from '../components/auth/ResetPasswordForm';

function ResetPasswordPage() {
  const { t } = useI18n();

  return (
    <AuthLayout
      title={t('resetPassword.pageTitle')}
      subtitle={t('resetPassword.pageSubtitle')}
    >
      <ResetPasswordForm />
    </AuthLayout>
  );
}

export default ResetPasswordPage;
