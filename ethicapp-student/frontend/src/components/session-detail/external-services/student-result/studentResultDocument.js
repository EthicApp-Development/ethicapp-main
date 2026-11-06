/**
 * A student-result/v1 document as the generic renderer shows it (#1132).
 * The contract is ethicapp-ai-additions shared/schemas/student-result.v1.schema.json
 * and its README section "Student Result Document". EthicApp validates each
 * document before publishing it, so this module does not judge documents: it
 * keeps what the renderer can show and drops the rest, so a malformed part
 * never breaks the page. Sections of a kind this module does not know are
 * skipped, which is how later minor versions add kinds.
 *
 * Every function here is pure.
 */

export const STUDENT_RESULT_SCHEMA = 'student-result/v1';

const LOCALES = new Set(['es-CL', 'en-US']);
const STATUSES = new Set(['complete', 'partial', 'unavailable']);
const TRENDS = new Set(['improved', 'unchanged', 'declined']);

const STATUS_LABEL_KEYS = {
  partial: 'sessionDetail.studentResultStatusPartial',
  unavailable: 'sessionDetail.studentResultStatusUnavailable'
};

const TREND_LABEL_KEYS = {
  improved: 'sessionDetail.studentResultTrendImproved',
  unchanged: 'sessionDetail.studentResultTrendUnchanged',
  declined: 'sessionDetail.studentResultTrendDeclined'
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// A text with at least one character other than whitespace, kept as it is:
// the renderer shows plain text verbatim, line breaks included.
function textOrNull(value) {
  return typeof value === 'string' && /\S/.test(value) ? value : null;
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Where a criterion's score sits between its minimum and maximum, for a
 * meter, or null when the criterion has no usable score. The minimum is 0
 * when omitted.
 * @param {{ score?: number, minScore?: number, maxScore?: number }} criterion
 * @returns {{ score: number, min: number, max: number, fraction: number }|null}
 */
export function criterionMeter(criterion) {
  const score = finiteOrNull(criterion?.score);
  const max = finiteOrNull(criterion?.maxScore);
  const min = criterion?.minScore === undefined ? 0 : finiteOrNull(criterion.minScore);

  if (score === null || max === null || min === null || max <= min || score < min || score > max) {
    return null;
  }

  return { score, min, max, fraction: (score - min) / (max - min) };
}

function normalizeCriterion(item) {
  if (!isPlainObject(item)) {
    return null;
  }

  const label = textOrNull(item.label);
  const value = textOrNull(item.value);
  if (!label || !value) {
    return null;
  }

  return {
    key: textOrNull(item.key),
    label,
    value,
    meter: criterionMeter(item),
    description: textOrNull(item.description)
  };
}

function normalizeComparisonItem(item) {
  if (!isPlainObject(item)) {
    return null;
  }

  const label = textOrNull(item.label);
  const before = textOrNull(item.before);
  const after = textOrNull(item.after);
  if (!label || !before || !after) {
    return null;
  }

  return {
    key: textOrNull(item.key),
    label,
    before,
    after,
    trend: TRENDS.has(item.trend) ? item.trend : null
  };
}

function normalizeItems(items, normalizeItem) {
  return Array.isArray(items) ? items.map(normalizeItem).filter(Boolean) : [];
}

const SECTION_NORMALIZERS = {
  criteria: (section) => {
    const items = normalizeItems(section.items, normalizeCriterion);
    return items.length > 0 ? { items } : null;
  },
  bullets: (section) => {
    const items = normalizeItems(section.items, textOrNull);
    return items.length > 0 ? { items } : null;
  },
  text: (section) => {
    const text = textOrNull(section.text);
    return text ? { text } : null;
  },
  comparison: (section) => {
    const items = normalizeItems(section.items, normalizeComparisonItem);
    return items.length > 0 ? { items } : null;
  }
};

/**
 * A section the renderer can show, or null for a section of an unknown kind
 * or one with nothing to show.
 * @param {unknown} section
 * @returns {object|null}
 */
export function normalizeStudentResultSection(section) {
  if (!isPlainObject(section) || !Object.hasOwn(SECTION_NORMALIZERS, section.kind)) {
    return null;
  }

  const fields = SECTION_NORMALIZERS[section.kind](section);
  return fields ? { kind: section.kind, title: textOrNull(section.title), ...fields } : null;
}

/**
 * The document the renderer shows, or null when `payload` is not a
 * student-result/v1 document with a title.
 * - `lang` is the document's locale for the HTML `lang` attribute, or null.
 * - `status` is complete, partial or unavailable; complete when omitted.
 * - `sections` keeps the known sections in order.
 * @param {unknown} payload
 * @returns {{
 *   lang: string|null, title: string, summary: string|null,
 *   overview: string|null, status: string, sections: object[]
 * }|null}
 */
export function normalizeStudentResultDocument(payload) {
  if (!isPlainObject(payload) || payload.schemaVersion !== STUDENT_RESULT_SCHEMA) {
    return null;
  }

  const title = textOrNull(payload.title);
  if (!title) {
    return null;
  }

  return {
    lang: LOCALES.has(payload.locale) ? payload.locale : null,
    title,
    summary: textOrNull(payload.summary),
    overview: textOrNull(payload.overview),
    status: STATUSES.has(payload.status) ? payload.status : 'complete',
    sections: Array.isArray(payload.sections)
      ? payload.sections.map(normalizeStudentResultSection).filter(Boolean)
      : []
  };
}

/**
 * The i18n key of a document status, or null for a complete document, which
 * shows no status.
 * @param {string} status
 * @returns {string|null}
 */
export function studentResultStatusKey(status) {
  return Object.hasOwn(STATUS_LABEL_KEYS, status) ? STATUS_LABEL_KEYS[status] : null;
}

/**
 * The i18n key of a comparison trend, or null when the item has none.
 * @param {string|null} trend
 * @returns {string|null}
 */
export function comparisonTrendKey(trend) {
  return Object.hasOwn(TREND_LABEL_KEYS, trend) ? TREND_LABEL_KEYS[trend] : null;
}
