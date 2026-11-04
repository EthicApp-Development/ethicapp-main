import { withPlainQuestionText } from "./report-rows.js";

/**
 * Merges what external services contribute (the `report-building` hook,
 * epic #620, #944) into a semantic-differential report (#945).
 *
 * The generator owns the report: its rows, its identity columns and the CSV.
 * A completed contribution adds columns after the report's own, ordered by
 * service in subscription order, with values on the rows it names. The chat
 * transcript also takes rows of a service's own, attributed to it here and
 * placed by time. A contribution that fails, times out or is invalid is left
 * out, and the report is delivered whatever the outcomes.
 */

// The collector's statuses (services/external-service-report-contributions.js).
const COMPLETED = "completed";
const FAILED    = "failed";
const INVALID   = "invalid";

export const CONTRIBUTION_REPORT_TYPES = Object.freeze({
    full_report:     "responses",
    chat_transcript: "chat_transcript",
});

function isoTime(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    return value ?? null;
}

// The row keys a handler receives (see the external-services README,
// "Report building"), from the report's SQL rows.
export function responsesRowKeys(rows) {
    return rows.map(row => ({
        responseId: row.id,
        phaseId:    row.phase_id ?? null,
        questionId: row.question_id ?? null,
        userId:     row.user_id ?? null,
        groupId:    row.team_id ?? null,
    }));
}

export function chatTranscriptRowKeys(rows) {
    return rows.map(row => ({
        messageId:               row.id,
        phaseId:                 row.phase_id ?? null,
        questionId:              row.question_id ?? null,
        groupId:                 row.team_id ?? null,
        userId:                  row.user_id ?? null,
        externalServiceId:       row.external_service_id ?? null,
        externalServiceResultId: row.external_service_result_id ?? null,
        time:                    isoTime(row.time),
    }));
}

// One line of identifiers, in the collector's format; never a value, which
// can quote a student's text.
function logLeftOut(details) {
    console.warn("[external-services] Left out a report contribution.", JSON.stringify(details));
}

/**
 * What a contributed chat row may name: the session's phases, their
 * questions and their groups.
 *
 * @param {Object[]} questionRows - `buildSemanticDifferentialSessionQuestionsSql()` rows.
 * @param {Object[]} groupRows - `buildSessionGroupsSql()` rows.
 */
export function buildSessionChatScope(questionRows, groupRows) {
    const phases = new Map();
    for (const row of questionRows) {
        if (!phases.has(row.phase_id)) {
            phases.set(row.phase_id, {
                phaseNumber: row.phase_number,
                questions:   new Map(),
                groups:      new Set(),
            });
        }
        if (row.question_id !== null && row.question_id !== undefined) {
            phases.get(row.phase_id).questions.set(row.question_id, row);
        }
    }
    for (const row of groupRows) {
        phases.get(row.phase_id)?.groups.add(row.team_id);
    }
    return { phases };
}

// An error's name when it looks like an identifier; its message can quote a
// student's text and is never logged.
function errorNameOf(error) {
    const name = error?.name;
    return typeof name === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name) ? name : null;
}

// Problems name paths only, as the collector's do.
function sessionScopeProblems(rows, scope) {
    const problems = [];
    rows.forEach((row, index) => {
        const label = `rows[${index}]`;
        const phase = scope.phases.get(row.phaseId);
        if (!phase) {
            problems.push(`${label}.phaseId is not a phase of the session`);
            return;
        }
        if (row.questionId !== null && !phase.questions.has(row.questionId)) {
            problems.push(`${label}.questionId is not a question of its phase`);
        }
        if (row.groupId !== null && !phase.groups.has(row.groupId)) {
            problems.push(`${label}.groupId is not a group of its phase`);
        }
    });
    return problems;
}

// A contributed chat row in the transcript's columns. The generator, not the
// service, fills the identity columns: the row is the service's, with no chat
// message, user or gender.
function attributedChatRow(row, { serviceId, agent, scope }) {
    const phase = scope.phases.get(row.phaseId);
    const question = row.questionId === null ? null : phase.questions.get(row.questionId);
    return {
        id:                         null,
        user_id:                    null,
        external_agent_id:          agent?.external_agent_id ?? null,
        team_id:                    row.groupId,
        author_role:                "external_service",
        name:                       agent?.display_name ?? serviceId,
        gender:                     null,
        external_service_id:        serviceId,
        question_number:            question?.question_number ?? null,
        question_text:              question?.question_text ?? null,
        question_text_content_type: question?.question_text_content_type ?? null,
        left_pole:                  question?.left_pole ?? null,
        right_pole:                 question?.right_pole ?? null,
        message:                    row.message,
        phase_number:               phase.phaseNumber,
        time:                       row.time,
        reply_to:                   null,
        phase_id:                   row.phaseId,
        question_id:                row.questionId,
    };
}

