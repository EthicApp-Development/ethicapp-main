import { useState } from 'react';
import { Button, Card } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';

import { useI18n } from '../app/providers.jsx';
import { createUserAccount } from '../api/userAccountApi.js';
import SensitiveActionConfirmModal from '../components/common/SensitiveActionConfirmModal.jsx';
import { usePasswordPolicy } from '../components/common/usePasswordPolicy.js';
import { useSensitiveActionConfirmation } from '../components/common/useSensitiveActionConfirmation.js';
import CreateAccountForm from '../components/users/CreateAccountForm.jsx';
import { describeCreateAccountError } from '../components/users/createAccountErrors.js';
import { generatePassword } from '../components/users/generatePassword.js';
import { canSubmitNewAccount, emptyNewAccount } from '../components/users/newAccountForm.js';

function clipboardOf() {
  return typeof navigator !== 'undefined' && navigator.clipboard?.writeText ? navigator.clipboard : null;
}

// "Create account" (#1170): the administrator creates a student or teacher
// account, active and with its email confirmed, confirms with the step-up
// dialog and hands the password to the person through a secure channel. On
// success the new account's page opens, saying whether the welcome email
// was sent.
function UserCreatePage() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const policy = usePasswordPolicy();
  const { requestConfirmation, modalProps } = useSensitiveActionConfirmation();

  const [values, setValues] = useState(() => emptyNewAccount(locale));
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordGenerated, setPasswordGenerated] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const clipboard = clipboardOf();
  const canSubmit = !busy && canSubmitNewAccount(values, policy);

  function onFieldChange(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
    if (name === 'password' || name === 'password_confirmation') {
      setPasswordCopied(false);
    }
  }

  // Fills both fields and shows them, so the administrator can read or copy
  // the password; they can still edit it or type their own.
  function onGeneratePassword() {
    const password = generatePassword(policy);
    setValues((current) => ({ ...current, password, password_confirmation: password }));
    setPasswordVisible(true);
    setPasswordGenerated(true);
    setPasswordCopied(false);
  }

  async function onCopyPassword() {
    try {
      await clipboard?.writeText(values.password);
      setPasswordCopied(true);
    } catch {
      // The password stays visible to copy by hand.
      setPasswordCopied(false);
    }
  }

  async function onSubmit() {
    if (!canSubmit) {
      return;
    }

    setError('');
    setBusy(true);
    const name = `${values.firstname.trim()} ${values.lastname.trim()}`.trim();

    try {
      const outcome = await requestConfirmation({
        title: t('pages.userCreate.confirm.title'),
        description: t('pages.userCreate.confirm.body', {
          name,
          email: values.email.trim(),
          role: t(`roles.${values.role}`)
        }),
        details: [
          t('pages.userCreate.confirm.detailConfirmed'),
          t('pages.userCreate.confirm.detailWelcomeEmail'),
          t('pages.userCreate.confirm.detailHandOver')
        ],
        confirmLabel: t('pages.userCreate.confirm.confirm'),
        confirmVariant: 'primary',
        action: (stepUp) => createUserAccount({ ...stepUp, ...values })
      });

      if (outcome.confirmed) {
        navigate(`/users/${outcome.result.id}`, {
          state: { accountCreated: { welcomeEmailSent: outcome.result.welcome_email_sent === true } }
        });
      }
    } catch (requestError) {
      setError(describeCreateAccountError(requestError, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <Card.Title className="d-flex align-items-center gap-2 mb-0">
            <i className="fa-solid fa-user-plus text-primary" aria-hidden="true" />
            <span>{t('pages.userCreate.heading')}</span>
          </Card.Title>
          <Button variant="outline-secondary" as={Link} to="/users">
            <i className="fa-solid fa-arrow-left me-2" aria-hidden="true" />
            {t('pages.userCreate.back')}
          </Button>
        </div>
        <Card.Text>{t('pages.userCreate.description')}</Card.Text>

        <CreateAccountForm
          values={values}
          policy={policy}
          passwordVisible={passwordVisible}
          passwordGenerated={passwordGenerated}
          passwordCopied={passwordCopied}
          canCopy={Boolean(clipboard)}
          error={error}
          busy={busy}
          canSubmit={canSubmit}
          onFieldChange={onFieldChange}
          onToggleVisible={() => setPasswordVisible((current) => !current)}
          onGeneratePassword={onGeneratePassword}
          onCopyPassword={onCopyPassword}
          onSubmit={onSubmit}
        />
      </Card.Body>
      <SensitiveActionConfirmModal {...modalProps} />
    </Card>
  );
}

export default UserCreatePage;
