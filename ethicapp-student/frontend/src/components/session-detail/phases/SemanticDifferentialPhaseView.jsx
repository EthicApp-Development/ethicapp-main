import { useMemo, useState } from 'react';

function mapResponsesByTaskId(phase) {
  const responseList = Array.isArray(phase?.responses) ? phase.responses : [];

  return responseList.reduce((acc, response) => {
    const taskId = Number(response?.taskId);

    if (!Number.isInteger(taskId) || taskId <= 0) {
      return acc;
    }

    acc[taskId] = response;
    return acc;
  }, {});
}

export default function SemanticDifferentialPhaseView({
  phase,
  isReadOnly,
  isActivePhase,
  onSubmitPhaseResponse,
  t
}) {
  const responsesByTask = useMemo(() => mapResponsesByTaskId(phase), [phase]);
  const [draftByTaskId, setDraftByTaskId] = useState({});
  const [submittingTaskId, setSubmittingTaskId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const tasks = useMemo(() => {
    const phaseTasks = Array.isArray(phase?.tasks) ? phase.tasks : [];
    return [...phaseTasks].sort((leftTask, rightTask) => Number(leftTask?.order ?? 0) - Number(rightTask?.order ?? 0));
  }, [phase]);

  const setTaskDraft = (taskId, partialUpdate) => {
    setDraftByTaskId((prev) => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] ?? {}),
        ...partialUpdate
      }
    }));
  };

  const getTaskValue = (taskId) => {
    const draftValue = draftByTaskId[taskId]?.value;
    if (Number.isInteger(draftValue)) {
      return draftValue;
    }

    const persistedValue = Number(responsesByTask[taskId]?.selection);
    return Number.isInteger(persistedValue) ? persistedValue : null;
  };

  const getTaskJustification = (taskId) => {
    if (typeof draftByTaskId[taskId]?.justification === 'string') {
      return draftByTaskId[taskId].justification;
    }

    const persistedJustification = responsesByTask[taskId]?.justification;
    return typeof persistedJustification === 'string' ? persistedJustification : '';
  };

  const submitTask = async (task) => {
    const taskId = Number(task?.id);
    const value = getTaskValue(taskId);
    const justification = getTaskJustification(taskId).trim();

    if (!Number.isInteger(value)) {
      setFeedback({
        type: 'danger',
        message: t('sessionDetail.responseSelectScaleFirst')
      });
      return;
    }

    setSubmittingTaskId(taskId);

    const result = await onSubmitPhaseResponse({
      responseKey: taskId,
      responsePayload: {
        questionId: taskId,
        value,
        justification
      }
    });

    setSubmittingTaskId(null);

    setFeedback({
      type: result.ok ? 'success' : 'danger',
      message: result.message
    });

    window.setTimeout(() => {
      setFeedback(null);
    }, 2600);
  };

  return (
    <div className="d-flex flex-column gap-3">
      {feedback ? (
        <div
          className={`position-fixed top-0 end-0 mt-3 me-3 alert alert-${feedback.type} py-2 px-3 shadow-sm`}
          role="status"
          aria-live="polite"
          style={{ zIndex: 1050 }}
        >
          {feedback.message}
        </div>
      ) : null}

      {!isActivePhase && !isReadOnly ? (
        <div className="alert alert-info py-2 mb-0" role="status">
          {t('sessionDetail.phaseReadOnlyWhileInactive')}
        </div>
      ) : null}

      {typeof phase?.instructions === 'string' && phase.instructions.trim().length > 0 ? (
        <div className="alert alert-secondary mb-0" role="note">
          <strong>{t('sessionDetail.instructionsLabel')}:</strong> {phase.instructions}
        </div>
      ) : null}

      {tasks.map((task) => {
        const taskId = Number(task?.id);
        const numValues = Number(task?.numValues);
        const disabled = isReadOnly || !isActivePhase;
        const selectedValue = getTaskValue(taskId);
        const justification = getTaskJustification(taskId);

        return (
          <article key={taskId}>
            <p className="fw-semibold mb-2">{task.title}</p>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <small className="text-muted">{task.leftPole}</small>
              <small className="text-muted">{task.rightPole}</small>
            </div>
            <div className="d-flex flex-wrap gap-2 mb-3">
              {Array.from({ length: numValues }, (_, idx) => idx + 1).map((scaleValue) => {
                const radioId = `task-${taskId}-value-${scaleValue}`;

                return (
                  <div key={radioId} className="form-check form-check-inline m-0">
                    <input
                      id={radioId}
                      type="radio"
                      name={`task-${taskId}-scale`}
                      className="form-check-input"
                      checked={selectedValue === scaleValue}
                      disabled={disabled}
                      onChange={() => setTaskDraft(taskId, { value: scaleValue })}
                    />
                    <label htmlFor={radioId} className="form-check-label">
                      {scaleValue}
                    </label>
                  </div>
                );
              })}
            </div>

            {task.requiresJustification ? (
              <div className="mb-3">
                <label htmlFor={`task-${taskId}-justification`} className="form-label small text-muted mb-1">
                  {t('sessionDetail.justificationLabel')}
                </label>
                <textarea
                  id={`task-${taskId}-justification`}
                  className="form-control"
                  rows={3}
                  value={justification}
                  readOnly={disabled}
                  onChange={(event) => setTaskDraft(taskId, { justification: event.target.value })}
                  placeholder={t('sessionDetail.justificationPlaceholder')}
                />
              </div>
            ) : null}

            <div className="d-flex justify-content-end">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={disabled || submittingTaskId === taskId}
                onClick={() => submitTask(task)}
              >
                {submittingTaskId === taskId ? t('sessionDetail.submittingResponse') : t('sessionDetail.submitResponse')}
              </button>
            </div>

            <hr className="my-3" />
          </article>
        );
      })}
    </div>
  );
}
