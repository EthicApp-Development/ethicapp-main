import * as config from "../../config/database.config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import { findTutorQuestion, tutorQuestionId } from "../../helpers/design-tutor-questions.js";
import {
    loadTutorClaimTypology,
    TYPOLOGY_ABSENT_REASONS,
} from "../../helpers/tutor-claim-typology.js";
import defaultAiAdditionsClient from "../../services/ai-additions-client.service.js";
import {
    buildArgumentClientContext,
    buildFeedbackPayloadFromExternalResult,
    claimTypeFromExternalResult,
    CLAIM_TYPOLOGY_OUTCOMES,
    createAtsSession,
    differentialQuestionText,
    getUiTranslations,
    phaseInstructionsText,
    questionTextFromPhaseDesign,
} from "./ats-feedback.utils.js";

export {
    buildArgumentClientContext,
    buildFeedbackPayloadFromExternalResult,
    getUiTranslations,
};

// The Argumentation Tutor API under the AI Additions connection's base URL (#814).
export const ATS_API_BASE_PATH = "/argumentation-tutor/api/v2";

// A tutor that ignored a claim typology as an unsupported setting is not sent
// one again for this long; the first session after it offers one again, in
// case the tutor was upgraded.
export const CLAIM_TYPOLOGY_UNSUPPORTED_RETRY_MS = 10 * 60 * 1000;

// What the instantiation report says about the claim typology of a session,
// besides the outcomes of an offered one (CLAIM_TYPOLOGY_OUTCOMES).
const CLAIM_TYPOLOGY_NOT_OFFERED = Object.freeze({
    ABSENT:   "absent",
    WITHHELD: "withheld",
});

function positiveIdOrNull(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// The destination an ATS callback names: the student (and the session, phase
// and question) its feedback is published to. The registry refuses the
// callback when they differ from the student-response job it correlates with
// (#815). `groupId` is not a destination here: it is only reported back.
export function getCallbackTarget(requestPayload) {
    return {
        sessionId:  positiveIdOrNull(requestPayload?.sessionId),
        phaseId:    positiveIdOrNull(requestPayload?.phaseId),
        questionId: positiveIdOrNull(requestPayload?.questionId),
        userId:     positiveIdOrNull(requestPayload?.userId),
    };
}

let aiAdditionsClient = defaultAiAdditionsClient;

function normalizeText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    const text = String(value).trim();
    return text.length > 0 ? text : "";
}

function extractResponseText(context) {
    const candidates = [
        context?.responsePayload?.comment,
        context?.responsePayload?.description,
        context?.requestPayload?.justification,
        context?.requestPayload?.description,
        context?.requestPayload?.comment,
    ];

    return candidates.find(candidate => normalizeText(candidate).length > 0)?.trim() || "";
}

/**
 * A request to the Argumentation Tutor API (`base_url + ATS_API_BASE_PATH`).
 * Rejects with `not_configured` without an AI Additions connection.
 */
export async function requestAtsJson(pathname, { method = "GET", body = null } = {}) {
    return aiAdditionsClient.requestJson(pathname, {
        method,
        body,
        basePath: ATS_API_BASE_PATH,
    });
}

/**
 * The key of the question a response answers, within its phase (#850): the
 * positional id `p<stages.number>-q<differential.orden>` when the runtime
 * question maps back to its position in the design, otherwise its runtime id
 * (`question-<id>`, for example a ranking item), or `phase` for a response
 * without a question.
 */
export function tutorQuestionKey(context, position = {}) {
    const phaseNumber = positiveIdOrNull(position?.phaseNumber);
    const questionNumber = positiveIdOrNull(position?.questionNumber);
    if (phaseNumber && questionNumber) {
        return tutorQuestionId(phaseNumber, questionNumber);
    }

    const questionId = positiveIdOrNull(context?.questionId);
    return questionId ? `question-${questionId}` : "phase";
}

/**
 * The texts of the tutor session of one question (#850): the case, and that
 * question's own text. The question is the design's question at the response's
 * position (the text its claim typology answers), else the runtime question's
 * text, else the phase's first question, as before #850.
 *
 * @param {Object} args
 * @param {Object} args.context - The hook context.
 * @param {Object} args.position - `{ phaseNumber, questionNumber }`.
 * @param {Object} args.sessionContext - From loadSessionContext().
 * @param {Object|null} args.tutorQuestion - From findTutorQuestion().
 * @param {string} [args.runtimeQuestionText] - The runtime question's text.
 */
