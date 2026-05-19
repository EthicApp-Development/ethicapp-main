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

export default function ArgumentTutorChatFeedback({ payload = {}, message = '', status = '' }) {
  const feedback = payload?.feedback && typeof payload.feedback === 'object' ? payload.feedback : payload;
  const title = typeof feedback?.title === 'string' && feedback.title.trim().length > 0
    ? feedback.title.trim()
    : 'Argument Tutor Feedback';
  const summary = typeof feedback?.summary === 'string' ? feedback.summary.trim() : '';
  const criteria = normalizeCriteria(feedback?.criteria);
  const bullets = normalizeBullets(feedback?.bullets);

  return (
    <div className="external-service-result__body">
      {message ? <p className="mb-2 text-secondary">{message}</p> : null}
      <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
        <span className="badge text-bg-primary">{title}</span>
        {status ? <span className="badge text-bg-light border">{status}</span> : null}
      </div>

      <div className="border rounded p-2 bg-light-subtle">
        {summary ? <p className="mb-2 small">{summary}</p> : null}

        {criteria.length > 0 ? (
          <section className="mb-2">
            <h3 className="h6 mb-1">Evaluation Criteria</h3>
            <ul className="mb-0">
              {criteria.map((item, index) => (
                <li key={`${item.label}-${index}`} className="small">
                  <strong>{item.label}:</strong> {item.value}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {bullets.length > 0 ? (
          <section>
            <h3 className="h6 mb-1">Feedback Bullets</h3>
            <ul className="mb-0">
              {bullets.map((item, index) => (
                <li key={`feedback-bullet-${index}`} className="small">{item}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
