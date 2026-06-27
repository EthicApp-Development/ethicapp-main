import * as config from "../../config/database.config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import { getPhaseDesignByPhaseId } from "../../helpers/designs-helper.js";
import { getCaseIdBySessionId } from "../../helpers/sessions-helper.js";
import { getCaseDocumentRawText } from "../../helpers/case-document-content-helper.js";
import defaultAiAdditionsClient from "../../services/ai-additions-client.service.js";
import {
    buildArgumentClientContext,
    buildFeedbackPayloadFromExternalResult,
} from "./ats-feedback.utils.js";

export {
    buildArgumentClientContext,
    buildFeedbackPayloadFromExternalResult,
};

const DEFAULT_ATS_BASE_PATH = "/argumentation-tutor/api/v2";

const atsSessionByPhase = new Map();
const atsSessionCreationByPhase = new Map();
const atsSubmissionCountByPhaseUser = new Map();
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

function getAtsBaseUrl() {
    return normalizeText(process.env.AI_ADDITIONS_ARGUMENTATION_TUTOR_API_BASE_URL)
        || aiAdditionsClient.buildServiceUrl(DEFAULT_ATS_BASE_PATH);
}

async function fetchAtsJson(pathname, { method = "GET", body = null } = {}) {
    return aiAdditionsClient.requestJson(pathname, {
        method,
        body,
        baseUrl: getAtsBaseUrl(),
    });
}

function phaseCacheKey(context) {
    return `${context.sessionId}:${context.phaseId}`;
}

function phaseUserCacheKey(context) {
    return `${context.sessionId}:${context.phaseId}:${context.userId}`;
}

function getSubmissionCount(context) {
    return atsSubmissionCountByPhaseUser.get(phaseUserCacheKey(context)) || 0;
}