export function composeSessionMetadata({
    context,
    position,
    sessionContext,
    tutorQuestion,
    runtimeQuestionText = "",
}) {
    const phases = sessionContext?.design?.phases;
    const phaseNumber = positiveIdOrNull(position?.phaseNumber);
    const phaseDesign = phaseNumber && Array.isArray(phases)
        ? phases[phaseNumber - 1] ?? null
        : null;

    const phaseInstructions = phaseInstructionsText(phaseDesign);
    const questionText = normalizeText(tutorQuestion?.text)
        || normalizeText(runtimeQuestionText)
        || questionTextFromPhaseDesign(phaseDesign);
    const caseId = positiveIdOrNull(sessionContext?.caseId);

    return {
        caseId: caseId
            ? `ethicapp-case-${caseId}`
            : `ethicapp-session-${context.sessionId}-phase-${context.phaseId}`,
        caseTitle: normalizeText(sessionContext?.sessionTitle)
            || `EthicApp session ${context.sessionId}`,
        caseText: normalizeText(sessionContext?.caseText)
            || normalizeText(sessionContext?.sessionDescription)
            || phaseInstructions
            || questionText
            || "Ethical discussion prompt.",
        question: questionText
            || phaseInstructions
            || "Provide your ethical justification for the submitted response.",
    };
}

async function resolveGroupId(context) {
    if (!context?.phaseId || !context?.userId) {
        return null;
    }

    const row = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT t.id AS group_id
            FROM teams AS t
            INNER JOIN teamusers AS tu
                ON tu.tmid = t.id
            WHERE t.stageid = $1
              AND tu.uid = $2
            LIMIT 1
        `,
        sqlParams: [
            rpg2.param("plain", Number(context.phaseId)),
            rpg2.param("plain", Number(context.userId)),
        ],
    });

    const groupId = Number(row?.group_id);
    return Number.isInteger(groupId) && groupId > 0 ? groupId : null;
}

/**
 * Where the runtime question sits in the design (#850): its phase's
 * `stages.number` and, for semantic differential questions, its
 * `differential.orden`. Either is null when it cannot be read.
 */
async function resolveQuestionPosition(context) {
    const phaseId = positiveIdOrNull(context?.phaseId);
    if (!phaseId) {
        return { phaseNumber: null, questionNumber: null };
    }

    const questionId = context?.designType === "ranking"
        ? null
        : positiveIdOrNull(context?.questionId);
    const row = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT st.number AS phase_number,
                   d.orden AS question_number
            FROM stages AS st
            LEFT JOIN differential AS d
                ON d.id = $2::integer
               AND d.stageid = st.id
            WHERE st.id = $1
            LIMIT 1
        `,
        sqlParams: [
            rpg2.param("plain", phaseId),
            rpg2.param("plain", questionId),
        ],
    });

    return {
        phaseNumber:    positiveIdOrNull(row?.phase_number),
        questionNumber: positiveIdOrNull(row?.question_number),
    };
}

// The case text, or "" when it cannot be read (the session then falls back
// to the session's description).
async function loadCaseText(caseId) {
    if (!positiveIdOrNull(caseId)) {
        return "";
    }

    try {
        // Lazy import: the content helper opens a Redis connection when loaded,
        // and registering the adapter at startup must have no side effects.
        const { getCaseDocumentRawText } = await import(
            "../../helpers/case-document-content-helper.js"
        );
        return normalizeText(await getCaseDocumentRawText(caseId));
    } catch (error) {
        console.warn("[external-services][ats] Unable to load case raw text. "
            + "Falling back to session metadata.", {
            caseId,
            error: normalizeText(error?.message) || "Unknown error",
        });
        return "";
    }
}

/**
 * What a tutor session is built from: the EthicApp session's name and
 * description, the activity's design (id, document and case) and the case
 * text.
 */
