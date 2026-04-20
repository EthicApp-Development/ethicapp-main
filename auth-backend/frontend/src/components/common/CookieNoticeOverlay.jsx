import React from 'react';
import PropTypes from 'prop-types';

function CookieNoticeOverlay({
  open,
  title = 'Información sobre cookies y sesión',
  onAccept,
  acceptLabel = 'Entendido',
  privacyUrl = null,
  termsUrl = null,
  showCloseButton = false,
  onClose = null
}) {
  if (!open) {
    return null;
  }

  function handleBackdropClick(event) {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (showCloseButton && onClose) {
      onClose();
    }
  }

  return (
    <div
      className="cookie-notice-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-notice-title"
      onClick={handleBackdropClick}
    >
      <div className="cookie-notice-overlay__backdrop" />

      <div className="cookie-notice-overlay__dialog card shadow-lg">
        <div className="card-body p-4 p-md-5">
          <div className="d-flex justify-content-between align-items-start mb-3">
            <h2 id="cookie-notice-title" className="h5 mb-0">
              {title}
            </h2>

            {showCloseButton && onClose ? (
              <button
                type="button"
                className="btn-close"
                aria-label="Cerrar aviso"
                onClick={onClose}
              />
            ) : null}
          </div>

          <p className="text-muted mb-3">
            Utilizamos cookies y tecnologías de almacenamiento estrictamente
            necesarias para mantener tu sesión de trabajo y permitir el
            funcionamiento seguro de la aplicación.
          </p>

          <p className="text-muted mb-4">
            No usamos estas tecnologías para publicidad ni seguimiento no
            esencial del usuario.
          </p>

          {(privacyUrl || termsUrl) && (
            <p className="small text-muted mb-4">
              Puedes consultar{' '}
              {privacyUrl ? (
                <a href={privacyUrl} target="_blank" rel="noreferrer">
                  la política de privacidad
                </a>
              ) : null}
              {privacyUrl && termsUrl ? ' y ' : null}
              {termsUrl ? (
                <a href={termsUrl} target="_blank" rel="noreferrer">
                  los términos del servicio
                </a>
              ) : null}
              .
            </p>
          )}

          <div className="d-grid d-sm-flex justify-content-sm-end">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onAccept}
            >
              {acceptLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

CookieNoticeOverlay.propTypes = {
  open: PropTypes.bool.isRequired,
  title: PropTypes.string,
  onAccept: PropTypes.func.isRequired,
  acceptLabel: PropTypes.string,
  privacyUrl: PropTypes.string,
  termsUrl: PropTypes.string,
  showCloseButton: PropTypes.bool,
  onClose: PropTypes.func
};

export default CookieNoticeOverlay;