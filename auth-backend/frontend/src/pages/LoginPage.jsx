import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import LoginForm from '../components/auth/LoginForm';
import CookieNoticeOverlay from '../components/common/CookieNoticeOverlay';
import { useI18n } from '../app/i18n-context';
import useCookieNotice from '../hooks/useCookieNotice';
import { useSessionRedirect } from '../hooks/useSessionRedirect';

// The sign-in form. A visitor who already has a session is sent to their
// role's home instead, as a successful login does; checkSession is false
// only where the session is being ended (LogoutPage).
function LoginPage({ checkSession = true }) {
  const { isOpen, acceptNotice } = useCookieNotice();
  const { t } = useI18n();
  const sessionStatus = useSessionRedirect({ enabled: checkSession });
  const showForm = sessionStatus === 'anonymous';

  return (
    <>
      <AuthLayout
        title={t('login.title')}
        subtitle={t('login.subtitle')}
        footer={showForm ? (
          <>
            <span>{t('login.noAccount')} </span>
            <Link to="/register">{t('login.createAccount')}</Link>
          </>
        ) : null}
      >
        {showForm ? (
          <LoginForm />
        ) : (
          <div className="auth-session-check" role="status">
            <span className="spinner-border text-secondary" aria-hidden="true" />
            <span className="visually-hidden">{t('login.checkingSession')}</span>
          </div>
        )}
      </AuthLayout>
      <CookieNoticeOverlay
        open={showForm && isOpen}
        onAccept={acceptNotice}
        privacyUrl="/privacy"
        termsUrl="/terms"
      />
    </>
  );
}

LoginPage.propTypes = {
  checkSession: PropTypes.bool
};

export default LoginPage;
