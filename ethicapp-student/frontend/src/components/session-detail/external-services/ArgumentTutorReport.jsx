export default function ArgumentTutorReport({ payload = {}, message = '', status = '', t }) {
  const strengths = Array.isArray(payload.strengths) ? payload.strengths : [];
  const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
  const score = Number(payload.score);

  return (
    <div className="external-service-result__body">
      {message ? <p className="mb-2 text-secondary">{message}</p> : null}
      <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
        <span className="badge text-bg-primary">{payload.title || t('sessionDetail.argumentTutorTitle')}</span>
        {status ? <span className="badge text-bg-light border">{status}</span> : null}
        {Number.isFinite(score) ? <span className="badge text-bg-success">{Math.round(score * 100)}%</span> : null}
      </div>
      {payload.summary ? <p className="mb-3">{payload.summary}</p> : null}

      {strengths.length > 0 ? (
        <section className="mb-3">
          <h3 className="h6 mb-2">{t('sessionDetail.argumentTutorStrengths')}</h3>
          <ul className="mb-0">
            {strengths.map((item, index) => <li key={`strength-${index}`}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      {suggestions.length > 0 ? (
        <section>
          <h3 className="h6 mb-2">{t('sessionDetail.argumentTutorSuggestions')}</h3>
          <ul className="mb-0">
            {suggestions.map((item, index) => <li key={`suggestion-${index}`}>{item}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