async function loadSessionContext(context) {
    const row = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT s.name, s.descr, ds.id AS design_id, ds.design, ds.case_id
            FROM sessions AS s
            LEFT JOIN activity AS a
                ON a.session = s.id
            LEFT JOIN designs AS ds
                ON ds.id = a.design
            WHERE s.id = $1
            LIMIT 1
        `,
        sqlParams: [rpg2.param("plain", Number(context.sessionId))],
    });

    const caseId = positiveIdOrNull(row?.case_id);
    return {
        sessionTitle:       normalizeText(row?.name),
        sessionDescription: normalizeText(row?.descr),
        designId:           positiveIdOrNull(row?.design_id),
        design:             row?.design ?? null,
        caseId,
        caseText:           await loadCaseText(caseId),
    };
}

async function resolveQuestionText(context) {
    const questionId = Number(context?.questionId);
    const phaseId = Number(context?.phaseId);

    if (!Number.isInteger(questionId) || !Number.isInteger(phaseId)) {
        return "";
    }

    if (context.designType === "ranking") {
        const row = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql:   `
                SELECT name
                FROM actors
                WHERE id = $1
                  AND stageid = $2
                LIMIT 1
            `,
            sqlParams: [
                rpg2.param("plain", questionId),
                rpg2.param("plain", phaseId),
            ],
        });

        return normalizeText(row?.name);
    }

    const row = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT title, title_content_type
            FROM differential
            WHERE id = $1
              AND stageid = $2
            LIMIT 1
        `,
        sqlParams: [
            rpg2.param("plain", questionId),
            rpg2.param("plain", phaseId),
        ],
    });

    return differentialQuestionText(row);
}

function createDependencies(overrides = {}) {
    return {
        resolveGroupId,
        resolveQuestionPosition,
        loadSessionContext,
        resolveQuestionText,
        loadClaimTypology: loadTutorClaimTypology,
        now:               () => Date.now(),
        ...overrides,
    };
}

function isMissingPreviousAnalysisError(error) {
    if (Number(error?.statusCode) !== 400) {
        return false;
    }

    const responseError = normalizeText(error?.responseBody?.error).toLowerCase();
    return responseError.includes("no previous analysis") || responseError.includes("no previous argument");
}

async function publishFeedbackToStudent({ context, feedbackPayload, status, publishStudentResult }) {
    const userId = Number(context?.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error("Cannot publish ATS feedback without a valid userId.");
    }

    await publishStudentResult({
        userId,
        sessionId:  Number(context.sessionId) || null,
        phaseId:    Number(context.phaseId) || null,
        questionId: Number(context.questionId) || null,
        component:  {
            componentId: "argument-tutor-chat-feedback",
            title:       "Argument Tutor Feedback",
        },
        payload: {
            feedback: feedbackPayload,
        },
        message: "Your argument tutor feedback is now available.",
        status:  status || "completed",
    });
}

/**
 * The adapter's handlers and the tutor sessions they keep in memory.
 *
 * Each EthicApp session, phase and question has its own tutor session (#850),
 * created lazily by the first response to the question, with that question's
 * text and, when the design has an up-to-date one, its claim typology. Keys are
 * `<sessionId>:<phaseId>:<question key>` (tutorQuestionKey()), and the
 * submission counters that choose between a first analysis and a comparison
 * add `:<userId>`. `phase-ended` deletes the phase's tutor sessions.
 */
