import assert from "node:assert/strict";
import test from "node:test";
import {
    buildPolyadicSessionPayload,
    composeTopic,
    formatQuestionText,
    getRoomName,
    parseRoomName,
    register,
    resolvePolyadicLocale,
    resolvePolyadicUsername,
} from "../polyadic-bridge.adapter.js";
import { buildRoomActivityBody } from "../polyadic-bridge.activity.js";
import {
    normalizeParticipantActivityContext,
} from "../../../services/external-service-ephemeral-hooks.js";

function createHarness({ dependencies = {}, respond = null } = {}) {
    const subscribers = new Map();
    const requests = [];
    const callbacks = [];
    const reports = [];
    const publishedMessages = [];

    const client = {
        async getEndpoints() {
            return { baseUrl: "http://ai.local" };
        },
        async requestJson(pathname, options) {
            requests.push({ pathname, options });
            return respond ? respond(pathname, options, requests.length) : { status: "ok" };
        },
    };

    const defaultDependencies = {
        getTeamIdsForPhase:         async () => [301, 302],
        getFirstQuestionIdForPhase: async () => 701,
        getFirstQuestionForPhase:   async () => ({
            id:     701,
            title:  "Should the team intervene?",
            tleft:  "Intervene",
            tright: "Do not intervene",
        }),
        getCaseIdBySessionId:   async () => 51,
        getCaseDocumentRawText: async () => "Case text for discussion.",
        getParticipantIdentity: async () => null,
        getSessionLanguageCode: async () => "es_CL",
        ...dependencies,
    };

    return {
        subscribers,
        requests,
        callbacks,
        reports,
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
                aiAdditionsClient:          client,
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
                reportInstantiation: async report => {
                    reports.push(report);
                    return report;
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
            title:  "Initial question",
            tleft:  "Agree",
            tright: "Disagree",
        }),
        "Initial question | Agree vs. Disagree"
    );
    assert.equal(
        composeTopic("Case body", "Initial question"),
        "Case body\n\nCentral question: Initial question"
    );
});

test("phase-started creates one Polyadic room per EthicApp group", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });

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
    assert.equal(harness.requests[0].options.basePath, "/polyadic-agent/api");
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
        sessionId:     11,
        phaseId:       22,
        questionId:    701,
        groupId:       301,
        userId:        9001,
        correlationId: "corr-msg-001",
        content:       "  We should discuss the consequences.  ",
    });

    assert.deepEqual(
        harness.requests.map(request => `${request.options.method} ${request.pathname}`),
        [
            "POST /rooms/ethicapp-s11-p22-g301/sessions",
            "POST /rooms/ethicapp-s11-p22-g301/messages",
        ]
    );
    assert.deepEqual(harness.requests[1].options.body, {
        username:                "user-9001",
        content:                 "We should discuss the consequences.",
        participant_id:          "9001",
        ethicapp_correlation_id: "corr-msg-001",
    });
    // Session creation does NOT carry correlationId — only message forwarding does.
    assert.equal(harness.requests[0].options.body.ethicapp_correlation_id, undefined);
    assert.equal(harness.callbacks.at(-1).status, "completed");
});

test("chat-message-received includes ethicapp_correlation_id only in message forwarding, not session creation", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase: async () => [],
        },
    });
    await harness.initialize();

    await harness.dispatch("chat-message-received", {
        sessionId:     11,
        phaseId:       22,
        groupId:       301,
        userId:        9001,
        correlationId: "corr-msg-002",
        content:       "Test message",
    });

    // Session creation (index 0): no correlationId
    assert.equal(harness.requests[0].options.body.ethicapp_correlation_id, undefined);
    // Message forwarding (index 1): carries correlationId
    assert.equal(harness.requests[1].options.body.ethicapp_correlation_id, "corr-msg-002");
});

test("phase-started session creation does not include ethicapp_correlation_id", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase: async () => [301, 302],
        },
    });
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22, correlationId: "corr-phase-001" });

    // Both rooms created without correlationId — avoids fan-out idempotency issue.
    assert.equal(harness.requests[0].options.body.ethicapp_correlation_id, undefined);
    assert.equal(harness.requests[1].options.body.ethicapp_correlation_id, undefined);
});

test("ethicapp_correlation_id defaults to null when correlationId absent from chat-message-received", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase: async () => [],
        },
    });
    await harness.initialize();

    // Dispatch to an existing room so only the message forwarding request is made.
    await harness.dispatch("chat-message-received", {
        sessionId: 11,
        phaseId:   22,
        groupId:   301,
        userId:    9001,
        content:   "Hello",
    });
    // Message forwarding without correlationId → null, not undefined.
    const messageRequest = harness.requests.find(r => r.pathname.includes("/messages"));
    assert.equal(messageRequest.options.body.ethicapp_correlation_id, null);
});

