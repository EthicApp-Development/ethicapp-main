import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useI18n } from '../app/providers.jsx';
import { fetchProfile } from '../api/profileApi.js';
import {
  confirmAccount,
  deleteAccount,
  fetchUserById,
  impersonateProfessor,
  triggerPasswordReset,
  updateUser
} from '../api/usersApi.js';
import SensitiveActionConfirmModal from '../components/common/SensitiveActionConfirmModal.jsx';
import { useSensitiveActionConfirmation } from '../components/common/useSensitiveActionConfirmation.js';
import AccountStatusSummary from '../components/users/AccountStatusSummary.jsx';
import ErasureStatusPanel from '../components/users/ErasureStatusPanel.jsx';
import ForgetStudentButton from '../components/users/ForgetStudentButton.jsx';
import { unsavedChangesHint } from '../components/users/unsavedChangesHint.js';
import {
  ACCOUNT_STATUSES,
  accountActionErrorKey,
  accountStatusOf
} from '../components/users/accountStatus.js';
import { formatAccountDate } from '../components/users/accountDates.js';
import {
  accountAgeDetails,
  accountDeletionErrorMessage,
  isDeletableAccount
} from '../components/users/accountDeletion.js';

function formFromUser(user) {
  return {
    firstname: user.firstname || '',
    lastname: user.lastname || '',
    sex: user.sex || 'O',
    email: user.email || '',
    email_confirmation: user.email || '',
    role: user.role || 'A',
    active: user.active !== false,
    emailConfirmed: user.emailConfirmed !== false
  };
}

// Form fields an administrator can edit; any difference from the loaded
// account is an unsaved change.
const EDITABLE_FIELDS = Object.freeze(['firstname', 'lastname', 'sex', 'email', 'email_confirmation', 'role', 'active']);
// The hint for every account action that unsaved edits disable.
const UNSAVED_CHANGES_HINT_ID = 'unsaved-changes-hint';

function UserShowPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [lastLoginAt, setLastLoginAt] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [accountStatus, setAccountStatus] = useState(ACCOUNT_STATUSES.active);
  // The account as last loaded from the server. Dialogs name the account
  // from it, never from the form, which may hold unsaved edits.
  const [savedForm, setSavedForm] = useState(null);
  // Saving, confirming the account, password recovery and impersonation ask
  // for the administrator's passkey, or password and reCAPTCHA, in a dialog.
  const { requestConfirmation, modalProps } = useSensitiveActionConfirmation();

  const [form, setForm] = useState({
    firstname: '',
    lastname: '',
    sex: 'O',
    email: '',
    email_confirmation: '',
    role: 'A',
    active: true,
    emailConfirmed: true
  });
  const isOwnSuperAdminAccount =
    currentProfile?.role === 'S' &&
    form.role === 'S' &&
    Number(currentProfile.id) === Number(id);
  const isPendingAccount = accountStatus === ACCOUNT_STATUSES.pending;
  const canDeleteAccount = isDeletableAccount({ status: accountStatus, lastLoginAt });
  // An anonymized account names no one: it is shown read-only, with where
  // its data has been erased (#876).
  const isAnonymizedAccount = accountStatus === ACCOUNT_STATUSES.anonymized;
  const canForgetStudent = savedForm?.role === 'A' && !isAnonymizedAccount;
  const hasUnsavedChanges = savedForm !== null &&
    EDITABLE_FIELDS.some((fieldName) => form[fieldName] !== savedForm[fieldName]);
  const unsavedHint = hasUnsavedChanges
    ? unsavedChangesHint([
      ...(isPendingAccount ? ['confirm'] : []),
      ...(canDeleteAccount ? ['delete'] : []),
      ...(canForgetStudent ? ['forget'] : [])
    ], t)
    : null;
  const unsavedHintId = unsavedHint ? UNSAVED_CHANGES_HINT_ID : undefined;

  const applyUser = useCallback((user) => {
    const persistedForm = formFromUser(user);
    setForm(persistedForm);
    setSavedForm(persistedForm);
    setLastLoginAt(user.lastLoginAt || null);
    setCreatedAt(user.createdAt || null);
    setAccountStatus(accountStatusOf(user));
  }, []);

  // Reloads the account after an action, so the page shows what was saved.
  // A failure keeps the page as it is; the action's own message stands.
  const reloadUser = useCallback(async () => {
    try {
      applyUser(await fetchUserById(id));
    } catch {
      // The next visit to the page loads the account again.
    }
  }, [applyUser, id]);

  useEffect(() => {
    let isMounted = true;

    async function loadUser() {
      setLoading(true);
      setError('');

      try {
        const [user, profileResult] = await Promise.all([
          fetchUserById(id),
          fetchProfile()
        ]);

        if (!isMounted) {
          return;
        }

        applyUser(user);
        setCurrentProfile(profileResult);
      } catch (requestError) {
        if (isMounted) {
          setError(requestError.message || 'Unable to load user');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadUser();

    return () => {
      isMounted = false;
    };
  }, [applyUser, id]);

  function onFieldChange(fieldName, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [fieldName]: value
    }));
  }

  function onDiscardChanges() {
    if (savedForm) {
      setForm(savedForm);
    }
  }

  const savedEmail = savedForm?.email || '';
  const accountName = `${savedForm?.firstname || ''} ${savedForm?.lastname || ''}`.trim() || savedEmail;

  function confirmAction(action, request) {
    return requestConfirmation({
      title: t(`pages.userShow.confirm.${action}.title`),
      description: t(`pages.userShow.confirm.${action}.body`, { name: accountName, email: savedEmail }),
      confirmLabel: t(`pages.userShow.confirm.${action}.confirm`),
      action: request
    });
  }

  function formatLastLogin(value) {
    if (!value) {
      return t('pages.userShow.status.neverLoggedIn');
    }

    return new Intl.DateTimeFormat(locale.replace('_', '-'), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    try {
      const outcome = await confirmAction('save', (stepUp) => updateUser(id, { ...form, ...stepUp }));
      if (outcome.confirmed) {
        setSuccess(t('pages.userShow.saveSuccess'));
        await reloadUser();
      }
    } catch (requestError) {
      setError(requestError.message || t('pages.userShow.saveError'));
    }
  }

  async function onConfirmAccount() {
    if (!isPendingAccount || hasUnsavedChanges) {
      return;
    }

    setError('');
    setSuccess('');

    // The backend confirms the account only while it still has the email
    // the administrator approved in the dialog.
    const expectedEmail = savedEmail;

    try {
      const outcome = await confirmAction(
        'confirmAccount',
        (stepUp) => confirmAccount(id, { ...stepUp, expected_email: expectedEmail })
      );
      if (outcome.confirmed) {
        setSuccess(t('pages.userShow.confirmAccountSuccess', { name: accountName }));
        await reloadUser();
      }
    } catch (requestError) {
      const errorKey = accountActionErrorKey(requestError);
      setError(t(errorKey || 'pages.userShow.confirmAccountError'));
      if (errorKey) {
        // The account changed meanwhile: show its current status.
        await reloadUser();
      }
    }
  }

  async function onDeleteAccount() {
    if (!canDeleteAccount || hasUnsavedChanges) {
      return;
    }

    setError('');
    setSuccess('');

    // The backend deletes the account only while it still has the email the
    // administrator approved in the dialog.
    const expectedEmail = savedEmail;

    try {
      const outcome = await requestConfirmation({
        title: t('pages.userShow.deleteAccount.title'),
        description: t('pages.userShow.deleteAccount.body', { name: accountName, email: savedEmail }),
        details: accountAgeDetails(createdAt, locale, t),
        confirmLabel: t('pages.userShow.deleteAccount.confirm'),
        confirmVariant: 'danger',
        action: (stepUp) => deleteAccount(id, { ...stepUp, expected_email: expectedEmail })
      });
      if (outcome.confirmed) {
        navigate('/users', { state: { accountDeleted: true } });
      }
    } catch (requestError) {
      const message = accountDeletionErrorMessage(requestError, t);
      setError(message || t('pages.userShow.deleteAccount.error'));
      if (message) {
        // The account changed or is in use: show it as it is now.
        await reloadUser();
      }
    }
  }

  async function onStudentForgotten() {
    setError('');
    setResetMessage('');
    setSuccess(t('pages.userForget.success', { name: accountName }));
    await reloadUser();
  }

  async function onForgetStudentError(message, { changed }) {
    setSuccess('');
    setError(message);
    if (changed) {
      // The account changed meanwhile: show its current state.
      await reloadUser();
    }
  }

  async function onTriggerPasswordReset() {
    if (isOwnSuperAdminAccount) {
      return;
    }

    setError('');
    setResetMessage('');

    try {
      const outcome = await confirmAction('passwordReset', (stepUp) => triggerPasswordReset(id, stepUp));
      if (outcome.confirmed) {
        setResetMessage(outcome.result.message || t('pages.userShow.passwordResetSuccess'));
      }
    } catch (requestError) {
      setError(requestError.message || t('pages.userShow.passwordResetError'));
    }
  }

  async function onImpersonateProfessor() {
    setError('');

    try {
      const outcome = await confirmAction('impersonation', (stepUp) => impersonateProfessor(id, stepUp));
      if (outcome.confirmed) {
        window.location.assign(outcome.result.redirectTo || '/home');
      }
    } catch (requestError) {
      setError(requestError.message || t('pages.userShow.impersonationError'));
    }
  }

  if (loading) {
    return <Spinner />;
  }

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <Card.Title className="d-flex align-items-center gap-2 mb-0">
            <i className="fa-solid fa-id-card text-primary" aria-hidden="true" />
            <span>{t('pages.userShow.heading')}</span>
          </Card.Title>
          <Button variant="outline-secondary" as={Link} to="/users">
            <i className="fa-solid fa-arrow-left me-2" aria-hidden="true" />
            {t('pages.userShow.back')}
          </Button>
        </div>

        {error ? <Alert variant="danger">{error}</Alert> : null}
        {success ? <Alert variant="success">{success}</Alert> : null}
        {resetMessage ? <Alert variant="info">{resetMessage}</Alert> : null}

        <Form onSubmit={onSubmit}>
          <Row as="fieldset" className="g-3" disabled={isAnonymizedAccount}>
            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.firstname')}</Form.Label>
              <Form.Control
                value={form.firstname}
                onChange={(event) => onFieldChange('firstname', event.target.value)}
                required
              />
            </Col>
            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.lastname')}</Form.Label>
              <Form.Control
                value={form.lastname}
                onChange={(event) => onFieldChange('lastname', event.target.value)}
                required
              />
            </Col>

            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.gender')}</Form.Label>
              <Form.Select value={form.sex} onChange={(event) => onFieldChange('sex', event.target.value)}>
                <option value="F">{t('genders.F')}</option>
                <option value="M">{t('genders.M')}</option>
                <option value="O">{t('genders.O')}</option>
              </Form.Select>
            </Col>

            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.role')}</Form.Label>
              <Form.Select value={form.role} onChange={(event) => onFieldChange('role', event.target.value)}>
                <option value="A">{t('roles.A')}</option>
                <option value="P">{t('roles.P')}</option>
                {form.role === 'S' ? <option value="S">{t('roles.S')}</option> : null}
              </Form.Select>
              <Form.Text>{t('pages.userShow.roleHelp')}</Form.Text>
            </Col>

            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.status')}</Form.Label>
              <AccountStatusSummary status={accountStatus} />
              <Form.Check
                type="switch"
                id="account-active"
                className="mt-2"
                label={form.active ? t('pages.userShow.status.active') : t('pages.userShow.status.inactive')}
                checked={form.active}
                disabled={isPendingAccount}
                aria-describedby={isPendingAccount ? 'account-active-help' : undefined}
                onChange={(event) => onFieldChange('active', event.target.checked)}
              />
              {isPendingAccount ? (
                <Form.Text id="account-active-help">{t('pages.userShow.status.pendingActivationHelp')}</Form.Text>
              ) : null}
            </Col>

            <Col md={3}>
              <Form.Label>{t('pages.userShow.fields.createdAt')}</Form.Label>
              <Form.Control
                plaintext
                readOnly
                value={
                  formatAccountDate(createdAt, locale, { withTime: true }) ||
                  t('pages.userShow.status.createdAtUnknown')
                }
                data-testid="user-created-at"
              />
            </Col>

            <Col md={3}>
              <Form.Label>{t('pages.userShow.fields.lastLogin')}</Form.Label>
              <Form.Control plaintext readOnly value={formatLastLogin(lastLoginAt)} />
            </Col>

            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.email')}</Form.Label>
              <Form.Control
                type="email"
                value={form.email}
                onChange={(event) => onFieldChange('email', event.target.value)}
                required
              />
            </Col>

            <Col md={6}>
              <Form.Label>{t('pages.userShow.fields.emailConfirmation')}</Form.Label>
              <Form.Control
                type="email"
                value={form.email_confirmation}
                onChange={(event) => onFieldChange('email_confirmation', event.target.value)}
                required
              />
            </Col>

          </Row>

          <div className="d-flex flex-wrap gap-2 mt-4">
            {!isAnonymizedAccount ? (
              <Button type="submit">
                <i className="fa-solid fa-floppy-disk me-2" aria-hidden="true" />
                {t('pages.userShow.actions.save')}
              </Button>
            ) : null}
            <Button type="button" variant="outline-primary" onClick={() => navigate('/users')}>
              <i className="fa-solid fa-xmark me-2" aria-hidden="true" />
              {t('pages.userShow.actions.cancel')}
            </Button>
            {isPendingAccount ? (
              <Button
                type="button"
                variant="success"
                data-testid="confirm-account-button"
                disabled={hasUnsavedChanges}
                aria-describedby={unsavedHintId}
                onClick={onConfirmAccount}
              >
                <i className="fa-solid fa-user-check me-2" aria-hidden="true" />
                {t('pages.userShow.actions.confirmAccount')}
              </Button>
            ) : null}
            {!isOwnSuperAdminAccount && !isAnonymizedAccount ? (
              <Button
                type="button"
                variant="warning"
                onClick={onTriggerPasswordReset}
              >
                <i className="fa-solid fa-key me-2" aria-hidden="true" />
                {t('pages.userShow.actions.triggerPasswordReset')}
              </Button>
            ) : null}
            {form.role === 'P' ? (
              <Button
                type="button"
                variant="dark"
                onClick={onImpersonateProfessor}
              >
                <i className="fa-solid fa-user-secret me-2" aria-hidden="true" />
                {t('pages.userShow.actions.impersonateProfessor')}
              </Button>
            ) : null}
            {canDeleteAccount ? (
              <Button
                type="button"
                variant="outline-danger"
                data-testid="delete-account-button"
                disabled={hasUnsavedChanges}
                aria-describedby={unsavedHintId}
                onClick={onDeleteAccount}
              >
                <i className="fa-solid fa-trash me-2" aria-hidden="true" />
                {t('pages.userShow.deleteAccount.action')}
              </Button>
            ) : null}
            {canForgetStudent ? (
              <ForgetStudentButton
                userId={id}
                accountName={accountName}
                email={savedEmail}
                disabled={hasUnsavedChanges}
                describedBy={unsavedHintId}
                requestConfirmation={requestConfirmation}
                onForgotten={onStudentForgotten}
                onError={onForgetStudentError}
              />
            ) : null}
          </div>
          {hasUnsavedChanges ? (
            <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
              {unsavedHint ? (
                <Form.Text id={UNSAVED_CHANGES_HINT_ID} className="mt-0" data-testid="unsaved-changes-hint">
                  {unsavedHint}
                </Form.Text>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline-secondary"
                data-testid="discard-changes-button"
                onClick={onDiscardChanges}
              >
                {t('pages.userShow.actions.discardChanges')}
              </Button>
            </div>
          ) : null}
        </Form>

        {isAnonymizedAccount ? <ErasureStatusPanel userId={id} /> : null}
      </Card.Body>

      <SensitiveActionConfirmModal {...modalProps} />
    </Card>
  );
}

export default UserShowPage;
