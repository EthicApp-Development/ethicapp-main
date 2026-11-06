import { Component, Suspense, lazy } from 'react';
import { formatSessionDate } from '../../../utils/sessionFormat.js';
import ArgumentTutorReport from './ArgumentTutorReport.jsx';
import ArgumentTutorChatFeedback from './ArgumentTutorChatFeedback.jsx';

const localComponentRegistry = {
  'argument-tutor-report': ArgumentTutorReport,
  'argument-tutor-chat-feedback': ArgumentTutorChatFeedback
};

// Local components whose title must follow the browser locale instead of the
// (English) title sent by the backend adapter.
const localizedComponentTitleKeys = {
  'argument-tutor-chat-feedback': 'sessionDetail.atsFeedbackTitle'
};

function loadRemoteComponent({ url, exportName = 'default' }) {
  return lazy(async () => {
    const module = await import(/* @vite-ignore */ url);
    const Component = module[exportName];

    if (!Component) {
      throw new Error(`External component export not found: ${exportName}`);
    }

    return { default: Component };
  });
}

function resolveComponent(component = {}) {
  if (component.componentId && localComponentRegistry[component.componentId]) {
    return localComponentRegistry[component.componentId];
  }

  if (component.url) {
    return loadRemoteComponent(component);
  }

  return ArgumentTutorReport;
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
        const Component = resolveComponent(result.component);
        const localizedTitleKey = localizedComponentTitleKeys[result.component?.componentId];
        const resultTitle = localizedTitleKey
          ? t(localizedTitleKey)
          : result.component?.title || t('sessionDetail.externalResultTitle');
        const resultTime = formatResultTime(result, locale, t);
        const isExpanded = Boolean(expandedKeys?.has(result.key));
        const bodyId = `${resultDomId(result.key)}-body`;
        const chevronClass = isExpanded ? 'fa-chevron-up' : 'fa-chevron-down';
        const loadingFallback = (
          <p className="text-muted mb-0">{t('sessionDetail.externalResultLoading')}</p>
        );

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
                  <span className="external-service-result__title">{resultTitle}</span>
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
                <Suspense fallback={loadingFallback}>
                  <Component
                    payload={result.payload}
                    message={result.message}
                    status={result.status}
                    result={result}
                    t={t}
                  />
                </Suspense>
              </ExternalResultErrorBoundary>
            </div>
          </article>
        );
      })}
    </aside>
  );
}
