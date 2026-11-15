// The case inputs the Polyadic bridge sends (#1221, epic
// ethicapp-ai-additions#293): the `discussion_topics` of a `contentCoverage`
// room, the `topics` of the case's `topic-listing/v1`, resolved with
// helpers/case-session-inputs.js from what Polyadic's descriptor declares.
// A room whose configuration requires a case input it cannot get, or whose
// input Polyadic rejects, is not created in another mode: its room job fails
// and records why. The AI Additions client, the descriptor, the room jobs and
// the case analyses are fakes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildPolyadicSessionPayload,
    register,
    roomConfiguration,
} from "../polyadic-bridge.adapter.js";
import {
    caseInputRejection,
    DISCUSSION_TOPICS_INPUT,
    rejectedCaseInput,
    resolveRoomCaseInputs,
    ROOM_FAILURE_REASONS,
} from "../polyadic-bridge.case-inputs.js";
import { normalizeSessionInputs } from "../../../services/capability-descriptors.service.js";

const SESSION_ID = 11;
const PHASE_ID = 22;
const CASE_ID = 51;
const LISTING_SERVICE_ID = "case-analyst-topic-listing";
const TOPIC_LISTING_SCHEMA = "topic-listing/v1";
const GENERATED_AT = "2026-11-14T09:30:00.000Z";
const LISTING_JOB_ID = "9b0c4f8e-3d1a-4c55-9a51-6f0d2b7e4a10";

const TOPICS = Object.freeze([
    { id: "T1", topic: "Responsabilidad profesional", description: "Qué le debe Sebastián a los usuarios." },
    { id: "T2", topic: "Presión jerárquica", description: "Cómo pesa la evaluación de su jefe." },
    { id: "T3", topic: "Transparencia", description: "A quién debe informar del defecto." },
]);

const COVERAGE = Object.freeze({ pipeline_type: "contentCoverage" });

// Polyadic's descriptor as the registry hands it over
// (getServiceInstanceConfiguration()), normalized from its raw
// `session_inputs`.
function descriptorOf({ declaresTopics = true } = {}) {
    const raw = {
        phase_clock: { type: "object" },
        ...(declaresTopics
            ? {
                [DISCUSSION_TOPICS_INPUT]: {
                    source: {
                        kind:            "case_analysis",
                        document_schema: TOPIC_LISTING_SCHEMA,
                        pointer:         "/topics",
                    },
                    required_when: [{ field: "pipeline_type", in: ["contentCoverage"] }],
                },
            }
            : {}),
    };
    const { sessionInputs, sessionInputDeclarations } = normalizeSessionInputs(raw);
    return {
        available: true,
        fields:    [
            {
                key:     "pipeline_type",
                type:    "enum",
                default: "devilsAdvocate",
                enum:    ["devilsAdvocate", "contentCoverage"],
            },
            { key: "llm_tier", type: "enum", default: "basic", enum: ["basic", "advanced"] },
        ],
        sessionInputs,
        sessionInputDeclarations,
    };
}

function listingRow(overrides = {}) {
    return {
        case_id:         CASE_ID,
        service_id:      LISTING_SERVICE_ID,
        status:          "ready",
        is_stale:        false,
        document_schema: TOPIC_LISTING_SCHEMA,
        document:        { schemaVersion: TOPIC_LISTING_SCHEMA, topics: TOPICS.map(topic => ({ ...topic })) },
        job_id:          LISTING_JOB_ID,
        generated_at:    new Date(GENERATED_AT),
        reviewed_at:     null,
        ...overrides,
    };
}

function httpError(statusCode, responseBody = null) {
    return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode, responseBody });
}

function topicsRejection() {
    return httpError(400, {
        detail: {
            field:  DISCUSSION_TOPICS_INPUT,
            error:  "discussion_topics is invalid",
            errors: [{ path: "/1/description", message: `'${TOPICS[1].description}' is too long` }],
        },
    });
}

function quietConsole() {
    const original = { info: console.info, warn: console.warn };
    const warnings = [];
    console.info = () => {};
    console.warn = (...args) => warnings.push(args);
    return {
        warnings,
        restore() {
            Object.assign(console, original);
        },
    };
}

