import { createElement, useMemo } from 'react';
import { renderRichTextTree } from '../../../../utils/richTextElements.js';
import { comparisonTrendKey } from './studentResultDocument.js';
import { disclosureKeyAction } from './disclosure.js';
import { parseStudentResultMarkdown } from './studentResultMarkdown.js';

// The parts of a student-result/v1 document (#1132). Texts from the document
// are rendered as text, except the overview and criterion descriptions, which
// use the contract's Markdown subset. Interface text, such as hints and trend
// words, is in the app's language: `uiLang` marks it, since the document's
// container carries the document's language.

// A text in the Markdown subset, built as React elements from its tree.
export function StudentResultMarkdown({ text, id, hidden, className = '' }) {
  const children = useMemo(
    () => renderRichTextTree(parseStudentResultMarkdown(text), createElement),
    [text]
  );

  return createElement(
    'div',
    { id, hidden, className: `rich-text student-result__markdown ${className}`.trim() },
    ...children
  );
}

export function SectionTitle({ title }) {
  return title ? <h3 className="student-result__section-title">{title}</h3> : null;
}

// Closes an open disclosure on Escape, pressed on its button or inside it.
export function handleDisclosureKeyDown(event, expanded, onClose) {
  if (disclosureKeyAction(event.key, expanded) === 'close') {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }
}

// The label and value of a criterion, with a meter when it has a score. The
// meter repeats the value, which is always shown as text, so it is hidden
// from assistive technology.
export function CriterionSummary({ item }) {
  const { meter } = item;

  return (
    <span className="student-result__criterion-summary">
      <span className="student-result__criterion-line">
        <span className="student-result__criterion-label">{item.label}</span>
        <span className="student-result__criterion-value">{item.value}</span>
      </span>
      {meter ? (
        <span className="student-result__meter" aria-hidden="true">
          <span
            className="student-result__meter-fill"
            style={{ width: `${Math.round(meter.fraction * 100)}%` }}
          />
        </span>
      ) : null}
    </span>
  );
}

// A criterion with a description is a button that opens the description
// right below it, and closes it again or with Escape. One without a
// description is plain content.
export function Criterion({ item, domId, expanded, onToggle, onClose, uiLang, t }) {
  if (!item.description) {
    return (
      <li className="student-result__criterion">
        <div className="student-result__criterion-row">
          <CriterionSummary item={item} />
        </div>
      </li>
    );
  }

  const descriptionId = `${domId}-description`;
  const openClass = expanded ? ' student-result__criterion--open' : '';

  return (
    <li
      className={`student-result__criterion${openClass}`}
      onKeyDown={(event) => handleDisclosureKeyDown(event, expanded, onClose)}
    >
      <button
        type="button"
        className="student-result__criterion-row student-result__criterion-toggle"
        aria-expanded={expanded}
        aria-controls={descriptionId}
        onClick={onToggle}
      >
        <CriterionSummary item={item} />
        <i className="fa-regular fa-circle-question student-result__help-icon" aria-hidden="true" />
        <span className="visually-hidden" lang={uiLang}>
          {` ${t('sessionDetail.studentResultCriterionHelp')}`}
        </span>
      </button>
      <StudentResultMarkdown
        id={descriptionId}
        hidden={!expanded}
        text={item.description}
        className="student-result__criterion-description"
      />
    </li>
  );
}

export function CriteriaSection({
  section, sectionKey, domId, openKeys, onToggle, onClose, uiLang, t
}) {
  return (
    <section className="student-result__section">
      <SectionTitle title={section.title} />
      <ul className="student-result__criteria">
        {section.items.map((item, index) => {
          const key = `${sectionKey}-criterion-${index}`;
          return (
            <Criterion
              key={key}
              item={item}
              domId={`${domId}-${key}`}
              expanded={openKeys.has(key)}
              onToggle={() => onToggle(key)}
              onClose={() => onClose(key)}
              uiLang={uiLang}
              t={t}
            />
          );
        })}
      </ul>
    </section>
  );
}

export function BulletsSection({ section }) {
  return (
    <section className="student-result__section">
      <SectionTitle title={section.title} />
      <ul className="student-result__bullets">
        {section.items.map((item, index) => (
          <li key={`bullet-${index}`} className="student-result__plain">{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function TextSection({ section }) {
  return (
    <section className="student-result__section">
      <SectionTitle title={section.title} />
      <p className="student-result__text student-result__plain">{section.text}</p>
    </section>
  );
}

export function ComparisonSection({ section, uiLang, t }) {
  return (
    <section className="student-result__section">
      <SectionTitle title={section.title} />
      <ul className="student-result__changes">
        {section.items.map((item, index) => {
          const trendKey = comparisonTrendKey(item.trend);
          return (
            <li key={`change-${index}`} className="student-result__change">
              <span className="student-result__change-label">{item.label}</span>
              <span className="student-result__change-values">
                <span className="student-result__plain">
                  <span className="visually-hidden" lang={uiLang}>
                    {`${t('sessionDetail.studentResultBefore')}: `}
                  </span>
                  {item.before}
                </span>
                <i
                  className="fa-solid fa-arrow-right student-result__change-arrow"
                  aria-hidden="true"
                />
                <span className="student-result__plain student-result__change-after">
                  <span className="visually-hidden" lang={uiLang}>
                    {`${t('sessionDetail.studentResultAfter')}: `}
                  </span>
                  {item.after}
                </span>
              </span>
              {trendKey ? (
                <span
                  className={`student-result__trend student-result__trend--${item.trend}`}
                  lang={uiLang}
                >
                  {t(trendKey)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The component of each section kind the app knows. The document module
// has already dropped the sections of other kinds.
export const SECTION_COMPONENTS = {
  criteria: CriteriaSection,
  bullets: BulletsSection,
  text: TextSection,
  comparison: ComparisonSection
};
