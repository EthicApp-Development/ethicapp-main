// Without an AI Additions connection no adapter path sends a request (#814).
// Every adapter gets the real AiAdditionsClient over a connection store that
// holds nothing, and a fetch that fails the test if it is ever called.
import assert from "node:assert/strict";
import test from "node:test";
import { AiAdditionsClient } from "../../../services/ai-additions-client.service.js";
import * as atsFeedback from "../ats-feedback.adapter.js";
import * as caseAnalyst from "../case-analyst.adapter.js";
import * as polyadicBridge from "../polyadic-bridge.adapter.js";

function noConnectionClient(requests) {
    return new AiAdditionsClient({
        env: {
            AI_ADDITIONS_KEYCLOAK_CLIENT_ID:     "ethicapp-platform",
            AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET: "secret",
        },
        getConnection: async () => null,
        fetchImpl:     async (url) => {
            requests.push(url);
            throw new Error(`no request may leave the host, got ${url}`);
        },
    });
}

async function registerAdapter(adapter, serviceId, client, extra = {}) {
    const subscribers = new Map();
    await adapter.register({
        service:                 { id: serviceId },
        subscribe:               (hookName, handler) => subscribers.set(hookName, handler),
        publishStudentResult:    async () => null,
        publishGroupChatMessage: async () => null,
        aiAdditionsClient:       client,
        ...extra,
    });

    return async function dispatch(hookName, context) {
        const callbacks = [];
        let thrown = null;
        try {
            await subscribers.get(hookName)(context, {
                callback:            async result => { callbacks.push(result); },
                reportInstantiation: async () => null,
            });
        } catch (error) {
            thrown = error;
        }
        return { callbacks, thrown };
    };
}

async function quietly(run) {
    const { info, warn } = console;
    console.info = () => {};
    console.warn = () => {};
    try {
        return await run();
    } finally {
        console.info = info;
        console.warn = warn;
    }
}

const polyadicDependencies = {
    getTeamIdsForPhase:         async () => [301],
    getFirstQuestionIdForPhase: async () => 701,
    getFirstQuestionForPhase:   async () => ({ id: 701, title: "Q", tleft: "A", tright: "B" }),
    getCaseIdBySessionId:       async () => 51,
    getCaseDocumentRawText:     async () => "Case text.",
    getParticipantIdentity:     async () => null,
    getSessionLanguageCode:     async () => "es_CL",
};

for (const authenticated of ["true", "false"]) {
    test(`polyadic bridge: phase-started fails with not_configured (AUTHENTICATED=${authenticated})`, async () => {
        const original = process.env.AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED;
        process.env.AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED = authenticated;
        const requests = [];
        try {
            const dispatch = await registerAdapter(polyadicBridge, "polyadic-devils-advocate",
                noConnectionClient(requests), { polyadicBridgeDependencies: polyadicDependencies });

            const { thrown } = await quietly(() => dispatch("phase-started", { sessionId: 1, phaseId: 2 }));

            assert.equal(thrown?.code, "not_configured");
            assert.deepEqual(requests, []);
        } finally {
            if (original === undefined) {
                delete process.env.AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED;
            } else {
                process.env.AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED = original;
            }
        }
    });

    test(`polyadic bridge: chat-message-received sends nothing (AUTHENTICATED=${authenticated})`, async () => {
        const original = process.env.AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED;
        process.env.AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED = authenticated;
        const requests = [];
        try {
            const dispatch = await registerAdapter(polyadicBridge, "polyadic-devils-advocate",
                noConnectionClient(requests), { polyadicBridgeDependencies: polyadicDependencies });

            const { callbacks, thrown } = await quietly(() => dispatch("chat-message-received", {
                sessionId: 1,
                phaseId:   2,
                groupId:   301,
                userId:    9,
                content:   "Hello",
            }));

            assert.deepEqual(requests, []);
            const failure = thrown ?? callbacks.find(result => result.status === "failed");
            assert.ok(failure, "the hook reports a failure");
        } finally {
            if (original === undefined) {
                delete process.env.AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED;
            } else {
                process.env.AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED = original;
            }
        }
    });
}

test("argumentation tutor: a student response fails with not_configured before any work", async () => {
    const requests = [];
    const dispatch = await registerAdapter(atsFeedback, "ats-feedback", noConnectionClient(requests));

    const { callbacks, thrown } = await dispatch("student-response-submitted", {
        sessionId:       1,
        phaseId:         2,
        userId:          3,
        responsePayload: { comment: "My argument." },
    });

    assert.equal(thrown, null);
    assert.equal(callbacks.length, 1);
    assert.equal(callbacks[0].status, "failed");
    assert.match(callbacks[0].error, /not configured/u);
    assert.deepEqual(requests, []);
});

test("argumentation tutor: every API request rejects with not_configured", async () => {
    const requests = [];
    await registerAdapter(atsFeedback, "ats-feedback", noConnectionClient(requests));

    await assert.rejects(() => atsFeedback.requestAtsJson("/sessions", { method: "POST", body: {} }),
        { code: "not_configured" });
    assert.deepEqual(requests, []);
});

test("case analyst: case-created fails with not_configured", async () => {
    const requests = [];
    const dispatch = await registerAdapter(caseAnalyst, "case-analyst", noConnectionClient(requests));

    const { callbacks } = await quietly(() => dispatch("case-created", { caseId: 42 }));

    assert.equal(callbacks.length, 1);
    assert.equal(callbacks[0].status, "failed");
    assert.match(callbacks[0].error, /not configured/u);
    assert.deepEqual(requests, []);
    await assert.rejects(() => caseAnalyst.getCaseAnalystBaseUrl(noConnectionClient(requests)),
        { code: "not_configured" });
});
