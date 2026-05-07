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

    return {
        serviceId:  input.serviceId,
        status:     status,
        payload:    input.payload && typeof input.payload === "object" ? input.payload : {},
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

export async function register({ service, subscribe }) {
    subscribe("student-response-submitted", async (context, { callback }) => {
        const responseText = extractResponseText(context);
        const wordCount = responseText ? responseText.split(/\s+/u).length : 0;

        await callback({
            serviceId: service.id,
            hook:      "student-response-submitted",
            status:    "completed",
            payload:   {
                sessionId: context.sessionId,
                phaseId:   context.phaseId,
                userId:    context.userId,
                questionId: context.questionId,
                summary:   responseText
                    ? `Mock review received ${wordCount} word(s).`
                    : "Mock review received a response without free-text justification.",
                analysis: {
                    wordCount,
                    hasFreeText: responseText.length > 0,
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
        await callback({
            serviceId: service.id,
            hook:      "external-service-result",
            status:    "completed",
            payload:   sanitizeExternalResultPayload(context.requestPayload),
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