/**
 * @param {object} [options]
 * @param {object|null|Function} [options.descriptor] what the registry
 *        answers, or a function that throws
 * @param {object|null|Function} [options.row] the case's listing, or a
 *        function of the read
 * @param {Function} [options.respond] Polyadic's answer to each request
 * @param {boolean} [options.withDescriptorAccess] whether the registry hands
 *        the adapter its descriptor access (an older registry does not)
 */
function createHarness({
    descriptor = descriptorOf(),
    row = listingRow(),
    respond = null,
    teamIds = [301, 302],
    withDescriptorAccess = true,
    producers = [LISTING_SERVICE_ID],
    dependencies = {},
} = {}) {
    const subscribers = new Map();
    const requests = [];
    const callbacks = [];
    const reports = [];
    const roomJobCalls = [];
    const analysisReads = [];
    const descriptorReads = [];
    let nextRoomJob = 0;

    const client = {
        async getEndpoints() {
            return { baseUrl: "http://ai.local" };
        },
        async requestJson(pathname, options) {
            requests.push({ pathname, method: options.method, body: options.body });
            return respond
                ? respond(pathname, options, requests.length)
                : { status:                       "created", warnings:                     [], degraded:                     false,
                    ethicapp_room_correlation_id: options.body?.ethicapp_room_correlation_id };
        },
    };

    const sessionInputs = {
        declares: async () => false,
        ...(withDescriptorAccess
            ? {
                descriptor: async (args) => {
                    descriptorReads.push(args);
                    return typeof descriptor === "function" ? descriptor(args) : descriptor;
                },
            }
            : {}),
    };

    return {
        requests,
        callbacks,
        reports,
        roomJobCalls,
        analysisReads,
        descriptorReads,
        sessionBodies() {
            return requests.filter(request => request.pathname.endsWith("/sessions"))
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
                sessionInputs,
                roomJobs:          {
                    create: async (room) => {
                        nextRoomJob += 1;
                        const id = `room-job-${nextRoomJob}`;
                        roomJobCalls.push(["create", id, room.room, room.hookName]);
                        return { id };
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
                    getCaseIdBySessionId:       async () => CASE_ID,
                    getCaseDocumentRawText:     async () => "Case text.",
                    getParticipantIdentity:     async () => null,
                    getSessionLanguageCode:     async () => "es_CL",
                    getPhaseClock:              async () => null,
                    caseInputDependencies:      {
                        producerServiceIds: async () => producers,
                        getCaseAnalysis:    async (args) => {
                            analysisReads.push(args);
                            return typeof row === "function" ? row(args) : row;
                        },
                    },
                    ...dependencies,
                },
            });
        },
        async dispatch(hookName, context) {
            const handler = subscribers.get(hookName);
            assert.equal(typeof handler, "function", `Missing subscriber for ${hookName}`);
            await handler(context, {
                callback: async (result) => {
                    callbacks.push(result);
                    return result;
                },
                reportInstantiation: async (report) => {
                    reports.push(report);
                    return report;
                },
            });
        },
        phaseStarted(serviceConfiguration) {
            return this.dispatch("phase-started", {
                sessionId: SESSION_ID,
                phaseId:   PHASE_ID,
                ...(serviceConfiguration === undefined ? {} : { serviceConfiguration }),
            });
        },
        chatMessage(serviceConfiguration, groupId = 301) {
            return this.dispatch("chat-message-received", {
                sessionId:     SESSION_ID,
                phaseId:       PHASE_ID,
                groupId,
                userId:        9001,
                correlationId: "corr-1",
                content:       "Hola",
                ...(serviceConfiguration === undefined ? {} : { serviceConfiguration }),
            });
        },
    };
}

async function quietly(action) {
    const output = quietConsole();
    try {
        return await action(output);
    } finally {
        output.restore();
    }
}

// What the room job records for the listing above.
const SENT_LISTING = Object.freeze({
    key:            DISCUSSION_TOPICS_INPUT,
    serviceId:      LISTING_SERVICE_ID,
    caseId:         CASE_ID,
    documentSchema: TOPIC_LISTING_SCHEMA,
    pointer:        "/topics",
    jobId:          LISTING_JOB_ID,
    generatedAt:    GENERATED_AT,
    reviewedAt:     null,
    ids:            ["T1", "T2", "T3"],
});

