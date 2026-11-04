import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { useI18n } from '../../app/i18n-context';

// What a person sees right after signing up (#1090). It replaces the form, so
// the next step cannot be missed: the address the confirmation message went
// to, where to look for it, and what to do when the address is wrong or the
// message does not arrive. Nothing redirects away from it. The page heading
// says "Revisa tu correo" meanwhile (RegisterPage), so the notice has none.
function RegisterSentNotice({ email, onCorrectEmail }) {
  const { t } = useI18n();
  const noticeRef = useRef(null);

  useEffect(() => {
    noticeRef.current?.focus({ preventScroll: true });
    // Back to the top, where the page heading now says "Revisa tu correo".
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <section
      id="register-sent"
      className="register-sent"
      role="status"
      aria-label={t('register.sent.title')}
      ref={noticeRef}
      tabIndex="-1"
    >
      <p className="mb-1">{t('register.sent.sentTo')}</p>
      <p className="register-sent-email">{email}</p>

      <p>{t('register.sent.openLink')}</p>
      <p>{t('register.sent.checkSpam')}</p>

      <div className="alert alert-warning auth-alert register-sent-wrong-email">
        <p className="mb-2">{t('register.sent.wrongEmailQuestion')}</p>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onCorrectEmail}>
          {t('register.sent.correctEmail')}
        </button>
      </div>

      <p className="small text-muted">
        {t('register.sent.notArrivedPrefix')}{' '}
        <Link to="/forgot">{t('register.sent.requestNewLink')}</Link>
        {t('register.sent.notArrivedSuffix')}
      </p>

      <div className="auth-form-actions">
        <Link to="/login" className="btn btn-primary btn-lg auth-btn-block">
          {t('register.sent.goToLogin')}
        </Link>
      </div>
    </section>
  );
}

RegisterSentNotice.propTypes = {
  email: PropTypes.string.isRequired,
  onCorrectEmail: PropTypes.func.isRequired
};

export default RegisterSentNotice;