function incrementSubmissionCount(context) {
    const cacheKey = phaseUserCacheKey(context);
    const currentCount = atsSubmissionCountByPhaseUser.get(cacheKey) || 0;
    atsSubmissionCountByPhaseUser.set(cacheKey, currentCount + 1);
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

async function resolveSessionMetadata(context) {
    const sessionRow = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT id, name, descr
            FROM sessions
            WHERE id = $1
            LIMIT 1
        `,
        sqlParams: [rpg2.param("plain", Number(context.sessionId))],
    });

    const sessionTitle = normalizeText(sessionRow?.name) || `EthicApp session ${context.sessionId}`;
    const sessionDescription = normalizeText(sessionRow?.descr);
    const caseData = await resolveCaseData(context.sessionId);
    const phaseDesign = await getPhaseDesignByPhaseId(context.phaseId);
    const phaseInstructions = normalizeText(phaseDesign?.instructions);
    const questionFromDesign = resolveQuestionTextFromPhaseDesign(phaseDesign);
    const questionText = questionFromDesign || await resolveQuestionText(context);

    const caseText = caseData.rawText || sessionDescription || phaseInstructions || questionText || "Ethical discussion prompt.";
    const question = questionText || phaseInstructions || "Provide your ethical justification for the submitted response.";
    const caseId = caseData.caseId
        ? `ethicapp-case-${caseData.caseId}`
        : `ethicapp-session-${context.sessionId}-phase-${context.phaseId}`;

    return {
        caseId,
        caseTitle: sessionTitle,
        caseText,
        question,
    };
}

async function resolveCaseData(sessionId) {
    try {
        const caseId = await getCaseIdBySessionId(sessionId);
        if (!Number.isInteger(caseId) || caseId <= 0) {
            return { caseId: null, rawText: "" };
        }

        const rawText = normalizeText(await getCaseDocumentRawText(caseId));
        return { caseId, rawText };
    } catch (error) {
        console.warn("[external-services][ats] Unable to load case raw text. Falling back to session metadata.", {
            sessionId,
            error: normalizeText(error?.message) || "Unknown error",
        });
        return { caseId: null, rawText: "" };
    }
}

function resolveQuestionTextFromPhaseDesign(phaseDesign) {
    const questions = Array.isArray(phaseDesign?.questions) ? phaseDesign.questions : [];
    if (questions.length === 0) {
        return "";
    }

    for (const question of questions) {
        const questionText = normalizeText(question?.q_text);
        if (questionText) {
            return questionText;
        }
    }

    return "";
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
            SELECT title
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

    return normalizeText(row?.title);
}

async function getOrCreateAtsSession(context) {
    const cacheKey = phaseCacheKey(context);
    const cachedSessionId = atsSessionByPhase.get(cacheKey);

    if (cachedSessionId) {
        return cachedSessionId;
    }

    const inflightCreation = atsSessionCreationByPhase.get(cacheKey);
    if (inflightCreation) {
        return inflightCreation;
    }

    const creationPromise = (async () => {
        const metadata = await resolveSessionMetadata(context);

        const response = await fetchAtsJson("/sessions", {
            method: "POST",
            body:   {
                case_id:    metadata.caseId,
                case_title: metadata.caseTitle,
                case_text:  metadata.caseText,
                question:   metadata.question,
            },
        });

        const sessionId = normalizeText(response?.session_id);
        if (!sessionId) {
            throw new Error("ATS did not return a session_id.");
        }

        atsSessionByPhase.set(cacheKey, sessionId);
        return sessionId;
    })();

    atsSessionCreationByPhase.set(cacheKey, creationPromise);

    try {
        return await creationPromise;
    } finally {
        atsSessionCreationByPhase.delete(cacheKey);
    }
}

async function deleteAtsSession(atsSessionId) {
    if (!normalizeText(atsSessionId)) {
        return { deleted: false, reason: "missing-session-id" };
    }

    try {
        await fetchAtsJson(`/sessions/${encodeURIComponent(atsSessionId)}`, {
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


async function submitArgumentToAts(context, responseText, groupId) {
    const atsSessionId = await getOrCreateAtsSession(context);

    const response = await fetchAtsJson(`/sessions/${encodeURIComponent(atsSessionId)}/arguments`, {
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
    };
}

function isMissingPreviousAnalysisError(error) {
    if (Number(error?.statusCode) !== 400) {
        return false;
    }

    const responseError = normalizeText(error?.responseBody?.error).toLowerCase();
    return responseError.includes("no previous analysis") || responseError.includes("no previous argument");
}

async function submitArgumentComparisonToAts(context, responseText, groupId) {
    const atsSessionId = await getOrCreateAtsSession(context);

    try {
        const response = await fetchAtsJson(`/sessions/${encodeURIComponent(atsSessionId)}/arguments/compare`, {
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
        };
    } catch (error) {
        if (!isMissingPreviousAnalysisError(error)) {
            throw error;
        }

        const fallback = await submitArgumentToAts(context, responseText, groupId);
        return {
            ...fallback,
            mode: "arguments-fallback",
        };
    }
}

async function submitArgumentWithFlow(context, responseText, groupId) {
    const submissionCount = getSubmissionCount(context);
    if (submissionCount === 0) {
        return submitArgumentToAts(context, responseText, groupId);
    }

    return submitArgumentComparisonToAts(context, responseText, groupId);
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

async function processStudentResponse({ context, callback }) {
    const responseText = extractResponseText(context);
    if (!responseText) {
        await callback({
            hook:   "student-response-submitted",
            status: "skipped",
            reason: "No free-text response was found to send to ATS.",
        });
        return;
    }

    const groupId = await resolveGroupId(context);
    await submitArgumentWithFlow(context, responseText, groupId);
    incrementSubmissionCount(context);
}

async function processPhaseEnded({ context, callback }) {
    const cachePrefix = `${context.sessionId}:${context.phaseId}:`;
    const removedKeys = [];
    const phaseKey = `${context.sessionId}:${context.phaseId}`;
    const atsSessionId = atsSessionByPhase.get(phaseKey) || null;
    let atsDeleteResult = { deleted: false, reason: "not-cached" };

    if (atsSessionId) {
        atsDeleteResult = await deleteAtsSession(atsSessionId);
    }

    for (const key of atsSubmissionCountByPhaseUser.keys()) {
        if (!key.startsWith(cachePrefix)) {
            continue;
        }

        atsSubmissionCountByPhaseUser.delete(key);
        removedKeys.push(key);
    }

    atsSessionByPhase.delete(phaseKey);
    atsSessionCreationByPhase.delete(phaseKey);

    await callback({
        hook:    "phase-ended",
        status:  "completed",
        payload: {
            clearedSubmissionCounters: removedKeys.length,
            clearedAtsSession:         atsDeleteResult.deleted || Boolean(atsSessionId),
            atsSessionDeleteReason:    atsDeleteResult.reason,
            atsSessionId,
            sessionId:                 Number(context.sessionId) || null,
            phaseId:                   Number(context.phaseId) || null,
        },
    });
}

async function processExternalResult({ context, callback, publishStudentResult }) {
    const requestPayload = context?.requestPayload && typeof context.requestPayload === "object"
        ? context.requestPayload
        : {};
    const payloadGroupId = Number(requestPayload?.groupId);
    const groupId = Number.isInteger(payloadGroupId) && payloadGroupId > 0
        ? payloadGroupId
        : await resolveGroupId({
            phaseId: Number(requestPayload?.phaseId) || context.phaseId,
            userId:  Number(requestPayload?.userId) || context.userId,
        });

    const fallbackContext = {
        sessionId:  Number(requestPayload?.sessionId) || context.sessionId,
        phaseId:    Number(requestPayload?.phaseId) || context.phaseId,
        questionId: Number(requestPayload?.questionId) || context.questionId,
        userId:     Number(requestPayload?.userId) || context.userId,
    };

    const feedbackPayload = buildFeedbackPayloadFromExternalResult(requestPayload, fallbackContext);
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
        },
    });
}

export async function register({ subscribe, publishStudentResult, aiAdditionsClient: providedAiAdditionsClient }) {
    aiAdditionsClient = providedAiAdditionsClient || defaultAiAdditionsClient;

    subscribe("student-response-submitted", async (context, { callback }) => {
        try {
            await processStudentResponse({ context, callback });
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
            await processExternalResult({ context, callback, publishStudentResult });
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
            await processPhaseEnded({ context, callback });
        } catch (error) {
            await callback({
                hook:   "phase-ended",
                status: "failed",
                error:  normalizeText(error?.message) || "Unexpected phase-ended handler error.",
            });
        }
    });
}