describe("a configuration that requires the case's topics", () => {
    it("creates every room with the listing's topics, in order", () => quietly(async () => {
        const harness = createHarness();
        await harness.initialize();

        await harness.phaseStarted(COVERAGE);

        const bodies = harness.sessionBodies();
        assert.equal(bodies.length, 2);
        for (const body of bodies) {
            assert.equal(body.pipeline_type, "contentCoverage");
            assert.deepEqual(body[DISCUSSION_TOPICS_INPUT], TOPICS);
        }
        assert.deepEqual(harness.descriptorReads, [{ sessionId: SESSION_ID }]);
        // One read for the phase, not one per room.
        assert.deepEqual(harness.analysisReads, [{ caseId: CASE_ID, serviceId: LISTING_SERVICE_ID }]);
        assert.equal(harness.callbacks.at(-1).status, "completed");
        assert.equal(harness.callbacks.at(-1).payload.roomsCreated, 2);
    }));

    it("sends an unreviewed listing, and the teacher's edited one as stored", () => quietly(async () => {
        const edited = [{ id: "T1", topic: "Edited", description: "Edited by the teacher." }];
        const harness = createHarness({
            row: listingRow({
                document:    { topics: edited },
                job_id:      null,
                reviewed_at: new Date("2026-11-14T10:00:00.000Z"),
            }),
        });
        await harness.initialize();

        await harness.phaseStarted(COVERAGE);

        assert.deepEqual(harness.sessionBodies()[0][DISCUSSION_TOPICS_INPUT], edited);
        const [, , options] = harness.roomJobCalls.find(call => call[0] === "open");
        assert.deepEqual(options.report.caseInputs, [{
            ...SENT_LISTING,
            jobId:      null,
            reviewedAt: "2026-11-14T10:00:00.000Z",
            ids:        ["T1"],
        }]);
    }));

    it("records on each room job which listing was sent, without its texts", () => quietly(async () => {
        const harness = createHarness({ teamIds: [301] });
        await harness.initialize();

        await harness.phaseStarted({ ...COVERAGE, llm_tier: "advanced" });

        assert.deepEqual(harness.roomJobCalls, [
            ["create", "room-job-1", "ethicapp-s11-p22-g301", "phase-started"],
            ["open", "room-job-1", {
                bound:  true,
                report: {
                    warnings:              [],
                    degraded:              false,
                    configurationRejected: false,
                    caseInputs:            [SENT_LISTING],
                },
            }],
        ]);
        const serialized = JSON.stringify(harness.roomJobCalls);
        for (const topic of TOPICS) {
            assert.equal(serialized.includes(topic.description), false);
            assert.equal(serialized.includes(topic.topic), false);
        }
        // The job result names it too, for the hook job.
        assert.deepEqual(harness.callbacks.at(-1).payload.rooms[0].caseInputs, [SENT_LISTING]);
        assert.deepEqual(harness.reports[0].rooms[0].caseInputs, [SENT_LISTING]);
    }));

    it("follows the deployment's pipeline type when the phase sets none", () => quietly(async () => {
        const previous = process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE;
        process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE = "contentCoverage";
        try {
            const harness = createHarness({ teamIds: [301] });
            await harness.initialize();

            await harness.phaseStarted({});

            const [body] = harness.sessionBodies();
            assert.equal(body.pipeline_type, "contentCoverage");
            assert.deepEqual(body[DISCUSSION_TOPICS_INPUT], TOPICS);
        } finally {
            if (previous === undefined) {
                delete process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE;
            } else {
                process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE = previous;
            }
        }
    }));

    it("a room created from a chat message gets the same topics", () => quietly(async () => {
        const harness = createHarness({ teamIds: [] });
        await harness.initialize();

        await harness.chatMessage(COVERAGE);

        const [body] = harness.sessionBodies();
        assert.deepEqual(body[DISCUSSION_TOPICS_INPUT], TOPICS);
        const callback = harness.callbacks.at(-1);
        assert.equal(callback.status, "completed");
        assert.deepEqual(callback.payload.roomCreated.caseInputs, [SENT_LISTING]);
        assert.equal(harness.requests.at(-1).pathname, "/rooms/ethicapp-s11-p22-g301/messages");
    }));
});

