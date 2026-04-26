import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ethicappLogo from '../../assets/logos/ethicapp-logo.svg';
import { useI18n } from '../../app/providers';
import { DEFAULT_LOCALE } from '../../i18n/languages';
import MarkdownArticle from './MarkdownArticle';

const markdownLoaders = import.meta.glob('../../content/legal/**/*.md', {
  query: '?raw',
  import: 'default'
});

function interpolateTemplateVariables(markdown, variables) {
  return markdown.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = variables[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function LegalDocumentPage({
  documentKey,
  titleKey,
  updatedAtKey,
  markdownVariables
}) {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const [markdownContent, setMarkdownContent] = useState('');

  const localizedPath = `../../content/legal/${documentKey}/${locale}.md`;
  const fallbackPath = `../../content/legal/${documentKey}/${DEFAULT_LOCALE}.md`;

  const resolvedMarkdownVariables = useMemo(
    () => ({
      institutionName: import.meta.env.VITE_INSTITUTION_NAME,
      privacyContact: import.meta.env.VITE_DATAPRIVACY_CONTACT,
      ...markdownVariables
    }),
    [markdownVariables]
  );

  useEffect(() => {
    let ignore = false;

    async function loadMarkdown() {
      const loadLocalized = markdownLoaders[localizedPath];
      const loadFallback = markdownLoaders[fallbackPath];
      const loader = loadLocalized || loadFallback;

      if (!loader) {
        if (!ignore) {
          setMarkdownContent('');
        }
        return;
      }

      const rawMarkdown = await loader();
      const interpolated = interpolateTemplateVariables(rawMarkdown, resolvedMarkdownVariables);

      if (!ignore) {
        setMarkdownContent(interpolated);
      }
    }

    loadMarkdown();

    return () => {
      ignore = true;
    };
  }, [fallbackPath, localizedPath, resolvedMarkdownVariables]);

  return (
    <main className="py-5 bg-light min-vh-100">
      <div className="container">
        <div className="mx-auto bg-white shadow-sm rounded-4 p-4 p-md-5" style={{ maxWidth: '860px' }}>
          <header className="mb-4">
            <div className="mb-3">
              <button
                type="button"
                className="btn btn-link p-0 text-decoration-none"
                onClick={() => navigate(-1)}
              >
                ← {t('legal.back')}
              </button>
            </div>

            <div className="text-center mb-3">
              <img
                src={ethicappLogo}
                alt="EthicApp"
                style={{ height: '48px' }}
              />
            </div>

            <div className="text-center">
              <h1 className="mb-2">{t(titleKey)}</h1>
              <p className="text-muted mb-0">{t(updatedAtKey)}</p>
            </div>
          </header>

          <MarkdownArticle markdown={markdownContent} />
        </div>
      </div>
    </main>
  );
}

LegalDocumentPage.propTypes = {
  documentKey: PropTypes.oneOf(['privacy', 'terms']).isRequired,
  titleKey: PropTypes.string.isRequired,
  updatedAtKey: PropTypes.string.isRequired,
  markdownVariables: PropTypes.object
};

LegalDocumentPage.defaultProps = {
  markdownVariables: {}
};

export default LegalDocumentPage;
