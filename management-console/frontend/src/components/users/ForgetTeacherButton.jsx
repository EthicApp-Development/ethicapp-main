import PropTypes from 'prop-types';
import { useRef, useState } from 'react';
import { Button } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { fetchForgetPreview, forgetTeacher } from '../../api/userForgettingApi.js';
import { forgetTeacherError } from './erasureStatus.js';
import ForgetTeacherPlanModal from './ForgetTeacherPlanModal.jsx';
import { teacherForgetConfirmDetails } from './teacherForgetting.js';

const EMPTY_PREVIEW = Object.freeze({ data: null, loading: false, error: false });

// "Forget this teacher" (#877): shows what will happen (the open activities
// finished first, the materials deleted, transferred or kept) and lets the
// administrator choose a recipient; then asks for the step-up confirmation
// in a danger dialog and forgets the teacher. `accountName` and `email` come
// from the account as last loaded, never from unsaved form edits; the
// backend forgets the account only while it still has `email`, and gives
// the materials to the recipient only while it still has the email shown.
// Reports the outcome through onForgotten(result) or onError(message,
// { changed }), where `changed` says the account changed meanwhile and
// should be reloaded.
function ForgetTeacherButton({
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
  const [showPlan, setShowPlan] = useState(false);
  const [preview, setPreview] = useState(EMPTY_PREVIEW);
  const [recipient, setRecipient] = useState(null);
  // Ignores a preview that arrives after the dialog was closed or reopened.
  const requestRef = useRef(0);

  async function reportError(requestError) {
    const refusal = forgetTeacherError(requestError);
    await onError(t(refusal?.key || 'pages.userForgetTeacher.error'), { changed: Boolean(refusal?.changed) });
  }

  async function onClick() {
    if (disabled) {
      return;
    }

    const request = requestRef.current + 1;
    requestRef.current = request;
    setRecipient(null);
    setPreview({ data: null, loading: true, error: false });
    setShowPlan(true);

    try {
      const data = await fetchForgetPreview(userId);
      if (requestRef.current === request) {
        setPreview({ data, loading: false, error: false });
      }
    } catch (requestError) {
      if (requestRef.current !== request) {
        return;
      }
      const refusal = forgetTeacherError(requestError);
      if (refusal?.changed) {
        // The account is not a teacher that can be forgotten any more.
        setShowPlan(false);
        setPreview(EMPTY_PREVIEW);
        await reportError(requestError);
        return;
      }
      setPreview({ data: null, loading: false, error: true });
    }
  }

  function onCancel() {
    requestRef.current += 1;
    setShowPlan(false);
  }

  async function onContinue() {
    const plan = preview.data;
    const chosen = recipient;
    if (!plan) {
      return;
    }

    requestRef.current += 1;
    setShowPlan(false);

    try {
      const outcome = await requestConfirmation({
        title: t('pages.userForgetTeacher.confirm.title'),
        description: t('pages.userForgetTeacher.confirm.body', { name: accountName, email }),
        details: teacherForgetConfirmDetails(plan, chosen, t),
        confirmLabel: t('pages.userForgetTeacher.confirm.confirm'),
        confirmVariant: 'danger',
        action: (stepUp) => forgetTeacher(userId, {
          ...stepUp,
          expected_email: email,
          recipient_id: chosen ? chosen.id : null,
          expected_recipient_email: chosen ? chosen.email : null
        })
      });

      if (outcome.confirmed) {
        await onForgotten(outcome.result);
      }
    } catch (requestError) {
      await reportError(requestError);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline-danger"
        data-testid="forget-teacher-button"
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={onClick}
      >
        <i className="fa-solid fa-user-slash me-2" aria-hidden="true" />
        {t('pages.userForgetTeacher.action')}
      </Button>
      <ForgetTeacherPlanModal
        show={showPlan}
        userId={userId}
        accountName={accountName}
        email={email}
        preview={preview.data}
        loading={preview.loading}
        loadError={preview.error}
        recipient={recipient}
        onRecipientChange={setRecipient}
        onCancel={onCancel}
        onContinue={onContinue}
      />
    </>
  );
}

ForgetTeacherButton.propTypes = {
  userId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  accountName: PropTypes.string.isRequired,
  email: PropTypes.string.isRequired,
  disabled: PropTypes.bool,
  describedBy: PropTypes.string,
  requestConfirmation: PropTypes.func.isRequired,
  onForgotten: PropTypes.func.isRequired,
  onError: PropTypes.func.isRequired
};

export default ForgetTeacherButton;
