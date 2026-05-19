import * as config from "../../config/config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import { getPhaseDesignByPhaseId } from "../../helpers/designs-helper.js";

const DEFAULT_ATS_BASE_URL = "http://host.docker.internal:5001";
const DEFAULT_KEYCLOAK_BASE_URL = "http://host.docker.internal:8080";
const DEFAULT_KEYCLOAK_REALM = "argumentation-tutor";
const DEFAULT_POLL_INTERVAL_MS = 2500;
const DEFAULT_POLL_TIMEOUT_MS = 90000;
const DEFAULT_HTTP_TIMEOUT_MS = 12000;

const atsSessionByPhase = new Map();
const atsSessionCreationByPhase = new Map();
const atsSubmissionCountByPhaseUser = new Map();

const tokenCache = {
    token: null,
    expiresAtMs: 0,
};

function nowMs() {
    return Date.now();
}

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
    return normalizeText(process.env.ATS_API_BASE_URL) || DEFAULT_ATS_BASE_URL;
}

function getAtsPollIntervalMs() {
    const configured = Number(process.env.ATS_POLL_INTERVAL_MS);
    return Number.isInteger(configured) && configured > 250 ? configured : DEFAULT_POLL_INTERVAL_MS;
}

function getAtsPollTimeoutMs() {
    const configured = Number(process.env.ATS_POLL_TIMEOUT_MS);
    return Number.isInteger(configured) && configured > 5000 ? configured : DEFAULT_POLL_TIMEOUT_MS;
}

function getHttpTimeoutMs() {
    const configured = Number(process.env.ATS_HTTP_TIMEOUT_MS);
    return Number.isInteger(configured) && configured > 1000 ? configured : DEFAULT_HTTP_TIMEOUT_MS;
}

function getKeycloakBaseUrl() {
    return normalizeText(process.env.ATS_KEYCLOAK_BASE_URL) || DEFAULT_KEYCLOAK_BASE_URL;
}

function getKeycloakRealm() {
    return normalizeText(process.env.ATS_KEYCLOAK_REALM) || DEFAULT_KEYCLOAK_REALM;
}

function getKeycloakClientId() {
    return normalizeText(process.env.ATS_KEYCLOAK_CLIENT_ID);
}

function getKeycloakClientSecret() {
    return normalizeText(process.env.ATS_KEYCLOAK_CLIENT_SECRET);
}

function getKeycloakScope() {
    return normalizeText(process.env.ATS_KEYCLOAK_SCOPE);
}

function getKeycloakTokenUrl() {
    const explicitTokenUrl = normalizeText(process.env.ATS_KEYCLOAK_TOKEN_URL);
    if (explicitTokenUrl) {
        return explicitTokenUrl;
    }

    const baseUrl = getKeycloakBaseUrl().replace(/\/+$/u, "");
    const realm = encodeURIComponent(getKeycloakRealm());
    return `${baseUrl}/realms/${realm}/protocol/openid-connect/token`;
}

function buildRequestUrl(pathname) {
    const baseUrl = getAtsBaseUrl().replace(/\/+$/u, "");
    return `${baseUrl}${pathname}`;
}

async function fetchJsonRaw(url, { method = "GET", body = null, headers = {}, timeoutMs = getHttpTimeoutMs() } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method,
            headers,
            body,
            signal: controller.signal,
        });

        const rawText = await response.text();
        const parsedBody = rawText ? safeJsonParse(rawText) : null;

        if (!response.ok) {
            const error = new Error(`HTTP ${response.status} request failed on ${url}.`);
            error.statusCode = response.status;
            error.responseBody = parsedBody ?? rawText;
            throw error;
        }

        return parsedBody;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchJson(pathname, options = {}) {
    return fetchJsonRaw(buildRequestUrl(pathname), options);
}

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

