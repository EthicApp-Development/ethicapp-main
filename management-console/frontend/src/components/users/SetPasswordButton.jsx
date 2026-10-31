import PropTypes from 'prop-types';
import { useState } from 'react';
import { Button } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { setUserPassword } from '../../api/userPasswordApi.js';
import { checkPassword } from '../common/passwordPolicy.js';
import { usePasswordPolicy } from '../common/usePasswordPolicy.js';
import SetPasswordDialog from './SetPasswordDialog.jsx';
import { describeSetPasswordError } from './setPasswordErrors.js';

const EMPTY_FIELDS = Object.freeze({ password: '', confirmation: '' });

// "Set password" (#889): the administrator types a temporary password for a
// student or teacher, confirms with the step-up dialog, and hands the
// password over in person. `accountName` and `email` come from the account
// as last loaded, never from unsaved form edits; the backend sets the
// password only while the account still has `email`.
//
// Reports the outcome through onPasswordSet(result) or
// onError(message, { changed }), where `changed` says the account changed
// meanwhile and should be reloaded. A refusal of the password itself (too
// weak, not matching) reopens the dialog with auth-backend's message.
function SetPasswordButton({
  userId,
  accountName,
  email,
  disabled = false,
  describedBy = undefined,
  requestConfirmation,
  onPasswordSet,
  onError
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const [opened, setOpened] = useState(false);
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  // Loaded the first time the dialog opens.
  const policy = usePasswordPolicy({ enabled: opened });

  const checks = checkPassword(fields.password, policy);
  const canContinue = fields.password !== '' &&
    fields.password === fields.confirmation &&
    (checks === null || checks.satisfied);

  function open() {
    if (disabled) {
      return;
    }
    setFields(EMPTY_FIELDS);
    setVisible(false);
    setError('');
    setOpened(true);
    setShow(true);
  }

  function cancel() {
    setShow(false);
    setFields(EMPTY_FIELDS);
  }

  async function onContinue() {
    if (!canContinue) {
      return;
    }

    const { password, confirmation } = fields;
    setError('');
    setShow(false);

    try {
      const outcome = await requestConfirmation({
        title: t('pages.userSetPassword.confirm.title'),
        description: t('pages.userSetPassword.confirm.body', { name: accountName, email }),
        details: [
          t('pages.userSetPassword.confirm.detailSessions'),
          t('pages.userSetPassword.confirm.detailHandOver')
        ],
        confirmLabel: t('pages.userSetPassword.confirm.confirm'),
        confirmVariant: 'warning',
        action: (stepUp) => setUserPassword(userId, {
          ...stepUp,
          new_password: password,
          password_confirmation: confirmation,
          expected_email: email
        })
      });

      if (outcome.confirmed) {
        setFields(EMPTY_FIELDS);
        await onPasswordSet(outcome.result);
        return;
      }

      // The step-up was cancelled: back to the password, as typed.
      setShow(true);
    } catch (requestError) {
      const failure = describeSetPasswordError(requestError, t);

      if (failure.retry) {
        setError(failure.message);
        setShow(true);
        return;
      }

      setFields(EMPTY_FIELDS);
      await onError(failure.message, { changed: failure.changed });
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline-warning"
        data-testid="set-password-button"
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={open}
      >
        <i className="fa-solid fa-unlock-keyhole me-2" aria-hidden="true" />
        {t('pages.userSetPassword.action')}
      </Button>
      <SetPasswordDialog
        show={show}
        accountName={accountName}
        email={email}
        policy={policy}
        password={fields.password}
        confirmation={fields.confirmation}
        visible={visible}
        error={error}
        canContinue={canContinue}
        onPasswordChange={(password) => setFields((current) => ({ ...current, password }))}
        onConfirmationChange={(confirmation) => setFields((current) => ({ ...current, confirmation }))}
        onToggleVisible={() => setVisible((current) => !current)}
        onCancel={cancel}
        onContinue={onContinue}
      />
    </>
  );
}

SetPasswordButton.propTypes = {
  userId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  accountName: PropTypes.string.isRequired,
  email: PropTypes.string.isRequired,
  disabled: PropTypes.bool,
  describedBy: PropTypes.string,
  requestConfirmation: PropTypes.func.isRequired,
  onPasswordSet: PropTypes.func.isRequired,
  onError: PropTypes.func.isRequired
};

export default SetPasswordButton;
