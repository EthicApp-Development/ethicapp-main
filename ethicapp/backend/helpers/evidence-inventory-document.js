/**
 * Pure helpers for case evidence inventory documents (evidence-inventory/v1).
 *
 * The JSON Schema that defines the document is owned by the Argumentation
 * Tutor in ethicapp-ai-additions
 * (argumentation-tutor/backend/modules/evidence_inventory/schemas/). This
 * module enforces the same shape and limits before EthicApp stores a generated
 * draft or a teacher-reviewed inventory.
 *
 * normalizeQuoteText() mirrors normalize_for_quote_match() in the tutor's
 * postprocess.py. Keep both implementations and their test cases in sync.
 */

export const INVENTORY_SCHEMA_VERSION = "evidence-inventory/v1";
export const INVENTORY_KIND = "case_evidence_inventory";
export const DEFAULT_INVENTORY_LANGUAGE = "es_CL";
export const MAX_FACTS = 60;
export const MAX_EXCLUSIONS = 25;

const FIELD_LIMITS = {
    group:        80,
    label:        120,
    statement:    600,
    sourceQuote:  600,
    countingNote: 400,
    reason:       400,
};
const DEFAULT_GROUP = "General";
const FACT_ID_PATTERN = /^EV([1-9][0-9]*)$/u;
const EXCLUSION_ID_PATTERN = /^EX([1-9][0-9]*)$/u;
const LANGUAGE_PATTERN = /^[a-z]{2}([_-][A-Z]{2})?$/u;

// pdftotext -layout keeps the line numbers printed in many case PDFs: a number
// at the start of a line followed by two or more spaces, a tab or the end of
// the line ("6    amigo, para decirme..."). A number followed by a single space
// ("15 de marzo") is case text and is kept.
const LINE_NUMBER_PATTERN = /^[ \t]*\d{1,4}(?=[ \t]{2,}|\t|$)/gmu;
// A hyphen at the end of a line may split a word ("ense-\nñanza") or be a dash
// ("las recaídas-\nfue"). Removing every hyphen with its surrounding whitespace,
// in the text and in the quote alike, matches both readings.
const HYPHEN_PATTERN = /\s*-\s*/gu;
const WHITESPACE_PATTERN = /\s+/gu;
// Marks page breaks (form feeds) in the paged normalization of the case text.
// It is a private-use character: it is not whitespace and never occurs in quotes.
const PAGE_BREAK_MARKER = "";
// A quoted sentence may continue on the next page after footnotes or a page
// header. Such a quote is accepted when it splits into two parts of at least
// MIN_SPLIT_PART_CHARS that appear in order, at most MAX_INTERRUPTION_CHARS
// apart, with a page break in the skipped text. Text skipped within a page is
// never accepted, so a quote that omits a word (for example "no") is not
// reported as found.
const MIN_SPLIT_PART_CHARS = 12;
const MAX_INTERRUPTION_CHARS = 2500;
const TYPOGRAPHIC_REPLACEMENTS = [
    [/[“”„«»]/gu, "\""],
    [/[‘’‚]/gu, "'"],
    [/[–—]/gu, "-"],
];

export class EvidenceInventoryValidationError extends Error {
    constructor(details) {
        super(`Invalid evidence inventory: ${details.join("; ")}`);
        this.name = "EvidenceInventoryValidationError";
        this.details = details;
    }
}

/**
 * Normalizes case text or a quote so a literal quote can be found by substring
 * despite PDF extraction artifacts (printed line numbers, page breaks,
 * hyphens, typographic quotes).
 */
export function normalizeQuoteText(text, { keepPageBreaks = false } = {}) {
    if (typeof text !== "string" || text.length === 0) {
        return "";
    }

    let value = text.normalize("NFC")
        .replace(/\r\n?/gu, "\n")
        .replace(/\f/gu, keepPageBreaks ? `\n${PAGE_BREAK_MARKER}\n` : "\n")
        .replace(LINE_NUMBER_PATTERN, "");

    for (const [pattern, replacement] of TYPOGRAPHIC_REPLACEMENTS) {
        value = value.replace(pattern, replacement);
    }

    return value
        .replace(HYPHEN_PATTERN, "")
        .replace(WHITESPACE_PATTERN, " ")
        .trim()
        .toLowerCase();
}

/**
 * Normalizes the case text once for quote checks, without and with page-break
 * marks.
 */
export function prepareCaseText(text) {
    return {
        plain: normalizeQuoteText(text),
        paged: normalizeQuoteText(text, { keepPageBreaks: true }),
    };
}

function isFoundAcrossPageBreak(quote, pagedText) {
    for (let splitAt = 0; splitAt < quote.length; splitAt += 1) {
        if (quote[splitAt] !== " ") {
            continue;
        }
        const head = quote.slice(0, splitAt);
        const tail = quote.slice(splitAt + 1);
        if (head.length < MIN_SPLIT_PART_CHARS) {
            continue;
        }
        if (tail.length < MIN_SPLIT_PART_CHARS) {
            break;
        }

        let headAt = pagedText.indexOf(head);
        if (headAt === -1) {
            // Longer heads start with this one, so they cannot appear either.
            break;
        }
        while (headAt !== -1) {
            const headEnd = headAt + head.length;
            const window = pagedText.slice(headEnd, headEnd + MAX_INTERRUPTION_CHARS + tail.length);
            let tailAt = window.indexOf(tail);
            while (tailAt !== -1) {
                if (window.slice(0, tailAt).includes(PAGE_BREAK_MARKER)) {
                    return true;
                }
                tailAt = window.indexOf(tail, tailAt + 1);
            }
            headAt = pagedText.indexOf(head, headAt + 1);
        }
    }
    return false;
}

