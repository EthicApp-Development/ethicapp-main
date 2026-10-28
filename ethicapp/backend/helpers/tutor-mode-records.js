import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { ARGUMENTATION_TUTOR_SERVICE_ID, TUTOR_MODES } from "./tutor-mode.js";

/**
 * The modes of the tutor sessions of an activity, for its teacher (#865).
 *
 * The Argumentation Tutor adapter records the mode of each tutor session it
 * creates, one per EthicApp session, phase and question, in the instantiation
 * report of the job whose response created it (`tutorMode`,
 * `tutorModeReason`, `requestedMode`, `questionKey`; see
 * adapters/ats-feedback.adapter.js). `requestedMode` is the mode the phase
 * requested (#870); sessions created before #870 did not record it.
 * The `callback-received` handler records the mode the tutor reports for each
 * evaluation (`tutorMode`, and `requestedMode` since
 * ethicapp-ai-additions#211, in `external_service_results.adapter_result`).
 * The tutor reports a mode in every evaluation of a session opened with
 * `case_context` or `evaluation_mode`, so with a tutor that declares
 * `evaluation_mode` the evaluations of basic sessions count as `basic`, not
 * `unreported`. Tutor sessions are recreated after a restart or a new phase run, so the
 * latest report of each phase and question wins.
 */

const QUESTION_KEY = /^p([1-9][0-9]*)-q([1-9][0-9]*)$/u;

function positiveIdOrNull(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function questionNumberOf(questionKey) {
    const match = QUESTION_KEY.exec(String(questionKey ?? ""));
    return match ? Number(match[2]) : null;
}

const evaluationKey = (phaseId, questionId) => `${phaseId ?? ""}:${questionId ?? ""}`;

const isTutorMode = mode => Object.values(TUTOR_MODES).includes(mode);

const noEvaluations = () => ({ enhanced: 0, basic: 0, unreported: 0 });

/**
 * Pure: the records the endpoint returns, from the latest report rows and the
 * evaluation counts.
 *
 * @param {Array} sessionRows - `{ phase_id, phase_number, question_id,
 *     question_key, tutor_mode, tutor_mode_reason, requested_mode,
 *     created_at }`.
 * @param {Array} evaluationRows - `{ phase_id, question_id, tutor_mode,
 *     evaluations }`.
 * @returns {Array<{phaseId, phaseNumber, questionId, questionKey,
 *     questionNumber, requestedMode, tutorMode, tutorModeReason, createdAt,
 *     evaluations: {enhanced: number, basic: number, unreported: number}}>}
 *     By phase and question number. `requestedMode` is null for sessions
 *     created before #870.
 */
export function toTutorModeRecords(sessionRows = [], evaluationRows = []) {
    const evaluations = new Map();
    for (const row of evaluationRows) {
        const key = evaluationKey(
            positiveIdOrNull(row.phase_id),
            positiveIdOrNull(row.question_id)
        );
        const counts = evaluations.get(key) ?? noEvaluations();
        const mode = isTutorMode(row.tutor_mode) ? row.tutor_mode : "unreported";
        counts[mode] += Number(row.evaluations) || 0;
        evaluations.set(key, counts);
    }

    return sessionRows
        .filter(row => isTutorMode(row.tutor_mode))
        .map((row) => {
            const phaseId = positiveIdOrNull(row.phase_id);
            const questionId = positiveIdOrNull(row.question_id);
            const basic = row.tutor_mode === TUTOR_MODES.BASIC;
            return {
                phaseId,
                phaseNumber:     positiveIdOrNull(row.phase_number),
                questionId,
                questionKey:     row.question_key ?? null,
                questionNumber:  questionNumberOf(row.question_key),
                requestedMode:   isTutorMode(row.requested_mode) ? row.requested_mode : null,
                tutorMode:       row.tutor_mode,
                tutorModeReason: basic ? (row.tutor_mode_reason ?? null) : null,
                createdAt:       row.created_at ?? null,
                evaluations:     evaluations.get(evaluationKey(phaseId, questionId))
                    ?? noEvaluations(),
            };
        })
        .sort((a, b) => (a.phaseNumber ?? 0) - (b.phaseNumber ?? 0)
            || (a.questionNumber ?? 0) - (b.questionNumber ?? 0));
}

async function queryRows(query, sql, sqlParams) {
    return query({ dbcon: config.dbconnString, sql, sqlParams });
}

/**
 * The tutor sessions of an EthicApp session with their modes. See
 * toTutorModeRecords().
 *
 * @param {number} sessionId
 * @param {Function} [query] - rpg2.execSQL by default, so tests can record the SQL.
 */
export async function listSessionTutorModes(sessionId, query = rpg2.execSQL) {
    const params = [sessionId, ARGUMENTATION_TUTOR_SERVICE_ID];
    const [sessionRows, evaluationRows] = await Promise.all([
        queryRows(query, `
            SELECT DISTINCT ON (j.phase_id, j.instantiation_report->>'questionKey')
                   j.phase_id,
                   st.number AS phase_number,
                   j.question_id,
                   j.instantiation_report->>'questionKey' AS question_key,
                   j.instantiation_report->>'tutorMode' AS tutor_mode,
                   j.instantiation_report->>'tutorModeReason' AS tutor_mode_reason,
                   j.instantiation_report->>'requestedMode' AS requested_mode,
                   j.created_at
            FROM external_service_jobs AS j
            LEFT JOIN stages AS st
                ON st.id = j.phase_id
            WHERE j.session_id = $1
              AND j.service_id = $2
              AND j.instantiation_report->>'tutorMode' IS NOT NULL
            ORDER BY j.phase_id, j.instantiation_report->>'questionKey', j.created_at DESC;
        `, params),
        queryRows(query, `
            SELECT r.phase_id,
                   r.question_id,
                   r.adapter_result->'payload'->>'tutorMode' AS tutor_mode,
                   count(*)::integer AS evaluations
            FROM external_service_results AS r
            WHERE r.session_id = $1
              AND r.service_id = $2
              AND r.status = 'completed'
            GROUP BY r.phase_id, r.question_id, r.adapter_result->'payload'->>'tutorMode';
        `, params),
    ]);

    return toTutorModeRecords(sessionRows, evaluationRows);
}
