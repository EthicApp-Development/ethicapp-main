import { Component, Suspense, lazy, useMemo } from 'react';
import ArgumentTutorReport from './ArgumentTutorReport.jsx';

const localComponentRegistry = {
  'argument-tutor-report': ArgumentTutorReport
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

export default function ExternalServiceResultPanel({ results, t, onDismiss }) {
  const orderedResults = useMemo(() => {
    return [...results].sort((left, right) => {
      return String(right.receivedAt || '').localeCompare(String(left.receivedAt || ''));
    });
  }, [results]);

  if (orderedResults.length === 0) {
    return null;
  }

  return (
    <aside className="external-service-results mt-3" aria-live="polite">
      {orderedResults.map((result) => {
        const Component = resolveComponent(result.component);

        return (
          <article className="external-service-result border rounded-2 p-3 mb-3" key={result.id}>
            <div className="d-flex justify-content-between gap-3 align-items-start mb-2">
              <div>
                <h2 className="h6 mb-1">{result.component?.title || t('sessionDetail.externalResultTitle')}</h2>
                <p className="text-secondary small mb-0">
                  {result.serviceId ? `${t('sessionDetail.externalResultService')}: ${result.serviceId}` : null}
                </p>
              </div>
              <button
                className="btn btn-outline-secondary btn-sm"
                type="button"
                onClick={() => onDismiss(result.id)}
              >
                {t('sessionDetail.externalResultDismiss')}
              </button>
            </div>
            <ExternalResultErrorBoundary fallback={t('sessionDetail.externalResultLoadError')}>
              <Suspense fallback={<p className="text-muted mb-0">{t('sessionDetail.externalResultLoading')}</p>}>
                <Component
                  payload={result.payload}
                  message={result.message}
                  status={result.status}
                  result={result}
                  t={t}
                />
              </Suspense>
            </ExternalResultErrorBoundary>
          </article>
        );
      })}
    </aside>
  );
}
