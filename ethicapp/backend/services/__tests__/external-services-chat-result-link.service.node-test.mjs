import assert from "node:assert/strict";
import test from "node:test";
import { ExternalServicesRegistry } from "../external-services.service.js";

// publishGroupChatMessage() stores the callback result an agent message came
// from (#947), with fakes for the chat store and the agent upsert.

const SERVICE_ID = "svc-chat-agent";
const RESULT_ID = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";

function createRegistry() {
    const savedMessages = [];
    const registry = new ExternalServicesRegistry({
        jobsService:     {},
        roomJobsService: {},
        saveChatMessage: async data => {
            savedMessages.push(data);
            return {
                id:                         savedMessages.length,
                uid:                        null,
                external_agent_id:          data.externalAgentId,
                did:                        data.questionId,
                tmid:                       data.groupId,
                content:                    data.content,
                stime:                      "2026-11-02T10:00:00.000Z",
                parent_id:                  data.parentId,
                external_service_result_id: data.externalServiceResultId,
            };
        },
    });
    registry.getOrCreateExternalAgent = async ({ serviceId, displayName }) => ({
        id:          9,
        serviceId,
        displayName: displayName ?? serviceId,
    });
    return { registry, savedMessages };
}

const basePayload = {
    sessionId:        11,
    phaseId:          22,
    questionId:       701,
    groupId:          301,
    agentDisplayName: "ConversationGuide",
    content:          "Which tradeoff matters most here?",
};

test("publishGroupChatMessage stores the result id the adapter passes", async () => {
    const { registry, savedMessages } = createRegistry();

    const published = await registry.publishGroupChatMessage(SERVICE_ID, {
        ...basePayload,
        resultId: RESULT_ID,
    });

    assert.equal(savedMessages.length, 1);
    assert.deepEqual(savedMessages[0], {
        userId:                  null,
        externalAgentId:         9,
        externalServiceResultId: RESULT_ID,
        phaseId:                 22,
        questionId:              701,
        groupId:                 301,
        parentId:                null,
        content:                 "Which tradeoff matters most here?",
    });
    assert.equal(published.savedMessage.external_service_result_id, RESULT_ID);
    assert.equal(published.notificationPayload.author_name, "ConversationGuide");
});

test("publishGroupChatMessage stores NULL when no result id is passed", async () => {
    const { registry, savedMessages } = createRegistry();

    const published = await registry.publishGroupChatMessage(SERVICE_ID, basePayload);

    assert.equal(savedMessages.length, 1);
    assert.equal(savedMessages[0].externalServiceResultId, null);
    assert.ok(published.savedMessage);
});

test("publishGroupChatMessage normalizes the result id and drops one that is not a uuid", async () => {
    const { registry, savedMessages } = createRegistry();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(message);

    try {
        await registry.publishGroupChatMessage(SERVICE_ID, {
            ...basePayload,
            resultId: ` ${RESULT_ID.toUpperCase()} `,
        });
        await registry.publishGroupChatMessage(SERVICE_ID, {
            ...basePayload,
            resultId: "not-a-uuid",
        });
        await registry.publishGroupChatMessage(SERVICE_ID, {
            ...basePayload,
            resultId: 42,
        });
    } finally {
        console.warn = originalWarn;
    }

    // An invalid link never costs the message: it is saved without one.
    assert.deepEqual(
        savedMessages.map(message => message.externalServiceResultId),
        [RESULT_ID, null, null]
    );
    assert.equal(warnings.filter(message => message.includes("invalid result id")).length, 2);
});

test("publishGroupChatMessage saves nothing for an incomplete payload, result id or not", async () => {
    const { registry, savedMessages } = createRegistry();
    const originalWarn = console.warn;
    console.warn = () => {};

    try {
        const published = await registry.publishGroupChatMessage(SERVICE_ID, {
            ...basePayload,
            content:  "  ",
            resultId: RESULT_ID,
        });
        assert.equal(published, null);
    } finally {
        console.warn = originalWarn;
    }

    assert.equal(savedMessages.length, 0);
});

// The per-message author name (#1026, epic #1025): the live notification shows
// it, while the agent row keeps the canonical name.
test("publishGroupChatMessage notifies the message's author name and keeps the agent row's", async () => {
    const { registry } = createRegistry();
    const agents = [];
    const getOrCreate = registry.getOrCreateExternalAgent;
    registry.getOrCreateExternalAgent = async input => {
        agents.push(input);
        return getOrCreate(input);
    };

    const published = await registry.publishGroupChatMessage(SERVICE_ID, {
        ...basePayload,
        authorName: "  agente  ",
        resultId:   RESULT_ID,
    });

    assert.deepEqual(agents, [{ serviceId: SERVICE_ID, displayName: "ConversationGuide" }]);
    assert.equal(published.notificationPayload.author_name, "agente");
    assert.equal(published.notificationPayload.external_agent_id, 9);
});

test("publishGroupChatMessage falls back to the agent row's name without a usable author name", async () => {
    for (const authorName of [undefined, null, "", "   ", 42, { name: "x" }]) {
        const { registry } = createRegistry();

        const published = await registry.publishGroupChatMessage(SERVICE_ID, { ...basePayload, authorName });

        assert.equal(published.notificationPayload.author_name, "ConversationGuide", String(authorName));
    }
});

test("publishGroupChatMessage cuts a long author name to 80 characters", async () => {
    const { registry } = createRegistry();

    const published = await registry.publishGroupChatMessage(SERVICE_ID, {
        ...basePayload,
        authorName: "ñ".repeat(100),
    });

    assert.equal(published.notificationPayload.author_name, "ñ".repeat(80));
});
