import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useI18n } from '../../app/i18n-context';
import { DEFAULT_LOCALE } from '../../i18n/languages';
import MarkdownArticle from './MarkdownArticle';

const cookieNoticeLoaders = import.meta.glob('../../content/notices/cookie/*.md', {
  query: '?raw',
  import: 'default'
});

function CookieNoticeOverlay({
  open,
  onAccept,
  privacyUrl = null,
  termsUrl = null,
  showCloseButton = false,
  onClose = null
}) {
  const { locale, t } = useI18n();
  const [markdownContent, setMarkdownContent] = useState('');

  useEffect(() => {
    let ignore = false;

    async function loadContent() {
      const localizedPath = `../../content/notices/cookie/${locale}.md`;
      const fallbackPath = `../../content/notices/cookie/${DEFAULT_LOCALE}.md`;
      const loader = cookieNoticeLoaders[localizedPath] || cookieNoticeLoaders[fallbackPath];

      if (!loader) {
        if (!ignore) {
          setMarkdownContent('');
        }
        return;
      }

      const content = await loader();
      if (!ignore) {
        setMarkdownContent(content);
      }
    }

    loadContent();

    return () => {
      ignore = true;
    };
  }, [locale]);

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
              {t('cookieNotice.title')}
            </h2>

            {showCloseButton && onClose ? (
              <button
                type="button"
                className="btn-close"
                aria-label={t('cookieNotice.closeLabel')}
                onClick={onClose}
              />
            ) : null}
          </div>

          <div className="text-muted mb-4">
            <MarkdownArticle markdown={markdownContent} />
          </div>

          {(privacyUrl || termsUrl) && (
            <p className="small text-muted mb-4">
              {t('cookieNotice.linksPrefix')}{' '}
              {privacyUrl ? (
                <a href={privacyUrl} target="_blank" rel="noreferrer">
                  {t('cookieNotice.privacyPolicy')}
                </a>
              ) : null}
              {privacyUrl && termsUrl ? ` ${t('cookieNotice.linksConnector')} ` : null}
              {termsUrl ? (
                <a href={termsUrl} target="_blank" rel="noreferrer">
                  {t('cookieNotice.termsOfService')}
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
              {t('cookieNotice.acceptLabel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

CookieNoticeOverlay.propTypes = {
  open: PropTypes.bool.isRequired,
  onAccept: PropTypes.func.isRequired,
  privacyUrl: PropTypes.string,
  termsUrl: PropTypes.string,
  showCloseButton: PropTypes.bool,
  onClose: PropTypes.func
};

export default CookieNoticeOverlay;
