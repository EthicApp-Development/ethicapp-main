import PropTypes from 'prop-types';
import { Button } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { forgetStudent } from '../../api/userForgettingApi.js';
import { forgetErrorKey } from './erasureStatus.js';

// "Forget this student" (#876): asks for the step-up confirmation in a
// danger dialog that lists what will happen, then forgets the student.
// `accountName` and `email` come from the account as last loaded, never from
// unsaved form edits; the backend forgets the account only while it still
// has `email`. Reports the outcome through onForgotten(result) or
// onError(message, { changed }), where `changed` says the account changed
// meanwhile and should be reloaded.
function ForgetStudentButton({
  userId,
  accountName,
  email,
  disabled = false,
  describedBy = undefined,
  requestConfirmation,
  onForgotten,
  onError
}) {
  const { t } = useI18n();

  async function onClick() {
    if (disabled) {
      return;
    }

    try {
      const outcome = await requestConfirmation({
        title: t('pages.userForget.confirm.title'),
        description: t('pages.userForget.confirm.body', { name: accountName, email }),
        details: [
          t('pages.userForget.confirm.detailAccount'),
          t('pages.userForget.confirm.detailIdentity'),
          t('pages.userForget.confirm.detailResponses'),
          t('pages.userForget.confirm.detailAiServices')
        ],
        confirmLabel: t('pages.userForget.confirm.confirm'),
        confirmVariant: 'danger',
        action: (stepUp) => forgetStudent(userId, { ...stepUp, expected_email: email })
      });

      if (outcome.confirmed) {
        await onForgotten(outcome.result);
      }
    } catch (requestError) {
      const errorKey = forgetErrorKey(requestError);
      await onError(t(errorKey || 'pages.userForget.error'), { changed: Boolean(errorKey) });
    }
  }

  return (
    <Button
      type="button"
      variant="outline-danger"
      data-testid="forget-student-button"
      disabled={disabled}
      aria-describedby={describedBy}
      onClick={onClick}
    >
      <i className="fa-solid fa-user-slash me-2" aria-hidden="true" />
      {t('pages.userForget.action')}
    </Button>
  );
}

ForgetStudentButton.propTypes = {
  userId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  accountName: PropTypes.string.isRequired,
  email: PropTypes.string.isRequired,
  disabled: PropTypes.bool,
  describedBy: PropTypes.string,
  requestConfirmation: PropTypes.func.isRequired,
  onForgotten: PropTypes.func.isRequired,
  onError: PropTypes.func.isRequired
};

export default ForgetStudentButton;
