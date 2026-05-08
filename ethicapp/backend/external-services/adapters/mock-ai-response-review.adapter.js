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

async function reverseResponseText(responseText) {
    try {
        return await postExternalMock("/response-review/reverse", { text: responseText });
    } catch (error) {
        console.warn("[external-services] Falling back to local mock response review.", error);
        const reversedText = Array.from(responseText).reverse().join("");

        return {
            status:  "completed",
            summary: reversedText || "No text was provided.",
            payload: {
                originalText: responseText,
                reversedText,
                characterCount: responseText.length,
            },
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
            summary:        hook === "phaseStarted"
                ? `Mock service observed phase ${context.startedPhaseId} starting.`
                : `Mock service observed phase ${context.endedPhaseId} ending.`,
        },
    });
}

function sanitizeExternalResultPayload(payload) {
    const input = payload && typeof payload === "object" ? payload : {};
    const status = typeof input.status === "string" && input.status.trim()
        ? input.status.trim()
        : "received";
    const resultPayload = input.payload && typeof input.payload === "object" ? input.payload : {};
    const component = input.component && typeof input.component === "object"
        ? input.component
        : {
            componentId: "argument-tutor-report",
            propsPath:   "payload",
        };

    return {
        serviceId:  input.serviceId,
        sessionId:  Number(input.sessionId) || null,
        phaseId:    Number(input.phaseId) || null,
        questionId: Number(input.questionId) || null,
        userId:     Number(input.userId) || null,
        status:     status,
        component,
        payload:    resultPayload,
        message:    typeof input.message === "string" ? input.message.trim() : "",
        receivedAt: new Date().toISOString(),
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

export async function register({ service, subscribe, publishStudentResult }) {
    subscribe("student-response-submitted", async (context, { callback }) => {
        const responseText = extractResponseText(context);
        const wordCount = responseText ? responseText.split(/\s+/u).length : 0;
        const review = await reverseResponseText(responseText);

        await callback({
            serviceId: service.id,
            hook:      "student-response-submitted",
            status:    "completed",
            payload:   {
                sessionId: context.sessionId,
                phaseId:   context.phaseId,
                userId:    context.userId,
                questionId: context.questionId,
                summary:   review.summary,
                analysis: {
                    wordCount,
                    hasFreeText: responseText.length > 0,
                    externalMock: review.payload,
                },
            },
        });
    });

    subscribe("phaseStarted", async (context, { callback }) => {
        await callbackPhaseTransition({ service, context, callback, hook: "phaseStarted" });
    });

    subscribe("phaseEnded", async (context, { callback }) => {
        await callbackPhaseTransition({ service, context, callback, hook: "phaseEnded" });
    });

    subscribe("external-service-result", async (context, { callback }) => {
        const payload = sanitizeExternalResultPayload(context.requestPayload);

        if (payload.userId) {
            await publishStudentResult({
                userId: payload.userId,
                sessionId: payload.sessionId,
                phaseId: payload.phaseId,
                questionId: payload.questionId,
                component: payload.component,
                payload: payload.payload,
                message: payload.message,
                status: payload.status,
            });
        }

        await callback({
            serviceId: service.id,
            hook:      "external-service-result",
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
