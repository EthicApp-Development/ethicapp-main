import { Link, useSearchParams } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import LoginForm from '../components/auth/LoginForm';
import CookieNoticeOverlay from '../components/common/CookieNoticeOverlay';
import { useI18n } from '../app/i18n-context';
import useCookieNotice from '../hooks/useCookieNotice';
import { readReturnTo, withReturnTo } from '../utils/returnTo';

function LoginPage() {
  const { isOpen, acceptNotice } = useCookieNotice();
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const returnTo = readReturnTo(searchParams);

  return (
    <>
      <AuthLayout
        title={t('login.title')}
        subtitle={t('login.subtitle')}
        footer={
          <>
            <span>{t('login.noAccount')} </span>
            <Link to={withReturnTo('/register', returnTo)}>{t('login.createAccount')}</Link>
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
