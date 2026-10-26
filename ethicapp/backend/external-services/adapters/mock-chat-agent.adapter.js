const groupTranscripts = new Map();

function getTranscriptKey(context) {
    return `${context.phaseId}:${context.groupId}`;
}

function rememberMessage(context) {
    const key = getTranscriptKey(context);
    const transcript = groupTranscripts.get(key) || [];
    const content = typeof context.content === "string" ? context.content.trim() : "";

    transcript.push({
        userId: context.userId,
        messageId: context.savedMessage?.id,
        content,
        receivedAt: new Date().toISOString(),
    });

    groupTranscripts.set(key, transcript.slice(-20));
    return groupTranscripts.get(key);
}

function buildAgentReply(context, transcript) {
    const latestContent = typeof context.content === "string" ? context.content.trim() : "";
    const messageCount = transcript.length;

    if (messageCount === 1) {
        return "Mock chat agent joined the conversation. I will summarize and ask follow-up questions as your group discusses.";
    }

    if (latestContent.endsWith("?")) {
        return `Mock chat agent noticed a question: "${latestContent}" Consider naming one assumption before deciding.`;
    }

    return `Mock chat agent has seen ${messageCount} message(s) in this group. Try adding one reason or counterexample to move the discussion forward.`;
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

async function buildExternalAgentReply(context, transcript) {
    try {
        const result = await postExternalMock("/chat-agent/respond", {
            sessionId: context.sessionId,
            phaseId: context.phaseId,
            questionId: context.questionId,
            groupId: context.groupId,
            userId: context.userId,
            messageId: context.savedMessage?.id,
            content: context.content,
            transcript,
        });

        return {
            content: result.message,
            payload: result.payload,
        };
    } catch (error) {
        console.warn("[external-services] Falling back to local mock chat agent.", error);
        return {
            content: buildAgentReply(context, transcript),
            payload: null,
        };
    }
}

export async function register({ service, subscribe, publishGroupChatMessage }) {
    subscribe("chat-message-received", async (context, { callback }) => {
        const transcript = rememberMessage(context);
        const agentReply = await buildExternalAgentReply(context, transcript);

        const publishedMessage = await publishGroupChatMessage({
            sessionId: context.sessionId,
            phaseId: context.phaseId,
            questionId: context.questionId,
            groupId: context.groupId,
            parentId: context.savedMessage?.id,
            agentDisplayName: "Mock chat agent",
            content: agentReply.content,
        });

        await callback({
            serviceId: service.id,
            hook:      "chat-message-received",
            status:    publishedMessage ? "completed" : "skipped",
            payload:   {
                sessionId:    context.sessionId,
                phaseId:      context.phaseId,
                questionId:   context.questionId,
                groupId:      context.groupId,
                sourceUserId: context.userId,
                messageId:    context.savedMessage?.id,
                agentMessageId: publishedMessage?.savedMessage?.id,
                transcriptSize: transcript.length,
                response:     agentReply.content,
                externalMock: agentReply.payload,
            },
        });
    });
}
