import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { errorClassification } from "./external-service-handler-run.js";

/**
 * Validation of the documents AI services publish to students (epic #1124,
 * #1131). A document reaches a student only when it validates against
 * EthicApp's verbatim copy of its schema (`canonical-schemas/ai-additions/`)
 * and the service declared that schema, in its capability descriptor's
 * `student_outputs`, for the scope it is published in.
 *
 * The schema copy is the source of truth: it is read from that folder and
 * compiled with `@cfworker/json-schema`, the validator `npm run test:schemas`
 * uses on the same files. The two integrity rules that JSON Schema cannot
 * express are checked here as in ethicapp-ai-additions'
 * `ethicapp_ai_capabilities.validate_student_result()`, with the same codes,
 * so both sides refuse the same documents.
 *
 * Problems are `{ code, path }` (plus `keyword` for a schema violation).
 * Paths use the Python validator's notation (`sections[0].items[1].key`,
 * `<root>` for the document itself). No problem carries a value from the
 * document, so problems can be logged.
 */

export const STUDENT_RESULT_DOCUMENT_SCHEMA = "student-result/v1";

// The scope of the results publishStudentResult() emits, and the one the
// student-results-reading hook rebuilds: a result for one student, about the
// response the student submitted. A document shown in a group chat would be
// published in the `chat` scope by a chat publisher, which does not exist yet.
export const STUDENT_RESULT_SCOPE = "response";

export const ROOT_PATH = "<root>";

export const DOCUMENT_PROBLEM_CODES = Object.freeze({
    UNKNOWN_DOCUMENT_SCHEMA:    "unknown_document_schema",
    SCHEMA_UNAVAILABLE:         "schema_unavailable",
    SCHEMA_VIOLATION:           "schema_violation",
    DUPLICATE_CRITERION_KEY:    "duplicate_criterion_key",
    SCORE_OUT_OF_RANGE:         "score_out_of_range",
    DECLARATION_UNAVAILABLE:    "declaration_unavailable",
    UNDECLARED_DOCUMENT_SCHEMA: "undeclared_document_schema",
});

// What a declaration lookup found (see checkStudentResultDocument()).
export const DECLARATION_STATUS = Object.freeze({
    // The service's student outputs are known.
    KNOWN:         "known",
    // The service links no capability descriptor and, for a development
    // adapter, its catalog entry declares no `studentOutputs` (#1134), so it
    // declares nothing.
    NO_DESCRIPTOR: "no_descriptor",
    // The service links one, but no descriptor of it has been fetched.
    UNAVAILABLE:   "unavailable",
});

// A document schema name, `<name>/v<major>`.
const DOCUMENT_SCHEMA_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/v[1-9][0-9]*$/u;

// Validator errors on these keywords only wrap the errors of a subschema,
// which are reported on their own.
const WRAPPER_KEYWORDS = new Set([
    "$ref", "allOf", "anyOf", "oneOf", "if", "then", "else",
    "properties", "patternProperties", "additionalProperties", "items",
    "prefixItems", "contains", "dependentSchemas", "propertyNames",
    "unevaluatedProperties", "unevaluatedItems",
]);

// At most this many schema violations are kept per document.
const MAX_SCHEMA_PROBLEMS = 10;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

/**
 * The JSON form of `value`, as the student receives it: `{ ok: true, value }`,
 * or `{ ok: false }` when it has none (undefined, a BigInt, a cycle).
 */
export function jsonData(value) {
    try {
        const text = JSON.stringify(value);
        return text === undefined ? { ok: false } : { ok: true, value: JSON.parse(text) };
    } catch {
        return { ok: false };
    }
}

function rootProblem(code) {
    return { code, path: ROOT_PATH };
}

function schemaCopyUrl(fileName) {
    return new URL(`../../../canonical-schemas/ai-additions/${fileName}`, import.meta.url);
}

// student-result/v1 integrity rules (`_integrity_problems` in
// ethicapp_ai_capabilities/student_result.py): criterion keys are unique
// within a criteria section, and a criterion with `maxScore` has
// `minScore` (0 when omitted) < `maxScore` and `minScore <= score <= maxScore`.
export function studentResultIntegrityProblems(document) {
    const problems = [];
    const sections = isPlainObject(document) ? document.sections : null;
    if (!Array.isArray(sections)) {
        return problems;
    }

    sections.forEach((section, i) => {
        if (!isPlainObject(section) || section.kind !== "criteria"
            || !Array.isArray(section.items)) {
            return;
        }
        const seen = new Set();
        section.items.forEach((item, j) => {
            if (!isPlainObject(item)) {
                return;
            }
            const base = `sections[${i}].items[${j}]`;
            if (typeof item.key === "string") {
                if (seen.has(item.key)) {
                    problems.push({
                        code: DOCUMENT_PROBLEM_CODES.DUPLICATE_CRITERION_KEY,
                        path: `${base}.key`,
                    });
                }
                seen.add(item.key);
            }
            problems.push(...scoreProblems(base, item));
        });
    });
    return problems;
}

