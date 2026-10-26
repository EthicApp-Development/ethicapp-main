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
    .filter(Boolean);
}

function normalizeBullets(bullets) {
  if (!Array.isArray(bullets)) {
    return [];
  }

  return bullets
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

export default function AtsFeedbackBubble({ feedback, t }) {
  const title = typeof feedback?.title === 'string' && feedback.title.trim().length > 0
    ? feedback.title.trim()
    : t('sessionDetail.argumentTutorTitle');
  const summary = typeof feedback?.summary === 'string' ? feedback.summary.trim() : '';
  const criteria = normalizeCriteria(feedback?.criteria);
  const bullets = normalizeBullets(feedback?.bullets);

  return (
    <div className="border rounded p-2 bg-light-subtle" style={{ maxWidth: '100%' }}>
      <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
        <strong className="small mb-0">{title}</strong>
        <span className="badge text-bg-secondary">ATS</span>
      </div>

      {summary ? <p className="mb-2 small">{summary}</p> : null}

      {criteria.length > 0 ? (
        <div className="mb-2">
          <p className="small fw-semibold mb-1">Evaluation criteria</p>
          <ul className="mb-0 ps-3">
            {criteria.map((criterion, index) => (
              <li key={`${criterion.label}-${index}`} className="small">
                <strong>{criterion.label}:</strong> {criterion.value}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {bullets.length > 0 ? (
        <div>
          <p className="small fw-semibold mb-1">Feedback bullets</p>
          <ul className="mb-0 ps-3">
            {bullets.map((bullet, index) => (
              <li key={`feedback-bullet-${index}`} className="small">{bullet}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
