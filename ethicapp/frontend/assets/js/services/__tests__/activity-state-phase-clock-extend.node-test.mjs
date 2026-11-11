// "+1 min" through ActivityStateService (#1115, epic #1105): the request to
// the extend route of #1112 with the kept deadline, the clock kept from a
// success and from a refusal, a refusal without a clock read again, and a
// failure that keeps the clock as it was.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ActivityStateService } from "../activity-state.service.js";

const SESSION_ID = 10;
const LOCAL_NOW = Date.parse("2026-11-11T12:00:00.000Z");

function clockBody(overrides = {}) {
    return {
        sessionId:   SESSION_ID,
        timeMode:    "soft",
        finished:    false,
        phaseId:     41,
        phaseNumber: 2,
        startedAt:   "2026-11-11T11:55:00.000Z",
        endsAt:      "2026-11-11T12:05:00.000Z",
        isLastPhase: false,
        serverNow:   "2026-11-11T12:00:02.000Z",
        ...overrides,
    };
}

function createService({ post, clock = clockBody() } = {}) {
    const requests = [];
    const $http = {
        get: async (url) => {
            requests.push(["GET", url]);
            return { data: clock };
        },
        post: async (url, body) => {
            requests.push(["POST", url, body]);
            return post(url, body);
        },
    };
    const service = ActivityStateService($http, {}, () => LOCAL_NOW);
    service.acceptPhaseClock(SESSION_ID, clockBody({ serverNow: "2026-11-11T12:00:01.000Z" }));
    const notified = [];
    service.registerListener("onPhaseClock", data => notified.push(data));
    return { service, requests, notified };
}

const refusal = (code, clock) => ({ status: 409, data: { error: "Refused.", code, clock } });

describe("ActivityStateService.extendPhaseClock", () => {
    it("posts one minute with the expected deadline and keeps the new clock", async () => {
        const extended = clockBody({ endsAt: "2026-11-11T12:06:00.000Z" });
        const { service, requests, notified } = createService({
            post: async () => ({ data: extended }),
        });

        const outcome = await service.extendPhaseClock(SESSION_ID, 41, "2026-11-11T12:05:00.000Z");

        assert.deepEqual(outcome, { ok: true, code: null });
        assert.deepEqual(requests, [["POST", `/activities/${SESSION_ID}/phases/41/clock/extend`,
            { minutes: 1, expectedEndsAt: "2026-11-11T12:05:00.000Z" }]]);
        assert.equal(service.getPhaseClock(SESSION_ID).endsAt, "2026-11-11T12:06:00.000Z");
        assert.equal(notified.length, 1);
    });

    it("keeps the clock a refusal carries", async () => {
        const current = clockBody({
            endsAt:    "2026-11-11T12:06:00.000Z",
            serverNow: "2026-11-11T12:00:03.000Z",
        });
        const { service, requests } = createService({
            post: async () => {
                throw refusal("DEADLINE_CHANGED", current);
            },
        });

        const outcome = await service.extendPhaseClock(SESSION_ID, 41, "2026-11-11T12:05:00.000Z");

        assert.deepEqual(outcome, { ok: false, code: "DEADLINE_CHANGED" });
        assert.equal(service.getPhaseClock(SESSION_ID).endsAt, "2026-11-11T12:06:00.000Z");
        assert.equal(requests.length, 1, "no read: the refusal had the clock");
    });

    it("reads the clock again after a refusal without one", async () => {
        const { service, requests } = createService({
            clock: clockBody({
                phaseId:     42,
                phaseNumber: 3,
                serverNow:   "2026-11-11T12:00:04.000Z",
            }),
            post: async () => {
                throw refusal("PHASE_NOT_CURRENT", undefined);
            },
        });

        const outcome = await service.extendPhaseClock(SESSION_ID, 41, "2026-11-11T12:05:00.000Z");

        assert.deepEqual(outcome, { ok: false, code: "PHASE_NOT_CURRENT" });
        assert.deepEqual(requests.at(-1), ["GET", `/activities/${SESSION_ID}/clock`]);
        assert.equal(service.getPhaseClock(SESSION_ID).phaseId, 42);
    });

    it("keeps the clock and never throws on a failure", async () => {
        const { service, requests } = createService({
            post: async () => {
                throw { status: 500, data: { error: "Internal server error" } };
            },
        });
        const kept = service.getPhaseClock(SESSION_ID);
        const originalError = console.error;
        console.error = () => {};
        try {
            const outcome = await service.extendPhaseClock(SESSION_ID, 41,
                "2026-11-11T12:05:00.000Z");
            assert.deepEqual(outcome, { ok: false, code: null });
        } finally {
            console.error = originalError;
        }
        assert.equal(service.getPhaseClock(SESSION_ID), kept);
        assert.equal(requests.length, 1);
    });

    it("passes the code of a bad request", async () => {
        const { service } = createService({
            post: async () => {
                throw { status: 400, data: { error: "Bad.", code: "INVALID_EXPECTED_ENDS_AT" } };
            },
        });
        const originalError = console.error;
        console.error = () => {};
        try {
            assert.deepEqual(await service.extendPhaseClock(SESSION_ID, 41, null),
                { ok: false, code: "INVALID_EXPECTED_ENDS_AT" });
        } finally {
            console.error = originalError;
        }
    });
});
