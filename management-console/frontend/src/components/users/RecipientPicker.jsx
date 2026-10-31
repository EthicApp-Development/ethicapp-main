import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Form, InputGroup, ListGroup, Spinner } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { fetchUsers } from '../../api/usersApi.js';
import { recipientFromUser } from './teacherForgetting.js';

const SEARCH_ID = 'forget-teacher-recipient-search';

// Picks the teacher who receives a forgotten teacher's materials (#877):
// searches the active teachers by name or email and offers each, except the
// teacher being forgotten. `value` is { id, name, email } or null.
function RecipientPicker({ excludeUserId, value, onChange, disabled = false }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  async function search() {
    if (searching || disabled) {
      return;
    }

    setSearching(true);
    setSearchError(false);

    try {
      const result = await fetchUsers({ keywords: query, role: 'P', status: 'active' });
      setResults((result?.items || [])
        .filter((user) => Number(user.id) !== Number(excludeUserId) && user.role === 'P')
        .map(recipientFromUser));
    } catch {
      setResults(null);
      setSearchError(true);
    } finally {
      setSearching(false);
    }
  }

  function onKeyDown(event) {
    // The dialog is not a form: Enter searches instead of submitting the
    // account form behind it.
    if (event.key === 'Enter') {
      event.preventDefault();
      search();
    }
  }

  const prefix = 'pages.userForgetTeacher.plan';

  return (
    <section data-testid="forget-teacher-recipient" aria-labelledby="forget-teacher-recipient-heading">
      <h3 id="forget-teacher-recipient-heading" className="h6 mt-3">{t(`${prefix}.recipientHeading`)}</h3>
      <p className="form-text mt-0">{t(`${prefix}.recipientHelp`)}</p>

      {value ? (
        <>
          <div className="d-flex flex-wrap align-items-center gap-2" data-testid="forget-teacher-recipient-selected">
            <span>{t(`${prefix}.recipientSelected`, { name: value.name, email: value.email })}</span>
            <Button
              type="button"
              size="sm"
              variant="outline-secondary"
              disabled={disabled}
              data-testid="forget-teacher-recipient-remove"
              onClick={() => onChange(null)}
            >
              {t(`${prefix}.recipientRemove`)}
            </Button>
          </div>
          <Alert variant="warning" className="py-2 small mt-2" data-testid="forget-teacher-recipient-warning">
            {t(`${prefix}.recipientWarning`, { name: value.name })}
          </Alert>
        </>
      ) : (
        <>
          <Form.Label htmlFor={SEARCH_ID} className="visually-hidden">{t(`${prefix}.recipientSearch`)}</Form.Label>
          <InputGroup size="sm">
            <Form.Control
              id={SEARCH_ID}
              type="search"
              value={query}
              placeholder={t(`${prefix}.recipientSearch`)}
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <Button
              type="button"
              variant="outline-secondary"
              disabled={disabled || searching}
              data-testid="forget-teacher-recipient-search"
              onClick={search}
            >
              {searching ? <Spinner size="sm" className="me-1" aria-hidden="true" /> : null}
              {t(`${prefix}.recipientSearchButton`)}
            </Button>
          </InputGroup>
          {searchError ? (
            <p className="form-text text-danger" role="alert">{t(`${prefix}.recipientSearchError`)}</p>
          ) : null}
          {results && results.length === 0 ? (
            <p className="form-text" data-testid="forget-teacher-recipient-empty">{t(`${prefix}.recipientNoResults`)}</p>
          ) : null}
          {results && results.length > 0 ? (
            <ListGroup className="mt-2" data-testid="forget-teacher-recipient-results">
              {results.map((user) => (
                <ListGroup.Item key={user.id} className="d-flex justify-content-between align-items-center gap-2">
                  <span>
                    {user.name}
                    <span className="text-body-secondary small ms-2">{user.email}</span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline-primary"
                    disabled={disabled}
                    data-testid={`forget-teacher-recipient-choose-${user.id}`}
                    onClick={() => onChange(user)}
                  >
                    {t(`${prefix}.recipientChoose`)}
                  </Button>
                </ListGroup.Item>
              ))}
            </ListGroup>
          ) : null}
        </>
      )}
    </section>
  );
}

RecipientPicker.propTypes = {
  excludeUserId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  value: PropTypes.shape({
    id: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
    email: PropTypes.string.isRequired
  }),
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool
};

export default RecipientPicker;