test("callback-received publishes ConversationGuide and legacy Orientador responses to group chat", async () => {
    const harness = createHarness();
    await harness.initialize();
    const resultId = "0f8fad5b-d9cb-469f-a165-70867728950e";

    await harness.dispatch("callback-received", {
        resultId,
        requestPayload: {
            room:        "ethicapp-s11-p22-g301",
            evaluations: [
                { agente: "Validador", respuesta: "NO_INTERVENIR: active debate" },
                { agente: "ConversationGuide", respuesta: "Which tradeoff matters most here?" },
                { agente: "Orientador", respuesta: "What assumption is your group making?" },
            ],
        },
    });

    assert.equal(harness.publishedMessages.length, 2);
    // Without `display_name` (a Polyadic before ai-additions #222), the
    // message shows the canonical name.
    assert.deepEqual(harness.publishedMessages[0], {
        sessionId:        11,
        phaseId:          22,
        questionId:       701,
        groupId:          301,
        agentDisplayName: "ConversationGuide",
        authorName:       "ConversationGuide",
        content:          "Which tradeoff matters most here?",
        resultId,
    });
    assert.deepEqual(harness.publishedMessages[1], {
        sessionId:        11,
        phaseId:          22,
        questionId:       701,
        groupId:          301,
        agentDisplayName: "Orientador",
        authorName:       "Orientador",
        content:          "What assumption is your group making?",
        resultId,
    });
    assert.equal(harness.callbacks.at(-1).payload.messagesPublished, 2);
    assert.deepEqual(harness.callbacks.at(-1).payload.publishedMessages, [
        { messageId: 1, agentName: "ConversationGuide", displayName: "ConversationGuide", evaluationIndex: 1 },
        { messageId: 2, agentName: "Orientador", displayName: "Orientador", evaluationIndex: 2 },
    ]);
});

test("callback-received publishes each message under the room's name for its agent (#1026)", async () => {
    const harness = createHarness();
    await harness.initialize();
    const resultId = "0f8fad5b-d9cb-469f-a165-70867728950e";

    await harness.dispatch("callback-received", {
        resultId,
        requestPayload: {
            room:        "ethicapp-s11-p22-g301",
            evaluations: [
                { agente: "ConversationGuide", respuesta: "Default name", display_name: "agente" },
                { agente: "ConversationGuide", respuesta: "Nickname", display_name: "  Profe Ana  " },
                { agente: "ConversationGuide", respuesta: "Blank name", display_name: "   " },
                { agente: "ConversationGuide", respuesta: "Not a string", display_name: { name: "x" } },
                { agente: "ConversationGuide", respuesta: "Too long", display_name: "n".repeat(120) },
            ],
        },
    });

    // The agent row keeps the canonical name; the message shows the room's.
    assert.deepEqual(
        harness.publishedMessages.map(({ agentDisplayName, authorName }) => [agentDisplayName, authorName]),
        [
            ["ConversationGuide", "agente"],
            ["ConversationGuide", "Profe Ana"],
            ["ConversationGuide", "ConversationGuide"],
            ["ConversationGuide", "ConversationGuide"],
            ["ConversationGuide", "n".repeat(80)],
        ]
    );
    assert.deepEqual(
        harness.callbacks.at(-1).payload.publishedMessages.map(entry => entry.displayName),
        ["agente", "Profe Ana", "ConversationGuide", "ConversationGuide", "n".repeat(80)]
    );
});

test("callback-received without a result id publishes messages with no result link", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("callback-received", {
        requestPayload: {
            room:        "ethicapp-s11-p22-g301",
            evaluations: [{ agente: "ConversationGuide", respuesta: "Why?" }],
        },
    });

    assert.equal(harness.publishedMessages.length, 1);
    assert.equal(harness.publishedMessages[0].resultId, undefined);
});

test("phase-ended closes rooms created for that phase", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });
    await harness.dispatch("phase-ended", { sessionId: 11, phaseId: 22 });

    assert.deepEqual(
        harness.requests.slice(2).map(request => `${request.options.method} ${request.pathname}`),
        [
            "DELETE /rooms/ethicapp-s11-p22-g301/sessions/active",
            "DELETE /rooms/ethicapp-s11-p22-g302/sessions/active",
        ]
    );
    assert.equal(harness.callbacks.at(-1).payload.roomsClosed, 2);
});

