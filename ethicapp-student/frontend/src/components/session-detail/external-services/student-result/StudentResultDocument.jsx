import { createElement, useCallback, useId, useMemo, useState } from 'react';
import { createTranslator } from '../../../../i18n/translator.js';
import { closeDisclosure, toggleDisclosure } from './disclosure.js';
import { resultLabelLocale, studentResultStatusKey } from './studentResultDocument.js';
import {
  handleDisclosureKeyDown,
  SECTION_COMPONENTS,
  StudentResultMarkdown
} from './StudentResultSections.jsx';

const OVERVIEW_KEY = 'overview';

// The app's locale (es_CL) as a BCP 47 tag (es-CL), for the lang attribute.
function languageTag(locale) {
  return typeof locale === 'string' && locale ? locale.replace('_', '-') : undefined;
}

/**
 * The generic renderer of student-result/v1 documents (#1132). The panel
 * shows the document's title in the result's header; this body shows the
 * status of an incomplete result, the summary, the overview as help that
 * the student opens on demand, and the known sections in order.
 *
 * `resultDocument` comes from normalizeStudentResultDocument. The body carries the
 * document's language, and so do the renderer's own labels (#1169), so a
 * result reads in one language whatever the app's; a document without a
 * language gets them in the app's (`locale`).
 */
export default function StudentResultDocument({ resultDocument, locale }) {
  const domId = useId();
  const [openKeys, setOpenKeys] = useState(() => new Set());
  const toggle = useCallback((key) => setOpenKeys((current) => toggleDisclosure(current, key)), []);
  const close = useCallback((key) => setOpenKeys((current) => closeDisclosure(current, key)), []);

  const labelLocale = resultLabelLocale(resultDocument, locale);
  const labelLang = languageTag(labelLocale);
  const t = useMemo(() => createTranslator(labelLocale), [labelLocale]);
  const statusKey = studentResultStatusKey(resultDocument.status);
  const overviewOpen = openKeys.has(OVERVIEW_KEY);
  const overviewId = `${domId}-overview`;
  const overviewChevron = overviewOpen ? 'fa-chevron-up' : 'fa-chevron-down';
  const closeOverview = () => close(OVERVIEW_KEY);

  return (
    <div
      className="external-service-result__body student-result"
      lang={resultDocument.lang ?? undefined}
    >
      {statusKey ? (
        <p
          className={`student-result__status student-result__status--${resultDocument.status}`}
          lang={labelLang}
        >
          <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
          <span>{t(statusKey)}</span>
        </p>
      ) : null}

      {resultDocument.summary ? (
        <p className="student-result__summary student-result__plain">{resultDocument.summary}</p>
      ) : null}

      {resultDocument.overview ? (
        <div
          className="student-result__overview"
          onKeyDown={(event) => handleDisclosureKeyDown(event, overviewOpen, closeOverview)}
        >
          <button
            type="button"
            className="student-result__overview-toggle"
            aria-expanded={overviewOpen}
            aria-controls={overviewId}
            onClick={() => toggle(OVERVIEW_KEY)}
          >
            <i className="fa-solid fa-circle-info student-result__help-icon" aria-hidden="true" />
            <span lang={labelLang}>{t('sessionDetail.studentResultOverviewToggle')}</span>
            <i
              className={`fa-solid ${overviewChevron} student-result__overview-chevron`}
              aria-hidden="true"
            />
          </button>
          {createElement(StudentResultMarkdown, {
            id: overviewId,
            hidden: !overviewOpen,
            text: resultDocument.overview,
            className: 'student-result__overview-text'
          })}
        </div>
      ) : null}

      {resultDocument.sections.map((section, index) => {
        const sectionKey = `section-${index}`;
        return createElement(SECTION_COMPONENTS[section.kind], {
          key: sectionKey,
          section,
          sectionKey,
          domId,
          openKeys,
          onToggle: toggle,
          onClose: close,
          labelLang,
          t
        });
      })}
    </div>
  );
}
