import { useEffect, useMemo, useState } from 'react';
import { legacyUserApi } from '../../../api/studentApi.js';
import PhaseChatOverlay from './PhaseChatOverlay.jsx';
import PreviousPhaseResponsesAccordion from './PreviousPhaseResponsesAccordion.jsx';
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
  onRequestOpenChatRefreshToken,
  userId,
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
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatOverlayHeightPx, setChatOverlayHeightPx] = useState(0);
  const [previousResponsesState, setPreviousResponsesState] = useState({
    loading: false,
    error: '',
    data: null
  });

  const tasks = useMemo(() => {
    const phaseTasks = Array.isArray(phase?.tasks) ? phase.tasks : [];
    return [...phaseTasks].sort((leftTask, rightTask) => Number(leftTask?.order ?? 0) - Number(rightTask?.order ?? 0));
  }, [phase]);

  const previousPhaseNumbers = useMemo(() => {
    const configuredPreviousResponses = Array.isArray(phase?.features?.previousResponses)
      ? phase.features.previousResponses
      : [];

    return Array.from(new Set(
      configuredPreviousResponses
        .map((phaseNumber) => Number(phaseNumber))
        .filter((phaseNumber) => Number.isInteger(phaseNumber) && phaseNumber > 0)
    )).sort((left, right) => left - right);
  }, [phase]);
  const previousPhaseNumbersKey = previousPhaseNumbers.join(',');

  useEffect(() => {
    const phaseId = Number(phase?.id);
    const normalizedUserId = Number(userId);

    if (previousPhaseNumbersKey.length === 0 || !Number.isInteger(phaseId) || phaseId <= 0 || !Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
      setPreviousResponsesState({ loading: false, error: '', data: null });
      return;
    }

    let isCancelled = false;
    setPreviousResponsesState((current) => ({
      ...current,
      loading: true,
      error: ''
    }));

    legacyUserApi.get(`/phases/${phaseId}/user_group/${normalizedUserId}/previous_responses`, {
      params: {
        phase_numbers: previousPhaseNumbersKey
      }
    })
      .then(({ data }) => {
        if (isCancelled) {
          return;
        }

        setPreviousResponsesState({
          loading: false,
          error: '',
          data
        });
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setPreviousResponsesState({
          loading: false,
          error: t('sessionDetail.previousResponsesLoadError'),
          data: null
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [phase?.id, previousPhaseNumbersKey, t, userId]);

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
            previousResponsesContent={
              previousPhaseNumbers.length > 0 ? (
                <PreviousPhaseResponsesAccordion
                  previousResponses={previousResponsesState.data}
                  task={task}
                  useAnonymousLabels={
                    phase?.groupAnonymous === true
                    || previousResponsesState.data?.phaseAnonymous === true
                    || phase?.features?.anonymity === true
                    || phase?.features?.anonymous === true
                  }
                  loading={previousResponsesState.loading}
                  errorMessage={previousResponsesState.error}
                  t={t}
                />
              ) : null
            }
            onTaskValueChange={(value) => setTaskDraft(taskId, { value })}
            onTaskJustificationChange={(nextJustification) => setTaskDraft(taskId, { justification: nextJustification })}
            onTaskSubmit={() => submitTask(task)}
            showChatButton={taskId === Number(tasks[0]?.id) && phase?.features?.chat === true}
            onOpenChat={() => setIsChatOpen(true)}
            t={t}
          />
        );
      })}

      {isChatOpen ? <div aria-hidden="true" style={{ height: `${chatOverlayHeightPx}px` }} /> : null}

      <PhaseChatOverlay
        isOpen={isChatOpen}
        onClose={() => {
          setIsChatOpen(false);
          setChatOverlayHeightPx(0);
        }}
        onHeightChange={setChatOverlayHeightPx}
        phase={phase}
        userId={userId}
        chatRefreshToken={onRequestOpenChatRefreshToken}
        t={t}
      />
    </div>
  );
}