test("activity-finished closes every room for the session across all phases", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });
    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 33 });
    await harness.dispatch("activity-finished", { sessionId: 11, phaseId: 33 });

    const deletes = harness.requests
        .filter(request => request.options.method === "DELETE")
        .map(request => request.pathname);

    assert.deepEqual(deletes, [
        "/rooms/ethicapp-s11-p22-g301/sessions/active",
        "/rooms/ethicapp-s11-p22-g302/sessions/active",
        "/rooms/ethicapp-s11-p33-g301/sessions/active",
        "/rooms/ethicapp-s11-p33-g302/sessions/active",
    ]);
    assert.equal(harness.callbacks.at(-1).hook, "activity-finished");
    assert.equal(harness.callbacks.at(-1).payload.roomsClosed, 4);
});

test("activity-finished only closes rooms belonging to the finished session", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });
    await harness.dispatch("phase-started", { sessionId: 12, phaseId: 22 });
    await harness.dispatch("activity-finished", { sessionId: 11, phaseId: 22 });

    const deletes = harness.requests
        .filter(request => request.options.method === "DELETE")
        .map(request => request.pathname);

    assert.ok(deletes.every(pathname => pathname.includes("-s11-")), "should not close other sessions' rooms");
    assert.equal(harness.callbacks.at(-1).payload.roomsClosed, 2);
});

test("resolvePolyadicUsername uses anon_mask for anonymous phases", () => {
    assert.equal(
        resolvePolyadicUsername({ phase_anonymous: true, anon_mask: "B", firstname: "Juan", lastname: "García", name: "jgarcia" }, 9001),
        "B"
    );
});

test("resolvePolyadicUsername uses firstname for identified phases", () => {
    assert.equal(
        resolvePolyadicUsername({ phase_anonymous: false, anon_mask: "C", firstname: "Ana", lastname: "López", name: "alopez" }, 9002),
        "Ana"
    );
});

test("resolvePolyadicUsername falls back to lastname when firstname is absent", () => {
    assert.equal(
        resolvePolyadicUsername({ phase_anonymous: false, anon_mask: null, firstname: "", lastname: "López", name: "alopez" }, 9002),
        "López"
    );
});

test("resolvePolyadicUsername falls back to users.name when firstname and lastname are absent", () => {
    assert.equal(
        resolvePolyadicUsername({ phase_anonymous: false, anon_mask: null, firstname: "", lastname: "", name: "alopez" }, 9002),
        "alopez"
    );
});

test("resolvePolyadicUsername falls back to user-<id> when identity is null", () => {
    assert.equal(resolvePolyadicUsername(null, 9001), "user-9001");
});

test("resolvePolyadicUsername falls back to user-<id> when anonymous but anon_mask is absent", () => {
    assert.equal(
        resolvePolyadicUsername({ phase_anonymous: true, anon_mask: "", firstname: "Juan", lastname: "García", name: "jgarcia" }, 9001),
        "user-9001"
    );
});

test("chat-message-received forwards anon_mask for anonymous phase participants", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase:    async () => [],
            getParticipantIdentity: async () => ({
                phase_anonymous: true,
                anon_mask:       "A",
                firstname:       "Juan",
                lastname:        "García",
                name:            "jgarcia",
            }),
        },
    });
    await harness.initialize();

    await harness.dispatch("chat-message-received", {
        sessionId: 11, phaseId: 22, groupId: 301, userId: 9001,
        correlationId: "corr-anon-001", content: "My opinion",
    });

    const messageRequest = harness.requests.find(r => r.pathname.includes("/messages"));
    assert.equal(messageRequest.options.body.username, "A");
    assert.equal(harness.callbacks.at(-1).status, "completed");
});

test("chat-message-received forwards firstname for identified phase participants", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase:    async () => [],
            getParticipantIdentity: async () => ({
                phase_anonymous: false,
                anon_mask:       "B",
                firstname:       "Ana",
                lastname:        "López",
                name:            "alopez",
            }),
        },
    });
    await harness.initialize();

    await harness.dispatch("chat-message-received", {
        sessionId: 11, phaseId: 22, groupId: 301, userId: 9002,
        correlationId: "corr-ident-001", content: "I think we should act",
    });

    const messageRequest = harness.requests.find(r => r.pathname.includes("/messages"));
    assert.equal(messageRequest.options.body.username, "Ana");
    assert.equal(harness.callbacks.at(-1).status, "completed");
});

