import PropTypes from 'prop-types';
import { Button } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { CREATED_AT_SORTS, toggleCreatedAtSort } from './accountDates.js';

// Header of the user list's creation-date column. Selecting it switches
// between newest and oldest accounts first.
function CreatedAtSortHeader({ sort, onSortChange }) {
  const { t } = useI18n();
  const oldestFirst = sort === CREATED_AT_SORTS.oldestFirst;
  const nextOrderLabel = t(oldestFirst ? 'pages.users.sort.newestFirst' : 'pages.users.sort.oldestFirst');

  return (
    <th aria-sort={oldestFirst ? 'ascending' : 'descending'}>
      <Button
        type="button"
        variant="link"
        className="p-0 fw-bold text-reset text-decoration-none d-inline-flex align-items-center gap-1"
        title={nextOrderLabel}
        onClick={() => onSortChange(toggleCreatedAtSort(sort))}
        data-testid="users-sort-created-at"
      >
        {t('pages.users.columns.createdAt')}
        <i className={`fa-solid ${oldestFirst ? 'fa-arrow-up' : 'fa-arrow-down'}`} aria-hidden="true" />
        <span className="visually-hidden">{nextOrderLabel}</span>
      </Button>
    </th>
  );
}

CreatedAtSortHeader.propTypes = {
  sort: PropTypes.string.isRequired,
  onSortChange: PropTypes.func.isRequired
};

export default CreatedAtSortHeader;
