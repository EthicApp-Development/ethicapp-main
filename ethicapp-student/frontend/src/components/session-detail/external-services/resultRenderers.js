/**
 * Which renderer shows an external-service result to the student (#1132).
 * The student app renders results with its own code only: a result names
 * the schema of its payload (`component.documentSchema`), and an allowlist
 * here maps that schema to a renderer. Nothing in a result can make the app
 * load code. Every function here is pure; ExternalServiceResultPanel.jsx maps
 * the renderer ids to components.
 */
import {
  normalizeStudentResultDocument,
  STUDENT_RESULT_SCHEMA
} from './student-result/studentResultDocument.js';

export const RENDERERS = Object.freeze({
  studentResult: 'student-result',
  argumentTutorReport: 'argument-tutor-report',
  argumentTutorChatFeedback: 'argument-tutor-chat-feedback'
});

// The allowlist of document schemas the student app renders, each with its
// renderer. Every student-result/v1 document goes to the generic renderer.
// A service that needs a specialized view gets a renderer added here; see
// the EXTERNAL.md subsection "Adding a specialized renderer".
const DOCUMENT_SCHEMA_RENDERERS = new Map([
  [STUDENT_RESULT_SCHEMA, RENDERERS.studentResult]
]);

// Results published before the student result contract name a component
// instead of a schema: the tutor's live feedback until its adapter publishes
// documents (#1133), and the development mock until #1134. Remove this
// registry, and the two components, once both have moved.
const LEGACY_COMPONENT_RENDERERS = new Map([
  ['argument-tutor-report', RENDERERS.argumentTutorReport],
  ['argument-tutor-chat-feedback', RENDERERS.argumentTutorChatFeedback]
]);

// Titles of legacy components that follow the app's language instead of the
// (English) title the adapter sends.
const LEGACY_TITLE_KEYS = new Map([
  ['argument-tutor-chat-feedback', 'sessionDetail.atsFeedbackTitle']
]);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * The renderer of a result's component descriptor. A descriptor with a
 * `documentSchema` is resolved through the schema allowlist only, since its
 * payload is a document of that schema; one without it, through the legacy
 * `componentId` registry. Anything else, including a `url`, resolves to null.
 * @param {unknown} component
 * @returns {string|null}
 */
export function resolveResultRenderer(component) {
  const documentSchema = nonEmptyString(component?.documentSchema);
  if (documentSchema) {
    return DOCUMENT_SCHEMA_RENDERERS.get(documentSchema) ?? null;
  }

  const componentId = nonEmptyString(component?.componentId);
  return LEGACY_COMPONENT_RENDERERS.get(componentId) ?? null;
}

/**
 * What the panel shows for a result:
 * - `{ renderer: 'student-result', resultDocument }` for a document the generic
 *   renderer can show, `resultDocument` from normalizeStudentResultDocument;
 * - `{ renderer: <legacy id> }` for a legacy component;
 * - `{ renderer: null }` for anything else, shown as a neutral notice.
 * @param {{ component?: object, payload?: unknown }} result
 * @returns {{ renderer: string|null, resultDocument?: object }}
 */
export function resolveResultView(result) {
  const renderer = resolveResultRenderer(result?.component);

  if (renderer === RENDERERS.studentResult) {
    const resultDocument = normalizeStudentResultDocument(result?.payload);
    return resultDocument ? { renderer, resultDocument } : { renderer: null };
  }

  return { renderer };
}

/**
 * The heading of a result: a document's own title, in the document's
 * language; a legacy component's localized or sent title; or the app's
 * generic title.
 * @param {{ renderer: string|null, resultDocument?: object }} view
 * @param {{ component?: object }} result
 * @param {(key: string) => string} t
 * @returns {{ text: string, lang: string|null }}
 */
export function resolveResultHeading(view, result, t) {
  if (view.renderer === RENDERERS.studentResult) {
    return { text: view.resultDocument.title, lang: view.resultDocument.lang };
  }

  if (view.renderer) {
    const titleKey = LEGACY_TITLE_KEYS.get(nonEmptyString(result?.component?.componentId));
    const sentTitle = nonEmptyString(result?.component?.title);
    const text = titleKey ? t(titleKey) : sentTitle || t('sessionDetail.externalResultTitle');
    return { text, lang: null };
  }

  return { text: t('sessionDetail.externalResultTitle'), lang: null };
}