test("chat-message-received forwards with user-<id> fallback when identity resolution fails", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase:    async () => [],
            getParticipantIdentity: async () => {
                throw new Error("db unavailable");
            },
        },
    });
    await harness.initialize();

    await harness.dispatch("chat-message-received", {
        sessionId: 11, phaseId: 22, groupId: 301, userId: 9003,
        correlationId: "corr-fail-001", content: "Still forwarded",
    });

    const messageRequest = harness.requests.find(r => r.pathname.includes("/messages"));
    assert.equal(messageRequest.options.body.username, "user-9003");
    assert.equal(harness.callbacks.at(-1).status, "completed");
});

test("resolvePolyadicLocale maps design languages to Polyadic locales, defaulting to es-CL", () => {
    assert.equal(resolvePolyadicLocale("en_US"), "en-US");
    assert.equal(resolvePolyadicLocale("es_CL"), "es-CL");
    assert.equal(resolvePolyadicLocale("en_GB"), "en-US");
    assert.equal(resolvePolyadicLocale("es_ES"), "es-CL");
    assert.equal(resolvePolyadicLocale("pt_BR"), "es-CL");
    assert.equal(resolvePolyadicLocale(""), "es-CL");
    assert.equal(resolvePolyadicLocale(null), "es-CL");
});

// Polyadic owns the guide's default name and derives it from `locale`
// (#1026, epic #1025): EthicApp sends `agent_nickname` only when the phase
// configures it.
test("phase-started creates rooms with the design's locale and no agent nickname (en_US)", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase:     async () => [301],
            getSessionLanguageCode: async () => "en_US",
        },
    });
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });

    const sessionRequest = harness.requests.find(r => r.pathname.endsWith("/sessions"));
    assert.equal(Object.hasOwn(sessionRequest.options.body, "agent_nickname"), false);
    assert.equal(sessionRequest.options.body.locale, "en-US");
    assert.equal(Object.hasOwn(sessionRequest.options.body, "idioma"), false);
});

test("chat-message-received creates a missing room with the design's locale and no agent nickname (es_CL)", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase:     async () => [],
            getSessionLanguageCode: async () => "es_CL",
        },
    });
    await harness.initialize();

    await harness.dispatch("chat-message-received", {
        sessionId: 11, phaseId: 22, groupId: 301, userId: 9001,
        correlationId: "corr-lang-001", content: "Hola",
    });

    const sessionRequest = harness.requests.find(r => r.pathname.endsWith("/sessions"));
    assert.equal(Object.hasOwn(sessionRequest.options.body, "agent_nickname"), false);
    assert.equal(sessionRequest.options.body.locale, "es-CL");
    assert.equal(Object.hasOwn(sessionRequest.options.body, "idioma"), false);
});

test("phase-started falls back to the default locale when language resolution fails", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase:     async () => [301],
            getSessionLanguageCode: async () => {
                throw new Error("db unavailable");
            },
        },
    });
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });

    const sessionRequest = harness.requests.find(r => r.pathname.endsWith("/sessions"));
    assert.equal(Object.hasOwn(sessionRequest.options.body, "agent_nickname"), false);
    assert.equal(sessionRequest.options.body.locale, "es-CL");
});

test("phase room tracking is scoped by session and phase", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase: async (sessionId) => sessionId === 11 ? [301] : [401],
        },
    });
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });
    await harness.dispatch("phase-started", { sessionId: 12, phaseId: 22 });
    await harness.dispatch("phase-ended", { sessionId: 11, phaseId: 22 });

    assert.deepEqual(
        harness.requests.map(request => `${request.options.method} ${request.pathname}`),
        [
            "POST /rooms/ethicapp-s11-p22-g301/sessions",
            "POST /rooms/ethicapp-s12-p22-g401/sessions",
            "DELETE /rooms/ethicapp-s11-p22-g301/sessions/active",
        ]
    );
    assert.equal(harness.callbacks.at(-1).payload.roomsClosed, 1);
});

// ─── Configured settings (#735) ──────────────────────────────────────────────

function sessionBodies(harness) {
    return harness.requests
        .filter(request => request.pathname.endsWith("/sessions"))
        .map(request => request.options.body);
}

test("buildPolyadicSessionPayload: EthicApp defaults without a configuration", () => {
    assert.deepEqual(buildPolyadicSessionPayload({
        topic:        "Topic",
        locale:       "en-US",
        pipelineType: "abogado-del-diablo",
    }), {
        prompt_inicial: "Topic",
        pipeline_type:  "abogado-del-diablo",
        locale:         "en-US",
    });
});