describe("payloads of rooms that require no case input are unchanged", () => {
    // The payload as the bridge built it before #1221.
    async function baselineBodies(serviceConfiguration) {
        const harness = createHarness({ withDescriptorAccess: false });
        await harness.initialize();
        await harness.phaseStarted(serviceConfiguration);
        return harness.sessionBodies();
    }

    for (const [label, serviceConfiguration] of [
        ["devilsAdvocate", { pipeline_type: "devilsAdvocate" }],
        ["abogado-del-diablo", { pipeline_type: "abogado-del-diablo", llm_tier: "basic" }],
        ["the deployment default", undefined],
    ]) {
        it(`${label}: byte-identical, and no case analysis is read`, () => quietly(async () => {
            const expected = await baselineBodies(serviceConfiguration);
            const harness = createHarness();
            await harness.initialize();

            await harness.phaseStarted(serviceConfiguration);

            const bodies = harness.sessionBodies();
            assert.equal(JSON.stringify(bodies), JSON.stringify(expected));
            assert.ok(bodies.every(body => !Object.hasOwn(body, DISCUSSION_TOPICS_INPUT)));
            assert.deepEqual(harness.analysisReads, []);
            assert.ok(harness.roomJobCalls.filter(call => call[0] === "open")
                .every(([, , options]) => !Object.hasOwn(options, "report")));
        }));
    }

    it("devilsAdvocate: the exact bytes the bridge sent before #1221", () => quietly(async () => {
        const harness = createHarness({ teamIds: [301] });
        await harness.initialize();

        await harness.phaseStarted({ pipeline_type: "devilsAdvocate", llm_tier: "basic" });

        assert.equal(JSON.stringify(harness.sessionBodies()[0]), "{"
            + "\"prompt_inicial\":\"Case text.\\n\\nCentral question: Question\","
            + "\"pipeline_type\":\"devilsAdvocate\","
            + "\"locale\":\"es-CL\","
            + "\"llm_tier\":\"basic\","
            + "\"ethicapp_room_correlation_id\":\"room-job-1\"}");
    }));

    it("a descriptor without the declaration sends nothing, even for contentCoverage",() => quietly(async () => {
        const expected = await baselineBodies(COVERAGE);
        const harness = createHarness({ descriptor: descriptorOf({ declaresTopics: false }) });
        await harness.initialize();

        await harness.phaseStarted(COVERAGE);

        assert.equal(JSON.stringify(harness.sessionBodies()), JSON.stringify(expected));
        assert.deepEqual(harness.analysisReads, []);
    }));

    it("an unavailable or unreadable descriptor sends nothing", () => quietly(async () => {
        const expected = await baselineBodies({ pipeline_type: "devilsAdvocate" });
        for (const descriptor of [
            null,
            { available: false, reason: "unavailable" },
            () => {
                throw new Error("descriptor cache unavailable");
            },
        ]) {
            const harness = createHarness({ descriptor });
            await harness.initialize();

            await harness.phaseStarted({ pipeline_type: "devilsAdvocate" });

            assert.equal(JSON.stringify(harness.sessionBodies()), JSON.stringify(expected));
        }
    }));

    it("buildPolyadicSessionPayload adds no key without case inputs", () => {
        const options = {
            topic: "Topic", locale: "en-US", serviceConfiguration: { llm_tier: "basic" },
        };
        assert.equal(
            JSON.stringify(buildPolyadicSessionPayload({ ...options, caseInputs: {} })),
            JSON.stringify(buildPolyadicSessionPayload(options))
        );
        assert.equal(
            JSON.stringify(buildPolyadicSessionPayload({ ...options, caseInputs: null })),
            JSON.stringify(buildPolyadicSessionPayload(options))
        );
    });
});