// The transcript's order (report-query-builders.js): phase, question, group,
// time, with NULLs last as in PostgreSQL.
const CHAT_ORDER_FIELDS = ["phase_number", "question_number", "team_id", "time"];

function orderValue(row, field) {
    const value = row[field];
    if (value === null || value === undefined) {
        return null;
    }
    return field === "time" ? new Date(value).getTime() : Number(value);
}

function compareChatOrder(left, right) {
    for (const field of CHAT_ORDER_FIELDS) {
        const a = orderValue(left, field);
        const b = orderValue(right, field);
        if (a === b) {
            continue;
        }
        if (a === null) {
            return 1;
        }
        if (b === null) {
            return -1;
        }
        return a < b ? -1 : 1;
    }
    return 0;
}

// The report's rows keep their order; each contributed row goes after every
// report row it does not precede, and contributed rows that tie keep the
// service order.
function mergeByChatOrder(reportRows, contributedRows) {
    const sorted = contributedRows
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => compareChatOrder(a.entry.row, b.entry.row) || a.index - b.index)
        .map(({ entry }) => entry);

    const merged = [];
    let next = 0;
    for (const reportRow of reportRows) {
        while (next < sorted.length && compareChatOrder(sorted[next].row, reportRow.row) < 0) {
            merged.push(sorted[next]);
            next += 1;
        }
        merged.push(reportRow);
    }
    return merged.concat(sorted.slice(next));
}

function contributesRows(outcome) {
    return outcome.status === COMPLETED && outcome.contribution.rows.length > 0;
}

// Leaves out a completed contribution whose rows name a phase, question or
// group outside the session, as the collector leaves out an invalid one.
function checkRowsAgainstSession(outcomes, scope, ids) {
    return outcomes.map(outcome => {
        if (!contributesRows(outcome)) {
            return outcome;
        }
        if (!scope) {
            const reason = "the session could not be read";
            logLeftOut({ ...ids, serviceId: outcome.serviceId, status: FAILED });
            return { serviceId: outcome.serviceId, status: FAILED, reason };
        }
        const problems = sessionScopeProblems(outcome.contribution.rows, scope);
        if (problems.length === 0) {
            return outcome;
        }
        logLeftOut({ ...ids, serviceId: outcome.serviceId, status: INVALID, problems });
        return {
            serviceId: outcome.serviceId,
            status:    INVALID,
            reason:    "the contribution is invalid",
            problems,
        };
    });
}

/**
 * The audit record of each contribution: counts only, never a value.
 *
 * @returns {Array<{ serviceId, status, columns, values, rows, reason?, problems? }>}
 */
export function summarizeContributionOutcomes(outcomes) {
    return outcomes.map(outcome => {
        const contribution = outcome.status === COMPLETED ? outcome.contribution : null;
        const summary = {
            serviceId: outcome.serviceId,
            status:    outcome.status,
            columns:   contribution?.columns.length ?? 0,
            values:    contribution?.values.length ?? 0,
            rows:      contribution?.rows.length ?? 0,
        };
        if (outcome.reason) {
            summary.reason = outcome.reason;
        }
        if (Array.isArray(outcome.problems)) {
            summary.problems = [...outcome.problems];
        }
        return summary;
    });
}

/**
 * Merges completed contributions into a report's rows.
 *
 * @param {Object} options
 * @param {"responses"|"chat_transcript"} options.reportType
 * @param {string[]} options.columns - The report's own columns.
 * @param {Object[]} options.rows - The report's SQL rows, in report order.
 * @param {Object[]} options.outcomes - The collector's outcomes, in service order.
 * @param {Object} [options.scope] - `buildSessionChatScope()`, for contributed rows.
 * @param {Map<string, Object>} [options.agents] - Agent rows by service id.
 * @returns {{ columns: string[], rows: Object[] }} Rows with plain question text.
 */