test("buildPolyadicSessionPayload: configured settings replace and extend the defaults", () => {
    const payload = buildPolyadicSessionPayload({
        topic:                "Topic",
        locale:               "es-CL",
        pipelineType:         "abogado-del-diablo",
        serviceConfiguration: {
            pipeline_type:            "toulmin",
            agent_nickname:           "Sofía",
            llm_tier:                 "advanced",
            session_duration_seconds: 900,
            locale:                   "en-US",
            prompt_inicial:           "ignored",
            unset:                    null,
        },
    });

    assert.deepEqual(payload, {
        prompt_inicial:           "Topic",
        pipeline_type:            "toulmin",
        agent_nickname:           "Sofía",
        locale:                   "en-US",
        llm_tier:                 "advanced",
        session_duration_seconds: 900,
    });
});

test("buildPolyadicSessionPayload: pipeline_type precedence, configuration then deployment", () => {
    const original = process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE;
    try {
        process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE = "standard";
        assert.equal(buildPolyadicSessionPayload({}).pipeline_type, "standard");
        const configured = { serviceConfiguration: { pipeline_type: "noAI" } };
        assert.equal(buildPolyadicSessionPayload(configured).pipeline_type, "noAI");

        delete process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE;
        assert.equal(buildPolyadicSessionPayload({}).pipeline_type, "abogado-del-diablo");
    } finally {
        if (original === undefined) {
            delete process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE;
        } else {
            process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE = original;
        }
    }
});

test("phase-started sends the phase's configured settings", async () => {
    const harness = createHarness({ dependencies: { getTeamIdsForPhase: async () => [301] } });
    await harness.initialize();

    await harness.dispatch("phase-started", {
        sessionId:            11,
        phaseId:              22,
        serviceConfiguration: {
            pipeline_type:            "toulmin",
            llm_tier:                 "advanced",
            session_duration_seconds: 900,
        },
    });

    const [body] = sessionBodies(harness);
    assert.equal(body.pipeline_type, "toulmin");
    assert.equal(body.llm_tier, "advanced");
    assert.equal(body.session_duration_seconds, 900);
    assert.equal(body.locale, "es-CL");
    assert.equal(Object.hasOwn(body, "agent_nickname"), false);
});

test("chat-message-received sends the configured settings for a missing room", async () => {
    const harness = createHarness({ dependencies: { getTeamIdsForPhase: async () => [] } });
    await harness.initialize();

    await harness.dispatch("chat-message-received", {
        sessionId:            11,
        phaseId:              22,
        groupId:              301,
        userId:               9001,
        correlationId:        "corr-735",
        content:              "Hola",
        serviceConfiguration: { agent_nickname: "Sofía" },
    });

    assert.equal(sessionBodies(harness)[0].agent_nickname, "Sofía");
});

test("phase-started reports Polyadic's warnings and degraded mode per room", async () => {
    const warning = {
        field:   "model",
        verdict: "deprecated",
        message: "model is deprecated; use llm_tier instead",
    };
    const harness = createHarness({
        dependencies: { getTeamIdsForPhase: async () => [301, 302] },
        respond:      (pathname) => (pathname.includes("g301")
            ? { status: "created", warnings: [warning], degraded: false }
            : { status: "created", warnings: [], degraded: true }),
    });
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });

    assert.deepEqual(harness.callbacks.at(-1).payload.rooms, [
        {
            room:                  "ethicapp-s11-p22-g301",
            warnings:              [warning],
            degraded:              false,
            configurationRejected: false,
        },
        {
            room:                  "ethicapp-s11-p22-g302",
            warnings:              [],
            degraded:              true,
            configurationRejected: false,
        },
    ]);
});

test("a rejected configuration falls back to EthicApp's defaults and is reported", async () => {
    const rejection = { detail: { errors: { session_duration_seconds: "below minimum" } } };
    const harness = createHarness({
        dependencies: { getTeamIdsForPhase: async () => [301] },
        respond:      (pathname, options, count) => {
            if (count === 1) {
                const error = new Error("HTTP 400");
                error.statusCode = 400;
                error.responseBody = rejection;
                throw error;
            }
            return { status: "created", warnings: [], degraded: false };
        },
    });
    await harness.initialize();

    await harness.dispatch("phase-started", {
        sessionId: 11, phaseId: 22, serviceConfiguration: { session_duration_seconds: 120 },
    });

    const [first, second] = sessionBodies(harness);
    assert.equal(first.session_duration_seconds, 120);
    assert.equal(Object.hasOwn(second, "session_duration_seconds"), false);
    const payload = harness.callbacks.at(-1).payload;
    assert.equal(payload.roomsCreated, 1);
    assert.equal(payload.rooms[0].configurationRejected, true);
});

