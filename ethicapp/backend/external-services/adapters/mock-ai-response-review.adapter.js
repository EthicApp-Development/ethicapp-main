function extractResponseText(responsePayload) {
    const candidates = [
        responsePayload?.payload?.justification,
        responsePayload?.requestPayload?.justification,
        responsePayload?.payload?.comment,
        responsePayload?.requestPayload?.comment,
        responsePayload?.payload?.description,
        responsePayload?.requestPayload?.description,
        responsePayload?.response?.comment,
        responsePayload?.response?.description,
    ];

    return candidates.find(value => typeof value === "string" && value.trim().length > 0)?.trim() || "";
}

async function postExternalMock(path, payload) {
    const baseUrl = process.env.EXTERNAL_MOCK_SERVICE_URL || "http://external-mock-service:8510";
    const response = await fetch(`${baseUrl}${path}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`External mock service responded with HTTP ${response.status}`);
    }

    return response.json();
}

// The schema of the documents this adapter publishes to students, declared in
// its catalog entry's `studentOutputs` (#1134).
export const MOCK_DOCUMENT_SCHEMA = "student-result/v1";

// The language of the mock's documents. The hook context does not carry the
// activity's locale, so the mock writes in EthicApp's default activity
// language (`designs.language_code`). external-mock-service also writes
// `en-US` when asked.
export const MOCK_DOCUMENT_LOCALE = "es-CL";

// The document published when external-mock-service does not answer: the
// contract's way of saying that the result could not be produced.
export function unavailableReviewDocument() {
    return {
        schemaVersion: MOCK_DOCUMENT_SCHEMA,
        locale:        MOCK_DOCUMENT_LOCALE,
        title:         "Revisión de prueba de tu respuesta",
        summary:       "El servicio de prueba no respondió, así que esta revisión no está disponible.",
        status:        "unavailable",
        sections:      [],
    };
}

// Asks external-mock-service for its review of `responseText`: a
// student-result/v1 document with every section kind (#1134).
async function reviewResponseText(responseText) {
    try {
        const review = await postExternalMock("/response-review/student-result", {
            text:   responseText,
            locale: MOCK_DOCUMENT_LOCALE,
        });
        return {
            status:         review?.status || "completed",
            documentSchema: review?.documentSchema,
            document:       review?.document,
            available:      true,
        };
    } catch (error) {
        // The error only: the request carried the student's text.
        console.warn(
            "[external-services] The external mock service did not review a response; "
            + "publishing an unavailable review.",
            error?.message
        );
        return {
            status:         "completed",
            documentSchema: MOCK_DOCUMENT_SCHEMA,
            document:       unavailableReviewDocument(),
            available:      false,
        };
    }
}

async function callbackPhaseTransition({ service, context, callback, hook }) {
    await callback({
        serviceId: service.id,
        hook,
        status:    "completed",
        payload:   {
            sessionId:      context.sessionId,
            phaseId:        context.phaseId,
            startedPhaseId: context.startedPhaseId,
            endedPhaseId:   context.endedPhaseId,
            summary:        hook === "phase-started"
                ? `Mock service observed phase ${context.startedPhaseId} starting.`
                : `Mock service observed phase ${context.endedPhaseId} ending.`,
        },
    });
}

// The destination a callback names: the student its result is published to.
// The registry refuses the callback when it differs from its job (#815).
export function getCallbackTarget(requestPayload) {
    const { sessionId, phaseId, questionId, userId } = sanitizeExternalResultPayload(requestPayload);
    return { sessionId, phaseId, questionId, userId };
}

// A callback posted for this adapter, reduced to what it may publish: the
// destination, a status and message, and a document (#1134). It carries no
// legacy `component`: the mock publishes documents only.
function sanitizeExternalResultPayload(payload) {
    const input = payload && typeof payload === "object" ? payload : {};
    const status = typeof input.status === "string" && input.status.trim()
        ? input.status.trim()
        : "received";
    const document = input.document && typeof input.document === "object" ? input.document : null;

    return {
        serviceId:      input.serviceId,
        sessionId:      Number(input.sessionId) || null,
        phaseId:        Number(input.phaseId) || null,
        questionId:     Number(input.questionId) || null,
        userId:         Number(input.userId) || null,
        status:         status,
        documentSchema: typeof input.documentSchema === "string" ? input.documentSchema : null,
        document,
        message:        typeof input.message === "string" ? input.message.trim() : "",
        receivedAt:     new Date().toISOString(),
    };
}

function summarizeChatMessage(context) {
    const content = typeof context.content === "string" ? context.content.trim() : "";
    const wordCount = content ? content.split(/\s+/u).length : 0;

    return {
        sessionId:  context.sessionId,
        phaseId:    context.phaseId,
        questionId: context.questionId,
        groupId:    context.groupId,
        userId:     context.userId,
        messageId:  context.savedMessage?.id,
        parentId:   context.parentId,
        summary:    content
            ? `Mock chat observer received ${wordCount} word(s).`
            : "Mock chat observer received an empty chat message.",
        analysis: {
            wordCount,
            hasContent: content.length > 0,
        },
    };
}

// The report-building contribution (#945): one column on the responses
// report, for verifying the merge locally. This mock keeps no result of its
// own for a response (its hook callbacks only advance the job), so the column
// fills every row and counts the stored results whose job processed that
// response, which are those of callbacks posted to it.
export const REPORT_NOTE_COLUMN = "mockreview_note";

export async function buildReportContribution(context, { results }) {
    if (context.reportType !== "responses") {
        return null;
    }

    const stored = await results.list({ hookName: "student-response-submitted" });
    const countByResponse = new Map();
    for (const result of stored) {
        if (result.source?.kind === "response") {
            countByResponse.set(result.source.id, (countByResponse.get(result.source.id) || 0) + 1);
        }
    }

    return {
        columns: [{ id: REPORT_NOTE_COLUMN, label: "Mock review" }],
        values:  context.rows.map(row => ({
            rowKey: row.responseId,
            values: {
                [REPORT_NOTE_COLUMN]: `Mock review of response ${row.responseId}: `
                    + `${countByResponse.get(row.responseId) || 0} stored result(s).`,
            },
        })),
    };
}

export async function register({ service, subscribe, publishStudentResult }) {
    subscribe("report-building", buildReportContribution);

    subscribe("student-response-submitted", async (context, { callback }) => {
        const responseText = extractResponseText(context);
        const wordCount = responseText ? responseText.split(/\s+/u).length : 0;
        const review = await reviewResponseText(responseText);

        // The registry checks the document against the schema copy and the
        // catalog entry's declaration, and logs a refusal with codes only.
        const published = context.userId
            ? await publishStudentResult({
                userId:         context.userId,
                sessionId:      context.sessionId,
                phaseId:        context.phaseId,
                questionId:     context.questionId,
                message:        "A mock review is available for your response.",
                status:         review.status,
                documentSchema: review.documentSchema,
                document:       review.document,
            })
            : false;

        // Ids and counts only: the job result is not for students' text.
        await callback({
            serviceId: service.id,
            hook:      "student-response-submitted",
            status:    "completed",
            payload:   {
                sessionId:  context.sessionId,
                phaseId:    context.phaseId,
                userId:     context.userId,
                questionId: context.questionId,
                summary:    `Mock review of ${wordCount} word(s).`,
                analysis:   {
                    wordCount,
                    hasFreeText:     responseText.length > 0,
                    reviewAvailable: review.available,
                    published:       published === true,
                },
            },
        });
    });

    subscribe("phase-started", async (context, { callback }) => {
        await callbackPhaseTransition({ service, context, callback, hook: "phase-started" });
    });

    subscribe("phase-ended", async (context, { callback }) => {
        await callbackPhaseTransition({ service, context, callback, hook: "phase-ended" });
    });

    subscribe("callback-received", async (context, { callback }) => {
        const payload = sanitizeExternalResultPayload(context.requestPayload);

        // A callback publishes only a document; anything else is recorded.
        if (payload.userId && payload.document) {
            await publishStudentResult({
                userId:         payload.userId,
                sessionId:      payload.sessionId,
                phaseId:        payload.phaseId,
                questionId:     payload.questionId,
                resultId:       context.resultId,
                message:        payload.message,
                status:         payload.status,
                documentSchema: payload.documentSchema,
                document:       payload.document,
            });
        }

        await callback({
            serviceId: service.id,
            hook:      "callback-received",
            status:    "completed",
            payload,
        });
    });

    subscribe("chat-message-received", async (context, { callback }) => {
        await callback({
            serviceId: service.id,
            hook:      "chat-message-received",
            status:    "completed",
            payload:   summarizeChatMessage(context),
        });
    });
}
