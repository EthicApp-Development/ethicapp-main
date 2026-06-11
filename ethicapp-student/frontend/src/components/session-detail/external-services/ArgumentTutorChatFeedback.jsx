const CRITERION_LABEL_KEYS = {
  claim: 'sessionDetail.atsCriterionClaim',
  evidence: 'sessionDetail.atsCriterionEvidence',
  warrant: 'sessionDetail.atsCriterionWarrant',
  qualifier: 'sessionDetail.atsCriterionQualifier'
};

// Localized label for a Toulmin criterion, falling back to the backend label.
function localizeCriterionLabel(key, fallbackLabel, t) {
  const i18nKey = CRITERION_LABEL_KEYS[key];
  if (!i18nKey) {
    return fallbackLabel;
  }
  const localized = t(i18nKey);
  return localized === i18nKey ? fallbackLabel : localized;
}

// Localized text for the claim criterion value (in favor / against / neutral),
// falling back to the backend-provided value string for other criteria.
function localizeCriterionValue(key, score, fallbackValue, t) {
  if (key !== 'claim' || !Number.isFinite(Number(score))) {
    return fallbackValue;
  }
  const numericScore = Number(score);
  const claimKey = numericScore === 1
    ? 'sessionDetail.atsClaimInFavor'
    : numericScore === -1
      ? 'sessionDetail.atsClaimAgainst'
      : 'sessionDetail.atsClaimNeutral';
  return `${t(claimKey)} (${numericScore})`;
}

function normalizeCriteria(criteria) {
  if (!Array.isArray(criteria)) {
    return [];
  }

  return criteria
    .map((item) => {
      const label = typeof item?.label === 'string' ? item.label.trim() : '';
      const value = typeof item?.value === 'string' ? item.value.trim() : '';
      if (!label || !value) {
        return null;
      }
      const key = typeof item?.key === 'string' ? item.key.trim().toLowerCase() : '';
      const score = Number.isFinite(Number(item?.score)) ? Number(item.score) : null;
      return { key, label, value, score };
    })
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeBullets(bullets) {
  if (!Array.isArray(bullets)) {
    return [];
  }

  return bullets
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 3);
}

function truncateArgument(argument, maxLength = 140) {
  if (typeof argument !== 'string') {
    return '';
  }

  const text = argument.trim();
  if (!text) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

function sanitizeSummary(summary) {
  if (typeof summary !== 'string') {
    return '';
  }

  const normalized = summary.trim();
  const placeholders = new Set([
    'Argument feedback is now available.',
    'Your argument tutor feedback is now available.'
  ]);

  return placeholders.has(normalized) ? '' : normalized;
}

function toScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatDelta(delta) {
  const score = toScore(delta);
  if (!Number.isFinite(score) || score === 0) {
    return { label: '0', tone: 'neutral' };
  }

  if (score > 0) {
    return { label: `+${score}`, tone: 'up' };
  }

  return { label: `${score}`, tone: 'down' };
}

function ComparisonScores({ comparison, t }) {
  const scoreEntries = [
    ['claim', comparison?.scores?.claim],
    ['evidence', comparison?.scores?.evidence],
    ['warrant', comparison?.scores?.warrant],
    ['qualifier', comparison?.scores?.qualifier]
  ].filter(([, data]) => data && (toScore(data.initial) !== null || toScore(data.revised) !== null || toScore(data.delta) !== null));

  if (scoreEntries.length === 0) {
    return null;
  }

  return (
    <section className="ats-feedback-compact__comparison">
      <h3 className="ats-feedback-compact__section-title">{t('sessionDetail.atsComparisonScores')}</h3>
      <div className="ats-feedback-compact__score-grid">
        {scoreEntries.map(([criterionKey, scoreData]) => {
          const initial = toScore(scoreData?.initial);
          const revised = toScore(scoreData?.revised);
          const { label: deltaLabel, tone } = formatDelta(scoreData?.delta);
          const label = localizeCriterionLabel(criterionKey, criterionKey, t);

          return (
            <article key={criterionKey} className="ats-feedback-compact__score-item">
              <div className="ats-feedback-compact__score-label">{label}</div>
              <div className="ats-feedback-compact__score-values">
                <span>{initial ?? '-'}</span>
                <span className="ats-feedback-compact__score-arrow">→</span>
                <span>{revised ?? '-'}</span>
              </div>
              <div className={`ats-feedback-compact__delta ats-feedback-compact__delta--${tone}`}>
                {deltaLabel}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function ArgumentTutorChatFeedback({ payload = {}, t = (key) => key }) {
  const feedback = payload?.feedback && typeof payload.feedback === 'object' ? payload.feedback : payload;
  const mode = typeof feedback?.mode === 'string' ? feedback.mode.trim().toLowerCase() : 'analysis';
  const summary = sanitizeSummary(feedback?.summary);
  const criteria = normalizeCriteria(feedback?.criteria);
  const bullets = normalizeBullets(feedback?.bullets);
  const comparison = feedback?.comparison && typeof feedback.comparison === 'object' ? feedback.comparison : null;

  const initialArgumentPreview = truncateArgument(comparison?.initialArgument);
  const revisedArgumentPreview = truncateArgument(comparison?.revisedArgument || feedback?.argumentPreview);

  return (
    <div className="external-service-result__body ats-feedback-compact">
      {summary ? <p className="ats-feedback-compact__summary">{summary}</p> : null}

      {mode !== 'comparison' && criteria.length > 0 ? (
        <section className="ats-feedback-compact__criteria">
          {criteria.map((item) => {
            const criterionLabel = localizeCriterionLabel(item.key, item.label, t);
            const criterionValue = localizeCriterionValue(item.key, item.score, item.value, t);
            return (
              <span key={`${item.key || item.label}-${item.value}`} className="ats-feedback-compact__criteria-pill">
                <strong>{criterionLabel}:</strong> {criterionValue}
              </span>
            );
          })}
        </section>
      ) : null}

      {mode === 'comparison' ? <ComparisonScores comparison={comparison} t={t} /> : null}

      {mode === 'comparison' && (initialArgumentPreview || revisedArgumentPreview) ? (
        <section className="ats-feedback-compact__arguments">
          {initialArgumentPreview ? (
            <article className="ats-feedback-compact__argument-card">
              <h4>{t('sessionDetail.atsArgumentPrevious')}</h4>
              <p>{initialArgumentPreview}</p>
            </article>
          ) : null}

          {revisedArgumentPreview ? (
            <article className="ats-feedback-compact__argument-card">
              <h4>{t('sessionDetail.atsArgumentCurrent')}</h4>
              <p>{revisedArgumentPreview}</p>
            </article>
          ) : null}
        </section>
      ) : null}

      {bullets.length > 0 ? (
        <ul className="ats-feedback-compact__bullets">
          {bullets.map((item, index) => (
            <li key={`feedback-bullet-${index}`}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