test("without a configuration a 400 is not retried", async () => {
    const harness = createHarness({
        dependencies: { getTeamIdsForPhase: async () => [301] },
        respond:      () => {
            const error = new Error("HTTP 400");
            error.statusCode = 400;
            throw error;
        },
    });
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });

    assert.equal(sessionBodies(harness).length, 1);
    assert.equal(harness.callbacks.at(-1).payload.roomsCreated, 0);
});

// ─── Instantiation report (#737) ─────────────────────────────────────────────

test("phase-started reports every room's warnings once per job", async () => {
    const warning = { field: "model", verdict: "deprecated" };
    const harness = createHarness({
        dependencies: { getTeamIdsForPhase: async () => [301, 302] },
        respond:      (pathname) => (pathname.includes("g301")
            ? { status: "created", warnings: [warning], degraded: false }
            : { status: "created", warnings: [], degraded: true }),
    });
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });

    assert.equal(harness.reports.length, 1);
    const [report] = harness.reports;
    assert.deepEqual(report.warnings, [{ ...warning, room: "ethicapp-s11-p22-g301" }]);
    assert.equal(report.degraded, true);
    assert.equal(report.configurationRejected, false);
    assert.deepEqual(report.rooms.map(room => room.room),
        ["ethicapp-s11-p22-g301", "ethicapp-s11-p22-g302"]);
});

test("no instantiation report when no room is created", async () => {
    const harness = createHarness({ dependencies: { getTeamIdsForPhase: async () => [] } });
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });

    assert.deepEqual(harness.reports, []);
});

test("chat-message-received reports the room it creates", async () => {
    const harness = createHarness({
        dependencies: { getTeamIdsForPhase: async () => [] },
        respond:      (pathname) => (pathname.endsWith("/sessions")
            ? { status: "created", warnings: [], degraded: false }
            : { status: "ok" }),
    });
    await harness.initialize();

    await harness.dispatch("chat-message-received", {
        sessionId:     11,
        phaseId:       22,
        groupId:       301,
        userId:        9001,
        correlationId: "corr-737",
        content:       "Hola",
    });

    assert.equal(harness.reports.length, 1);
    assert.deepEqual(harness.reports[0].rooms.map(room => room.room), ["ethicapp-s11-p22-g301"]);
});


// ─── Plain question text (#768) ─────────────────────────────────────────────

test("formatQuestionText sends Markdown questions as plain text", () => {
    assert.equal(formatQuestionText({
        title:            "**¿Qué harías?**\\\nPiensa en *Sebastián*.",
        titleContentType: "text/markdown",
        tleft:            "Lo ayudo",
        tright:           "No lo ayudo",
    }), "¿Qué harías?\nPiensa en Sebastián. | Lo ayudo vs. No lo ayudo");
});

test("formatQuestionText leaves questions without a Markdown content type as they were", () => {
    for (const titleContentType of [undefined, null, "text/plain"]) {
        const question = { title: "**literal**", titleContentType, tleft: "A", tright: "B" };
        assert.equal(formatQuestionText(question), "**literal** | A vs. B");
    }
});

// ─── Room correlation id (#833) ─────────────────────────────────────────────

test("buildPolyadicSessionPayload: the room correlation id is top level and no setting replaces it", () => {
    const payload = buildPolyadicSessionPayload({
        roomCorrelationId:    "room-job-1",
        serviceConfiguration: { ethicapp_room_correlation_id: "forged", llm_tier: "basic" },
    });

    assert.equal(payload.ethicapp_room_correlation_id, "room-job-1");
    assert.equal(payload.llm_tier, "basic");
    assert.equal(Object.hasOwn(buildPolyadicSessionPayload({}), "ethicapp_room_correlation_id"), false);
});

test("without room jobs, rooms are created without a room correlation id", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });

    assert.ok(harness.requests.every(request =>
        !Object.hasOwn(request.options.body, "ethicapp_room_correlation_id")));
});