async function fetchAtsAccessToken() {
    const safetyWindowMs = 30000;

    if (tokenCache.token && tokenCache.expiresAtMs > nowMs() + safetyWindowMs) {
        return tokenCache.token;
    }

    const clientId = getKeycloakClientId();
    const clientSecret = getKeycloakClientSecret();
    if (!clientId || !clientSecret) {
        throw new Error("Missing ATS_KEYCLOAK_CLIENT_ID or ATS_KEYCLOAK_CLIENT_SECRET in ethicapp environment.");
    }

    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
    });

    const scope = getKeycloakScope();
    if (scope) {
        body.set("scope", scope);
    }

    const tokenResponse = await fetchJsonRaw(getKeycloakTokenUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    const accessToken = normalizeText(tokenResponse?.access_token);
    const expiresIn = Number(tokenResponse?.expires_in);

    if (!accessToken) {
        throw new Error("Keycloak token endpoint did not return access_token.");
    }

    tokenCache.token = accessToken;
    tokenCache.expiresAtMs = nowMs() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 300000);

    return tokenCache.token;
}

async function fetchAtsJson(pathname, { method = "GET", body = null } = {}) {
    const execute = async () => {
        const accessToken = await fetchAtsAccessToken();
        const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
        };

        return fetchJson(pathname, {
            method,
            headers,
            body: body == null ? null : JSON.stringify(body),
        });
    };

    try {
        return await execute();
    } catch (error) {
        if (Number(error?.statusCode) !== 401) {
            throw error;
        }

        tokenCache.token = null;
        tokenCache.expiresAtMs = 0;
        return execute();
    }
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
        sql: `
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
        sql: `
            SELECT id, name, descr
            FROM sessions
            WHERE id = $1
            LIMIT 1
        `,
        sqlParams: [rpg2.param("plain", Number(context.sessionId))],
    });

    const sessionTitle = normalizeText(sessionRow?.name) || `EthicApp session ${context.sessionId}`;
    const sessionDescription = normalizeText(sessionRow?.descr);
    const phaseDesign = await getPhaseDesignByPhaseId(context.phaseId);
    const phaseInstructions = normalizeText(phaseDesign?.instructions);
    const questionText = await resolveQuestionText(context);

    const caseText = sessionDescription || phaseInstructions || questionText || "Ethical discussion prompt.";
    const question = questionText || phaseInstructions || "Provide your ethical justification for the submitted response.";

    return {
        caseId: `ethicapp-session-${context.sessionId}-phase-${context.phaseId}`,
        caseTitle: sessionTitle,
        caseText,
        question,
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
            sql: `
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
        sql: `
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

        const response = await fetchAtsJson("/API/V2/sessions", {
            method: "POST",
            body: {
                case_id: metadata.caseId,
                case_title: metadata.caseTitle,
                case_text: metadata.caseText,
                question: metadata.question,
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
        await fetchAtsJson(`/API/V2/sessions/${encodeURIComponent(atsSessionId)}`, {
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

    const response = await fetchAtsJson(`/API/V2/sessions/${encodeURIComponent(atsSessionId)}/arguments`, {
        method: "POST",
        body: {
            argument: responseText,
            user_id: String(context.userId),
            client_context: {
                service: "ethicapp",
                sessionId: context.sessionId,
                phaseId: context.phaseId,
                questionId: context.questionId,
                groupId: Number.isInteger(groupId) ? groupId : null,
            },
        },
    });

    const taskId = normalizeText(response?.task_id);
    if (!taskId) {
        throw new Error("ATS did not return a task_id.");
    }

    return {
        atsSessionId,
        taskId,
        mode: "arguments",
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
        const response = await fetchAtsJson(`/API/V2/sessions/${encodeURIComponent(atsSessionId)}/arguments/compare`, {
            method: "POST",
            body: {
                revised_argument: responseText,
                user_id: String(context.userId),
                client_context: {
                    service: "ethicapp",
                    sessionId: context.sessionId,
                    phaseId: context.phaseId,
                    questionId: context.questionId,
                    groupId: Number.isInteger(groupId) ? groupId : null,
                },
            },
        });

        const taskId = normalizeText(response?.task_id);
        if (!taskId) {
            throw new Error("ATS did not return a task_id.");
        }

        return {
            atsSessionId,
            taskId,
            mode: "compare",
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

async function pollAtsTask({ atsSessionId, taskId }) {
    const startedAt = nowMs();
    const timeoutMs = getAtsPollTimeoutMs();
    const pollIntervalMs = getAtsPollIntervalMs();

    while (nowMs() - startedAt <= timeoutMs) {
        const statusResponse = await fetchAtsJson(
            `/API/V2/sessions/${encodeURIComponent(atsSessionId)}/arguments/${encodeURIComponent(taskId)}/status`,
            { method: "GET" }
        );

        const status = normalizeText(statusResponse?.status).toLowerCase();
        if (status === "success") {
            return statusResponse;
        }
        if (status === "failure") {
            const reason = normalizeText(statusResponse?.message) || "ATS returned failure status.";
            throw new Error(reason);
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error("ATS polling timed out before completing the feedback task.");
}

function normalizeCriteriaFromAts(parsedResult) {
    const claimScore = Number(parsedResult?.claim);
    const evidenceScore = Number(parsedResult?.evidence);
    const warrantScore = Number(parsedResult?.warrant);
    const qualifierScore = Number(parsedResult?.qualifier);

    const claimText = claimScore === 1
        ? "In favor"
        : claimScore === -1
            ? "Against"
            : "Neutral";

    return [
        {
            key: "claim",
            label: "Claim",
            value: Number.isFinite(claimScore) ? `${claimText} (${claimScore})` : "Not available",
        },
        {
            key: "evidence",
            label: "Evidence",
            value: Number.isFinite(evidenceScore) ? `${evidenceScore}/3` : "Not available",
        },
        {
            key: "warrant",
            label: "Warrant",
            value: Number.isFinite(warrantScore) ? `${warrantScore}/3` : "Not available",
        },
        {
            key: "qualifier",
            label: "Qualifier",
            value: Number.isFinite(qualifierScore) ? `${qualifierScore}/3` : "Not available",
        },
    ];
}

function normalizeBulletsFromAts(parsedResult) {
    const bullets = Array.isArray(parsedResult?.analysis_bullets) ? parsedResult.analysis_bullets : [];

    const normalized = bullets
        .map(item => normalizeText(item?.content))
        .filter(Boolean)
        .slice(0, 5);

    if (normalized.length > 0) {
        return normalized;
    }

    const analysisText = normalizeText(parsedResult?.analysis);
    if (analysisText) {
        return [analysisText];
    }

    return ["The argument was processed successfully by the external tutor."];
}

function buildFeedbackPayloadFromAtsStatus(statusResponse, context) {
    const rawMessage = statusResponse?.message;
    const parsedResult = typeof rawMessage === "string" ? safeJsonParse(rawMessage) : rawMessage;

    const criteria = normalizeCriteriaFromAts(parsedResult);
    const bullets = normalizeBulletsFromAts(parsedResult);
    const summary = normalizeText(parsedResult?.analysis) || "Argument feedback is now available.";

    return {
        version: "1",
        source: "argumentation-tutor-system",
        title: "Argument Tutor Feedback",
        summary,
        criteria,
        bullets,
        meta: {
            sessionId: context.sessionId,
            phaseId: context.phaseId,
            questionId: context.questionId,
            userId: context.userId,
        },
    };
}

function buildFeedbackPayloadFromExternalResult(requestPayload, fallbackContext) {
    const payloadRoot = requestPayload && typeof requestPayload === "object" ? requestPayload : {};
    const sourcePayload = payloadRoot?.payload?.feedback || payloadRoot?.payload || payloadRoot;
    const input = sourcePayload && typeof sourcePayload === "object" ? sourcePayload : {};

    const criteria = Array.isArray(input.criteria) ? input.criteria : [];
    const bullets = Array.isArray(input.bullets) ? input.bullets : [];

    return {
        version: "1",
        source: "argumentation-tutor-system",
        title: normalizeText(input.title) || "Argument Tutor Feedback",
        summary: normalizeText(input.summary) || normalizeText(payloadRoot.message) || "Argument feedback is now available.",
        criteria: criteria
            .map(item => ({
                key: normalizeText(item?.key) || normalizeText(item?.label).toLowerCase().replace(/\s+/gu, "-"),
                label: normalizeText(item?.label) || "Criterion",
                value: normalizeText(item?.value) || "Not available",
            }))
            .filter(item => item.label && item.value)
            .slice(0, 6),
        bullets: bullets
            .map(item => normalizeText(item))
            .filter(Boolean)
            .slice(0, 6),
        meta: {
            sessionId: Number(payloadRoot.sessionId) || fallbackContext?.sessionId || null,
            phaseId: Number(payloadRoot.phaseId) || fallbackContext?.phaseId || null,
            questionId: Number(payloadRoot.questionId) || fallbackContext?.questionId || null,
            userId: Number(payloadRoot.userId) || fallbackContext?.userId || null,
        },
    };
}

async function publishFeedbackToStudent({ context, feedbackPayload, status, publishStudentResult }) {
    const userId = Number(context?.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error("Cannot publish ATS feedback without a valid userId.");
    }

    await publishStudentResult({
        userId,
        sessionId: Number(context.sessionId) || null,
        phaseId: Number(context.phaseId) || null,
        questionId: Number(context.questionId) || null,
        component: {
            componentId: "argument-tutor-chat-feedback",
            title: "Argument Tutor Feedback",
        },
        payload: {
            feedback: feedbackPayload,
        },
        message: "Your argument tutor feedback is now available.",
        status: status || "completed",
    });
}

async function processStudentResponse({ context, callback, publishStudentResult }) {
    const responseText = extractResponseText(context);
    if (!responseText) {
        await callback({
            hook: "student-response-submitted",
            status: "skipped",
            reason: "No free-text response was found to send to ATS.",
        });
        return;
    }

    const groupId = await resolveGroupId(context);
    const { atsSessionId, taskId, mode } = await submitArgumentWithFlow(context, responseText, groupId);
    incrementSubmissionCount(context);
    const statusResponse = await pollAtsTask({ atsSessionId, taskId });
    const feedbackPayload = buildFeedbackPayloadFromAtsStatus(statusResponse, context);

    await publishFeedbackToStudent({
        context,
        feedbackPayload,
        status: "completed",
        publishStudentResult,
    });

    await callback({
        hook: "student-response-submitted",
        status: "completed",
        payload: {
            atsSessionId,
            taskId,
            groupId,
            mode,
            submissionCount: getSubmissionCount(context),
            publishedToUserId: Number(context.userId) || null,
            feedbackTitle: feedbackPayload.title,
        },
    });
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
        hook: "phaseEnded",
        status: "completed",
        payload: {
            clearedSubmissionCounters: removedKeys.length,
            clearedAtsSession: atsDeleteResult.deleted || Boolean(atsSessionId),
            atsSessionDeleteReason: atsDeleteResult.reason,
            atsSessionId,
            sessionId: Number(context.sessionId) || null,
            phaseId: Number(context.phaseId) || null,
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
            userId: Number(requestPayload?.userId) || context.userId,
        });

    const fallbackContext = {
        sessionId: Number(requestPayload?.sessionId) || context.sessionId,
        phaseId: Number(requestPayload?.phaseId) || context.phaseId,
        questionId: Number(requestPayload?.questionId) || context.questionId,
        userId: Number(requestPayload?.userId) || context.userId,
    };

    const feedbackPayload = buildFeedbackPayloadFromExternalResult(requestPayload, fallbackContext);
    await publishFeedbackToStudent({
        context: fallbackContext,
        feedbackPayload,
        status: normalizeText(requestPayload?.status) || "completed",
        publishStudentResult,
    });

    await callback({
        hook: "external-service-result",
        status: "completed",
        payload: {
            groupId,
            publishedToUserId: Number(fallbackContext.userId) || null,
            feedbackTitle: feedbackPayload.title,
        },
    });
}

export async function register({ subscribe, publishStudentResult }) {
    subscribe("student-response-submitted", async (context, { callback }) => {
        try {
            await processStudentResponse({ context, callback, publishStudentResult });
        } catch (error) {
            await callback({
                hook: "student-response-submitted",
                status: "failed",
                error: normalizeText(error?.message) || "Unexpected ATS adapter error.",
            });
        }
    });

    subscribe("external-service-result", async (context, { callback }) => {
        try {
            await processExternalResult({ context, callback, publishStudentResult });
        } catch (error) {
            await callback({
                hook: "external-service-result",
                status: "failed",
                error: normalizeText(error?.message) || "Unexpected external result adapter error.",
            });
        }
    });

    subscribe("phaseEnded", async (context, { callback }) => {
        try {
            await processPhaseEnded({ context, callback });
        } catch (error) {
            await callback({
                hook: "phaseEnded",
                status: "failed",
                error: normalizeText(error?.message) || "Unexpected phaseEnded handler error.",
            });
        }
    });
}
