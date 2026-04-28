function buildCaseViewerUrl(caseDocumentUrl) {
  if (typeof caseDocumentUrl !== 'string' || caseDocumentUrl.trim().length === 0) {
    return '';
  }

  const normalizedCaseDocumentUrl = caseDocumentUrl.trim();

  try {
    const parsedUrl = new URL(normalizedCaseDocumentUrl, window.location.origin);
    const isHttpUrl = parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname);

    if (isHttpUrl && !isLocalHost) {
      return `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(parsedUrl.toString())}`;
    }
  } catch {
    // Keep fallback behavior when the URL cannot be parsed.
  }

  const hash = '#toolbar=0&navpanes=0&scrollbar=1';
  return normalizedCaseDocumentUrl.includes('#') ? normalizedCaseDocumentUrl : `${normalizedCaseDocumentUrl}${hash}`;
}

export default function ActivityTabsPanel({ tabEntries, activeTab, setActiveTab, hasCaseTab, caseDocumentUrl, readOnly = false, t }) {
  const caseViewerUrl = buildCaseViewerUrl(caseDocumentUrl);

  return (
    <section className="mt-4" aria-label={t('sessionDetail.activityPhasesLabel')}>
      <ul className="nav nav-tabs" role="tablist">
        {tabEntries.map((tabEntry) => (
          <li key={tabEntry.id} className="nav-item" role="presentation">
            <button
              type="button"
              className={`nav-link ${activeTab === tabEntry.id ? 'active' : ''}`}
              role="tab"
              aria-selected={activeTab === tabEntry.id}
              onClick={() => setActiveTab(tabEntry.id)}
              disabled={readOnly}
            >
              {tabEntry.label}
            </button>
          </li>
        ))}
      </ul>

      <div
        className={`border border-top-0 rounded-bottom p-3 ${readOnly ? 'opacity-75' : ''}`}
        style={readOnly ? { pointerEvents: 'none' } : undefined}
        aria-disabled={readOnly}
      >
        {activeTab === 'case' && hasCaseTab ? (
          <div className="d-flex flex-column gap-2">
            <iframe
              title={t('sessionDetail.caseTab')}
              src={caseViewerUrl}
              width="100%"
              height="640"
              className="border rounded"
            />
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <small className="text-muted">{t('sessionDetail.caseViewerHint')}</small>
              <a
                href={caseDocumentUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline-secondary btn-sm"
              >
                {t('sessionDetail.openCaseInNewTab')}
              </a>
            </div>
          </div>
        ) : null}

        {activeTab !== 'case' ? <p className="mb-0 text-secondary">{t('sessionDetail.phaseTabPlaceholder')}</p> : null}
      </div>
    </section>
  );
}
