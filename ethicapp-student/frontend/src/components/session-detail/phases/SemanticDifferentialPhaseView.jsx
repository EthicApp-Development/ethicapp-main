import { useEffect, useMemo, useState } from 'react';
import { legacyUserApi } from '../../../api/studentApi.js';
import PhaseChatOverlay from './PhaseChatOverlay.jsx';
import PhaseInstructions from './PhaseInstructions.jsx';
import PreviousPhaseResponsesAccordion from './PreviousPhaseResponsesAccordion.jsx';
import SemanticDifferentialTaskView from './SemanticDifferentialTaskView.jsx';
import { isPhaseAnonymous } from '../../../utils/phaseAnonymity.js';
import { DRAFT_OUTCOMES, unsentDrafts } from '../../../utils/phaseDrafts.js';
import { ANSWER_PROBLEMS, effectiveAnswer, savedAnswersByTaskId } from '../../../utils/semanticDifferentialAnswer.js';

// Why a draft of a phase that is over was not sent.
const KEPT_DRAFT_MESSAGE_KEYS = {
  [ANSWER_PROBLEMS.MISSING_VALUE]: 'phaseDrafts.taskKeptMissingValue',
  [ANSWER_PROBLEMS.MISSING_JUSTIFICATION]: 'phaseDrafts.taskKeptMissingJustification',
  [ANSWER_PROBLEMS.JUSTIFICATION_TOO_SHORT]: 'phaseDrafts.taskKeptJustificationTooShort'
};

function resolvePhaseGroupId(phase) {
  const group = phase?.group;
  const groupId = Number(
    phase?.groupId
    ?? group?.id
    ?? group?.groupId
  );

  return Number.isInteger(groupId) && groupId > 0 ? groupId : null;
}

export default function SemanticDifferentialPhaseView({
  phase,
  draftByTaskId,
  onTaskDraftChange,
  autoSendOutcomeByTaskId,
  isReadOnly,
  isActivePhase,
  onSubmitPhaseResponse,
  isExternalResponseProcessing,
  onRequestOpenChatRefreshToken,
  userId,
  t
}) {
  const responsesByTask = useMemo(() => savedAnswersByTaskId(phase), [phase]);
  const safeDraftByTaskId = draftByTaskId ?? {};
  const unsentByTaskId = useMemo(() => Object.fromEntries(
    unsentDrafts(phase, draftByTaskId ?? {}).map((draft) => [draft.taskId, draft])
  ), [draftByTaskId, phase]);
  const isPhaseOver = isReadOnly || !isActivePhase;
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
  const canOpenGroupChat = phase?.features?.chat === true
    && resolvePhaseGroupId(phase) != null;
  const canPostGroupChat = canOpenGroupChat
    && isActivePhase
    && !isReadOnly;

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

  useEffect(() => {
    if (!canOpenGroupChat && isChatOpen) {
      setIsChatOpen(false);
      setChatOverlayHeightPx(0);
    }
  }, [canOpenGroupChat, isChatOpen]);

  const setTaskDraft = (taskId, partialUpdate) => {
    if (typeof onTaskDraftChange !== 'function') {
      return;
    }

    onTaskDraftChange(taskId, partialUpdate);
  };

  const getTaskValue = (taskId) => effectiveAnswer(safeDraftByTaskId[taskId], responsesByTask[taskId]).value;

  const getTaskJustification = (taskId) => (
    effectiveAnswer(safeDraftByTaskId[taskId], responsesByTask[taskId]).justification
  );

  // What happened to the task's draft when time ran out (#1118): sent for
  // the student, or kept on the device once the phase is over.
  const getDraftNote = (taskId) => {
    const outcome = autoSendOutcomeByTaskId?.[taskId]?.status;
    const unsent = unsentByTaskId[taskId];

    if (outcome === DRAFT_OUTCOMES.SENDING) {
      return { kind: 'sending', text: t('phaseDrafts.taskSending') };
    }
    if (outcome === DRAFT_OUTCOMES.SENT && (!unsent || isPhaseOver)) {
      return { kind: 'sent', text: t('phaseDrafts.taskSent') };
    }
    if (unsent && isPhaseOver) {
      return { kind: 'kept', text: t(KEPT_DRAFT_MESSAGE_KEYS[unsent.problem] ?? 'phaseDrafts.taskKept') };
    }
    return null;
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
        phaseId: Number(phase?.id),
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

      <PhaseInstructions phase={phase} t={t} />
      {isExternalResponseProcessing ? (
        <div className="alert alert-info py-2 mb-0 d-inline-flex align-items-center gap-2" role="status" aria-live="polite">
          <span className="spinner-border spinner-border-sm" aria-hidden="true" />
          <span>{t('sessionDetail.externalResponseProcessing')}</span>
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
            draftNote={getDraftNote(taskId)}
            submitting={submittingTaskId === taskId}
            externalResponseProcessing={Boolean(isExternalResponseProcessing)}
            previousResponsesContent={
              previousPhaseNumbers.length > 0 ? (
                <>
                <br/>
                <hr/>
                <PreviousPhaseResponsesAccordion
                  previousResponses={previousResponsesState.data}
                  task={task}
                  useAnonymousLabels={
                    isPhaseAnonymous(phase)
                    || previousResponsesState.data?.phaseAnonymous === true
                  }
                  loading={previousResponsesState.loading}
                  errorMessage={previousResponsesState.error}
                  t={t}
                />
                </>
              ) : null
            }
            onTaskValueChange={(value) => setTaskDraft(taskId, { value })}
            onTaskJustificationChange={(nextJustification) => setTaskDraft(taskId, { justification: nextJustification })}
            onTaskSubmit={() => submitTask(task)}
            showChatButton={taskId === Number(tasks[0]?.id) && canOpenGroupChat}
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
        readOnly={!canPostGroupChat}
        t={t}
      />
    </div>
  );
}