describe("no room in another mode", () => {
    for (const [label, row, status] of [
        ["no listing", null, "absent"],
        ["a listing being generated", listingRow({ status: "processing", document: null }), "pending"],
        ["a failed listing", listingRow({ status: "failed", document: null }), "failed"],
    ]) {
        it(`${label}: no room is requested and every room job fails`, () => quietly(async () => {
            const harness = createHarness({ row });
            await harness.initialize();

            await harness.phaseStarted(COVERAGE);

            assert.deepEqual(harness.sessionBodies(), []);
            const failure = {
                reason:  ROOM_FAILURE_REASONS.MISSING_CASE_INPUTS,
                missing: [{ key: DISCUSSION_TOPICS_INPUT, documentSchema: TOPIC_LISTING_SCHEMA, status }],
            };
            assert.deepEqual(harness.roomJobCalls.filter(call => call[0] !== "create"), [
                ["fail", "room-job-1", { report: {
                    warnings: [], degraded: false, configurationRejected: false, failure,
                } }],
                ["fail", "room-job-2", { report: {
                    warnings: [], degraded: false, configurationRejected: false, failure,
                } }],
            ]);
            const callback = harness.callbacks.at(-1);
            assert.equal(callback.status, "failed");
            assert.equal(callback.payload.roomsCreated, 0);
            assert.deepEqual(callback.payload.roomsFailed, [
                { room: "ethicapp-s11-p22-g301", ...failure },
                { room: "ethicapp-s11-p22-g302", ...failure },
            ]);
            assert.deepEqual(harness.reports, []);
        }));
    }

    it("a session without a case is missing its listing", () => quietly(async () => {
        const harness = createHarness({
            teamIds:      [301],
            dependencies: { getCaseIdBySessionId: async () => null },
        });
        await harness.initialize();

        await harness.phaseStarted(COVERAGE);

        assert.deepEqual(harness.sessionBodies(), []);
        assert.equal(harness.callbacks.at(-1).payload.roomsFailed[0].missing[0].status, "absent");
    }));

    it("a failed read of the listing fails the rooms instead of omitting the topics", () => quietly(async (output) => {
        const harness = createHarness({
            row: () => {
                throw new Error("database unavailable");
            },
        });
        await harness.initialize();

        await harness.phaseStarted(COVERAGE);

        assert.deepEqual(harness.sessionBodies(), []);
        assert.deepEqual(harness.callbacks.at(-1).payload.roomsFailed.map(room => room.reason),
            [ROOM_FAILURE_REASONS.CASE_INPUTS_UNREADABLE, ROOM_FAILURE_REASONS.CASE_INPUTS_UNREADABLE]);
        assert.equal(harness.callbacks.at(-1).status, "failed");
        assert.ok(output.warnings.some(([message]) => String(message).includes("case inputs")));
    }));

    it("a failed read of the session's case fails the rooms too", () => quietly(async () => {
        const harness = createHarness({
            teamIds:      [301],
            dependencies: {
                getCaseIdBySessionId: async () => {
                    throw new Error("database unavailable");
                },
            },
        });
        await harness.initialize();

        await harness.phaseStarted(COVERAGE);

        assert.deepEqual(harness.sessionBodies(), []);
        assert.deepEqual(harness.analysisReads, []);
        assert.equal(harness.callbacks.at(-1).payload.roomsFailed[0].reason,
            ROOM_FAILURE_REASONS.CASE_INPUTS_UNREADABLE);
    }));

    it("a failed read of the session's case leaves other rooms as they were", () => quietly(async () => {
        const harness = createHarness({
            teamIds:      [301],
            dependencies: {
                getCaseIdBySessionId: async () => {
                    throw new Error("database unavailable");
                },
            },
        });
        await harness.initialize();

        await harness.phaseStarted({ pipeline_type: "devilsAdvocate" });

        assert.equal(harness.sessionBodies().length, 1);
        assert.equal(harness.callbacks.at(-1).status, "completed");
    }));

    it("Polyadic's 400 on discussion_topics is not retried without the settings", () => quietly(async () => {
        const harness = createHarness({
            teamIds: [301],
            respond: () => {
                throw topicsRejection();
            },
        });
        await harness.initialize();

        await harness.phaseStarted(COVERAGE);

        assert.equal(harness.sessionBodies().length, 1);
        const failure = {
            reason:    ROOM_FAILURE_REASONS.CASE_INPUT_REJECTED,
            rejection: {
                field: DISCUSSION_TOPICS_INPUT,
                error: "discussion_topics is invalid",
                paths: ["/1/description"],
            },
        };
        assert.deepEqual(harness.roomJobCalls.at(-1), ["fail", "room-job-1", { report: {
            warnings:              [],
            degraded:              false,
            configurationRejected: false,
            caseInputs:            [SENT_LISTING],
            failure,
        } }]);
        const callback = harness.callbacks.at(-1);
        assert.equal(callback.status, "failed");
        assert.deepEqual(callback.payload.roomsFailed, [{ room: "ethicapp-s11-p22-g301", ...failure }]);
        // Polyadic's message quotes a description; it is not recorded.
        assert.equal(JSON.stringify(harness.roomJobCalls).includes(TOPICS[1].description), false);
    }));

    it("the 400 is not retried even when the descriptor could not be read", () => quietly(async () => {
        const harness = createHarness({
            teamIds:    [301],
            descriptor: null,
            respond:    () => {
                throw httpError(400, { detail: { field: DISCUSSION_TOPICS_INPUT, error: "missing" } });
            },
        });
        await harness.initialize();

        await harness.phaseStarted(COVERAGE);

        assert.equal(harness.sessionBodies().length, 1);
        assert.equal(harness.callbacks.at(-1).payload.roomsFailed[0].reason,
            ROOM_FAILURE_REASONS.CASE_INPUT_REJECTED);
    }));

    it("a 400 on another setting of a configuration that requires topics is not retried", () => quietly(async () => {
        const rejection = { detail: { errors: { llm_tier: "unknown" } } };
        const harness = createHarness({
            teamIds: [301],
            respond: () => {
                throw httpError(400, rejection);
            },
        });
        await harness.initialize();

        await harness.phaseStarted({ ...COVERAGE, llm_tier: "legacy" });

        assert.equal(harness.sessionBodies().length, 1);
        assert.deepEqual(harness.callbacks.at(-1).payload.roomsFailed, [{
            room:   "ethicapp-s11-p22-g301",
            reason: ROOM_FAILURE_REASONS.CONFIGURATION_REJECTED,
            rejection,
        }]);
    }));

    it("other modes keep the retry without the settings", () => quietly(async () => {
        const harness = createHarness({
            teamIds: [301],
            respond: (pathname, options, count) => {
                if (count === 1) {
                    throw httpError(400, { detail: { errors: { llm_tier: "unknown" } } });
                }
                return { status: "created", warnings: [], degraded: false };
            },
        });
        await harness.initialize();

        await harness.phaseStarted({ pipeline_type: "devilsAdvocate", llm_tier: "legacy" });

        const bodies = harness.sessionBodies();
        assert.equal(bodies.length, 2);
        assert.equal(Object.hasOwn(bodies[1], "llm_tier"), false);
        assert.equal(harness.callbacks.at(-1).payload.rooms[0].configurationRejected, true);
        assert.equal(harness.callbacks.at(-1).status, "completed");
    }));

    it("a chat message does not create a room without its topics", () => quietly(async () => {
        const harness = createHarness({ teamIds: [], row: null });
        await harness.initialize();

        await harness.chatMessage(COVERAGE);

        assert.deepEqual(harness.requests, []);
        assert.deepEqual(harness.callbacks.at(-1), {
            serviceId: "polyadic-devils-advocate",
            hook:      "chat-message-received",
            status:    "failed",
            payload:   {
                sessionId: SESSION_ID,
                phaseId:   PHASE_ID,
                groupId:   301,
                reason:    ROOM_FAILURE_REASONS.MISSING_CASE_INPUTS,
                missing:   [{
                    key: DISCUSSION_TOPICS_INPUT, documentSchema: TOPIC_LISTING_SCHEMA, status: "absent",
                }],
            },
        });
        assert.equal(harness.roomJobCalls.at(-1)[0], "fail");
    }));

    it("a chat message's room rejected by Polyadic forwards nothing", () => quietly(async () => {
        const harness = createHarness({
            teamIds: [],
            respond: () => {
                throw topicsRejection();
            },
        });
        await harness.initialize();

        await harness.chatMessage(COVERAGE);

        assert.equal(harness.requests.length, 1);
        assert.equal(harness.callbacks.at(-1).payload.reason, ROOM_FAILURE_REASONS.CASE_INPUT_REJECTED);
    }));

    it("other failures keep the job completed and name the failed rooms", () => quietly(async () => {
        const harness = createHarness({
            teamIds: [301],
            respond: () => {
                throw httpError(503);
            },
        });
        await harness.initialize();

        await harness.phaseStarted({ pipeline_type: "devilsAdvocate" });

        const callback = harness.callbacks.at(-1);
        assert.equal(callback.status, "completed");
        assert.deepEqual(callback.payload.roomsFailed, [{
            room:       "ethicapp-s11-p22-g301",
            reason:     ROOM_FAILURE_REASONS.SESSION_CREATION_FAILED,
            statusCode: 503,
        }]);
    }));
});

