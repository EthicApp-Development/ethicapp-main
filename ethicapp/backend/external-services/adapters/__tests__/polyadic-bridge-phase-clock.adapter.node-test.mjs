// The phase clock the Polyadic bridge sends (#1178, epic #1105): the
// `phase_clock` session input of the rooms of a timed phase, computed from
// the activity's clock (helpers/phase-clock.js) when each request is sent,
// and the new clock sent to each running room after "+1 min" through
// `phase-clock-changed`. Only when Polyadic's descriptor declares
// `session_inputs.phase_clock` (ethicapp-ai-additions#259). The AI Additions
// client, the descriptor check and the database reads are fakes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildPhaseClock,
    buildPolyadicSessionPayload,
    PHASE_CLOCK_MAX_DURATION_SECONDS,
    register,
} from "../polyadic-bridge.adapter.js";

const SESSION_ID = 11;
const PHASE_ID = 22;
const STARTED_AT = "2026-11-11T10:00:00.000Z";
const ENDS_AT = "2026-11-11T10:15:00.000Z";

function at(time) {
    return `2026-11-11T${time}Z`;
}

// A clock as helpers/phase-clock.js reads it.
function clockOf({
    timeMode = "soft",
    finished = false,
    phaseId = PHASE_ID,
    startedAt = STARTED_AT,
    endsAt = ENDS_AT,
    serverNow = at("10:00:16.000"),
} = {}) {
    return {
        sessionId:   SESSION_ID,
        timeMode,
        finished,
        phaseId,
        phaseNumber: 2,
        startedAt,
        endsAt:      timeMode === "none" ? null : endsAt,
        isLastPhase: false,
        serverNow,
    };
}

function httpError(statusCode, responseBody = null) {
    return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode, responseBody });
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
 * @param {object} options
 * @param {boolean} [options.declaresPhaseClock] what the descriptor declares
 * @param {Array<object>|Function} [options.clocks] the clocks read in turn
 *        (the last one repeats), or a function of the read count
 * @param {Function} [options.respond] Polyadic's answer to each request
 */
function createHarness({
    declaresPhaseClock = true,
    clocks = [clockOf()],
    respond = null,
    teamIds = [301, 302],
    declares = null,
    dependencies = {},
} = {}) {
    const subscribers = new Map();
    const requests = [];
    const callbacks = [];
    const clockReads = [];
    const declarations = [];

    const client = {
        async getEndpoints() {
            return { baseUrl: "http://ai.local" };
        },
        async requestJson(pathname, options) {
            requests.push({ pathname, method: options.method, body: options.body });
            return respond ? respond(pathname, options, requests.length) : { status: "ok" };
        },
    };

    const readClock = async (sessionId) => {
        clockReads.push(sessionId);
        if (typeof clocks === "function") {
            return clocks(clockReads.length);
        }
        return clocks[Math.min(clockReads.length, clocks.length) - 1];
    };

    return {
        requests,
        callbacks,
        clockReads,
        declarations,
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
                sessionInputs:     {
                    declares: async (name) => {
                        declarations.push(name);
                        if (declares) {
                            return declares(name);
                        }
                        return declaresPhaseClock && name === "phase_clock";
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
                    getPhaseClock:              readClock,
                    ...dependencies,
                },
            });
        },
        async dispatch(hookName, context = { sessionId: SESSION_ID, phaseId: PHASE_ID }) {
            const handler = subscribers.get(hookName);
            assert.equal(typeof handler, "function", `Missing subscriber for ${hookName}`);
            await handler(context, {
                callback:            async result => { callbacks.push(result); return result; },
                reportInstantiation: async report => report,
            });
        },
        creations() {
            return requests.filter(request => request.method === "POST"
                && request.pathname.endsWith("/sessions"));
        },
        clockUpdates() {
            return requests.filter(request => request.method === "PUT");
        },
    };
}

async function quietly(run) {
    const output = quietConsole();
    try {
        await run(output);
    } finally {
        output.restore();
    }
    return output;
}

