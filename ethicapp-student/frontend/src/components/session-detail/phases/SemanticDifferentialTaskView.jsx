export default function SemanticDifferentialTaskView({
  task,
  disabled,
  selectedValue,
  justification,
  taskFeedback,
  submitting,
  previousResponsesContent,
  onTaskValueChange,
  onTaskJustificationChange,
  onTaskSubmit,
  onOpenChat,
  showChatButton,
  t
}) {
  const countWords = (text) => {
    if (typeof text !== 'string') {
      return 0;
    }

    const normalizedText = text.trim();
    if (normalizedText.length === 0) {
      return 0;
    }

    return normalizedText.split(/\s+/).length;
  };

  const resolveMinimumWords = (currentTask) => {
    const minimumRequiredCandidates = [
      currentTask?.justificationMinimumLengthRequired,
      currentTask?.justification_minimum_length_required,
      currentTask?.answerFormat?.justificationMinimumLengthRequired,
      currentTask?.answerFormat?.justification_minimum_length_required,
      currentTask?.ansFormat?.justificationMinimumLengthRequired,
      currentTask?.ansFormat?.justification_minimum_length_required,
      currentTask?.ans_format?.justification_minimum_length_required
    ];

    const isMinimumRequired = minimumRequiredCandidates.some((value) => value === true);

    const minimumWordCandidates = [
      currentTask?.min_just_length,
      currentTask?.minWordCount,
      currentTask?.minJustificationWords,
      currentTask?.minimumJustificationWords,
      currentTask?.minJustLength,
      currentTask?.answerFormat?.minJustLength,
      currentTask?.answerFormat?.min_just_length,
      currentTask?.ansFormat?.minJustLength,
      currentTask?.ansFormat?.min_just_length,
      currentTask?.ans_format?.min_just_length
    ];

    const parsedMinimumValues = minimumWordCandidates
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (parsedMinimumValues.length === 0) {
      return null;
    }

    if (isMinimumRequired) {
      return Math.max(...parsedMinimumValues);
    }

    return parsedMinimumValues[0];
  };

  const taskId = Number(task?.id);
  const numValues = Number(task?.numValues);
  const wordCount = countWords(justification);
  const minimumWords = resolveMinimumWords(task);
  const isBelowMinimumWords = Number.isInteger(minimumWords) && wordCount < minimumWords;

  return (
    <article>
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
                  onChange={() => onTaskValueChange(scaleValue)}
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
            onChange={(event) => onTaskJustificationChange(event.target.value)}
            placeholder={t('sessionDetail.justificationPlaceholder')}
          />
          <div className="d-flex justify-content-between align-items-center mt-2 gap-2 flex-wrap">
            <small className={`mb-0 ${isBelowMinimumWords ? 'text-danger' : 'text-muted'}`}>
              {t('sessionDetail.justificationWordCountLabel')}: {wordCount}
            </small>
            {Number.isInteger(minimumWords) ? (
              <small className={`mb-0 ${isBelowMinimumWords ? 'text-danger' : 'text-muted'}`}>
                {t('sessionDetail.justificationWordMinimumLabel')}: {minimumWords}
              </small>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="d-flex justify-content-end align-items-center gap-2">
        {showChatButton ? (
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={onOpenChat}
        >
          <span className="d-inline-flex align-items-center gap-2">
            <i className="fa-solid fa-cloud" aria-hidden="true" />
            <span>{t('sessionDetail.openChat')}</span>
          </span>
        </button>
      ) : null}

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
          disabled={disabled || submitting}
          onClick={onTaskSubmit}
        >
          <span className="d-inline-flex align-items-center gap-2">
            <i className="fa-solid fa-paper-plane" aria-hidden="true" />
            <span>{submitting ? t('sessionDetail.submittingResponse') : t('sessionDetail.submitResponse')}</span>
          </span>
        </button>
      </div>

      {previousResponsesContent}

      <hr className="my-3" />
    </article>
  );
}
