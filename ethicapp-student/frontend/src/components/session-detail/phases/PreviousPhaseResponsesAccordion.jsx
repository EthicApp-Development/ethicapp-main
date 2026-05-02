import { useMemo, useState } from 'react';

function resolveAuthorLabel(response, useAnonymousLabels, t) {
  if (response?.isSelf === true) {
    return t('sessionDetail.previousResponsesOwnLabel');
  }

  if (useAnonymousLabels) {
    const anonMask = typeof response?.anonMask === 'string' ? response.anonMask.trim() : '';
    return anonMask.length > 0 ? anonMask : t('sessionDetail.chatAnonymousAuthor');
  }

  const authorName = typeof response?.authorName === 'string' ? response.authorName.trim() : '';
  return authorName.length > 0 ? authorName : t('sessionDetail.chatPeerAuthor');
}

export default function PreviousPhaseResponsesAccordion({
  previousResponses,
  task,
  useAnonymousLabels,
  loading,
  errorMessage,
  t
}) {
  const [openPhaseNumbers, setOpenPhaseNumbers] = useState(new Set());
  const taskOrder = Number(task?.order ?? task?.taskOrder ?? 0);

  const phasesForTask = useMemo(() => {
    const phases = Array.isArray(previousResponses?.phases) ? previousResponses.phases : [];

    return phases
      .map((phase) => {
        const tasks = Array.isArray(phase?.tasks) ? phase.tasks : [];
        const matchingTask = tasks.find((phaseTask) => Number(phaseTask?.order) === taskOrder);
        return matchingTask ? { ...phase, task: matchingTask } : null;
      })
      .filter(Boolean);
  }, [previousResponses, taskOrder]);

  if (loading) {
    return (
      <div className="text-muted small mb-3" role="status">
        {t('sessionDetail.previousResponsesLoading')}
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="alert alert-warning py-2 mb-3" role="status">
        {errorMessage}
      </div>
    );
  }

  if (phasesForTask.length === 0) {
    return null;
  }

  const togglePhase = (phaseNumber) => {
    setOpenPhaseNumbers((current) => {
      const next = new Set(current);
      if (next.has(phaseNumber)) {
        next.delete(phaseNumber);
      } else {
        next.add(phaseNumber);
      }
      return next;
    });
  };

  return (
    <section className="border rounded p-2 mb-3 bg-light-subtle">
      <h3 className="h6 mb-1">{t('sessionDetail.previousResponsesTitle')}</h3>
      <p className="small text-muted mb-2">{t('sessionDetail.previousResponsesDescription')}</p>

      <div className="accordion">
        {phasesForTask.map((phase) => {
          const phaseNumber = Number(phase.phaseNumber);
          const isOpen = openPhaseNumbers.has(phaseNumber);
          const responses = Array.isArray(phase.task?.responses) ? phase.task.responses : [];

          return (
            <div key={`${phaseNumber}-${phase.task.taskId}`} className="accordion-item">
              <h4 className="accordion-header">
                <button
                  type="button"
                  className={`accordion-button py-2 ${isOpen ? '' : 'collapsed'}`}
                  onClick={() => togglePhase(phaseNumber)}
                  aria-expanded={isOpen}
                >
                  {t('sessionDetail.phaseN')} {phaseNumber}
                </button>
              </h4>
              <div className={`accordion-collapse collapse ${isOpen ? 'show' : ''}`}>
                <div className="accordion-body py-2">
                  {responses.length === 0 ? (
                    <p className="text-muted small mb-0">{t('sessionDetail.previousResponsesEmpty')}</p>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {responses.map((response) => (
                        <div key={`${phaseNumber}-${phase.task.taskId}-${response.userId}`} className="border rounded bg-white p-2">
                          <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                            <strong className="small">{resolveAuthorLabel(response, useAnonymousLabels, t)}</strong>
                            <small className="text-muted">
                              {t('sessionDetail.previousResponsesSelectionLabel')}: {response.selection ?? '-'}
                            </small>
                          </div>
                          {typeof response.justification === 'string' && response.justification.trim().length > 0 ? (
                            <p className="mb-0 mt-1 small">{response.justification}</p>
                          ) : (
                            <p className="mb-0 mt-1 small text-muted">{t('sessionDetail.previousResponsesNoJustification')}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
