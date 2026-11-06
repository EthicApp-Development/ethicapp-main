import { Component } from 'react';
import { formatSessionDate } from '../../../utils/sessionFormat.js';
import ArgumentTutorReport from './ArgumentTutorReport.jsx';
import ArgumentTutorChatFeedback from './ArgumentTutorChatFeedback.jsx';
import StudentResultDocument from './student-result/StudentResultDocument.jsx';
import { RENDERERS, resolveResultHeading, resolveResultView } from './resultRenderers.js';

// The component of each renderer id of resultRenderers.js, which holds the
// allowlist of document schemas. The app renders results with these
// components only.
const RENDERER_COMPONENTS = {
  [RENDERERS.studentResult]: StudentResultDocument,
  [RENDERERS.argumentTutorReport]: ArgumentTutorReport,
  [RENDERERS.argumentTutorChatFeedback]: ArgumentTutorChatFeedback
};

// A result the app cannot show, such as one with a document schema it does
// not know, gets a neutral notice.
function UnsupportedResult({ t }) {
  return (
    <p className="external-service-result__notice mb-0">
      {t('sessionDetail.studentResultUnsupported')}
    </p>
  );
}

class ExternalResultErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <p className="text-warning mb-0">{this.props.fallback}</p>;
    }

    return this.props.children;
  }
}

function resultDomId(resultKey) {
  return `external-service-result-${String(resultKey).replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function formatResultTime(result, locale, t) {
  const value = result.publishedAt || result.receivedAt;
  return value && !Number.isNaN(Date.parse(value)) ? formatSessionDate(value, locale, t) : '';
}

/**
 * The results of one phase, newest first, each collapsible. Collapsing only
 * hides a result's body: the student can always expand it again (#1128).
 */
export default function ExternalServiceResultPanel({ results, expandedKeys, onToggle, locale, t }) {
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  return (
    <aside
      className="external-service-results mt-3"
      aria-label={t('sessionDetail.externalResultsLabel')}
      aria-live="polite"
    >
      {results.map((result) => {
        const view = resolveResultView(result);
        const ResultBody = RENDERER_COMPONENTS[view.renderer] ?? UnsupportedResult;
        const heading = resolveResultHeading(view, result, t);
        const resultTime = formatResultTime(result, locale, t);
        const isExpanded = Boolean(expandedKeys?.has(result.key));
        const bodyId = `${resultDomId(result.key)}-body`;
        const chevronClass = isExpanded ? 'fa-chevron-up' : 'fa-chevron-down';

        return (
          <article className="external-service-result border rounded-2 mb-3" key={result.key}>
            <h2 className="h6 mb-0">
              <button
                type="button"
                className="external-service-result__toggle"
                aria-expanded={isExpanded}
                aria-controls={bodyId}
                onClick={() => onToggle?.(result.key)}
              >
                <i
                  className={`fa-solid ${chevronClass} external-service-result__chevron`}
                  aria-hidden="true"
                />
                <span className="external-service-result__heading">
                  <span className="external-service-result__title" lang={heading.lang ?? undefined}>
                    {heading.text}
                  </span>
                  {resultTime ? (
                    <span className="external-service-result__time">
                      {t('sessionDetail.externalResultPublishedAt', { time: resultTime })}
                    </span>
                  ) : null}
                </span>
              </button>
            </h2>
            <div id={bodyId} className="external-service-result__content" hidden={!isExpanded}>
              <ExternalResultErrorBoundary fallback={t('sessionDetail.externalResultLoadError')}>
                <ResultBody
                  resultDocument={view.resultDocument}
                  payload={result.payload}
                  message={result.message}
                  status={result.status}
                  result={result}
                  locale={locale}
                  t={t}
                />
              </ExternalResultErrorBoundary>
            </div>
          </article>
        );
      })}
    </aside>
  );
}