describe("buildPhaseClock", () => {
    it("gives the phase's length and the time left when the clock was read", () => {
        assert.deepEqual(buildPhaseClock(clockOf(), PHASE_ID),
            { duration_seconds: 900, remaining_seconds: 884 });
    });

    it("counts the extensions in the length", () => {
        const extended = clockOf({ endsAt: at("10:17:00.000"), serverNow: at("10:14:30.000") });
        assert.deepEqual(buildPhaseClock(extended, PHASE_ID),
            { duration_seconds: 1020, remaining_seconds: 150 });
    });

    it("gives a negative time left after the deadline (soft mode, hard last phase)", () => {
        for (const timeMode of ["soft", "hard"]) {
            const overdue = clockOf({ timeMode, serverNow: at("10:17:15.000") });
            assert.deepEqual(buildPhaseClock(overdue, PHASE_ID),
                { duration_seconds: 900, remaining_seconds: -135 });
        }
    });

    it("rounds to whole seconds", () => {
        const clock = clockOf({
            endsAt:    "2026-11-11T10:15:00.400Z",
            serverNow: at("10:00:15.600"),
        });
        assert.deepEqual(buildPhaseClock(clock, PHASE_ID),
            { duration_seconds: 900, remaining_seconds: 885 });
    });

    it("gives no clock to an untimed or finished activity or a phase without a duration", () => {
        assert.equal(buildPhaseClock(clockOf({ timeMode: "none" }), PHASE_ID), null);
        assert.equal(buildPhaseClock(clockOf({ endsAt: null }), PHASE_ID), null);
        assert.equal(buildPhaseClock(clockOf({ startedAt: null }), PHASE_ID), null);
        const finished = { ...clockOf(), finished: true, phaseId: null };
        assert.equal(buildPhaseClock(finished, PHASE_ID), null);
        assert.equal(buildPhaseClock(null, PHASE_ID), null);
    });

    it("gives no clock for a phase that is no longer the current one", () => {
        assert.equal(buildPhaseClock(clockOf({ phaseId: PHASE_ID + 1 }), PHASE_ID), null);
    });

    it("stays within Polyadic's bounds", () => {
        const dayAndMore = clockOf({
            endsAt:    "2026-11-12T10:01:00.000Z",
            serverNow: "2026-11-12T10:00:00.000Z",
        });
        assert.deepEqual(buildPhaseClock(dayAndMore, PHASE_ID),
            { duration_seconds: PHASE_CLOCK_MAX_DURATION_SECONDS, remaining_seconds: 60 });

        const overdueForDays = clockOf({ serverNow: "2026-11-13T10:00:00.000Z" });
        assert.deepEqual(buildPhaseClock(overdueForDays, PHASE_ID),
            { duration_seconds: 900, remaining_seconds: -PHASE_CLOCK_MAX_DURATION_SECONDS });

        const tooShort = clockOf({ endsAt: at("10:00:30.000"), serverNow: at("10:00:00.000") });
        assert.deepEqual(buildPhaseClock(tooShort, PHASE_ID),
            { duration_seconds: 60, remaining_seconds: 30 });
    });
});

describe("buildPolyadicSessionPayload with a phase clock", () => {
    it("sends the clock as a top-level session input, never from the configuration", () => {
        const phaseClock = { duration_seconds: 900, remaining_seconds: 884 };
        const payload = buildPolyadicSessionPayload({
            topic:                "Topic",
            serviceConfiguration: {
                phase_clock:              { duration_seconds: 60 },
                session_duration_seconds: 600,
            },
            roomCorrelationId: "job-1",
            phaseClock,
        });

        assert.deepEqual(payload.phase_clock, phaseClock);
        assert.equal(payload.ethicapp_room_correlation_id, "job-1");
        assert.equal(payload.session_duration_seconds, 600, "a stored deprecated value still goes");
    });

    it("sends no clock without one, even when the configuration names it", () => {
        const payload = buildPolyadicSessionPayload({
            serviceConfiguration: { phase_clock: { duration_seconds: 60 } },
        });
        assert.equal(Object.hasOwn(payload, "phase_clock"), false);
    });
});