function createAtsFeedbackHandlers({ dependencies, publishStudentResult }) {
    const atsSessionByQuestion = new Map();
    const atsSessionCreationByQuestion = new Map();
    const atsSubmissionCountByQuestionUser = new Map();
    const loggedTypologyOutcomes = new Set();
    let claimTypologyWithheldUntil = 0;

    function logTypologyOutcomeOnce(outcome, message, details) {
        if (loggedTypologyOutcomes.has(outcome)) {
            return;
        }
        loggedTypologyOutcomes.add(outcome);
        console.warn(`[external-services][ats] ${message}`, details);
    }

    // The claim typology offered to the session of a question, and why there
    // is none otherwise. Loading it never fails the response.
    async function questionClaimTypology({ sessionContext, tutorQuestion }) {
        if (!tutorQuestion) {
            return { claimTypology: null, reason: TYPOLOGY_ABSENT_REASONS.NO_QUESTION };
        }

        try {
            return await dependencies.loadClaimTypology({
                designId: sessionContext?.designId ?? null,
                caseId:   sessionContext?.caseId ?? null,
                question: tutorQuestion,
            });
        } catch (error) {
            console.warn("[external-services][ats] Unable to load the claim typology; "
                + "the tutor session is created without it.", {
                designId:   sessionContext?.designId ?? null,
                questionId: tutorQuestion.id,
                error:      normalizeText(error?.message) || "Unknown error",
            });
            return { claimTypology: null, reason: TYPOLOGY_ABSENT_REASONS.LOAD_FAILED };
        }
    }

    // What the instantiation report says about the typology, and what this
    // creation teaches about the tutor's support for it.
    function claimTypologyReport({ typology, offered, creation, questionKey }) {
        if (!typology.claimTypology) {
            return {
                claimTypology:       CLAIM_TYPOLOGY_NOT_OFFERED.ABSENT,
                claimTypologyReason: typology.reason,
            };
        }
        if (!offered) {
            return { claimTypology: CLAIM_TYPOLOGY_NOT_OFFERED.WITHHELD };
        }

        if (creation.claimTypology === CLAIM_TYPOLOGY_OUTCOMES.UNSUPPORTED) {
            claimTypologyWithheldUntil = dependencies.now() + CLAIM_TYPOLOGY_UNSUPPORTED_RETRY_MS;
            logTypologyOutcomeOnce(
                CLAIM_TYPOLOGY_OUTCOMES.UNSUPPORTED,
                "The tutor does not support claim typologies; "
                    + "its sessions are created without them.",
                { questionKey }
            );
        } else if (creation.claimTypology === CLAIM_TYPOLOGY_OUTCOMES.REJECTED) {
            logTypologyOutcomeOnce(
                CLAIM_TYPOLOGY_OUTCOMES.REJECTED,
                "The tutor rejected a claim typology; the session was created without it.",
                { questionKey, rejection: creation.claimTypologyRejection ?? null }
            );
        }
        return {};
    }

    async function createQuestionSession(context, position, questionKey) {
        const sessionContext = await dependencies.loadSessionContext(context);
        const tutorQuestion = findTutorQuestion(sessionContext?.design, position);
        const runtimeQuestionText = tutorQuestion
            ? ""
            : await dependencies.resolveQuestionText(context);
        const metadata = composeSessionMetadata({
            context,
            position,
            sessionContext,
            tutorQuestion,
            runtimeQuestionText,
        });

        const typology = await questionClaimTypology({ sessionContext, tutorQuestion });
        const offered = typology.claimTypology !== null
            && dependencies.now() >= claimTypologyWithheldUntil;

        const created = await createAtsSession({
            metadata,
            serviceConfiguration: context.serviceConfiguration,
            claimTypology:        offered ? typology.claimTypology : null,
            request:              body => requestAtsJson("/sessions", { method: "POST", body }),
        });

        const report = claimTypologyReport({
            typology,
            offered,
            creation: created.creation,
            questionKey,
        });
        return {
            sessionId: created.sessionId,
            creation:  { ...created.creation, questionKey, ...report },
        };
    }

    // Returns `{ sessionId, creation }`; `creation` is set only for the call
    // that created the question's session, and null when it already existed.
    async function getOrCreateAtsSession(context, { position, questionKey }) {
        const cacheKey = `${context.sessionId}:${context.phaseId}:${questionKey}`;

        const cachedSessionId = atsSessionByQuestion.get(cacheKey);
        if (cachedSessionId) {
            return { sessionId: cachedSessionId, creation: null };
        }

        const inflightCreation = atsSessionCreationByQuestion.get(cacheKey);
        if (inflightCreation) {
            return { sessionId: (await inflightCreation).sessionId, creation: null };
        }

        const creationPromise = (async () => {
            const created = await createQuestionSession(context, position, questionKey);
            atsSessionByQuestion.set(cacheKey, created.sessionId);
            return created;
        })();

        atsSessionCreationByQuestion.set(cacheKey, creationPromise);

        try {
            return await creationPromise;
        } finally {
            atsSessionCreationByQuestion.delete(cacheKey);
        }
    }

    function submissionCountKey(context, questionKey) {
        return `${context.sessionId}:${context.phaseId}:${questionKey}:${context.userId}`;
    }

    async function submitArgumentToAts(context, responseText, groupId, question) {
        const { sessionId: atsSessionId, creation } = await getOrCreateAtsSession(
            context, question
        );

        const sessionPath = `/sessions/${encodeURIComponent(atsSessionId)}`;
        const response = await requestAtsJson(`${sessionPath}/arguments`, {
            method: "POST",
            body:   {
                argument:       responseText,
                user_id:        String(context.userId),
                client_context: buildArgumentClientContext(context, groupId),
            },
        });

        const taskId = normalizeText(response?.task_id);
        if (!taskId) {
            throw new Error("ATS did not return a task_id.");
        }

        return {
            atsSessionId,
            taskId,
            mode:                   "arguments",
            revisedArgumentPreview: responseText,
            sessionCreation:        creation,
            questionKey:            question.questionKey,
        };
    }

    async function submitArgumentComparisonToAts(context, responseText, groupId, question) {
        const { sessionId: atsSessionId, creation } = await getOrCreateAtsSession(
            context, question
        );

        try {
            const sessionPath = `/sessions/${encodeURIComponent(atsSessionId)}`;
            const response = await requestAtsJson(`${sessionPath}/arguments/compare`, {
                method: "POST",
                body:   {
                    revised_argument: responseText,
                    user_id:          String(context.userId),
                    client_context:   buildArgumentClientContext(context, groupId),
                },
            });

            const taskId = normalizeText(response?.task_id);
            if (!taskId) {
                throw new Error("ATS did not return a task_id.");
            }

            return {
                atsSessionId,
                taskId,
                mode:                   "compare",
                initialArgumentPreview: normalizeText(response?.initial_argument_preview),
                revisedArgumentPreview: responseText,
                sessionCreation:        creation,
                questionKey:            question.questionKey,
            };
        } catch (error) {
            if (!isMissingPreviousAnalysisError(error)) {
                throw error;
            }

            const fallback = await submitArgumentToAts(context, responseText, groupId, question);
            return {
                ...fallback,
                mode: "arguments-fallback",
            };
        }
    }

    // The first response of a student to a question is analysed; later ones
    // are compared with the previous one, in the same question's session.
    async function submitArgumentWithFlow(context, responseText, groupId) {
        const position = await dependencies.resolveQuestionPosition(context);
        const question = { position, questionKey: tutorQuestionKey(context, position) };
        const countKey = submissionCountKey(context, question.questionKey);
        const submissionCount = atsSubmissionCountByQuestionUser.get(countKey) || 0;

        const submission = submissionCount === 0
            ? await submitArgumentToAts(context, responseText, groupId, question)
            : await submitArgumentComparisonToAts(context, responseText, groupId, question);

        atsSubmissionCountByQuestionUser.set(countKey, submissionCount + 1);
        return submission;
    }

    async function processStudentResponse({ context, callback, reportInstantiation }) {
        const responseText = extractResponseText(context);
        if (!responseText) {
            await callback({
                hook:   "student-response-submitted",
                status: "skipped",
                reason: "No free-text response was found to send to ATS.",
            });
            return;
        }

        // Fails fast with `not_configured` when no AI Additions connection is stored.
        await aiAdditionsClient.getEndpoints();
        const groupId = await dependencies.resolveGroupId(context);
        const submission = await submitArgumentWithFlow(context, responseText, groupId);
        // The response that created the question's tutor session records the
        // tutor's report on its job (#737); the job completes later, with the
        // tutor's callback.
        if (submission?.sessionCreation && typeof reportInstantiation === "function") {
            await reportInstantiation(submission.sessionCreation);
        }
        return submission;
    }

    async function deleteAtsSession(atsSessionId) {
        if (!normalizeText(atsSessionId)) {
            return { deleted: false, reason: "missing-session-id" };
        }

        try {
            await requestAtsJson(`/sessions/${encodeURIComponent(atsSessionId)}`, {
                method: "DELETE",
            });

            return { deleted: true, reason: null };
        } catch (error) {
            if (Number(error?.statusCode) === 404) {
                return { deleted: false, reason: "not-found" };
            }

            throw error;
        }
    }

    function clearPhaseKeys(map, prefix) {
        const removed = [];
        for (const key of [...map.keys()]) {
            if (key.startsWith(prefix)) {
                map.delete(key);
                removed.push(key);
            }
        }
        return removed;
    }

    async function processPhaseEnded({ context, callback }) {
        const prefix = `${context.sessionId}:${context.phaseId}:`;
        const phaseSessions = [...atsSessionByQuestion.entries()]
            .filter(([key]) => key.startsWith(prefix));

        const atsSessions = [];
        let deleteError = null;
        for (const [key, atsSessionId] of phaseSessions) {
            const questionKey = key.slice(prefix.length);
            try {
                const result = await deleteAtsSession(atsSessionId);
                atsSessions.push({ questionKey, atsSessionId, ...result });
            } catch (error) {
                deleteError = deleteError ?? error;
                atsSessions.push({ questionKey, atsSessionId, deleted: false, reason: "error" });
            }
        }

        const removedCounters = clearPhaseKeys(atsSubmissionCountByQuestionUser, prefix);
        clearPhaseKeys(atsSessionByQuestion, prefix);
        clearPhaseKeys(atsSessionCreationByQuestion, prefix);

        // The phase's sessions are forgotten either way; a failed deletion
        // fails the job, as before #850.
        if (deleteError) {
            throw deleteError;
        }

        await callback({
            hook:    "phase-ended",
            status:  "completed",
            payload: {
                clearedSubmissionCounters: removedCounters.length,
                clearedAtsSessions:        atsSessions.length,
                atsSessions,
                sessionId:                 Number(context.sessionId) || null,
                phaseId:                   Number(context.phaseId) || null,
            },
        });
    }

    async function processExternalResult({ context, callback }) {
        const requestPayload = context?.requestPayload && typeof context.requestPayload === "object"
            ? context.requestPayload
            : {};
        const payloadGroupId = Number(requestPayload?.groupId);
        const groupId = Number.isInteger(payloadGroupId) && payloadGroupId > 0
            ? payloadGroupId
            : await dependencies.resolveGroupId({
                phaseId: Number(requestPayload?.phaseId) || context.phaseId,
                userId:  Number(requestPayload?.userId) || context.userId,
            });

        const fallbackContext = {
            sessionId:  Number(requestPayload?.sessionId) || context.sessionId,
            phaseId:    Number(requestPayload?.phaseId) || context.phaseId,
            questionId: Number(requestPayload?.questionId) || context.questionId,
            userId:     Number(requestPayload?.userId) || context.userId,
        };

        // The student's feedback is unchanged: the matched claim type is for
        // teachers, and is only recorded with the result (#850).
        const feedbackPayload = buildFeedbackPayloadFromExternalResult(
            requestPayload, fallbackContext
        );
        await publishFeedbackToStudent({
            context: fallbackContext,
            feedbackPayload,
            status:  normalizeText(requestPayload?.status) || "completed",
            publishStudentResult,
        });

        await callback({
            hook:    "callback-received",
            status:  "completed",
            payload: {
                groupId,
                publishedToUserId: Number(fallbackContext.userId) || null,
                feedbackTitle:     feedbackPayload.title,
                ...claimTypeFromExternalResult(requestPayload),
            },
        });
    }

    return { processStudentResponse, processPhaseEnded, processExternalResult };
}

