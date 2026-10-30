import PropTypes from 'prop-types';
import { Alert, Button, Modal, Spinner } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import RecipientPicker from './RecipientPicker.jsx';
import { teacherForgetPlan } from './teacherForgetting.js';

const TITLE_ID = 'forget-teacher-plan-title';

// The first dialog of forgetting a teacher (#877): what will happen, from
// the backend's preview, and the optional recipient of the materials that
// stay. "Continue" leads to the step-up confirmation.
function ForgetTeacherPlanModal({
  show,
  userId,
  accountName,
  email,
  preview,
  loading,
  loadError,
  recipient,
  onRecipientChange,
  onCancel,
  onContinue
}) {
  const { t } = useI18n();
  const prefix = 'pages.userForgetTeacher.plan';
  const plan = preview ? teacherForgetPlan(preview, recipient, userId, t) : [];

  return (
    <Modal
      show={show}
      onHide={onCancel}
      centered
      size="lg"
      aria-labelledby={TITLE_ID}
      data-testid="forget-teacher-plan"
    >
      <Modal.Header closeButton closeLabel={t('sensitiveAction.actions.close')}>
        <Modal.Title id={TITLE_ID} as="h2" className="h5">
          <i className="fa-solid fa-user-slash text-danger me-2" aria-hidden="true" />
          {t(`${prefix}.title`)}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>{t(`${prefix}.body`, { name: accountName, email })}</p>

        {loading ? (
          <div className="d-flex align-items-center gap-2" role="status">
            <Spinner size="sm" />
            <span>{t(`${prefix}.loading`)}</span>
          </div>
        ) : null}
        {loadError ? (
          <Alert variant="danger" data-testid="forget-teacher-plan-error">{t(`${prefix}.loadError`)}</Alert>
        ) : null}

        {preview ? (
          <>
            <ul className="small" data-testid="forget-teacher-plan-items">
              {plan.map((item) => (
                <li
                  key={item.id}
                  data-testid={`forget-teacher-plan-${item.id}`}
                  className={item.variant === 'warning' ? 'text-warning-emphasis fw-semibold' : undefined}
                >
                  {item.text}
                </li>
              ))}
            </ul>
            <RecipientPicker excludeUserId={userId} value={recipient} onChange={onRecipientChange} />
          </>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel} data-testid="forget-teacher-plan-cancel">
          {t(`${prefix}.cancel`)}
        </Button>
        <Button
          variant="danger"
          disabled={!preview}
          onClick={onContinue}
          data-testid="forget-teacher-plan-continue"
        >
          {t(`${prefix}.continue`)}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

ForgetTeacherPlanModal.propTypes = {
  show: PropTypes.bool.isRequired,
  userId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  accountName: PropTypes.string.isRequired,
  email: PropTypes.string.isRequired,
  preview: PropTypes.object,
  loading: PropTypes.bool.isRequired,
  loadError: PropTypes.bool.isRequired,
  recipient: PropTypes.shape({
    id: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
    email: PropTypes.string.isRequired
  }),
  onRecipientChange: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  onContinue: PropTypes.func.isRequired
};

export default ForgetTeacherPlanModal;
