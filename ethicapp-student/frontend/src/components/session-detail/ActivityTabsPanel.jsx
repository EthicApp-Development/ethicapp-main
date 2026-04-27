export default function ActivityTabsPanel({ tabEntries, activeTab, setActiveTab, hasCaseTab, caseDocumentUrl, t }) {
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
            >
              {tabEntry.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="border border-top-0 rounded-bottom p-3">
        {activeTab === 'case' && hasCaseTab ? (
          <iframe
            title={t('sessionDetail.caseTab')}
            src={caseDocumentUrl}
            width="100%"
            height="640"
            className="border rounded"
          />
        ) : null}

        {activeTab !== 'case' ? <p className="mb-0 text-secondary">{t('sessionDetail.phaseTabPlaceholder')}</p> : null}
      </div>
    </section>
  );
}
