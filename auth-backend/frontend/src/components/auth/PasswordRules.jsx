import PropTypes from 'prop-types';
import { useI18n } from '../../app/i18n-context';

// The live checklist of the password rule. `keyPrefix` names the form's
// translations (for example `register.passwordRules`). Renders nothing
// while the policy is unknown.
function PasswordRules({ policy = null, checks = null, keyPrefix }) {
  const { t } = useI18n();

  if (!policy || !checks) {
    return null;
  }

  return (
    <ul className="auth-password-rules">
      <li className={checks.minLength ? 'is-valid' : 'is-invalid'}>
        {t(`${keyPrefix}.minLength`, policy)}
      </li>
      <li className={checks.minSymbols ? 'is-valid' : 'is-invalid'}>
        {t(`${keyPrefix}.minSymbols`, policy)}
      </li>
    </ul>
  );
}

PasswordRules.propTypes = {
  policy: PropTypes.shape({
    minLength: PropTypes.number.isRequired,
    minSymbols: PropTypes.number.isRequired
  }),
  checks: PropTypes.shape({
    minLength: PropTypes.bool.isRequired,
    minSymbols: PropTypes.bool.isRequired
  }),
  keyPrefix: PropTypes.string.isRequired
};

export default PasswordRules;
