import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { getStatusCode } from "../../common/modules/session-status.js";
import { getPhaseExternalServices } from "./designs-helper.js";

/**
 * Verifies where an external service callback that matches no job may publish
 * (#815, "option A").
 *
 * Some callbacks are not answers to a job: Polyadic's proactive interventions
 * (session start, timer ticks, inactivity, window events) carry a fresh
 * correlation id each time. Such a callback is accepted only when the
 * destination its payload names is one the service may reach right now:
 *
 * 1. the adapter names a complete target (`getCallbackTarget`): a session and
 *    a phase, plus a group or a user when its target has those fields;
 * 2. the session's pinned AI service policy version allows the adapter (never
 *    the current version), and a connection exists for production adapters;
 * 3. the session was launched, the phase is its current phase and the
 *    activity is in progress;
 * 4. the phase's design (the locked design, as for phase hooks) enables the
 *    adapter;
 * 5. the group belongs to that phase, and the user takes part in the session.
 *
 * A destination that fails a check is refused with `409`; a lookup that fails
 * is refused with `503`, so the caller may retry. Either way no handler runs.
 */

const IN_PROGRESS = getStatusCode("in_progress");

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function refusal(statusCode, message, code) {
    return Object.assign(new Error(message), { statusCode, code });
}

/**
 * Whether a phase state (from the loader below) says the phase is the
 * launched session's current phase and the activity is in progress.
 */
export function isActivePhaseState(state, phaseId) {
    return Boolean(state)
        && state.launched === true
        && Number(state.status) === IN_PROGRESS
        && Number(state.current_stage) === Number(phaseId);
}

async function defaultGetDb() {
    return rpg2.getDBInstance(config.dbconnString);
}

/**
 * Reads the state a callback destination is checked against, in one query.
 * @returns {Promise<object|null>} null when the phase is not one of the
 *          session's phases.
 */
export function createPhaseStateLoader({ getDb = defaultGetDb } = {}) {
    return async function loadCallbackPhaseState({ sessionId, phaseId, groupId, userId }) {
        const db = await getDb();
        const { rows } = await db.query(`
            SELECT s.current_stage,
                   s.status,
                   EXISTS (
                       SELECT 1 FROM activity AS a WHERE a.session = s.id
                   ) AS launched,
                   ($3::integer IS NOT NULL AND EXISTS (
                       SELECT 1 FROM teams AS t
                       WHERE t.id = $3 AND t.stageid = st.id AND t.sesid = s.id
                   )) AS group_exists,
                   ($4::integer IS NOT NULL AND EXISTS (
                       SELECT 1 FROM sesusers AS su
                       WHERE su.sesid = s.id AND su.uid = $4
                   )) AS user_participates
            FROM stages AS st
            INNER JOIN sessions AS s
                ON s.id = st.sesid
            WHERE st.id = $2
              AND s.id = $1;
        `, [sessionId, phaseId, groupId, userId]);
        return rows[0] ?? null;
    };
}

/**
 * The verified destination of a callback that matches no job.
 *
 * @param {object} request
 * @param {object} request.service           The registered catalog entry.
 * @param {object|null} request.target       `getCallbackTarget(payload)`, or
 *                                           null when the adapter exports none.
 * @param {object} dependencies
 * @param {(version: object) => boolean} dependencies.isAllowedByPolicy
 * @param {{ getSessionPolicyVersionId: Function, getPolicyVersion: Function }}
 *        dependencies.policy                The policy store (errors propagate).
 * @param {() => Promise<boolean>} dependencies.isAiAdditionsConfigured
 * @param {(destination: object) => Promise<object|null>} [dependencies.loadPhaseState]
 * @param {(phaseId: number) => Promise<{ enabledServiceIds: string[] }>}
 *        [dependencies.loadPhaseExternalServices]
 * @returns {Promise<{ sessionId: number, phaseId: number, groupId: number|null,
 *          userId: number|null, questionId: null }>}
 * @throws {Error} with `statusCode` 409 (refused) or 503 (a lookup failed).
 */
export async function resolveCallbackDestination({ service, target }, {
    isAllowedByPolicy,
    policy,
    isAiAdditionsConfigured,
    loadPhaseState = createPhaseStateLoader(),
    loadPhaseExternalServices = getPhaseExternalServices,
}) {
    const serviceId = service.id;
    const refuse = (message, code) => refusal(409, `Callback for ${serviceId}: ${message}`, code);
    const unavailable = (what, error) => {
        console.error(`[external-services] Could not read the ${what} of a ${serviceId} callback.`, error);
        return refusal(503, `The ${what} of the callback could not be read; try again later.`,
            "callback_lookup_failed");
    };

    // 1. A complete target.
    const destination = {
        sessionId:  positiveId(target?.sessionId),
        phaseId:    positiveId(target?.phaseId),
        groupId:    positiveId(target?.groupId),
        userId:     positiveId(target?.userId),
        questionId: null,
    };
    const incomplete = !target
        || destination.sessionId === null
        || destination.phaseId === null
        || (Object.hasOwn(target, "groupId") && destination.groupId === null)
        || (Object.hasOwn(target, "userId") && destination.userId === null);
    if (incomplete) {
        throw refuse("it matches no job and names no complete destination.", "callback_without_job");
    }

    // 2. The session's pinned policy version, and the connection.
    let version;
    try {
        const versionId = await policy.getSessionPolicyVersionId(destination.sessionId);
        version = versionId === null ? null : await policy.getPolicyVersion(versionId);
    } catch (error) {
        throw unavailable("session's AI service policy", error);
    }
    if (!version || !isAllowedByPolicy(version)) {
        throw refuse("the destination session's policy does not allow it.", "callback_not_allowed");
    }
    if (service.development !== true) {
        let connected;
        try {
            connected = await isAiAdditionsConfigured();
        } catch (error) {
            throw unavailable("AI Additions connection", error);
        }
        if (connected !== true) {
            throw refusal(503, "The AI Additions connection is not configured.", "not_configured");
        }
    }

    // 3 and 5. The phase is the session's current, active phase; the group
    // and the user belong to it.
    let state;
    try {
        state = await loadPhaseState(destination);
    } catch (error) {
        throw unavailable("phase state", error);
    }
    if (!state || state.launched !== true) {
        throw refuse("the phase is not part of a launched session.", "callback_phase_inactive");
    }
    if (Number(state.status) !== IN_PROGRESS
        || Number(state.current_stage) !== destination.phaseId) {
        throw refuse("the phase is not the session's active phase.", "callback_phase_inactive");
    }
    if (destination.groupId !== null && state.group_exists !== true) {
        throw refuse("the group does not belong to that phase.", "callback_group_unknown");
    }
    if (destination.userId !== null && state.user_participates !== true) {
        throw refuse("the user does not take part in that session.", "callback_user_unknown");
    }

    // 4. The phase's design enables the adapter.
    let phaseServices;
    try {
        phaseServices = await loadPhaseExternalServices(destination.phaseId);
    } catch (error) {
        throw unavailable("phase design", error);
    }
    if (!phaseServices?.enabledServiceIds?.includes(serviceId)) {
        throw refuse("the phase's design does not enable it.", "callback_not_enabled");
    }

    return Object.freeze(destination);
}