describe("room creation", () => {
    it("creates the rooms of an untimed phase without a clock", async () => {
        const harness = createHarness({ clocks: [clockOf({ timeMode: "none" })] });
        await harness.initialize();

        await quietly(() => harness.dispatch("phase-started"));

        assert.equal(harness.creations().length, 2);
        for (const creation of harness.creations()) {
            assert.equal(Object.hasOwn(creation.body, "phase_clock"), false);
        }
        assert.equal(Object.hasOwn(harness.callbacks.at(-1).payload.rooms[0], "phaseClock"), false);
    });

    it("creates the rooms of a timed phase with the clock read before each request", async () => {
        // The database's clock moves on between the two rooms.
        const harness = createHarness({
            clocks: [
                clockOf({ serverNow: at("10:00:16.000") }),
                clockOf({ serverNow: at("10:00:18.000") }),
            ],
        });
        await harness.initialize();

        await quietly(() => harness.dispatch("phase-started"));

        assert.deepEqual(harness.creations().map(creation => creation.body.phase_clock), [
            { duration_seconds: 900, remaining_seconds: 884 },
            { duration_seconds: 900, remaining_seconds: 882 },
        ]);
        assert.deepEqual(harness.clockReads, [SESSION_ID, SESSION_ID]);
        assert.deepEqual(harness.callbacks.at(-1).payload.rooms.map(room => room.phaseClock), [
            { duration_seconds: 900, remaining_seconds: 884 },
            { duration_seconds: 900, remaining_seconds: 882 },
        ]);
    });

    it("sends a negative time left in soft mode after the deadline", async () => {
        const harness = createHarness({ clocks: [clockOf({ serverNow: at("10:16:00.000") })] });
        await harness.initialize();

        await quietly(() => harness.dispatch("phase-started"));

        assert.deepEqual(harness.creations()[0].body.phase_clock,
            { duration_seconds: 900, remaining_seconds: -60 });
    });

    it("sends and reads no clock when the descriptor does not declare phase_clock", async () => {
        const harness = createHarness({ declaresPhaseClock: false });
        await harness.initialize();

        await quietly(() => harness.dispatch("phase-started"));

        assert.equal(harness.creations().length, 2);
        for (const creation of harness.creations()) {
            assert.equal(Object.hasOwn(creation.body, "phase_clock"), false);
        }
        assert.deepEqual(harness.clockReads, []);
        assert.ok(harness.declarations.includes("phase_clock"));
    });

    it("gives a room created late, by the first chat message, the time left then", async () => {
        const harness = createHarness({
            teamIds: [],
            clocks:  [clockOf({ serverNow: at("10:12:00.000") })],
        });
        await harness.initialize();

        await quietly(() => harness.dispatch("chat-message-received", {
            sessionId:  SESSION_ID, phaseId:    PHASE_ID, groupId:    303, questionId: 701,
            userId:     9, content:    "First message",
        }));

        const [creation] = harness.creations();
        assert.equal(creation.pathname, "/rooms/ethicapp-s11-p22-g303/sessions");
        assert.deepEqual(creation.body.phase_clock,
            { duration_seconds: 900, remaining_seconds: 180 });
    });

    it("reads the clock again for the retry without the configured settings", async () => {
        const harness = createHarness({
            teamIds: [301],
            clocks:  [
                clockOf({ serverNow: at("10:00:16.000") }),
                clockOf({ serverNow: at("10:00:17.000") }),
            ],
            respond: (pathname, options, count) => {
                if (count === 1) {
                    throw httpError(400,
                        { detail: { errors: { session_duration_seconds: "below minimum" } } });
                }
                return { status: "ok" };
            },
        });
        await harness.initialize();

        await quietly(() => harness.dispatch("phase-started", {
            sessionId:            SESSION_ID, phaseId:              PHASE_ID,
            serviceConfiguration: { session_duration_seconds: 1 },
        }));

        const [first, retry] = harness.creations();
        assert.deepEqual(first.body.phase_clock, { duration_seconds: 900, remaining_seconds: 884 });
        assert.deepEqual(retry.body.phase_clock, { duration_seconds: 900, remaining_seconds: 883 });
        assert.equal(Object.hasOwn(retry.body, "session_duration_seconds"), false);
    });

    it("creates the room without a clock when the clock cannot be read", async () => {
        const harness = createHarness({
            teamIds: [301],
            clocks:  () => { throw new Error("database down"); },
        });
        await harness.initialize();

        const output = await quietly(() => harness.dispatch("phase-started"));

        assert.equal(harness.creations().length, 1);
        assert.equal(Object.hasOwn(harness.creations()[0].body, "phase_clock"), false);
        assert.equal(harness.callbacks.at(-1).payload.roomsCreated, 1);
        assert.ok(output.warnings.length > 0);
    });

    it("sends no clock when the descriptor check fails", async () => {
        const harness = createHarness({
            teamIds:  [301],
            declares: async () => { throw new Error("registry down"); },
        });
        await harness.initialize();

        await quietly(() => harness.dispatch("phase-started"));

        assert.equal(harness.creations().length, 1);
        assert.equal(Object.hasOwn(harness.creations()[0].body, "phase_clock"), false);
        assert.deepEqual(harness.clockReads, []);
    });
});

