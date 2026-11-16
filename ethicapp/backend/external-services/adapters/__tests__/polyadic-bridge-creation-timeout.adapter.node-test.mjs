// A room creation that gets no answer (#1227, epic
// ethicapp-ai-additions#293): a timeout, or a connection error without an
// HTTP status, leaves the outcome unknown, since Polyadic may have created
// the room after EthicApp stopped waiting. The bridge sends the request once
// more with the same room job; Polyadic's idempotent creation (`created`, or
// `ya_inicializado` echoing the id) opens and binds that job. Only a resend
// without an answer fails the room, with `session_creation_timed_out`.
// Answers with an HTTP status keep their behaviour.
//
// The bridge tests use fakes shaped as Node's fetch rejects; the client tests
// at the end check those shapes against the real AiAdditionsClient and a
// local HTTP server.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { isUnansweredRequest, register } from "../polyadic-bridge.adapter.js";
import { ROOM_FAILURE_REASONS } from "../polyadic-bridge.case-inputs.js";
import {
    AiAdditionsClient,
    AiAdditionsCredentialsMissingError,
    AiAdditionsNotConfiguredError,
} from "../../../services/ai-additions-client.service.js";

const SESSION_ID = 11;
const PHASE_ID = 22;
const ROOM = "ethicapp-s11-p22-g301";
const SESSIONS_PATH = `/rooms/${ROOM}/sessions`;
const MESSAGES_PATH = `/rooms/${ROOM}/messages`;
const CONFIGURED = Object.freeze({ llm_tier: "advanced" });
const PHASE_START = "2026-11-16T10:00:00.000Z";

// What Node's fetch rejects with when the client aborts a request.
function timeoutError() {
    return new DOMException("This operation was aborted", "AbortError");
}

// What Node's fetch (undici) rejects with when the connection fails.
function connectionError(code = "ECONNRESET") {
    return new TypeError("fetch failed", {
        cause: Object.assign(new Error(`socket ${code}`), { code }),
    });
}

function httpError(statusCode, responseBody = null) {
    return Object.assign(new Error(`HTTP ${statusCode} request failed.`), {
        statusCode, responseBody,
    });
}

// Polyadic's answers to a creation (polyadic-agents/backend/app/main.py
// create_session()).
function created(body) {
    return {
        status:                       "created",
        room:                         ROOM,
        warnings:                     [],
        degraded:                     false,
        ethicapp_room_correlation_id: body.ethicapp_room_correlation_id,
    };
}

function alreadyRunning(body) {
    return {
        status:                       "ya_inicializado",
        ethicapp_room_correlation_id: body.ethicapp_room_correlation_id,
    };
}

// A clock as helpers/phase-clock.js reads it, read `seconds` into a
// fifteen-minute phase.
function clockAt(seconds) {
    return {
        sessionId:   SESSION_ID,
        timeMode:    "soft",
        finished:    false,
        phaseId:     PHASE_ID,
        phaseNumber: 2,
        startedAt:   PHASE_START,
        endsAt:      "2026-11-16T10:15:00.000Z",
        isLastPhase: false,
        serverNow:   new Date(Date.parse(PHASE_START) + seconds * 1000).toISOString(),
    };
}

async function quietly(run) {
    const original = { info: console.info, warn: console.warn };
    const warnings = [];
    console.info = () => {};
    console.warn = (...args) => warnings.push(args);
    try {
        await run(warnings);
    } finally {
        Object.assign(console, original);
    }
}

/**
 * @param {object} options
 * @param {Array<object|Error|Function>} options.creations Polyadic's answer
 *        to each creation request in turn: an object, an error to throw, or
 *        a function of the request body.
 */