function scoreProblems(base, item) {
    const maximum = item.maxScore;
    if (!isNumber(maximum)) {
        return [];
    }
    const minimum = Object.hasOwn(item, "minScore") ? item.minScore : 0;
    if (!isNumber(minimum)) {
        return [];
    }
    if (minimum >= maximum) {
        return [{ code: DOCUMENT_PROBLEM_CODES.SCORE_OUT_OF_RANGE, path: `${base}.maxScore` }];
    }
    if (isNumber(item.score) && (item.score < minimum || item.score > maximum)) {
        return [{ code: DOCUMENT_PROBLEM_CODES.SCORE_OUT_OF_RANGE, path: `${base}.score` }];
    }
    return [];
}

// The document schemas EthicApp validates, with the file of their copy and
// their integrity rules. A schema copied into canonical-schemas/ai-additions/
// is added here (EXTERNAL.md, "Adding a specialized renderer").
const DOCUMENT_SCHEMAS = new Map([
    [STUDENT_RESULT_DOCUMENT_SCHEMA, {
        fileName:          "student-result.v1.schema.json",
        integrityProblems: studentResultIntegrityProblems,
    }],
]);

export function knownDocumentSchemas() {
    return [...DOCUMENT_SCHEMAS.keys()];
}

/**
 * `value` when it is a document schema name, which may be logged; null for
 * anything else, which may not.
 */
export function loggableDocumentSchema(value) {
    return typeof value === "string" && value.length <= 64 && DOCUMENT_SCHEMA_PATTERN.test(value)
        ? value
        : null;
}

// `#/sections/0/items/1/key` -> `sections[0].items[1].key`.
function pathOf(instanceLocation) {
    const segments = String(instanceLocation || "#").replace(/^#\/?/u, "")
        .split("/")
        .filter(segment => segment !== "")
        .map(segment => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));
    if (segments.length === 0) {
        return ROOT_PATH;
    }
    return segments.reduce((path, segment) => (/^\d+$/u.test(segment)
        ? `${path}[${segment}]`
        : path ? `${path}.${segment}` : segment), "");
}

function isAtOrBelow(path, ancestor) {
    return path === ancestor || path.startsWith(`${ancestor}.`) || path.startsWith(`${ancestor}[`);
}

// The leaf errors of a validation, without repeats. The validator's messages
// are not kept: some quote the document.
function schemaProblems(errors) {
    const leaves = [];
    const seen = new Set();
    for (const error of errors) {
        if (WRAPPER_KEYWORDS.has(error.keyword)) {
            continue;
        }
        // A `false` subschema is a key that the schema does not allow.
        const keyword = error.keyword === "false" ? "not_allowed" : error.keyword;
        const path = pathOf(error.instanceLocation);
        const id = `${keyword}\u0000${path}`;
        if (!seen.has(id)) {
            seen.add(id);
            leaves.push({ code: DOCUMENT_PROBLEM_CODES.SCHEMA_VIOLATION, keyword, path });
        }
    }

    // The validator also reports a defined key whose value is invalid as not
    // allowed by `additionalProperties: false`; its own errors say more.
    const problems = leaves.filter(problem => problem.keyword !== "not_allowed"
        || !leaves.some(other => other !== problem && other.keyword !== "not_allowed"
            && isAtOrBelow(other.path, problem.path)));

    // A failed validation always yields one problem at least.
    return problems.length > 0
        ? problems.slice(0, MAX_SCHEMA_PROBLEMS)
        : [{ code: DOCUMENT_PROBLEM_CODES.SCHEMA_VIOLATION, keyword: "invalid", path: ROOT_PATH }];
}

/**
 * Creates a document validator. The schema copies are read and compiled on
 * first use and kept for the life of the process. A copy that cannot be read
 * is logged once, and every document of its schema is refused with
 * `schema_unavailable`: without the copy nothing is known to be safe.
 *
 * @param {Object} [options]
 * @param {(fileName: string) => unknown} [options.readSchema] - Reads and
 *     parses a copy by its file name; replaced in tests.
 * @param {{ error: Function }} [options.logger]
 * @returns {(documentSchema: string, document: unknown) =>
 *     { valid: boolean, problems: Object[] }}
 */
