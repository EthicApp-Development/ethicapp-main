import PropTypes from 'prop-types';
import { Button, Modal, Spinner } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';

function RemoveConnectionModal({ show, busy, onCancel, onConfirm }) {
  const { t } = useI18n();

  return (
    <Modal show={show} onHide={busy ? undefined : onCancel} centered>
      <Modal.Header closeButton={!busy}>
        <Modal.Title>{t('pages.aiServices.connection.remove.title')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>{t('pages.aiServices.connection.remove.body')}</p>
        <p className="mb-0 text-body-secondary small">{t('pages.aiServices.connection.remove.policyKept')}</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel} disabled={busy}>
          {t('pages.aiServices.connection.remove.cancel')}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy}>
          {busy ? <Spinner size="sm" className="me-2" /> : null}
          {t('pages.aiServices.connection.remove.confirm')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

RemoveConnectionModal.propTypes = {
  show: PropTypes.bool.isRequired,
  busy: PropTypes.bool.isRequired,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired
};

export default RemoveConnectionModal;