test("a rejected configuration is retried with the same room correlation id", async () => {
    const roomJobCalls = [];
    const subscribers = new Map();
    const bodies = [];
    await register({
        service: { id: "polyadic-devils-advocate" },
        subscribe(hookName, handler) {
            subscribers.set(hookName, handler);
        },
        async publishGroupChatMessage() {
            return null;
        },
        aiAdditionsClient: {
            async getEndpoints() {
                return {};
            },
            async requestJson(pathname, { body }) {
                bodies.push(body);
                if (bodies.length === 1) {
                    throw Object.assign(new Error("HTTP 400"), { statusCode: 400 });
                }
                return { ethicapp_room_correlation_id: body.ethicapp_room_correlation_id };
            },
        },
        roomJobs: {
            create: async room => {
                roomJobCalls.push(["create", room.room, room.hookName]);
                return { id: "room-job-7" };
            },
            open:  async (id, options) => { roomJobCalls.push(["open", id, options]); return true; },
            fail:  async id => { roomJobCalls.push(["fail", id]); },
            close: async () => 0,
        },
        polyadicBridgeDependencies: {
            getTeamIdsForPhase:       async () => [301],
            getFirstQuestionForPhase: async () => null,
            getCaseIdBySessionId:     async () => null,
            getSessionLanguageCode:   async () => "es_CL",
        },
    });

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        await subscribers.get("phase-started")(
            { sessionId: 11, phaseId: 22, serviceConfiguration: { session_duration_seconds: 1 } },
            { callback: async () => {}, reportInstantiation: async () => {} }
        );
    } finally {
        console.warn = originalWarn;
    }

    assert.deepEqual(bodies.map(body => body.ethicapp_room_correlation_id), ["room-job-7", "room-job-7"]);
    assert.deepEqual(roomJobCalls, [
        ["create", "ethicapp-s11-p22-g301", "phase-started"],
        ["open", "room-job-7", { bound: true }],
    ]);
});

// ─── participant-activity (epic #601, #657) ──────────────────────────────────

const ACTIVITY_ROOM = "ethicapp-s11-p22-g301";
const ACTIVITY_PATH = `/rooms/${ACTIVITY_ROOM}/sessions/active/activity`;

// The context the registry hands the handler: normalized, frozen, with the
// service id, and nothing else.
function activityContext(overrides = {}) {
    return Object.freeze({
        ...normalizeParticipantActivityContext({
            kind:       "composing",
            sessionId:  11,
            phaseId:    22,
            questionId: 701,
            groupId:    301,
            userId:     9001,
            receivedAt: Date.UTC(2026, 10, 12, 15, 4, 5, 123),
            ...overrides,
        }),
        serviceId: "polyadic-devils-advocate",
    });
}

// An ephemeral handler receives its context only: no callback, no report.
async function dispatchActivity(harness, context = activityContext()) {
    const handler = harness.subscribers.get("participant-activity");
    assert.equal(typeof handler, "function", "Missing subscriber for participant-activity");
    return handler(context);
}

function activityRequests(harness) {
    return harness.requests.filter(request => request.pathname === ACTIVITY_PATH);
}

async function withConsole(method, action) {
    const calls = [];
    const original = console[method];
    console[method] = (...args) => calls.push(args);
    try {
        await action();
    } finally {
        console[method] = original;
    }
    return calls;
}

test("participant-activity: a known room gets one request with the contract fields", async () => {
    const harness = createHarness({ dependencies: { getTeamIdsForPhase: async () => [301] } });
    await harness.initialize();
    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });
    const before = harness.requests.length;
    const callbacksBefore = harness.callbacks.length;
    const reportsBefore = harness.reports.length;

    assert.equal(await dispatchActivity(harness), undefined);

    assert.equal(harness.requests.length, before + 1);
    const [request] = activityRequests(harness);
    assert.equal(request.pathname, ACTIVITY_PATH);
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.basePath, "/polyadic-agent/api");
    assert.equal(request.options.authenticated, true);
    assert.equal(request.options.timeoutMs, 3000);
    assert.deepEqual(request.options.body, {
        kind:           "composing",
        received_at:    "2026-11-12T15:04:05.123Z",
        ttl_seconds:    30,
        participant_id: "9001",
    });
    assert.equal(harness.callbacks.length, callbacksBefore);
    assert.equal(harness.reports.length, reportsBefore);
    assert.equal(harness.publishedMessages.length, 0);
});

test("participant-activity: a chat message's room is known, and stopped is forwarded", async () => {
    const harness = createHarness({ dependencies: { getTeamIdsForPhase: async () => [] } });
    await harness.initialize();
    await harness.dispatch("chat-message-received", {
        sessionId: 11, phaseId: 22, questionId: 701, groupId: 301, userId: 9002, content: "Hello",
    });

    await dispatchActivity(harness, activityContext({ kind: "stopped", ttlSeconds: 45 }));

    assert.deepEqual(activityRequests(harness).map(request => request.options.body), [{
        kind:           "stopped",
        received_at:    "2026-11-12T15:04:05.123Z",
        ttl_seconds:    45,
        participant_id: "9001",
    }]);
    // Other requests keep the client's default timeout.
    assert.equal(Object.hasOwn(harness.requests[1].options, "timeoutMs"), false);
});

