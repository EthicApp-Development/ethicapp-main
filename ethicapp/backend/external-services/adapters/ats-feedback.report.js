import {
    MAX_CONTRIBUTION_STRING_LENGTH,
} from "../../services/external-service-report-contributions.js";
import {
    argumentEvaluationOf,
    currentEvaluation,
    EVALUATION_CRITERION_KEYS,
    scaleText,
} from "./ats-feedback.evaluation.js";
import {
    claimTypeFromExternalResult,
    tutorEvaluationFromExternalResult,
} from "./ats-feedback.utils.js";

/**
 * The argumentation tutor's contribution to the responses report (epic #620,
 * #948): one set of `ats_` columns on each response row the tutor reviewed.
 *
 * A row's feedback is the tutor's callback for the response's
 * `student-response-submitted` job, as stored in `raw_payload`. The student's
 * argument (`argumentPreview`, the `comparison` texts) is never exported: the
 * report's own `comment` column already holds the response.
 *
 * Which results reach a row:
 * - only `completed` and `callback-received` results of
 *   `student-response-submitted` jobs; `failed` ones were refused or not
 *   processed, and their payload is not trusted;
 * - a result whose job recorded a source (#946) goes to the row of that
 *   response, and is ignored when the response is not in the report or
 *   belongs to another user;
 * - a result without a source (a job created before V38) goes to the row with
 *   the same phase, question and user, only when exactly one row has them;
 *   otherwise it is left out;
 * - when several results reach one row (a first analysis, then comparisons),
 *   the row shows the latest by `receivedAt`, whole, and `ats_feedback_count`
 *   says how many there were. Fields the latest evaluation does not report
 *   (a comparison reports no claim type or tutor mode) are empty.
 *
 * Results of a forgotten user are redacted as stored (V31) and shown as such.
 *
 * Two rubrics (#1214). A v12 result fills the `ats_claim` ... `ats_qualifier`
 * scores, as before. A v19 result (`argumentEvaluation`, epic
 * ethicapp-ai-additions#267) fills the `ats_*_level` columns instead, each
 * with its scale as the result gives it (`ats_*_scale`, such as `0-2`), plus
 * `ats_rubric`, `ats_rubric_version`, the claim type's stance, the facts and
 * exclusions the evidence used and, for a comparison, the level changes. The
 * v19 columns are left out of a v12 row, so a v12 row's values are the ones
 * it had before #1214.
 */

const RESPONSE_HOOK = "student-response-submitted";
const REPORTED_STATUSES = new Set(["completed", "callback-received"]);

// The tutor's v12 criteria (ethicapp-ai-additions, ethicapp_callback.py):
// the claim's position (-1, 0 or 1) and the other elements on a 1-3 scale.
const CRITERION_KEYS = Object.freeze(["claim", "evidence", "warrant", "qualifier"]);

// The columns of the v19 rubric (#1214), filled only by v19 results.
const RUBRIC_COLUMNS = Object.freeze([
    { id: "ats_rubric", label: "Tutor rubric (v12 or v19)" },
    { id: "ats_rubric_version", label: "Rubric version of the tutor levels (v19)" },
    ...EVALUATION_CRITERION_KEYS.flatMap(key => [
        { id: `ats_${key}_level`, label: `Tutor level (v19): ${key}` },
        { id: `ats_${key}_scale`, label: `Tutor level scale (v19): ${key}` },
    ]),
    { id: "ats_claim_stance", label: "Stance of the claim type (v19)" },
    { id: "ats_evidence_facts", label: "Case facts the argument states (v19)" },
    { id: "ats_evidence_exclusions", label: "Statements the case does not make (v19)" },
    { id: "ats_entry_rule_applied", label: "Entry rule applied (v19)" },
    ...EVALUATION_CRITERION_KEYS.map(key => ({
        id:    `ats_${key}_level_change`,
        label: `Level change from the previous argument (v19): ${key}`,
    })),
]);

export const ATS_REPORT_COLUMNS = Object.freeze([
    { id: "ats_mode", label: "Tutor evaluation (analysis or comparison)" },
    { id: "ats_tutor_mode", label: "Tutor mode (enhanced or basic)" },
    { id: "ats_requested_mode", label: "Tutor mode requested by the phase" },
    { id: "ats_feedback_title", label: "Tutor feedback title" },
    { id: "ats_feedback_summary", label: "Tutor feedback summary" },
    { id: "ats_feedback_bullets", label: "Tutor feedback points" },
    ...CRITERION_KEYS.map(key => ({ id: `ats_${key}`, label: `Tutor score: ${key}` })),
    ...RUBRIC_COLUMNS,
    { id: "ats_claim_type", label: "Claim type matched by the tutor" },
    { id: "ats_unsupported_claims", label: "Unsupported claims (count)" },
    { id: "ats_feedback_count", label: "Tutor feedback received (count)" },
    { id: "ats_feedback_time", label: "Latest tutor feedback time" },
].map(column => Object.freeze(column)));

function text(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, MAX_CONTRIBUTION_STRING_LENGTH) : null;
}

function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The feedback object of a stored callback payload: its top level, as the
// tutor sends it, or a nested feedback object (as the student overlay reads
// it, buildFeedbackPayloadFromExternalResult()).
function feedbackSource(rawPayload) {
    const root = isPlainObject(rawPayload) ? rawPayload : {};
    if (isPlainObject(root.payload?.feedback)) {
        return root.payload.feedback;
    }
    return isPlainObject(root.payload) ? root.payload : root;
}

