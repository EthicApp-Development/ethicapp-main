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

// The report-building contribution (#945), for verifying the merge locally:
// a column that marks the agent's own messages as shown to students, and,
// for each group the agent spoke in, a summary row it never showed them,
// placed a second after its last message there. It reads the transcript's
// rows only: this mock keeps no results of its own.
export const REPORT_SHOWN_COLUMN = "mockchat_shown_to_students";
export const REPORT_SUMMARY_OFFSET_MS = 1000;

export function buildReportContribution(context, serviceId) {
    if (context.reportType !== "chat_transcript") {
        return null;
    }

    const groups = new Map();
    for (const row of context.rows) {
        const key = `${row.phaseId}:${row.questionId}:${row.groupId}`;
        const group = groups.get(key) || { row, total: 0, own: 0, lastOwnTime: null };
        group.total += 1;
        if (row.externalServiceId === serviceId) {
            group.own += 1;
            const time = new Date(row.time).getTime();
            group.lastOwnTime = Math.max(group.lastOwnTime ?? time, time);
        }
        groups.set(key, group);
    }

    const ownRows = context.rows.filter(row => row.externalServiceId === serviceId);
    return {
        columns: [{ id: REPORT_SHOWN_COLUMN, label: "Shown to students" }],
        values:  ownRows.map(row => ({
            rowKey: row.messageId,
            values: { [REPORT_SHOWN_COLUMN]: true },
        })),
        rows: Array.from(groups.values())
            .filter(group => group.own > 0 && Number.isFinite(group.lastOwnTime))
            .map(group => ({
                phaseId:    group.row.phaseId,
                questionId: group.row.questionId,
                groupId:    group.row.groupId,
                time:       new Date(group.lastOwnTime + REPORT_SUMMARY_OFFSET_MS).toISOString(),
                message:    `Mock chat agent summary: ${group.total} message(s) in this group, `
                    + `${group.own} from the agent.`,
                values:     { [REPORT_SHOWN_COLUMN]: false },
            })),
    };
}

export async function register({ service, subscribe, publishGroupChatMessage }) {
    subscribe("report-building", async context => buildReportContribution(context, service.id));

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
