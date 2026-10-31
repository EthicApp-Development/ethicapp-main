import PropTypes from 'prop-types';

import { useI18n } from '../../app/providers.jsx';
import { checkPassword } from './passwordPolicy.js';

function Rule({ met, children }) {
  return (
    <li className={met ? 'text-success' : 'text-secondary'} data-met={met ? 'true' : 'false'}>
      <i className={`fa-solid ${met ? 'fa-check' : 'fa-xmark'} me-2`} aria-hidden="true" />
      {children}
    </li>
  );
}

Rule.propTypes = {
  met: PropTypes.bool.isRequired,
  children: PropTypes.node.isRequired
};

// The live checklist of the password rule, built from auth-backend's
// limits. With `confirmation`, it also says whether the confirmation
// matches. Renders nothing while the policy is unknown.
function PasswordRules({ policy = null, password, confirmation = undefined, id = undefined }) {
  const { t } = useI18n();
  const checks = checkPassword(password, policy);

  if (!checks) {
    return null;
  }

  return (
    <ul className="list-unstyled small mb-0 mt-2" id={id} data-testid="password-rules">
      <Rule met={checks.minLength}>{t('passwordRules.minLength', policy)}</Rule>
      <Rule met={checks.minSymbols}>{t('passwordRules.minSymbols', policy)}</Rule>
      {confirmation !== undefined ? (
        <Rule met={password !== '' && password === confirmation}>{t('passwordRules.matches')}</Rule>
      ) : null}
    </ul>
  );
}

PasswordRules.propTypes = {
  policy: PropTypes.shape({
    minLength: PropTypes.number.isRequired,
    minSymbols: PropTypes.number.isRequired
  }),
  password: PropTypes.string.isRequired,
  confirmation: PropTypes.string,
  id: PropTypes.string
};

export default PasswordRules;
