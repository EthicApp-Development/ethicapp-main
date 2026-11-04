import { useState } from 'react';
import { useI18n } from '../app/i18n-context';
import AuthLayout from '../components/auth/AuthLayout';
import RegisterForm from '../components/auth/RegisterForm';

function RegisterPage() {
  const { t } = useI18n();
  // Once the sign-up is sent, the page heading names the next step (#1090).
  const [isSent, setIsSent] = useState(false);

  return (
    <AuthLayout
      title={isSent ? t('register.sent.title') : t('register.pageTitle')}
      subtitle={isSent ? t('register.sent.subtitle') : t('register.pageSubtitle')}
    >
      <RegisterForm onSentChange={setIsSent} />
    </AuthLayout>
  );
}

export default RegisterPage;
