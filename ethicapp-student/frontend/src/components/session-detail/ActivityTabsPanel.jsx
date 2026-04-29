import { useMemo, useState } from 'react';
import RankingPhaseView from './phases/RankingPhaseView.jsx';
import SemanticDifferentialPhaseView from './phases/SemanticDifferentialPhaseView.jsx';

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

export default function ActivityTabsPanel({
  tabEntries,
  activeTab,
  setActiveTab,
  hasCaseTab,
  caseDocumentUrl,
  phases,
  currentPhaseId,
  designType,
  isSessionFinished,
  onSubmitPhaseResponse,
  chatRefreshTokenByPhaseId,
  userId,
  t
}) {
  const [semanticDraftByPhaseId, setSemanticDraftByPhaseId] = useState({});
  const caseViewerUrl = buildCaseViewerUrl(caseDocumentUrl);

  const activePhase = useMemo(() => {
    if (typeof activeTab !== 'string' || !activeTab.startsWith('phase-')) {
      return null;
    }

    const phaseId = Number(activeTab.replace('phase-', ''));
    if (!Number.isInteger(phaseId) || phaseId <= 0) {
      return null;
    }

    return Array.isArray(phases) ? phases.find((phase) => Number(phase?.id) === phaseId) ?? null : null;
  }, [activeTab, phases]);

  const isActivePhase = Number(activePhase?.id) === Number(currentPhaseId);
  const activePhaseId = Number(activePhase?.id);

  const setSemanticTaskDraft = (phaseId, taskId, partialUpdate) => {
    if (!Number.isInteger(phaseId) || phaseId <= 0) {
      return;
    }

    setSemanticDraftByPhaseId((prev) => ({
      ...prev,
      [phaseId]: {
        ...(prev[phaseId] ?? {}),
        [taskId]: {
          ...((prev[phaseId] ?? {})[taskId] ?? {}),
          ...partialUpdate
        }
      }
    }));
  };

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
              <span className="d-inline-flex align-items-center gap-2">
                {typeof tabEntry.iconClass === 'string' && tabEntry.iconClass.length > 0 ? (
                  <i className={`fa-${tabEntry.iconStyle ?? 'solid'} ${tabEntry.iconClass}`} aria-hidden="true" />
                ) : null}
                <span>{tabEntry.label}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="border border-top-0 rounded-bottom p-3">
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

        {activeTab !== 'case' && activePhase && designType === 'semantic_differential' ? (
          <SemanticDifferentialPhaseView
            phase={activePhase}
            draftByTaskId={semanticDraftByPhaseId[activePhaseId] ?? {}}
            onTaskDraftChange={(taskId, partialUpdate) => setSemanticTaskDraft(activePhaseId, taskId, partialUpdate)}
            isReadOnly={isSessionFinished}
            isActivePhase={isActivePhase}
            onSubmitPhaseResponse={onSubmitPhaseResponse}
            onRequestOpenChatRefreshToken={chatRefreshTokenByPhaseId[activePhaseId] ?? 0}
            userId={userId}
            t={t}
          />
        ) : null}

        {activeTab !== 'case' && activePhase && designType === 'ranking' ? (
          <RankingPhaseView
            phase={activePhase}
            isReadOnly={isSessionFinished}
            isActivePhase={isActivePhase}
            t={t}
          />
        ) : null}

        {activeTab !== 'case' && (!activePhase || !['semantic_differential', 'ranking'].includes(designType)) ? (
          <p className="mb-0 text-secondary">{t('sessionDetail.phaseTabPlaceholder')}</p>
        ) : null}
      </div>
    </section>
  );
}