function criterionScores(criteria) {
    const scores = Object.fromEntries(CRITERION_KEYS.map(key => [`ats_${key}`, null]));
    if (!Array.isArray(criteria)) {
        return scores;
    }
    for (const criterion of criteria) {
        const key = typeof criterion?.key === "string" ? criterion.key.trim().toLowerCase() : "";
        const column = `ats_${key}`;
        if (CRITERION_KEYS.includes(key) && scores[column] === null) {
            scores[column] = finiteNumber(criterion.score);
        }
    }
    return scores;
}

function bulletsText(bullets) {
    if (!Array.isArray(bullets)) {
        return null;
    }
    return text(bullets.map(text).filter(Boolean).join("\n"));
}

function idsText(ids) {
    return Array.isArray(ids) && ids.length > 0 ? text(ids.join(", ")) : null;
}

// The v19 columns of a result with an `argumentEvaluation` (#1214), or {}.
function rubricColumnValues(rawPayload) {
    const read = argumentEvaluationOf(rawPayload);
    if (!read) {
        return {};
    }
    const evaluation = currentEvaluation(read);
    const criteria = evaluation?.criteria ?? {};
    const values = {
        ats_rubric:         read.rubric,
        ats_rubric_version: evaluation?.rubricVersion ?? null,
    };
    for (const key of EVALUATION_CRITERION_KEYS) {
        values[`ats_${key}_level`] = criteria[key]?.level ?? null;
        values[`ats_${key}_scale`] = scaleText(criteria[key] ?? null);
    }
    Object.assign(values, {
        ats_claim_stance:        criteria.claim?.stance ?? null,
        ats_evidence_facts:      idsText(criteria.evidence?.factIds),
        ats_evidence_exclusions: idsText(criteria.evidence?.exclusionIds),
        ats_entry_rule_applied:  evaluation?.entryRuleApplied ?? null,
    });
    for (const key of EVALUATION_CRITERION_KEYS) {
        values[`ats_${key}_level_change`] = read.differences?.[key]?.levelChange ?? null;
    }
    return values;
}

/**
 * The report values of one stored tutor result, without the count and time.
 * Missing or malformed fields are null; nothing quotes the student's
 * argument. The v19 columns are present only for a v19 result.
 */
export function feedbackColumnValues(rawPayload) {
    const feedback = feedbackSource(rawPayload);
    const evaluation = tutorEvaluationFromExternalResult(rawPayload);
    const claimType = claimTypeFromExternalResult(rawPayload);
    const rubricValues = rubricColumnValues(rawPayload);
    const mode = text(feedback.mode) ?? argumentEvaluationOf(rawPayload)?.kind ?? null;

    return {
        ats_mode:               mode === "analysis" || mode === "comparison" ? mode : null,
        ats_tutor_mode:         evaluation?.tutorMode ?? null,
        ats_requested_mode:     evaluation?.requestedMode ?? null,
        ats_feedback_title:     text(feedback.title),
        ats_feedback_summary:   text(feedback.summary),
        ats_feedback_bullets:   bulletsText(feedback.bullets),
        ...criterionScores(feedback.criteria),
        ...rubricValues,
        ats_claim_type:         claimType?.claimTypeId ?? null,
        ats_unsupported_claims: Array.isArray(evaluation?.unsupportedClaims)
            ? evaluation.unsupportedClaims.length
            : null,
    };
}

function legacyRowKey(phaseId, questionId, userId) {
    return `${phaseId}:${questionId}:${userId}`;
}

// The report row each result belongs to, by response id; see the module
// comment for the rule.
function rowsByResult(rows) {
    const byResponseId = new Map();
    const byLegacyKey = new Map();
    for (const row of rows) {
        byResponseId.set(Number(row.responseId), row);
        if (row.phaseId && row.questionId && row.userId) {
            const key = legacyRowKey(row.phaseId, row.questionId, row.userId);
            // null marks an ambiguous key: several rows share it.
            byLegacyKey.set(key, byLegacyKey.has(key) ? null : row);
        }
    }

    return result => {
        if (result.source) {
            if (result.source.kind !== "response") {
                return null;
            }
            const row = byResponseId.get(Number(result.source.id)) ?? null;
            const otherUser = row && result.userId !== null && row.userId !== null
                && Number(result.userId) !== Number(row.userId);
            return otherUser ? null : row;
        }
        if (!result.phaseId || !result.questionId || !result.userId) {
            return null;
        }
        const key = legacyRowKey(result.phaseId, result.questionId, result.userId);
        return byLegacyKey.get(key) ?? null;
    };
}

function receivedTime(result) {
    const time = Date.parse(result.receivedAt ?? "");
    return Number.isNaN(time) ? -Infinity : time;
}

/**
 * The `report-building` handler. Contributes only to the responses report;
 * the chat transcript gets nothing.
 */
export async function buildReportContribution(context, { results }) {
    if (context.reportType !== "responses") {
        return null;
    }

    const stored = await results.list({ hookName: RESPONSE_HOOK });
    const rowOf = rowsByResult(context.rows);

    const byRow = new Map();
    for (const result of stored) {
        if (!REPORTED_STATUSES.has(result.status)) {
            continue;
        }
        const row = rowOf(result);
        if (!row) {
            continue;
        }
        const entry = byRow.get(row.responseId)
            ?? { rowKey: row.responseId, count: 0, latest: null };
        entry.count += 1;
        // The reader lists oldest first; ties keep the later-listed result.
        if (!entry.latest || receivedTime(result) >= receivedTime(entry.latest)) {
            entry.latest = result;
        }
        byRow.set(row.responseId, entry);
    }

    return {
        columns: ATS_REPORT_COLUMNS.map(column => ({ ...column })),
        values:  [...byRow.values()].map(({ rowKey, count, latest }) => ({
            rowKey,
            values: {
                ...feedbackColumnValues(latest.rawPayload),
                ats_feedback_count: count,
                ats_feedback_time:  latest.receivedAt ?? null,
            },
        })),
    };
}
