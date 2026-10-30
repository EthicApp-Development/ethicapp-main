import PropTypes from 'prop-types';

import { useI18n } from '../../app/providers.jsx';
import { ACCOUNT_STATUSES, accountStatusBadgeVariant } from './accountStatus.js';

// The account's lifecycle status on its page, with what it means for the
// owner: a pending account was never confirmed by its owner, an inactive one
// was deactivated by an administrator.
function AccountStatusSummary({ status }) {
  const { t } = useI18n();

  return (
    <div data-testid="account-status" data-account-status={status}>
      <span className={`badge text-bg-${accountStatusBadgeVariant(status)}`}>
        {t(`pages.userShow.accountStatus.${status}.label`)}
      </span>
      <p className="form-text mb-0 mt-1">{t(`pages.userShow.accountStatus.${status}.description`)}</p>
    </div>
  );
}

AccountStatusSummary.propTypes = {
  status: PropTypes.oneOf(Object.values(ACCOUNT_STATUSES)).isRequired
};

export default AccountStatusSummary;
