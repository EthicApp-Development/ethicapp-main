import assert from "node:assert/strict";
import test from "node:test";
import {
    buildPolyadicSessionPayload,
    composeTopic,
    formatQuestionText,
    getRoomName,
    parseRoomName,
    register,
    resolveAgentNickname,
    resolvePolyadicLocale,
    resolvePolyadicUsername,
} from "../polyadic-bridge.adapter.js";

function createHarness({ dependencies = {}, respond = null } = {}) {
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

    await harness.dispatch("callback-received", {
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
    assert.deepEqual(harness.publishedMessages[0], {
        sessionId:        11,
        phaseId:          22,
        questionId:       701,
        groupId:          301,
        agentDisplayName: "ConversationGuide",
        content:          "Which tradeoff matters most here?",
    });
    assert.deepEqual(harness.publishedMessages[1], {
        sessionId:        11,
        phaseId:          22,
        questionId:       701,
        groupId:          301,
        agentDisplayName: "Orientador",
        content:          "What assumption is your group making?",
    });
    assert.equal(harness.callbacks.at(-1).payload.messagesPublished, 2);
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

test("resolveAgentNickname returns localized nickname per language code", () => {
    assert.equal(resolveAgentNickname("en_US"), "@agent");
    assert.equal(resolveAgentNickname("es_CL"), "@agente");
});

test("resolveAgentNickname falls back by language prefix and defaults to @agente", () => {
    assert.equal(resolveAgentNickname("en_GB"), "@agent");
    assert.equal(resolveAgentNickname("es_ES"), "@agente");
    assert.equal(resolveAgentNickname("pt_BR"), "@agente");
    assert.equal(resolveAgentNickname(""), "@agente");
    assert.equal(resolveAgentNickname(null), "@agente");
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

test("phase-started creates rooms with the localized agent nickname and locale (en_US)", async () => {
    const harness = createHarness({
        dependencies: {
            getTeamIdsForPhase:     async () => [301],
            getSessionLanguageCode: async () => "en_US",
        },
    });
    await harness.initialize();

    await harness.dispatch("phase-started", { sessionId: 11, phaseId: 22 });

    const sessionRequest = harness.requests.find(r => r.pathname.endsWith("/sessions"));
    assert.equal(sessionRequest.options.body.agent_nickname, "@agent");
    assert.equal(sessionRequest.options.body.locale, "en-US");
    assert.equal(Object.hasOwn(sessionRequest.options.body, "idioma"), false);
});

test("chat-message-received creates a missing room with the localized agent nickname and locale (es_CL)", async () => {
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
    assert.equal(sessionRequest.options.body.agent_nickname, "@agente");
    assert.equal(sessionRequest.options.body.locale, "es-CL");
    assert.equal(Object.hasOwn(sessionRequest.options.body, "idioma"), false);
});

test("phase-started falls back to default nickname and locale when language resolution fails", async () => {
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
    assert.equal(sessionRequest.options.body.agent_nickname, "@agente");
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
        topic:         "Topic",
        agentNickname: "@agent",
        locale:        "en-US",
        pipelineType:  "abogado-del-diablo",
    }), {
        prompt_inicial: "Topic",
        pipeline_type:  "abogado-del-diablo",
        agent_nickname: "@agent",
        locale:         "en-US",
    });
});

test("buildPolyadicSessionPayload: configured settings replace and extend the defaults", () => {
    const payload = buildPolyadicSessionPayload({
        topic:                "Topic",
        agentNickname:        "@agente",
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
    assert.equal(body.agent_nickname, "@agente");
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