/**
 * Whether a quote occurs in a case text prepared with prepareCaseText().
 */
export function isQuoteFound(quote, preparedCaseText) {
    const normalizedQuote = normalizeQuoteText(quote);
    if (normalizedQuote.length === 0) {
        return false;
    }

    return preparedCaseText.plain.includes(normalizedQuote)
        || isFoundAcrossPageBreak(normalizedQuote, preparedCaseText.paged);
}

function cleanText(value) {
    return typeof value === "string" ? value.replace(WHITESPACE_PATTERN, " ").trim() : "";
}

function defaultLabel(statement) {
    return statement.slice(0, FIELD_LIMITS.label);
}

function readField(item, field, path, errors, { required = false } = {}) {
    const value = cleanText(item[field]);

    if (required && !value) {
        errors.push(`${path}.${field} is required`);
    }
    if (value.length > FIELD_LIMITS[field]) {
        errors.push(`${path}.${field} must have at most ${FIELD_LIMITS[field]} characters`);
    }

    return value;
}

/**
 * Keeps valid, unique ids and gives the remaining items the next free number,
 * so ids already cited by the tutor stay stable when a teacher edits the list.
 */
function assignIds(items, pattern, prefix) {
    let maxNumber = 0;
    for (const item of items) {
        const match = pattern.exec(item.id);
        if (match) {
            maxNumber = Math.max(maxNumber, Number(match[1]));
        }
    }

    const usedIds = new Set();
    return items.map(item => {
        let id = item.id;
        if (!pattern.test(id) || usedIds.has(id)) {
            maxNumber += 1;
            id = `${prefix}${maxNumber}`;
        }
        usedIds.add(id);
        return { ...item, id };
    });
}

function normalizeGeneration(generation) {
    if (!generation || typeof generation !== "object") {
        return null;
    }

    const model = cleanText(generation.model);
    const promptVersion = cleanText(generation.promptVersion);
    const generatedAt = cleanText(generation.generatedAt);
    if (!model || !promptVersion || Number.isNaN(Date.parse(generatedAt))) {
        return null;
    }

    return { model, promptVersion, generatedAt };
}

/**
 * Validates and normalizes an evidence-inventory/v1 document.
 *
 * @param {Object} raw - Inventory document from the AI service or the teacher UI.
 * @param {Object} [options]
 * @param {string|null} [options.caseText] - When given, sourceQuoteFound is
 *   recomputed against this text (teacher edits). Otherwise the provided flag
 *   is kept (generated drafts, already checked by the service).
 * @param {string} [options.language] - Fallback language code.
 * @returns {Object} Normalized inventory.
 * @throws {EvidenceInventoryValidationError} When the document is invalid.
 */
export function normalizeEvidenceInventory(raw, {
    caseText = null,
    language = DEFAULT_INVENTORY_LANGUAGE,
} = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new EvidenceInventoryValidationError(["inventory must be an object"]);
    }

    const errors = [];
    const rawFacts = Array.isArray(raw.facts) ? raw.facts : null;
    const rawExclusions = Array.isArray(raw.exclusions) ? raw.exclusions : null;

    if (!rawFacts) {
        errors.push("facts must be an array");
    } else if (rawFacts.length > MAX_FACTS) {
        errors.push(`facts must have at most ${MAX_FACTS} items`);
    }
    if (!rawExclusions) {
        errors.push("exclusions must be an array");
    } else if (rawExclusions.length > MAX_EXCLUSIONS) {
        errors.push(`exclusions must have at most ${MAX_EXCLUSIONS} items`);
    }
    if (errors.length > 0) {
        throw new EvidenceInventoryValidationError(errors);
    }

    const preparedCaseText = typeof caseText === "string" ? prepareCaseText(caseText) : null;

    const facts = rawFacts.map((item, index) => {
        const fact = item && typeof item === "object" ? item : {};
        const path = `facts[${index}]`;
        const statement = readField(fact, "statement", path, errors, { required: true });
        const sourceQuote = readField(fact, "sourceQuote", path, errors) || null;

        return {
            id:               cleanText(fact.id),
            group:            readField(fact, "group", path, errors) || DEFAULT_GROUP,
            label:            readField(fact, "label", path, errors) || defaultLabel(statement),
            statement,
            sourceQuote,
            sourceQuoteFound: preparedCaseText === null
                ? sourceQuote !== null && fact.sourceQuoteFound === true
                : isQuoteFound(sourceQuote, preparedCaseText),
            countingNote: readField(fact, "countingNote", path, errors) || null,
        };
    });

    const exclusions = rawExclusions.map((item, index) => {
        const exclusion = item && typeof item === "object" ? item : {};
        const path = `exclusions[${index}]`;
        const statement = readField(exclusion, "statement", path, errors, { required: true });

        return {
            id:     cleanText(exclusion.id),
            label:  readField(exclusion, "label", path, errors) || defaultLabel(statement),
            statement,
            reason: readField(exclusion, "reason", path, errors) || null,
        };
    });

    if (errors.length > 0) {
        throw new EvidenceInventoryValidationError(errors);
    }

    const inventory = {
        schemaVersion: INVENTORY_SCHEMA_VERSION,
        kind:          INVENTORY_KIND,
        language:      LANGUAGE_PATTERN.test(raw.language) ? raw.language : language,
        facts:         assignIds(facts, FACT_ID_PATTERN, "EV"),
        exclusions:    assignIds(exclusions, EXCLUSION_ID_PATTERN, "EX"),
    };

    const generation = normalizeGeneration(raw.generation);
    if (generation) {
        inventory.generation = generation;
    }

    return inventory;
}
