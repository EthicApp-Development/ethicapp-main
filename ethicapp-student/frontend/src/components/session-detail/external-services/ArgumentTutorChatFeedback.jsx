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
      return { label, value };
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

function ComparisonScores({ comparison }) {
  const scoreEntries = [
    ['Claim', comparison?.scores?.claim],
    ['Evidence', comparison?.scores?.evidence],
    ['Warrant', comparison?.scores?.warrant],
    ['Qualifier', comparison?.scores?.qualifier]
  ].filter(([, data]) => data && (toScore(data.initial) !== null || toScore(data.revised) !== null || toScore(data.delta) !== null));

  if (scoreEntries.length === 0) {
    return null;
  }

  return (
    <section className="ats-feedback-compact__comparison">
      <h3 className="ats-feedback-compact__section-title">Comparación de puntajes</h3>
      <div className="ats-feedback-compact__score-grid">
        {scoreEntries.map(([label, scoreData]) => {
          const initial = toScore(scoreData?.initial);
          const revised = toScore(scoreData?.revised);
          const { label: deltaLabel, tone } = formatDelta(scoreData?.delta);

          return (
            <article key={label} className="ats-feedback-compact__score-item">
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

export default function ArgumentTutorChatFeedback({ payload = {} }) {
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
          {criteria.map((item) => (
            <span key={`${item.label}-${item.value}`} className="ats-feedback-compact__criteria-pill">
              <strong>{item.label}:</strong> {item.value}
            </span>
          ))}
        </section>
      ) : null}

      {mode === 'comparison' ? <ComparisonScores comparison={comparison} /> : null}

      {mode === 'comparison' && (initialArgumentPreview || revisedArgumentPreview) ? (
        <section className="ats-feedback-compact__arguments">
          {initialArgumentPreview ? (
            <article className="ats-feedback-compact__argument-card">
              <h4>Argumento previo</h4>
              <p>{initialArgumentPreview}</p>
            </article>
          ) : null}

          {revisedArgumentPreview ? (
            <article className="ats-feedback-compact__argument-card">
              <h4>Argumento actual</h4>
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