export function createDocumentValidator({
    readSchema = fileName => JSON.parse(readFileSync(schemaCopyUrl(fileName), "utf8")),
    logger = console,
} = {}) {
    const compiled = new Map();

    function validatorOf(documentSchema, definition) {
        if (!compiled.has(documentSchema)) {
            try {
                const schema = readSchema(definition.fileName);
                compiled.set(documentSchema, new Validator(schema, "2020-12", false));
            } catch (error) {
                logger.error(
                    "[external-services] Cannot load the copy of a student result schema; "
                    + "its documents are refused.",
                    JSON.stringify({ documentSchema, ...errorClassification(error) })
                );
                compiled.set(documentSchema, null);
            }
        }
        return compiled.get(documentSchema);
    }

    return function validateDocument(documentSchema, document) {
        const definition = typeof documentSchema === "string"
            ? DOCUMENT_SCHEMAS.get(documentSchema)
            : null;
        if (!definition) {
            return {
                valid:    false,
                problems: [rootProblem(DOCUMENT_PROBLEM_CODES.UNKNOWN_DOCUMENT_SCHEMA)],
            };
        }

        const validator = validatorOf(documentSchema, definition);
        if (!validator) {
            return {
                valid:    false,
                problems: [rootProblem(DOCUMENT_PROBLEM_CODES.SCHEMA_UNAVAILABLE)],
            };
        }

        // The document reaches the student as JSON (a socket event or the
        // student route), so its JSON form is what is checked: a key set to
        // `undefined` is left out, as it is when sent.
        const data = jsonData(document);
        let result;
        try {
            result = data.ok ? validator.validate(data.value) : null;
        } catch {
            result = null;
        }
        if (!result) {
            return {
                valid:    false,
                problems: [{
                    code:    DOCUMENT_PROBLEM_CODES.SCHEMA_VIOLATION,
                    keyword: "not_json",
                    path:    ROOT_PATH,
                }],
            };
        }

        const problems = [
            ...(result.valid ? [] : schemaProblems(result.errors)),
            ...definition.integrityProblems(data.value),
        ];
        return { valid: problems.length === 0, problems };
    };
}

/**
 * Whether `studentOutputs` (normalized by the descriptor service) declare
 * `documentSchema` for `scope`.
 */
export function declaresDocumentSchema(studentOutputs, documentSchema, scope) {
    return Array.isArray(studentOutputs) && studentOutputs.some(output =>
        output.documentSchema === documentSchema && output.scopes.includes(scope));
}

/**
 * Checks a document a service publishes, or that its adapter rebuilt, for
 * one student: against its schema copy and against the service's
 * declaration. Every problem is reported, so one log line says all that is
 * wrong.
 *
 * @param {Object} options
 * @param {unknown} options.documentSchema
 * @param {unknown} options.document
 * @param {string} options.scope - STUDENT_RESULT_SCOPE for student results.
 * @param {{ status: string, studentOutputs?: Object[] }} options.declaration
 *     - What the declaration lookup found (DECLARATION_STATUS).
 * @param {Function} options.validateDocument - From createDocumentValidator().
 * @returns {{ ok: boolean, problems: Object[] }}
 */
export function checkStudentResultDocument({
    documentSchema, document, scope, declaration, validateDocument,
}) {
    const problems = [];

    if (declaration?.status === DECLARATION_STATUS.KNOWN) {
        if (!declaresDocumentSchema(declaration.studentOutputs, documentSchema, scope)) {
            problems.push(rootProblem(DOCUMENT_PROBLEM_CODES.UNDECLARED_DOCUMENT_SCHEMA));
        }
    } else if (declaration?.status === DECLARATION_STATUS.NO_DESCRIPTOR) {
        problems.push(rootProblem(DOCUMENT_PROBLEM_CODES.UNDECLARED_DOCUMENT_SCHEMA));
    } else {
        problems.push(rootProblem(DOCUMENT_PROBLEM_CODES.DECLARATION_UNAVAILABLE));
    }

    problems.push(...validateDocument(documentSchema, document).problems);
    return { ok: problems.length === 0, problems };
}

const defaultValidator = createDocumentValidator();

/** The process-wide validator, reading the copies in canonical-schemas/ai-additions/. */
export function validateStudentResultDocument(documentSchema, document) {
    return defaultValidator(documentSchema, document);
}