/**
 * @param {Object} args - See "Adapter registration" in the README.
 * @param {Object} [args.atsFeedbackDependencies] - Test-only overrides of the
 *     database reads and the clock (createDependencies()).
 */
export async function register({
    subscribe,
    publishStudentResult,
    aiAdditionsClient: providedAiAdditionsClient,
    atsFeedbackDependencies = {},
}) {
    aiAdditionsClient = providedAiAdditionsClient || defaultAiAdditionsClient;
    const handlers = createAtsFeedbackHandlers({
        dependencies: createDependencies(atsFeedbackDependencies),
        publishStudentResult,
    });

    subscribe("student-response-submitted", async (context, { callback, reportInstantiation }) => {
        try {
            return await handlers.processStudentResponse({
                context, callback, reportInstantiation,
            });
        } catch (error) {
            await callback({
                hook:   "student-response-submitted",
                status: "failed",
                error:  normalizeText(error?.message) || "Unexpected ATS adapter error.",
            });
        }
    });

    subscribe("callback-received", async (context, { callback }) => {
        try {
            await handlers.processExternalResult({ context, callback });
        } catch (error) {
            await callback({
                hook:   "callback-received",
                status: "failed",
                error:  normalizeText(error?.message) || "Unexpected external result adapter error.",
            });
        }
    });

    subscribe("phase-ended", async (context, { callback }) => {
        try {
            await handlers.processPhaseEnded({ context, callback });
        } catch (error) {
            await callback({
                hook:   "phase-ended",
                status: "failed",
                error:  normalizeText(error?.message) || "Unexpected phase-ended handler error.",
            });
        }
    });
}