describe("phase-clock-changed", () => {
    const EXTENDED = clockOf({ endsAt: at("10:16:00.000"), serverNow: at("10:05:00.000") });

    it("sends the new clock to every running room of the phase", async () => {
        const harness = createHarness({ teamIds: [301, 302, 303], clocks: [EXTENDED] });
        await harness.initialize();

        await quietly(() => harness.dispatch("phase-clock-changed"));

        assert.deepEqual(harness.clockUpdates().map(update => update.pathname), [
            "/rooms/ethicapp-s11-p22-g301/sessions/active/clock",
            "/rooms/ethicapp-s11-p22-g302/sessions/active/clock",
            "/rooms/ethicapp-s11-p22-g303/sessions/active/clock",
        ]);
        for (const update of harness.clockUpdates()) {
            assert.deepEqual(update.body,
                { phase_clock: { duration_seconds: 960, remaining_seconds: 660 } });
        }
        assert.equal(harness.clockReads.length, 3, "each clock is read right before its request");

        const result = harness.callbacks.at(-1);
        assert.equal(result.hook, "phase-clock-changed");
        assert.equal(result.status, "completed");
        assert.equal(result.payload.roomsUpdated, 3);
        assert.equal(result.payload.roomsNotRunning, 0);
        assert.equal(result.payload.roomsFailed, 0);
    });

    it("keeps going when one room fails, and reports the failure", async () => {
        const harness = createHarness({
            teamIds: [301, 302, 303],
            clocks:  [EXTENDED],
            respond: (pathname) => {
                if (pathname.includes("-g302/")) {
                    throw httpError(502);
                }
                return { status: "updated" };
            },
        });
        await harness.initialize();

        const output = await quietly(() => harness.dispatch("phase-clock-changed"));

        assert.equal(harness.clockUpdates().length, 3);
        const result = harness.callbacks.at(-1);
        assert.equal(result.status, "failed");
        assert.equal(result.payload.roomsUpdated, 2);
        assert.equal(result.payload.roomsFailed, 1);
        assert.deepEqual(result.payload.rooms.map(room => room.outcome),
            ["updated", "failed", "updated"]);
        assert.ok(output.warnings.some(([message]) => message.includes("ethicapp-s11-p22-g302")));
    });

    it("counts the rooms without a running session, which answer 404", async () => {
        const harness = createHarness({
            clocks:  [EXTENDED],
            respond: () => { throw httpError(404, { detail: "No active session found" }); },
        });
        await harness.initialize();

        await quietly(() => harness.dispatch("phase-clock-changed"));

        const result = harness.callbacks.at(-1);
        assert.equal(result.status, "completed");
        assert.equal(result.payload.roomsUpdated, 0);
        assert.equal(result.payload.roomsNotRunning, 2);
    });

    it("sends nothing for a phase without groups", async () => {
        const harness = createHarness({ teamIds: [], clocks: [EXTENDED] });
        await harness.initialize();

        await quietly(() => harness.dispatch("phase-clock-changed"));

        assert.equal(harness.clockUpdates().length, 0);
        assert.equal(harness.callbacks.at(-1).status, "completed");
        assert.equal(harness.callbacks.at(-1).payload.roomsUpdated, 0);
    });

    it("sends nothing when the descriptor does not declare phase_clock", async () => {
        const harness = createHarness({ declaresPhaseClock: false, clocks: [EXTENDED] });
        await harness.initialize();

        await quietly(() => harness.dispatch("phase-clock-changed"));

        assert.equal(harness.requests.length, 0);
        assert.deepEqual(harness.clockReads, []);
        assert.equal(harness.callbacks.at(-1).status, "skipped");
        assert.equal(harness.callbacks.at(-1).payload.reason, "phase_clock_not_supported");
    });

    it("sends nothing once the phase is no longer the current one", async () => {
        const harness = createHarness({ clocks: [clockOf({ phaseId: PHASE_ID + 1 })] });
        await harness.initialize();

        await quietly(() => harness.dispatch("phase-clock-changed"));

        assert.equal(harness.clockUpdates().length, 0);
        assert.equal(harness.callbacks.at(-1).status, "skipped");
        assert.equal(harness.callbacks.at(-1).payload.reason, "no_phase_clock");
    });

    it("waits for a room still being created before sending it the clock", async () => {
        let releaseCreation;
        const creationHeld = new Promise(resolve => { releaseCreation = resolve; });
        const harness = createHarness({
            teamIds: [301],
            clocks:  [EXTENDED],
            respond: async (pathname, options) => {
                if (options.method === "POST") {
                    await creationHeld;
                }
                return { status: "ok" };
            },
        });
        await harness.initialize();

        await quietly(async () => {
            const started = harness.dispatch("phase-started");
            // Let the creation reach Polyadic before the minute is added.
            await new Promise(resolve => setImmediate(resolve));
            const changed = harness.dispatch("phase-clock-changed");
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(harness.clockUpdates().length, 0, "the clock waits for the creation");
            releaseCreation();
            await Promise.all([started, changed]);
        });

        assert.deepEqual(harness.requests.map(request => request.method), ["POST", "PUT"]);
    });
});
