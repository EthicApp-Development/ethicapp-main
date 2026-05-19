import { useMemo, useState } from 'react';
import CaseDocumentViewer from './CaseDocumentViewer.jsx';
import RankingPhaseView from './phases/RankingPhaseView.jsx';
import SemanticDifferentialPhaseView from './phases/SemanticDifferentialPhaseView.jsx';

export default function ActivityTabsPanel({
  tabEntries,
  activeTab,
  setActiveTab,
  hasCaseTab,
  caseDocument,
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

  const panelPaddingClass = activeTab === 'case' ? 'p-1 p-sm-3' : 'p-3';

  return (
    <section className="activity-tabs-panel mt-4" aria-label={t('sessionDetail.activityPhasesLabel')}>
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

      <div className={`activity-tabs-panel-content border border-top-0 rounded-bottom ${panelPaddingClass}`}>
        {activeTab === 'case' && hasCaseTab ? (
          <CaseDocumentViewer caseDocument={caseDocument} caseDocumentUrl={caseDocumentUrl} t={t} />
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
