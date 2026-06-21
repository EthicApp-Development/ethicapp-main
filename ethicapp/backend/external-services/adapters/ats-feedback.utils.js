export function buildArgumentClientContext(context, groupId) {
    return {
        service:       "ethicapp",
        correlationId: context.correlationId ?? null,
        sessionId:     context.sessionId,
        phaseId:       context.phaseId,
        questionId:    context.questionId,
        groupId:       Number.isInteger(groupId) ? groupId : null,
    };
}
