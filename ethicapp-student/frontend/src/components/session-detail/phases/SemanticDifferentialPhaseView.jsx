import { useMemo, useState } from 'react';

function mapResponsesByTaskId(phase) {
  const responseList = Array.isArray(phase?.responses) ? phase.responses : [];

  return responseList.reduce((acc, response) => {
    const taskId = Number(response?.taskId);

    if (!Number.isInteger(taskId) || taskId <= 0) {
      return acc;
    }

    const normalizedValue = Number(
      response?.selection
      ?? response?.value
      ?? response?.responseValue
      ?? response?.response_value
    );

    acc[taskId] = {
      ...response,
      normalizedValue: Number.isInteger(normalizedValue) ? normalizedValue : null
    };
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
  const [feedbackByTaskId, setFeedbackByTaskId] = useState({});

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

    return Number.isInteger(responsesByTask[taskId]?.normalizedValue) ? responsesByTask[taskId].normalizedValue : null;
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
      setFeedbackByTaskId((prev) => ({
        ...prev,
        [taskId]: {
          type: 'danger',
          message: t('sessionDetail.responseSelectScaleFirst')
        }
      }));
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

    setFeedbackByTaskId((prev) => ({
      ...prev,
      [taskId]: {
        type: result.ok ? 'success' : 'danger',
        message: result.message
      }
    }));

    window.setTimeout(() => {
      setFeedbackByTaskId((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }, 2600);
  };

  return (
    <div className="d-flex flex-column gap-3">
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
        const taskFeedback = feedbackByTaskId[taskId] ?? null;

        return (
          <article key={taskId}>
            <p className="fw-semibold mb-2">{task.title}</p>
            <div className="row align-items-center g-2 mb-3">
              <div className="col-3 text-start">
                <small className="text-muted">{task.leftPole}</small>
              </div>
              <div className="col-6 d-flex justify-content-center flex-nowrap gap-2">
                {Array.from({ length: numValues }, (_, idx) => idx + 1).map((scaleValue) => {
                  const radioId = `task-${taskId}-value-${scaleValue}`;

                  return (
                    <div key={radioId} className="form-check form-check-inline m-0 d-inline-flex align-items-center">
                      <input
                        id={radioId}
                        type="radio"
                        name={`task-${taskId}-scale`}
                        className="form-check-input"
                        checked={selectedValue === scaleValue}
                        disabled={disabled}
                        onChange={() => setTaskDraft(taskId, { value: scaleValue })}
                      />
                      <label htmlFor={radioId} className="form-check-label ms-1">
                        {scaleValue}
                      </label>
                    </div>
                  );
                })}
              </div>
              <div className="col-3 text-end">
                <small className="text-muted">{task.rightPole}</small>
              </div>
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

            <div className="d-flex justify-content-end align-items-center gap-2">
              {taskFeedback ? (
                <div
                  className={`alert alert-${taskFeedback.type} py-1 px-2 mb-0`}
                  role="status"
                  aria-live="polite"
                >
                  {taskFeedback.message}
                </div>
              ) : null}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={disabled || submittingTaskId === taskId}
                onClick={() => submitTask(task)}
              >
                <span className="d-inline-flex align-items-center gap-2">
                  <i className="fa-solid fa-paper-plane" aria-hidden="true" />
                  <span>{submittingTaskId === taskId ? t('sessionDetail.submittingResponse') : t('sessionDetail.submitResponse')}</span>
                </span>
              </button>
            </div>

            <hr className="my-3" />
          </article>
        );
      })}
    </div>
  );
}