export function mergeReportContributions({
    reportType,
    columns,
    rows,
    outcomes,
    scope = null,
    agents = new Map(),
}) {
    const completed = outcomes.filter(outcome => outcome.status === COMPLETED);
    const contributedColumns = completed.flatMap(({ contribution }) => contribution.columns
        .map(column => column.id));

    // Each row's contributed values, kept apart from the SQL fields so that a
    // contributed column cannot shadow a field the report reads.
    const reportRows = rows.map(row => ({ row, values: {} }));
    const byKey = new Map(reportRows.map(entry => [String(entry.row.id), entry]));
    for (const { contribution } of completed) {
        for (const { rowKey, values } of contribution.values) {
            // The collector refuses unknown row keys; this guards the merge.
            const entry = byKey.get(String(rowKey));
            if (entry) {
                Object.assign(entry.values, values);
            }
        }
    }

    let merged = reportRows;
    if (reportType === "chat_transcript") {
        const contributedRows = completed.flatMap(({ serviceId, contribution }) => contribution.rows
            .map(row => ({
                row:    attributedChatRow(row, { serviceId, agent: agents.get(serviceId), scope }),
                values: { ...row.values },
            })));
        if (contributedRows.length > 0) {
            merged = mergeByChatOrder(reportRows, contributedRows);
        }
    }

    const plainRows = withPlainQuestionText(merged.map(entry => entry.row));
    return {
        columns: contributedColumns.length > 0 ? [...columns, ...contributedColumns] : columns,
        rows:    plainRows.map((row, index) => {
            const { values } = merged[index];
            if (contributedColumns.length === 0) {
                return row;
            }
            const output = { ...row };
            for (const columnId of contributedColumns) {
                output[columnId] = Object.hasOwn(values, columnId) ? values[columnId] : null;
            }
            return output;
        }),
    };
}

/**
 * Builds a report's columns and rows with the contributions of the services
 * that worked in its session.
 *
 * @param {Object} options
 * @param {"responses"|"chat_transcript"} options.reportType
 * @param {number} options.sessionId
 * @param {string} options.designType
 * @param {string[]} options.columns - The report's own columns.
 * @param {Object[]} options.rows - The report's SQL rows, in report order.
 * @param {Function} options.collect - `(reportType, context, { reservedColumnIds })`,
 *     the registry's collectReportContributions.
 * @param {Function} [options.loadSessionScope] - `(sessionId)` resolving to
 *     `buildSessionChatScope()`; read only when a contribution adds rows.
 * @param {Function} [options.loadServiceAgents] - `(serviceIds)` resolving to
 *     agent rows `{ external_agent_id, service_id, display_name }`.
 * @returns {Promise<{ columns, rows, contributions, collectionFailed }>}
 *     `contributions` is the audit record (summarizeContributionOutcomes()).
 */
export async function buildReportWithContributions({
    reportType,
    sessionId,
    designType,
    columns,
    rows,
    collect,
    loadSessionScope = async () => null,
    loadServiceAgents = async () => [],
}) {
    const ids = { reportType, sessionId };
    const rowKeys = reportType === "chat_transcript"
        ? chatTranscriptRowKeys(rows)
        : responsesRowKeys(rows);

    let outcomes;
    try {
        outcomes = await collect(reportType, { sessionId, designType, rows: rowKeys },
            { reservedColumnIds: columns });
    } catch (error) {
        // The report is delivered without contributions.
        console.warn("[external-services] Could not collect report contributions.",
            JSON.stringify({ ...ids, errorName: errorNameOf(error) }));
        outcomes = null;
    }
    if (!Array.isArray(outcomes)) {
        return {
            ...mergeReportContributions({ reportType, columns, rows, outcomes: [] }),
            contributions:    [],
            collectionFailed: true,
        };
    }

    let scope = null;
    let agents = new Map();
    const rowServiceIds = outcomes.filter(contributesRows).map(outcome => outcome.serviceId);
    if (rowServiceIds.length > 0) {
        try {
            scope = await loadSessionScope(sessionId);
            const agentRows = await loadServiceAgents(rowServiceIds);
            agents = new Map(agentRows.map(agent => [agent.service_id, agent]));
        } catch (error) {
            console.warn("[external-services] Could not read the session for contributed rows.",
                JSON.stringify({ ...ids, errorName: errorNameOf(error) }));
            scope = null;
        }
    }

    const checked = checkRowsAgainstSession(outcomes, scope, ids);
    return {
        ...mergeReportContributions({
            reportType, columns, rows, outcomes: checked, scope, agents,
        }),
        contributions:    summarizeContributionOutcomes(checked),
        collectionFailed: false,
    };
}