function createHarness({ creations, teamIds = [301] }) {
    const subscribers = new Map();
    const requests = [];
    const callbacks = [];
    const reports = [];
    const roomJobCalls = [];
    let clockReads = 0;
    let creationCount = 0;

    const client = {
        async getEndpoints() {
            return { baseUrl: "http://ai.local" };
        },
        async requestJson(pathname, options) {
            requests.push({ pathname, method: options.method, body: options.body });
            if (!pathname.endsWith("/sessions")) {
                return { status: "ok" };
            }
            const answer = creations[Math.min(creationCount, creations.length - 1)];
            creationCount += 1;
            if (answer instanceof Error || answer instanceof DOMException) {
                throw answer;
            }
            return typeof answer === "function" ? answer(options.body) : answer;
        },
    };

    return {
        requests,
        callbacks,
        reports,
        roomJobCalls,
        get clockReads() {
            return clockReads;
        },
        creationBodies() {
            return requests.filter(request => request.pathname === SESSIONS_PATH)
                .map(request => request.body);
        },
        async initialize() {
            await register({
                service: { id: "polyadic-devils-advocate" },
                subscribe(hookName, handler) {
                    subscribers.set(hookName, handler);
                },
                async publishGroupChatMessage() {
                    return null;
                },
                aiAdditionsClient: client,
                sessionInputs:     { declares: async name => name === "phase_clock" },
                roomJobs:          {
                    create: async room => {
                        roomJobCalls.push(["create", room.room]);
                        return { id: "room-job-1" };
                    },
                    open: async (id, options) => {
                        roomJobCalls.push(["open", id, options]);
                        return true;
                    },
                    fail: async (id, options) => {
                        roomJobCalls.push(["fail", id, options]);
                    },
                },
                polyadicBridgeDependencies: {
                    getTeamIdsForPhase:         async () => teamIds,
                    getFirstQuestionIdForPhase: async () => 701,
                    getFirstQuestionForPhase:   async () => ({ id: 701, title: "Question" }),
                    getCaseIdBySessionId:       async () => 51,
                    getCaseDocumentRawText:     async () => "Case text.",
                    getParticipantIdentity:     async () => null,
                    getSessionLanguageCode:     async () => "es_CL",
                    // Each read is twelve seconds later than the one before.
                    getPhaseClock:              async () => {
                        clockReads += 1;
                        return clockAt(12 * clockReads);
                    },
                },
            });
        },
        async dispatch(hookName, context) {
            await subscribers.get(hookName)(context, {
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
        phaseStarted(serviceConfiguration) {
            return this.dispatch("phase-started", {
                sessionId: SESSION_ID,
                phaseId:   PHASE_ID,
                ...(serviceConfiguration ? { serviceConfiguration } : {}),
            });
        },
        chatMessage(serviceConfiguration) {
            return this.dispatch("chat-message-received", {
                sessionId:     SESSION_ID,
                phaseId:       PHASE_ID,
                groupId:       301,
                userId:        9001,
                correlationId: "corr-1",
                content:       "Hola",
                ...(serviceConfiguration ? { serviceConfiguration } : {}),
            });
        },
    };
}

const TIMED_OUT_REPORT = Object.freeze({
    report: {
        warnings:              [],
        degraded:              false,
        configurationRejected: false,
        failure:               { reason: ROOM_FAILURE_REASONS.SESSION_CREATION_TIMED_OUT },
    },
});

describe("isUnansweredRequest", () => {
    it("recognizes a timeout and a connection error without a status", () => {
        assert.equal(isUnansweredRequest(timeoutError()), true);
        assert.equal(isUnansweredRequest(new DOMException("timed out", "TimeoutError")), true);
        assert.equal(isUnansweredRequest(connectionError("ECONNREFUSED")), true);
        assert.equal(isUnansweredRequest(new TypeError("terminated")), true);
        const reset = Object.assign(new Error("reset"), { code: "ECONNRESET" });
        assert.equal(isUnansweredRequest(reset), true);
    });

    it("never takes an answer with a status, or EthicApp's own errors, for no answer", () => {
        for (const status of [400, 401, 404, 500, 502, 503, 504]) {
            assert.equal(isUnansweredRequest(httpError(status)), false, `HTTP ${status}`);
        }
        assert.equal(isUnansweredRequest(new AiAdditionsNotConfiguredError()), false);
        assert.equal(isUnansweredRequest(new AiAdditionsCredentialsMissingError()), false);
        assert.equal(isUnansweredRequest(
            new Error("AI Additions Keycloak token endpoint did not return access_token.")
        ), false);
        assert.equal(isUnansweredRequest(null), false);
        assert.equal(isUnansweredRequest("timeout"), false);
    });
});

describe("a room creation without an answer", () => {
    it("is sent again with the same room job, and `ya_inicializado` with the echoed id binds it",
        () => quietly(async warnings => {
            const harness = createHarness({ creations: [timeoutError(), alreadyRunning] });
            await harness.initialize();

            await harness.phaseStarted();

            const [first, second] = harness.creationBodies();
            assert.equal(harness.creationBodies().length, 2);
            assert.equal(first.ethicapp_room_correlation_id, "room-job-1");
            assert.equal(second.ethicapp_room_correlation_id, "room-job-1");
            // The clock is read again for the resend; nothing else changes.
            assert.equal(harness.clockReads, 2);
            assert.equal(second.phase_clock.remaining_seconds,
                first.phase_clock.remaining_seconds - 12);
            assert.deepEqual({ ...second, phase_clock: null }, { ...first, phase_clock: null });

            assert.deepEqual(harness.roomJobCalls, [
                ["create", ROOM],
                ["open", "room-job-1", { bound: true }],
            ]);
            const callback = harness.callbacks.at(-1);
            assert.equal(callback.status, "completed");
            assert.equal(callback.payload.roomsCreated, 1);
            assert.equal(callback.payload.roomsFailed, undefined);
            assert.deepEqual(callback.payload.rooms, [{
                room:                  ROOM,
                warnings:              [],
                degraded:              false,
                configurationRejected: false,
                phaseClock:            second.phase_clock,
            }]);

            // The resend is logged with the error's class, never the body.
            assert.equal(warnings.length, 1);
            assert.match(warnings[0][0], /did not answer the creation of ethicapp-s11-p22-g301/);
            assert.equal(warnings[0][1].name, "AbortError");
            assert.doesNotMatch(JSON.stringify(warnings), /Case text/);
        }));

    it("opens the job when the resend answers `created`", () => quietly(async () => {
        const harness = createHarness({ creations: [connectionError(), created] });
        await harness.initialize();

        await harness.phaseStarted();

        assert.equal(harness.creationBodies().length, 2);
        assert.deepEqual(harness.roomJobCalls.at(-1), ["open", "room-job-1", { bound: true }]);
        assert.equal(harness.callbacks.at(-1).payload.roomsCreated, 1);
    }));

    it("opens the job unbound, as today, when the resend's answer echoes no id",
        () => quietly(async () => {
            const harness = createHarness({
                creations: [timeoutError(), { status: "ya_inicializado" }],
            });
            await harness.initialize();

            await harness.phaseStarted();

            assert.deepEqual(harness.roomJobCalls.at(-1), ["open", "room-job-1", { bound: false }]);
            assert.equal(harness.callbacks.at(-1).payload.roomsCreated, 1);
        }));

    it("fails the room with `session_creation_timed_out` when the resend gets no answer either, "
        + "without the retry without configured settings", () => quietly(async () => {
        const harness = createHarness({ creations: [timeoutError(), connectionError()] });
        await harness.initialize();

        await harness.phaseStarted(CONFIGURED);

        const bodies = harness.creationBodies();
        assert.equal(bodies.length, 2);
        assert.ok(bodies.every(body => body.llm_tier === "advanced"));
        assert.deepEqual(harness.roomJobCalls, [
            ["create", ROOM],
            ["fail", "room-job-1", TIMED_OUT_REPORT],
        ]);
        // Like any failure but a case input's, the phase start completes and
        // names the room.
        const callback = harness.callbacks.at(-1);
        assert.equal(callback.status, "completed");
        assert.equal(callback.payload.roomsCreated, 0);
        assert.deepEqual(callback.payload.roomsFailed, [{
            room:   ROOM,
            reason: ROOM_FAILURE_REASONS.SESSION_CREATION_TIMED_OUT,
        }]);
    }));

    it("a chat message's room that times out twice forwards nothing and names the reason",
        () => quietly(async () => {
            const harness = createHarness({ creations: [timeoutError()] });
            await harness.initialize();

            await harness.chatMessage();

            assert.equal(harness.creationBodies().length, 2);
            assert.deepEqual(harness.requests.map(request => request.pathname),
                [SESSIONS_PATH, SESSIONS_PATH]);
            assert.deepEqual(harness.callbacks.at(-1), {
                serviceId: "polyadic-devils-advocate",
                hook:      "chat-message-received",
                status:    "failed",
                payload:   {
                    sessionId: SESSION_ID,
                    phaseId:   PHASE_ID,
                    groupId:   301,
                    reason:    ROOM_FAILURE_REASONS.SESSION_CREATION_TIMED_OUT,
                },
            });
            assert.deepEqual(harness.roomJobCalls.at(-1), ["fail", "room-job-1", TIMED_OUT_REPORT]);
        }));

    it("a chat message's room bound by the resend gets the message", () => quietly(async () => {
        const harness = createHarness({ creations: [timeoutError(), alreadyRunning] });
        await harness.initialize();

        await harness.chatMessage();

        assert.deepEqual(harness.requests.map(request => request.pathname),
            [SESSIONS_PATH, SESSIONS_PATH, MESSAGES_PATH]);
        assert.deepEqual(harness.roomJobCalls.at(-1), ["open", "room-job-1", { bound: true }]);
    }));

    it("a resend answered 400 gets today's retry without configured settings",
        () => quietly(async () => {
            const harness = createHarness({
                creations: [timeoutError(), httpError(400, { detail: "bad llm_tier" }), created],
            });
            await harness.initialize();

            await harness.phaseStarted(CONFIGURED);

            const bodies = harness.creationBodies();
            assert.equal(bodies.length, 3);
            assert.equal(bodies[1].llm_tier, "advanced");
            assert.equal(bodies[2].llm_tier, undefined);
            assert.equal(bodies[2].ethicapp_room_correlation_id, "room-job-1");
            const [room] = harness.callbacks.at(-1).payload.rooms;
            assert.equal(room.configurationRejected, true);
            assert.deepEqual(room.rejection, { detail: "bad llm_tier" });
        }));

    it("the retry without configured settings is itself sent again when it gets no answer",
        () => quietly(async () => {
            const harness = createHarness({
                creations: [
                    httpError(400, { detail: "bad llm_tier" }), timeoutError(), alreadyRunning,
                ],
            });
            await harness.initialize();

            await harness.phaseStarted(CONFIGURED);

            const bodies = harness.creationBodies();
            assert.equal(bodies.length, 3);
            assert.equal(bodies[2].llm_tier, undefined);
            assert.deepEqual(harness.roomJobCalls.at(-1), ["open", "room-job-1", { bound: true }]);
            assert.equal(harness.callbacks.at(-1).payload.rooms[0].configurationRejected, true);
        }));

    it("the retry without configured settings fails as timed out after two requests without "
        + "an answer", () => quietly(async () => {
        const harness = createHarness({
            creations: [httpError(400, { detail: "bad llm_tier" }), timeoutError()],
        });
        await harness.initialize();

        await harness.phaseStarted(CONFIGURED);

        assert.equal(harness.creationBodies().length, 3);
        assert.deepEqual(harness.callbacks.at(-1).payload.roomsFailed, [{
            room:   ROOM,
            reason: ROOM_FAILURE_REASONS.SESSION_CREATION_TIMED_OUT,
        }]);
    }));
});

describe("a room creation answered with a status, as before #1227", () => {
    for (const status of [500, 503, 504]) {
        it(`HTTP ${status} fails the room at once with session_creation_failed`,
            () => quietly(async () => {
                const harness = createHarness({ creations: [httpError(status)] });
                await harness.initialize();

                await harness.phaseStarted(CONFIGURED);

                assert.equal(harness.creationBodies().length, 1);
                assert.deepEqual(harness.callbacks.at(-1).payload.roomsFailed, [{
                    room:       ROOM,
                    reason:     ROOM_FAILURE_REASONS.SESSION_CREATION_FAILED,
                    statusCode: status,
                }]);
                assert.equal(harness.roomJobCalls.at(-1)[0], "fail");
            }));
    }

    it("a 400 for configured settings is retried once without them", () => quietly(async () => {
        const harness = createHarness({ creations: [httpError(400, { detail: "bad" }), created] });
        await harness.initialize();

        await harness.phaseStarted(CONFIGURED);

        const bodies = harness.creationBodies();
        assert.equal(bodies.length, 2);
        assert.equal(bodies[1].llm_tier, undefined);
        assert.deepEqual(harness.roomJobCalls.at(-1), ["open", "room-job-1", { bound: true }]);
        assert.equal(harness.callbacks.at(-1).payload.rooms[0].configurationRejected, true);
    }));

    it("a 400 without configured settings fails the room at once", () => quietly(async () => {
        const harness = createHarness({ creations: [httpError(400)] });
        await harness.initialize();

        await harness.phaseStarted();

        assert.equal(harness.creationBodies().length, 1);
        assert.deepEqual(harness.callbacks.at(-1).payload.roomsFailed, [{
            room:       ROOM,
            reason:     ROOM_FAILURE_REASONS.SESSION_CREATION_FAILED,
            statusCode: 400,
        }]);
    }));

    it("EthicApp's own credential gap is not sent again", () => quietly(async () => {
        const harness = createHarness({ creations: [new AiAdditionsCredentialsMissingError()] });
        await harness.initialize();

        await harness.phaseStarted();

        assert.equal(harness.creationBodies().length, 1);
        assert.deepEqual(harness.callbacks.at(-1).payload.roomsFailed, [{
            room:   ROOM,
            reason: ROOM_FAILURE_REASONS.SESSION_CREATION_FAILED,
        }]);
    }));

    it("a first answer opens the job with one request", () => quietly(async () => {
        const harness = createHarness({ creations: [created] });
        await harness.initialize();

        await harness.phaseStarted();

        assert.equal(harness.creationBodies().length, 1);
        assert.equal(harness.clockReads, 1);
        assert.deepEqual(harness.roomJobCalls.at(-1), ["open", "room-job-1", { bound: true }]);
    }));
});

// The errors the real client reports, against a local HTTP server: what
// isUnansweredRequest() reads is what AiAdditionsClient and Node's fetch
// produce, not an assumption.
describe("AiAdditionsClient errors", () => {
    let server;
    let baseUrl;
    let polyadicAnswers;
    const env = {
        AI_ADDITIONS_KEYCLOAK_CLIENT_ID:     "ethicapp",
        AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET: "test-secret",
        AI_ADDITIONS_HTTP_TIMEOUT_MS:        "1000",
    };

    before(async () => {
        server = http.createServer((request, response) => {
            let raw = "";
            request.on("data", chunk => {
                raw += chunk;
            });
            request.on("end", () => {
                if (request.url.includes("/protocol/openid-connect/token")) {
                    response.writeHead(200, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ access_token: "token", expires_in: 300 }));
                    return;
                }
                const answer = polyadicAnswers.shift() ?? "hang";
                if (answer === "hang") {
                    return;
                }
                const body = raw ? JSON.parse(raw) : {};
                const [status, payload] = answer(body);
                response.writeHead(status, { "Content-Type": "application/json" });
                response.end(JSON.stringify(payload));
            });
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });

    function realClient(url = baseUrl) {
        return new AiAdditionsClient({ env, getConnection: async () => ({ baseUrl: url }) });
    }

    it("a timeout and a refused connection are unanswered; a 504 is an answer", async () => {
        const client = realClient();

        polyadicAnswers = ["hang"];
        const timedOut = await client.requestJson("/rooms/x/sessions", {
            method: "POST", body: {}, basePath: "/polyadic-agent/api", timeoutMs: 50,
        }).catch(error => error);
        assert.equal(timedOut.statusCode, undefined);
        assert.equal(isUnansweredRequest(timedOut), true);

        polyadicAnswers = [() => [504, { detail: "Gateway Timeout" }]];
        const gateway = await client.requestJson("/rooms/x/sessions", {
            method: "POST", body: {}, basePath: "/polyadic-agent/api",
        }).catch(error => error);
        assert.equal(gateway.statusCode, 504);
        assert.equal(isUnansweredRequest(gateway), false);

        // A port nothing listens on: bind one, then close it.
        const closed = http.createServer();
        await new Promise(resolve => closed.listen(0, "127.0.0.1", resolve));
        const closedUrl = `http://127.0.0.1:${closed.address().port}`;
        await new Promise(resolve => closed.close(resolve));
        const refused = await realClient(closedUrl).requestJson("/rooms/x/sessions", {
            method: "POST", body: {}, basePath: "/polyadic-agent/api", authenticated: false,
        }).catch(error => error);
        assert.equal(refused.statusCode, undefined);
        assert.equal(isUnansweredRequest(refused), true);
    });

    it("the bridge resends a creation the real client timed out, and the resend binds the job",
        () => quietly(async () => {
            polyadicAnswers = [
                "hang",
                body => [201, {
                    status:                       "ya_inicializado",
                    ethicapp_room_correlation_id: body.ethicapp_room_correlation_id,
                }],
            ];
            const callbacks = [];
            const roomJobCalls = [];
            const subscribers = new Map();
            await register({
                service:   { id: "polyadic-devils-advocate" },
                subscribe: (hookName, handler) => subscribers.set(hookName, handler),
                async publishGroupChatMessage() {
                    return null;
                },
                aiAdditionsClient: realClient(),
                roomJobs:          {
                    create: async () => ({ id: "room-job-1" }),
                    open:   async (id, options) => {
                        roomJobCalls.push(["open", id, options]);
                        return true;
                    },
                    fail: async (id, options) => {
                        roomJobCalls.push(["fail", id, options]);
                    },
                },
                polyadicBridgeDependencies: {
                    getTeamIdsForPhase:         async () => [301],
                    getFirstQuestionIdForPhase: async () => 701,
                    getFirstQuestionForPhase:   async () => ({ id: 701, title: "Question" }),
                    getCaseIdBySessionId:       async () => 51,
                    getCaseDocumentRawText:     async () => "Case text.",
                    getParticipantIdentity:     async () => null,
                    getSessionLanguageCode:     async () => "es_CL",
                },
            });

            await subscribers.get("phase-started")({ sessionId: SESSION_ID, phaseId: PHASE_ID }, {
                callback:            async result => callbacks.push(result),
                reportInstantiation: async () => {},
            });

            assert.deepEqual(roomJobCalls, [["open", "room-job-1", { bound: true }]]);
            assert.equal(callbacks.at(-1).payload.roomsCreated, 1);
        }));
});