test("participant-activity: an unknown group, phase or session calls nothing", async () => {
    const harness = createHarness({ dependencies: { getTeamIdsForPhase: async () => [301] } });
    await harness.initialize();

    // Before any room exists, as after a restart.
    await dispatchActivity(harness);
    assert.equal(harness.requests.length, 0);

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });
    const before = harness.requests.length;
    await dispatchActivity(harness, activityContext({ groupId: 302 }));
    await dispatchActivity(harness, activityContext({ phaseId: 23 }));
    await dispatchActivity(harness, activityContext({ sessionId: 12 }));

    assert.equal(harness.requests.length, before);
    assert.equal(harness.callbacks.length, 1);
});

test("participant-activity: a room still being created is skipped, not awaited", async () => {
    let releaseCreation;
    const creationGate = new Promise(resolve => {
        releaseCreation = resolve;
    });
    const harness = createHarness({
        dependencies: { getTeamIdsForPhase: async () => [301] },
        respond:      async (pathname, options) => {
            if (pathname.endsWith("/sessions") && options.method === "POST") {
                await creationGate;
            }
            return { status: "ok" };
        },
    });
    await harness.initialize();

    const phaseStart = harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });
    // Let the creation reach Polyadic.
    while (harness.requests.length === 0) {
        await new Promise(resolve => setImmediate(resolve));
    }

    await dispatchActivity(harness);
    assert.deepEqual(activityRequests(harness), []);

    releaseCreation();
    await phaseStart;
    await dispatchActivity(harness);
    assert.equal(activityRequests(harness).length, 1);
});

test("participant-activity: a 404 means the room is not running and raises nothing", async () => {
    const harness = createHarness({
        dependencies: { getTeamIdsForPhase: async () => [301] },
        respond:      pathname => {
            if (pathname === ACTIVITY_PATH) {
                throw Object.assign(new Error("HTTP 404"), { statusCode: 404 });
            }
            return { status: "ok" };
        },
    });
    await harness.initialize();
    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });
    const before = harness.requests.length;

    const debug = await withConsole("debug", () => dispatchActivity(harness));

    // One request, no room re-created, nothing logged.
    assert.equal(harness.requests.length, before + 1);
    assert.deepEqual(debug, []);
});

test("participant-activity: errors and timeouts never escape and log no content", async () => {
    const failures = [
        Object.assign(new Error("HTTP 500 request failed: {\"content\":\"draft\"}"), {
            statusCode:   500,
            responseBody: { detail: "secret draft" },
        }),
        Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
        Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    ];
    let failure = null;
    const harness = createHarness({
        dependencies: { getTeamIdsForPhase: async () => [301] },
        respond:      pathname => {
            if (pathname === ACTIVITY_PATH) {
                throw failure;
            }
            return { status: "ok" };
        },
    });
    await harness.initialize();
    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });

    for (const error of failures) {
        failure = error;
        const debug = await withConsole("debug", async () => {
            assert.equal(await dispatchActivity(harness), undefined);
        });

        assert.equal(debug.length, 1);
        assert.match(debug[0][0], /ethicapp-s11-p22-g301/);
        assert.deepEqual(debug[0][1], {
            name:       error.name,
            code:       error.code ?? null,
            statusCode: error.statusCode ?? null,
        });
        assert.doesNotMatch(JSON.stringify(debug), /draft|9001/);
    }
    assert.equal(activityRequests(harness).length, failures.length);
});

test("buildRoomActivityBody: only the contract's fields, or null for an invalid context", () => {
    assert.deepEqual(buildRoomActivityBody({
        kind:       "composing",
        userId:     42,
        receivedAt: "2026-11-12T12:04:05.123-03:00",
        content:    "draft text",
        length:     10,
        groupId:    301,
    }), {
        kind:           "composing",
        received_at:    "2026-11-12T15:04:05.123Z",
        ttl_seconds:    30,
        participant_id: "42",
    });
    assert.equal(buildRoomActivityBody({ kind: "typing", userId: 42, receivedAt: 0 }), null);
    assert.equal(buildRoomActivityBody({ kind: "composing", userId: 0, receivedAt: 0 }), null);
    assert.equal(
        buildRoomActivityBody({ kind: "composing", userId: 42, receivedAt: "soon" }),
        null
    );
    assert.equal(buildRoomActivityBody(null), null);
});
