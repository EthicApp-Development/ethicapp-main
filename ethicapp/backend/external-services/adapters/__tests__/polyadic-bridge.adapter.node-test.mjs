import assert from "node:assert/strict";
import test from "node:test";
import {
    composeTopic,
    formatQuestionText,
    getRoomName,
    parseRoomName,
    register,
} from "../polyadic-bridge.adapter.js";

function createHarness({ dependencies = {} } = {}) {
    const subscribers = new Map();
    const requests = [];
    const callbacks = [];
    const publishedMessages = [];

    const client = {
        buildServiceUrl(pathname) {
            return `http://ai.local${pathname}`;
        },
        async requestJson(pathname, options) {
            requests.push({ pathname, options });
            return { status: "ok" };
        },
    };

    const defaultDependencies = {
        getTeamIdsForPhase: async () => [301, 302],
        getFirstQuestionIdForPhase: async () => 701,
        getFirstQuestionForPhase: async () => ({
            id: 701,
            title: "Should the team intervene?",
            tleft: "Intervene",
            tright: "Do not intervene",
        }),
        getCaseIdBySessionId: async () => 51,
        getCaseDocumentRawText: async () => "Case text for discussion.",
        ...dependencies,
    };

    return {
        subscribers,
        requests,
        callbacks,
        publishedMessages,
        async initialize() {
            await register({
                service: { id: "polyadic-devils-advocate" },
                subscribe(hookName, handler) {
                    subscribers.set(hookName, handler);
                },
                async publishGroupChatMessage(payload) {
                    publishedMessages.push(payload);
                    return { savedMessage: { id: publishedMessages.length } };
                },
                aiAdditionsClient: client,
                polyadicBridgeDependencies: defaultDependencies,
            });
        },
        async dispatch(hookName, context) {
            const handler = subscribers.get(hookName);
            assert.equal(typeof handler, "function", `Missing subscriber for ${hookName}`);
            await handler(context, {
                callback: async result => {
                    callbacks.push(result);
                    return result;
                },
            });
        },
    };
}

test("polyadic bridge formats stable room names and topics", () => {
    assert.equal(getRoomName(10, 20, 30), "ethicapp-s10-p20-g30");
    assert.deepEqual(parseRoomName("ethicapp-s10-p20-g30"), {
        sessionId: 10,
        phaseId:   20,
        groupId:   30,
    });
    assert.equal(parseRoomName("other-room"), null);
    assert.equal(
        formatQuestionText({
            title: "Initial question",
            tleft: "Agree",
            tright: "Disagree",
        }),
        "Initial question | Agree vs. Disagree"
    );
    assert.equal(
        composeTopic("Case body", "Initial question"),
        "Case body\n\nCentral question: Initial question"
    );
});

test("phaseStarted creates one Polyadic room per EthicApp group", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("phaseStarted", { sessionId: 11, phaseId: 22 });

    assert.equal(harness.requests.length, 2);
    assert.deepEqual(
        harness.requests.map(request => request.pathname),
        [
            "/rooms/ethicapp-s11-p22-g301/sessions",
            "/rooms/ethicapp-s11-p22-g302/sessions",
        ]
    );
    assert.equal(harness.requests[0].options.method, "POST");
    assert.equal(harness.requests[0].options.authenticated, true);
    assert.equal(harness.requests[0].options.baseUrl, "http://ai.local/polyadic-agent/api");
    assert.equal(harness.requests[0].options.body.pipeline_type, "abogado-del-diablo");
    assert.match(harness.requests[0].options.body.prompt_inicial, /Case text for discussion/);
    assert.match(harness.requests[0].options.body.prompt_inicial, /Should the team intervene/);
    assert.equal(harness.callbacks.at(-1).payload.roomsCreated, 2);
});

test("chat-message-received creates a missing room and forwards the message", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase: async () => [],
        },
    });
    await harness.initialize();

    await harness.dispatch("chat-message-received", {
        sessionId: 11,
        phaseId: 22,
        questionId: 701,
        groupId: 301,
        userId: 9001,
        content: "  We should discuss the consequences.  ",
    });

    assert.deepEqual(
        harness.requests.map(request => `${request.options.method} ${request.pathname}`),
        [
            "POST /rooms/ethicapp-s11-p22-g301/sessions",
            "POST /rooms/ethicapp-s11-p22-g301/messages",
        ]
    );
    assert.deepEqual(harness.requests[1].options.body, {
        username: "user-9001",
        content: "We should discuss the consequences.",
    });
    assert.equal(harness.callbacks.at(-1).status, "completed");
});

test("external-service-result publishes only Orientador responses to group chat", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("external-service-result", {
        requestPayload: {
            room: "ethicapp-s11-p22-g301",
            evaluations: [
                { agente: "Validador", respuesta: "NO_INTERVENIR: active debate" },
                { agente: "Orientador", respuesta: "What assumption is your group making?" },
            ],
        },
    });

    assert.equal(harness.publishedMessages.length, 1);
    assert.deepEqual(harness.publishedMessages[0], {
        sessionId: 11,
        phaseId: 22,
        questionId: 701,
        groupId: 301,
        agentDisplayName: "Orientador",
        content: "What assumption is your group making?",
    });
    assert.equal(harness.callbacks.at(-1).payload.messagesPublished, 1);
});

test("phaseEnded closes rooms created for that phase", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("phaseStarted", { sessionId: 11, phaseId: 22 });
    await harness.dispatch("phaseEnded", { sessionId: 11, phaseId: 22 });

    assert.deepEqual(
        harness.requests.slice(2).map(request => `${request.options.method} ${request.pathname}`),
        [
            "DELETE /rooms/ethicapp-s11-p22-g301/sessions/active",
            "DELETE /rooms/ethicapp-s11-p22-g302/sessions/active",
        ]
    );
    assert.equal(harness.callbacks.at(-1).payload.roomsClosed, 2);
});
