import { useMemo, useState } from 'react';
import SemanticDifferentialTaskView from './SemanticDifferentialTaskView.jsx';

function mapResponsesByTaskId(phase) {
  const responseList = Array.isArray(phase?.responses) ? phase.responses : [];

  return responseList.reduce((acc, response) => {
    const taskId = Number(
      response?.taskId
      ?? response?.task_id
      ?? response?.questionId
      ?? response?.question_id
      ?? response?.did
    );

    if (!Number.isInteger(taskId) || taskId <= 0) {
      return acc;
    }

    const normalizedValue = Number(
      response?.selection
      ?? response?.sel
      ?? response?.value
      ?? response?.responseValue
      ?? response?.response_value
    );

    const normalizedJustification = response?.justification
      ?? response?.comment
      ?? response?.description
      ?? '';

    acc[taskId] = {
      ...response,
      normalizedValue: Number.isInteger(normalizedValue) ? normalizedValue : null,
      normalizedJustification: typeof normalizedJustification === 'string' ? normalizedJustification : ''
    };
    return acc;
  }, {});
}

export default function SemanticDifferentialPhaseView({
  phase,
  draftByTaskId,
  onTaskDraftChange,
  isReadOnly,
  isActivePhase,
  onSubmitPhaseResponse,
  t
}) {
  const responsesByTask = useMemo(() => mapResponsesByTaskId(phase), [phase]);
  const phaseInstructions = useMemo(() => {
    if (typeof phase?.instructions === 'string' && phase.instructions.trim().length > 0) {
      return phase.instructions;
    }

    return typeof phase?.question === 'string' ? phase.question : '';
  }, [phase]);
  const safeDraftByTaskId = draftByTaskId ?? {};
  const [submittingTaskId, setSubmittingTaskId] = useState(null);
  const [feedbackByTaskId, setFeedbackByTaskId] = useState({});

  const tasks = useMemo(() => {
    const phaseTasks = Array.isArray(phase?.tasks) ? phase.tasks : [];
    return [...phaseTasks].sort((leftTask, rightTask) => Number(leftTask?.order ?? 0) - Number(rightTask?.order ?? 0));
  }, [phase]);

  const setTaskDraft = (taskId, partialUpdate) => {
    if (typeof onTaskDraftChange !== 'function') {
      return;
    }

    onTaskDraftChange(taskId, partialUpdate);
  };

  const getTaskValue = (taskId) => {
    const draftValue = safeDraftByTaskId[taskId]?.value;
    if (Number.isInteger(draftValue)) {
      return draftValue;
    }

    return Number.isInteger(responsesByTask[taskId]?.normalizedValue) ? responsesByTask[taskId].normalizedValue : null;
  };

  const getTaskJustification = (taskId) => {
    if (typeof safeDraftByTaskId[taskId]?.justification === 'string') {
      return safeDraftByTaskId[taskId].justification;
    }

    const persistedJustification = responsesByTask[taskId]?.normalizedJustification;
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
    setTaskDraft(taskId, { value, justification });

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

      {phaseInstructions.trim().length > 0 ? (
        <div className="alert alert-secondary mb-0" role="note">
          <strong>{t('sessionDetail.instructionsLabel')}:</strong> {phaseInstructions}
        </div>
      ) : null}

      {tasks.map((task) => {
        const taskId = Number(task?.id);
        const disabled = isReadOnly || !isActivePhase;
        const selectedValue = getTaskValue(taskId);
        const justification = getTaskJustification(taskId);
        const taskFeedback = feedbackByTaskId[taskId] ?? null;

        return (
          <SemanticDifferentialTaskView
            key={taskId}
            task={task}
            disabled={disabled}
            selectedValue={selectedValue}
            justification={justification}
            taskFeedback={taskFeedback}
            submitting={submittingTaskId === taskId}
            onTaskValueChange={(value) => setTaskDraft(taskId, { value })}
            onTaskJustificationChange={(nextJustification) => setTaskDraft(taskId, { justification: nextJustification })}
            onTaskSubmit={() => submitTask(task)}
            t={t}
          />
        );
      })}
    </div>
  );
}
