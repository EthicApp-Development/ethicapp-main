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
}