describe("resolveRoomCaseInputs", () => {
    const deps = (row, producers = [LISTING_SERVICE_ID]) => ({
        producerServiceIds: async () => producers,
        getCaseAnalysis:    async ({ serviceId }) => (serviceId === LISTING_SERVICE_ID ? row : null),
    });

    it("judges the configuration the room is created with", async () => {
        const configuration = roomConfiguration({ locale: "es-CL", serviceConfiguration: COVERAGE });
        assert.deepEqual(configuration, { pipeline_type: "contentCoverage", locale: "es-CL" });

        const result = await resolveRoomCaseInputs({
            descriptor: descriptorOf(), configuration, caseId: CASE_ID, deps: deps(listingRow()),
        });
        assert.deepEqual(result.values, { [DISCUSSION_TOPICS_INPUT]: TOPICS });
        assert.deepEqual(result.sent, [SENT_LISTING]);
        assert.deepEqual(result.keys, [DISCUSSION_TOPICS_INPUT]);
        assert.equal(result.required, true);
    });

    it("records the producer whose listing was used", async () => {
        const result = await resolveRoomCaseInputs({
            descriptor:    descriptorOf(),
            configuration: COVERAGE,
            caseId:        CASE_ID,
            deps:          {
                producerServiceIds: async () => ["mock-topics", LISTING_SERVICE_ID],
                getCaseAnalysis:    async ({ serviceId }) => (serviceId === LISTING_SERVICE_ID
                    ? listingRow()
                    : listingRow({ service_id: serviceId, status: "failed", document: null })),
            },
        });
        assert.equal(result.sent[0].serviceId, LISTING_SERVICE_ID);
    });

    it("an optional input that cannot be read is left out", async () => {
        const descriptor = descriptorOf();
        delete descriptor.sessionInputDeclarations[DISCUSSION_TOPICS_INPUT].requiredWhen;
        const result = await resolveRoomCaseInputs({
            descriptor,
            configuration: { pipeline_type: "devilsAdvocate" },
            caseId:        CASE_ID,
            deps:          {
                producerServiceIds: async () => [LISTING_SERVICE_ID],
                getCaseAnalysis:    async () => {
                    throw new Error("database unavailable");
                },
            },
        });
        assert.deepEqual(result.values, {});
        assert.equal(result.required, false);
        assert.equal(result.failure, undefined);
        assert.ok(result.error instanceof Error);
    });
});

describe("rejectedCaseInput and caseInputRejection", () => {
    it("names a case input only for a 400 whose detail names it", () => {
        assert.equal(rejectedCaseInput(topicsRejection(), []), DISCUSSION_TOPICS_INPUT);
        assert.equal(rejectedCaseInput(httpError(400, { detail: { field: "essay" } }), ["essay"]), "essay");
        assert.equal(rejectedCaseInput(httpError(400, { detail: { field: "llm_tier" } }), []), null);
        assert.equal(rejectedCaseInput(httpError(422, { detail: { field: DISCUSSION_TOPICS_INPUT } })), null);
        assert.equal(rejectedCaseInput(httpError(400, "Bad Request")), null);
        assert.equal(rejectedCaseInput(new Error("timeout")), null);
    });

    it("keeps the field, the error and the paths, not the messages", () => {
        assert.deepEqual(caseInputRejection(topicsRejection()), {
            field: DISCUSSION_TOPICS_INPUT,
            error: "discussion_topics is invalid",
            paths: ["/1/description"],
        });
        assert.deepEqual(caseInputRejection(httpError(400, null)), { field: null, error: null });
    });
});
