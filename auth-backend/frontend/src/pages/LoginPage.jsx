import { Link } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import LoginForm from '../components/auth/LoginForm';
import CookieNoticeOverlay from '../components/common/CookieNoticeOverlay';
import { useI18n } from '../app/i18n-context';
import useCookieNotice from '../hooks/useCookieNotice';

function LoginPage() {
  const { isOpen, acceptNotice } = useCookieNotice();
  const { t } = useI18n();

  return (
    <>
      <AuthLayout
        title={t('login.title')}
        subtitle={t('login.subtitle')}
        footer={
          <>
            <span>{t('login.noAccount')} </span>
            <Link to="/register">{t('login.createAccount')}</Link>
          </>
        }
      >
        <LoginForm />
      </AuthLayout>
      <CookieNoticeOverlay
        open={isOpen}
        onAccept={acceptNotice}
        privacyUrl="/privacy"
        termsUrl="/terms"
      />
    </>
  );
}

export default LoginPage;
